# Claude Docker Agent

A multi-session Docker container management system for Claude Code that enables users to run isolated Claude AI development sessions in containerized environments.

## 🚀 Features

- **Multi-Session Management**: Run multiple Claude Code sessions simultaneously
- **Docker Isolation**: Each session runs in its own isolated Docker container
- **Git Integration**: Clone and work with repositories from any Git server
- **Real-time Monitoring**: Live session output streaming and status updates
- **Auto-Resume**: Automatic session recovery after Claude usage limits
- **Web Interface**: Modern web-based dashboard for session management
- **WebSocket Communication**: Real-time updates and interactive terminals

## 🏗️ Architecture

```
[User] ←→ [Web UI] ←→ [Backend API] ←→ [Docker API] ←→ [Session Containers]
```

### Components

- **React Frontend**: Modern React-based web interface for session management
- **Backend API**: Node.js server managing Docker containers and sessions
- **Docker Engine**: Container runtime for isolated environments
- **Session Containers**: Individual containers with Claude, Git, and dev tools (Node.js, Python, .NET)

## 📋 Prerequisites

- Docker Engine 20.10+
- Node.js 18+
- Claude Code CLI (with subscription authentication - run `claude auth` to set up)
- Git (for repository cloning)
- Sufficient disk space for workspaces

## 🛠️ Installation

### Using Docker Compose (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/your-org/claude-docker-agent.git
cd claude-docker-agent
```

2. Copy environment configuration:
```bash
cp .env.example .env
```

3. Ensure Claude Code CLI is authenticated:
```bash
claude auth
```

4. Build and start the services:
```bash
docker-compose up -d
```

5. Access the web interface at `http://localhost:3000`

### Manual Installation

1. Install dependencies:
```bash
npm install
```

2. Build the React frontend:
```bash
npm run build:frontend
```

3. Build the session base image:
```bash
docker build -f Dockerfile.session -t claude-session:latest .
```

4. Ensure Claude Code CLI is authenticated:
```bash
claude auth
```

5. Set environment variables:
```bash
export WORKSPACES_DIR=./workspaces
```

6. Start the application:
```bash
npm start
```

## 🎯 Usage

### Creating a New Session

1. Click "New Session" in the web interface
2. Enter a session name
3. Optionally provide a Git repository URL and branch
4. Click "Create Session"

The system will:
- Create a new Docker container
- Clone the repository (if provided)
- Initialize Claude Code in the container
- Provide a terminal interface for interaction

### Managing Sessions

- **View Sessions**: All active sessions are listed in the sidebar
- **Switch Sessions**: Click on any session to view its terminal
- **Send Commands**: Type commands in the terminal input and press Enter
- **Stop Sessions**: Use the "Stop Session" button to terminate a session
- **Monitor Output**: Real-time output streaming from Claude Code

### API Usage

The system provides a REST API for programmatic access:

```bash
# Get all sessions
curl http://localhost:3000/api/sessions

# Create a new session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "My Session", "repoUrl": "https://github.com/user/repo.git"}'

# Execute a command
curl -X POST http://localhost:3000/api/sessions/{id}/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a simple Python script"}'
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `WORKSPACES_DIR` | Directory for session workspaces | ./workspaces |
| `CLAUDE_BASE_IMAGE` | Docker image for sessions | claude-session:latest |
| `DOCKER_NETWORK` | Docker network name | claude-network |
| `CLEANUP_WORKSPACES` | Auto-cleanup workspaces | false |

### Container Resources

Default resource limits per session:
- Memory: 1GB
- CPU Shares: 1024
- Network: Isolated bridge network

## 🔒 Security

- Container isolation prevents cross-session interference
- Resource limits prevent resource exhaustion
- Git credentials are handled securely
- API rate limiting prevents abuse
- Non-root user execution in containers

## 📊 Monitoring

### Health Checks

- Application health: `GET /health`
- System status: `GET /api/system/status`
- Metrics: `GET /api/system/metrics`

### WebSocket Events

- `session_created`: New session created
- `session_ready`: Session ready for commands
- `output`: Real-time session output
- `session_stopped`: Session terminated
- `resume_scheduled`: Auto-resume scheduled

## 🐛 Troubleshooting

### Common Issues

1. **Docker permission denied**
   ```bash
   sudo usermod -aG docker $USER
   # Logout and login again
   ```

2. **Port already in use**
   ```bash
   export PORT=3001
   npm start
   ```

3. **Claude API key issues**
   - Verify your API key is valid
   - Check rate limits and usage quotas

4. **Container startup failures**
   ```bash
   docker logs claude-docker-agent
   ```

### Logs

Application logs are available:
- Container logs: `docker logs claude-docker-agent`
- Session logs: Available through the web interface
- System logs: `GET /api/system/logs`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Claude AI for the powerful language model
- Docker for containerization technology
- The open-source community for various tools and libraries

## 📞 Support

- Create an issue for bug reports
- Check the documentation in the `docs/` directory
- Review the feature index for capabilities

---

**Note**: This is a development tool. Ensure you have proper Claude API access and understand the usage costs before deploying in production.
