const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const tar = require('tar-stream');
const os = require('os');

class DockerService {
    constructor() {
        this.docker = new Docker();
        this.containers = new Map();
        this.baseImage = process.env.CLAUDE_BASE_IMAGE || 'claude-session:latest';
        this.networkName = process.env.DOCKER_NETWORK || 'claude-network';
    }

    async initialize() {
        try {
            // Test Docker connection
            await this.docker.ping();
            
            // Get Docker version
            this.version = await this.docker.version();
            
            // Ensure network exists
            await this.ensureNetwork();
            
            // Build base image if it doesn't exist
            await this.ensureBaseImage();
            
            console.log('✅ Docker service initialized successfully');
        } catch (error) {
            throw new Error(`Failed to initialize Docker service: ${error.message}`);
        }
    }

    async ensureNetwork() {
        try {
            const networks = await this.docker.listNetworks();
            const networkExists = networks.some(net => net.Name === this.networkName);
            
            if (!networkExists) {
                await this.docker.createNetwork({
                    Name: this.networkName,
                    Driver: 'bridge',
                    Options: {
                        'com.docker.network.bridge.enable_icc': 'true',
                        'com.docker.network.bridge.enable_ip_masquerade': 'true'
                    }
                });
                console.log(`✅ Created Docker network: ${this.networkName}`);
            }
        } catch (error) {
            console.warn(`⚠️ Network setup warning: ${error.message}`);
        }
    }

    async ensureBaseImage() {
        try {
            const images = await this.docker.listImages();
            const imageExists = images.some(img => 
                img.RepoTags && img.RepoTags.includes(this.baseImage)
            );
            
            if (!imageExists) {
                console.log('🔨 Building base image...');
                await this.buildBaseImage();
            } else {
                console.log(`✅ Base image exists: ${this.baseImage}`);
            }
        } catch (error) {
            console.warn(`⚠️ Base image check warning: ${error.message}`);
        }
    }

    async buildBaseImage() {
        console.log('🔨 Building base image from Dockerfile.session...');

        const fs = require('fs');
        const path = require('path');

        // Read the Dockerfile.session from the project root
        const dockerfilePath = path.join(__dirname, '../../Dockerfile.session');

        if (!fs.existsSync(dockerfilePath)) {
            throw new Error('Dockerfile.session not found. Please ensure it exists in the project root.');
        }

        const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

        const pack = tar.pack();
        pack.entry({ name: 'Dockerfile' }, dockerfileContent);
        pack.finalize();

        const stream = await this.docker.buildImage(pack, {
            t: this.baseImage,
            rm: true,
            forcerm: true
        });

        return new Promise((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err, res) => {
                if (err) reject(err);
                else {
                    console.log('✅ Base image built successfully');
                    resolve(res);
                }
            }, (event) => {
                if (event.stream) {
                    process.stdout.write(event.stream);
                }
            });
        });
    }

    async createContainer(sessionId, config) {
        try {
            const containerConfig = {
                Image: this.baseImage,
                name: `claude-session-${sessionId}`,
                Env: [
                    `SESSION_ID=${sessionId}`,
                    `TERM=xterm-256color`,
                    ...config.env || []
                ],
                WorkingDir: '/workspace',
                Cmd: config.cmd || ['bash'],
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
                OpenStdin: true,
                StdinOnce: false,
                HostConfig: {
                    Memory: config.memory || 1024 * 1024 * 1024, // 1GB default
                    CpuShares: config.cpuShares || 1024,
                    NetworkMode: this.networkName,
                    Binds: config.binds || [],
                    AutoRemove: false,
                    RestartPolicy: {
                        Name: 'no'
                    },
                    LogConfig: {
                        Type: 'json-file',
                        Config: {
                            'max-size': '100m',
                            'max-file': '3'
                        }
                    }
                },
                NetworkingConfig: {
                    EndpointsConfig: {
                        [this.networkName]: {}
                    }
                }
            };

            const container = await this.docker.createContainer(containerConfig);
            this.containers.set(sessionId, container);
            
            console.log(`✅ Container created for session ${sessionId}`);
            return container;
            
        } catch (error) {
            throw new Error(`Failed to create container: ${error.message}`);
        }
    }

    async startContainer(sessionId) {
        const container = this.containers.get(sessionId);
        if (!container) {
            throw new Error(`Container not found for session ${sessionId}`);
        }

        try {
            await container.start();

            // Copy Claude credentials to container
            await this.copyClaudeCredentials(sessionId);

            console.log(`✅ Container started for session ${sessionId}`);
            return container;
        } catch (error) {
            throw new Error(`Failed to start container: ${error.message}`);
        }
    }

    async copyClaudeCredentials(sessionId) {
        const container = this.containers.get(sessionId);
        if (!container) {
            throw new Error(`Container not found for session ${sessionId}`);
        }

        try {
            console.log(`📋 Copying Claude configuration to container ${sessionId}...`);

            // Create tar archive of Claude configuration files
            const pack = tar.pack();
            const homeDir = os.homedir();
            
            // List of Claude configuration files and directories to copy
            const claudeItems = [
                '.claude',      // Directory with various Claude data
                '.claude.json', // Main configuration file
                '.claude.json.backup' // Backup configuration file
            ];
            
            let copiedAny = false;

            // Add all Claude-related files and directories
            const addDirectoryToTar = async (dirPath, tarPath = '') => {
                const items = await fs.readdir(dirPath);

                for (const item of items) {
                    const itemPath = path.join(dirPath, item);
                    const itemTarPath = tarPath ? `${tarPath}/${item}` : item;
                    const stats = await fs.stat(itemPath);

                    if (stats.isDirectory()) {
                        await addDirectoryToTar(itemPath, itemTarPath);
                    } else {
                        const content = await fs.readFile(itemPath);
                        pack.entry({ name: itemTarPath }, content);
                    }
                }
            };
            
            // Copy each Claude configuration item if it exists
            for (const item of claudeItems) {
                const itemPath = path.join(homeDir, item);
                if (await fs.pathExists(itemPath)) {
                    const stats = await fs.stat(itemPath);
                    
                    if (stats.isDirectory()) {
                        await addDirectoryToTar(itemPath, item);
                    } else {
                        const content = await fs.readFile(itemPath);
                        pack.entry({ name: item }, content);
                    }
                    copiedAny = true;
                }
            }
            
            if (!copiedAny) {
                console.warn('⚠️ No Claude configuration found. Claude CLI will need to be set up in container.');
                return;
            }

            pack.finalize();

            // Copy to container's home directory
            await container.putArchive(pack, { path: '/home/claude' });

            console.log(`✅ Claude configuration copied to container ${sessionId}`);

        } catch (error) {
            console.error(`❌ Failed to copy Claude configuration: ${error.message}`);
            // Don't throw error - container can still work without credentials for testing
        }
    }

    async stopContainer(sessionId, force = false) {
        const container = this.containers.get(sessionId);
        if (!container) {
            return; // Container doesn't exist, nothing to stop
        }

        try {
            if (force) {
                await container.kill();
            } else {
                await container.stop({ t: 10 }); // 10 second timeout
            }
            console.log(`✅ Container stopped for session ${sessionId}`);
        } catch (error) {
            if (!error.message.includes('is not running')) {
                throw new Error(`Failed to stop container: ${error.message}`);
            }
        }
    }

    async removeContainer(sessionId) {
        const container = this.containers.get(sessionId);
        if (!container) {
            return; // Container doesn't exist, nothing to remove
        }

        try {
            await container.remove({ force: true });
            this.containers.delete(sessionId);
            console.log(`✅ Container removed for session ${sessionId}`);
        } catch (error) {
            if (!error.message.includes('No such container')) {
                throw new Error(`Failed to remove container: ${error.message}`);
            }
        }
    }

    async getContainerInfo(sessionId) {
        const container = this.containers.get(sessionId);
        if (!container) {
            return null;
        }

        try {
            const info = await container.inspect();
            return {
                id: info.Id,
                name: info.Name,
                state: info.State,
                created: info.Created,
                image: info.Config.Image,
                ports: info.NetworkSettings.Ports,
                mounts: info.Mounts
            };
        } catch (error) {
            console.error(`Error getting container info: ${error.message}`);
            return null;
        }
    }

    async execCommand(sessionId, command, options = {}) {
        const container = this.containers.get(sessionId);
        if (!container) {
            throw new Error(`Container not found for session ${sessionId}`);
        }

        try {
            const exec = await container.exec({
                Cmd: Array.isArray(command) ? command : ['bash', '-c', command],
                AttachStdout: true,
                AttachStderr: true,
                AttachStdin: options.interactive || false,
                Tty: options.tty || false,
                WorkingDir: options.workingDir || '/workspace',
                User: options.user || undefined
            });

            const stream = await exec.start({
                hijack: options.interactive || false,
                stdin: options.interactive || false,
                Detach: false
            });

            return { exec, stream };
        } catch (error) {
            throw new Error(`Failed to execute command: ${error.message}`);
        }
    }

    async getContainerLogs(sessionId, options = {}) {
        const container = this.containers.get(sessionId);
        if (!container) {
            throw new Error(`Container not found for session ${sessionId}`);
        }

        try {
            const logStream = await container.logs({
                stdout: true,
                stderr: true,
                follow: options.follow || false,
                tail: options.tail || 100,
                since: options.since || undefined,
                timestamps: options.timestamps || false
            });

            return logStream;
        } catch (error) {
            throw new Error(`Failed to get container logs: ${error.message}`);
        }
    }

    async copyToContainer(sessionId, sourcePath, targetPath) {
        const container = this.containers.get(sessionId);
        if (!container) {
            throw new Error(`Container not found for session ${sessionId}`);
        }

        try {
            const pack = tar.pack();
            const stats = await fs.stat(sourcePath);
            
            if (stats.isDirectory()) {
                // TODO: Implement directory copying
                throw new Error('Directory copying not yet implemented');
            } else {
                const content = await fs.readFile(sourcePath);
                pack.entry({ name: path.basename(targetPath) }, content);
            }
            
            pack.finalize();
            await container.putArchive(pack, { path: path.dirname(targetPath) });
            
        } catch (error) {
            throw new Error(`Failed to copy to container: ${error.message}`);
        }
    }

    getContainerCount() {
        return this.containers.size;
    }

    getVersion() {
        return this.version?.Version || 'Unknown';
    }

    async cleanup() {
        console.log('🧹 Cleaning up Docker resources...');
        
        for (const [sessionId] of this.containers) {
            try {
                await this.stopContainer(sessionId, true);
                await this.removeContainer(sessionId);
            } catch (error) {
                console.error(`Error cleaning up container ${sessionId}:`, error.message);
            }
        }
        
        this.containers.clear();
        console.log('✅ Docker cleanup completed');
    }
}

module.exports = DockerService;
