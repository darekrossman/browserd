/**
 * DockerContainerProvider E2E Tests
 *
 * Tests the Docker container provider against the SandboxProvider protocol.
 * Requires Docker to be installed and running (OrbStack recommended).
 *
 * IMPORTANT: These tests are NOT run as part of CI.
 * Run manually with: bun test src/sdk/providers/docker/index.test.ts
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
import type { BrowserdClient } from "../../client";
import { SandboxManager } from "../../sandbox-manager";
import type { CreateSandboxResult } from "../../types";
import { DockerContainerProvider } from "./index";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Check Docker availability at module load time (synchronous)
const dockerAvailable = hasDockerSupport();
const imageAvailable = dockerAvailable && hasDockerImage();

if (!dockerAvailable) {
	console.log(
		"[SKIP] Docker not available - skipping DockerContainerProvider tests",
	);
} else if (!imageAvailable) {
	console.log(
		"[INFO] Docker image 'browserd-sandbox' not found - will be built on first test",
	);
}

describe("DockerContainerProvider E2E", () => {
	describe("Provider Protocol Compliance", () => {
		let manager: SandboxManager | null = null;

		afterEach(async () => {
			if (manager) {
				await manager.destroyAll().catch(() => {});
				manager = null;
			}
			// Allow time for container cleanup
			await sleep(500);
		}, 30000);

		test.skipIf(!dockerAvailable)(
			"provider has correct name property",
			async () => {
				const provider = new DockerContainerProvider();
				expect(provider.name).toBe("docker");
			},
		);

		test.skipIf(!dockerAvailable)(
			"create() returns valid SandboxInfo",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				// Verify SandboxInfo structure
				expect(sandbox.id).toMatch(/^docker-/);
				expect(sandbox.domain).toMatch(
					/^http:\/\/browserd-.*\.orb\.local:3000$/,
				);
				expect(sandbox.wsUrl).toMatch(
					/^ws:\/\/browserd-.*\.orb\.local:3000\/ws$/,
				);
				expect(sandbox.status).toBe("ready");
				expect(sandbox.createdAt).toBeGreaterThan(0);

				await manager.destroy(sandbox.id);
			},
			{ timeout: 120000 },
		);

		test.skipIf(!dockerAvailable)(
			"destroy() removes the sandbox",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
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
			{ timeout: 120000 },
		);

		test.skipIf(!dockerAvailable)(
			"isReady() returns true for running sandbox",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				const ready = await provider.isReady(sandbox.id);
				expect(ready).toBe(true);

				await manager.destroy(sandbox.id);
			},
			{ timeout: 120000 },
		);

		test.skipIf(!dockerAvailable)(
			"isReady() returns false for unknown sandbox",
			async () => {
				const provider = new DockerContainerProvider();
				const ready = await provider.isReady("nonexistent-sandbox");
				expect(ready).toBe(false);
			},
		);

		test.skipIf(!dockerAvailable)(
			"get() returns sandbox info",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });
				const { sandbox } = await manager.create();

				const info = await provider.get(sandbox.id);
				expect(info).toBeDefined();
				expect(info?.id).toBe(sandbox.id);
				expect(info?.status).toBe("ready");

				await manager.destroy(sandbox.id);
			},
			{ timeout: 120000 },
		);

		test.skipIf(!dockerAvailable)(
			"get() returns undefined for unknown sandbox",
			async () => {
				const provider = new DockerContainerProvider();
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
			await sleep(500);
		}, 30000);

		test.skipIf(!dockerAvailable)(
			"creates and destroys a sandbox",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });

				// Create sandbox
				const { sandbox, createSession } = await manager.create();

				expect(sandbox.id).toMatch(/^docker-/);
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

				// Destroy sandbox
				await session.close();
				await manager.destroy(sandbox.id);
				expect(manager.has(sandbox.id)).toBe(false);
			},
			{ timeout: 120000 },
		);

		test.skipIf(!dockerAvailable)(
			"creates multiple concurrent instances with different hostnames",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
				});

				manager = new SandboxManager({ provider });

				// Create two sandboxes concurrently
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
			{ timeout: 180000 },
		);
	});

	describe("Browser Operations", () => {
		let manager: SandboxManager;
		let sandboxResult: CreateSandboxResult;
		let client: BrowserdClient;

		beforeAll(async () => {
			if (!dockerAvailable) return;

			const provider = new DockerContainerProvider({
				headed: false,
				readyTimeout: 60000,
			});

			manager = new SandboxManager({ provider });
			sandboxResult = await manager.create();

			// Create a session - returns connected client directly
			client = await sandboxResult.createSession();
		}, 120000);

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
				const provider = new DockerContainerProvider({
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
			{ timeout: 120000 },
		);
	});

	describe("Configuration Options", () => {
		test.skipIf(!dockerAvailable)(
			"respects custom containerNamePrefix",
			async () => {
				const provider = new DockerContainerProvider({
					headed: false,
					readyTimeout: 60000,
					containerNamePrefix: "test-browserd",
				});

				const manager = new SandboxManager({ provider });

				try {
					const { sandbox } = await manager.create();

					// Domain should use the custom prefix
					expect(sandbox.domain).toMatch(/test-browserd-/);

					await manager.destroy(sandbox.id);
				} finally {
					await manager.destroyAll().catch(() => {});
				}
			},
			{ timeout: 120000 },
		);
	});
});
