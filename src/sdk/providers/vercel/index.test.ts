/**
 * VercelSandboxProvider E2E Tests
 *
 * Tests the Vercel Sandbox provider against the SandboxProvider protocol.
 * Requires Vercel Sandbox authentication and @vercel/sandbox package.
 *
 * IMPORTANT: These tests are NOT run as part of CI.
 * They require real Vercel infrastructure and will incur costs.
 * Run manually with: bun test src/sdk/providers/vercel/index.test.ts
 *
 * Prerequisites:
 * - @vercel/sandbox installed
 * - Valid Vercel authentication (VERCEL_TOKEN or logged in via CLI)
 * - Bundle tarball built: bun run bundle
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
import { VercelSandboxProvider } from "./index";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if Vercel sandbox is available
 */
function hasVercelSupport(): boolean {
	try {
		// Check if @vercel/sandbox is importable
		require.resolve("@vercel/sandbox");
		return true;
	} catch {
		return false;
	}
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
const vercelAvailable = hasVercelSupport();
const bundleAvailable = hasBundleTarball();
const canRunTests = vercelAvailable && bundleAvailable;

if (!vercelAvailable) {
	console.log(
		"[SKIP] @vercel/sandbox not installed - skipping VercelSandboxProvider tests",
	);
} else if (!bundleAvailable) {
	console.log(
		"[SKIP] Bundle tarball not found - run 'bun run bundle' first",
	);
}

describe("VercelSandboxProvider E2E", () => {
	describe("Provider Protocol Compliance", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
		}, 60000);

		test.skipIf(!canRunTests)(
			"provider has correct name property",
			async () => {
				const provider = new VercelSandboxProvider();
				expect(provider.name).toBe("vercel");
			},
		);

		test.skipIf(!canRunTests)(
			"create() returns valid SandboxInfo",
			async () => {
				const provider = new VercelSandboxProvider({
					headed: false,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				// Verify SandboxInfo structure
				expect(sandbox.id).toBeDefined();
				expect(sandbox.domain).toMatch(/^https:\/\//);
				expect(sandbox.wsUrl).toMatch(/^wss:\/\/.*\/ws$/);
				expect(sandbox.status).toBe("ready");
				expect(sandbox.createdAt).toBeGreaterThan(0);

				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);

		test.skipIf(!canRunTests)(
			"destroy() removes the sandbox",
			async () => {
				const provider = new VercelSandboxProvider({
					headed: false,
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
				const provider = new VercelSandboxProvider({
					headed: false,
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
				const provider = new VercelSandboxProvider();
				const ready = await provider.isReady("nonexistent-sandbox");
				expect(ready).toBe(false);
			},
		);

		test.skipIf(!canRunTests)(
			"get() returns sandbox info",
			async () => {
				const provider = new VercelSandboxProvider({
					headed: false,
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
				const provider = new VercelSandboxProvider();
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
		}, 60000);

		test.skipIf(!canRunTests)(
			"creates and destroys a sandbox",
			async () => {
				const provider = new VercelSandboxProvider({
					headed: false,
				});

				manager = new SandboxManager({ provider });

				// Create sandbox
				const { sandbox, createSession } = await manager.create();

				expect(sandbox.id).toBeDefined();
				expect(sandbox.status).toBe("ready");
				expect(sandbox.domain).toMatch(/^https:\/\//);
				expect(sandbox.wsUrl).toMatch(/^wss:\/\/.*\/ws$/);

				// Verify we can reach the health endpoint
				const healthResponse = await fetch(`${sandbox.domain}/readyz`);
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
			"creates multiple concurrent instances",
			async () => {
				const provider = new VercelSandboxProvider({
					headed: false,
				});

				manager = new SandboxManager({ provider });

				// Create two sandboxes concurrently
				const [result1, result2] = await Promise.all([
					manager.create(),
					manager.create(),
				]);

				// Verify different sandbox IDs
				expect(result1.sandbox.id).not.toBe(result2.sandbox.id);

				// Both should be ready
				expect(result1.sandbox.status).toBe("ready");
				expect(result2.sandbox.status).toBe("ready");

				// Verify both health endpoints
				const [health1, health2] = await Promise.all([
					fetch(`${result1.sandbox.domain}/readyz`),
					fetch(`${result2.sandbox.domain}/readyz`),
				]);
				expect(health1.ok).toBe(true);
				expect(health2.ok).toBe(true);

				// Cleanup
				await manager.destroyAll();
				expect(manager.size).toBe(0);
			},
			{ timeout: 600000 },
		);
	});

	describe("Browser Operations", () => {
		let manager: SandboxManager;
		let sandboxResult: CreateSandboxResult;
		let client: BrowserdClient;

		beforeAll(async () => {
			if (!canRunTests) return;

			const provider = new VercelSandboxProvider({
				headed: false,
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
		}, 60000);

		test.skipIf(!canRunTests)(
			"navigates to a URL",
			async () => {
				const result = await client.navigate(
					"data:text/html,<h1>Hello Vercel</h1>",
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
				await client.fill("#input", "Hello from Vercel");
				const result = await client.evaluate<string>(
					"document.getElementById('input').value",
				);
				expect(result).toBe("Hello from Vercel");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!canRunTests)(
			"takes screenshots",
			async () => {
				await client.navigate(
					"data:text/html,<div style='background:green;width:100px;height:100px;'></div>",
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
		}, 60000);

		test.skipIf(!canRunTests)(
			"respects custom runtime",
			async () => {
				const provider = new VercelSandboxProvider({
					headed: false,
					runtime: "node24",
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				// Sandbox should be ready
				expect(sandbox.status).toBe("ready");

				await manager.destroy(sandbox.id);
			},
			{ timeout: 300000 },
		);
	});

	describe("Sandbox Reuse", () => {
		let reusableSandboxId: string | null = null;
		let manager: SandboxManager | null = null;

		afterAll(async () => {
			if (manager && reusableSandboxId) {
				await manager.destroy(reusableSandboxId).catch(() => {});
			}
		}, 60000);

		test.skipIf(!canRunTests)(
			"can reuse an existing sandbox",
			async () => {
				// First, create a sandbox
				const provider1 = new VercelSandboxProvider({
					headed: false,
				});

				manager = new SandboxManager({ provider: provider1 });
				const { sandbox } = await manager.create();
				reusableSandboxId = sandbox.id;

				// Now try to reuse it
				const provider2 = new VercelSandboxProvider({
					headed: false,
					sandboxId: reusableSandboxId,
				});

				const manager2 = new SandboxManager({ provider: provider2 });
				const result2 = await manager2.create();

				// Should get the same sandbox ID
				expect(result2.sandbox.id).toBe(reusableSandboxId);
				expect(result2.sandbox.status).toBe("ready");

				// Cleanup - don't destroy here, let afterAll handle it
				await manager2.destroyAll();
			},
			{ timeout: 300000 },
		);
	});
});
