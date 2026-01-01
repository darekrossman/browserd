/**
 * SDK Resilience and Error Handling Tests
 *
 * Tests the SDK's resilience features including:
 * - Connection timeout handling
 * - Command timeout handling
 * - Error recovery
 * - Connection state tracking
 *
 * Run with: bun test tests/e2e/sdk-resilience.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { BrowserdClient, BrowserdError } from "../../src/sdk";
import { hasBrowserSupport, sleep } from "../helpers/setup";

const SERVER_PORT = 3097;
const SERVER_URL = `ws://localhost:${SERVER_PORT}/ws`;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/readyz`;
const INVALID_URL = "ws://localhost:59999/ws"; // Non-existent server
const STARTUP_TIMEOUT = 30000;

const runTests = hasBrowserSupport();

let serverProcess: Subprocess | null = null;

async function startServer(): Promise<void> {
	serverProcess = Bun.spawn({
		cmd: ["bun", "run", "src/server/index.ts"],
		cwd: process.cwd(),
		env: {
			...process.env,
			PORT: String(SERVER_PORT),
			HEADLESS: "true",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	const deadline = Date.now() + STARTUP_TIMEOUT;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(HEALTH_URL, {
				signal: AbortSignal.timeout(1000),
			});
			if (response.ok) {
				return;
			}
		} catch {
			// Server not ready yet
		}
		await sleep(500);
	}

	throw new Error(`Server did not start within ${STARTUP_TIMEOUT}ms`);
}

async function stopServer(): Promise<void> {
	if (serverProcess) {
		serverProcess.kill();
		serverProcess = null;
	}
}

describe("SDK Resilience", () => {
	beforeAll(async () => {
		if (!runTests) return;
		await startServer();
	});

	afterAll(async () => {
		await stopServer();
	});

	describe("Connection Error Handling", () => {
		test("throws on connection timeout to non-existent server", async () => {
			const client = new BrowserdClient({
				url: INVALID_URL,
				timeout: 2000,
				autoReconnect: false,
			});

			try {
				await expect(client.connect()).rejects.toThrow();
			} finally {
				await client.close().catch(() => {});
			}
		});

		test("throws NOT_CONNECTED when command sent before connect", async () => {
			const client = new BrowserdClient({
				url: SERVER_URL,
				timeout: 5000,
				autoReconnect: false,
			});

			try {
				await client.navigate("https://example.com");
				expect.unreachable("Should have thrown");
			} catch (error) {
				expect(BrowserdError.isBrowserdError(error)).toBe(true);
				if (BrowserdError.isBrowserdError(error)) {
					expect(error.code).toBe("NOT_CONNECTED");
				}
			}
		});

		test("calls error handler on connection failure", async () => {
			const client = new BrowserdClient({
				url: INVALID_URL,
				timeout: 1000,
				autoReconnect: false,
			});

			let errorReceived = false;
			const unsubscribe = client.onError(() => {
				errorReceived = true;
			});

			try {
				await client.connect();
			} catch {
				// Expected
			}

			unsubscribe();
			expect(errorReceived).toBe(true);
		});
	});

	describe("Connection State Tracking", () => {
		test.skipIf(!runTests)("tracks connection state transitions", async () => {
			const client = new BrowserdClient({
				url: SERVER_URL,
				timeout: 10000,
				autoReconnect: false,
			});

			const states: string[] = [];
			client.onConnectionStateChange((state) => {
				states.push(state);
			});

			try {
				expect(client.getConnectionState()).toBe("disconnected");

				await client.connect();
				expect(client.getConnectionState()).toBe("connected");

				await client.close();
				expect(client.getConnectionState()).toBe("disconnected");

				// Verify all expected transitions occurred
				expect(states).toContain("connecting");
				expect(states).toContain("connected");
				expect(states).toContain("disconnected");
			} finally {
				await client.close().catch(() => {});
			}
		});

		test.skipIf(!runTests)(
			"throws NOT_CONNECTED after disconnect",
			async () => {
				const client = new BrowserdClient({
					url: SERVER_URL,
					timeout: 10000,
					autoReconnect: false,
				});

				try {
					await client.connect();
					await client.close();

					await client.navigate("https://example.com");
					expect.unreachable("Should have thrown");
				} catch (error) {
					expect(BrowserdError.isBrowserdError(error)).toBe(true);
					if (BrowserdError.isBrowserdError(error)) {
						expect(error.code).toBe("NOT_CONNECTED");
					}
				} finally {
					await client.close().catch(() => {});
				}
			},
		);
	});

	describe("Multiple Connection Handling", () => {
		test.skipIf(!runTests)(
			"handles multiple concurrent connect calls",
			async () => {
				const client = new BrowserdClient({
					url: SERVER_URL,
					timeout: 10000,
					autoReconnect: false,
				});

				try {
					// Call connect multiple times concurrently
					await Promise.all([
						client.connect(),
						client.connect(),
						client.connect(),
					]);

					expect(client.isConnected()).toBe(true);
				} finally {
					await client.close().catch(() => {});
				}
			},
		);
	});

	describe("Ping Functionality", () => {
		test.skipIf(!runTests)("returns consistent latency values", async () => {
			const client = new BrowserdClient({
				url: SERVER_URL,
				timeout: 10000,
				autoReconnect: false,
			});

			try {
				await client.connect();

				const latencies: number[] = [];
				for (let i = 0; i < 5; i++) {
					const latency = await client.ping();
					latencies.push(latency);
				}

				// All latencies should be valid
				for (const latency of latencies) {
					expect(latency).toBeGreaterThanOrEqual(0);
					expect(latency).toBeLessThan(1000);
				}
			} finally {
				await client.close().catch(() => {});
			}
		});
	});
});
