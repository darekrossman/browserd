/**
 * Viewer Template Generator
 *
 * Generates HTML/JS for the browser viewer client
 */

export interface ViewerOptions {
	wsUrl?: string;
	title?: string;
	showControls?: boolean;
	showStats?: boolean;
	/** Session ID to connect to (optional, defaults to "default") */
	sessionId?: string;
}

/**
 * Generate the viewer HTML page
 */
export function generateViewerHTML(options: ViewerOptions = {}): string {
	const {
		title = "Browserd Viewer",
		showControls = true,
		showStats = true,
		sessionId = "default",
	} = options;

	// Build session-specific or legacy paths
	const wsPath = sessionId === "default" ? "/ws" : `/sessions/${sessionId}/ws`;
	const streamPath =
		sessionId === "default" ? "/stream" : `/sessions/${sessionId}/stream`;
	const inputPath =
		sessionId === "default" ? "/input" : `/sessions/${sessionId}/input`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', 'Droid Sans Mono', 'Source Code Pro', monospace;
      background: #0a0a0a;
      color: #888;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 12px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      background: #0f0f0f;
      border-bottom: 1px solid #1a1a1a;
    }

    .header h1 {
      font-size: 11px;
      font-weight: 500;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .url-bar {
      flex: 1;
      display: flex;
      gap: 6px;
    }

    .url-bar input {
      flex: 1;
      padding: 6px 10px;
      background: #0a0a0a;
      border: 1px solid #1a1a1a;
      color: #aaa;
      font-family: inherit;
      font-size: 12px;
    }

    .url-bar input::placeholder {
      color: #444;
    }

    .url-bar input:focus {
      outline: none;
      border-color: #333;
      color: #ccc;
    }

    .url-bar button {
      padding: 6px 14px;
      background: #1a1a1a;
      border: 1px solid #222;
      color: #777;
      font-family: inherit;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      cursor: pointer;
    }

    .url-bar button:hover {
      background: #222;
      color: #999;
      border-color: #333;
    }

    .nav-buttons {
      display: flex;
      gap: 2px;
    }

    .nav-buttons button {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid #1a1a1a;
      color: #555;
      cursor: pointer;
      font-size: 14px;
    }

    .nav-buttons button:hover {
      background: #1a1a1a;
      color: #888;
      border-color: #222;
    }

    .main {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 12px;
      overflow: hidden;
      min-height: 0;
      background: #080808;
    }

    .viewer-container {
      position: relative;
      background: #000;
      border: 1px solid #1a1a1a;
      overflow: hidden;
      max-width: 100%;
      max-height: 100%;
    }

    #viewer {
      display: block;
      cursor: default;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-left: auto;
    }

    .stats {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 10px;
    }

    .stats .stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .stats .label {
      color: #444;
    }

    .stats .value {
      color: #666;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      padding-left: 12px;
      border-left: 1px solid #1a1a1a;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4a2c2c;
    }

    .status-dot.connected {
      background: #2c4a2c;
    }

    .status-dot.connecting {
      background: #4a3c2c;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header class="header">
    <h1>Browserd</h1>
    ${
			showControls
				? `
    <div class="nav-buttons">
      <button id="back" title="Go Back">&#8592;</button>
      <button id="forward" title="Go Forward">&#8594;</button>
      <button id="reload" title="Reload">&#8635;</button>
    </div>
    <div class="url-bar">
      <input type="text" id="url" placeholder="Enter URL..." />
      <button id="go">Go</button>
    </div>
    `
				: ""
		}
    <div class="header-right">
      ${
				showStats
					? `
      <div class="stats">
        <div class="stat"><span class="label">Size</span> <span class="value" id="size">1280x720</span></div>
      </div>
      `
					: ""
			}
      <div class="status">
        <div class="status-dot" id="status-dot"></div>
        <span id="status-text">Disconnected</span>
      </div>
    </div>
  </header>

  <main class="main">
    <div class="viewer-container">
      <canvas id="viewer" width="1280" height="720"></canvas>
    </div>
  </main>

  <script>
    (function() {
      // Elements
      const canvas = document.getElementById('viewer');
      const ctx = canvas.getContext('2d');
      const viewerContainer = document.querySelector('.viewer-container');
      const mainContainer = document.querySelector('.main');
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      ${showStats ? "const sizeEl = document.getElementById('size');" : ""}
      ${showControls ? "const urlInput = document.getElementById('url');" : ""}

      // State
      let ws = null;
      let eventSource = null;
      let transport = 'ws';  // 'ws' or 'sse'
      let connected = false;
      let viewport = { w: 1280, h: 720, dpr: 1 };

      // Resize canvas display to fit available space while maintaining aspect ratio
      function resizeCanvasDisplay() {
        const padding = 32; // 1rem padding on each side
        const availableWidth = mainContainer.clientWidth - padding;
        const availableHeight = mainContainer.clientHeight - padding;

        if (availableWidth <= 0 || availableHeight <= 0) return;

        const viewportAspect = viewport.w / viewport.h;
        const availableAspect = availableWidth / availableHeight;

        let displayWidth, displayHeight;

        if (viewportAspect > availableAspect) {
          // Viewport is wider than available space - fit to width
          displayWidth = availableWidth;
          displayHeight = availableWidth / viewportAspect;
        } else {
          // Viewport is taller than available space - fit to height
          displayHeight = availableHeight;
          displayWidth = availableHeight * viewportAspect;
        }

        // Apply CSS dimensions for display scaling
        canvas.style.width = Math.round(displayWidth) + 'px';
        canvas.style.height = Math.round(displayHeight) + 'px';
      }

      // Handle window resize
      window.addEventListener('resize', resizeCanvasDisplay);

      // Initial resize
      resizeCanvasDisplay();

      // URLs (session-specific)
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = wsProtocol + '//' + location.host + '${wsPath}';
      const streamUrl = location.protocol + '//' + location.host + '${streamPath}';
      const inputUrl = location.protocol + '//' + location.host + '${inputPath}';

      // Check for forced transport via query param
      const urlParams = new URLSearchParams(location.search);
      const forcedTransport = urlParams.get('transport');

      // Connect using appropriate transport
      async function connect() {
        if (forcedTransport === 'sse') {
          transport = 'sse';
          connectSSE();
          return;
        }

        if (forcedTransport === 'ws') {
          transport = 'ws';
          connectWebSocket();
          return;
        }

        // Auto-detect: try WebSocket first, fall back to SSE
        try {
          await connectWebSocketWithTimeout();
          transport = 'ws';
        } catch (err) {
          console.log('WebSocket unavailable, falling back to SSE:', err.message);
          transport = 'sse';
          connectSSE();
        }
      }

      // Connect to WebSocket with timeout
      function connectWebSocketWithTimeout() {
        return new Promise((resolve, reject) => {
          setStatus('connecting');
          ws = new WebSocket(wsUrl);

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket connection timeout'));
          }, 3000);

          ws.onopen = () => {
            clearTimeout(timeout);
            setStatus('connected');
            // Start ping interval
            setInterval(sendPing, 5000);
            resolve();
          };

          ws.onerror = (err) => {
            clearTimeout(timeout);
            reject(new Error('WebSocket error'));
          };

          ws.onclose = () => {
            if (connected) {
              setStatus('disconnected');
              // Reconnect after delay
              setTimeout(() => connectWebSocket(), 2000);
            }
          };

          ws.onmessage = (event) => {
            handleMessage(JSON.parse(event.data));
          };
        });
      }

      // Connect to WebSocket (without timeout, for reconnects)
      function connectWebSocket() {
        setStatus('connecting');
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setStatus('connected');
        };

        ws.onclose = () => {
          setStatus('disconnected');
          // Reconnect after delay
          setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = (err) => {
          console.error('WebSocket error:', err);
        };

        ws.onmessage = (event) => {
          handleMessage(JSON.parse(event.data));
        };
      }

      // Connect via Server-Sent Events
      function connectSSE() {
        setStatus('connecting');
        statusText.textContent = 'Connecting (SSE)';

        eventSource = new EventSource(streamUrl);

        eventSource.onopen = () => {
          setStatus('connected');
          statusText.textContent = 'Connected (SSE)';
        };

        eventSource.onmessage = (event) => {
          try {
            handleMessage(JSON.parse(event.data));
          } catch (err) {
            console.error('Failed to parse SSE message:', err);
          }
        };

        eventSource.onerror = () => {
          if (connected) {
            setStatus('disconnected');
            statusText.textContent = 'Reconnecting (SSE)';
          }
          // EventSource auto-reconnects
        };

        // Handle custom events
        eventSource.addEventListener('connected', (event) => {
          const data = JSON.parse(event.data);
          console.log('SSE connected:', data.clientId);
        });
      }

      // Handle incoming message
      function handleMessage(msg) {
        switch (msg.type) {
          case 'frame':
            renderFrame(msg);
            break;
          case 'pong':
            // Latency measurement received (not displayed)
            break;
          case 'event':
            handleEvent(msg);
            break;
          case 'result':
            console.log('Command result:', msg);
            break;
        }
      }

      // Render frame to canvas
      function renderFrame(frame) {
        const img = new Image();
        img.onload = () => {
          // Update canvas size if needed
          if (canvas.width !== frame.viewport.w || canvas.height !== frame.viewport.h) {
            canvas.width = frame.viewport.w;
            canvas.height = frame.viewport.h;
            viewport = frame.viewport;
            ${showStats ? "sizeEl.textContent = frame.viewport.w + 'x' + frame.viewport.h;" : ""}
            // Recalculate display size for new viewport
            resizeCanvasDisplay();
          }
          ctx.drawImage(img, 0, 0);
        };
        img.src = 'data:image/jpeg;base64,' + frame.data;
      }

      // Handle events
      function handleEvent(event) {
        switch (event.name) {
          case 'ready':
            if (event.data?.viewport) {
              viewport = event.data.viewport;
              // Update canvas internal size and display size
              canvas.width = viewport.w;
              canvas.height = viewport.h;
              resizeCanvasDisplay();
            }
            break;
          case 'navigated':
            ${showControls ? "if (event.data?.url) urlInput.value = event.data.url;" : ""}
            break;
          case 'error':
            console.error('Browser error:', event.data);
            break;
        }
      }

      // Send ping for latency measurement
      function sendPing() {
        // Only WebSocket supports ping/pong for latency
        if (transport === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        }
        // SSE mode: latency measurement would require HTTP roundtrip, skip for now
      }

      // Set connection status
      function setStatus(status) {
        connected = status === 'connected';
        statusDot.className = 'status-dot ' + status;
        statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      }

      // Send command
      function sendCommand(method, params = {}) {
        const msg = {
          id: 'cmd-' + Date.now(),
          type: 'cmd',
          method,
          params
        };

        if (transport === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        } else if (transport === 'sse') {
          // HTTP POST for SSE mode
          fetch(inputUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg)
          }).then(res => res.json()).then(result => {
            if (result) handleMessage(result);
          }).catch(err => console.error('Command error:', err));
        }
      }

      // Send input event
      function sendInput(device, action, data = {}) {
        const msg = {
          type: 'input',
          device,
          action,
          ...data
        };

        if (transport === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        } else if (transport === 'sse') {
          // HTTP POST for SSE mode (fire and forget for input)
          fetch(inputUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg)
          }).catch(err => console.error('Input error:', err));
        }
      }

      // Get scaled coordinates
      function getScaledCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: Math.round((e.clientX - rect.left) * scaleX),
          y: Math.round((e.clientY - rect.top) * scaleY)
        };
      }

      // Get modifiers
      function getModifiers(e) {
        return {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey
        };
      }

      // Mouse events
      canvas.addEventListener('mousemove', (e) => {
        const coords = getScaledCoords(e);
        sendInput('mouse', 'move', coords);
      });

      canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const coords = getScaledCoords(e);
        const button = ['left', 'middle', 'right'][e.button] || 'left';
        sendInput('mouse', 'down', { ...coords, button, modifiers: getModifiers(e) });
      });

      canvas.addEventListener('mouseup', (e) => {
        e.preventDefault();
        const coords = getScaledCoords(e);
        const button = ['left', 'middle', 'right'][e.button] || 'left';
        sendInput('mouse', 'up', { ...coords, button, modifiers: getModifiers(e) });
      });

      canvas.addEventListener('click', (e) => {
        e.preventDefault();
        const coords = getScaledCoords(e);
        sendInput('mouse', 'click', { ...coords, button: 'left', clickCount: 1, modifiers: getModifiers(e) });
      });

      canvas.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const coords = getScaledCoords(e);
        sendInput('mouse', 'dblclick', { ...coords, button: 'left', modifiers: getModifiers(e) });
      });

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const coords = getScaledCoords(e);
        sendInput('mouse', 'wheel', { ...coords, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: getModifiers(e) });
      }, { passive: false });

      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });

      // Keyboard events (when canvas is focused)
      canvas.tabIndex = 0;

      canvas.addEventListener('keydown', (e) => {
        e.preventDefault();
        sendInput('key', 'down', {
          key: e.key,
          code: e.code,
          text: e.key.length === 1 ? e.key : '',
          modifiers: getModifiers(e)
        });
      });

      canvas.addEventListener('keyup', (e) => {
        e.preventDefault();
        sendInput('key', 'up', {
          key: e.key,
          code: e.code,
          modifiers: getModifiers(e)
        });
      });

      ${
				showControls
					? `
      // Navigation controls
      document.getElementById('back').addEventListener('click', () => sendCommand('goBack'));
      document.getElementById('forward').addEventListener('click', () => sendCommand('goForward'));
      document.getElementById('reload').addEventListener('click', () => sendCommand('reload'));

      document.getElementById('go').addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
          sendCommand('navigate', { url: url.startsWith('http') ? url : 'https://' + url });
        }
      });

      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('go').click();
        }
      });
      `
					: ""
			}

      // Start connection
      connect();

      // Focus canvas for keyboard input
      canvas.focus();
    })();
  </script>
</body>
</html>`;
}

/**
 * Create Response with viewer HTML
 */
export function createViewerResponse(options?: ViewerOptions): Response {
	return new Response(generateViewerHTML(options), {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-cache",
		},
	});
}

export interface GridViewerOptions {
	title?: string;
}

/**
 * Generate the grid viewer HTML page showing all sessions
 */
export function generateGridViewerHTML(
	options: GridViewerOptions = {},
): string {
	const { title = "Browserd - All Sessions" } = options;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', 'Droid Sans Mono', 'Source Code Pro', monospace;
      background: #0a0a0a;
      color: #888;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 12px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      background: #0f0f0f;
      border-bottom: 1px solid #1a1a1a;
    }

    .header h1 {
      font-size: 11px;
      font-weight: 500;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-left: auto;
    }

    .session-count {
      font-size: 10px;
      color: #666;
    }

    .main {
      flex: 1;
      padding: 16px;
      overflow: auto;
    }

    .grid-container {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 50vh;
      color: #555;
    }

    .empty-state h2 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .empty-state p {
      font-size: 11px;
      color: #444;
    }

    .session-cell {
      position: relative;
      background: #111;
      border: 1px solid #1a1a1a;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      text-decoration: none;
      display: block;
      transition: border-color 0.15s, transform 0.15s;
    }

    .session-cell:hover {
      border-color: #333;
      transform: scale(1.01);
    }

    .session-cell:hover .session-label {
      background: rgba(0, 0, 0, 0.85);
    }

    .canvas-wrapper {
      aspect-ratio: 16/9;
      background: #0a0a0a;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .canvas-wrapper canvas {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .session-label {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.15s;
    }

    .session-id {
      font-size: 10px;
      color: #888;
      font-family: inherit;
    }

    .session-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4a2c2c;
    }

    .status-dot.connected {
      background: #2c4a2c;
    }

    .status-dot.connecting {
      background: #4a3c2c;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #444;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>Browserd Sessions</h1>
    <div class="header-right">
      <span class="session-count" id="session-count">Loading...</span>
    </div>
  </header>

  <main class="main">
    <div class="grid-container" id="grid"></div>
  </main>

  <script>
    (function() {
      const grid = document.getElementById('grid');
      const sessionCountEl = document.getElementById('session-count');

      // Track sessions and their connections
      const sessions = new Map(); // sessionId -> { connection, canvas, ctx, transport }

      // Check for forced transport via query param
      const urlParams = new URLSearchParams(location.search);
      const forcedTransport = urlParams.get('transport');

      // WebSocket protocol
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

      // Fetch and update sessions
      async function fetchSessions() {
        try {
          const response = await fetch('/api/sessions');
          const data = await response.json();
          return data.sessions || [];
        } catch (err) {
          console.error('Failed to fetch sessions:', err);
          return [];
        }
      }

      // Create session cell element
      function createSessionCell(session) {
        const cell = document.createElement('a');
        cell.href = '/sessions/' + session.id + '/viewer';
        cell.className = 'session-cell';
        cell.id = 'cell-' + session.id;

        const wrapper = document.createElement('div');
        wrapper.className = 'canvas-wrapper';

        const canvas = document.createElement('canvas');
        canvas.width = session.viewport?.width || 1280;
        canvas.height = session.viewport?.height || 720;
        wrapper.appendChild(canvas);

        const label = document.createElement('div');
        label.className = 'session-label';
        label.innerHTML = \`
          <span class="session-id">\${session.id}</span>
          <span class="session-status">
            <span class="status-dot connecting" id="dot-\${session.id}"></span>
          </span>
        \`;

        cell.appendChild(wrapper);
        cell.appendChild(label);

        return { cell, canvas };
      }

      // Set status dot for a session
      function setSessionStatus(sessionId, status) {
        const dot = document.getElementById('dot-' + sessionId);
        if (dot) {
          dot.className = 'status-dot ' + status;
        }
      }

      // Handle incoming message for a session
      function handleSessionMessage(sessionId, canvas, msg) {
        if (msg.type === 'frame') {
          const ctx = canvas.getContext('2d');
          const img = new Image();
          img.onload = () => {
            if (canvas.width !== msg.viewport.w || canvas.height !== msg.viewport.h) {
              canvas.width = msg.viewport.w;
              canvas.height = msg.viewport.h;
            }
            ctx.drawImage(img, 0, 0);
          };
          img.src = 'data:image/jpeg;base64,' + msg.data;
        }
      }

      // Connect via WebSocket with timeout
      function connectWebSocket(sessionId, canvas) {
        return new Promise((resolve, reject) => {
          const wsUrl = wsProtocol + '//' + location.host + '/sessions/' + sessionId + '/ws';
          const ws = new WebSocket(wsUrl);

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket connection timeout'));
          }, 3000);

          ws.onopen = () => {
            clearTimeout(timeout);
            setSessionStatus(sessionId, 'connected');
            resolve({ type: 'ws', connection: ws });
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('WebSocket error'));
          };

          ws.onclose = () => {
            const session = sessions.get(sessionId);
            if (session && session.transport === 'ws') {
              setSessionStatus(sessionId, 'connecting');
              // Reconnect after delay
              setTimeout(() => {
                if (sessions.has(sessionId)) {
                  connectToSession(sessionId, canvas);
                }
              }, 2000);
            }
          };

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              handleSessionMessage(sessionId, canvas, msg);
            } catch (err) {
              console.error('Failed to parse WebSocket message:', err);
            }
          };
        });
      }

      // Connect via SSE
      function connectSSE(sessionId, canvas) {
        const streamUrl = '/sessions/' + sessionId + '/stream';
        const eventSource = new EventSource(streamUrl);

        eventSource.onopen = () => {
          setSessionStatus(sessionId, 'connected');
        };

        eventSource.onerror = () => {
          setSessionStatus(sessionId, 'connecting');
          // EventSource auto-reconnects
        };

        eventSource.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleSessionMessage(sessionId, canvas, msg);
          } catch (err) {
            console.error('Failed to parse SSE message:', err);
          }
        };

        return { type: 'sse', connection: eventSource };
      }

      // Connect to session stream (auto-detect transport)
      async function connectToSession(sessionId, canvas) {
        // If forced transport, use that
        if (forcedTransport === 'sse') {
          const result = connectSSE(sessionId, canvas);
          return { ...result, transport: 'sse' };
        }

        if (forcedTransport === 'ws') {
          try {
            const result = await connectWebSocket(sessionId, canvas);
            return { ...result, transport: 'ws' };
          } catch (err) {
            console.error('WebSocket forced but failed:', err);
            setSessionStatus(sessionId, 'connecting');
            return null;
          }
        }

        // Auto-detect: try WebSocket first, fall back to SSE
        try {
          const result = await connectWebSocket(sessionId, canvas);
          return { ...result, transport: 'ws' };
        } catch (err) {
          console.log('WebSocket unavailable for session ' + sessionId + ', using SSE:', err.message);
          const result = connectSSE(sessionId, canvas);
          return { ...result, transport: 'sse' };
        }
      }

      // Close a session connection
      function closeConnection(sessionData) {
        if (!sessionData || !sessionData.connection) return;
        if (sessionData.transport === 'ws') {
          sessionData.connection.close();
        } else if (sessionData.transport === 'sse') {
          sessionData.connection.close();
        }
      }

      // Update grid with sessions
      async function updateGrid() {
        const sessionList = await fetchSessions();
        const currentIds = new Set(sessionList.map(s => s.id));

        // Remove sessions that no longer exist
        for (const [id, sessionData] of sessions) {
          if (!currentIds.has(id)) {
            closeConnection(sessionData);
            const cell = document.getElementById('cell-' + id);
            if (cell) cell.remove();
            sessions.delete(id);
          }
        }

        // Add new sessions
        for (const session of sessionList) {
          if (!sessions.has(session.id)) {
            const { cell, canvas } = createSessionCell(session);
            grid.appendChild(cell);
            const connectionData = await connectToSession(session.id, canvas);
            if (connectionData) {
              sessions.set(session.id, { ...connectionData, canvas });
            }
          }
        }

        // Update count
        sessionCountEl.textContent = sessions.size + ' session' + (sessions.size === 1 ? '' : 's');

        // Show empty state if no sessions
        if (sessions.size === 0 && !document.querySelector('.empty-state')) {
          grid.innerHTML = \`
            <div class="empty-state">
              <h2>No Active Sessions</h2>
              <p>Create a session via POST /api/sessions</p>
            </div>
          \`;
        } else if (sessions.size > 0) {
          const emptyState = grid.querySelector('.empty-state');
          if (emptyState) emptyState.remove();
        }
      }

      // Initial load
      updateGrid();

      // Poll for changes every 3 seconds
      setInterval(updateGrid, 3000);
    })();
  </script>
</body>
</html>`;
}

/**
 * Create Response with grid viewer HTML
 */
export function createGridViewerResponse(
	options?: GridViewerOptions,
): Response {
	return new Response(generateGridViewerHTML(options), {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-cache",
		},
	});
}
