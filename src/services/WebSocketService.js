const WebSocket = require('ws');

class WebSocketService {
    constructor(server, sessionManager) {
        this.sessionManager = sessionManager;
        this.clients = new Map(); // sessionId -> Set of WebSocket connections
        this.connectionMap = new Map(); // WebSocket -> Set of sessionIds
        
        // Create WebSocket server
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws'
        });
        
        this.setupWebSocketServer();
        this.setupSessionManagerListeners();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws, req) => {
            console.log('🔌 New WebSocket connection');
            
            // Initialize connection tracking
            this.connectionMap.set(ws, new Set());
            
            // Handle incoming messages
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleMessage(ws, data);
                } catch (error) {
                    console.error('❌ WebSocket message error:', error);
                    this.sendError(ws, 'Invalid JSON message');
                }
            });
            
            // Handle connection close
            ws.on('close', () => {
                console.log('🔌 WebSocket connection closed');
                this.handleDisconnection(ws);
            });
            
            // Handle errors
            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.handleDisconnection(ws);
            });
            
            // Send welcome message
            this.send(ws, {
                type: 'connected',
                message: 'WebSocket connection established',
                timestamp: new Date().toISOString()
            });
        });
        
        console.log('🌐 WebSocket server initialized');
    }

    setupSessionManagerListeners() {
        // Listen to session events
        this.sessionManager.on('sessionCreated', (session) => {
            this.broadcast(session.id, {
                type: 'session_created',
                session: this.sessionManager.getSessionInfo(session.id)
            });
        });

        this.sessionManager.on('sessionReady', (session) => {
            this.broadcast(session.id, {
                type: 'session_ready',
                session: this.sessionManager.getSessionInfo(session.id)
            });
        });

        this.sessionManager.on('sessionStopped', (session) => {
            this.broadcast(session.id, {
                type: 'session_stopped',
                session: this.sessionManager.getSessionInfo(session.id)
            });
        });

        this.sessionManager.on('sessionError', (session, error) => {
            this.broadcast(session.id, {
                type: 'session_error',
                session: this.sessionManager.getSessionInfo(session.id),
                error: error.message
            });
        });

        this.sessionManager.on('sessionOutput', (sessionId, output) => {
            // Extract data from output object if needed
            const outputData = typeof output === 'object' && output.data ? output.data : output;
            this.broadcast(sessionId, {
                type: 'output',
                sessionId,
                output: outputData
            });
        });

        this.sessionManager.on('resumeScheduled', (sessionId, resetTime) => {
            this.broadcast(sessionId, {
                type: 'resume_scheduled',
                sessionId,
                resetTime: resetTime.toISOString()
            });
        });

        this.sessionManager.on('sessionResumed', (sessionId) => {
            this.broadcast(sessionId, {
                type: 'session_resumed',
                sessionId,
                message: 'Session successfully resumed'
            });
        });
    }

    handleMessage(ws, data) {
        switch (data.type) {
            case 'subscribe':
                this.handleSubscribe(ws, data);
                break;
                
            case 'unsubscribe':
                this.handleUnsubscribe(ws, data);
                break;
                
            case 'execute_command':
                this.handleExecuteCommand(ws, data);
                break;
                
            case 'get_sessions':
                this.handleGetSessions(ws);
                break;
                
            case 'get_session':
                this.handleGetSession(ws, data);
                break;
                
            case 'ping':
                this.send(ws, { type: 'pong', timestamp: new Date().toISOString() });
                break;
                
            default:
                this.sendError(ws, `Unknown message type: ${data.type}`);
        }
    }

    handleSubscribe(ws, data) {
        const { sessionId } = data;
        
        if (!sessionId) {
            this.sendError(ws, 'Session ID required for subscription');
            return;
        }
        
        // Add client to session subscribers
        if (!this.clients.has(sessionId)) {
            this.clients.set(sessionId, new Set());
        }
        this.clients.get(sessionId).add(ws);
        
        // Track subscription for this connection
        this.connectionMap.get(ws).add(sessionId);
        
        // Send confirmation
        this.send(ws, {
            type: 'subscribed',
            sessionId,
            message: `Subscribed to session ${sessionId}`
        });
        
        // Send current session info if it exists
        const sessionInfo = this.sessionManager.getSessionInfo(sessionId);
        if (sessionInfo) {
            this.send(ws, {
                type: 'session_info',
                session: sessionInfo
            });
            
            // Send recent output
            const session = this.sessionManager.getSession(sessionId);
            if (session && session.output.length > 0) {
                const recentOutput = session.output.slice(-50); // Last 50 lines
                this.send(ws, {
                    type: 'output_history',
                    sessionId,
                    output: recentOutput
                });
            }
        }
        
        console.log(`📡 Client subscribed to session ${sessionId}`);
    }

    handleUnsubscribe(ws, data) {
        const { sessionId } = data;
        
        if (!sessionId) {
            this.sendError(ws, 'Session ID required for unsubscription');
            return;
        }
        
        // Remove client from session subscribers
        if (this.clients.has(sessionId)) {
            this.clients.get(sessionId).delete(ws);
            
            // Clean up empty sets
            if (this.clients.get(sessionId).size === 0) {
                this.clients.delete(sessionId);
            }
        }
        
        // Remove from connection tracking
        this.connectionMap.get(ws).delete(sessionId);
        
        // Send confirmation
        this.send(ws, {
            type: 'unsubscribed',
            sessionId,
            message: `Unsubscribed from session ${sessionId}`
        });
        
        console.log(`📡 Client unsubscribed from session ${sessionId}`);
    }

    async handleExecuteCommand(ws, data) {
        const { sessionId, prompt, options } = data;
        
        if (!sessionId || !prompt) {
            this.sendError(ws, 'Session ID and prompt required');
            return;
        }
        
        try {
            const result = await this.sessionManager.executeCommand(sessionId, prompt, options);
            
            this.send(ws, {
                type: 'command_result',
                sessionId,
                result
            });
            
        } catch (error) {
            this.sendError(ws, `Failed to execute command: ${error.message}`);
        }
    }

    handleGetSessions(ws) {
        const sessions = this.sessionManager.getAllSessions();
        
        this.send(ws, {
            type: 'sessions_list',
            sessions
        });
    }

    handleGetSession(ws, data) {
        const { sessionId } = data;
        
        if (!sessionId) {
            this.sendError(ws, 'Session ID required');
            return;
        }
        
        const session = this.sessionManager.getSessionInfo(sessionId);
        
        if (session) {
            this.send(ws, {
                type: 'session_info',
                session
            });
        } else {
            this.sendError(ws, `Session not found: ${sessionId}`);
        }
    }

    handleDisconnection(ws) {
        // Get all sessions this connection was subscribed to
        const subscribedSessions = this.connectionMap.get(ws);
        
        if (subscribedSessions) {
            // Remove from all session subscriber lists
            subscribedSessions.forEach(sessionId => {
                if (this.clients.has(sessionId)) {
                    this.clients.get(sessionId).delete(ws);
                    
                    // Clean up empty sets
                    if (this.clients.get(sessionId).size === 0) {
                        this.clients.delete(sessionId);
                    }
                }
            });
        }
        
        // Remove connection tracking
        this.connectionMap.delete(ws);
    }

    broadcast(sessionId, message) {
        const clients = this.clients.get(sessionId);
        
        if (clients) {
            const messageStr = JSON.stringify({
                ...message,
                timestamp: new Date().toISOString()
            });
            
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageStr);
                } else {
                    // Remove dead connections
                    clients.delete(client);
                }
            });
            
            // Clean up empty sets
            if (clients.size === 0) {
                this.clients.delete(sessionId);
            }
        }
    }

    send(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                ...message,
                timestamp: new Date().toISOString()
            }));
        }
    }

    sendError(ws, error) {
        this.send(ws, {
            type: 'error',
            error: typeof error === 'string' ? error : error.message
        });
    }

    // Broadcast to all connected clients
    broadcastGlobal(message) {
        const messageStr = JSON.stringify({
            ...message,
            timestamp: new Date().toISOString()
        });
        
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    getStats() {
        return {
            totalConnections: this.wss.clients.size,
            activeSubscriptions: this.clients.size,
            sessionsWithSubscribers: Array.from(this.clients.keys())
        };
    }

    close() {
        console.log('🔌 Closing WebSocket server...');
        
        // Close all client connections
        this.wss.clients.forEach(client => {
            client.close(1000, 'Server shutting down');
        });
        
        // Close the server
        this.wss.close(() => {
            console.log('✅ WebSocket server closed');
        });
    }
}

module.exports = WebSocketService;
