# browserd

A cloud browser service that runs headful Chromium in a Docker container, providing live visual streaming via CDP screencast and remote control through a multiplexed WebSocket.

## Features

- **Live Video Streaming** - Real-time JPEG frames via CDP screencast at configurable quality/FPS
- **Remote Input Control** - Mouse and keyboard events dispatched via CDP
- **Playwright RPC** - Full Playwright command execution (navigate, click, type, etc.)
- **WebSocket Protocol** - Single multiplexed connection for frames, commands, and input
- **Session Management** - REST API for creating and managing browser sessions
- **Health Endpoints** - Kubernetes-compatible liveness and readiness probes
- **Web Viewer** - Built-in HTML/Canvas viewer for testing and debugging

## Installation

```bash
# Install dependencies
bun install

# Or with npm
npm install
```

## Quick Start

### Running the Server

```bash
# Development mode
bun run dev

# Production mode
bun run start
```

The server starts on `http://localhost:3000` by default.

### Viewing the Browser

Open `http://localhost:3000/` in your browser to see the live viewer with mouse/keyboard control.

### Connecting via WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'frame') {
    // Display JPEG frame
    const img = new Image();
    img.src = `data:image/jpeg;base64,${msg.data}`;
  }

  if (msg.type === 'result') {
    // Command result
    console.log('Command result:', msg);
  }
};

// Send a navigation command
ws.send(JSON.stringify({
  type: 'cmd',
  id: 'nav-1',
  method: 'navigate',
  params: { url: 'https://example.com' }
}));
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server hostname |
| `HEADLESS` | `false` | Run browser in headless mode |
| `VIEWPORT_WIDTH` | `1280` | Browser viewport width |
| `VIEWPORT_HEIGHT` | `720` | Browser viewport height |
| `DEFAULT_URL` | `about:blank` | Initial page URL |
| `COMMAND_TIMEOUT` | `30000` | Default command timeout (ms) |
| `USE_HTTPS` | `false` | Use HTTPS in session URLs |

## HTTP API

### Health Endpoints

```bash
# Full health status
GET /health
GET /healthz

# Liveness probe (always returns 200 if server is running)
GET /livez

# Readiness probe (returns 200 only if browser is ready)
GET /readyz
```

### Sessions API

```bash
# Create a new session
POST /api/sessions
Content-Type: application/json

{
  "viewport": { "width": 1920, "height": 1080 }  // optional
}

# Response: 201 Created
{
  "id": "session-1234567890-abc123",
  "status": "ready",
  "wsUrl": "ws://localhost:3000/ws",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "lastActivity": "2024-01-01T00:00:00.000Z",
  "viewport": { "width": 1920, "height": 1080 }
}

# List all sessions
GET /api/sessions

# Get a specific session
GET /api/sessions/:id

# Delete a session
DELETE /api/sessions/:id
```

### Viewer

```bash
# HTML viewer with live streaming and controls
GET /
GET /viewer
```

## WebSocket Protocol

Connect to `ws://localhost:3000/ws` for bidirectional communication.

### Client → Server Messages

#### Command Message
Execute a Playwright command:

```json
{
  "type": "cmd",
  "id": "unique-id",
  "method": "navigate",
  "params": { "url": "https://example.com" }
}
```

#### Input Message
Send mouse/keyboard input:

```json
{
  "type": "input",
  "device": "mouse",
  "action": "click",
  "x": 100,
  "y": 200,
  "button": "left"
}
```

```json
{
  "type": "input",
  "device": "key",
  "action": "press",
  "key": "Enter",
  "code": "Enter"
}
```

#### Ping Message
Keep-alive ping:

```json
{
  "type": "ping",
  "t": 1704067200000
}
```

### Server → Client Messages

#### Frame Message
JPEG video frame:

```json
{
  "type": "frame",
  "data": "<base64-encoded-jpeg>",
  "format": "jpeg",
  "viewport": { "w": 1280, "h": 720, "dpr": 1 },
  "ts": 1704067200000
}
```

#### Result Message
Command execution result:

```json
{
  "type": "result",
  "id": "unique-id",
  "ok": true,
  "result": { "url": "https://example.com" }
}
```

```json
{
  "type": "result",
  "id": "unique-id",
  "ok": false,
  "error": {
    "code": "TIMEOUT",
    "message": "Waiting for selector '#missing' timed out"
  }
}
```

#### Event Message
System events:

```json
{
  "type": "event",
  "name": "ready",
  "data": { "viewport": { "w": 1280, "h": 720, "dpr": 1 } }
}
```

#### Pong Message
Response to ping:

```json
{
  "type": "pong",
  "t": 1704067200000
}
```

## Available Commands

| Method | Params | Description |
|--------|--------|-------------|
| `navigate` | `{ url, timeout?, waitUntil? }` | Navigate to URL |
| `click` | `{ selector, timeout? }` | Click element |
| `dblclick` | `{ selector, timeout? }` | Double-click element |
| `type` | `{ selector, text, delay? }` | Type text (appends) |
| `fill` | `{ selector, value }` | Fill input (replaces) |
| `press` | `{ selector?, key }` | Press keyboard key |
| `hover` | `{ selector, timeout? }` | Hover over element |
| `scroll` | `{ selector?, x?, y? }` | Scroll element or page |
| `waitForSelector` | `{ selector, state?, timeout? }` | Wait for element |
| `evaluate` | `{ expression }` | Execute JavaScript |
| `screenshot` | `{ type?, quality?, fullPage?, selector? }` | Take screenshot |
| `setViewport` | `{ width, height }` | Resize viewport |
| `goBack` | `{}` | Navigate back |
| `goForward` | `{}` | Navigate forward |
| `reload` | `{}` | Reload page |

## Input Events

### Mouse Actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `move` | Move cursor | `x`, `y` |
| `down` | Press button | `x`, `y`, `button?` |
| `up` | Release button | `x`, `y`, `button?` |
| `click` | Click (down+up) | `x`, `y`, `button?` |
| `dblclick` | Double click | `x`, `y`, `button?` |
| `wheel` | Scroll wheel | `x`, `y`, `deltaX?`, `deltaY?` |

### Keyboard Actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `down` | Key down | `key`, `code` |
| `up` | Key up | `key`, `code` |
| `press` | Key press (down+up) | `key`, `code`, `text?` |

### Modifiers

All input events support modifiers:

```json
{
  "modifiers": {
    "ctrl": true,
    "shift": false,
    "alt": false,
    "meta": false
  }
}
```

## Local Container Testing

The easiest way to test browserd locally is using the sandbox container scripts.

### Prerequisites

- Docker and Docker Compose installed
- `sandbox-node:24-dev` base image available (or modify Dockerfile to use another base)

### Quick Start

```bash
# Start the container (first run installs Chromium, takes ~1-2 min)
bun run container:start

# Run all tests
bun run container:test

# Or run specific test suites
bun run container:test:unit         # Unit tests only
bun run container:test:integration  # Integration tests (browser required)
bun run container:test:e2e          # End-to-end tests

# Start the server and view in browser
bun run container:serve
# Open http://localhost:3000/ in your browser

# Open a shell in the container
bun run container:shell        # As root
bun run container:shell --user # As vercel-sandbox user

# Stop the container
bun run container:stop
bun run container:stop --clean # Also remove volumes
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `./scripts/container-start.sh` | Start container, wait for Chromium bootstrap |
| `./scripts/container-stop.sh` | Stop container (use `--clean` to remove volumes) |
| `./scripts/container-shell.sh` | Open shell (use `--user` for vercel-sandbox) |
| `./scripts/container-serve.sh` | Start browserd server on port 3000 |
| `./scripts/container-test.sh` | Run tests (args: `unit`, `integration`, `e2e`, or pattern) |

### Server Options

```bash
# Custom initial URL
./scripts/container-serve.sh --url=https://google.com

# Headless mode
./scripts/container-serve.sh --headless

# Custom port (also update docker-compose.yml ports)
./scripts/container-serve.sh --port=3001
```

## Docker Deployment

### Using Docker Compose

```yaml
version: '3.8'

services:
  browserd:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - HEADLESS=false
      - VIEWPORT_WIDTH=1280
      - VIEWPORT_HEIGHT=720
    # Required for headful browser
    volumes:
      - /tmp/.X11-unix:/tmp/.X11-unix
    environment:
      - DISPLAY=:99
```

### Running in Container

```bash
# Build the image
docker build -t browserd .

# Run with default settings
docker run -p 3000:3000 browserd

# Run with custom viewport
docker run -p 3000:3000 \
  -e VIEWPORT_WIDTH=1920 \
  -e VIEWPORT_HEIGHT=1080 \
  browserd
```

## Development

### Project Structure

```
src/
├── index.ts                 # Package exports
├── api/
│   └── sessions.ts          # Session management API
├── client/
│   └── viewer-template.ts   # HTML/JS viewer generator
├── protocol/
│   ├── types.ts             # WebSocket message types
│   ├── commands.ts          # RPC command definitions
│   └── input-mapper.ts      # Coordinate scaling utilities
└── server/
    ├── index.ts             # Main server entry
    ├── browser-manager.ts   # Chromium lifecycle
    ├── cdp-session.ts       # CDP screencast & input
    ├── command-queue.ts     # Serialized command execution
    ├── ws-handler.ts        # WebSocket message routing
    └── health.ts            # Health check endpoints

tests/
├── helpers/
│   ├── setup.ts             # Test environment setup
│   └── ws-client.ts         # WebSocket test client
├── integration/             # Integration tests (require browser)
│   ├── api.test.ts
│   ├── browser.test.ts
│   ├── commands.test.ts
│   ├── input.test.ts
│   └── screencast.test.ts
└── e2e/
    └── full-flow.test.ts    # End-to-end tests
```

### Scripts

```bash
# Development server with hot reload
bun run dev

# Production server
bun run start

# Type checking
bun run check-types

# Run all tests
bun run test

# Run unit tests only (no browser required)
bun test src/

# Run integration tests (requires browser/container)
bun test tests/
```

### Testing

Unit tests run on any platform:

```bash
bun test src/
```

Integration and E2E tests require a browser environment (Docker container with Xvfb):

```bash
# In container
bun test tests/
```

Tests automatically skip when browser support is not available.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Viewer     │  │    SDK       │  │   Custom     │       │
│  │  (Canvas)    │  │   Client     │  │   Client     │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                 │
│                    WebSocket Connection                     │
└───────────────────────────┼─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                      browserd Server                        │
│                           │                                 │
│  ┌────────────────────────┴────────────────────────┐       │
│  │                   WSHandler                      │       │
│  │  • Route messages (frame/cmd/input/ping)        │       │
│  │  • Broadcast frames to clients                   │       │
│  │  • Manage client connections                     │       │
│  └──────────┬─────────────────────────┬────────────┘       │
│             │                         │                     │
│  ┌──────────┴──────────┐   ┌─────────┴─────────┐          │
│  │   CDPSessionManager │   │   CommandQueue    │          │
│  │  • Screencast       │   │  • Serialize cmds │          │
│  │  • Input dispatch   │   │  • Execute via PW │          │
│  └──────────┬──────────┘   └─────────┬─────────┘          │
│             │                         │                     │
│  ┌──────────┴─────────────────────────┴────────────┐       │
│  │                 BrowserManager                   │       │
│  │  • Launch/close Chromium                         │       │
│  │  • Manage context and page                       │       │
│  └──────────────────────┬──────────────────────────┘       │
│                         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   Chromium (headful)  │
              │   via Playwright      │
              └───────────────────────┘
```

## Error Codes

| Code | Description |
|------|-------------|
| `UNKNOWN_METHOD` | Unrecognized command method |
| `INVALID_PARAMS` | Missing or invalid parameters |
| `TIMEOUT` | Operation timed out |
| `SELECTOR_ERROR` | Element not found |
| `NAVIGATION_ERROR` | Navigation failed |
| `EVALUATION_ERROR` | JavaScript evaluation failed |
| `SCREENSHOT_ERROR` | Screenshot capture failed |
| `BROWSER_ERROR` | Browser-level error |
| `INTERNAL_ERROR` | Unexpected server error |

## License

MIT
