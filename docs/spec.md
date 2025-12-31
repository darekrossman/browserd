# spec.md — Simple Cloud Browser Service on Vercel Sandboxes (Headful Chromium + CDP Screencast + Remote Control)

## 1. Overview
Build a simple “cloud browser” service where each user session runs in its own Vercel Sandbox MicroVM and launches Chromium via Playwright in **headful** mode. The session streams live visuals using **Chrome DevTools Protocol (CDP) screencast** and allows remote control through:
- **Visual control** (mouse/keyboard) against the screencast view
- **High-level Playwright operations** (navigate/click/type/etc.) via a WebSocket RPC API

The sandbox runtime is **node24**, but the implementation uses **Bun for everything** inside the sandbox. We do **not** use Playwright’s `connectOverCDP()`.

---

## 2. Goals
- One browser session per sandbox (isolated per user/session)
- Headful Chromium with live visual streaming via CDP screencast
- Single WebSocket connection for:
  - screencast frames (server → client)
  - user input events (client → server)
  - Playwright RPC commands (client → server)
  - command results/errors (server → client)
- Authenticated session URLs and enforced timeouts/idle shutdown
- Minimal client UI: render frames + send mouse/keyboard + basic command bar

---

## 3. Non-goals (for v1)
- Multi-tab collaborative sessions
- WebRTC/VNC streaming (CDP screencast is enough)
- Exposing raw CDP publicly
- Persistent storage beyond session lifetime
- Advanced stealth/anti-bot evasion features

---

## 4. System Architecture

### 4.1 Control Plane (Vercel project / API routes)
Responsibilities:
- Authenticate the user
- Create/track/stop sandbox sessions
- Return connection info (WebSocket URL + token + metadata)
- Enforce policies (max sessions per user, TTL, idle timeout)
- Observability: session lifecycle + basic metrics

Core endpoints (example):
- `POST /api/sessions` — create a sandbox + start `browserd`
- `GET /api/sessions/:id` — status (running, lastActivity, expiresAt)
- `DELETE /api/sessions/:id` — stop sandbox session

Data stored (DB/kv):
- `sessionId`, `userId`, `sandboxId`
- `createdAt`, `expiresAt`, `idleTimeoutAt`
- `wsUrl`, `httpUrl` (optional), `capabilities`
- `revoked` flag, `lastActivity`

### 4.2 Data Plane (Per-sandbox process: `browserd`)
`browserd` = “browser daemon” running inside each sandbox. It:
- Runs Bun HTTP + WebSocket server
- Launches Chromium headful (local)
- Creates CDP session via Playwright `context.newCDPSession(page)`
- Starts CDP screencast and forwards frames to the client
- Translates visual input events (mouse/keyboard) into CDP `Input.dispatch*`
- Executes RPC commands on the `page` object
- Tracks activity, rate limits, and handles shutdown

### 4.3 Client (Web app)
Responsibilities:
- Connect to `browserd` WebSocket with session token
- Decode base64 JPEG frames and render into `<canvas>` or `<img>`
- Capture mouse/keyboard events on the rendered surface and send to server
- Provide UI for high-level commands (URL bar, click selector testing, etc.)

---

## 5. Network & Ports
Expose **one** port publicly per sandbox for v1:
- `3000` — Bun server (HTTP + WS)

Optionally add:
- `3001` — internal-only (not exposed) for debug hooks

No raw CDP port exposure.

---

## 6. Sandbox Bootstrap (node24 base, Bun runtime, rebrowser-playwright)

### 6.1 Key requirements
- Headful Chromium requires a virtual display: **Xvfb**
- Chromium requires a set of shared libraries (NSS/GTK/Pango/etc.)
- Installation should be **idempotent** (safe to re-run) and should verify the browser exists

### 6.2 Directory layout & marker files
Use a fixed service directory and marker file:
- `SERVICE_DIR=/vercel/sandbox/browser-service` (or similar writable path)
- `SETUP_MARKER=$SERVICE_DIR/.setup-complete`

Idempotency behavior:
- If `SETUP_MARKER` exists, set `PLAYWRIGHT_BROWSERS_PATH="$SERVICE_DIR/.playwright-browsers"`
- Verify `rebrowser-playwright` exists and Chromium `executablePath()` resolves to a file
- If verification fails, remove marker and redo setup

Why:
- Makes repeated starts within the same sandbox lifecycle fast and predictable.

### 6.3 Linux distro detection (for system deps)
Detect distro from `/etc/os-release`:
- `amzn|amazon` → treat as `amzn`
- `rhel|centos|rocky|almalinux|ol` → treat as `rhel`
- `fedora` → treat as `fedora`
- `debian|ubuntu|linuxmint|pop` → treat as `debian`
- otherwise: best-effort / no-op

This enables choosing `dnf/yum` vs `apt-get`.

### 6.4 Install Bun (only if missing)
If `bun` is not present:
- `curl -fsSL https://bun.sh/install | bash`
- `export BUN_INSTALL="$HOME/.bun"`
- `export PATH="$BUN_INSTALL/bin:$PATH"`

Note: the Bun installer typically needs `unzip` available on Linux; ensure it is installed before running the installer.

### 6.5 Install system deps for Chromium + Xvfb
Install the following packages (best-effort; ignore failures on some distros):

#### For Amazon Linux / RHEL / Fedora family (`dnf` or `yum`)
- `nss nspr atk at-spi2-atk cups-libs libdrm`
- `libxkbcommon mesa-libgbm alsa-lib`
- `libXcomposite libXdamage libXfixes libXrandr`
- `pango cairo liberation-fonts`
- `mesa-libEGL gtk3 dbus-glib libXScrnSaver`
- `xorg-x11-server-Xvfb`

#### For Debian/Ubuntu family (`apt-get`)
- `libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0`
- `libcups2 libdrm2 libxkbcommon0 libxcomposite1`
- `libxdamage1 libxfixes3 libxrandr2 libgbm1`
- `libasound2 libpango-1.0-0 libcairo2 fonts-liberation`
- `xvfb`

### 6.6 Install runtime deps + Chromium using rebrowser-playwright
Inside `SERVICE_DIR`:

1) Create `package.json`:
```json
{
  "name": "browser-service-runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "rebrowser-playwright": "^1.52.0",
    "ghost-cursor": "^1.4.1"
  }
}
```

2) Install JS deps:
- `bun install`

3) Install Chromium binaries into a local cache directory:
- `export PLAYWRIGHT_BROWSERS_PATH="$SERVICE_DIR/.playwright-browsers"`
- `mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"`
- `npx rebrowser-playwright-core install chromium`

4) Verify Chromium exists:
- `CHROMIUM_PATH=$(bun -e "console.log(require('rebrowser-playwright').chromium.executablePath())")`
- Fail setup if the path is missing or not a file.

5) `touch "$SETUP_MARKER"` when complete.

### 6.7 Start Xvfb + `browserd`
- Start display server:
  - `Xvfb :99 -screen 0 1280x720x24 &`
  - `export DISPLAY=:99`
- Start `browserd` (Bun server) on `0.0.0.0:3000`

The control plane should start `browserd` detached so it stays alive after bootstrap finishes.

---

## 7. Browser Runtime Model (Inside `browserd`)

### 7.1 Lifecycle
1. `browserd` starts
2. Launch browser (headful):
   - `chromium.launch({ headless: false, args: [...] })`
3. Create `context` and `page`
4. Create CDP session:
   - `cdp = await context.newCDPSession(page)`
5. Start screencast:
   - `Page.startScreencast({ format:"jpeg", quality, maxWidth, maxHeight, everyNthFrame })`
6. Serve clients:
   - On WS connect: authenticate, send `ready`, begin streaming frames
   - Accept `input` + `cmd` messages
7. Shutdown:
   - On idle timeout or explicit stop: stop screencast, close browser, exit process

### 7.2 Concurrency (v1)
- One viewer client per session (optional: allow multiple viewers read-only)
- One command queue to serialize Playwright operations

---

## 8. Streaming: CDP Screencast

### 8.1 Server flow
- Listen for `Page.screencastFrame`
- Forward a `frame` message to client:
  - `{ type:"frame", format:"jpeg", data:"<base64>", viewport, timestamp }`
- Acknowledge frame:
  - `Page.screencastFrameAck({ sessionId })`

### 8.2 Frame control
- Dynamic tuning:
  - quality (e.g. 60–80)
  - maxWidth/maxHeight
  - `everyNthFrame` to reduce FPS under load
- Backpressure strategy:
  - Drop frames when client lags (keep latest only)
  - Preserve responsiveness for input/commands

---

## 9. Remote Control

### 9.1 Visual Control (Input events)
Client sends pointer/keyboard events relative to the displayed viewport.

Mouse:
- move/down/up/wheel → CDP `Input.dispatchMouseEvent`

Keyboard:
- keydown/keyup/char → CDP `Input.dispatchKeyEvent`

Coordinate mapping:
- Client sends `(x,y)` in rendered surface space
- Server maps to real viewport using `viewport.w/h`, client scale, and DPR

### 9.2 High-level Playwright RPC (Commands)
Client may send semantic commands executed by Playwright on the `page` object.

Examples:
- `navigate(url)`
- `click(selector)` / `dblclick(selector)` / `hover(selector)`
- `type(selector, text)` / `press(selector, key)`
- `waitForSelector(selector, timeoutMs)`
- `setViewport({ width, height })`
- `evaluate({ expression })` (restricted)
- `screenshot()` (optional v1)

All commands:
- Execute through a single serialized queue
- Return `{ ok:true, result }` or `{ ok:false, error }`

---

## 10. WebSocket Protocol (Single multiplexed WS)

### 10.1 Client → Server
- Command: `{ id, type:"cmd", method, params }`
- Input: `{ type:"input", device:"mouse"|"key", action, ... }`
- Ping: `{ type:"ping", t }`

### 10.2 Server → Client
- Frame: `{ type:"frame", format:"jpeg", data, viewport:{ w,h,dpr }, timestamp }`
- Result:
  - `{ id, type:"result", ok:true, result }`
  - `{ id, type:"result", ok:false, error:{ message, stack? } }`
- Events: `{ type:"event", name:"ready"|"navigated"|"console"|"error", data }`
- Pong: `{ type:"pong", t }`

### 10.3 Ordering guarantees
- Frames are best-effort (may be dropped)
- Results preserve command ordering due to single command queue

---

## 11. Authentication & Security
- Control plane issues signed per-session token (HMAC/JWT: sessionId, userId, exp, nonce)
- `browserd` validates token at WS upgrade; deny unauthenticated requests
- Do NOT expose raw CDP endpoint publicly (CDP used internally via `newCDPSession`)
- Optional restrictions:
  - disable or restrict `evaluate`
  - URL allowlist/deny internal IP ranges to reduce SSRF risk
- Abuse controls:
  - rate limit input events + commands
  - cap session duration and idle time
  - max concurrent sessions per user

---

## 12. Observability & Operations
- Structured logs: sessionId, sandboxId, userId hash, cmd latency, fps, dropped frames, errors
- `GET /health` in `browserd`: browser running, last frame time, last command time
- Lifecycle management:
  - sandbox timeout + control-plane enforced expiry
  - reaper job stops expired/revoked/idle sessions

---

## 13. Implementation Milestones
M1 — Provision & Ready
- Control plane creates sandbox, runs setup, starts `browserd`
- Client connects and gets `ready`

M2 — Screencast Viewer
- CDP screencast streaming + frame drop/backpressure
- Client renders smoothly

M3 — Visual Control
- Mouse + keyboard input mapped correctly (scale/DPR)

M4 — Playwright RPC
- navigate/click/type/waitFor with serialized queue + results

M5 — Hardening
- token auth, rate limits, idle timeout, concurrency caps
- optional URL policies + restricted evaluate

---

## 14. Open Questions
- Exact Xvfb flags and best default screen size/DPR for quality vs cost
- Persisted session registry backend (KV/DB) and reaper scheduling approach
- Multi-viewer support (read-only spectators)
- Recording (frames + input + commands) for debugging
