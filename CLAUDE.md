# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browserd is a cloud browser service that runs headful Chromium in Docker containers with live visual streaming via CDP screencast and remote control through a multiplexed WebSocket. It's designed for automation, testing, and anti-bot evasion scenarios.

## Commands

```bash
# Development
bun run dev                     # Dev server with hot reload (port 3000)
bun run start                   # Production server
bun run check-types             # TypeScript type checking

# Testing
bun run test                    # Run all tests
bun run test:unit               # Unit tests only (no browser required)
bun run test:integration        # Integration tests (requires browser)
bun run test:e2e                # End-to-end tests
bun run test:stealth            # Anti-bot evasion tests
bun test path/to/file.test.ts   # Run single test file

# Docker (for tests requiring Chromium)
bun run docker:build            # Build sandbox image
bun run docker:test             # Run all tests in container
bun run docker:shell            # Shell into container for debugging

# Code Quality
bun run lint                    # Biome linter
bun run lint:fix                # Auto-fix lint issues
```

## Architecture

```
Client (SDK/Viewer)  →  WebSocket  →  Browserd Server  →  rebrowser-playwright  →  Chromium
       ↑                                    │
       └────────── JPEG frames ─────────────┘
```

### Core Components

- **`src/server/`** - HTTP/WebSocket server (Bun.serve)
  - `browser-manager.ts` - Chromium lifecycle with rebrowser-playwright stealth wrapper
  - `ws-handler.ts` - WebSocket message routing and client management
  - `cdp-session.ts` - CDP screencast streaming and input dispatch
  - `command-queue.ts` - Serializes Playwright command execution

- **`src/sdk/`** - Client SDK for connecting to browserd instances
  - `client.ts` - BrowserdClient main class
  - `sandbox-manager.ts` - Provisions and manages browser sandboxes
  - `providers/` - Infrastructure backends (local Docker, Vercel Sandbox)

- **`src/protocol/`** - WebSocket protocol definitions
  - `types.ts` - Message types (CommandMessage, InputMessage, FrameMessage)
  - `commands.ts` - Playwright method definitions

- **`src/stealth/`** - Anti-bot evasion (targets DataDome, PerimeterX, Cloudflare)
  - `human-behavior.ts` - Human-like mouse/keyboard emulation
  - `timing.ts` - Action timing with fatigue simulation
  - `profiles.ts` - Browser fingerprint profiles
  - `scripts.ts` - Canvas/WebGL/Audio fingerprint masking

### WebSocket Protocol

Client sends commands:
```json
{"id": "1", "type": "cmd", "method": "navigate", "params": {"url": "..."}}
{"type": "input", "device": "mouse", "action": "click", "x": 100, "y": 200}
```

Server sends:
```json
{"type": "frame", "format": "jpeg", "data": "<base64>", "viewport": {"w": 1280, "h": 720}}
{"id": "1", "type": "result", "ok": true, "result": {...}}
```

## Key Environment Variables

- `PORT` (3000) / `HOST` (0.0.0.0) - Server binding
- `HEADLESS` (false) - Headless mode
- `VIEWPORT_WIDTH` (1280) / `VIEWPORT_HEIGHT` (720)
- `REBROWSER_PATCHES_RUNTIME_FIX_MODE` (alwaysIsolated) - CDP leak prevention

## Testing Notes

- Unit tests (`src/**/*.test.ts`) run without a browser
- Integration/E2E tests require Chromium - use Docker: `bun run docker:test`
- Test setup in `tests/helpers/setup.ts` detects browser availability
- Stealth tests validate anti-bot evasion against real detector scripts

## Important Patterns

1. **rebrowser-playwright** - Stealth wrapper around Playwright that patches CDP leaks. Must use `alwaysIsolated` mode with context bridge for main context operations.

2. **Command Serialization** - All Playwright commands go through `CommandQueue` to prevent race conditions and add human-like timing delays.

3. **Health Endpoints** - Kubernetes-compatible: `/livez` (always OK), `/readyz` (browser ready check), `/health` (full status).

4. **Zero Production Dependencies** - The server runs with only Bun built-ins and dev dependencies.
