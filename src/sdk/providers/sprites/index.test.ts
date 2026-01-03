/**
 * SpritesSandboxProvider E2E Tests
 *
 * Tests the Sprites.dev provider against the SandboxProvider protocol.
 * Requires sprites.dev authentication and @fly/sprites package.
 *
 * IMPORTANT: These tests are NOT run as part of CI.
 * They require real sprites.dev infrastructure and will incur costs.
 * Run manually with: bun test src/sdk/providers/sprites/index.test.ts
 *
 * Prerequisites:
 * - @fly/sprites installed
 * - SPRITE_TOKEN environment variable set or `sprite login` completed
 * - Bundle tarball built: bun run bundle
 * - sprite CLI installed (for WebSocket proxy mode)
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
import { SpritesSandboxProvider } from "./index";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if @fly/sprites is available
 */
function hasSpritesPackage(): boolean {
	try {
		require.resolve("@fly/sprites");
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if SPRITE_TOKEN is set
 */
function hasSpriteToken(): boolean {
	return !!process.env.SPRITE_TOKEN;
}

/**
 * Check if bundle tarball exists
 */
function hasBundleTarball(): boolean {
	try {
		const file = Bun.file("bundle/browserd.tar.gz");
		return file.size > 0;
	} catch {
		return false;
	}
}

// Check availability at module load time
const spritesAvailable = hasSpritesPackage();
const tokenAvailable = hasSpriteToken();
const bundleAvailable = hasBundleTarball();
const canRunTests = spritesAvailable && tokenAvailable && bundleAvailable;

if (!spritesAvailable) {
	console.log(
		"[SKIP] @fly/sprites not installed - skipping SpritesSandboxProvider tests",
	);
} else if (!tokenAvailable) {
	console.log(
		"[SKIP] SPRITE_TOKEN not set - skipping SpritesSandboxProvider tests",
	);
} else if (!bundleAvailable) {
	console.log(
		"[SKIP] Bundle tarball not found - run 'bun run bundle' first",
	);
}

describe("SpritesSandboxProvider E2E", () => {
	describe("Static Methods", () => {
		test.skipIf(!spritesAvailable)(
			"isCliInstalled() returns boolean",
			async () => {
				const result = await SpritesSandboxProvider.isCliInstalled();
				expect(typeof result).toBe("boolean");
			},
		);

		test.skipIf(!spritesAvailable)(
			"isCliAuthenticated() returns boolean",
			async () => {
				const result = await SpritesSandboxProvider.isCliAuthenticated();
				expect(typeof result).toBe("boolean");
			},
		);

		test.skipIf(!spritesAvailable)(
			"checkDependencies() returns status object",
			async () => {
				const result = await SpritesSandboxProvider.checkDependencies();
				expect(result).toHaveProperty("available");
				expect(result).toHaveProperty("message");
				expect(typeof result.available).toBe("boolean");
				expect(typeof result.message).toBe("string");
			},
		);
	});

	describe("Provider Protocol Compliance", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
			// Give sprites time to clean up
			await sleep(2000);
		}, 120000);

		test.skipIf(!canRunTests)(
			"provider has correct name property",
			async () => {
				const provider = new SpritesSandboxProvider();
				expect(provider.name).toBe("sprites");
			},
		);

		test.skipIf(!canRunTests)(
			"create() returns valid SandboxInfo",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false, // Use SSE mode for simpler testing
					debug: true,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				// Verify SandboxInfo structure
				expect(sandbox.id).toBeDefined();
				expect(sandbox.domain).toMatch(/^https:\/\//);
				expect(sandbox.status).toBe("ready");
				expect(sandbox.createdAt).toBeGreaterThan(0);

				// In SSE mode, should have streamUrl and authToken
				if (!provider["useLocalProxy"]) {
					expect(sandbox.streamUrl).toBeDefined();
					expect(sandbox.transport).toBe("sse");
				}

				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"destroy() removes the sandbox",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();
				const sandboxId = sandbox.id;

				// Destroy and verify
				await manager.destroy(sandboxId);
				expect(manager.has(sandboxId)).toBe(false);

				// get() should return undefined
				const info = await provider.get(sandboxId);
				expect(info).toBeUndefined();
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"isReady() returns true for running sandbox",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				const ready = await provider.isReady(sandbox.id);
				expect(ready).toBe(true);

				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"isReady() returns false for unknown sandbox",
			async () => {
				const provider = new SpritesSandboxProvider();
				const ready = await provider.isReady("nonexistent-sandbox");
				expect(ready).toBe(false);
			},
		);

		test.skipIf(!canRunTests)(
			"get() returns sandbox info",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				const info = await provider.get(sandbox.id);
				expect(info).toBeDefined();
				expect(info?.id).toBe(sandbox.id);
				expect(info?.status).toBe("ready");

				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"get() returns undefined for unknown sandbox",
			async () => {
				const provider = new SpritesSandboxProvider();
				const info = await provider.get("nonexistent-sandbox");
				expect(info).toBeUndefined();
			},
		);
	});

	describe("Provider Lifecycle", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
			await sleep(2000);
		}, 120000);

		test.skipIf(!canRunTests)(
			"creates and destroys a sandbox (SSE mode)",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false, // SSE mode
				});

				manager = new SandboxManager({ provider });

				// Create sandbox
				const { sandbox, createSession } = await manager.create();

				expect(sandbox.id).toBeDefined();
				expect(sandbox.status).toBe("ready");
				expect(sandbox.domain).toMatch(/^https:\/\//);
				expect(sandbox.transport).toBe("sse");

				// Verify we can reach the health endpoint
				const healthResponse = await fetch(`${sandbox.domain}/health`, {
					headers: sandbox.authToken
						? { Authorization: `Bearer ${sandbox.authToken}` }
						: undefined,
				});
				expect(healthResponse.ok).toBe(true);

				// Create a session - returns connected client directly
				const session = await createSession();
				expect(session.sessionId).toBeDefined();
				expect(session.isConnected()).toBe(true);

				// Destroy sandbox
				await session.close();
				await manager.destroy(sandbox.id);
				expect(manager.has(sandbox.id)).toBe(false);
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"creates sandbox with local proxy (WebSocket mode)",
			async () => {
				// Check if CLI is available for local proxy mode
				const cliInstalled = await SpritesSandboxProvider.isCliInstalled();
				if (!cliInstalled) {
					console.log("[SKIP] sprite CLI not installed - skipping WebSocket mode test");
					return;
				}

				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: true, // WebSocket mode via SSH tunnel
				});

				manager = new SandboxManager({ provider });

				const { sandbox, createSession } = await manager.create();

				expect(sandbox.status).toBe("ready");
				expect(sandbox.transport).toBe("ws");
				// wsUrl should point to localhost when using local proxy
				expect(sandbox.wsUrl).toMatch(/^ws:\/\/localhost:\d+\/ws$/);

				// Create a session
				const session = await createSession();
				expect(session.isConnected()).toBe(true);

				await session.close();
				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);
	});

	describe("Browser Operations", () => {
		let manager: SandboxManager;
		let sandboxResult: CreateSandboxResult;
		let client: BrowserdClient;

		beforeAll(async () => {
			if (!canRunTests) return;

			const provider = new SpritesSandboxProvider({
				headed: true,
				useLocalProxy: false, // Use SSE mode for reliability
			});

			manager = new SandboxManager({ provider });
			sandboxResult = await manager.create();

			// Create a session - returns connected client directly
			client = await sandboxResult.createSession();
		}, 300000);

		afterAll(async () => {
			if (client) {
				await client.close().catch(() => {});
			}
			if (manager) {
				await manager.destroyAll().catch(() => {});
			}
			await sleep(2000);
		}, 120000);

		test.skipIf(!canRunTests)(
			"navigates to a URL",
			async () => {
				const result = await client.navigate(
					"data:text/html,<h1>Hello Sprites</h1>",
				);
				expect(result.url).toContain("data:text/html");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!canRunTests)(
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

		test.skipIf(!canRunTests)(
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

		test.skipIf(!canRunTests)(
			"fills form inputs",
			async () => {
				await client.navigate(
					"data:text/html,<input id='input' type='text' />",
				);
				await client.fill("#input", "Hello from Sprites");
				const result = await client.evaluate<string>(
					"document.getElementById('input').value",
				);
				expect(result).toBe("Hello from Sprites");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!canRunTests)(
			"takes screenshots",
			async () => {
				await client.navigate(
					"data:text/html,<div style='background:purple;width:100px;height:100px;'></div>",
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

		test.skipIf(!canRunTests)(
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

		test.skipIf(!canRunTests)(
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

		test.skipIf(!canRunTests)(
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

	describe("Configuration Options", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
			await sleep(2000);
		}, 120000);

		test.skipIf(!canRunTests)(
			"respects autoSetup option",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
					autoSetup: true,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				// Sandbox should be ready with dependencies installed
				expect(sandbox.status).toBe("ready");

				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"respects headed option (headed mode with Xvfb)",
			async () => {
				const provider = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
				});

				manager = new SandboxManager({ provider });
				const { sandbox, createSession } = await manager.create();

				expect(sandbox.status).toBe("ready");

				// Create session and verify browser works in headed mode
				const client = await createSession();
				await client.navigate("data:text/html,<h1>Headed Mode</h1>");
				const result = await client.evaluate<string>(
					"document.querySelector('h1').textContent",
				);
				expect(result).toBe("Headed Mode");

				await client.close();
				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);
	});

	describe("Sprite Reuse", () => {
		let existingSpriteName: string | null = null;
		let manager: SandboxManager | null = null;

		afterAll(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
			}
			await sleep(2000);
		}, 120000);

		test.skipIf(!canRunTests)(
			"can reuse an existing sprite by name",
			async () => {
				// Generate a unique sprite name
				existingSpriteName = `test-browserd-${Date.now()}`;

				// First, create a sandbox with this sprite name
				const provider1 = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
					spriteName: existingSpriteName,
				});

				manager = new SandboxManager({ provider: provider1 });
				const { sandbox } = await manager.create();
				const firstSandboxId = sandbox.id;

				// Verify it's ready
				expect(sandbox.status).toBe("ready");

				// Now destroy this instance (but keep the sprite running)
				await manager.destroy(firstSandboxId);

				// Create a new provider that reuses the same sprite
				const provider2 = new SpritesSandboxProvider({
					headed: true,
					useLocalProxy: false,
					spriteName: existingSpriteName,
				});

				const manager2 = new SandboxManager({ provider: provider2 });
				const result2 = await manager2.create();

				// Should reuse the same sprite
				expect(result2.sandbox.status).toBe("ready");

				// Cleanup
				await manager2.destroyAll();
			},
			{ timeout: 600000 },
		);
	});
});
