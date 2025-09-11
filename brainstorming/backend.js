// Claude Code Headless Mode Backend with Repository Management and Auto-Resume
const express = require('express');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

/**
 * Claude Code Headless Session Manager
 * Uses Claude Code CLI in headless mode (--print flag) for non-interactive execution
 */
class ClaudeHeadlessSessionManager {
    constructor() {
        this.sessions = new Map();
        this.clients = new Map();
        this.workspacesDir = process.env.WORKSPACES_DIR || '/tmp/claude-workspaces';
        this.autoResumeManager = new AutoResumeManager(this);
        
        // Ensure workspaces directory exists
        fs.ensureDirSync(this.workspacesDir);
    }

    /**
     * Create a new repository session with Claude Code in headless mode
     */
    async createRepositorySession(config) {
        const sessionId = uuidv4();
        const workDir = path.join(this.workspacesDir, sessionId);
        
        const sessionInfo = {
            id: sessionId,
            name: config.name || `Session ${sessionId.slice(0, 8)}`,
            repoUrl: config.repoUrl,
            branch: config.branch || 'main',
            workDir,
            output: [],
            maxLines: 2000,
            status: 'initializing',
            createdAt: new Date(),
            currentProcess: null,
            conversationId: null,
            lastActivity: new Date(),
            state: 'idle',
            headlessOptions: config.headlessOptions || {},
            messageQueue: [],
            processingMessage: false
        };

        try {
            // Store session info
            this.sessions.set(sessionId, sessionInfo);
            
            // Broadcast initial status
            this.broadcast(sessionId, {
                type: 'status',
                processId: sessionId,
                status: 'cloning',
                message: 'Setting up repository...'
            });

            // Setup repository
            await this.setupRepository(sessionInfo);
            
            // Initialize headless Claude session
            await this.initializeHeadlessSession(sessionInfo);
            
            return {
                success: true,
                session: {
                    id: sessionInfo.id,
                    name: sessionInfo.name,
                    repoUrl: sessionInfo.repoUrl,
                    branch: sessionInfo.branch,
                    status: sessionInfo.status,
                    workDir: sessionInfo.workDir
                }
            };
        } catch (error) {
            sessionInfo.status = 'error';
            sessionInfo.error = error.message;
            
            this.broadcast(sessionId, {
                type: 'error',
                processId: sessionId,
                message: error.message
            });
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Setup repository (clone and checkout branch)
     */
    async setupRepository(sessionInfo) {
        const { repoUrl, branch, workDir, id } = sessionInfo;
        
        await fs.ensureDir(workDir);
        
        this.addOutput(id, `📦 Cloning repository: ${repoUrl}\n`, 'git');
        this.addOutput(id, `📂 Destination: ${workDir}\n`, 'system');
        
        try {
            // Clone repository
            const { stdout: cloneOutput } = await exec(
                `git clone --progress "${repoUrl}" "${workDir}" 2>&1`
            );
            
            this.addOutput(id, cloneOutput, 'git');
            this.addOutput(id, '✅ Repository cloned successfully\n', 'success');
            
            // Checkout branch
            await exec(`cd "${workDir}" && git fetch --all`);
            
            try {
                const { stdout: checkoutOutput } = await exec(
                    `cd "${workDir}" && git checkout "${branch}" 2>&1`
                );
                this.addOutput(id, checkoutOutput, 'git');
            } catch (error) {
                // Create branch if it doesn't exist
                if (error.message.includes('did not match')) {
                    await exec(`cd "${workDir}" && git checkout -b "${branch}"`);
                    this.addOutput(id, `Created new branch: ${branch}\n`, 'git');
                } else {
                    throw error;
                }
            }
            
            // Get current branch info
            const { stdout: branchInfo } = await exec(
                `cd "${workDir}" && git rev-parse --abbrev-ref HEAD`
            );
            
            this.addOutput(id, `✅ Current branch: ${branchInfo}`, 'success');
            
        } catch (error) {
            this.addOutput(id, `❌ Setup failed: ${error.message}\n`, 'error');
            throw new Error(`Failed to setup repository: ${error.message}`);
        }
    }

    /**
     * Initialize Claude Code in headless mode
     */
    async initializeHeadlessSession(sessionInfo) {
        const { workDir, id } = sessionInfo;
        
        this.addOutput(id, '\n═══════════════════════════════════════\n', 'system');
        this.addOutput(id, '🤖 Initializing Claude Code (Headless Mode)...\n', 'system');
        this.addOutput(id, `📁 Working directory: ${workDir}\n`, 'system');
        this.addOutput(id, '═══════════════════════════════════════\n\n', 'system');
        
        sessionInfo.status = 'running';
        sessionInfo.state = 'waiting_input';
        
        this.addOutput(id, '✅ Claude Code ready in headless mode\n', 'success');
        this.addOutput(id, '💬 Send your requests to execute them non-interactively\n', 'info');
    }

    /**
     * Execute a prompt using Claude Code in headless mode
     */
    async executeHeadlessPrompt(sessionId, prompt, options = {}) {
        const sessionInfo = this.sessions.get(sessionId);
        if (!sessionInfo) {
            return { success: false, error: 'Session not found' };
        }

        // Check if already processing
        if (sessionInfo.processingMessage) {
            // Queue the message
            sessionInfo.messageQueue.push({ prompt, options });
            this.addOutput(sessionId, '⏳ Message queued (currently processing another request)\n', 'info');
            return { success: true, queued: true };
        }

        sessionInfo.processingMessage = true;
        sessionInfo.state = 'processing';
        sessionInfo.lastActivity = new Date();

        try {
            // Build Claude command with headless mode
            const args = [
                '-p', prompt,  // --print flag for headless mode
                '--cwd', sessionInfo.workDir,
                '--dangerously-skip-permissions',
                '--output-format', options.outputFormat || 'text'
            ];

            // Add optional parameters
            if (options.allowedTools) {
                args.push('--allowedTools', options.allowedTools);
            }
            if (options.systemPrompt) {
                args.push('--append-system-prompt', options.systemPrompt);
            }
            if (options.maxTurns) {
                args.push('--max-turns', options.maxTurns.toString());
            }
            if (options.permissionMode) {
                args.push('--permission-mode', options.permissionMode);
            }
            if (sessionInfo.conversationId) {
                args.push('--resume', sessionInfo.conversationId);
            }

            this.addOutput(sessionId, `\n👤 You: ${prompt}\n\n`, 'user');
            this.addOutput(sessionId, '🔄 Processing with Claude Code...\n', 'system');

            // Execute Claude in headless mode
            const result = await this.executeClaudeCommand(sessionInfo, args);

            if (result.success) {
                // Parse and handle output
                this.handleHeadlessOutput(sessionId, result.output);
                
                // Store conversation ID if available
                if (result.conversationId) {
                    sessionInfo.conversationId = result.conversationId;
                }

                this.addOutput(sessionId, '\n✅ Request completed\n', 'success');
            } else {
                throw new Error(result.error);
            }

            sessionInfo.state = 'waiting_input';
            
            // Process queued messages
            if (sessionInfo.messageQueue.length > 0) {
                const nextMessage = sessionInfo.messageQueue.shift();
                setTimeout(() => {
                    this.executeHeadlessPrompt(sessionId, nextMessage.prompt, nextMessage.options);
                }, 1000);
            } else {
                sessionInfo.processingMessage = false;
            }

            return { success: true };

        } catch (error) {
            sessionInfo.processingMessage = false;
            sessionInfo.state = 'error';
            
            this.addOutput(sessionId, `❌ Error: ${error.message}\n`, 'error');
            
            // Check for limit reached
            if (error.message.includes('usage limit reached')) {
                this.autoResumeManager.handleLimitReached(sessionId, error.message);
            }
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Execute Claude command and capture output
     */
    async executeClaudeCommand(sessionInfo, args) {
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            
            let output = '';
            let errorOutput = '';
            let conversationId = null;
            
            const claudeProcess = spawn('claude', args, {
                cwd: sessionInfo.workDir,
                env: {
                    ...process.env,
                    CLAUDE_HEADLESS: 'true'
                }
            });

            claudeProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                output += chunk;
                
                // Stream output to clients
                this.addOutput(sessionInfo.id, chunk, 'claude');
                
                // Try to extract conversation ID from output
                const idMatch = chunk.match(/conversation_id:\s*([a-zA-Z0-9-]+)/);
                if (idMatch) {
                    conversationId = idMatch[1];
                }
            });

            claudeProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            claudeProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({
                        success: true,
                        output,
                        conversationId,
                        exitCode: code
                    });
                } else {
                    reject(new Error(errorOutput || `Claude exited with code ${code}`));
                }
            });

            claudeProcess.on('error', (error) => {
                reject(error);
            });

            // Store process reference for potential cancellation
            sessionInfo.currentProcess = claudeProcess;
        });
    }

    /**
     * Handle output from headless Claude execution
     */
    handleHeadlessOutput(sessionId, output) {
        // Detect state changes from output
        const detection = this.detectStateFromOutput(output);
        
        if (detection.limitReached) {
            this.autoResumeManager.handleLimitReached(sessionId, output);
        }
        
        // Broadcast state changes
        if (detection.states.length > 0) {
            this.broadcast(sessionId, {
                type: 'state_change',
                states: detection.states,
                currentState: detection.currentState
            });
        }
    }

    /**
     * Detect state from Claude output
     */
    detectStateFromOutput(output) {
        const states = [];
        let limitReached = false;
        
        // Check for usage limit
        if (output.match(/usage limit reached|rate limit|quota exceeded/i)) {
            states.push({ action: 'LIMIT_REACHED', severity: 'critical' });
            limitReached = true;
        }
        
        // Check for file operations
        if (output.match(/creating file|modifying|updating/i)) {
            states.push({ action: 'FILE_OPERATION', severity: 'info' });
        }
        
        // Check for errors
        if (output.match(/error:|failed|exception/i)) {
            states.push({ action: 'ERROR', severity: 'error' });
        }
        
        // Check for completion
        if (output.match(/complete|finished|done/i)) {
            states.push({ action: 'COMPLETE', severity: 'success' });
        }
        
        return {
            states,
            limitReached,
            currentState: states[0]?.action || 'IDLE'
        };
    }

    /**
     * Execute streaming prompt with JSON output
     */
    async executeStreamingPrompt(sessionId, prompt, options = {}) {
        const sessionInfo = this.sessions.get(sessionId);
        if (!sessionInfo) {
            return { success: false, error: 'Session not found' };
        }

        const args = [
            '-p', prompt,
            '--cwd', sessionInfo.workDir,
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--input-format', 'stream-json'
        ];

        // Add resume if we have a conversation
        if (sessionInfo.conversationId) {
            args.push('--resume', sessionInfo.conversationId);
        }

        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const readline = require('readline');
            
            const claudeProcess = spawn('claude', args, {
                cwd: sessionInfo.workDir
            });

            const rl = readline.createInterface({
                input: claudeProcess.stdout,
                crlfDelay: Infinity
            });

            rl.on('line', (line) => {
                try {
                    const message = JSON.parse(line);
                    this.handleStreamMessage(sessionId, message);
                } catch (e) {
                    // Not JSON, treat as regular output
                    this.addOutput(sessionId, line + '\n', 'claude');
                }
            });

            claudeProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    reject(new Error(`Process exited with code ${code}`));
                }
            });

            // Send the prompt as JSON input
            const input = JSON.stringify({
                type: 'user',
                message: {
                    role: 'user',
                    content: [{ type: 'text', text: prompt }]
                }
            });
            
            claudeProcess.stdin.write(input + '\n');
            claudeProcess.stdin.end();
        });
    }

    /**
     * Handle streaming JSON messages
     */
    handleStreamMessage(sessionId, message) {
        // Broadcast streaming message to clients
        this.broadcast(sessionId, {
            type: 'stream',
            message
        });

        // Add to output based on message type
        if (message.type === 'text') {
            this.addOutput(sessionId, message.text, 'claude');
        } else if (message.type === 'tool_use') {
            this.addOutput(sessionId, `\n🔧 Using tool: ${message.name}\n`, 'tool');
        } else if (message.type === 'result') {
            this.addOutput(sessionId, `\n📊 Result: ${message.result}\n`, 'result');
        }
    }

    /**
     * Continue conversation using --continue flag
     */
    async continueConversation(sessionId, prompt) {
        const sessionInfo = this.sessions.get(sessionId);
        if (!sessionInfo) {
            return { success: false, error: 'Session not found' };
        }

        const args = [
            '--continue', prompt,
            '--cwd', sessionInfo.workDir,
            '--dangerously-skip-permissions'
        ];

        return await this.executeClaudeCommand(sessionInfo, args);
    }

    /**
     * Resume after limit using --resume
     */
    async resumeAfterLimit(sessionId) {
        const sessionInfo = this.sessions.get(sessionId);
        if (!sessionInfo) {
            return { success: false, error: 'Session not found' };
        }

        this.addOutput(sessionId, '\n🔄 Attempting to resume session...\n', 'system');

        try {
            // Use --resume flag to continue
            const args = [
                '--resume',
                '--cwd', sessionInfo.workDir,
                '--dangerously-skip-permissions',
                '-p', 'Continue with the previous task'
            ];

            const result = await this.executeClaudeCommand(sessionInfo, args);
            
            if (result.success) {
                this.addOutput(sessionId, '✅ Session resumed successfully\n', 'success');
                sessionInfo.status = 'running';
                sessionInfo.state = 'waiting_input';
            }
            
            return result;
        } catch (error) {
            this.addOutput(sessionId, `❌ Resume failed: ${error.message}\n`, 'error');
            return { success: false, error: error.message };
        }
    }

    // Helper methods
    addOutput(id, data, type = 'stdout') {
        const sessionInfo = this.sessions.get(id);
        if (!sessionInfo) return;
        
        const output = {
            timestamp: new Date(),
            data,
            type
        };
        
        sessionInfo.output.push(output);
        
        // Trim buffer if too large
        if (sessionInfo.output.length > sessionInfo.maxLines) {
            sessionInfo.output.shift();
        }
        
        // Broadcast to clients
        this.broadcast(id, {
            type: 'output',
            processId: id,
            data,
            outputType: type
        });
    }

    broadcast(processId, message) {
        const clients = this.clients.get(processId);
        if (clients) {
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(message));
                }
            });
        }
    }

    getSession(id) {
        const session = this.sessions.get(id);
        if (!session) return null;
        
        return {
            id: session.id,
            name: session.name,
            repoUrl: session.repoUrl,
            branch: session.branch,
            status: session.status,
            state: session.state,
            workDir: session.workDir,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            conversationId: session.conversationId
        };
    }

    getAllSessions() {
        const sessions = [];
        this.sessions.forEach(session => {
            sessions.push(this.getSession(session.id));
        });
        return sessions;
    }
}

/**
 * Auto-Resume Manager for handling Claude limit reached scenarios
 */
class AutoResumeManager {
    constructor(sessionManager) {
        this.sessionManager = sessionManager;
        this.resumeSchedules = new Map();
        this.checkInterval = 60000; // Check every minute
    }

    /**
     * Handle limit reached detection
     */
    async handleLimitReached(sessionId, output) {
        console.log(`[AUTO-RESUME] Limit reached for session ${sessionId}`);
        
        // Parse reset time
        const resetTime = this.parseResetTime(output);
        
        // Schedule auto-resume
        this.scheduleResume(sessionId, resetTime);
    }

    /**
     * Parse reset time from output
     */
    parseResetTime(text) {
        // Try to parse "resets at HH:MM AM/PM"
        const timeMatch = text.match(/resets?\s+at\s+([0-9]{1,2}):([0-9]{2})\s*(AM|PM)?/i);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const meridiem = timeMatch[3];
            
            const resetTime = new Date();
            let hour24 = hours;
            
            if (meridiem?.toLowerCase() === 'pm' && hours !== 12) {
                hour24 += 12;
            } else if (meridiem?.toLowerCase() === 'am' && hours === 12) {
                hour24 = 0;
            }
            
            resetTime.setHours(hour24, minutes, 0, 0);
            
            // If time is in the past, assume tomorrow
            if (resetTime <= new Date()) {
                resetTime.setDate(resetTime.getDate() + 1);
            }
            
            return resetTime;
        }
        
        // Try "resets in X hours/minutes"
        const durationMatch = text.match(/resets?\s+in\s+([0-9]+)\s*(hours?|minutes?)/i);
        if (durationMatch) {
            const amount = parseInt(durationMatch[1]);
            const unit = durationMatch[2].toLowerCase();
            
            const resetTime = new Date();
            if (unit.startsWith('hour')) {
                resetTime.setHours(resetTime.getHours() + amount);
            } else {
                resetTime.setMinutes(resetTime.getMinutes() + amount);
            }
            
            return resetTime;
        }
        
        // Default: 5 minutes
        const defaultTime = new Date();
        defaultTime.setMinutes(defaultTime.getMinutes() + 5);
        return defaultTime;
    }

    /**
     * Schedule automatic resume
     */
    scheduleResume(sessionId, resetTime) {
        const now = new Date();
        const waitTime = resetTime - now;
        
        console.log(`[AUTO-RESUME] Scheduling resume at ${resetTime.toLocaleString()}`);
        console.log(`[AUTO-RESUME] Wait time: ${Math.round(waitTime / 1000)} seconds`);
        
        this.resumeSchedules.set(sessionId, {
            resetTime,
            scheduledAt: now
        });
        
        // Schedule the resume
        if (waitTime > 0 && waitTime < 24 * 60 * 60 * 1000) {
            setTimeout(async () => {
                await this.attemptResume(sessionId);
            }, waitTime);
        }
        
        // Notify clients
        this.sessionManager.broadcast(sessionId, {
            type: 'resume_scheduled',
            resetTime: resetTime.toISOString(),
            waitTime: Math.round(waitTime / 1000)
        });
    }

    /**
     * Attempt to resume session
     */
    async attemptResume(sessionId) {
        console.log(`[AUTO-RESUME] Attempting to resume session ${sessionId}`);
        
        try {
            const result = await this.sessionManager.resumeAfterLimit(sessionId);
            
            if (result.success) {
                console.log(`[AUTO-RESUME] Successfully resumed session ${sessionId}`);
                this.resumeSchedules.delete(sessionId);
                
                this.sessionManager.broadcast(sessionId, {
                    type: 'session_resumed',
                    message: 'Session successfully resumed'
                });
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error(`[AUTO-RESUME] Failed to resume: ${error.message}`);
            
            // Retry in 5 minutes
            const retryTime = new Date();
            retryTime.setMinutes(retryTime.getMinutes() + 5);
            this.scheduleResume(sessionId, retryTime);
        }
    }
}

// Express API Setup
const app = express();
const manager = new ClaudeHeadlessSessionManager();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Endpoints

// Create new session
app.post('/api/sessions', async (req, res) => {
    try {
        const result = await manager.createRepositorySession(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all sessions
app.get('/api/sessions', (req, res) => {
    res.json(manager.getAllSessions());
});

// Get specific session
app.get('/api/sessions/:id', (req, res) => {
    const session = manager.getSession(req.params.id);
    if (session) {
        res.json(session);
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// Execute headless prompt
app.post('/api/sessions/:id/execute', async (req, res) => {
    const { prompt, ...options } = req.body;
    const result = await manager.executeHeadlessPrompt(req.params.id, prompt, options);
    res.json(result);
});

// Execute streaming prompt
app.post('/api/sessions/:id/stream', async (req, res) => {
    const { prompt, ...options } = req.body;
    const result = await manager.executeStreamingPrompt(req.params.id, prompt, options);
    res.json(result);
});

// Continue conversation
app.post('/api/sessions/:id/continue', async (req, res) => {
    const result = await manager.continueConversation(req.params.id, req.body.prompt);
    res.json(result);
});

// Resume after limit
app.post('/api/sessions/:id/resume', async (req, res) => {
    const result = await manager.resumeAfterLimit(req.params.id);
    res.json(result);
});

// Get auto-resume status
app.get('/api/auto-resume/status', (req, res) => {
    const status = [];
    manager.autoResumeManager.resumeSchedules.forEach((schedule, sessionId) => {
        status.push({
            sessionId,
            resetTime: schedule.resetTime.toISOString(),
            scheduledAt: schedule.scheduledAt.toISOString()
        });
    });
    res.json(status);
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        sessions: manager.sessions.size,
        uptime: process.uptime()
    });
});

// WebSocket Setup
const server = app.listen(3000, () => {
    console.log('🚀 Claude Headless Mode Server running on port 3000');
    console.log('📁 Workspaces directory:', manager.workspacesDir);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let subscribedSessions = new Set();
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'subscribe') {
                subscribedSessions.add(data.sessionId);
                
                if (!manager.clients.has(data.sessionId)) {
                    manager.clients.set(data.sessionId, new Set());
                }
                manager.clients.get(data.sessionId).add(ws);
                
                ws.send(JSON.stringify({
                    type: 'subscribed',
                    sessionId: data.sessionId
                }));
            } else if (data.type === 'unsubscribe') {
                subscribedSessions.delete(data.sessionId);
                
                if (manager.clients.has(data.sessionId)) {
                    manager.clients.get(data.sessionId).delete(ws);
                }
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        subscribedSessions.forEach(sessionId => {
            if (manager.clients.has(sessionId)) {
                manager.clients.get(sessionId).delete(ws);
            }
        });
    });
});

// Export for testing
module.exports = { app, manager };