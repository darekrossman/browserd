/**
 * LocalProvider E2E Tests
 *
 * Tests the Local provider against a real running browserd server.
 * Requires a browserd server to be running (e.g., `bun run dev`).
 *
 * IMPORTANT: These tests are NOT run as part of CI.
 * Run manually with: bun test src/sdk/providers/local/index.test.ts
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import type { BrowserdClient } from "../../client";
import { SandboxManager } from "../../sandbox-manager";
import type { CreateSandboxResult } from "../../types";
import { LocalProvider } from "./index";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if local browserd server is running (synchronous for test.skipIf)
 */
function hasLocalServer(): boolean {
	try {
		// Use synchronous fetch workaround via Bun.spawnSync
		const result = Bun.spawnSync(
			["curl", "-sf", "http://localhost:3000/readyz"],
			{
				stdout: "pipe",
				stderr: "pipe",
				timeout: 3000,
			},
		);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

// Check server availability at module load time (synchronous)
const serverAvailable = hasLocalServer();

if (!serverAvailable) {
	console.log(
		"[SKIP] Local browserd server not running - skipping LocalProvider tests",
	);
	console.log("[SKIP] Start the server with: bun run dev");
}

describe("LocalProvider E2E", () => {
	describe("Provider Lifecycle", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
		});

		test.skipIf(!serverAvailable)(
			"creates and destroys a sandbox",
			async () => {
				const provider = new LocalProvider({
					port: 3000,
					readyTimeout: 5000,
				});

				manager = new SandboxManager({ provider });

				// Create sandbox
				const { sandbox, createSession, destroySession } =
					await manager.create();

				expect(sandbox.id).toMatch(/^local-/);
				expect(sandbox.status).toBe("ready");
				expect(sandbox.wsUrl).toBe("ws://localhost:3000/ws");
				expect(sandbox.domain).toBe("http://localhost:3000");

				// Verify we can reach the health endpoint
				const healthResponse = await fetch(`${sandbox.domain}/readyz`);
				expect(healthResponse.ok).toBe(true);

				// Create a session - returns connected client directly
				const session = await createSession();
				expect(session.sessionId).toBeDefined();
				expect(session.isConnected()).toBe(true);

				// Destroy sandbox - close() destroys the session automatically
				await session.close();
				await manager.destroy(sandbox.id);
				expect(manager.has(sandbox.id)).toBe(false);
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"handles custom host and port",
			async () => {
				const provider = new LocalProvider({
					host: "127.0.0.1",
					port: 3000,
					readyTimeout: 5000,
				});

				manager = new SandboxManager({ provider });

				const { sandbox } = await manager.create();

				expect(sandbox.wsUrl).toBe("ws://127.0.0.1:3000/ws");
				expect(sandbox.domain).toBe("http://127.0.0.1:3000");

				await manager.destroy(sandbox.id);
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"reports error when server not available",
			async () => {
				const provider = new LocalProvider({
					port: 19999, // Port that should not be running
					readyTimeout: 2000,
				});

				manager = new SandboxManager({ provider });

				await expect(manager.create()).rejects.toThrow(
					/not responding.*readyz/i,
				);
			},
			{ timeout: 10000 },
		);

		test.skipIf(!serverAvailable)(
			"isReady returns true for healthy server",
			async () => {
				const provider = new LocalProvider({
					port: 3000,
					readyTimeout: 5000,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				const ready = await provider.isReady(sandbox.id);
				expect(ready).toBe(true);

				await manager.destroy(sandbox.id);
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"get returns sandbox info after create",
			async () => {
				const provider = new LocalProvider({
					port: 3000,
					readyTimeout: 5000,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				const info = await provider.get(sandbox.id);
				expect(info).toBeDefined();
				expect(info?.id).toBe(sandbox.id);
				expect(info?.status).toBe("ready");

				await manager.destroy(sandbox.id);
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"get returns undefined for unknown sandbox",
			async () => {
				const provider = new LocalProvider({
					port: 3000,
				});

				const info = await provider.get("nonexistent-sandbox");
				expect(info).toBeUndefined();
			},
			{ timeout: 5000 },
		);
	});

	describe("Browser Operations", () => {
		let manager: SandboxManager;
		let sandboxResult: CreateSandboxResult;
		let client: BrowserdClient;

		beforeAll(async () => {
			if (!serverAvailable) return;

			const provider = new LocalProvider({
				port: 3000,
				readyTimeout: 5000,
			});

			manager = new SandboxManager({ provider });
			sandboxResult = await manager.create();

			// Create a session - returns connected client directly
			client = await sandboxResult.createSession();
		}, 30000);

		afterAll(async () => {
			if (client) {
				await client.close().catch(() => {});
			}
			if (manager) {
				await manager.destroyAll().catch(() => {});
			}
		}, 30000);

		test.skipIf(!serverAvailable)(
			"navigates to a URL",
			async () => {
				const result = await client.navigate(
					"data:text/html,<h1>Hello World</h1>",
				);
				expect(result.url).toContain("data:text/html");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"executes evaluate command",
			async () => {
				await client.navigate("data:text/html,<h1>Test Page</h1>");
				const result = await client.evaluate<string>(
					"document.querySelector('h1').textContent",
				);
				expect(result).toBe("Test Page");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"clicks on elements",
			async () => {
				await client.navigate(
					`data:text/html,<button id="btn">Click</button><div id="result">0</div><script>let c=0;document.getElementById('btn').onclick=()=>{c++;document.getElementById('result').textContent=c;}</script>`,
				);
				await client.click("#btn");
				const result = await client.evaluate<string>(
					"document.getElementById('result').textContent",
				);
				expect(result).toBe("1");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"fills form inputs",
			async () => {
				await client.navigate(
					"data:text/html,<input id='input' type='text' />",
				);
				await client.fill("#input", "Hello from SDK");
				const result = await client.evaluate<string>(
					"document.getElementById('input').value",
				);
				expect(result).toBe("Hello from SDK");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"takes screenshots",
			async () => {
				await client.navigate(
					"data:text/html,<div style='background:blue;width:100px;height:100px;'></div>",
				);
				const screenshot = await client.screenshot({ type: "png" });

				expect(screenshot.format).toBe("png");
				expect(screenshot.data.length).toBeGreaterThan(100);

				// Verify PNG signature
				const buffer = Buffer.from(screenshot.data, "base64");
				expect(buffer[0]).toBe(0x89);
				expect(buffer[1]).toBe(0x50); // P
				expect(buffer[2]).toBe(0x4e); // N
				expect(buffer[3]).toBe(0x47); // G
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"types into elements",
			async () => {
				await client.navigate(
					"data:text/html,<input id='input' type='text' />",
				);
				await client.click("#input");
				await client.type("#input", "Typed text");
				const result = await client.evaluate<string>(
					"document.getElementById('input').value",
				);
				expect(result).toBe("Typed text");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"waits for selectors",
			async () => {
				await client.navigate(
					`data:text/html,<div id="container"></div><script>setTimeout(() => { document.getElementById('container').innerHTML = '<span id="delayed">Loaded</span>'; }, 500);</script>`,
				);
				await client.waitForSelector("#delayed", { timeout: 5000 });
				const result = await client.evaluate<string>(
					"document.getElementById('delayed').textContent",
				);
				expect(result).toBe("Loaded");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!serverAvailable)(
			"throws error when element not found",
			async () => {
				await client.navigate("data:text/html,<div>Empty</div>");
				expect(
					client.click("#nonexistent", { timeout: 1000 }),
				).rejects.toThrow();
			},
			{ timeout: 30000 },
		);
	});

	describe("Multiple Sessions", () => {
		test.skipIf(!serverAvailable)(
			"creates multiple sessions on the same server",
			async () => {
				const provider = new LocalProvider({
					port: 3000,
					readyTimeout: 5000,
				});

				const manager = new SandboxManager({ provider });

				try {
					const { sandbox, createSession } = await manager.create();

					// Create two sessions
					const session1 = await createSession();
					const session2 = await createSession();

					expect(session1.sessionId).toBeDefined();
					expect(session2.sessionId).toBeDefined();
					expect(session1.sessionId).not.toBe(session2.sessionId);

					// Both should be connected
					expect(session1.isConnected()).toBe(true);
					expect(session2.isConnected()).toBe(true);

					// Navigate each to different pages
					await session1.navigate("data:text/html,<h1>Session 1</h1>");
					await session2.navigate("data:text/html,<h1>Session 2</h1>");

					// Verify they have different content
					const content1 = await session1.evaluate<string>(
						"document.body.innerHTML",
					);
					const content2 = await session2.evaluate<string>(
						"document.body.innerHTML",
					);

					expect(content1).toContain("Session 1");
					expect(content2).toContain("Session 2");

					// Close sessions
					await session1.close();
					await session2.close();
				} finally {
					await manager.destroyAll().catch(() => {});
				}
			},
			{ timeout: 60000 },
		);
	});
});
