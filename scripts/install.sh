#!/bin/bash
#
# Browserd Sandbox Install Script
#
# This script is meant to be run in a Vercel sandbox (or similar environment)
# to download, install, and start a browserd instance.
#
# Environment variables:
#   TARBALL_URL - URL to browserd.tar.gz (required)
#   PORT        - Port to run the server on (default: 3000)
#   HEADLESS    - Whether to run browser headless (default: true)
#
# Usage:
#   curl -fsSL https://blob.vercel-storage.com/browserd/install.sh | \
#     TARBALL_URL="https://blob.vercel-storage.com/browserd/browserd.tar.gz" \
#     PORT=3000 \
#     sh
#

set -e

# Configuration with defaults
TARBALL_URL="${TARBALL_URL:?TARBALL_URL environment variable is required}"
PORT="${PORT:-3000}"
HEADLESS="${HEADLESS:-true}"
WORK_DIR="${WORK_DIR:-/tmp/browserd-install}"

echo "=== Browserd Install Script ==="
echo "Tarball URL: $TARBALL_URL"
echo "Port: $PORT"
echo "Headless: $HEADLESS"
echo ""

# Create working directory
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Download and extract tarball
echo "Downloading browserd tarball..."
curl -fsSL "$TARBALL_URL" | tar xz

# Navigate to browserd directory
cd browserd

# Install dependencies
echo "Installing dependencies..."
if command -v bun &> /dev/null; then
  bun install --production
else
  echo "Error: bun is not installed"
  exit 1
fi

# Install Playwright browsers
echo "Installing Playwright Chromium browser..."
bunx playwright install chromium

# Start the server
echo "Starting browserd server on port $PORT..."
HEADLESS="$HEADLESS" PORT="$PORT" bun run src/server/index.ts &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server to be ready..."
MAX_WAIT=60
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -s "http://localhost:$PORT/readyz" > /dev/null 2>&1; then
    echo "browserd server is ready!"
    echo "Server PID: $SERVER_PID"
    echo "Health check: http://localhost:$PORT/health"
    echo "WebSocket: ws://localhost:$PORT/ws"
    exit 0
  fi

  # Check if server process is still running
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Error: Server process died"
    exit 1
  fi

  sleep 1
  WAITED=$((WAITED + 1))
done

echo "Error: Server did not become ready within $MAX_WAIT seconds"
exit 1
