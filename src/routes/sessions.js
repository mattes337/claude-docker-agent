const express = require('express');
const { body, param, validationResult } = require('express-validator');

module.exports = (sessionManager) => {
    const router = express.Router();

    // Validation middleware
    const handleValidationErrors = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }
        next();
    };

    // Get all sessions
    router.get('/', (req, res) => {
        try {
            const sessions = sessionManager.getAllSessions();
            res.json({
                success: true,
                sessions,
                count: sessions.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Manual cleanup of stopped sessions
    router.post('/cleanup/stopped',
        async (req, res) => {
            try {
                await sessionManager.cleanupStoppedSessions();
                
                res.json({
                    success: true,
                    message: 'Cleanup completed successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Force cleanup of orphaned containers
    router.post('/cleanup/orphaned',
        async (req, res) => {
            try {
                await sessionManager.forceCleanupOrphanedContainers();
                
                res.json({
                    success: true,
                    message: 'Orphaned containers cleaned up successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get cleanup statistics
    router.get('/cleanup/stats',
        async (req, res) => {
            try {
                const totalSessions = sessionManager.getSessionCount();
                const allSessions = sessionManager.getAllSessions();
                const stoppedSessions = allSessions.filter(s => s.status === 'stopped' || s.state === 'stopped');
                
                // Get Docker container stats
                const containers = await sessionManager.dockerService.docker.listContainers({ all: true });
                const claudeContainers = containers.filter(container => 
                    container.Names.some(name => name.includes('claude-session-'))
                );
                
                const runningContainers = claudeContainers.filter(c => c.State === 'running');
                const stoppedContainers = claudeContainers.filter(c => c.State === 'exited');
                
                res.json({
                    success: true,
                    stats: {
                        totalSessions,
                        stoppedSessions: stoppedSessions.length,
                        runningSessions: totalSessions - stoppedSessions.length,
                        totalContainers: claudeContainers.length,
                        runningContainers: runningContainers.length,
                        stoppedContainers: stoppedContainers.length,
                        lastCleanup: new Date().toISOString()
                    }
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get specific session
    router.get('/:id', 
        param('id').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        (req, res) => {
            try {
                const session = sessionManager.getSessionInfo(req.params.id);
                
                if (!session) {
                    return res.status(404).json({
                        success: false,
                        error: 'Session not found'
                    });
                }
                
                res.json({
                    success: true,
                    session
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get session output
    router.get('/:id/output',
        param('id').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        (req, res) => {
            try {
                const session = sessionManager.getSession(req.params.id);
                
                if (!session) {
                    return res.status(404).json({
                        success: false,
                        error: 'Session not found'
                    });
                }
                
                const { lines, offset } = req.query;
                let output = session.output;
                
                // Filter out system setup messages that aren't relevant for chat interface
                if (Array.isArray(output)) {
                    output = output.filter(item => {
                        const type = item.type || 'output';
                        
                        // Hide system setup messages that aren't relevant for chat
                        const hideTypes = ['system', 'git'];
                        if (hideTypes.includes(type)) {
                            // But keep important system messages (errors, warnings, etc.)
                            const content = item.data || '';
                            const keepPatterns = ['error', 'warning', 'failed', 'terminated', 'completed', 'stopped'];
                            const shouldKeep = keepPatterns.some(pattern => 
                                content.toLowerCase().includes(pattern)
                            );
                            return shouldKeep;
                        }
                        
                        return true;
                    });
                }
                
                // Apply offset if specified
                if (offset && !isNaN(offset)) {
                    output = output.slice(parseInt(offset));
                }
                
                // Limit lines if specified
                if (lines && !isNaN(lines)) {
                    output = output.slice(-parseInt(lines));
                }
                
                // Convert array of output objects to string for frontend
                const outputString = Array.isArray(output) 
                    ? output.map(item => item.data || item).join('')
                    : output;
                
                res.json({
                    success: true,
                    output: outputString,
                    rawOutput: Array.isArray(output) ? output : null, // Keep raw for type info
                    totalLines: session.output.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get Docker container logs for session
    router.get('/:id/logs',
        param('id').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                const session = sessionManager.getSession(req.params.id);
                
                if (!session) {
                    return res.status(404).json({
                        success: false,
                        error: 'Session not found'
                    });
                }
                
                const { follow, tail = 100, since, timestamps } = req.query;
                
                if (follow === 'true') {
                    // For streaming logs, set appropriate headers
                    res.setHeader('Content-Type', 'text/plain');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    
                    const logStream = await sessionManager.dockerService.getContainerLogs(req.params.id, {
                        follow: true,
                        tail: parseInt(tail),
                        since,
                        timestamps: timestamps === 'true'
                    });
                    
                    // Pipe the log stream to the response
                    logStream.pipe(res);
                    
                    // Handle client disconnect
                    req.on('close', () => {
                        logStream.destroy();
                    });
                } else {
                    // For static logs, return as JSON
                    const logStream = await sessionManager.dockerService.getContainerLogs(req.params.id, {
                        follow: false,
                        tail: parseInt(tail),
                        since,
                        timestamps: timestamps === 'true'
                    });
                    
                    let logs = '';
                    logStream.on('data', (chunk) => {
                        logs += chunk.toString();
                    });
                    
                    logStream.on('end', () => {
                        res.json({
                            success: true,
                            logs,
                            sessionId: req.params.id
                        });
                    });
                    
                    logStream.on('error', (error) => {
                        res.status(500).json({
                            success: false,
                            error: error.message
                        });
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Create new session
    router.post('/',
        [
            body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
            body('repoUrl').optional().isURL().withMessage('Invalid repository URL'),
            body('branch').optional().isString().trim().isLength({ min: 1, max: 100 }),
            body('newBranchName').optional().isString().trim().isLength({ min: 1, max: 100 }),
            body('memory').optional().isInt({ min: 128 * 1024 * 1024, max: 8 * 1024 * 1024 * 1024 }),
            body('cpuShares').optional().isInt({ min: 128, max: 4096 }),
            body('env').optional().isArray(),
            body('claudeArgs').optional().isArray()
        ],
        handleValidationErrors,
        async (req, res) => {
            try {
                const config = {
                    name: req.body.name,
                    repoUrl: req.body.repoUrl,
                    branch: req.body.branch || 'main',
                    newBranchName: req.body.newBranchName,
                    memory: req.body.memory,
                    cpuShares: req.body.cpuShares,
                    env: req.body.env || [],
                    claudeArgs: req.body.claudeArgs || []
                };

                const result = await sessionManager.createSession(config);
                
                if (result.success) {
                    res.status(201).json(result);
                } else {
                    res.status(400).json(result);
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Execute command in session
    router.post('/:id/execute',
        [
            param('id').isUUID().withMessage('Invalid session ID'),
            body('prompt').isString().trim().isLength({ min: 1 }).withMessage('Prompt is required'),
            body('options').optional().isObject()
        ],
        handleValidationErrors,
        async (req, res) => {
            try {
                const { prompt, options = {} } = req.body;
                const result = await sessionManager.executeCommand(req.params.id, prompt, options);
                
                res.json(result);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Stop session
    router.post('/:id/stop',
        [
            param('id').isUUID().withMessage('Invalid session ID'),
            body('force').optional().isBoolean()
        ],
        handleValidationErrors,
        async (req, res) => {
            try {
                const { force = false } = req.body;
                const result = await sessionManager.stopSession(req.params.id, force);
                
                res.json(result);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Delete session
    router.delete('/:id',
        param('id').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                // First stop the session
                await sessionManager.stopSession(req.params.id, true);
                
                // Then cleanup
                await sessionManager.cleanupSession(req.params.id);
                
                res.json({
                    success: true,
                    message: 'Session deleted successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get session statistics
    router.get('/:id/stats',
        param('id').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                const session = sessionManager.getSession(req.params.id);
                
                if (!session) {
                    return res.status(404).json({
                        success: false,
                        error: 'Session not found'
                    });
                }
                
                const stats = {
                    id: session.id,
                    name: session.name,
                    status: session.status,
                    state: session.state,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    uptime: session.createdAt ? Date.now() - session.createdAt.getTime() : 0,
                    outputLines: session.output.length,
                    queuedMessages: session.messageQueue.length,
                    processingMessage: session.processingMessage,
                    conversationId: session.conversationId
                };
                
                res.json({
                    success: true,
                    stats
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Clear session output
    router.post('/:id/clear',
        param('id').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        (req, res) => {
            try {
                const session = sessionManager.getSession(req.params.id);
                
                if (!session) {
                    return res.status(404).json({
                        success: false,
                        error: 'Session not found'
                    });
                }
                
                session.output = [];
                sessionManager.addOutput(req.params.id, '🧹 Output cleared\n', 'system');
                
                res.json({
                    success: true,
                    message: 'Session output cleared'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Terminate Claude process
    router.post('/:id/terminate',
        [
            param('id').isUUID().withMessage('Invalid session ID'),
            body('force').optional().isBoolean()
        ],
        handleValidationErrors,
        async (req, res) => {
            try {
                const { force = false } = req.body;
                const result = await sessionManager.terminateClaudeProcess(req.params.id, force);
                
                res.json(result);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get all Docker containers
    router.get('/containers',
        async (req, res) => {
            try {
                const containers = await sessionManager.getAllContainers();
                
                res.json({
                    success: true,
                    containers,
                    count: containers.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Remove a Docker container
    router.delete('/containers/:containerId',
        param('containerId').isLength({ min: 12 }).withMessage('Invalid container ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                const result = await sessionManager.removeContainer(req.params.containerId);
                
                if (result.success) {
                    res.json(result);
                } else {
                    res.status(500).json(result);
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    return router;
};
