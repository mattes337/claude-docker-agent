#!/bin/bash

# Claude Docker Agent Startup Script

set -e

echo "🚀 Starting Claude Docker Agent..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "📝 Please edit .env file and set your CLAUDE_API_KEY"
    echo "   Then run this script again."
    exit 1
fi

# Source environment variables
source .env

# Check if Claude API key is set
if [ -z "$CLAUDE_API_KEY" ] || [ "$CLAUDE_API_KEY" = "your_claude_api_key_here" ]; then
    echo "❌ CLAUDE_API_KEY is not set in .env file"
    echo "   Please set your Claude API key and try again."
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p workspaces
mkdir -p logs

# Check if session image exists
if ! docker image inspect claude-session:latest > /dev/null 2>&1; then
    echo "🔨 Building session base image..."
    docker build -f Dockerfile.session -t claude-session:latest .
else
    echo "✅ Session base image already exists"
fi

# Check if Docker network exists
if ! docker network inspect claude-network > /dev/null 2>&1; then
    echo "🌐 Creating Docker network..."
    docker network create claude-network
else
    echo "✅ Docker network already exists"
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the application
echo "🚀 Starting Claude Docker Agent..."
echo "🌐 Web interface will be available at http://localhost:${PORT:-3000}"
echo "📊 Health check: http://localhost:${PORT:-3000}/health"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm start
