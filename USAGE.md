# browserd SDK Usage Guide

A TypeScript SDK for browser automation with visual streaming and remote control.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Providers](#providers)
  - [LocalSandboxProvider](#localsandboxprovider)
  - [VercelSandboxProvider](#vercelsandboxprovider)
  - [SpritesSandboxProvider](#spritessandboxprovider)
- [SandboxManager](#sandboxmanager)
- [BrowserdClient API](#browserdclient-api)
- [Error Handling](#error-handling)
- [Transport Options](#transport-options)
- [TypeScript Types](#typescript-types)

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

### Direct Connection

Connect directly to a running browserd server:

```typescript
import { BrowserdClient } from "browserd";

const client = new BrowserdClient({
  url: "ws://localhost:3000/ws",
});

await client.connect();
await client.navigate("https://example.com");
await client.click("button#submit");
await client.close();
```

### Using SandboxManager

Provision and manage browser sandboxes automatically:

```typescript
import { SandboxManager } from "browserd";
import { LocalSandboxProvider } from "browserd/providers";

const provider = new LocalSandboxProvider();
const manager = new SandboxManager({ provider });

const { client, sandbox } = await manager.create();

await client.navigate("https://example.com");
await client.fill("input[name=email]", "user@example.com");
await client.screenshot({ fullPage: true });

await manager.destroy(sandbox.id);
```

---

## Providers

Providers handle infrastructure provisioning. Choose based on your deployment environment.

### LocalSandboxProvider

Run browserd in local Docker containers. Best for development and testing.

**Requirements:** Docker with OrbStack (for `.orb.local` DNS)

```typescript
import { SandboxManager } from "browserd";
import { LocalSandboxProvider } from "browserd/providers";

const provider = new LocalSandboxProvider({
  headed: true,           // Run with Xvfb (default: true)
  imageName: "browserd-sandbox",
  containerNamePrefix: "browserd",
  readyTimeout: 60000,    // ms
  workingDir: process.cwd(),
  debug: false,
});

const manager = new SandboxManager({ provider });
const { client, sandbox } = await manager.create();
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
import { SandboxManager } from "browserd";
import { VercelSandboxProvider } from "browserd/providers";

const provider = new VercelSandboxProvider({
  blobBaseUrl: "https://blob.vercel-storage.com/browserd",
  runtime: "node24",
});

const manager = new SandboxManager({ provider });
const { client, sandbox } = await manager.create();
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
import { SandboxManager } from "browserd";
import { SpritesSandboxProvider } from "browserd/providers";

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
const { client, sandbox } = await manager.create();
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
import { SandboxManager } from "browserd";
import { LocalSandboxProvider } from "browserd/providers";

const manager = new SandboxManager({
  provider: new LocalSandboxProvider(),
  clientOptions: {
    timeout: 30000,
    autoReconnect: true,
  },
});

// Create sandbox and get connected client
const { client, sandbox } = await manager.create();

// Access sandbox info
console.log(sandbox.id);      // "sandbox-abc123"
console.log(sandbox.wsUrl);   // "ws://localhost:3000/ws"
console.log(sandbox.status);  // "ready"

// Get existing client/sandbox
const existingClient = manager.getClient(sandbox.id);
const existingSandbox = manager.get(sandbox.id);

// List all managed sandboxes
const sandboxes = manager.list();

// Clean up
await manager.destroy(sandbox.id);

// Clean up all sandboxes
await manager.destroyAll();
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | Number of managed sandboxes |
| `providerName` | `string` | Name of the current provider |

---

## BrowserdClient API

### Connection

```typescript
const client = new BrowserdClient({
  url: "ws://localhost:3000/ws",
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
| `PROVIDER_ERROR` | Provider-specific error |

---

## Transport Options

### WebSocket (Default)

Full-duplex connection with real-time streaming:

```typescript
const client = new BrowserdClient({
  url: "ws://localhost:3000/ws",
  transport: "ws",
});
```

### SSE (Server-Sent Events)

For HTTP-only proxies that don't support WebSocket:

```typescript
const client = new BrowserdClient({
  url: "https://example.com",  // HTTPS URL
  transport: "sse",
  authToken: "bearer-token",   // Required for SSE
});
```

SSE uses:
- Server-Sent Events for server→client messages
- HTTP POST for client→server commands

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

  // Sandbox
  CreateSandboxOptions,
  CreateSandboxResult,
  SandboxInfo,
  SandboxStatus,

  // Viewport
  Viewport,
} from "browserd";

import type {
  // Providers
  SandboxProvider,
  SandboxProviderOptions,
  LocalSandboxProviderOptions,
  VercelSandboxProviderOptions,
  SpritesSandboxProviderOptions,
} from "browserd/providers";
```

---

## Examples

### Form Automation

```typescript
import { SandboxManager } from "browserd";
import { LocalSandboxProvider } from "browserd/providers";

const manager = new SandboxManager({
  provider: new LocalSandboxProvider(),
});

const { client, sandbox } = await manager.create();

try {
  await client.navigate("https://example.com/login");
  await client.fill("input[name=email]", "user@example.com");
  await client.fill("input[name=password]", "password123");
  await client.click("button[type=submit]");
  await client.waitForSelector(".dashboard", { timeout: 10000 });

  console.log("Login successful!");
} finally {
  await manager.destroy(sandbox.id);
}
```

### Screenshot Capture

```typescript
const { client, sandbox } = await manager.create();

await client.navigate("https://example.com");
await client.setViewport(1920, 1080);

const screenshot = await client.screenshot({
  type: "png",
  fullPage: true,
});

// Save to file
await Bun.write("screenshot.png", Buffer.from(screenshot.data, "base64"));

await manager.destroy(sandbox.id);
```

### Error Recovery

```typescript
import { BrowserdError } from "browserd";

const { client, sandbox } = await manager.create();

try {
  await client.navigate("https://example.com");
  await client.click("button#submit", { timeout: 5000 });
} catch (error) {
  if (BrowserdError.isBrowserdError(error)) {
    if (error.code === "SELECTOR_NOT_FOUND") {
      console.log("Button not found, trying alternative...");
      await client.click("input[type=submit]");
    } else if (error.code === "COMMAND_TIMEOUT") {
      console.log("Operation timed out, retrying...");
      await client.click("button#submit", { timeout: 15000 });
    } else {
      throw error;
    }
  }
}
```
