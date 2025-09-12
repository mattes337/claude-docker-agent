const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

/**
 * Alternative SessionManager using native Node.js processes instead of Docker
 * Provides better context access and simpler streaming
 */
class NodePtySessionManager extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.workspacesDir = path.resolve(process.env.WORKSPACES_DIR || path.join(__dirname, '../../workspaces'));
        this.sessionsFile = path.join(this.workspacesDir, 'sessions.json');
        
        // Ensure workspaces directory exists
        fs.ensureDirSync(this.workspacesDir);
        
        // Load persisted sessions
        this.loadPersistedSessions();
        
        // Auto-save sessions periodically
        this.startAutoSave();
    }

    async loadPersistedSessions() {
        try {
            if (await fs.pathExists(this.sessionsFile)) {
                console.log('📥 Loading persisted sessions...');
                const data = await fs.readJson(this.sessionsFile);
                
                for (const sessionData of data.sessions || []) {
                    const session = {
                        ...sessionData,
                        createdAt: new Date(sessionData.createdAt),
                        lastActivity: new Date(sessionData.lastActivity),
                        stoppedAt: sessionData.stoppedAt ? new Date(sessionData.stoppedAt) : undefined,
                        output: sessionData.output || [],
                        messageQueue: [],
                        claudeProcess: null,
                        status: 'stopped',
                        state: 'stopped'
                    };
                    
                    this.sessions.set(session.id, session);
                }
                
                console.log(`✅ Loaded ${this.sessions.size} persisted sessions`);
            }
        } catch (error) {
            console.warn(`⚠️ Failed to load persisted sessions: ${error.message}`);
        }
    }

    async saveSessions() {
        try {
            const sessionsArray = Array.from(this.sessions.values()).map(session => ({
                ...session,
                claudeProcess: null, // Don't serialize process objects
                outputLength: session.output ? session.output.length : 0
            }));
            
            const data = {
                savedAt: new Date().toISOString(),
                sessions: sessionsArray
            };
            
            await fs.writeJson(this.sessionsFile, data, { spaces: 2 });
        } catch (error) {
            console.error(`❌ Failed to save sessions: ${error.message}`);
        }
    }

    startAutoSave() {
        this.saveInterval = setInterval(async () => {
            await this.saveSessions();
        }, 30 * 1000);
        
        console.log('💾 Auto-save started (saves every 30 seconds)');
    }

    async createSession(config) {
        const sessionId = uuidv4();
        const workDir = config.repoUrl ? path.join(this.workspacesDir, sessionId) : process.cwd();
        
        const session = {
            id: sessionId,
            name: config.name || `Session ${sessionId.slice(0, 8)}`,
            repoUrl: config.repoUrl,
            branch: config.branch || 'main',
            newBranchName: config.newBranchName,
            currentBranch: config.newBranchName || config.branch || 'main',
            workDir,
            status: 'initializing',
            state: 'idle',
            createdAt: new Date(),
            lastActivity: new Date(),
            output: [],
            maxLines: 2000,
            claudeProcess: null,
            conversationId: null,
            messageQueue: [],
            processingMessage: false,
            config: {
                claudeArgs: config.claudeArgs || []
            }
        };

        try {
            this.sessions.set(sessionId, session);
            this.emit('sessionCreated', session);
            
            // Setup workspace if cloning a repo
            if (config.repoUrl) {
                await this.setupWorkspace(session);
                await this.cloneRepository(session);
                
                if (config.newBranchName) {
                    await this.createNewBranch(session);
                }
            }
            
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
        
        try {
            const cloneProcess = spawn('git', [
                'clone', '--progress', '--branch', branch, repoUrl, workDir
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            cloneProcess.stdout.on('data', (data) => {
                this.addOutput(id, data.toString(), 'git');
            });

            cloneProcess.stderr.on('data', (data) => {
                this.addOutput(id, data.toString(), 'git');
            });

            await new Promise((resolve, reject) => {
                cloneProcess.on('close', (code) => {
                    if (code === 0) {
                        this.addOutput(id, '✅ Repository cloned successfully\n', 'success');
                        resolve();
                    } else {
                        reject(new Error(`Git clone failed with code ${code}`));
                    }
                });
            });

        } catch (error) {
            throw new Error(`Failed to clone repository: ${error.message}`);
        }
    }

    async createNewBranch(session) {
        const { newBranchName, branch, workDir, id } = session;
        
        this.addOutput(id, `🌿 Creating new branch: ${newBranchName}\n`, 'git');
        
        try {
            const checkoutProcess = spawn('git', [
                'checkout', '-b', newBranchName, branch
            ], {
                cwd: workDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            checkoutProcess.stdout.on('data', (data) => {
                this.addOutput(id, data.toString(), 'git');
            });

            checkoutProcess.stderr.on('data', (data) => {
                this.addOutput(id, data.toString(), 'git');
            });

            await new Promise((resolve, reject) => {
                checkoutProcess.on('close', (code) => {
                    if (code === 0) {
                        this.addOutput(id, `✅ New branch '${newBranchName}' created\n`, 'success');
                        session.currentBranch = newBranchName;
                        resolve();
                    } else {
                        reject(new Error(`Git checkout failed with code ${code}`));
                    }
                });
            });

        } catch (error) {
            throw new Error(`Failed to create new branch: ${error.message}`);
        }
    }

    async executeCommand(sessionId, prompt, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        if (session.processingMessage) {
            session.messageQueue.push({ prompt, options });
            this.addOutput(sessionId, '⏳ Message queued\n', 'info');
            return { success: true, queued: true };
        }

        session.processingMessage = true;
        session.state = 'processing';
        session.lastActivity = new Date();

        try {
            this.addOutput(sessionId, `\n👤 You: ${prompt}\n\n`, 'user');
            this.addOutput(sessionId, '🔄 Processing with Claude Code...\n', 'system');

            // Build Claude command
            const claudeArgs = [
                'claude',
                '--dangerously-skip-permissions',
                prompt,
                ...session.config.claudeArgs
            ];

            if (session.conversationId) {
                claudeArgs.push('--resume', session.conversationId);
            }

            // Execute Claude directly on host with full project context
            const claudeProcess = spawn(claudeArgs[0], claudeArgs.slice(1), {
                cwd: session.workDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    SESSION_ID: sessionId
                }
            });

            session.claudeProcess = claudeProcess;

            // Handle real-time streaming output
            claudeProcess.stdout.on('data', (data) => {
                const output = data.toString('utf8');
                this.addOutput(sessionId, output, 'claude');
                
                // Extract conversation ID
                const idMatch = output.match(/conversation_id:\s*([a-zA-Z0-9-]+)/);
                if (idMatch) {
                    session.conversationId = idMatch[1];
                }
            });

            claudeProcess.stderr.on('data', (data) => {
                const output = data.toString('utf8');
                this.addOutput(sessionId, output, 'claude_error');
            });

            // Wait for completion
            await new Promise((resolve, reject) => {
                claudeProcess.on('close', (code) => {
                    if (code === 0) {
                        this.addOutput(sessionId, '\n✅ Request completed\n', 'success');
                        resolve();
                    } else {
                        reject(new Error(`Claude exited with code ${code}`));
                    }
                });

                claudeProcess.on('error', (error) => {
                    reject(error);
                });
            });

            session.state = 'waiting_input';
            session.claudeProcess = null;
            
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
            session.claudeProcess = null;
            
            this.addOutput(sessionId, `❌ Error: ${error.message}\n`, 'error');
            
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
            
            // Kill Claude process if running
            if (session.claudeProcess) {
                if (force) {
                    session.claudeProcess.kill('SIGKILL');
                } else {
                    session.claudeProcess.kill('SIGTERM');
                }
                session.claudeProcess = null;
            }
            
            session.status = 'stopped';
            session.state = 'stopped';
            session.stoppedAt = new Date();
            
            this.emit('sessionStopped', session);
            
            this.addOutput(sessionId, '✅ Session stopped\n', 'success');
            
            return { success: true };
            
        } catch (error) {
            return { success: false, error: error.message };
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
        
        // Emit output event for real-time streaming
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
            newBranchName: session.newBranchName,
            currentBranch: session.currentBranch,
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
        console.log('🛑 Stopping all sessions...');
        
        // Stop auto-save
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
        
        // Save sessions before shutdown
        await this.saveSessions();
        
        const promises = [];
        for (const sessionId of this.sessions.keys()) {
            promises.push(this.stopSession(sessionId, true));
        }
        await Promise.all(promises);
        
        console.log('✅ All sessions stopped');
    }
}

module.exports = NodePtySessionManager;