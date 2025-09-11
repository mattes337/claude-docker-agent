const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
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

        // Trust proxy for rate limiting (fixes X-Forwarded-For header warning)
        this.app.set('trust proxy', 1);

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

        // Serve frontend for all other routes (only if not an API route)
        this.app.get('*', (req, res, next) => {
            // Don't serve frontend for API routes
            if (req.path.startsWith('/api/')) {
                return next();
            }

            // Check if frontend build exists
            const frontendPath = path.join(__dirname, '../frontend/build/index.html');
            if (fs.existsSync(frontendPath)) {
                res.sendFile(frontendPath);
            } else {
                // Frontend not built, return 404
                next();
            }
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
            this.server.listen(this.port, '0.0.0.0', () => {
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
            // Only exit if not in test environment
            if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
                process.exit(1);
            }
            throw error;
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
            if (this.server) {
                return new Promise((resolve) => {
                    this.server.close(() => {
                        console.log('✅ Server closed');
                        // Only exit if not in test environment
                        if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
                            process.exit(0);
                        }
                        resolve();
                    });
                });
            }

        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            // Only exit if not in test environment
            if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
                process.exit(1);
            }
            throw error;
        }
    }
}

// Start the application
if (require.main === module) {
    const app = new ClaudeDockerAgent();
    app.start();
}

module.exports = ClaudeDockerAgent;
