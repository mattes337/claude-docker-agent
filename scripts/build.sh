#!/bin/bash

# Claude Docker Agent Build Script

set -e

echo "🔨 Building Claude Docker Agent..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Build session base image
echo "🐳 Building session base image..."
docker build -f Dockerfile.session -t claude-session:latest .

# Build main application image
echo "🐳 Building main application image..."
docker build -t claude-docker-agent:latest .

# Create Docker network if it doesn't exist
if ! docker network inspect claude-network > /dev/null 2>&1; then
    echo "🌐 Creating Docker network..."
    docker network create claude-network
fi

echo "✅ Build completed successfully!"
echo ""
echo "Available images:"
docker images | grep -E "(claude-session|claude-docker-agent)"
echo ""
echo "To start the application:"
echo "  docker-compose up -d"
echo ""
echo "Or run manually:"
echo "  docker run -d -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock claude-docker-agent:latest"
