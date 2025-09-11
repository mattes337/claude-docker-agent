const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class SessionManager extends EventEmitter {
    constructor(dockerService) {
        super();
        this.dockerService = dockerService;
        this.sessions = new Map();
        this.workspacesDir = process.env.WORKSPACES_DIR || path.join(__dirname, '../../workspaces');
        this.autoResumeManager = new AutoResumeManager(this);
        
        // Ensure workspaces directory exists
        fs.ensureDirSync(this.workspacesDir);
    }

    async createSession(config) {
        const sessionId = uuidv4();
        const workDir = path.join(this.workspacesDir, sessionId);
        
        const session = {
            id: sessionId,
            name: config.name || `Session ${sessionId.slice(0, 8)}`,
            repoUrl: config.repoUrl,
            branch: config.branch || 'main',
            workDir,
            status: 'initializing',
            state: 'idle',
            createdAt: new Date(),
            lastActivity: new Date(),
            output: [],
            maxLines: 2000,
            container: null,
            claudeProcess: null,
            conversationId: null,
            messageQueue: [],
            processingMessage: false,
            config: {
                memory: config.memory || 1024 * 1024 * 1024, // 1GB
                cpuShares: config.cpuShares || 1024,
                env: config.env || [],
                claudeArgs: config.claudeArgs || []
            }
        };

        try {
            // Store session
            this.sessions.set(sessionId, session);
            
            // Emit session created event
            this.emit('sessionCreated', session);
            
            // Setup workspace
            await this.setupWorkspace(session);
            
            // Clone repository if provided
            if (config.repoUrl) {
                await this.cloneRepository(session);
            }
            
            // Create and start container
            await this.createContainer(session);
            
            // Initialize Claude in container
            await this.initializeClaude(session);
            
            session.status = 'running';
            session.state = 'waiting_input';
            
            this.emit('sessionReady', session);
            
            return {
                success: true,
                session: this.getSessionInfo(sessionId)
            };
            
        } catch (error) {
            session.status = 'error';
            session.error = error.message;
            
            this.emit('sessionError', session, error);
            
            // Cleanup on error
            await this.cleanupSession(sessionId);
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    async setupWorkspace(session) {
        try {
            await fs.ensureDir(session.workDir);
            this.addOutput(session.id, `📁 Workspace created: ${session.workDir}\n`, 'system');
        } catch (error) {
            throw new Error(`Failed to setup workspace: ${error.message}`);
        }
    }

    async cloneRepository(session) {
        const { repoUrl, branch, workDir, id } = session;
        
        this.addOutput(id, `📦 Cloning repository: ${repoUrl}\n`, 'git');
        this.addOutput(id, `📂 Destination: ${workDir}\n`, 'system');
        
        try {
            // Clone repository
            const cloneProcess = spawn('git', [
                'clone', '--progress', '--branch', branch, repoUrl, workDir
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';

            cloneProcess.stdout.on('data', (data) => {
                output += data.toString();
                this.addOutput(id, data.toString(), 'git');
            });

            cloneProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                this.addOutput(id, data.toString(), 'git');
            });

            await new Promise((resolve, reject) => {
                cloneProcess.on('close', (code) => {
                    if (code === 0) {
                        this.addOutput(id, '✅ Repository cloned successfully\n', 'success');
                        resolve();
                    } else {
                        reject(new Error(`Git clone failed with code ${code}: ${errorOutput}`));
                    }
                });

                cloneProcess.on('error', (error) => {
                    reject(new Error(`Git clone error: ${error.message}`));
                });
            });

        } catch (error) {
            this.addOutput(id, `❌ Clone failed: ${error.message}\n`, 'error');
            throw new Error(`Failed to clone repository: ${error.message}`);
        }
    }

    async createContainer(session) {
        try {
            this.addOutput(session.id, '🐳 Creating Docker container...\n', 'system');
            
            const containerConfig = {
                ...session.config,
                binds: [`${session.workDir}:/workspace`],
                cmd: ['bash', '-l']
            };

            const container = await this.dockerService.createContainer(session.id, containerConfig);
            await this.dockerService.startContainer(session.id);
            
            session.container = container;
            
            this.addOutput(session.id, '✅ Container created and started\n', 'success');
            
        } catch (error) {
            throw new Error(`Failed to create container: ${error.message}`);
        }
    }

    async initializeClaude(session) {
        try {
            this.addOutput(session.id, '\n═══════════════════════════════════════\n', 'system');
            this.addOutput(session.id, '🤖 Initializing Claude Code...\n', 'system');
            this.addOutput(session.id, '═══════════════════════════════════════\n\n', 'system');
            
            // Claude will be initialized when first command is sent
            this.addOutput(session.id, '✅ Claude Code ready for commands\n', 'success');
            this.addOutput(session.id, '💬 Send your requests to execute them\n', 'info');
            
        } catch (error) {
            throw new Error(`Failed to initialize Claude: ${error.message}`);
        }
    }

    async executeCommand(sessionId, prompt, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        // Check if already processing
        if (session.processingMessage) {
            session.messageQueue.push({ prompt, options });
            this.addOutput(sessionId, '⏳ Message queued (currently processing another request)\n', 'info');
            return { success: true, queued: true };
        }

        session.processingMessage = true;
        session.state = 'processing';
        session.lastActivity = new Date();

        try {
            this.addOutput(sessionId, `\n👤 You: ${prompt}\n\n`, 'user');
            this.addOutput(sessionId, '🔄 Processing with Claude Code...\n', 'system');

            // Execute Claude command in container
            const claudeArgs = [
                'claude',
                '-p', prompt,
                '--cwd', '/workspace',
                '--dangerously-skip-permissions',
                '--output-format', options.outputFormat || 'text',
                ...session.config.claudeArgs
            ];

            if (session.conversationId) {
                claudeArgs.push('--resume', session.conversationId);
            }

            const { exec, stream } = await this.dockerService.execCommand(
                sessionId, 
                claudeArgs,
                { interactive: true, tty: true }
            );

            // Handle output
            stream.on('data', (chunk) => {
                const data = chunk.toString();
                this.addOutput(sessionId, data, 'claude');
                
                // Try to extract conversation ID
                const idMatch = data.match(/conversation_id:\s*([a-zA-Z0-9-]+)/);
                if (idMatch) {
                    session.conversationId = idMatch[1];
                }
            });

            // Wait for completion
            const result = await exec.inspect();
            
            if (result.ExitCode === 0) {
                this.addOutput(sessionId, '\n✅ Request completed\n', 'success');
            } else {
                throw new Error(`Claude exited with code ${result.ExitCode}`);
            }

            session.state = 'waiting_input';
            
            // Process queued messages
            if (session.messageQueue.length > 0) {
                const nextMessage = session.messageQueue.shift();
                setTimeout(() => {
                    this.executeCommand(sessionId, nextMessage.prompt, nextMessage.options);
                }, 1000);
            } else {
                session.processingMessage = false;
            }

            return { success: true };

        } catch (error) {
            session.processingMessage = false;
            session.state = 'error';
            
            this.addOutput(sessionId, `❌ Error: ${error.message}\n`, 'error');
            
            // Check for limit reached
            if (error.message.includes('usage limit reached')) {
                this.autoResumeManager.handleLimitReached(sessionId, error.message);
            }
            
            return { success: false, error: error.message };
        }
    }

    async stopSession(sessionId, force = false) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        try {
            this.addOutput(sessionId, '🛑 Stopping session...\n', 'system');
            
            // Stop container
            await this.dockerService.stopContainer(sessionId, force);
            
            session.status = 'stopped';
            session.stoppedAt = new Date();
            
            this.emit('sessionStopped', session);
            
            this.addOutput(sessionId, '✅ Session stopped\n', 'success');
            
            return { success: true };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async cleanupSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        try {
            // Stop and remove container
            await this.dockerService.stopContainer(sessionId, true);
            await this.dockerService.removeContainer(sessionId);
            
            // Remove workspace if configured to do so
            if (process.env.CLEANUP_WORKSPACES === 'true') {
                await fs.remove(session.workDir);
                this.addOutput(sessionId, `🧹 Workspace cleaned up: ${session.workDir}\n`, 'system');
            }
            
            // Remove from sessions
            this.sessions.delete(sessionId);
            
            this.emit('sessionCleaned', sessionId);
            
        } catch (error) {
            console.error(`Error cleaning up session ${sessionId}:`, error.message);
        }
    }

    addOutput(sessionId, data, type = 'stdout') {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        const output = {
            timestamp: new Date(),
            data,
            type
        };
        
        session.output.push(output);
        
        // Trim buffer if too large
        if (session.output.length > session.maxLines) {
            session.output.shift();
        }
        
        // Emit output event
        this.emit('sessionOutput', sessionId, output);
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    getSessionInfo(sessionId) {
        const session = this.sessions.get(sessionId);
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
            conversationId: session.conversationId,
            outputLines: session.output.length
        };
    }

    getAllSessions() {
        const sessions = [];
        this.sessions.forEach(session => {
            sessions.push(this.getSessionInfo(session.id));
        });
        return sessions;
    }

    getSessionCount() {
        return this.sessions.size;
    }

    async stopAllSessions() {
        const promises = [];
        for (const sessionId of this.sessions.keys()) {
            promises.push(this.stopSession(sessionId, true));
        }
        await Promise.all(promises);
    }
}

// Auto-Resume Manager for handling Claude limit reached scenarios
class AutoResumeManager {
    constructor(sessionManager) {
        this.sessionManager = sessionManager;
        this.resumeSchedules = new Map();
    }

    handleLimitReached(sessionId, output) {
        console.log(`[AUTO-RESUME] Limit reached for session ${sessionId}`);
        
        const resetTime = this.parseResetTime(output);
        this.scheduleResume(sessionId, resetTime);
    }

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
            
            if (resetTime <= new Date()) {
                resetTime.setDate(resetTime.getDate() + 1);
            }
            
            return resetTime;
        }
        
        // Default: 5 minutes
        const defaultTime = new Date();
        defaultTime.setMinutes(defaultTime.getMinutes() + 5);
        return defaultTime;
    }

    scheduleResume(sessionId, resetTime) {
        const now = new Date();
        const waitTime = resetTime - now;
        
        console.log(`[AUTO-RESUME] Scheduling resume at ${resetTime.toLocaleString()}`);
        
        this.resumeSchedules.set(sessionId, { resetTime, scheduledAt: now });
        
        if (waitTime > 0 && waitTime < 24 * 60 * 60 * 1000) {
            setTimeout(async () => {
                await this.attemptResume(sessionId);
            }, waitTime);
        }
        
        this.sessionManager.emit('resumeScheduled', sessionId, resetTime);
    }

    async attemptResume(sessionId) {
        console.log(`[AUTO-RESUME] Attempting to resume session ${sessionId}`);
        
        try {
            const result = await this.sessionManager.executeCommand(
                sessionId, 
                'Continue with the previous task'
            );
            
            if (result.success) {
                console.log(`[AUTO-RESUME] Successfully resumed session ${sessionId}`);
                this.resumeSchedules.delete(sessionId);
                this.sessionManager.emit('sessionResumed', sessionId);
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

module.exports = SessionManager;
