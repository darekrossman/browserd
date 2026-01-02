# browserd SDK Usage Guide

A TypeScript SDK for browser automation with visual streaming and remote control.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
  - [createClient (Recommended)](#createclient-recommended)
  - [Using SandboxManager](#using-sandboxmanager)
  - [Direct Connection](#direct-connection)
- [Session Management](#session-management)
- [Providers](#providers)
  - [LocalSandboxProvider](#localsandboxprovider)
  - [VercelSandboxProvider](#vercelsandboxprovider)
  - [SpritesSandboxProvider](#spritessandboxprovider)
- [SandboxManager](#sandboxmanager)
- [BrowserdClient API](#browserdclient-api)
- [Error Handling](#error-handling)
- [Transport Options](#transport-options)
- [TypeScript Types](#typescript-types)
- [AI SDK Integration](#ai-sdk-integration)

---

## Installation

```bash
# Using bun
bun add browserd

# Using npm
npm install browserd

# Using pnpm
pnpm add browserd
```

### Optional Provider Dependencies

Install provider-specific dependencies based on your infrastructure:

```bash
# For Vercel Sandbox
bun add @vercel/sandbox

# For Sprites.dev
bun add @fly/sprites
```

---

## Quick Start

### createClient (Recommended)

The simplest way to get started with a managed sandbox:

```typescript
import { createClient, SpritesSandboxProvider } from "browserd";

// Create sandbox with session management methods
const { sandbox, manager, createSession, destroySession } = await createClient({
  provider: new SpritesSandboxProvider({ token: process.env.SPRITE_TOKEN }),
});

// Create a browser session - returns connected client ready to use
const browser = await createSession();

// Use the browser immediately
await browser.navigate("https://example.com");
await browser.fill("input[name=email]", "user@example.com");
await browser.screenshot({ fullPage: true });

// Cleanup - close() disconnects AND destroys the session
await browser.close();
await manager.destroy(sandbox.id);
```

With local Docker:

```typescript
import { createClient, LocalSandboxProvider } from "browserd";

const { sandbox, manager, createSession } = await createClient({
  provider: new LocalSandboxProvider(),
});

// Create session - returns connected client
const browser = await createSession();

// Use the browser immediately
await browser.navigate("https://example.com");

// Cleanup - close() handles everything
await browser.close();
await manager.destroy(sandbox.id);
```

### Using SandboxManager

For more control over sandbox lifecycle:

```typescript
import { SandboxManager, LocalSandboxProvider } from "browserd";

const provider = new LocalSandboxProvider();
const manager = new SandboxManager({ provider });

// Create sandbox - returns session management methods
const { sandbox, createSession, listSessions } = await manager.create();

// Create a browser session - returns connected client
const browser = await createSession({
  viewport: { width: 1920, height: 1080 }
});

// Use the browser immediately
await browser.navigate("https://example.com");
await browser.fill("input[name=email]", "user@example.com");
await browser.screenshot({ fullPage: true });

// List all sessions on this sandbox
const sessions = await listSessions();
console.log("Active sessions:", sessions.sessions.length);

// Cleanup - close() destroys the session automatically
await browser.close();
await manager.destroy(sandbox.id);
```

### Direct Connection

Connect directly to an existing session on a running browserd server:

```typescript
import { BrowserdClient } from "browserd";

// Connect to a specific session (session must be created via API first)
const client = new BrowserdClient({
  url: "ws://localhost:3000/sessions/my-session-id/ws",
});

await client.connect();
await client.navigate("https://example.com");
await client.click("button#submit");
await client.close();
```

---

## Session Management

Sessions provide isolated browser contexts with independent cookies, storage, and state. Each session runs in its own browser context, allowing multiple independent browser sessions on a single sandbox.

### Creating Sessions

```typescript
const { sandbox, createSession, listSessions, getSession, getSessionInfo, destroySession } = await manager.create();

// Create session - returns connected client ready to use
const browser1 = await createSession();

// Create session with custom viewport
const browser2 = await createSession({
  viewport: { width: 1920, height: 1080 }
});

// Create session with custom profile
const browser3 = await createSession({
  profile: { locale: "en-US", timezone: "America/New_York" }
});

// Access session info from the client
console.log("Session ID:", browser1.sessionId);
console.log("Viewer URL:", browser1.sessionInfo?.viewerUrl);
```

### Session Lifecycle

```typescript
// List all sessions
const { sessions } = await listSessions();
console.log("Sessions:", sessions.map(s => s.id));

// Get info about a specific session (without connecting)
const sessionInfo = await getSessionInfo(browser1.sessionId!);
console.log("Status:", sessionInfo.status);

// Get an existing session's client (returns cached or creates new connection)
const existingBrowser = await getSession(browser1.sessionId!);

// Use the browser...
await existingBrowser.navigate("https://example.com");

// Clean up - close() disconnects AND destroys the session
await existingBrowser.close();
```

### Session URLs

Each session exposes its own endpoints:

| Endpoint | Description |
|----------|-------------|
| `/sessions/{id}/ws` | WebSocket connection for real-time control |
| `/sessions/{id}/stream` | SSE stream for HTTP-only environments |
| `/sessions/{id}/input` | HTTP POST endpoint for commands (SSE mode) |
| `/sessions/{id}/viewer` | Browser viewer page |

### Multiple Sessions

Run multiple isolated browser sessions on a single sandbox:

```typescript
const { createSession } = await manager.create();

// Create two independent sessions - both return connected clients
const browser1 = await createSession();
const browser2 = await createSession();

// Each session has isolated state - use immediately
await browser1.navigate("https://site-a.com");
await browser2.navigate("https://site-b.com");

// Log into different accounts
await browser1.fill("input[name=email]", "user1@example.com");
await browser2.fill("input[name=email]", "user2@example.com");

// Clean up - each close() destroys its session
await browser1.close();
await browser2.close();
```

---

## Providers

Providers handle infrastructure provisioning. Choose based on your deployment environment.

### LocalSandboxProvider

Run browserd in local Docker containers. Best for development and testing.

**Requirements:** Docker with OrbStack (for `.orb.local` DNS)

```typescript
import { SandboxManager, LocalSandboxProvider } from "browserd";

const provider = new LocalSandboxProvider({
  headed: true,           // Run with Xvfb (default: true)
  imageName: "browserd-sandbox",
  containerNamePrefix: "browserd",
  readyTimeout: 60000,    // ms
  workingDir: process.cwd(),
  debug: false,
});

const manager = new SandboxManager({ provider });
const { sandbox, createSession } = await manager.create();

// Create a session - returns connected client
const browser = await createSession();
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headed` | `boolean` | `true` | Run browser with Xvfb |
| `imageName` | `string` | `"browserd-sandbox"` | Docker image name |
| `containerNamePrefix` | `string` | `"browserd"` | Container name prefix |
| `readyTimeout` | `number` | `60000` | Health check timeout (ms) |
| `workingDir` | `string` | `process.cwd()` | Working directory to mount |
| `debug` | `boolean` | `false` | Enable debug logging |
| `defaultTimeout` | `number` | `300000` | Default operation timeout (ms) |

---

### VercelSandboxProvider

Deploy browserd on Vercel's managed sandbox infrastructure.

**Requirements:** `@vercel/sandbox` package, blob storage with deployment artifacts

```typescript
import { SandboxManager, VercelSandboxProvider } from "browserd";

const provider = new VercelSandboxProvider({
  blobBaseUrl: "https://blob.vercel-storage.com/browserd",
  runtime: "node24",
});

const manager = new SandboxManager({ provider });
const { sandbox, createSession } = await manager.create();

const browser = await createSession();
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `blobBaseUrl` | `string` | *required* | Base URL for install.sh and browserd.tar.gz |
| `runtime` | `string` | `"node24"` | Vercel sandbox runtime |
| `defaultTimeout` | `number` | `300000` | Default operation timeout (ms) |

---

### SpritesSandboxProvider

Run browserd on [sprites.dev](https://sprites.dev) infrastructure (Firecracker VMs).

**Requirements:** `@fly/sprites` package, sprite CLI installed and authenticated

```typescript
import { SandboxManager, SpritesSandboxProvider } from "browserd";

// Check dependencies first
const { available, message } = await SpritesSandboxProvider.checkDependencies();
if (!available) {
  console.error(message);
  process.exit(1);
}

const provider = new SpritesSandboxProvider({
  spriteName: "my-browserd",      // Reuse existing sprite
  autoSetup: true,                // Auto-install Chromium
  createCheckpointAfterSetup: true,
  headed: true,
  useLocalProxy: true,            // SSH tunnel for WebSocket
});

const manager = new SandboxManager({ provider });
const { sandbox, createSession } = await manager.create();

const browser = await createSession();
```

**Static Methods:**

```typescript
// Check if all dependencies are available
SpritesSandboxProvider.checkDependencies(): Promise<{ available: boolean; message: string }>

// Individual checks
SpritesSandboxProvider.isCliInstalled(): Promise<boolean>
SpritesSandboxProvider.isCliAuthenticated(): Promise<boolean>
SpritesSandboxProvider.installCli(): Promise<void>
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | `SPRITE_TOKEN` env | API token |
| `org` | `string` | - | Organization name |
| `spriteName` | `string` | - | Existing sprite to reuse |
| `checkpointId` | `string` | - | Checkpoint to restore |
| `autoSetup` | `boolean` | `true` | Auto-install dependencies |
| `createCheckpointAfterSetup` | `boolean` | `true` | Create checkpoint after setup |
| `headed` | `boolean` | `true` | Run with Xvfb |
| `readyTimeout` | `number` | `120000` | Health check timeout (ms) |
| `debug` | `boolean` | `false` | Enable debug logging |
| `blobBaseUrl` | `string` | - | Custom blob storage URL |
| `useLocalProxy` | `boolean` | `true` | SSH tunnel for WebSocket |
| `localProxyPort` | `number` | auto | Local proxy port |
| `autoInstallCli` | `boolean` | `false` | Auto-install sprite CLI |
| `defaultTimeout` | `number` | `300000` | Default operation timeout (ms) |

---

## SandboxManager

High-level API for managing sandbox lifecycle.

```typescript
import { SandboxManager, LocalSandboxProvider } from "browserd";

const manager = new SandboxManager({
  provider: new LocalSandboxProvider(),
  clientOptions: {
    timeout: 30000,
    autoReconnect: true,
  },
});

// Create sandbox - returns session management methods
const { sandbox, createSession, listSessions, getSession, getSessionInfo, destroySession } = await manager.create();

// Access sandbox info
console.log(sandbox.id);      // "sandbox-abc123"
console.log(sandbox.wsUrl);   // "ws://localhost:3000/sessions/{id}/ws"
console.log(sandbox.status);  // "ready"

// Create session - returns connected client ready to use
const browser = await createSession();

// Get existing sandbox info
const existingSandbox = manager.get(sandbox.id);

// Check if sandbox exists
manager.has(sandbox.id);  // true

// List all managed sandboxes
const sandboxes = manager.list();

// Clean up - close() destroys the session automatically
await browser.close();
await manager.destroy(sandbox.id);

// Clean up all sandboxes
await manager.destroyAll();
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | Number of managed sandboxes |
| `providerName` | `string` | Name of the current provider |

**Session Methods Returned from `create()`:**

| Method | Description |
|--------|-------------|
| `createSession(options?)` | Create a new browser session, returns connected client |
| `listSessions()` | List all sessions on the sandbox |
| `getSession(sessionId)` | Get a connected client for an existing session |
| `getSessionInfo(sessionId)` | Get session info without connecting |
| `destroySession(sessionId)` | Destroy a session (alternative to `client.close()`) |

---

## BrowserdClient API

### Connection

```typescript
const client = new BrowserdClient({
  url: "ws://localhost:3000/sessions/session-id/ws",
  timeout: 30000,
  autoReconnect: true,
  reconnectInterval: 2000,
  maxReconnectAttempts: 5,
  authToken: "optional-token",
  transport: "ws",  // or "sse"
});

await client.connect();

// Check connection state
client.isConnected();  // boolean
client.getConnectionState();  // "disconnected" | "connecting" | "connected" | "reconnecting"

// Listen for state changes
client.onConnectionStateChange((state) => {
  console.log("Connection state:", state.current, state.previous);
});

// Listen for errors
client.onError((error) => {
  console.error("Client error:", error);
});

// Measure latency
const latency = await client.ping();

await client.close();
```

### Navigation

```typescript
// Navigate to URL
await client.navigate("https://example.com", {
  timeout: 30000,
  waitUntil: "load",  // "load" | "domcontentloaded" | "networkidle"
});

// History navigation
await client.goBack();
await client.goForward();
await client.reload();
```

### Interactions

```typescript
// Click
await client.click("button#submit", {
  timeout: 5000,
  button: "left",  // "left" | "right" | "middle"
});

// Double click
await client.dblclick("div.item");

// Hover
await client.hover("a.link");

// Type text (appends)
await client.type("input[name=search]", "hello world", {
  delay: 100,  // Delay between keystrokes (ms)
});

// Fill input (replaces content)
await client.fill("input[name=email]", "user@example.com");

// Press key
await client.press("Enter");
await client.press("Control+A");
```

### Waiting

```typescript
await client.waitForSelector("div.loaded", {
  state: "visible",  // "attached" | "detached" | "visible" | "hidden"
  timeout: 10000,
});
```

### Screenshots

```typescript
const screenshot = await client.screenshot({
  type: "png",      // "png" | "jpeg"
  quality: 80,      // For JPEG (0-100)
  fullPage: true,
  selector: "#main", // Screenshot specific element
});

// screenshot.data is base64-encoded image
```

### JavaScript Evaluation

```typescript
const result = await client.evaluate<string>(
  "document.title",
  [],
  { timeout: 5000 }
);

// With arguments
const text = await client.evaluate<string>(
  "(selector) => document.querySelector(selector)?.textContent",
  ["h1"]
);
```

### Viewport

```typescript
await client.setViewport(1920, 1080);
```

---

## Error Handling

All SDK errors extend `BrowserdError` with typed error codes:

```typescript
import { BrowserdError, type BrowserdErrorCode } from "browserd";

try {
  await client.click("button#missing");
} catch (error) {
  if (BrowserdError.isBrowserdError(error)) {
    console.error("Code:", error.code);      // "SELECTOR_NOT_FOUND"
    console.error("Message:", error.message);
    console.error("Details:", error.details);
    console.error("Cause:", error.cause);
  }
}
```

**Error Codes:**

| Code | Description |
|------|-------------|
| `CONNECTION_FAILED` | Failed to establish connection |
| `CONNECTION_TIMEOUT` | Connection attempt timed out |
| `CONNECTION_CLOSED` | Connection was closed unexpectedly |
| `NOT_CONNECTED` | Operation attempted without connection |
| `RECONNECT_FAILED` | All reconnection attempts failed |
| `COMMAND_TIMEOUT` | Command execution timed out |
| `COMMAND_FAILED` | Command execution failed |
| `SELECTOR_NOT_FOUND` | Element not found by selector |
| `NAVIGATION_ERROR` | Navigation failed |
| `EXECUTION_ERROR` | JavaScript evaluation failed |
| `UNKNOWN_METHOD` | Unknown command method |
| `INVALID_PARAMS` | Invalid command parameters |
| `SANDBOX_CREATION_FAILED` | Failed to create sandbox |
| `SANDBOX_NOT_FOUND` | Sandbox not found |
| `SESSION_ERROR` | Session operation failed |
| `SESSION_NOT_FOUND` | Session not found |
| `PROVIDER_ERROR` | Provider-specific error |

---

## Transport Options

### WebSocket (Default)

Full-duplex connection with real-time streaming:

```typescript
const client = new BrowserdClient({
  url: "ws://localhost:3000/sessions/session-id/ws",
  transport: "ws",
});
```

### SSE (Server-Sent Events)

For HTTP-only proxies that don't support WebSocket:

```typescript
const client = new BrowserdClient({
  url: "https://example.com/sessions/session-id",  // Base URL without /stream
  transport: "sse",
  authToken: "bearer-token",   // Required for SSE
});
```

SSE uses:
- Server-Sent Events for server→client messages (GET `/sessions/{id}/stream`)
- HTTP POST for client→server commands (POST `/sessions/{id}/input`)

---

## TypeScript Types

All types are exported for full type safety:

```typescript
import type {
  // Client
  BrowserdClientOptions,
  ConnectionState,
  ConnectionStateChange,

  // Commands
  ClickOptions,
  TypeOptions,
  FillOptions,
  HoverOptions,
  PressOptions,
  NavigateOptions,
  NavigateResult,
  WaitOptions,
  ScreenshotOptions,
  ScreenshotResult,
  EvaluateOptions,

  // createClient
  CreateClientOptions,
  CreateClientResult,

  // Sandbox
  CreateSandboxOptions,
  CreateSandboxResult,
  SandboxInfo,
  SandboxStatus,
  SandboxManagerOptions,

  // Session
  SessionMethods,
  SessionInfo,
  CreateSessionOptions,
  ListSessionsResponse,

  // Viewport
  Viewport,

  // Providers
  SandboxProvider,
  SandboxProviderOptions,
  LocalSandboxProviderOptions,
  VercelSandboxProviderOptions,
  SpritesSandboxProviderOptions,
} from "browserd";
```

---

## AI SDK Integration

The `browserd/ai` module provides a tool for the [Vercel AI SDK](https://ai-sdk.dev) that enables AI agents to control browsers with automatic session management.

### Installation

```bash
# Install AI SDK dependencies
bun add ai @ai-sdk/openai zod
```

### Quick Start

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { LocalSandboxProvider } from "browserd/providers";
import { createBrowserTool } from "browserd/ai";

// Create the AI browser tool with a provider
// Sandbox is created lazily on first browser operation
const provider = new LocalSandboxProvider();
const browserTool = createBrowserTool({ provider });

// Use with AI SDK
const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: { browser: browserTool },
  maxSteps: 10,
  prompt: `Go to Hacker News and find the top story title.
           Make sure to save the sessionId from your first call,
           use it in all subsequent calls, and call closeSession when done.`,
});

console.log(text);
// Note: Agent should have called closeSession to clean up
```

### Session Management

The AI browser tool automatically manages browser sessions:

1. **First call**: Creates a sandbox and browser session, returns `sessionId`
2. **Subsequent calls**: Agent must pass `sessionId` to maintain browser state
3. **Cleanup**: Agent calls `closeSession` operation with `sessionId` when done

The AI agent receives clear instructions in the tool description about session management.

### Supported Operations

| Operation | Description |
|-----------|-------------|
| `navigate` | Go to a URL |
| `click` | Click on an element |
| `dblclick` | Double-click on an element |
| `hover` | Hover over an element |
| `type` | Type text character by character |
| `fill` | Fill a form field (clears existing value) |
| `press` | Press a key or key combination |
| `waitForSelector` | Wait for element state |
| `evaluate` | Execute JavaScript in page context |
| `screenshot` | Capture page screenshot |
| `setViewport` | Change viewport dimensions |
| `goBack` / `goForward` / `reload` | Browser navigation |
| `closeSession` | Close the browser session (call when done) |

### Options

```typescript
const browserTool = createBrowserTool({
  provider: myProvider,   // Required: SandboxProvider instance
  defaultTimeout: 30000,  // Optional: default timeout for operations (ms)
});
```

### Example

See [`examples/browser-agent/index.ts`](../../examples/browser-agent/index.ts) for a complete working example.

---

## Examples

### Form Automation

```typescript
import { createClient, LocalSandboxProvider } from "browserd";

const { sandbox, manager, createSession } = await createClient({
  provider: new LocalSandboxProvider(),
});

const browser = await createSession();

try {
  await browser.navigate("https://example.com/login");
  await browser.fill("input[name=email]", "user@example.com");
  await browser.fill("input[name=password]", "password123");
  await browser.click("button[type=submit]");
  await browser.waitForSelector(".dashboard", { timeout: 10000 });

  console.log("Login successful!");
} finally {
  await browser.close();
  await manager.destroy(sandbox.id);
}
```

### Screenshot Capture

```typescript
import { createClient, LocalSandboxProvider } from "browserd";

const { sandbox, manager, createSession } = await createClient({
  provider: new LocalSandboxProvider(),
});

const browser = await createSession();

await browser.navigate("https://example.com");
await browser.setViewport(1920, 1080);

const screenshot = await browser.screenshot({
  type: "png",
  fullPage: true,
});

// Save to file
await Bun.write("screenshot.png", Buffer.from(screenshot.data, "base64"));

await browser.close();
await manager.destroy(sandbox.id);
```

### Error Recovery

```typescript
import { createClient, LocalSandboxProvider, BrowserdError } from "browserd";

const { sandbox, manager, createSession } = await createClient({
  provider: new LocalSandboxProvider(),
});

const browser = await createSession();

try {
  await browser.navigate("https://example.com");
  await browser.click("button#submit", { timeout: 5000 });
} catch (error) {
  if (BrowserdError.isBrowserdError(error)) {
    if (error.code === "SELECTOR_NOT_FOUND") {
      console.log("Button not found, trying alternative...");
      await browser.click("input[type=submit]");
    } else if (error.code === "COMMAND_TIMEOUT") {
      console.log("Operation timed out, retrying...");
      await browser.click("button#submit", { timeout: 15000 });
    } else {
      throw error;
    }
  }
} finally {
  await browser.close();
  await manager.destroy(sandbox.id);
}
```

### Multi-Session Automation

```typescript
import { createClient, LocalSandboxProvider } from "browserd";

const { sandbox, manager, createSession } = await createClient({
  provider: new LocalSandboxProvider(),
});

// Create multiple sessions for parallel automation - each returns connected client
const browsers = await Promise.all([
  createSession({ viewport: { width: 1920, height: 1080 } }),
  createSession({ viewport: { width: 1920, height: 1080 } }),
  createSession({ viewport: { width: 1920, height: 1080 } }),
]);

// Run tasks in parallel across different sessions
await Promise.all([
  browsers[0].navigate("https://site-a.com"),
  browsers[1].navigate("https://site-b.com"),
  browsers[2].navigate("https://site-c.com"),
]);

// Clean up - each close() destroys its session
await Promise.all(browsers.map(b => b.close()));
await manager.destroy(sandbox.id);
```
