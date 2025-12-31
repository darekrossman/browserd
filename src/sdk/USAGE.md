# browserd SDK Usage Guide

The browserd SDK provides a TypeScript client for connecting to and controlling remote browser instances. It supports both connecting to existing browserd servers and provisioning new sandboxes on-demand.

## Installation

```bash
bun add @repo/browserd

# If using Vercel Sandbox provider:
bun add @vercel/sandbox
```

## Quick Start

### Connect to an Existing Server

```typescript
import { BrowserdClient } from '@repo/browserd/sdk';

const client = new BrowserdClient({
  url: 'ws://localhost:3000/ws',
});

await client.connect();
await client.navigate('https://example.com');
await client.click('button#submit');
await client.close();
```

### Provision a New Sandbox

```typescript
import { SandboxManager, VercelSandboxProvider } from '@repo/browserd/sdk';

const provider = new VercelSandboxProvider({
  blobBaseUrl: 'https://blob.vercel-storage.com/browserd',
});

const manager = new SandboxManager({ provider });
const { client, sandbox } = await manager.create();

await client.navigate('https://example.com');
// ... use the browser

await manager.destroy(sandbox.id);
```

## Client Configuration

```typescript
interface BrowserdClientOptions {
  /** WebSocket URL to connect to (e.g., "ws://localhost:3000/ws") */
  url: string;
  /** Default timeout for commands in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to automatically reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Interval between reconnect attempts in milliseconds (default: 2000) */
  reconnectInterval?: number;
  /** Maximum number of reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
}
```

## API Reference

### Connection Lifecycle

```typescript
// Connect to server
await client.connect();

// Check connection status
client.isConnected(); // boolean
client.getConnectionState(); // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// Listen for state changes
const unsubscribe = client.onConnectionStateChange((state) => {
  console.log('Connection state:', state);
});

// Listen for errors
client.onError((error) => {
  console.error('Connection error:', error);
});

// Close connection
await client.close();
```

### Navigation

```typescript
// Navigate to URL
const result = await client.navigate('https://example.com', {
  waitUntil: 'networkidle', // 'load' | 'domcontentloaded' | 'networkidle'
  timeout: 30000,
});
// result: { url: string, title?: string }

// Browser history
await client.goBack();
await client.goForward();
await client.reload();
```

### Element Interactions

```typescript
// Click element
await client.click('button#submit', {
  button: 'left',    // 'left' | 'right' | 'middle'
  clickCount: 1,     // Number of clicks
  delay: 0,          // Delay between mousedown and mouseup
  timeout: 30000,
});

// Double-click
await client.dblclick('div.item', { timeout: 30000 });

// Hover
await client.hover('.menu-item', { timeout: 30000 });

// Type text (appends to existing content)
await client.type('input#search', 'hello world', {
  delay: 50,         // Delay between key presses
  timeout: 30000,
});

// Fill input (clears existing content first)
await client.fill('input#email', 'user@example.com', {
  timeout: 30000,
});

// Press key
await client.press('Enter', {
  delay: 0,          // Delay between keydown and keyup
  timeout: 30000,
});
```

### Waiting

```typescript
// Wait for selector
await client.waitForSelector('h1', {
  state: 'visible',  // 'visible' | 'hidden' | 'attached' | 'detached'
  timeout: 30000,
});
```

### Viewport

```typescript
// Set viewport size
await client.setViewport(1920, 1080);
```

### JavaScript Evaluation

```typescript
// Evaluate JavaScript in page context
const title = await client.evaluate<string>('document.title');

const data = await client.evaluate<{ count: number }>(
  '({ count: document.querySelectorAll("p").length })'
);
```

### Screenshots

```typescript
const screenshot = await client.screenshot({
  fullPage: false,   // Capture full scrollable page
  type: 'png',       // 'png' | 'jpeg'
  quality: 80,       // JPEG quality (0-100)
});
// screenshot: { data: string (base64), format: 'png' | 'jpeg' }
```

### Latency Check

```typescript
const latencyMs = await client.ping();
```

## Sandbox Management

### SandboxManager

The `SandboxManager` handles sandbox lifecycle and client connections:

```typescript
import { SandboxManager, VercelSandboxProvider } from '@repo/browserd/sdk';

const provider = new VercelSandboxProvider({
  blobBaseUrl: 'https://blob.vercel-storage.com/browserd',
  runtime: 'node24',        // Vercel sandbox runtime
  defaultTimeout: 300000,   // 5 minutes
});

const manager = new SandboxManager({
  provider,
  clientOptions: {
    timeout: 30000,
    autoReconnect: true,
  },
});

// Create sandbox with connected client
const { client, sandbox } = await manager.create({
  timeout: 300000,          // Sandbox lifetime
  resources: { vcpus: 4 },  // Resource allocation
  port: 3000,               // browserd port
});

// Get sandbox info
const info = manager.get(sandbox.id);
// info: { id, domain, wsUrl, status, createdAt }

// Get client for existing sandbox
const existingClient = manager.getClient(sandbox.id);

// List all managed sandboxes
const sandboxes = manager.list();

// Check sandbox count
manager.size;
manager.has(sandbox.id);

// Destroy sandbox
await manager.destroy(sandbox.id);

// Destroy all sandboxes
await manager.destroyAll();
```

### SandboxInfo

```typescript
interface SandboxInfo {
  /** Unique sandbox identifier */
  id: string;
  /** HTTPS domain for the sandbox */
  domain: string;
  /** WebSocket URL for browserd connection */
  wsUrl: string;
  /** Current status */
  status: 'creating' | 'ready' | 'destroyed';
  /** Creation timestamp */
  createdAt: number;
}
```

### Custom Providers

Implement the `SandboxProvider` interface for custom infrastructure:

```typescript
interface SandboxProvider {
  readonly name: string;
  create(options?: CreateSandboxOptions): Promise<SandboxInfo>;
  destroy(sandboxId: string): Promise<void>;
  isReady(sandboxId: string): Promise<boolean>;
  get(sandboxId: string): Promise<SandboxInfo | undefined>;
}
```

Example custom provider:

```typescript
import type { SandboxProvider, CreateSandboxOptions, SandboxInfo } from '@repo/browserd/sdk';

class DockerSandboxProvider implements SandboxProvider {
  readonly name = 'docker';

  async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
    // Start Docker container with browserd
    // Return sandbox info with WebSocket URL
  }

  async destroy(sandboxId: string): Promise<void> {
    // Stop and remove container
  }

  async isReady(sandboxId: string): Promise<boolean> {
    // Check container health
  }

  async get(sandboxId: string): Promise<SandboxInfo | undefined> {
    // Return container info
  }
}
```

## Error Handling

The SDK uses typed errors for consistent error handling:

```typescript
import { BrowserdError } from '@repo/browserd/sdk';

try {
  await client.navigate('https://example.com');
} catch (error) {
  if (BrowserdError.isBrowserdError(error)) {
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);

    // Handle specific errors
    if (error.hasCode('CONNECTION_TIMEOUT')) {
      // Retry connection
    }
    if (error.hasCode('SELECTOR_NOT_FOUND')) {
      // Element not found
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `CONNECTION_FAILED` | Failed to establish WebSocket connection |
| `CONNECTION_TIMEOUT` | Connection attempt timed out |
| `CONNECTION_CLOSED` | Connection was closed unexpectedly |
| `NOT_CONNECTED` | Attempted operation without active connection |
| `RECONNECT_FAILED` | Failed to reconnect after disconnect |
| `COMMAND_TIMEOUT` | Command execution timed out |
| `COMMAND_FAILED` | Command failed on server |
| `SELECTOR_NOT_FOUND` | Element selector not found |
| `NAVIGATION_ERROR` | Navigation failed |
| `EXECUTION_ERROR` | JavaScript evaluation failed |
| `UNKNOWN_METHOD` | Unrecognized command method |
| `INVALID_PARAMS` | Invalid command parameters |
| `SANDBOX_CREATION_FAILED` | Failed to create sandbox |
| `SANDBOX_NOT_FOUND` | Sandbox not found |
| `SANDBOX_TIMEOUT` | Sandbox did not become ready in time |
| `SANDBOX_DESTROYED` | Sandbox was destroyed |
| `PROVIDER_ERROR` | Provider-specific error |

## Complete Example

```typescript
import {
  BrowserdClient,
  SandboxManager,
  VercelSandboxProvider,
  BrowserdError
} from '@repo/browserd/sdk';

async function automateWebsite() {
  // Setup
  const provider = new VercelSandboxProvider({
    blobBaseUrl: process.env.BROWSERD_BLOB_URL!,
  });

  const manager = new SandboxManager({ provider });

  let client: BrowserdClient | null = null;
  let sandboxId: string | null = null;

  try {
    // Create sandbox
    console.log('Creating sandbox...');
    const result = await manager.create({
      timeout: 300000,
      resources: { vcpus: 4 }
    });
    client = result.client;
    sandboxId = result.sandbox.id;

    console.log(`Sandbox ready: ${result.sandbox.domain}`);

    // Monitor connection
    client.onConnectionStateChange((state) => {
      console.log(`Connection: ${state}`);
    });

    // Navigate and interact
    await client.navigate('https://httpbin.org/forms/post', {
      waitUntil: 'networkidle',
    });

    await client.waitForSelector('form');
    await client.fill('input[name="custname"]', 'John Doe');
    await client.fill('input[name="custtel"]', '555-1234');
    await client.fill('input[name="custemail"]', 'john@example.com');

    // Take screenshot before submit
    const screenshot = await client.screenshot({
      type: 'jpeg',
      quality: 80,
    });
    console.log(`Screenshot: ${screenshot.data.length} bytes`);

    // Submit form
    await client.click('button[type="submit"]');

    // Wait for result
    await client.waitForSelector('pre');

    // Get result
    const result = await client.evaluate<string>(
      'document.querySelector("pre").textContent'
    );
    console.log('Form result:', result);

  } catch (error) {
    if (BrowserdError.isBrowserdError(error)) {
      console.error(`[${error.code}] ${error.message}`);
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  } finally {
    // Cleanup
    if (sandboxId) {
      console.log('Destroying sandbox...');
      await manager.destroy(sandboxId);
    }
  }
}

automateWebsite().catch(console.error);
```

## Testing the SDK

```bash
# Start browserd server locally
bun run dev

# Run SDK connection test
bun run scripts/test-sdk-connect.ts

# Custom server URL
bun run scripts/test-sdk-connect.ts ws://localhost:3001/ws
```
