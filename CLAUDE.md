# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Browserd is a cloud browser service with two components:
- **Browserd Server** - Hosts headful Chromium with live JPEG streaming via CDP screencast and remote control through WebSocket/SSE
- **Browserd SDK** - TypeScript client library for connecting to and controlling browserd instances

Designed for browser automation, testing, and anti-bot evasion scenarios.

## Commands

```bash
# Development
bun run dev                     # Dev server with hot reload (port 3000)
bun run start                   # Production server
bun run check-types             # TypeScript type checking

# Testing
bun run test                    # All tests
bun run test:unit               # Unit tests (no browser required)
bun run test:integration        # Integration tests (requires browser)
bun run test:e2e                # End-to-end tests
bun run test:stealth            # Anti-bot evasion tests
bun test path/to/file.test.ts   # Single test file

# Docker
bun run docker:build            # Build sandbox image
bun run docker:test             # Run all tests in container
bun run docker:shell            # Shell into container
bun run docker:serve            # Run server in container
bun run docker:serve:headed     # Headed browser in container

# Build
bun run bundle                  # Build server bundle (bundle/browserd.tar.gz)
bun run build:sdk               # Build SDK for npm (dist/sdk/)

# Code Quality
bun run lint                    # Biome linter
bun run lint:fix                # Auto-fix lint issues
```

## Architecture

```
Client (SDK/Viewer/AI Agent)
          │
    WebSocket / SSE / HTTP
          │
    ┌─────┴─────┐
    │  Server   │
    │  (Bun)    │
    └─────┬─────┘
          │
    SessionManager ─── WSHandler
          │                │
    CDPSessionManager ─── CommandQueue
          │                │
    rebrowser-playwright (stealth patches)
          │
       Chromium + Xvfb
```

## Project Structure

```
src/
├── server/                 # Browserd server
│   ├── index.ts            # Main entry (Bun.serve)
│   ├── session-manager.ts  # Multi-session management, GC
│   ├── browser-manager.ts  # Chromium lifecycle
│   ├── cdp-session.ts      # CDP screencast & input dispatch
│   ├── command-queue.ts    # Command serialization with timing
│   ├── ws-handler.ts       # WebSocket message routing
│   └── health.ts           # Health endpoints (/livez, /readyz, /health)
├── sdk/                    # Client SDK
│   ├── client.ts           # BrowserdClient class
│   ├── sandbox-manager.ts  # Sandbox lifecycle management
│   ├── create-client.ts    # Convenience factory function
│   ├── providers/          # Infrastructure adapters
│   │   ├── local.ts        # LocalProvider (manual server)
│   │   ├── docker.ts       # DockerContainerProvider (OrbStack)
│   │   ├── vercel.ts       # VercelSandboxProvider
│   │   └── sprites.ts      # SpritesSandboxProvider
│   ├── ai/                 # Vercel AI SDK integration
│   │   ├── index.ts        # createBrowserTool()
│   │   └── schema.ts       # Tool schema definition
│   └── internal/           # Connection management
│       ├── connection.ts   # WebSocket connection
│       └── sse-connection.ts # SSE fallback
├── stealth/                # Anti-detection
│   ├── profiles.ts         # Browser fingerprint profiles
│   ├── human-behavior.ts   # Mouse/keyboard emulation
│   ├── timing.ts           # Action timing delays
│   ├── scripts.ts          # Fingerprint spoofing scripts
│   └── context-bridge.ts   # rebrowser-playwright integration
├── protocol/               # Message types
│   ├── types.ts            # WebSocket message definitions
│   └── commands.ts         # Playwright method definitions
└── client/                 # Web viewer
    └── viewer-template.ts  # HTML/Canvas viewer generator
```

## Core Concepts

### Server Sessions

Sessions are isolated browser contexts with independent cookies/storage:

```bash
POST /api/sessions          # Create session
GET  /api/sessions          # List sessions
GET  /api/sessions/:id      # Get session info
DELETE /api/sessions/:id    # Destroy session
```

Each session exposes:
- `/sessions/:id/ws` - WebSocket connection
- `/sessions/:id/stream` - SSE stream (HTTP fallback)
- `/sessions/:id/input` - HTTP POST for commands (SSE mode)
- `/sessions/:id/viewer` - Browser viewer UI

### WebSocket Protocol

```javascript
// Client → Server
{ "type": "cmd", "id": "1", "method": "navigate", "params": { "url": "..." } }
{ "type": "input", "device": "mouse", "action": "click", "x": 100, "y": 200 }
{ "type": "ping", "t": timestamp }

// Server → Client
{ "type": "frame", "format": "jpeg", "data": "<base64>", "viewport": {...} }
{ "type": "result", "id": "1", "ok": true, "result": {...} }
{ "type": "event", "name": "ready", "data": {...} }
{ "type": "pong", "t": timestamp }
```

### SDK Providers

| Provider | Use Case |
|----------|----------|
| `LocalProvider` | Connect to `bun run dev` server |
| `DockerContainerProvider` | Docker containers with OrbStack DNS |
| `VercelSandboxProvider` | Vercel Sandbox infrastructure |
| `SpritesSandboxProvider` | sprites.dev cloud VMs |

### SDK Usage Pattern

```typescript
import { createClient, LocalProvider } from "browserd";

const { sandbox, manager, createSession } = await createClient({
  provider: new LocalProvider({ port: 3000 })
});

const browser = await createSession();
await browser.navigate("https://example.com");
await browser.click("button.submit");
await browser.close();
await manager.destroy(sandbox.id);
```

## Key Environment Variables

### Server
- `PORT` (3000) / `HOST` (0.0.0.0) - Server binding
- `HEADLESS` (false) - Headless mode
- `VIEWPORT_WIDTH` (1280) / `VIEWPORT_HEIGHT` (720)
- `MAX_SESSIONS` (10) - Maximum concurrent sessions
- `SESSION_IDLE_TIMEOUT` (300000) - Idle timeout (5 min)
- `SESSION_MAX_LIFETIME` (3600000) - Max lifetime (1 hour)

### Stealth
- `REBROWSER_PATCHES_RUNTIME_FIX_MODE` (alwaysIsolated) - CDP leak prevention
- `REBROWSER_PATCHES_SOURCE_URL` (jquery.min.js) - Disguise sourceURL
- `REBROWSER_PATCHES_UTILITY_WORLD_NAME` (util) - Hide utility world

## Testing Notes

- **Unit tests** (`src/**/*.test.ts`) - Run without browser
- **Integration/E2E tests** - Require Chromium, use Docker: `bun run docker:test`
- **Test setup** in `tests/helpers/setup.ts` detects browser availability
- **Stealth tests** validate anti-bot evasion against real detector scripts
- Tests auto-skip when browser support unavailable

## Important Patterns

### rebrowser-playwright

Stealth wrapper around Playwright that patches CDP leaks. Must use `alwaysIsolated` mode. Main context operations go through the context bridge (`src/stealth/context-bridge.ts`).

### Command Serialization

All Playwright commands go through `CommandQueue` to:
- Prevent race conditions
- Add human-like timing delays
- Handle errors consistently

### Human Behavior Emulation

- **Mouse Movement** - Bezier curves with micro-jitter
- **Typing** - Variable delays, typo simulation
- **Timing** - Configurable delays between actions

### Health Endpoints (Kubernetes)

- `/livez` - Always OK if server running
- `/readyz` - OK only if browser ready
- `/health` - Full status with session info

### Zero Production Dependencies

Server runs with only Bun built-ins + dev dependencies. The bundle (`bun run bundle`) creates a single deployable file.

## Sprites.dev Integration

```bash
# List sprites
sprite list

# Execute command on sprite
sprite -s <name> exec <command>

# Manage services
sprite -s <name> exec sprite-env services list
sprite -s <name> exec sprite-env services delete browserd

# Port forwarding
sprite proxy -s <name> <local>:<remote>

# Read sprite documentation
sprite -s <name> exec cat /.sprite/llm.txt
sprite -s <name> exec cat /.sprite/docs/agent-context.md
```

### Deploying to Sprites

```bash
# Build bundle
bun run bundle

# Delete existing service
sprite -s <name> exec sprite-env services delete browserd

# Run test (auto-deploys)
SPRITE_TOKEN=<token> bun scripts/test-sprites-provider.ts <name>
```

## AI Integration

The SDK includes Vercel AI SDK integration (`browserd/ai`):

```typescript
import { createBrowserTool } from "browserd/ai";
import { LocalProvider } from "browserd/providers";

const browserTool = await createBrowserTool({
  provider: new LocalProvider({ port: 3000 }),
});

// Use with AI SDK generateText/streamText
```

See `examples/browser-agent/index.ts` for complete example.

## Error Codes

| Code | Description |
|------|-------------|
| `TIMEOUT` | Operation timed out |
| `SELECTOR_ERROR` | Element not found |
| `NAVIGATION_ERROR` | Navigation failed |
| `SESSION_LIMIT_REACHED` | Max sessions exceeded |
| `SESSION_NOT_FOUND` | Session doesn't exist |
| `CONNECTION_CLOSED` | WebSocket closed |
| `COMMAND_FAILED` | Command execution failed |
