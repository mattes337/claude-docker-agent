const WebSocket = require('ws');
const { EventEmitter } = require('events');

class ClaudeWebSocketService extends EventEmitter {
    constructor(server, sessionManager) {
        super();
        this.sessionManager = sessionManager;
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws'
        });
        this.clients = new Map();
        
        this.setupWebSocketServer();
        this.setupSessionListeners();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            const client = {
                id: clientId,
                ws: ws,
                sessionId: null,
                isAlive: true
            };
            
            this.clients.set(clientId, client);
            console.log(`🔌 WebSocket client connected: ${clientId}`);
            
            // Setup ping-pong for connection health
            ws.on('pong', () => {
                client.isAlive = true;
            });
            
            // Handle messages from client
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    await this.handleClientMessage(client, data);
                } catch (error) {
                    console.error('Error handling WebSocket message:', error);
                    this.sendError(ws, error.message);
                }
            });
            
            // Handle client disconnect
            ws.on('close', () => {
                console.log(`🔌 WebSocket client disconnected: ${clientId}`);
                this.clients.delete(clientId);
            });
            
            ws.on('error', (error) => {
                console.error(`WebSocket error for client ${clientId}:`, error);
            });
            
            // Send initial connection confirmation
            this.send(ws, {
                type: 'connected',
                clientId: clientId
            });
        });

        // Setup heartbeat interval
        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                const client = Array.from(this.clients.values()).find(c => c.ws === ws);
                if (client) {
                    if (!client.isAlive) {
                        console.log(`Terminating inactive client: ${client.id}`);
                        ws.terminate();
                        this.clients.delete(client.id);
                        return;
                    }
                    client.isAlive = false;
                    ws.ping();
                }
            });
        }, 30000);
    }

    setupSessionListeners() {
        // Listen for container events
        this.sessionManager.on('containerBooting', (sessionId, log) => {
            this.broadcastToSession(sessionId, {
                type: 'containerBooting',
                log: log
            });
        });

        this.sessionManager.on('containerReady', (sessionId) => {
            this.broadcastToSession(sessionId, {
                type: 'containerReady'
            });
        });

        this.sessionManager.on('containerError', (sessionId, error, logs) => {
            this.broadcastToSession(sessionId, {
                type: 'containerError',
                error: error,
                logs: logs
            });
        });

        // Listen for Claude events from SessionManager
        this.sessionManager.on('claudeMessage', (sessionId, message) => {
            this.broadcastToSession(sessionId, {
                type: 'claudeMessage',
                message: message
            });
        });

        this.sessionManager.on('claudeStatistics', (sessionId, statistics) => {
            this.broadcastToSession(sessionId, {
                type: 'claudeStatistics',
                statistics: statistics
            });
        });

        this.sessionManager.on('claudePartial', (sessionId, partial) => {
            this.broadcastToSession(sessionId, {
                type: 'claudePartial',
                content: partial.content
            });
        });

        this.sessionManager.on('claudeError', (sessionId, error) => {
            this.broadcastToSession(sessionId, {
                type: 'claudeError',
                error: error.error || error.message
            });
        });
    }

    async handleClientMessage(client, data) {
        console.log(`📨 Received message type: ${data.type}`);
        
        switch (data.type) {
            case 'connect':
                await this.handleConnect(client, data);
                break;
                
            case 'executeCommand':
                await this.handleExecuteCommand(client, data);
                break;
                
            case 'createSession':
                await this.handleCreateSession(client, data);
                break;
                
            case 'stopSession':
                await this.handleStopSession(client, data);
                break;
                
            case 'listSessions':
                await this.handleListSessions(client);
                break;
                
            case 'getSessionInfo':
                await this.handleGetSessionInfo(client, data);
                break;
                
            default:
                console.warn(`Unknown message type: ${data.type}`);
        }
    }

    async handleConnect(client, data) {
        const { sessionId } = data;
        
        if (!sessionId) {
            this.sendError(client.ws, 'Session ID required');
            return;
        }
        
        const session = this.sessionManager.getSession(sessionId);
        if (!session) {
            this.sendError(client.ws, 'Session not found');
            return;
        }
        
        client.sessionId = sessionId;
        
        this.send(client.ws, {
            type: 'sessionConnected',
            sessionId: sessionId,
            claudeSessionId: session.claudeSessionId
        });
        
        console.log(`✅ Client ${client.id} connected to session ${sessionId}`);
    }

    async handleExecuteCommand(client, data) {
        console.log('🎯 handleExecuteCommand called with:', data);
        const { sessionId, prompt, claudeSessionId } = data;
        
        if (!sessionId || !prompt) {
            console.error('❌ Missing sessionId or prompt');
            this.sendError(client.ws, 'Session ID and prompt required');
            return;
        }
        
        console.log(`🚀 Executing Claude command for session ${sessionId}: "${prompt}"`);
        
        try {
            // Execute Claude command
            const result = await this.sessionManager.executeClaudeCommand(sessionId, prompt, {
                claudeSessionId: claudeSessionId
            });
            
            // Send completion notification
            this.send(client.ws, {
                type: 'claudeComplete',
                sessionId: result.sessionId,
                statistics: result.statistics
            });
            
            // Send the session ID if it's new
            if (result.sessionId && !claudeSessionId) {
                this.send(client.ws, {
                    type: 'claudeSessionId',
                    sessionId: result.sessionId
                });
            }
            
        } catch (error) {
            console.error('Error executing Claude command:', error);
            this.sendError(client.ws, error.message);
        }
    }

    async handleCreateSession(client, data) {
        try {
            const result = await this.sessionManager.createSession(data.config || {});
            
            if (result.success) {
                this.send(client.ws, {
                    type: 'sessionCreated',
                    session: result.session
                });
            } else {
                this.sendError(client.ws, result.error);
            }
        } catch (error) {
            console.error('Error creating session:', error);
            this.sendError(client.ws, error.message);
        }
    }

    async handleStopSession(client, data) {
        const { sessionId, force } = data;
        
        if (!sessionId) {
            this.sendError(client.ws, 'Session ID required');
            return;
        }
        
        try {
            const result = await this.sessionManager.stopSession(sessionId, force);
            
            if (result.success) {
                this.send(client.ws, {
                    type: 'sessionStopped',
                    sessionId: sessionId
                });
            } else {
                this.sendError(client.ws, result.error);
            }
        } catch (error) {
            console.error('Error stopping session:', error);
            this.sendError(client.ws, error.message);
        }
    }

    async handleListSessions(client) {
        try {
            const sessions = this.sessionManager.getAllSessions();
            
            this.send(client.ws, {
                type: 'sessionsList',
                sessions: sessions
            });
        } catch (error) {
            console.error('Error listing sessions:', error);
            this.sendError(client.ws, error.message);
        }
    }

    async handleGetSessionInfo(client, data) {
        const { sessionId } = data;
        
        if (!sessionId) {
            this.sendError(client.ws, 'Session ID required');
            return;
        }
        
        try {
            const session = this.sessionManager.getSessionInfo(sessionId);
            
            if (session) {
                this.send(client.ws, {
                    type: 'sessionInfo',
                    session: session
                });
            } else {
                this.sendError(client.ws, 'Session not found');
            }
        } catch (error) {
            console.error('Error getting session info:', error);
            this.sendError(client.ws, error.message);
        }
    }

    broadcastToSession(sessionId, message) {
        // Send message to all clients connected to this session
        this.clients.forEach((client) => {
            if (client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
                this.send(client.ws, message);
            }
        });
    }

    broadcast(message) {
        // Send message to all connected clients
        this.wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                this.send(ws, message);
            }
        });
    }

    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    sendError(ws, error) {
        this.send(ws, {
            type: 'error',
            error: error
        });
    }

    generateClientId() {
        return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    async shutdown() {
        console.log('🔌 Shutting down WebSocket service...');
        
        // Clear heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        // Close all client connections
        this.clients.forEach((client) => {
            client.ws.close();
        });
        
        // Close WebSocket server
        await new Promise((resolve) => {
            this.wss.close(() => {
                console.log('✅ WebSocket server closed');
                resolve();
            });
        });
    }
}

module.exports = ClaudeWebSocketService;