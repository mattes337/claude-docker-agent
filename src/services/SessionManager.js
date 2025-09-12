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
        this.workspacesDir = path.resolve(process.env.WORKSPACES_DIR || path.join(__dirname, '../../workspaces'));
        this.sessionsFile = path.join(this.workspacesDir, 'sessions.json');
        this.autoResumeManager = new AutoResumeManager(this);
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
                
                // Restore sessions and check Docker containers
                for (const sessionData of data.sessions || []) {
                    const session = {
                        ...sessionData,
                        createdAt: new Date(sessionData.createdAt),
                        lastActivity: new Date(sessionData.lastActivity),
                        stoppedAt: sessionData.stoppedAt ? new Date(sessionData.stoppedAt) : undefined,
                        output: sessionData.output || [],
                        messageQueue: []
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
                // Convert output array to lightweight format for storage
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
        // Save sessions every 30 seconds
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
            output: [],
            maxLines: 2000,
            container: null,
            claudeProcess: null,
            conversationId: null,
            hasStartedConversation: false,
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
                
                // Create new branch if specified
                if (config.newBranchName) {
                    await this.createNewBranch(session);
                }
            }
            
            // Create and start container
            await this.createContainer(session);
            
            // Initialize Claude in container
            await this.initializeClaude(session);
            
            // Set session to running after successful initialization
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

    async createNewBranch(session) {
        const { newBranchName, branch, workDir, id } = session;
        
        this.addOutput(id, `🌿 Creating new branch: ${newBranchName}\n`, 'git');
        
        try {
            // Create and checkout new branch from base branch
            const checkoutProcess = spawn('git', [
                'checkout', '-b', newBranchName, branch
            ], {
                cwd: workDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';

            checkoutProcess.stdout.on('data', (data) => {
                output += data.toString();
                this.addOutput(id, data.toString(), 'git');
            });

            checkoutProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                this.addOutput(id, data.toString(), 'git');
            });

            await new Promise((resolve, reject) => {
                checkoutProcess.on('close', (code) => {
                    if (code === 0) {
                        this.addOutput(id, `✅ New branch '${newBranchName}' created and checked out\n`, 'success');
                        session.currentBranch = newBranchName;
                        resolve();
                    } else {
                        reject(new Error(`Git checkout failed with code ${code}: ${errorOutput}`));
                    }
                });

                checkoutProcess.on('error', (error) => {
                    reject(new Error(`Git checkout error: ${error.message}`));
                });
            });

        } catch (error) {
            this.addOutput(id, `❌ Branch creation failed: ${error.message}\n`, 'error');
            throw new Error(`Failed to create new branch: ${error.message}`);
        }
    }

    async createContainer(session) {
        try {
            this.addOutput(session.id, '🐳 Creating Docker container...\n', 'system');
            
            const containerConfig = {
                ...session.config,
                binds: [
                    `${session.workDir}:/workspace`
                ],
                cmd: ['bash', '-l']
            };

            const container = await this.dockerService.createContainer(session.id, containerConfig);
            await this.dockerService.startContainer(session.id);
            
            session.container = container;
            
            this.addOutput(session.id, '✅ Container created and started\n', 'success');
            
            // Fix permissions for Claude CLI files
            try {
                const { exec } = await this.dockerService.execCommand(
                    session.id,
                    ['chown', '-R', 'claude:claude', '/home/claude/.claude*'],
                    { user: 'root' }
                );
                await exec.inspect();
                this.addOutput(session.id, '✅ Claude CLI permissions fixed\n', 'success');
            } catch (error) {
                console.warn('Failed to fix Claude CLI permissions:', error.message);
                this.addOutput(session.id, '⚠️ Warning: Claude CLI permissions not fixed\n', 'warning');
            }
            
        } catch (error) {
            throw new Error(`Failed to create container: ${error.message}`);
        }
    }

    async initializeClaude(session) {
        try {
            this.addOutput(session.id, '\n═══════════════════════════════════════\n', 'system');
            this.addOutput(session.id, '🤖 Initializing Claude Code...\n', 'system');
            this.addOutput(session.id, '═══════════════════════════════════════\n\n', 'system');
            
            // Pre-configure Claude settings to avoid interactive setup
            try {
                // Initialize config by running a simple config command that creates the config structure
                const { exec: initExec } = await this.dockerService.execCommand(
                    session.id,
                    ['claude', 'config', 'list', '-g'],
                    { user: 'claude' }
                );
                await initExec.inspect();
                
                // Set the theme globally to persist between commands
                const { exec: themeExec } = await this.dockerService.execCommand(
                    session.id,
                    ['claude', 'config', 'set', '-g', 'theme', 'dark'],
                    { user: 'claude' }
                );
                await themeExec.inspect();
                
                // Ensure Claude directory structure exists and has proper permissions
                const { exec: mkdirExec } = await this.dockerService.execCommand(
                    session.id,
                    ['mkdir', '-p', '/home/claude/.claude/plugins/repos'],
                    { user: 'root' }
                );
                await mkdirExec.inspect();
                
                // Set proper ownership for entire .claude directory
                const { exec: permExec } = await this.dockerService.execCommand(
                    session.id,
                    ['chown', '-R', 'claude:claude', '/home/claude/.claude'],
                    { user: 'root' }
                );
                await permExec.inspect();
                
                this.addOutput(session.id, '🎨 Claude configuration initialized\n', 'success');
            } catch (error) {
                console.warn('Failed to initialize Claude configuration:', error.message);
                this.addOutput(session.id, '⚠️ Configuration initialization skipped\n', 'warning');
            }
            
            // Only add welcome message if we haven't already added one
            const hasWelcomeMessage = session.output.some(output => output.type === 'welcome');
            if (!hasWelcomeMessage) {
                this.addFormattedOutput(session.id, this.getWelcomeMessage(), 'welcome');
            }
            
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
            this.addFormattedOutput(sessionId, '⏳ Message queued (currently processing another request)\n', 'info');
            return { success: true, queued: true };
        }

        session.processingMessage = true;
        session.state = 'processing';
        session.lastActivity = new Date();

        try {
            this.addFormattedOutput(sessionId, `\n👤 You: ${prompt}\n\n`, 'user');
            this.addFormattedOutput(sessionId, '🔄 Processing with Claude Code...\n', 'system');

            // Build Claude command with stream-json output format
            const claudeArgs = [
                'claude',
                '-p', prompt,
                '--include-partial-messages',
                '--print',
                '--output-format=stream-json',
                '--verbose',
                ...session.config.claudeArgs
            ];

            // For continuations, use the Claude session ID if available
            if (session.hasStartedConversation && session.claudeSessionId) {
                claudeArgs.push('-r', session.claudeSessionId);
            }

            // Execute Claude command in container
            const { exec, stream } = await this.dockerService.execCommand(
                sessionId, 
                claudeArgs,
                { interactive: false, tty: false }
            );

            // Store process reference for termination capability
            session.claudeProcess = exec;

            // Handle JSON streaming output
            let buffer = '';
            await new Promise((resolve, reject) => {
                stream.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                    
                    // Process complete JSON lines
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep incomplete line in buffer
                    
                    lines.forEach(line => {
                        line = line.trim();
                        if (line) {
                            // Try to find JSON in the line by looking for { or [
                            let jsonStart = -1;
                            for (let i = 0; i < line.length; i++) {
                                if (line[i] === '{' || line[i] === '[') {
                                    jsonStart = i;
                                    break;
                                }
                            }
                            
                            if (jsonStart >= 0) {
                                const jsonPart = line.substring(jsonStart);
                                try {
                                    const jsonData = JSON.parse(jsonPart);
                                    this.handleClaudeJsonOutput(sessionId, jsonData);
                                } catch (parseError) {
                                    // If JSON parsing fails, check if there's non-JSON content
                                    const prefix = line.substring(0, jsonStart);
                                    if (prefix.trim()) {
                                        // There's non-JSON content before the JSON, add it as regular output
                                        this.addFormattedOutput(sessionId, prefix.trim(), 'claude_raw');
                                    }
                                    console.warn(`[Session ${sessionId}] JSON parse error:`, parseError.message);
                                }
                            } else {
                                // No JSON found, treat as regular output
                                this.addFormattedOutput(sessionId, line, 'claude_raw');
                            }
                        }
                    });
                });

                stream.on('end', async () => {
                    try {
                        console.log(`[Session ${sessionId}] Command completed`);
                        
                        // Process any remaining buffer
                        if (buffer.trim()) {
                            const line = buffer.trim();
                            // Try to find JSON in the remaining buffer
                            let jsonStart = -1;
                            for (let i = 0; i < line.length; i++) {
                                if (line[i] === '{' || line[i] === '[') {
                                    jsonStart = i;
                                    break;
                                }
                            }
                            
                            if (jsonStart >= 0) {
                                const jsonPart = line.substring(jsonStart);
                                try {
                                    const jsonData = JSON.parse(jsonPart);
                                    this.handleClaudeJsonOutput(sessionId, jsonData);
                                } catch (parseError) {
                                    const prefix = line.substring(0, jsonStart);
                                    if (prefix.trim()) {
                                        this.addFormattedOutput(sessionId, prefix.trim(), 'claude_raw');
                                    }
                                    console.warn(`[Session ${sessionId}] Final buffer JSON parse error:`, parseError.message);
                                }
                            } else {
                                this.addFormattedOutput(sessionId, line, 'claude_raw');
                            }
                        }
                        
                        // Wait for execution to complete and get exit code
                        const result = await exec.inspect();
                        
                        if (result.ExitCode === 0) {
                            this.addFormattedOutput(sessionId, '\n✅ Request completed\n', 'success');
                            resolve();
                        } else {
                            reject(new Error(`Claude exited with code ${result.ExitCode}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });

                stream.on('error', (error) => {
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
            
            this.addFormattedOutput(sessionId, `❌ Error: ${error.message}\n`, 'error');
            
            // Check for limit reached
            if (error.message.includes('usage limit reached')) {
                this.autoResumeManager.handleLimitReached(sessionId, error.message);
            }
            
            return { success: false, error: error.message };
        }
    }

    async terminateClaudeProcess(sessionId, force = false) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        if (!session.claudeProcess || !session.processingMessage) {
            return { success: false, error: 'No Claude process running' };
        }

        try {
            this.addFormattedOutput(sessionId, '🛑 Terminating Claude process...\n', 'system');
            
            // Try graceful termination first
            await this.dockerService.execCommand(sessionId, ['pkill', '-TERM', '-f', 'claude'], { user: 'claude' });
            
            // Wait a moment, then force kill if requested
            if (force) {
                setTimeout(async () => {
                    try {
                        await this.dockerService.execCommand(sessionId, ['pkill', '-9', '-f', 'claude'], { user: 'claude' });
                    } catch (killError) {
                        console.warn('Force kill failed:', killError.message);
                    }
                }, 2000);
            }
            
            // Reset session state
            session.claudeProcess = null;
            session.processingMessage = false;
            session.state = 'waiting_input';
            
            this.addFormattedOutput(sessionId, '✅ Claude process terminated\n', 'success');
            
            // Process any queued messages
            if (session.messageQueue.length > 0) {
                const nextMessage = session.messageQueue.shift();
                setTimeout(() => {
                    this.executeCommand(sessionId, nextMessage.prompt, nextMessage.options);
                }, 1000);
            }
            
            return { success: true };
            
        } catch (error) {
            this.addFormattedOutput(sessionId, `❌ Failed to terminate process: ${error.message}\n`, 'error');
            return { success: false, error: error.message };
        }
    }

    async stopSession(sessionId, force = false) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        try {
            this.addFormattedOutput(sessionId, '🛑 Stopping session...\n', 'system');
            
            // Kill Claude process if running
            if (session.claudeProcess) {
                try {
                    // First try graceful termination
                    await this.dockerService.execCommand(sessionId, ['pkill', '-f', 'claude'], { user: 'claude' });
                    
                    // If that doesn't work, force kill
                    if (force) {
                        setTimeout(async () => {
                            try {
                                await this.dockerService.execCommand(sessionId, ['pkill', '-9', '-f', 'claude'], { user: 'claude' });
                            } catch (killError) {
                                console.warn('Force kill failed:', killError.message);
                            }
                        }, 2000);
                    }
                    
                    session.claudeProcess = null;
                    this.addFormattedOutput(sessionId, '🔄 Claude process terminated\n', 'system');
                } catch (processError) {
                    console.warn('Failed to terminate Claude process:', processError.message);
                }
            }
            
            // Stop container
            await this.dockerService.stopContainer(sessionId, force);
            
            session.status = 'stopped';
            session.state = 'stopped';
            session.stoppedAt = new Date();
            session.processingMessage = false;
            
            this.emit('sessionStopped', session);
            
            this.addFormattedOutput(sessionId, '✅ Session stopped\n', 'success');
            
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

    addFormattedOutput(sessionId, data, type = 'stdout') {
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

    handleClaudeJsonOutput(sessionId, jsonData) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        try {
            // Mark that conversation has started
            session.hasStartedConversation = true;

            // Handle different types of JSON messages from Claude CLI
            switch (jsonData.type) {
                case 'system':
                    // Handle system initialization - extract session metadata but don't display raw JSON
                    if (jsonData.subtype === 'init') {
                        session.claudeSessionId = jsonData.session_id;
                        session.claudeModel = jsonData.model;
                        session.availableTools = jsonData.tools;
                        // Store metadata but don't display in chat
                        this.emit('sessionMetadata', sessionId, {
                            sessionId: jsonData.session_id,
                            model: jsonData.model,
                            tools: jsonData.tools,
                            slashCommands: jsonData.slash_commands
                        });
                    }
                    break;

                case 'stream_event':
                    this.handleStreamEvent(sessionId, jsonData);
                    break;
                
                case 'assistant':
                    // Handle assistant message from Claude CLI - this is the final complete message
                    if (jsonData.message && jsonData.message.content && Array.isArray(jsonData.message.content)) {
                        const textContent = jsonData.message.content
                            .filter(block => block.type === 'text')
                            .map(block => block.text)
                            .join('');
                        // Don't display this as it's already been streamed
                        console.log(`[Session ${sessionId}] Complete message received: ${textContent.substring(0, 50)}...`);
                    }
                    break;
                
                case 'result':
                    // Handle final result with usage stats
                    if (jsonData.usage) {
                        session.lastUsage = jsonData.usage;
                        this.emit('usageUpdate', sessionId, jsonData.usage);
                    }
                    if (jsonData.total_cost_usd) {
                        session.totalCost = (session.totalCost || 0) + jsonData.total_cost_usd;
                        this.emit('costUpdate', sessionId, session.totalCost);
                    }
                    console.log(`[Session ${sessionId}] Request completed - Duration: ${jsonData.duration_ms}ms, Cost: $${jsonData.total_cost_usd || 0}`);
                    break;
                
                case 'tool_use':
                    this.addFormattedOutput(sessionId, this.formatToolUse(jsonData), 'claude_tool');
                    break;
                
                case 'tool_result':
                    this.addFormattedOutput(sessionId, this.formatToolResult(jsonData), 'claude_tool_result');
                    break;
                
                case 'error':
                    this.addFormattedOutput(sessionId, `❌ Claude Error: ${jsonData.message || jsonData.error}\n`, 'error');
                    break;
                
                default:
                    // For debugging - only log unknown types, don't display in chat
                    console.log(`[Session ${sessionId}] Unknown JSON type:`, jsonData.type);
            }
        } catch (error) {
            console.error('Error handling Claude JSON output:', error);
            this.addFormattedOutput(sessionId, `⚠️ JSON Parse Error: ${error.message}\n`, 'error');
        }
    }

    handleStreamEvent(sessionId, jsonData) {
        const session = this.sessions.get(sessionId);
        if (!session || !jsonData.event) return;

        const event = jsonData.event;
        
        switch (event.type) {
            case 'message_start':
                // Initialize message - store metadata but don't display
                if (event.message) {
                    session.currentMessageId = event.message.id;
                    session.currentMessageModel = event.message.model;
                    session.usage = event.message.usage;
                    
                    // Emit metadata update for UI statistics
                    this.emit('messageMetadata', sessionId, {
                        messageId: event.message.id,
                        model: event.message.model,
                        usage: event.message.usage
                    });
                }
                break;

            case 'content_block_start':
                // Start of content - prepare for text
                if (event.content_block?.type === 'text') {
                    // Initialize the current response if not exists
                    if (!session.currentResponse) {
                        session.currentResponse = '';
                        this.addFormattedOutput(sessionId, '🤖 **Claude**: ', 'claude_message_start');
                    }
                }
                break;

            case 'content_block_delta':
                // Streaming text content - append to current response
                if (event.delta?.type === 'text_delta' && event.delta.text) {
                    if (!session.currentResponse) {
                        session.currentResponse = '';
                    }
                    session.currentResponse += event.delta.text;
                    
                    // Stream the text incrementally
                    this.addFormattedOutput(sessionId, event.delta.text, 'claude_message_delta');
                }
                break;

            case 'content_block_stop':
                // End of content block - finalize message
                if (session.currentResponse !== undefined) {
                    this.addFormattedOutput(sessionId, '\n\n', 'claude_message_end');
                    session.currentResponse = undefined;
                }
                break;

            case 'message_delta':
                // Handle message delta with usage updates
                if (event.delta && event.delta.stop_reason) {
                    session.processingMessage = false;
                }
                if (event.usage) {
                    session.lastMessageUsage = event.usage;
                    // Don't accumulate here, wait for final result
                }
                break;

            case 'message_stop':
                // End of message - store usage stats
                session.processingMessage = false;
                if (event.usage) {
                    session.totalUsage = {
                        inputTokens: (session.totalUsage?.inputTokens || 0) + (event.usage.input_tokens || 0),
                        outputTokens: (session.totalUsage?.outputTokens || 0) + (event.usage.output_tokens || 0),
                        totalTokens: (session.totalUsage?.totalTokens || 0) + ((event.usage.input_tokens || 0) + (event.usage.output_tokens || 0))
                    };
                    
                    // Emit usage update for UI statistics
                    this.emit('usageUpdate', sessionId, session.totalUsage);
                }
                break;

            default:
                // Log unknown stream events for debugging
                console.log(`[Session ${sessionId}] Unknown stream event:`, event.type);
        }
    }

    formatClaudeMessage(jsonData) {
        let formatted = '';
        
        if (jsonData.role === 'assistant') {
            formatted += '🤖 Claude: ';
        } else if (jsonData.role === 'user') {
            formatted += '👤 You: ';
        }
        
        if (Array.isArray(jsonData.content)) {
            jsonData.content.forEach(block => {
                if (block.type === 'text') {
                    formatted += block.text + '\n';
                } else if (block.type === 'code') {
                    formatted += `\`\`\`${block.language || ''}\n${block.code}\n\`\`\`\n`;
                }
            });
        } else if (typeof jsonData.content === 'string') {
            formatted += jsonData.content + '\n';
        }
        
        return formatted;
    }

    formatClaudePartialMessage(jsonData) {
        // For partial messages, just return the content without formatting
        if (Array.isArray(jsonData.content)) {
            return jsonData.content.map(block => block.text || block.code || '').join('');
        } else if (typeof jsonData.content === 'string') {
            return jsonData.content;
        }
        return '';
    }

    formatToolUse(jsonData) {
        const toolName = jsonData.name || jsonData.tool_name || 'Unknown Tool';
        let formatted = `🔧 Using tool: ${toolName}\n`;
        
        if (jsonData.parameters || jsonData.input) {
            formatted += `Parameters: ${JSON.stringify(jsonData.parameters || jsonData.input, null, 2)}\n`;
        }
        
        return formatted;
    }

    formatToolResult(jsonData) {
        let formatted = '📋 Tool Result:\n';
        
        if (jsonData.result || jsonData.output) {
            const result = jsonData.result || jsonData.output;
            if (typeof result === 'string') {
                formatted += result + '\n';
            } else {
                formatted += JSON.stringify(result, null, 2) + '\n';
            }
        }
        
        return formatted;
    }

    formatStatusMessage(jsonData) {
        const status = jsonData.status || jsonData.message || 'Status update';
        return `ℹ️ Status: ${status}\n`;
    }

    getWelcomeMessage() {
        return `👋 **Hello!** I'm Claude, your AI coding assistant. I'm ready to help with development tasks, debugging, code review, and more. What would you like to work on?`;
    }

    replaceOutput(sessionId, data, type = 'stdout') {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        const output = {
            timestamp: new Date(),
            data,
            type
        };
        
        // Clear existing output and replace with new data
        session.output = [output];
        
        // Emit output replacement event
        this.emit('sessionOutputReplaced', sessionId, output);
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

    async getAllContainers() {
        try {
            const containers = await this.dockerService.docker.listContainers({ all: true });
            const claudeContainers = containers.filter(container => 
                container.Names.some(name => name.includes('claude-session-'))
            );

            return claudeContainers.map(container => {
                const containerName = container.Names[0].replace('/', '');
                const sessionId = containerName.replace('claude-session-', '');
                const session = this.sessions.get(sessionId);

                return {
                    id: container.Id,
                    sessionId,
                    name: containerName,
                    image: container.Image,
                    state: container.State,
                    status: container.Status,
                    created: new Date(container.Created * 1000),
                    hasSession: !!session,
                    sessionInfo: session ? this.getSessionInfo(sessionId) : null
                };
            });
        } catch (error) {
            console.error('❌ Failed to get containers:', error.message);
            return [];
        }
    }

    async removeContainer(containerId) {
        try {
            const dockerContainer = this.dockerService.docker.getContainer(containerId);
            
            // Stop container if running
            try {
                await dockerContainer.stop();
            } catch (error) {
                // Container might already be stopped
            }
            
            // Remove container
            await dockerContainer.remove({ force: true });
            
            console.log(`✅ Removed container ${containerId}`);
            return { success: true };
        } catch (error) {
            console.error(`❌ Failed to remove container ${containerId}:`, error.message);
            return { success: false, error: error.message };
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

        console.log(`Found ${stoppedSessions.length} stopped sessions to cleanup`);

        for (const sessionId of stoppedSessions) {
            await this.cleanupSession(sessionId);
        }

        console.log('✅ Cleanup completed');
    }

    async cleanupSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        try {
            console.log(`🧹 Cleaning up session ${sessionId}`);

            // Stop and remove Docker container
            await this.dockerService.stopContainer(sessionId, true);
            await this.dockerService.removeContainer(sessionId);

            // Clean up workspace directory if it exists
            if (session.workDir && session.workDir !== '/') {
                try {
                    const fs = require('fs-extra');
                    if (await fs.pathExists(session.workDir)) {
                        console.log(`🗑️ Removing workspace: ${session.workDir}`);
                        await fs.remove(session.workDir);
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to remove workspace ${session.workDir}: ${error.message}`);
                }
            }

            // Remove session from memory
            this.sessions.delete(sessionId);
            
            console.log(`✅ Session ${sessionId} cleaned up successfully`);

        } catch (error) {
            console.error(`❌ Failed to cleanup session ${sessionId}: ${error.message}`);
        }
    }

    async forceCleanupOrphanedContainers() {
        console.log('🔍 Checking for orphaned containers...');
        
        try {
            const containers = await this.dockerService.docker.listContainers({ all: true });
            const claudeContainers = containers.filter(container => 
                container.Names.some(name => name.includes('claude-session-'))
            );

            console.log(`Found ${claudeContainers.length} Claude containers`);

            for (const container of claudeContainers) {
                const containerName = container.Names[0].replace('/', '');
                const sessionId = containerName.replace('claude-session-', '');
                
                // If session doesn't exist in memory, it's orphaned
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

    startPeriodicCleanup() {
        // Run cleanup every 5 minutes
        this.cleanupInterval = setInterval(async () => {
            try {
                await this.cleanupStoppedSessions();
                await this.forceCleanupOrphanedContainers();
            } catch (error) {
                console.error('❌ Periodic cleanup failed:', error.message);
            }
        }, 5 * 60 * 1000); // 5 minutes

        console.log('🕐 Periodic cleanup started (runs every 5 minutes)');
    }

    stopPeriodicCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('⏹️ Periodic cleanup stopped');
        }
    }

    async stopAllSessions() {
        console.log('🛑 Stopping all sessions...');
        
        // Stop periodic processes
        this.stopPeriodicCleanup();
        this.stopAutoSave();
        
        // Save sessions before shutdown
        await this.saveSessions();
        
        const promises = [];
        for (const sessionId of this.sessions.keys()) {
            promises.push(this.stopSession(sessionId, true));
        }
        await Promise.all(promises);
        
        // Cleanup all stopped sessions
        await this.cleanupStoppedSessions();
        
        // Force cleanup any orphaned containers
        await this.forceCleanupOrphanedContainers();
        
        console.log('✅ All sessions stopped and cleaned up');
    }

    /**
     * Selective ANSI escape sequence cleaning for web-safe terminal output
     * Preserves color codes but removes terminal control sequences
     */
    cleanAnsiEscapeSequences(text) {
        if (!text) return text;
        
        let cleaned = text;
        
        // First pass: Remove all ANSI escape sequences completely for clean display
        cleaned = cleaned
            // Remove ALL CSI sequences (Control Sequence Introducer)
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
            // Remove OSC sequences (Operating System Command)
            .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
            // Remove DCS sequences (Device Control String)
            .replace(/\x1bP[^\x1b]*(?:\x1b\\|\x07)/g, '')
            // Remove APC sequences (Application Program Command)
            .replace(/\x1b_[^\x1b]*(?:\x1b\\|\x07)/g, '')
            // Remove PM sequences (Privacy Message)
            .replace(/\x1b\^[^\x1b]*(?:\x1b\\|\x07)/g, '')
            // Remove SOS sequences (Start of String)
            .replace(/\x1bX[^\x1b]*(?:\x1b\\|\x07)/g, '')
            // Remove single character escapes
            .replace(/\x1b[0-9A-Za-z]/g, '')
            // Remove malformed sequences (missing escape character)
            .replace(/\[[0-9;?]*[a-zA-Z]/g, '')
            // Remove all remaining control characters except newlines and tabs
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
            // Remove stray F characters that appear at line start
            .replace(/^F+/gm, '')
            // Remove other garbage characters at line start
            .replace(/^[^\w\s\n\t\+\-\|]+/gm, '');
            
        // Second pass: Clean up formatting issues
            
        // PRESERVE SGR (Select Graphic Rendition) codes for color rendering
        // These include: \x1b[...m sequences for colors, bold, italic, etc.
        // Our ANSI renderer in the frontend will handle these properly
        
        // Handle special Unicode box drawing characters that may appear garbled
        // Convert common box drawing to ASCII equivalents for better web compatibility
        cleaned = cleaned
            .replace(/[╭╮╰╯]/g, '+')     // Box drawing corners -> plus
            .replace(/[─━]/g, '-')       // Horizontal lines -> dash  
            .replace(/[│┃]/g, '|')       // Vertical lines -> pipe
            .replace(/[├┤┬┴┼]/g, '+')    // Box drawing connections -> plus
            .replace(/[┌┐└┘]/g, '+');    // Other corners -> plus
        
        // Clean up excessive whitespace but preserve intentional spacing
        cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        return cleaned;
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
