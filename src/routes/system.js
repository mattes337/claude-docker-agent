const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

module.exports = (dockerService, sessionManager) => {
    const router = express.Router();

    // Get system status
    router.get('/status', async (req, res) => {
        try {
            const dockerInfo = await dockerService.docker.info();
            const systemInfo = {
                // System information
                hostname: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                uptime: os.uptime(),
                loadavg: os.loadavg(),
                
                // Memory information
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    used: os.totalmem() - os.freemem(),
                    usage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
                },
                
                // CPU information
                cpus: os.cpus().length,
                
                // Docker information
                docker: {
                    version: dockerService.getVersion(),
                    containers: dockerInfo.Containers,
                    containersRunning: dockerInfo.ContainersRunning,
                    images: dockerInfo.Images,
                    serverVersion: dockerInfo.ServerVersion
                },
                
                // Application information
                application: {
                    nodeVersion: process.version,
                    pid: process.pid,
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                    activeSessions: sessionManager.getSessionCount(),
                    activeContainers: dockerService.getContainerCount()
                }
            };
            
            res.json({
                success: true,
                system: systemInfo,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get application metrics
    router.get('/metrics', (req, res) => {
        try {
            const sessions = sessionManager.getAllSessions();
            const sessionsByStatus = sessions.reduce((acc, session) => {
                acc[session.status] = (acc[session.status] || 0) + 1;
                return acc;
            }, {});
            
            const sessionsByState = sessions.reduce((acc, session) => {
                acc[session.state] = (acc[session.state] || 0) + 1;
                return acc;
            }, {});
            
            const metrics = {
                sessions: {
                    total: sessions.length,
                    byStatus: sessionsByStatus,
                    byState: sessionsByState,
                    averageUptime: sessions.length > 0 ? 
                        sessions.reduce((sum, s) => sum + (Date.now() - s.createdAt.getTime()), 0) / sessions.length : 0
                },
                containers: {
                    active: dockerService.getContainerCount()
                },
                system: {
                    memoryUsage: process.memoryUsage(),
                    uptime: process.uptime(),
                    cpuUsage: process.cpuUsage()
                }
            };
            
            res.json({
                success: true,
                metrics,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get workspace information
    router.get('/workspace', async (req, res) => {
        try {
            const workspacesDir = sessionManager.workspacesDir;
            const stats = await fs.stat(workspacesDir);
            
            // Get directory size (simplified)
            const getDirectorySize = async (dirPath) => {
                let size = 0;
                try {
                    const files = await fs.readdir(dirPath);
                    for (const file of files) {
                        const filePath = path.join(dirPath, file);
                        const stat = await fs.stat(filePath);
                        if (stat.isDirectory()) {
                            size += await getDirectorySize(filePath);
                        } else {
                            size += stat.size;
                        }
                    }
                } catch (error) {
                    // Ignore errors for inaccessible files
                }
                return size;
            };
            
            const totalSize = await getDirectorySize(workspacesDir);
            const sessions = await fs.readdir(workspacesDir);
            
            res.json({
                success: true,
                workspace: {
                    path: workspacesDir,
                    totalSize,
                    sessionCount: sessions.length,
                    created: stats.birthtime,
                    modified: stats.mtime
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Cleanup old sessions
    router.post('/cleanup', async (req, res) => {
        try {
            const { olderThan = 24 } = req.body; // hours
            const cutoffTime = new Date(Date.now() - olderThan * 60 * 60 * 1000);
            
            const sessions = sessionManager.getAllSessions();
            const sessionsToCleanup = sessions.filter(session => 
                session.status === 'stopped' && 
                session.createdAt < cutoffTime
            );
            
            let cleanedCount = 0;
            for (const session of sessionsToCleanup) {
                try {
                    await sessionManager.cleanupSession(session.id);
                    cleanedCount++;
                } catch (error) {
                    console.error(`Failed to cleanup session ${session.id}:`, error);
                }
            }
            
            res.json({
                success: true,
                message: `Cleaned up ${cleanedCount} old sessions`,
                cleanedSessions: cleanedCount,
                totalSessions: sessions.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get logs
    router.get('/logs', (req, res) => {
        try {
            const { level = 'info', lines = 100 } = req.query;
            
            // This is a simplified log endpoint
            // In a real implementation, you'd integrate with your logging system
            const logs = [
                {
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    message: 'System status endpoint accessed',
                    component: 'api'
                }
            ];
            
            res.json({
                success: true,
                logs,
                count: logs.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Health check with detailed information
    router.get('/health', async (req, res) => {
        try {
            const checks = {
                docker: false,
                filesystem: false,
                memory: false
            };
            
            // Check Docker
            try {
                await dockerService.docker.ping();
                checks.docker = true;
            } catch (error) {
                checks.docker = false;
            }
            
            // Check filesystem
            try {
                await fs.access(sessionManager.workspacesDir, fs.constants.W_OK);
                checks.filesystem = true;
            } catch (error) {
                checks.filesystem = false;
            }
            
            // Check memory
            const memUsage = process.memoryUsage();
            const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
            checks.memory = memPercent < 90; // Consider unhealthy if > 90% memory usage
            
            const isHealthy = Object.values(checks).every(check => check === true);
            
            res.status(isHealthy ? 200 : 503).json({
                success: isHealthy,
                status: isHealthy ? 'healthy' : 'unhealthy',
                checks,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0'
            });
        } catch (error) {
            res.status(503).json({
                success: false,
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });

    // Get configuration
    router.get('/config', (req, res) => {
        try {
            const config = {
                workspacesDir: sessionManager.workspacesDir,
                baseImage: process.env.CLAUDE_BASE_IMAGE || 'claude-session:latest',
                dockerNetwork: process.env.DOCKER_NETWORK || 'claude-network',
                port: process.env.PORT || 3000,
                nodeEnv: process.env.NODE_ENV || 'development',
                cleanupWorkspaces: process.env.CLEANUP_WORKSPACES === 'true',
                corsOrigin: process.env.CORS_ORIGIN || '*'
            };
            
            res.json({
                success: true,
                config
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
};
