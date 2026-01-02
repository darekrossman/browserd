/**
 * LocalSandboxProvider E2E Tests
 *
 * Tests the local Docker provider with real Docker containers.
 * Requires Docker to be installed and running.
 *
 * Run with: bun test tests/e2e/local-provider.test.ts
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import type { BrowserdClient } from "../../src/sdk/client";
import { LocalSandboxProvider } from "../../src/sdk/providers/local";
import { SandboxManager } from "../../src/sdk/sandbox-manager";
import type { CreateSandboxResult } from "../../src/sdk/types";
import { sleep } from "../helpers/setup";

/**
 * Check if Docker is available (synchronous for test.skipIf)
 */
function hasDockerSupport(): boolean {
	try {
		const result = spawnSync("docker", ["info"], {
			stdio: "pipe",
			timeout: 5000,
		});
		return result.status === 0;
	} catch {
		return false;
	}
}

/**
 * Check if the browserd-sandbox image exists
 */
function hasDockerImage(): boolean {
	try {
		const result = spawnSync("docker", ["images", "-q", "browserd-sandbox"], {
			stdio: "pipe",
			timeout: 5000,
		});
		return result.status === 0 && result.stdout.toString().trim().length > 0;
	} catch {
		return false;
	}
}

// Check Docker availability at module load time (synchronous)
const dockerAvailable = hasDockerSupport();
const imageAvailable = dockerAvailable && hasDockerImage();

if (!dockerAvailable) {
	console.log(
		"[SKIP] Docker not available - skipping LocalSandboxProvider tests",
	);
} else if (!imageAvailable) {
	console.log(
		"[INFO] Docker image 'browserd-sandbox' not found - will be built on first test",
	);
}

describe("LocalSandboxProvider E2E", () => {
	describe("Provider Lifecycle", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
			// Allow time for container cleanup
			await sleep(500);
		}, 30000); // Container cleanup can take time

		test.skipIf(!dockerAvailable)(
			"creates and destroys a sandbox",
			async () => {
				const provider = new LocalSandboxProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });

				// Create sandbox
				const { sandbox, createSession, destroySession } =
					await manager.create();

				expect(sandbox.id).toMatch(/^local-/);
				expect(sandbox.status).toBe("ready");
				// Uses OrbStack DNS: container-name.orb.local:3000
				expect(sandbox.wsUrl).toMatch(
					/^ws:\/\/browserd-.*\.orb\.local:3000\/ws$/,
				);
				expect(sandbox.domain).toMatch(
					/^http:\/\/browserd-.*\.orb\.local:3000$/,
				);

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
			{ timeout: 60000 }, // 3 minute timeout for potential image build
		);

		test.skipIf(!dockerAvailable)(
			"creates multiple concurrent instances with different hostnames",
			async () => {
				const provider = new LocalSandboxProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });

				// Create two sandboxes
				const [result1, result2] = await Promise.all([
					manager.create(),
					manager.create(),
				]);

				// Verify different hostnames (OrbStack DNS: container-name.orb.local)
				const host1 = new URL(result1.sandbox.domain).hostname;
				const host2 = new URL(result2.sandbox.domain).hostname;
				expect(host1).not.toBe(host2);
				expect(host1).toMatch(/\.orb\.local$/);
				expect(host2).toMatch(/\.orb\.local$/);

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
			{ timeout: 60000 },
		);
	});

	describe("Browser Operations", () => {
		let manager: SandboxManager;
		let sandboxResult: CreateSandboxResult;
		let client: BrowserdClient;

		beforeAll(async () => {
			if (!dockerAvailable) return;

			const provider = new LocalSandboxProvider({
				headed: false,
				readyTimeout: 60000,
			});

			manager = new SandboxManager({ provider });
			sandboxResult = await manager.create();

			// Create a session - returns connected client directly
			client = await sandboxResult.createSession();
		}, 60000);

		afterAll(async () => {
			if (client) {
				await client.close().catch(() => {});
			}
			if (manager) {
				await manager.destroyAll().catch(() => {});
			}
		}, 30000);

		test.skipIf(!dockerAvailable)(
			"navigates to a URL",
			async () => {
				const result = await client.navigate(
					"data:text/html,<h1>Hello World</h1>",
				);
				expect(result.url).toContain("data:text/html");
			},
			{ timeout: 30000 },
		);

		test.skipIf(!dockerAvailable)(
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

		test.skipIf(!dockerAvailable)(
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

		test.skipIf(!dockerAvailable)(
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

		test.skipIf(!dockerAvailable)(
			"takes screenshots",
			async () => {
				await client.navigate(
					"data:text/html,<div style='background:red;width:100px;height:100px;'></div>",
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

		test.skipIf(!dockerAvailable)(
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

	describe("Headed Mode", () => {
		test.skipIf(!dockerAvailable)(
			"creates sandbox in headed mode with Xvfb",
			async () => {
				const provider = new LocalSandboxProvider({
					headed: true,
					readyTimeout: 60000,
				});

				const manager = new SandboxManager({ provider });

				try {
					const { sandbox, createSession } = await manager.create();

					expect(sandbox.status).toBe("ready");

					// Create session - returns connected client directly
					const client = await createSession();
					expect(client.isConnected()).toBe(true);

					// Should work the same as headless
					await client.navigate("data:text/html,<h1>Headed Mode</h1>");
					const result = await client.evaluate<string>(
						"document.querySelector('h1').textContent",
					);

					expect(result).toBe("Headed Mode");

					await client.close();
				} finally {
					// Cleanup inline - headed containers take longer to stop
					await manager.destroyAll().catch(() => {});
					await sleep(1000);
				}
			},
			{ timeout: 60000 },
		);
	});
});
