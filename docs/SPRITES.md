# Sprites.dev Integration

This document covers the integration of browserd with [sprites.dev](https://sprites.dev), a platform for persistent, hardware-isolated Linux environments.

## Table of Contents

- [Overview](#overview)
- [Key Concepts](#key-concepts)
- [SpritesSandboxProvider](#spritessandboxprovider)
- [CLI Reference](#cli-reference)
- [JavaScript SDK](#javascript-sdk)
- [Important Discoveries](#important-discoveries)
- [Pricing](#pricing)
- [References](#references)

---

## Overview

Sprites.dev provides hardware-isolated execution environments (Firecracker VMs) for running arbitrary code. Unlike traditional serverless functions, sprites maintain filesystem and memory state between invocations.

### Why Sprites for Browserd?

| Feature | Benefit for Browserd |
|---------|---------------------|
| Persistent filesystem | Browser cache, cookies, and state persist across sessions |
| Full Linux environment | Ubuntu 25.04 with bun pre-installed |
| Automatic hibernation | Cost-efficient - no charges when idle |
| Checkpoint/restore | Instant cold starts from pre-configured state |
| Hardware isolation | Secure browser execution in isolated VMs |
| HTTPS URLs | Each sprite gets a unique public URL |

### Base Environment

- **OS**: Ubuntu 25.04
- **Runtime**: Bun pre-installed at `/.sprite/bin/bun`
- **User**: `sprite` (home: `/home/sprite`)
- **Sudo**: Available without password

---

## Key Concepts

### Sprites

A sprite is a persistent Linux computer that:
- Has a standard ext4 filesystem
- Maintains state between invocations
- Auto-hibernates after 30 seconds of inactivity (configurable)
- Wakes instantly on HTTP request or CLI access
- Gets a unique HTTPS URL (e.g., `https://sb1-bk7ow.sprites.app`)

### Services

Long-running processes managed by the sprite runtime via `sprite-env` CLI:
- Auto-restart on failure
- Persist through hibernation/wake cycles
- One service can have `--http-port` for HTTP routing via sprite URL
- Created via `sprite-env services create <name> --cmd <cmd> --args <args>`
- See: https://docs.sprites.dev/concepts/services/

### Checkpoints

Snapshots of sprite state:
- Fast creation (~300ms)
- Copy-on-write restoration
- Preserves installed packages, files, and system state
- Useful for instant cold starts with pre-installed dependencies

### HTTP Proxy vs Port Forwarding

**CRITICAL**: The sprite HTTPS URL proxy does NOT support WebSocket connections.

| Access Method | HTTP | WebSocket | Use Case |
|--------------|------|-----------|----------|
| Sprite URL (`https://xxx.sprites.app`) | Yes | **NO** | Health checks, HTTP APIs |
| Port forwarding (`sprite proxy`) | Yes | Yes | Full browser control |

For browserd's real-time browser control, you **must** use port forwarding.

---

## SpritesSandboxProvider

The `SpritesSandboxProvider` provisions browserd instances on sprites.dev infrastructure.

### Installation

```bash
bun add @fly/sprites
```

### Dependency Check

The provider requires the `sprite` CLI for WebSocket connectivity. Check dependencies before use:

```typescript
import { SpritesSandboxProvider } from 'browserd/sdk';

// Check if all dependencies are available
const { available, message } = await SpritesSandboxProvider.checkDependencies();
if (!available) {
  console.error(message);
  console.log('See https://docs.sprites.dev for installation instructions');
  process.exit(1);
}

// Individual checks
const cliInstalled = await SpritesSandboxProvider.isCliInstalled();
const cliAuthenticated = await SpritesSandboxProvider.isCliAuthenticated();
```

### Basic Usage

```typescript
import { SandboxManager, SpritesSandboxProvider } from 'browserd/sdk';

// Reuse existing sprite
const provider = new SpritesSandboxProvider({
  spriteName: 'my-sprite',
  autoSetup: true,
});

const manager = new SandboxManager({ provider });
const { client, sandbox } = await manager.create();

await client.navigate('https://example.com');
const screenshot = await client.screenshot();

await manager.destroy(sandbox.id);
```

### Provider Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | `SPRITE_TOKEN` env | API token from sprites.dev |
| `spriteName` | `string` | - | Existing sprite to reuse (creates new if not provided) |
| `checkpointId` | `string` | - | Checkpoint to restore before starting |
| `autoSetup` | `boolean` | `true` | Auto-install Chromium and dependencies if missing |
| `createCheckpointAfterSetup` | `boolean` | `true` | Create checkpoint after installing deps |
| `headed` | `boolean` | `true` | Run browser with Xvfb (visual rendering) |
| `readyTimeout` | `number` | `120000` | Timeout for health check (ms) |
| `debug` | `boolean` | `false` | Enable verbose logging |
| `blobBaseUrl` | `string` | - | URL to download browserd.tar.gz (uses local bundle if not set) |
| `useLocalProxy` | `boolean` | `true` | Start SSH tunnel for WebSocket connectivity |
| `localProxyPort` | `number` | auto | Local port for proxy (auto-assigned if not set) |
| `autoInstallCli` | `boolean` | `false` | Auto-install sprite CLI if not found (requires curl) |

### Lifecycle Modes

#### Mode 1: Reuse Existing Sprite

Best for development and testing - sprite persists between runs.

```typescript
const provider = new SpritesSandboxProvider({
  spriteName: 'browserd-dev',
  autoSetup: true,
  createCheckpointAfterSetup: true, // Save state after first setup
});
```

#### Mode 2: Create New Sprite

Creates a fresh sprite for each session - useful for isolation.

```typescript
const provider = new SpritesSandboxProvider({
  autoSetup: true,
  // spriteName not provided - creates browserd-{timestamp}-{random}
});
```

#### Mode 3: Restore from Checkpoint

Instant start from pre-configured state.

```typescript
const provider = new SpritesSandboxProvider({
  spriteName: 'browserd-dev',
  checkpointId: 'browserd-deps-ready',
  autoSetup: false, // Skip - deps already in checkpoint
});
```

### Output URLs

After `manager.create()`, the `sandbox` object contains:

```typescript
{
  id: 'sprite-xxx',
  domain: 'https://sb1-bk7ow.sprites.app',  // HTTP access
  wsUrl: 'ws://localhost:59596/ws',          // WebSocket via local proxy
  status: 'ready'
}
```

---

## CLI Reference

### Installation

```bash
curl -fsSL https://sprites.dev/install.sh | sh
```

### Authentication

**Option 1: Interactive Login**
```bash
sprite login
# Opens browser for authentication
# Token stored in system keyring or ~/.config/sprite/
```

**Option 2: Environment Variable (CI/CD)**
```bash
export SPRITE_TOKEN=spr_xxxxxxxxxxxxx
# CLI uses this as fallback when no stored token is available
# Get your token from https://sprites.dev/account
```

### Common Commands

```bash
# Create a sprite
sprite create my-sprite

# List sprites
sprite list

# Execute command
sprite exec my-sprite -- ls -la

# Interactive shell
sprite shell my-sprite

# Port forwarding (REQUIRED for WebSocket)
sprite proxy -s my-sprite 3001:3000

# Delete sprite
sprite delete my-sprite
```

### Services Management

Services are managed via the `sprite-env` CLI (in PATH at `/.sprite/bin/sprite-env`).
See: https://docs.sprites.dev/concepts/services/

```bash
# Create a service with HTTP routing (inside sprite via exec or shell)
sprite-env services create browserd \
  --cmd bash \
  --args "-c,HEADLESS=false bun /home/sprite/browserd.js" \
  --http-port 3000 \
  --no-stream

# List services
sprite-env services list

# Get service status
sprite-env services get browserd

# Delete service
sprite-env services delete browserd

# Send signal to service
sprite-env services signal browserd TERM
```

**Note:** Only one service can have `--http-port` configured. The sprite URL routes HTTP requests to that port.

### Checkpoints

```bash
# Create checkpoint
sprite checkpoint create my-sprite --comment "browserd ready"

# List checkpoints
sprite checkpoint list my-sprite

# Restore checkpoint
sprite checkpoint restore my-sprite <checkpoint-id>
```

### URL Management

```bash
# View URL settings
sprite url show my-sprite

# Make URL public (required for external access)
sprite url update my-sprite --auth public

# Revert to authenticated
sprite url update my-sprite --auth sprite
```

### Proxy Command

```bash
# Forward single port
sprite proxy -s my-sprite 3001:3000

# Forward multiple ports
sprite proxy -s my-sprite 3001:3000 8081:8080

# Options
sprite proxy --help
```

---

## JavaScript SDK

### Installation

```bash
bun add @fly/sprites
```

### SpritesClient

```typescript
import { SpritesClient } from '@fly/sprites';

const client = new SpritesClient(process.env.SPRITE_TOKEN!);

// Get existing sprite
const sprite = await client.getSprite('my-sprite');

// Create new sprite
const newSprite = await client.createSprite('my-sprite', {
  ramMB: 512,
  cpus: 1,
  region: 'ord',
});

// List all sprites
const sprites = await client.listAllSprites();

// Delete sprite
await client.deleteSprite('my-sprite');
```

### Command Execution

```typescript
// Promise-based (recommended)
const { stdout, stderr, exitCode } = await sprite.exec('echo hello');

// With separate args (better for complex commands)
const result = await sprite.execFile('bash', ['-lc', 'bun --version']);

// Streaming output
const cmd = sprite.spawn('tail', ['-f', '/var/log/syslog']);
cmd.stdout.on('data', (chunk) => console.log(chunk.toString()));
cmd.on('exit', (code) => console.log('Exited:', code));
```

### Checkpoints

```typescript
// Create checkpoint (returns streaming Response)
const response = await sprite.createCheckpoint('my-checkpoint');
await response.text(); // Consume stream

// List checkpoints
const checkpoints = await sprite.listCheckpoints();

// Restore checkpoint
const restoreResponse = await sprite.restoreCheckpoint(checkpointId);
await restoreResponse.text();
```

### Important: URL Property

The `url` property is available on sprites returned from `getSprite()` or `createSprite()`, but it's not typed in the SDK. Access it via type assertion:

```typescript
interface SpriteWithUrl extends Sprite {
  url?: string;
}

const sprite = await client.getSprite('my-sprite') as SpriteWithUrl;
console.log(sprite.url); // https://xxx.sprites.app
```

---

## Important Discoveries

### WebSocket Limitation

**The sprite HTTPS URL proxy does NOT support WebSocket connections.**

- HTTP requests work fine through `https://xxx.sprites.app`
- WebSocket connections timeout/fail through the proxy
- Solution: Use `sprite proxy` CLI for SSH tunnel
- The provider automatically spawns `sprite proxy` when `useLocalProxy: true`

### PATH Issues

Commands run via `exec()` don't have the full PATH:
- `bun` is at `/.sprite/bin/bun`, not in default PATH
- Use `bash -lc "command"` for login shell with proper PATH
- Or use full paths: `/.sprite/bin/bun script.js`

### Sudo Without Password

```bash
sudo apt-get install -y package
sudo env PATH=$PATH bunx playwright install-deps chromium
```

### Service Environment

Services run outside login shell - use full paths or wrap in bash:

```bash
sprite-env services create myservice \
  --cmd bun \
  --args /home/sprite/script.js \
  --no-stream
```

### Xvfb for Headed Mode

For visual browser rendering:

```bash
Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
DISPLAY=:99 bun browserd.js
```

### Hibernation Behavior

- Sprites hibernate after 30s of inactivity
- First HTTP request wakes the sprite (2-3s latency)
- Services with `--http-port` auto-wake on requests
- WebSocket connections keep sprites awake

---

## Pricing

| Resource | Rate |
|----------|------|
| CPU Time | $0.07/vCPU/hour |
| Memory | $0.04375/GB RAM/hour |
| Storage | $0.50/GB/month |

- Compute billed per-second
- No charges during hibernation
- Storage prorated hourly
- Checkpoints count toward storage

---

## References

### Official Resources

- **Website**: https://sprites.dev
- **Documentation**: https://docs.sprites.dev
- **Account/API Tokens**: https://sprites.dev/account

### NPM Packages

- **SDK**: [@fly/sprites](https://www.npmjs.com/package/@fly/sprites)

### CLI Installation

```bash
curl -fsSL https://sprites.dev/install.sh | sh
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SPRITE_TOKEN` | API token for authentication (used by both SDK and CLI) |
| `SPRITES_TOKEN` | Alternative name (SDK accepts both) |
| `SPRITES_API_URL` | API endpoint URL (default: `https://api.sprites.dev`) |

**Note:** Setting `SPRITE_TOKEN` authenticates both the SDK and CLI automatically, making it ideal for CI/CD environments.

### Browserd-Specific Files

| File | Description |
|------|-------------|
| `src/sdk/providers/sprites.ts` | SpritesSandboxProvider implementation |
| `src/sdk/providers/types.ts` | Provider options interface |
| `scripts/test-sprites-provider.ts` | Test script for the provider |

---

## Troubleshooting

### "Sprite not found"

```
Error: Sprite 'xxx' not found. Create it first with: sprite create xxx
```

Create the sprite first or omit `spriteName` to auto-create.

### "WebSocket timeout"

Ensure `useLocalProxy: true` (default) or run `sprite proxy` manually.

### "Failed to install system deps"

Check sudo access and PATH:
```typescript
await sprite.execFile('bash', ['-lc', 'sudo env PATH=$PATH bunx playwright install-deps chromium']);
```

### "Bundle not found"

Run `bun run bundle` to create the browserd tarball, or provide `blobBaseUrl`.

### "Local proxy failed to start"

Ensure `sprite` CLI is installed and authenticated:
```bash
sprite login
sprite proxy -s my-sprite 3001:3000  # Test manually
```
