const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const SessionManager = require('./services/SessionManager');
const DockerService = require('./services/DockerService');
const WebSocketService = require('./services/WebSocketService');
const { errorHandler, notFound } = require('./middleware/errorHandlers');

class ClaudeDockerAgent {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.port = process.env.PORT || 3000;
        
        // Initialize services
        this.dockerService = new DockerService();
        this.sessionManager = new SessionManager(this.dockerService);
        this.wsService = new WebSocketService(this.server, this.sessionManager);
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    connectSrc: ["'self'", "ws:", "wss:"]
                }
            }
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // limit each IP to 100 requests per windowMs
            message: 'Too many requests from this IP'
        });
        this.app.use('/api/', limiter);

        // General middleware
        this.app.use(compression());
        this.app.use(morgan('combined'));
        this.app.use(cors({
            origin: process.env.CORS_ORIGIN || '*',
            credentials: true
        }));
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));

        // Serve React build files
        this.app.use(express.static(path.join(__dirname, '../frontend/build')));
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                sessions: this.sessionManager.getSessionCount(),
                containers: this.dockerService.getContainerCount()
            });
        });

        // API routes
        this.app.use('/api/sessions', require('./routes/sessions')(this.sessionManager));
        this.app.use('/api/containers', require('./routes/containers')(this.dockerService));
        this.app.use('/api/system', require('./routes/system')(this.dockerService, this.sessionManager));

        // Serve frontend for all other routes
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
        });
    }

    setupErrorHandling() {
        this.app.use(notFound);
        this.app.use(errorHandler);
    }

    async start() {
        try {
            // Initialize Docker service
            await this.dockerService.initialize();
            console.log('✅ Docker service initialized');

            // Start server
            this.server.listen(this.port, () => {
                console.log(`🚀 Claude Docker Agent running on port ${this.port}`);
                console.log(`📁 Workspaces directory: ${this.sessionManager.workspacesDir}`);
                console.log(`🐳 Docker API version: ${this.dockerService.getVersion()}`);
                console.log(`🌐 WebSocket server ready`);
            });

            // Graceful shutdown
            process.on('SIGTERM', () => this.shutdown());
            process.on('SIGINT', () => this.shutdown());

        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }

    async shutdown() {
        console.log('🛑 Shutting down gracefully...');
        
        try {
            // Stop all sessions
            await this.sessionManager.stopAllSessions();
            console.log('✅ All sessions stopped');

            // Close WebSocket connections
            this.wsService.close();
            console.log('✅ WebSocket connections closed');

            // Close server
            this.server.close(() => {
                console.log('✅ Server closed');
                process.exit(0);
            });

        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    }
}

// Start the application
if (require.main === module) {
    const app = new ClaudeDockerAgent();
    app.start();
}

module.exports = ClaudeDockerAgent;
