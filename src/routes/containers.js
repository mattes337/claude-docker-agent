const express = require('express');
const { param, validationResult } = require('express-validator');

module.exports = (dockerService) => {
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

    // Get Docker system info
    router.get('/info', async (req, res) => {
        try {
            const info = await dockerService.docker.info();
            res.json({
                success: true,
                info: {
                    containers: info.Containers,
                    containersRunning: info.ContainersRunning,
                    containersPaused: info.ContainersPaused,
                    containersStopped: info.ContainersStopped,
                    images: info.Images,
                    serverVersion: info.ServerVersion,
                    operatingSystem: info.OperatingSystem,
                    architecture: info.Architecture,
                    memTotal: info.MemTotal,
                    cpus: info.NCPU
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get container info for specific session
    router.get('/:sessionId',
        param('sessionId').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                const containerInfo = await dockerService.getContainerInfo(req.params.sessionId);
                
                if (!containerInfo) {
                    return res.status(404).json({
                        success: false,
                        error: 'Container not found'
                    });
                }
                
                res.json({
                    success: true,
                    container: containerInfo
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Get container logs
    router.get('/:sessionId/logs',
        param('sessionId').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                const container = dockerService.containers.get(req.params.sessionId);
                
                if (!container) {
                    return res.status(404).json({
                        success: false,
                        error: 'Container not found'
                    });
                }
                
                const { tail = 100, follow = false } = req.query;
                
                const logStream = await container.logs({
                    stdout: true,
                    stderr: true,
                    tail: parseInt(tail),
                    follow: follow === 'true',
                    timestamps: true
                });
                
                if (follow === 'true') {
                    // Stream logs in real-time
                    res.setHeader('Content-Type', 'text/plain');
                    res.setHeader('Transfer-Encoding', 'chunked');
                    
                    logStream.on('data', (chunk) => {
                        res.write(chunk);
                    });
                    
                    logStream.on('end', () => {
                        res.end();
                    });
                    
                    logStream.on('error', (error) => {
                        res.status(500).end(`Error: ${error.message}`);
                    });
                } else {
                    // Return logs as JSON
                    let logs = '';
                    
                    logStream.on('data', (chunk) => {
                        logs += chunk.toString();
                    });
                    
                    logStream.on('end', () => {
                        res.json({
                            success: true,
                            logs: logs.split('\n').filter(line => line.trim())
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

    // Get container stats
    router.get('/:sessionId/stats',
        param('sessionId').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                const container = dockerService.containers.get(req.params.sessionId);
                
                if (!container) {
                    return res.status(404).json({
                        success: false,
                        error: 'Container not found'
                    });
                }
                
                const stats = await container.stats({ stream: false });
                
                // Calculate CPU percentage
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                                stats.precpu_stats.cpu_usage.total_usage;
                const systemDelta = stats.cpu_stats.system_cpu_usage - 
                                  stats.precpu_stats.system_cpu_usage;
                const cpuPercent = (cpuDelta / systemDelta) * 
                                 stats.cpu_stats.online_cpus * 100;
                
                // Calculate memory usage
                const memoryUsage = stats.memory_stats.usage;
                const memoryLimit = stats.memory_stats.limit;
                const memoryPercent = (memoryUsage / memoryLimit) * 100;
                
                res.json({
                    success: true,
                    stats: {
                        cpu: {
                            usage: cpuPercent.toFixed(2),
                            cores: stats.cpu_stats.online_cpus
                        },
                        memory: {
                            usage: memoryUsage,
                            limit: memoryLimit,
                            percent: memoryPercent.toFixed(2)
                        },
                        network: stats.networks,
                        blockIO: stats.blkio_stats,
                        timestamp: new Date().toISOString()
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

    // Execute command in container
    router.post('/:sessionId/exec',
        [
            param('sessionId').isUUID().withMessage('Invalid session ID'),
            body('command').isString().trim().isLength({ min: 1 }).withMessage('Command is required')
        ],
        handleValidationErrors,
        async (req, res) => {
            try {
                const { command, options = {} } = req.body;
                const { exec, stream } = await dockerService.execCommand(
                    req.params.sessionId, 
                    command, 
                    options
                );
                
                let output = '';
                let errorOutput = '';
                
                stream.on('data', (chunk) => {
                    const data = chunk.toString();
                    if (chunk[0] === 1) { // stdout
                        output += data.slice(8); // Remove header
                    } else if (chunk[0] === 2) { // stderr
                        errorOutput += data.slice(8); // Remove header
                    }
                });
                
                stream.on('end', async () => {
                    const result = await exec.inspect();
                    
                    res.json({
                        success: true,
                        result: {
                            exitCode: result.ExitCode,
                            stdout: output,
                            stderr: errorOutput
                        }
                    });
                });
                
                stream.on('error', (error) => {
                    res.status(500).json({
                        success: false,
                        error: error.message
                    });
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Stop container
    router.post('/:sessionId/stop',
        [
            param('sessionId').isUUID().withMessage('Invalid session ID'),
            body('force').optional().isBoolean()
        ],
        handleValidationErrors,
        async (req, res) => {
            try {
                const { force = false } = req.body;
                await dockerService.stopContainer(req.params.sessionId, force);
                
                res.json({
                    success: true,
                    message: 'Container stopped successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Remove container
    router.delete('/:sessionId',
        param('sessionId').isUUID().withMessage('Invalid session ID'),
        handleValidationErrors,
        async (req, res) => {
            try {
                await dockerService.removeContainer(req.params.sessionId);
                
                res.json({
                    success: true,
                    message: 'Container removed successfully'
                });
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
