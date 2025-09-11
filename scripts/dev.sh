#!/bin/bash

# Claude Docker Agent Development Script

set -e

echo "🚀 Starting Claude Docker Agent in development mode..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "📝 Please ensure Claude Code is authenticated (run 'claude auth' if needed)"
    echo "   Then run this script again."
    exit 1
fi

# Source environment variables
source .env

# Check if Claude credentials exist
if [ ! -d "$HOME/.claude" ]; then
    echo "❌ Claude credentials not found in ~/.claude"
    echo "   Please ensure Claude CLI is set up with your subscription."
    echo "   Run 'claude auth' to authenticate."
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
    echo "📦 Installing backend dependencies..."
    npm install
fi

if [ ! -d frontend/node_modules ]; then
    echo "📦 Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

echo ""
echo "🚀 Starting development servers..."
echo "📊 Backend API: http://localhost:3000"
echo "🌐 Frontend Dev Server: http://localhost:3001"
echo "📊 Health check: http://localhost:3000/health"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Start backend in background
npm run dev &
BACKEND_PID=$!

# Start frontend dev server
cd frontend && npm start &
FRONTEND_PID=$!

# Wait for Ctrl+C
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT

# Wait for both processes
wait
