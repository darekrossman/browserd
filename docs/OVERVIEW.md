# Browserd Architecture Overview

## The Two Core Components

### SandboxManager vs BrowserdClient

| Component | Role | Responsibility |
|-----------|------|----------------|
| **SandboxManager** | Infrastructure orchestrator | Provisions sandboxes (containers), manages lifecycle, creates connected clients |
| **BrowserdClient** | Browser control client | WebSocket-based RPC client for sending commands to remote browserd server |

**Relationship**: SandboxManager creates and manages BrowserdClient instances. When you call `manager.create()`, it provisions a sandbox via the provider AND creates a connected BrowserdClient for you.

---

## SDK User Flow

```
1. User creates SandboxManager with a provider
   ↓
2. manager.create() provisions sandbox (container spins up with browserd server)
   ↓
3. SandboxManager creates BrowserdClient, connects to container's WebSocket
   ↓
4. User gets back { client, sandbox } - ready to use
   ↓
5. User calls client.navigate(), client.click(), client.fill(), etc.
   ↓
6. User calls manager.destroy(sandboxId) OR automated cleanup
```

**Code Example:**
```typescript
const manager = new SandboxManager({
  provider: new VercelSandboxProvider({ blobBaseUrl: '...' }),
});

const { client, sandbox } = await manager.create();
await client.navigate('https://example.com');
await client.click('button#submit');
await manager.destroy(sandbox.id);
```

---

## How Browserd Gets Into the Container

### Provider 1: Local Docker (Development)

**How it works:**
1. Docker container starts with `browserd-sandbox` image
2. **Source code is mounted** as a volume: `-v ${workingDir}:/vercel/sandbox`
3. Container runs `bun run dev` (which executes `bun --watch run src/server/index.ts`)
4. Uses OrbStack DNS (`container-name.orb.local`) for routing - no port conflicts

**Key insight:** No copying or downloading - it mounts the local browserd source directory directly.

```
Host                          Container
/packages/browserd/ -----→ /vercel/sandbox/
                           └─→ bun run dev
```

### Provider 2: Vercel Sandbox (Production)

**How it works:**
1. Vercel sandbox is created (empty node24 environment)
2. Install script is downloaded and executed from blob storage
3. Tarball (browserd.tar.gz) is downloaded and extracted
4. Dependencies installed: `bun install --production`
5. Playwright Chromium installed: `bunx playwright install chromium`
6. Server started: `bun run src/server/index.ts`

**Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    Vercel Blob Storage                          │
│  ┌─────────────────┐         ┌─────────────────────────────┐   │
│  │ install.sh      │         │ browserd.tar.gz             │   │
│  │ (bootstrap)     │         │ - src/                      │   │
│  └────────┬────────┘         │ - package.json              │   │
│           │                  │ - tsconfig.json             │   │
│           ↓                  └──────────────┬──────────────┘   │
│  curl | sh                                  │                   │
│           │                                 ↓                   │
│           └──── downloads ────→ tar xz ────→ browserd/         │
│                                             │                   │
└─────────────────────────────────────────────│───────────────────┘
                                              │
                                              ↓
                              ┌───────────────────────────────┐
                              │      Vercel Sandbox           │
                              │  1. bun install --production  │
                              │  2. bunx playwright install   │
                              │  3. bun run src/server/...    │
                              │  4. polls /readyz until ready │
                              └───────────────────────────────┘
```

---

## Deployment Artifacts

**Built by:** `bun run build:tarball` (runs `scripts/build-tarball.sh`)

**Output:** `dist/` directory containing:
- `browserd.tar.gz` - Full source bundle
- `install.sh` - Bootstrap script

**Tarball contents:**
```
browserd/
├── src/           # Full TypeScript source
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SDK Consumer                                   │
│                                                                          │
│   const manager = new SandboxManager({ provider });                     │
│   const { client, sandbox } = await manager.create();                   │
│   await client.navigate('...');                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
        ┌───────────────────────┐     ┌───────────────────────┐
        │   SandboxManager      │     │   BrowserdClient       │
        │   - create()          │────→│   - connect()          │
        │   - destroy()         │     │   - navigate()         │
        │   - list()            │     │   - click()            │
        │   - get()             │     │   - fill()             │
        └───────────┬───────────┘     │   - screenshot()       │
                    │                 └───────────┬────────────┘
                    │                             │
         uses provider                     WebSocket
                    │                             │
    ┌───────────────┴───────────────┐             │
    │                               │             │
    ▼                               ▼             │
┌──────────────┐         ┌──────────────┐        │
│ LocalProvider│         │ VercelProvider│        │
│ (Docker)     │         │ (@vercel/    │        │
│              │         │  sandbox)    │        │
└──────┬───────┘         └──────┬───────┘        │
       │                        │                │
       │ docker run             │ Sandbox.create │
       │ + mount src            │ + install.sh   │
       │                        │                │
       ▼                        ▼                │
┌─────────────────────────────────────────┐      │
│          Sandbox/Container              │      │
│  ┌────────────────────────────────┐    │      │
│  │      Browserd Server           │←───│──────┘
│  │   (src/server/index.ts)        │    │
│  │                                │    │
│  │  ┌──────────────────────────┐ │    │
│  │  │ BrowserManager           │ │    │
│  │  │ (rebrowser-playwright)   │ │    │
│  │  │ - Chromium lifecycle     │ │    │
│  │  │ - Stealth/anti-detection │ │    │
│  │  └──────────────────────────┘ │    │
│  │                                │    │
│  │  ┌──────────────────────────┐ │    │
│  │  │ CommandQueue             │ │    │
│  │  │ - Playwright RPC         │ │    │
│  │  │ - navigate/click/fill    │ │    │
│  │  └──────────────────────────┘ │    │
│  │                                │    │
│  │  ┌──────────────────────────┐ │    │
│  │  │ WSHandler + CDP Session  │ │    │
│  │  │ - WebSocket routing      │ │    │
│  │  │ - Screencast streaming   │ │    │
│  │  │ - Input dispatch         │ │    │
│  │  └──────────────────────────┘ │    │
│  │                                │    │
│  │  Health: /readyz /livez       │    │
│  └────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/sdk/sandbox-manager.ts` | Provider-agnostic sandbox + client lifecycle |
| `src/sdk/client.ts` | BrowserdClient - WebSocket RPC client |
| `src/sdk/providers/vercel.ts` | Vercel Sandbox provider |
| `src/sdk/providers/local.ts` | Local Docker provider |
| `src/server/index.ts` | Server entry point |
| `scripts/install.sh` | Bootstrap script for Vercel |
| `scripts/build-tarball.sh` | Creates deployment tarball |
| `Dockerfile.sandbox-node` | Docker image definition |
