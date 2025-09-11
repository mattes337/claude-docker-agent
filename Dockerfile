# Claude Docker Agent - Main Application
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    git \
    docker-cli \
    curl \
    bash

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY frontend/ ./frontend/

# Build frontend
RUN cd frontend && npm ci && npm run build

# Create workspaces directory
RUN mkdir -p /app/workspaces

# Create non-root user
RUN addgroup -g 1001 -S claude && \
    adduser -S claude -u 1001 -G claude

# Set permissions
RUN chown -R claude:claude /app

# Switch to non-root user
USER claude

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "src/server.js"]
