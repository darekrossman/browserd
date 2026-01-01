/**
 * End-to-End Tests
 *
 * Full flow tests with no mocking (run in container)
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createViewerResponse } from "../../src/client/viewer-template";
import type { PlaywrightMethod } from "../../src/protocol/types";
import {
	createHealthResponse,
	createLivenessResponse,
	createReadinessResponse,
} from "../../src/server/health";
import {
	createSessionManager,
	type SessionManager,
} from "../../src/server/session-manager";
import {
	createWebSocketData,
	MultiSessionWSHandler,
	type WebSocketData,
} from "../../src/server/ws-handler";
import { hasBrowserSupport, sleep } from "../helpers/setup";
import { TestWSClient } from "../helpers/ws-client";

/**
 * Result type for evaluate command
 */
interface EvaluateResult {
	result: unknown;
}

const runTests = hasBrowserSupport();
const TEST_PORT = 3000;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}/ws`;

describe("E2E Full Flow", () => {
	let server: ReturnType<typeof Bun.serve> | null = null;
	let sessionManager: SessionManager | null = null;
	let wsHandler: MultiSessionWSHandler | null = null;

	beforeAll(async () => {
		if (!runTests) return;

		// Create and initialize session manager
		sessionManager = createSessionManager();
		await sessionManager.initialize();

		// Create default session
		const defaultSession = await sessionManager.getOrCreateDefault();

		// Create WS handler with session manager
		wsHandler = new MultiSessionWSHandler({
			sessionManager,
			onCommand: async (ws, cmd, session) => {
				const result = await session.commandQueue.enqueue(cmd);
				wsHandler?.send(ws, result);
			},
		});

		// Start server
		server = Bun.serve<WebSocketData>({
			port: TEST_PORT,
			hostname: "0.0.0.0",
			async fetch(req, server) {
				const url = new URL(req.url);
				const path = url.pathname;

				// WebSocket upgrade
				if (path === "/ws") {
					const upgraded = server.upgrade(req, {
						data: createWebSocketData("default"),
					});
					return upgraded
						? undefined
						: new Response("Upgrade failed", { status: 400 });
				}

				// Health endpoints
				if (path === "/health") return createHealthResponse(sessionManager);
				if (path === "/livez") return createLivenessResponse();
				if (path === "/readyz") return createReadinessResponse(sessionManager);

				// Viewer
				if (path === "/" || path === "/viewer") return createViewerResponse();

				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open(ws) {
					wsHandler?.handleOpen(ws);
				},
				message(ws, message) {
					wsHandler?.handleMessage(ws, message);
				},
				close(ws, code, reason) {
					wsHandler?.handleClose(ws, code, reason);
				},
			},
		});
	});

	afterAll(async () => {
		try {
			if (server) server.stop();
		} catch {
			/* ignore */
		}
		try {
			if (wsHandler) await wsHandler.close().catch(() => {});
		} catch {
			/* ignore */
		}
		try {
			if (sessionManager) await sessionManager.close().catch(() => {});
		} catch {
			/* ignore */
		}
	});

	describe("Test 1: Basic viewing flow", () => {
		test.skipIf(!runTests)("connects and receives frames", async () => {
			const client = new TestWSClient({ url: WS_URL, timeout: 10000 });

			await client.connect();
			expect(client.isConnected()).toBe(true);

			// Wait for ready event
			const readyEvent = await client.waitForEvent("ready", 5000);
			expect(readyEvent.name).toBe("ready");
			expect(readyEvent.data).toHaveProperty("viewport");

			// Wait for frames
			const frames = await client.waitForFrames(3, 5000);
			expect(frames.length).toBeGreaterThanOrEqual(3);

			// Verify frame structure
			const frame = frames[0];
			expect(frame.type).toBe("frame");
			expect(frame.format).toBe("jpeg");
			expect(frame.data.length).toBeGreaterThan(100);

			// Verify JPEG data
			const buffer = Buffer.from(frame.data, "base64");
			expect(buffer[0]).toBe(0xff);
			expect(buffer[1]).toBe(0xd8);

			await client.close();
		});

		test.skipIf(!runTests)("handles ping/pong", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Send ping
			const pingTime = Date.now();
			client.sendPing();

			// Wait for pong
			await sleep(100);

			const messages = client.getMessages();
			const pong = messages.pongs.find((p) => p.t >= pingTime - 100);
			expect(pong).toBeDefined();

			await client.close();
		});

		test.skipIf(!runTests)("disconnects cleanly", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();
			expect(client.isConnected()).toBe(true);

			await client.close();
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("Test 2: Input control flow", () => {
		test.skipIf(!runTests)("processes mouse input", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Navigate to test page
			const navId = client.sendCommand("navigate", {
				url: `data:text/html,
          <button id="btn" style="width:100px;height:50px;position:absolute;left:100px;top:100px;">
            Click
          </button>
          <div id="result">Not clicked</div>
          <script>
            document.getElementById('btn').onclick = () => {
              document.getElementById('result').textContent = 'Clicked!';
            };
          </script>
        `,
			});

			await client.waitForResult(navId, 5000);

			// Send mouse click via input
			client.sendInput("mouse", "click", { x: 150, y: 125, button: "left" });

			await sleep(500);

			// Verify via evaluate
			const evalId = client.sendCommand("evaluate", {
				expression: "document.getElementById('result').textContent",
			});

			const evalResult = await client.waitForResult(evalId, 5000);
			expect(evalResult.ok).toBe(true);
			expect((evalResult.result as EvaluateResult).result).toBe("Clicked!");

			await client.close();
		});

		test.skipIf(!runTests)("processes keyboard input", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Navigate to test page
			const navId = client.sendCommand("navigate", {
				url: "data:text/html,<input id='input' type='text' autofocus />",
			});
			await client.waitForResult(navId, 5000);

			// Focus the input
			const focusId = client.sendCommand("click", { selector: "#input" });
			await client.waitForResult(focusId, 5000);

			// Type via keyboard input
			for (const char of "test") {
				client.sendInput("key", "press", {
					key: char,
					code: `Key${char.toUpperCase()}`,
					text: char,
				});
				await sleep(50);
			}

			await sleep(200);

			// Verify
			const evalId = client.sendCommand("evaluate", {
				expression: "document.getElementById('input').value",
			});

			const evalResult = await client.waitForResult(evalId, 5000);
			expect(evalResult.ok).toBe(true);
			expect((evalResult.result as EvaluateResult).result).toBe("test");

			await client.close();
		});
	});

	describe("Test 3: RPC command flow", () => {
		test.skipIf(!runTests)("executes navigate command", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			const id = client.sendCommand("navigate", {
				url: "data:text/html,<h1>Navigation Test</h1>",
			});

			const result = await client.waitForResult(id, 5000);
			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("url");

			await client.close();
		});

		test.skipIf(!runTests)("executes click command", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Setup page
			await client.waitForResult(
				client.sendCommand("navigate", {
					url: `data:text/html,
            <button id="btn">Click</button>
            <div id="result">0</div>
            <script>
              let count = 0;
              document.getElementById('btn').onclick = () => {
                count++;
                document.getElementById('result').textContent = count;
              };
            </script>
          `,
				}),
				5000,
			);

			// Click button
			const clickResult = await client.waitForResult(
				client.sendCommand("click", { selector: "#btn" }),
				5000,
			);
			expect(clickResult.ok).toBe(true);

			// Verify
			const evalResult = await client.waitForResult(
				client.sendCommand("evaluate", {
					expression: "document.getElementById('result').textContent",
				}),
				5000,
			);
			expect((evalResult.result as EvaluateResult).result).toBe("1");

			await client.close();
		});

		test.skipIf(!runTests)("executes type command", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Setup page
			await client.waitForResult(
				client.sendCommand("navigate", {
					url: "data:text/html,<input id='input' />",
				}),
				5000,
			);

			// Type text
			const typeResult = await client.waitForResult(
				client.sendCommand("type", { selector: "#input", text: "hello world" }),
				5000,
			);
			expect(typeResult.ok).toBe(true);

			// Verify
			const evalResult = await client.waitForResult(
				client.sendCommand("evaluate", {
					expression: "document.getElementById('input').value",
				}),
				5000,
			);
			expect((evalResult.result as EvaluateResult).result).toBe("hello world");

			await client.close();
		});
	});

	describe("Test 4: Full interaction sequence", () => {
		test.skipIf(!runTests)("completes form submission flow", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Navigate to form page
			await client.waitForResult(
				client.sendCommand("navigate", {
					url: `data:text/html,
            <form id="form">
              <input id="name" type="text" name="name" placeholder="Name" />
              <input id="email" type="email" name="email" placeholder="Email" />
              <button type="submit">Submit</button>
            </form>
            <div id="result">Not submitted</div>
            <script>
              document.getElementById('form').onsubmit = (e) => {
                e.preventDefault();
                const name = document.getElementById('name').value;
                const email = document.getElementById('email').value;
                document.getElementById('result').textContent = name + ':' + email;
              };
            </script>
          `,
				}),
				5000,
			);

			// Fill name using RPC
			await client.waitForResult(
				client.sendCommand("fill", { selector: "#name", value: "John Doe" }),
				5000,
			);

			// Fill email using type
			await client.waitForResult(
				client.sendCommand("type", {
					selector: "#email",
					text: "john@example.com",
				}),
				5000,
			);

			// Submit form by pressing Enter
			await client.waitForResult(
				client.sendCommand("press", { selector: "#email", key: "Enter" }),
				5000,
			);

			await sleep(200);

			// Verify submission
			const evalResult = await client.waitForResult(
				client.sendCommand("evaluate", {
					expression: "document.getElementById('result').textContent",
				}),
				5000,
			);
			expect((evalResult.result as EvaluateResult).result).toBe(
				"John Doe:john@example.com",
			);

			await client.close();
		});

		test.skipIf(!runTests)("handles navigation history", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Navigate to page 1
			await client.waitForResult(
				client.sendCommand("navigate", {
					url: "data:text/html,<h1>Page 1</h1>",
				}),
				5000,
			);

			// Navigate to page 2
			await client.waitForResult(
				client.sendCommand("navigate", {
					url: "data:text/html,<h1>Page 2</h1>",
				}),
				5000,
			);

			// Go back
			const backResult = await client.waitForResult(
				client.sendCommand("goBack", {}),
				5000,
			);
			expect(backResult.ok).toBe(true);

			// Verify on page 1
			let evalResult = await client.waitForResult(
				client.sendCommand("evaluate", {
					expression: "document.querySelector('h1').textContent",
				}),
				5000,
			);
			expect((evalResult.result as EvaluateResult).result).toBe("Page 1");

			// Go forward
			await client.waitForResult(client.sendCommand("goForward", {}), 5000);

			// Verify on page 2
			evalResult = await client.waitForResult(
				client.sendCommand("evaluate", {
					expression: "document.querySelector('h1').textContent",
				}),
				5000,
			);
			expect((evalResult.result as EvaluateResult).result).toBe("Page 2");

			await client.close();
		});
	});

	describe("Test 5: Error handling", () => {
		test.skipIf(!runTests)("returns error for invalid command", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			const result = await client.waitForResult(
				client.sendCommand("unknownMethod" as PlaywrightMethod, {}),
				5000,
			);

			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("UNKNOWN_METHOD");

			await client.close();
		});

		test.skipIf(!runTests)("returns error for missing selector", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			// Navigate to empty page
			await client.waitForResult(
				client.sendCommand("navigate", {
					url: "data:text/html,<div>Empty</div>",
				}),
				5000,
			);

			// Click non-existent element
			const result = await client.waitForResult(
				client.sendCommand("click", { selector: "#nonexistent", timeout: 500 }),
				5000,
			);

			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("TIMEOUT");

			await client.close();
		});

		test.skipIf(!runTests)("returns error for invalid navigation", async () => {
			const client = new TestWSClient({ url: WS_URL });

			await client.connect();

			const result = await client.waitForResult(
				client.sendCommand("navigate", { url: "invalid-protocol://test" }),
				5000,
			);

			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("NAVIGATION_ERROR");

			await client.close();
		});
	});
});
