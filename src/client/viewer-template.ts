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
}

/**
 * Generate the viewer HTML page
 */
export function generateViewerHTML(options: ViewerOptions = {}): string {
	const {
		title = "Browserd Viewer",
		showControls = true,
		showStats = true,
	} = options;

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

      // URLs
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = wsProtocol + '//' + location.host + '/ws';
      const streamUrl = location.protocol + '//' + location.host + '/stream';
      const inputUrl = location.protocol + '//' + location.host + '/input';

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
