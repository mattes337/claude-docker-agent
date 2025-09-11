#!/bin/bash

# Claude Docker Agent Cleanup Script

set -e

echo "🧹 Cleaning up Claude Docker Agent resources..."

# Stop and remove all session containers
echo "🛑 Stopping session containers..."
docker ps -a --filter "name=claude-session-" --format "{{.Names}}" | xargs -r docker stop
docker ps -a --filter "name=claude-session-" --format "{{.Names}}" | xargs -r docker rm

# Stop main application if running
echo "🛑 Stopping main application..."
docker stop claude-docker-agent 2>/dev/null || true
docker rm claude-docker-agent 2>/dev/null || true

# Remove Docker network
echo "🌐 Removing Docker network..."
docker network rm claude-network 2>/dev/null || true

# Clean up dangling images
echo "🗑️  Removing dangling images..."
docker image prune -f

# Optional: Remove all Claude Docker Agent images
read -p "🗑️  Remove all Claude Docker Agent images? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker rmi claude-session:latest 2>/dev/null || true
    docker rmi claude-docker-agent:latest 2>/dev/null || true
    echo "✅ Images removed"
fi

# Optional: Remove workspaces
read -p "🗑️  Remove all workspace data? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf workspaces/*
    echo "✅ Workspaces cleaned"
fi

echo "✅ Cleanup completed!"
