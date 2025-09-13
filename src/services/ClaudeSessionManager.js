const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class ClaudeSessionManager extends EventEmitter {
    constructor(dockerService) {
        super();
        this.dockerService = dockerService;
        this.sessions = new Map();
        this.workspacesDir = path.resolve(process.env.WORKSPACES_DIR || path.join(__dirname, '../../workspaces'));
        this.sessionsFile = path.join(this.workspacesDir, 'sessions.json');
        this.systemPromptPath = path.join(__dirname, '../../claude-system-prompt.txt');
        this.cleanupInterval = null;
        
        // Ensure workspaces directory exists
        fs.ensureDirSync(this.workspacesDir);
        
        // Load persisted sessions
        this.loadPersistedSessions();
        
        // Start periodic cleanup
        this.startPeriodicCleanup();
        
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
                        container: null,
                        claudeProcess: null
                    };
                    
                    // Check if Docker container still exists
                    try {
                        const containerInfo = await this.dockerService.getContainerInfo(session.id);
                        if (containerInfo) {
                            session.status = containerInfo.state.Status === 'running' ? 'running' : 'stopped';
                            session.state = containerInfo.state.Status === 'running' ? 'ready' : 'stopped';
                        } else {
                            session.status = 'stopped';
                            session.state = 'stopped';
                        }
                    } catch (error) {
                        session.status = 'stopped';
                        session.state = 'stopped';
                    }
                    
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
                container: null,
                claudeProcess: null
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

    stopAutoSave() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
            console.log('💾 Auto-save stopped');
        }
    }

    async createSession(config) {
        const sessionId = uuidv4();
        const workDir = path.join(this.workspacesDir, sessionId);
        
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
            container: null,
            claudeProcess: null,
            claudeSessionId: null,
            messageHistory: [],
            config: {
                memory: config.memory || 1024 * 1024 * 1024,
                cpuShares: config.cpuShares || 1024,
                env: config.env || []
            }
        };

        try {
            this.sessions.set(sessionId, session);
            this.emit('sessionCreated', session);
            
            await this.setupWorkspace(session);
            
            if (config.repoUrl) {
                await this.cloneRepository(session);
                if (config.newBranchName) {
                    await this.createNewBranch(session);
                }
            }
            
            await this.createContainer(session);
            
            session.status = 'running';
            session.state = 'ready';
            this.emit('sessionReady', session);
            
            return {
                success: true,
                session: this.getSessionInfo(sessionId)
            };
            
        } catch (error) {
            session.status = 'error';
            session.error = error.message;
            this.emit('sessionError', session, error);
            await this.cleanupSession(sessionId);
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    async executeClaudeCommand(sessionId, prompt, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        // Read system prompt to pass as argument
        const systemPrompt = await fs.readFile(this.systemPromptPath, 'utf-8');
        
        // Build Claude CLI command to run inside Docker container
        const claudeArgs = [
            '-p', prompt,
            '--include-partial-messages',
            '--print',
            '--output-format=stream-json',
            '--verbose',
            '--append-system-prompt', systemPrompt
        ];

        // Add session ID for subsequent calls
        if (session.claudeSessionId || options.claudeSessionId) {
            claudeArgs.push('-r', session.claudeSessionId || options.claudeSessionId);
        }

        // Execute Claude command inside the Docker container
        const dockerExecArgs = [
            'exec', '-i', `claude-session-${sessionId}`,
            'claude', ...claudeArgs
        ];

        return new Promise((resolve, reject) => {
            const claudeProcess = spawn('docker', dockerExecArgs, {
                env: {
                    ...process.env,
                    ...session.config.env
                }
            });

            let jsonBuffer = '';
            const messages = [];
            const statistics = {};
            let claudeSessionId = null;

            claudeProcess.stdout.on('data', (data) => {
                jsonBuffer += data.toString();
                
                // Try to parse complete JSON lines
                const lines = jsonBuffer.split('\n');
                jsonBuffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const parsed = JSON.parse(line);
                            
                            // Extract session ID from first response
                            if (!claudeSessionId && parsed.sessionId) {
                                claudeSessionId = parsed.sessionId;
                                session.claudeSessionId = claudeSessionId;
                            }

                            // Handle different types of JSON responses
                            if (parsed.type === 'message') {
                                messages.push(parsed);
                                this.emit('claudeMessage', sessionId, parsed);
                            } else if (parsed.type === 'statistics') {
                                Object.assign(statistics, parsed.data);
                                this.emit('claudeStatistics', sessionId, statistics);
                            } else if (parsed.type === 'partial') {
                                this.emit('claudePartial', sessionId, parsed);
                            } else if (parsed.type === 'error') {
                                this.emit('claudeError', sessionId, parsed);
                            }
                        } catch (e) {
                            console.warn('Failed to parse JSON line:', line);
                        }
                    }
                }
            });

            claudeProcess.stderr.on('data', (data) => {
                console.error('Claude CLI error:', data.toString());
                this.emit('claudeError', sessionId, { error: data.toString() });
            });

            claudeProcess.on('close', (code) => {
                session.lastActivity = new Date();
                
                if (code === 0) {
                    resolve({
                        success: true,
                        messages,
                        statistics,
                        sessionId: claudeSessionId
                    });
                } else {
                    reject(new Error(`Claude CLI exited with code ${code}`));
                }
            });

            claudeProcess.on('error', (error) => {
                reject(error);
            });

            // Close stdin immediately since Claude doesn't need input
            claudeProcess.stdin.end();

            session.claudeProcess = claudeProcess;
        });
    }

    async setupWorkspace(session) {
        try {
            await fs.ensureDir(session.workDir);
            console.log(`📁 Workspace created: ${session.workDir}`);
        } catch (error) {
            throw new Error(`Failed to setup workspace: ${error.message}`);
        }
    }

    async cloneRepository(session) {
        const { repoUrl, branch, workDir } = session;
        
        console.log(`📦 Cloning repository: ${repoUrl}`);
        
        try {
            const cloneProcess = spawn('git', [
                'clone', '--progress', '--branch', branch, repoUrl, workDir
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            await new Promise((resolve, reject) => {
                cloneProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log('✅ Repository cloned successfully');
                        resolve();
                    } else {
                        reject(new Error(`Git clone failed with code ${code}`));
                    }
                });

                cloneProcess.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Failed to clone repository: ${error.message}`);
        }
    }

    async createNewBranch(session) {
        const { newBranchName, branch, workDir } = session;
        
        console.log(`🌿 Creating new branch: ${newBranchName}`);
        
        try {
            const checkoutProcess = spawn('git', [
                'checkout', '-b', newBranchName, branch
            ], {
                cwd: workDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            await new Promise((resolve, reject) => {
                checkoutProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(`✅ New branch '${newBranchName}' created`);
                        session.currentBranch = newBranchName;
                        resolve();
                    } else {
                        reject(new Error(`Git checkout failed with code ${code}`));
                    }
                });

                checkoutProcess.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Failed to create new branch: ${error.message}`);
        }
    }

    async createContainer(session) {
        try {
            console.log('🐳 Creating Docker container...');
            this.emit('containerBooting', session.id, 'Preparing Docker container...');
            
            // Copy system prompt to session workspace
            const sessionPromptPath = path.join(session.workDir, 'claude-system-prompt.txt');
            await fs.copy(this.systemPromptPath, sessionPromptPath);
            this.emit('containerBooting', session.id, 'Configuring Claude environment...');
            
            const containerConfig = {
                ...session.config,
                binds: [
                    `${session.workDir}:/workspace`,
                    `${sessionPromptPath}:/claude-system-prompt.txt:ro`
                ],
                cmd: ['bash', '-l']
            };

            this.emit('containerBooting', session.id, 'Creating container from image...');
            const container = await this.dockerService.createContainer(session.id, containerConfig);
            
            this.emit('containerBooting', session.id, 'Starting container services...');
            await this.dockerService.startContainer(session.id);
            
            // Fix permissions for Claude directories
            this.emit('containerBooting', session.id, 'Setting up Claude directories...');
            await this.fixClaudePermissions(session.id);
            
            // Verify Claude is available in container
            this.emit('containerBooting', session.id, 'Verifying Claude CLI installation...');
            await this.verifyClaudeInContainer(session.id);
            
            session.container = container;
            console.log('✅ Container created and started');
            this.emit('containerReady', session.id);
            
        } catch (error) {
            this.emit('containerError', session.id, error.message);
            throw new Error(`Failed to create container: ${error.message}`);
        }
    }

    async fixClaudePermissions(sessionId) {
        return new Promise((resolve, reject) => {
            const fixPermsProcess = spawn('docker', [
                'exec', '-u', 'root', `claude-session-${sessionId}`,
                'sh', '-c',
                'mkdir -p /home/claude/.claude/plugins/repos && chown -R claude:claude /home/claude'
            ]);

            fixPermsProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Claude permissions fixed for container ${sessionId}`);
                    resolve();
                } else {
                    console.warn(`Failed to fix Claude permissions (code ${code}), continuing anyway...`);
                    resolve(); // Continue anyway, might work
                }
            });

            fixPermsProcess.on('error', (error) => {
                console.warn(`Error fixing Claude permissions: ${error.message}`);
                resolve(); // Continue anyway
            });
        });
    }

    async verifyClaudeInContainer(sessionId) {
        return new Promise((resolve, reject) => {
            const verifyProcess = spawn('docker', [
                'exec', `claude-session-${sessionId}`,
                'which', 'claude'
            ]);

            verifyProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error('Claude CLI not found in container. Please ensure the Docker image includes Claude CLI.'));
                }
            });

            verifyProcess.on('error', (error) => {
                reject(new Error(`Failed to verify Claude CLI: ${error.message}`));
            });
        });
    }

    async stopSession(sessionId, force = false) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        try {
            console.log('🛑 Stopping session...');
            
            // Kill Claude process if running
            if (session.claudeProcess) {
                session.claudeProcess.kill();
                session.claudeProcess = null;
            }
            
            await this.dockerService.stopContainer(sessionId, force);
            
            session.status = 'stopped';
            session.state = 'stopped';
            session.stoppedAt = new Date();
            
            console.log('✅ Session stopped');
            this.emit('sessionStopped', session);
            
            return { success: true };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async cleanupSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        try {
            // Kill Claude process if running
            if (session.claudeProcess) {
                session.claudeProcess.kill();
            }
            
            await this.dockerService.stopContainer(sessionId, true);
            await this.dockerService.removeContainer(sessionId);
            
            if (process.env.CLEANUP_WORKSPACES === 'true' && session.workDir) {
                await fs.remove(session.workDir);
                console.log(`🧹 Workspace cleaned up: ${session.workDir}`);
            }
            
            this.sessions.delete(sessionId);
            this.emit('sessionCleaned', sessionId);
            
        } catch (error) {
            console.error(`Error cleaning up session ${sessionId}:`, error.message);
        }
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
            claudeSessionId: session.claudeSessionId
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

    startPeriodicCleanup() {
        this.cleanupInterval = setInterval(async () => {
            try {
                await this.cleanupStoppedSessions();
                await this.forceCleanupOrphanedContainers();
            } catch (error) {
                console.error('❌ Periodic cleanup failed:', error.message);
            }
        }, 5 * 60 * 1000);

        console.log('🕐 Periodic cleanup started (runs every 5 minutes)');
    }

    stopPeriodicCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('⏹️ Periodic cleanup stopped');
        }
    }

    async cleanupStoppedSessions() {
        console.log('🧹 Starting cleanup of stopped sessions...');
        
        const stoppedSessions = [];
        this.sessions.forEach((session, sessionId) => {
            if (session.status === 'stopped' || session.state === 'stopped') {
                stoppedSessions.push(sessionId);
            }
        });

        for (const sessionId of stoppedSessions) {
            await this.cleanupSession(sessionId);
        }

        console.log('✅ Cleanup completed');
    }

    async forceCleanupOrphanedContainers() {
        console.log('🔍 Checking for orphaned containers...');
        
        try {
            const containers = await this.dockerService.docker.listContainers({ all: true });
            const claudeContainers = containers.filter(container => 
                container.Names.some(name => name.includes('claude-session-'))
            );

            for (const container of claudeContainers) {
                const containerName = container.Names[0].replace('/', '');
                const sessionId = containerName.replace('claude-session-', '');
                
                if (!this.sessions.has(sessionId)) {
                    console.log(`🗑️ Removing orphaned container: ${containerName}`);
                    
                    try {
                        const dockerContainer = this.dockerService.docker.getContainer(container.Id);
                        await dockerContainer.remove({ force: true });
                        console.log(`✅ Removed orphaned container ${containerName}`);
                    } catch (error) {
                        console.warn(`⚠️ Failed to remove container ${containerName}: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Failed to cleanup orphaned containers: ${error.message}`);
        }
    }

    async stopAllSessions() {
        console.log('🛑 Stopping all sessions...');
        
        this.stopPeriodicCleanup();
        this.stopAutoSave();
        
        await this.saveSessions();
        
        const promises = [];
        for (const sessionId of this.sessions.keys()) {
            promises.push(this.stopSession(sessionId, true));
        }
        await Promise.all(promises);
        
        await this.cleanupStoppedSessions();
        await this.forceCleanupOrphanedContainers();
        
        console.log('✅ All sessions stopped and cleaned up');
    }
}

module.exports = ClaudeSessionManager;