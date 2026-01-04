# browserd

A cloud browser service for remote browser automation with stealth capabilities. Runs headful Chromium with live visual streaming via CDP screencast and remote control through WebSocket/SSE transports.

**Two Components:**
- **Browserd Server** - The cloud browser service that hosts Chromium sessions
- **Browserd SDK** - TypeScript client library for connecting to and controlling browserd instances

## Features

- **Live Video Streaming** - Real-time JPEG frames via CDP screencast at configurable quality/FPS
- **Remote Input Control** - Mouse and keyboard events dispatched via CDP
- **Playwright RPC** - Full Playwright command execution (navigate, click, type, etc.)
- **Multi-Session Support** - Run multiple isolated browser sessions concurrently
- **WebSocket & SSE Transports** - WebSocket for low latency, SSE fallback for HTTP-only environments
- **Stealth Mode** - Anti-bot evasion for DataDome, PerimeterX, Cloudflare (via rebrowser-playwright)
- **Human Behavior Emulation** - Realistic mouse movements, typing patterns, and timing
- **Multiple Deployment Options** - Local Docker, Vercel Sandbox, Sprites.dev, or self-hosted
- **Web Viewer** - Built-in HTML/Canvas viewer for testing and debugging
- **Health Endpoints** - Kubernetes-compatible liveness and readiness probes
- **AI Integration** - Vercel AI SDK tool for AI agent browser control

---

# Browserd Server

The browserd server hosts Chromium browser sessions and exposes them through HTTP/WebSocket/SSE APIs.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                              Clients                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │
│   │  Web Viewer  │    │  SDK Client  │    │  AI Agent    │    │
│   │  (Canvas)    │    │              │    │              │    │ 
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    │
│          │                   │                   │            │
│          └───────────────────┼───────────────────┘            │
│                              │                                │
│              WebSocket / SSE / HTTP Transport                 │
└──────────────────────────────┼────────────────────────────────┘
                               │
┌──────────────────────────────┼────────────────────────────────┐
│                        Browserd Server                        │
│                              │                                │
│   ┌──────────────────────────┴───────────────────────────┐    │
│   │                     HTTP Server                      │    │
│   │  • REST API (/api/sessions)                          │    │
│   │  • WebSocket upgrade (/sessions/:id/ws)              │    │
│   │  • SSE stream (/sessions/:id/stream)                 │    │
│   │  • Viewer UI (/sessions/:id/viewer)                  │    │
│   └───────────┬─────────────────────────────┬────────────┘    │
│               │                             │                 │
│   ┌───────────┴───────────┐   ┌─────────────┴───────────┐     │
│   │   SessionManager      │   │      WSHandler          │     │
│   │  • Session lifecycle  │   │  • Message routing      │     │
│   │  • Garbage collection │   │  • Client tracking      │     │
│   │  • Session isolation  │   │  • Frame broadcasting   │     │
│   └───────────┬───────────┘   └─────────────┬───────────┘     │
│               │                             │                 │
│   ┌───────────┴───────────┐   ┌─────────────┴───────────┐     │
│   │  CDPSessionManager    │   │     CommandQueue        │     │
│   │  • Screencast (JPEG)  │   │  • Serialize commands   │     │
│   │  • Input dispatch     │   │  • Human-like timing    │     │
│   │  • Human emulation    │   │  • Error handling       │     │
│   └───────────┬───────────┘   └─────────────┬───────────┘     │
│               │                             │                 │
│               │     rebrowser-playwright    │                 │
│   ┌───────────┴─────────────────────────────┴───────────┐     │
│   │  • Stealth patches (CDP leak prevention)            │     │
│   │  • Context bridge (alwaysIsolated mode)             │     │
│   │  • Fingerprint spoofing                             │     │
│   └─────────────────────────┬───────────────────────────┘     │
│                             │                                 │
└─────────────────────────────┼─────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │   Chromium (headful)      │
                │   + Xvfb (virtual display)│
                └───────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

Open `http://localhost:3000/` to see the web viewer.

## HTTP API

### Health Endpoints

```bash
GET /health      # Full health status (browser, sessions, memory)
GET /healthz     # Alias for /health
GET /livez       # Liveness probe (always 200 if server running)
GET /readyz      # Readiness probe (200 only if browser ready)
```

### Sessions API

```bash
# Create a new session
POST /api/sessions
Content-Type: application/json

{
  "viewport": { "width": 1920, "height": 1080 },
  "profile": "chrome-mac",
  "initialUrl": "https://example.com"
}

# Response: 201 Created
{
  "id": "sess-abc123",
  "status": "ready",
  "wsUrl": "ws://localhost:3000/sessions/sess-abc123/ws",
  "streamUrl": "http://localhost:3000/sessions/sess-abc123/stream",
  "inputUrl": "http://localhost:3000/sessions/sess-abc123/input",
  "viewerUrl": "http://localhost:3000/sessions/sess-abc123/viewer",
  "viewport": { "width": 1920, "height": 1080 },
  "createdAt": 1704067200000
}

# List all sessions
GET /api/sessions

# Get session details
GET /api/sessions/:id

# Delete a session
DELETE /api/sessions/:id
```

### Viewer Endpoints

```bash
GET /sessions/:id/viewer    # Single session viewer
GET /sessions/all           # Grid viewer for all sessions
GET /                       # Redirects to first session's viewer
```

## Transport Layers

### WebSocket (Recommended)

Connect to `ws://localhost:3000/sessions/:id/ws` for bidirectional communication.

**Client → Server Messages:**

```javascript
// Command message (execute Playwright action)
{ "type": "cmd", "id": "nav-1", "method": "navigate", "params": { "url": "https://example.com" } }

// Input message (mouse/keyboard)
{ "type": "input", "device": "mouse", "action": "click", "x": 100, "y": 200, "button": "left" }
{ "type": "input", "device": "key", "action": "press", "key": "Enter" }

// Ping (latency measurement)
{ "type": "ping", "t": 1704067200000 }
```

**Server → Client Messages:**

```javascript
// Frame message (JPEG video frame)
{ "type": "frame", "format": "jpeg", "data": "<base64>", "viewport": { "w": 1280, "h": 720, "dpr": 1 }, "timestamp": 1704067200000 }

// Result message (command response)
{ "type": "result", "id": "nav-1", "ok": true, "result": { "url": "https://example.com", "title": "Example" } }
{ "type": "result", "id": "nav-1", "ok": false, "error": { "code": "TIMEOUT", "message": "..." } }

// Event message (system events)
{ "type": "event", "name": "ready", "data": { "viewport": { "w": 1280, "h": 720 } } }

// Pong (response to ping)
{ "type": "pong", "t": 1704067200000 }
```

### Server-Sent Events (SSE)

For HTTP-only environments, use SSE for receiving frames and HTTP POST for sending input.

```bash
# Receive frames via SSE
GET /sessions/:id/stream

# Send input/commands via HTTP POST
POST /sessions/:id/input
Content-Type: application/json

{ "type": "input", "device": "mouse", "action": "click", "x": 100, "y": 200 }
```

## Available Commands

| Method | Params | Description |
|--------|--------|-------------|
| `navigate` | `{ url, timeout?, waitUntil? }` | Navigate to URL |
| `click` | `{ selector, timeout?, button?, delay? }` | Click element |
| `dblclick` | `{ selector, timeout? }` | Double-click element |
| `hover` | `{ selector, timeout? }` | Hover over element |
| `type` | `{ selector, text, delay? }` | Type text (appends) |
| `fill` | `{ selector, value }` | Fill input (replaces content) |
| `press` | `{ key }` | Press key or combination (e.g., "Control+A") |
| `waitForSelector` | `{ selector, state?, timeout? }` | Wait for element state |
| `setViewport` | `{ width, height }` | Resize viewport |
| `evaluate` | `{ expression, args? }` | Execute JavaScript |
| `screenshot` | `{ fullPage?, type?, quality? }` | Take screenshot |
| `goBack` | `{}` | Navigate back |
| `goForward` | `{}` | Navigate forward |
| `reload` | `{}` | Reload page |

## Input Events

### Mouse Actions

| Action | Description | Params |
|--------|-------------|--------|
| `move` | Move cursor | `x`, `y` |
| `down` | Press button | `x`, `y`, `button?` |
| `up` | Release button | `x`, `y`, `button?` |
| `click` | Click (down+up) | `x`, `y`, `button?` |
| `dblclick` | Double click | `x`, `y`, `button?` |
| `wheel` | Scroll wheel | `x`, `y`, `deltaX?`, `deltaY?` |

### Keyboard Actions

| Action | Description | Params |
|--------|-------------|--------|
| `down` | Key down | `key` |
| `up` | Key up | `key` |
| `press` | Key press | `key`, `text?` |

### Modifiers

All input events support modifier keys:

```json
{ "modifiers": { "ctrl": true, "shift": false, "alt": false, "meta": false } }
```

## Stealth & Anti-Detection

Browserd uses [rebrowser-playwright](https://github.com/nickmitchko/rebrowser-patches) with additional stealth features:

### Browser Profiles

| Profile | Description |
|---------|-------------|
| `chrome-mac` | Chrome 120 on macOS (default) |
| `chrome-win` | Chrome 120 on Windows 10 |
| `chrome-linux` | Chrome 120 on Linux |
| `firefox-mac` | Firefox on macOS |
| `firefox-win` | Firefox on Windows |

### Fingerprint Spoofing

- **Canvas** - Random pixel noise to prevent fingerprinting
- **WebGL** - Fake renderer/vendor strings
- **Audio** - Randomized audio context parameters
- **WebRTC** - IP leak prevention
- **Performance Timing** - Noise added to timing values
- **Screen Properties** - Consistent screen dimensions

### Human Behavior Emulation

- **Mouse Movement** - Bezier curves with micro-jitter and overshoot
- **Typing Patterns** - Variable keystroke delays, typo simulation
- **Scroll Behavior** - Chunked scrolling with variable pauses
- **Hover Micro-movements** - Small random movements while hovering
- **Action Timing** - Configurable delays between actions

### Bot Detection Blocking

Automatically blocks requests to common bot detection scripts:
- Cloudflare challenge platform
- DataDome
- PerimeterX
- reCAPTCHA (optional)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server hostname |
| `HEADLESS` | `false` | Run browser in headless mode |
| `VIEWPORT_WIDTH` | `1280` | Default viewport width |
| `VIEWPORT_HEIGHT` | `720` | Default viewport height |
| `DEFAULT_URL` | `about:blank` | Initial page URL |
| `COMMAND_TIMEOUT` | `30000` | Command timeout (ms) |
| `USE_HTTPS` | `false` | Use HTTPS in session URLs |
| `MAX_SESSIONS` | `10` | Maximum concurrent sessions |
| `SESSION_IDLE_TIMEOUT` | `300000` | Idle session timeout (5 min) |
| `SESSION_MAX_LIFETIME` | `3600000` | Max session lifetime (1 hour) |
| `SESSION_GC_INTERVAL` | `60000` | Garbage collection interval (1 min) |

### Stealth Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REBROWSER_PATCHES_RUNTIME_FIX_MODE` | `alwaysIsolated` | CDP leak prevention mode |
| `REBROWSER_PATCHES_SOURCE_URL` | `jquery.min.js` | Disguise sourceURL |
| `REBROWSER_PATCHES_UTILITY_WORLD_NAME` | `util` | Hide utility world name |

## Error Codes

| Code | Description |
|------|-------------|
| `UNKNOWN_METHOD` | Unrecognized command method |
| `INVALID_PARAMS` | Missing or invalid parameters |
| `TIMEOUT` | Operation timed out |
| `SELECTOR_ERROR` | Element not found |
| `NAVIGATION_ERROR` | Navigation failed |
| `EXECUTION_ERROR` | JavaScript evaluation failed |
| `SESSION_LIMIT_REACHED` | Maximum sessions exceeded |
| `SESSION_NOT_FOUND` | Session does not exist |

---

# Browserd SDK

TypeScript client library for connecting to browserd instances.

## Installation

```bash
# npm
npm install browserd

# bun
bun add browserd

# pnpm
pnpm add browserd
```

## Quick Start

```typescript
import { createClient, LocalProvider } from "browserd";

// Create a client with a provider
const { sandbox, createSession, manager } = await createClient({
  provider: new LocalProvider({ port: 3000 })
});

// Create a browser session
const browser = await createSession();

// Use the browser
await browser.navigate("https://example.com");
await browser.click("button.submit");
await browser.fill("input[name='email']", "user@example.com");
const screenshot = await browser.screenshot();

// Clean up
await browser.close();
await manager.destroy(sandbox.id);
```

## Providers

Providers abstract the infrastructure that runs browserd. Choose one based on your deployment:

### LocalProvider

Connects to a manually started browserd server (development).

```typescript
import { LocalProvider } from "browserd/providers";

const provider = new LocalProvider({
  host: "localhost",    // default
  port: 3000,           // default
  readyTimeout: 5000,   // default
});
```

### DockerContainerProvider

Runs browserd in Docker containers with unique hostnames (requires OrbStack on macOS).

```typescript
import { DockerContainerProvider } from "browserd/providers";

const provider = new DockerContainerProvider({
  headed: true,                       // Run with Xvfb (default)
  imageName: "browserd-sandbox",      // Docker image name
  containerNamePrefix: "browserd",    // Container name prefix
  readyTimeout: 60000,                // Startup timeout
  debug: false,                       // Enable timing logs
});
```

### VercelSandboxProvider

Runs browserd on Vercel Sandbox infrastructure.

```typescript
import { VercelSandboxProvider } from "browserd/providers";

const provider = new VercelSandboxProvider({
  runtime: "node24",     // Node.js runtime version
  headed: true,          // Run with Xvfb
  devMode: false,        // Quick iteration mode
  blobBaseUrl: "...",    // Optional: URL to bundle
});
```

### SpritesSandboxProvider

Runs browserd on [sprites.dev](https://sprites.dev) cloud infrastructure.

```typescript
import { SpritesSandboxProvider } from "browserd/providers";

const provider = new SpritesSandboxProvider({
  token: process.env.SPRITE_TOKEN,    // API token
  headed: true,                       // Run with Xvfb
  autoSetup: true,                    // Install deps if missing
  createCheckpointAfterSetup: true,   // Create checkpoint after setup
  useLocalProxy: true,                // SSH tunnel for WebSocket
  readyTimeout: 120000,               // Cold start timeout
});
```

## BrowserdClient API

### Connection Methods

```typescript
const client = new BrowserdClient({ url: "ws://..." });

await client.connect();                    // Establish connection
await client.close();                      // Close and destroy session
client.isConnected();                      // Check if connected
client.getConnectionState();               // "disconnected" | "connecting" | "connected" | "reconnecting"
client.onConnectionStateChange((state) => {});  // Listen for state changes
client.onError((error) => {});             // Listen for errors
await client.ping();                       // Measure latency (returns ms)
```

### Navigation

```typescript
await browser.navigate("https://example.com", {
  waitUntil: "networkidle"   // "load" | "domcontentloaded" | "networkidle"
});
await browser.goBack();
await browser.goForward();
await browser.reload();
```

### Interaction

```typescript
await browser.click("button.submit", {
  button: "left",    // "left" | "middle" | "right"
  clickCount: 1,
  delay: 100,
  timeout: 30000
});
await browser.dblclick("div.item");
await browser.hover("a.link");
await browser.type("input", "Hello");      // Appends text
await browser.fill("input", "Hello");      // Replaces content
await browser.press("Enter");              // Press key
await browser.press("Control+A");          // Key combination
```

### Waiting

```typescript
await browser.waitForSelector("div.loaded", {
  state: "visible",   // "visible" | "hidden" | "attached" | "detached"
  timeout: 30000
});
```

### Evaluation

```typescript
const title = await browser.evaluate<string>("document.title");
const result = await browser.evaluate("(a, b) => a + b", [1, 2]);
```

### Screenshots

```typescript
const screenshot = await browser.screenshot({
  fullPage: false,
  type: "png",        // "png" | "jpeg"
  quality: 80         // For JPEG only
});
```

### Viewport

```typescript
await browser.setViewport(1920, 1080);
```

## SandboxManager

Manages sandbox lifecycle and session creation.

```typescript
import { SandboxManager, LocalProvider } from "browserd";

const manager = new SandboxManager({
  provider: new LocalProvider({ port: 3000 }),
  clientOptions: { timeout: 30000 }
});

// Create sandbox and get session methods
const { sandbox, createSession, listSessions, destroySession } = await manager.create();

// Create sessions
const browser1 = await createSession({ viewport: { width: 1920, height: 1080 } });
const browser2 = await createSession({ profile: "chrome-win" });

// List sessions
const sessions = await listSessions();

// Get existing session client
const client = await getSession("session-id");

// Cleanup
await destroySession("session-id");
await manager.destroy(sandbox.id);
await manager.destroyAll();  // Destroy all sandboxes
```

## AI Integration

Browserd integrates with Vercel AI SDK for AI agent browser control.

```typescript
import { createBrowserTool } from "browserd/ai";
import { LocalProvider } from "browserd/providers";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// Create the browser tool
const browserTool = await createBrowserTool({
  provider: new LocalProvider({ port: 3000 }),
});

// Use with AI SDK
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { browser: browserTool },
  maxSteps: 10,
  prompt: "Go to techcrunch.com and find the top headline"
});
```

### Available AI Operations

The browser tool supports these operations:
- `navigate`, `goBack`, `goForward`, `reload`
- `click`, `dblclick`, `hover`, `type`, `fill`, `press`
- `waitForSelector`, `evaluate`, `screenshot`
- `setViewport`, `closeSession`
- `requestHumanIntervention` - Request human help for CAPTCHAs and blockers

The AI agent automatically manages session creation and cleanup.

### Human-in-the-Loop (HITL)

When an AI agent encounters obstacles it cannot automate (CAPTCHAs, login walls, complex verifications), it can request human intervention. The tool pauses execution, notifies the user, and resumes once the human completes the task.

#### How It Works

1. **Agent detects a blocker** - Via screenshot analysis or DOM inspection
2. **Agent requests intervention** - Calls `requestHumanIntervention` with reason and instructions
3. **Tool generates viewer URL** - Returns a URL with `?intervention=<id>` parameter
4. **Human resolves the blocker** - Opens the viewer, sees the intervention overlay with instructions
5. **Human clicks "Mark Complete"** - Signals completion via the viewer UI
6. **Agent continues** - The tool unblocks and the agent resumes automation

#### Usage Example

```typescript
import { createBrowserTool } from "browserd/ai";
import { LocalProvider } from "browserd/providers";
import { ConsoleNotificationProvider } from "browserd";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// Create browser tool with notification provider
const browserTool = await createBrowserTool({
  provider: new LocalProvider({ port: 3000 }),
  notificationProvider: new ConsoleNotificationProvider(),
});

// The agent can now request human help when needed
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { browser: browserTool },
  maxSteps: 20,
  prompt: `
    Go to example.com and complete the signup flow.
    If you encounter a CAPTCHA or verification that you cannot solve,
    use requestHumanIntervention to ask for help.
  `
});
```

#### The `requestHumanIntervention` Operation

```typescript
// Input
{
  operation: "requestHumanIntervention",
  sessionId: "sess-abc123",           // Required - must have active session
  reason: "CAPTCHA detected",          // Why intervention is needed
  instructions: "Please solve the CAPTCHA and click Mark Complete when done"
}

// Output (blocks until human completes)
{
  status: "success",
  operation: "requestHumanIntervention",
  sessionId: "sess-abc123",
  data: {
    interventionId: "int-xyz789",
    viewerUrl: "http://localhost:3000/sessions/sess-abc123/viewer?intervention=int-xyz789",
    resolvedAt: "2024-01-15T10:30:00.000Z"
  }
}
```

#### Notification Providers

Configure how users are notified when intervention is needed:

**ConsoleNotificationProvider** (default) - Logs to console:
```typescript
import { ConsoleNotificationProvider } from "browserd";

const provider = new ConsoleNotificationProvider({
  prefix: "[HITL]"  // Optional prefix for log messages
});
```

**WebhookNotificationProvider** - POST to a URL:
```typescript
import { WebhookNotificationProvider } from "browserd";

const provider = new WebhookNotificationProvider({
  url: "https://your-server.com/webhook",
  headers: { "Authorization": "Bearer token" },  // Optional
  timeout: 5000  // Optional, default 10000ms
});

// Webhook receives:
// POST { interventionId, sessionId, viewerUrl, reason, instructions, createdAt }
```

#### Programmatic Completion

Interventions can also be completed via the REST API:

```bash
# Get intervention details
GET /api/sessions/:sessionId/intervention/:interventionId

# Mark intervention complete
POST /api/sessions/:sessionId/intervention/:interventionId/complete
```

#### Detection Patterns

The agent should detect blockers before requesting intervention. Common patterns:

```typescript
// CAPTCHA detection via evaluate
const hasCaptcha = await browser.evaluate(`
  const indicators = [
    document.querySelector('iframe[src*="recaptcha"]'),
    document.querySelector('iframe[src*="hcaptcha"]'),
    document.querySelector('.g-recaptcha'),
    document.querySelector('.h-captcha'),
    document.querySelector('[data-captcha]'),
  ];
  return indicators.some(el => el !== null);
`);

if (hasCaptcha) {
  await browser.requestHumanIntervention({
    reason: "CAPTCHA detected on page",
    instructions: "Please solve the CAPTCHA, then click Mark Complete"
  });
}
```

Visual detection via screenshot is also effective - the agent can analyze screenshots to identify CAPTCHA elements, login walls, or verification prompts.

## Error Handling

```typescript
import { BrowserdError } from "browserd";

try {
  await browser.click("#missing-element");
} catch (error) {
  if (error instanceof BrowserdError) {
    switch (error.code) {
      case "SELECTOR_NOT_FOUND":
        console.log("Element not found");
        break;
      case "TIMEOUT":
        console.log("Operation timed out");
        break;
      case "CONNECTION_CLOSED":
        console.log("Connection lost");
        break;
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `CONNECTION_FAILED` | Failed to connect |
| `CONNECTION_TIMEOUT` | Connection timed out |
| `CONNECTION_CLOSED` | Connection was closed |
| `NOT_CONNECTED` | Not connected to server |
| `RECONNECT_FAILED` | Reconnection failed |
| `COMMAND_TIMEOUT` | Command timed out |
| `COMMAND_FAILED` | Command execution failed |
| `SELECTOR_NOT_FOUND` | Element not found |
| `NAVIGATION_ERROR` | Navigation failed |
| `EXECUTION_ERROR` | JavaScript evaluation failed |
| `SESSION_NOT_FOUND` | Session does not exist |
| `SESSION_LIMIT_REACHED` | Max sessions exceeded |
| `SANDBOX_CREATION_FAILED` | Sandbox creation failed |
| `SANDBOX_TIMEOUT` | Sandbox startup timeout |
| `PROVIDER_ERROR` | Provider-specific error |

---

# Development

## Project Structure

```
browserd/
├── src/
│   ├── server/                 # Browserd server
│   │   ├── index.ts            # Main entry (Bun.serve)
│   │   ├── session-manager.ts  # Multi-session management
│   │   ├── browser-manager.ts  # Chromium lifecycle
│   │   ├── cdp-session.ts      # CDP screencast & input
│   │   ├── command-queue.ts    # Command serialization
│   │   ├── ws-handler.ts       # WebSocket routing
│   │   └── health.ts           # Health endpoints
│   ├── sdk/                    # Client SDK
│   │   ├── client.ts           # BrowserdClient
│   │   ├── sandbox-manager.ts  # Sandbox lifecycle
│   │   ├── providers/          # Infrastructure adapters
│   │   ├── ai/                 # AI SDK integration
│   │   └── internal/           # Connection management
│   ├── stealth/                # Anti-detection
│   │   ├── profiles.ts         # Browser fingerprints
│   │   ├── human-behavior.ts   # Human emulation
│   │   ├── timing.ts           # Action timing
│   │   └── scripts.ts          # Fingerprint spoofing
│   ├── protocol/               # Message types
│   └── client/                 # Web viewer
├── tests/
│   ├── integration/            # Integration tests
│   ├── e2e/                    # End-to-end tests
│   └── stealth/                # Anti-detection tests
├── examples/
│   └── browser-agent/          # AI agent example
└── scripts/                    # Build & deployment
```

## Commands

```bash
# Development
bun run dev                  # Dev server with hot reload
bun run start                # Production server
bun run check-types          # TypeScript type checking

# Testing
bun run test                 # All tests
bun run test:unit            # Unit tests (no browser)
bun run test:integration     # Integration tests (requires browser)
bun run test:e2e             # End-to-end tests
bun run test:stealth         # Anti-bot evasion tests

# Docker
bun run docker:build         # Build sandbox image
bun run docker:test          # Run tests in container
bun run docker:shell         # Shell into container
bun run docker:serve         # Run server in container
bun run docker:serve:headed  # Headed browser in container

# Build
bun run bundle               # Build server bundle
bun run build:sdk            # Build SDK for npm

# Code Quality
bun run lint                 # Biome linter
bun run lint:fix             # Auto-fix lint issues
```

## Local Development

### Without Docker (SDK development)

```bash
# Terminal 1: Start the server
bun run dev

# Terminal 2: Run your code
bun run examples/browser-agent/index.ts
```

### With Docker (full testing)

```bash
# Build the sandbox image
bun run docker:build

# Run all tests
bun run docker:test

# Or run specific test suites
bun run docker:test:unit
bun run docker:test:integration
bun run docker:test:e2e
```

## Testing

Unit tests run without a browser:

```bash
bun run test:unit
```

Integration/E2E tests require Chromium (use Docker):

```bash
bun run docker:test
```

Tests automatically skip when browser support is not available.

## Building

### Server Bundle

Creates a deployable bundle for Sprites.dev/Vercel:

```bash
bun run bundle
# Output: bundle/browserd.tar.gz
```

### SDK Package

Builds the SDK for npm publishing:

```bash
bun run build:sdk
# Output: dist/sdk/
```

## License

MIT
