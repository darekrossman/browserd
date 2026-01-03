/**
 * SDK Concurrent Connections Test
 *
 * Tests multiple concurrent SDK clients connecting to the same browserd server,
 * simulating a real multi-user scenario.
 *
 * Requires a running browserd server or starts one automatically.
 *
 * Run with: bun test tests/e2e/sdk-concurrent.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { BrowserdClient } from "../../src/sdk";
import { hasBrowserSupport, sleep } from "../helpers/setup";

const SERVER_PORT = 3098;
const SERVER_URL = `ws://localhost:${SERVER_PORT}/ws`;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/readyz`;
const STARTUP_TIMEOUT = 30000;
const NUM_CLIENTS = 3;

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

describe("SDK Concurrent Connections", () => {
	beforeAll(async () => {
		if (!runTests) return;
		await startServer();
	});

	afterAll(async () => {
		await stopServer();
	});

	test.skipIf(!runTests)(
		"handles multiple concurrent clients",
		async () => {
			const clients: BrowserdClient[] = [];

			// Create clients
			for (let i = 0; i < NUM_CLIENTS; i++) {
				clients.push(
					new BrowserdClient({
						url: SERVER_URL,
						timeout: 30000,
						autoReconnect: false,
					}),
				);
			}

			try {
				// Connect all clients
				await Promise.all(clients.map((c) => c.connect()));

				// Verify all connected
				expect(clients.every((c) => c.isConnected())).toBe(true);

				// Each client navigates to a different page
				const pages = [
					"data:text/html,<h1>Page 1</h1>",
					"data:text/html,<h1>Page 2</h1>",
					"data:text/html,<h1>Page 3</h1>",
				];

				const navResults = await Promise.all(
					clients.map((client, i) => client.navigate(pages[i % pages.length]!)),
				);

				// All navigations should succeed
				expect(navResults.length).toBe(NUM_CLIENTS);
				for (const result of navResults) {
					expect(result.url).toContain("data:text/html");
				}

				// Take screenshots from all clients
				const screenshots = await Promise.all(
					clients.map((c) => c.screenshot({ type: "jpeg", quality: 50 })),
				);

				// All screenshots should have data
				for (const screenshot of screenshots) {
					expect(screenshot.data.length).toBeGreaterThan(100);
				}

				// Test ping on all clients
				const latencies = await Promise.all(clients.map((c) => c.ping()));

				// All pings should return valid latency
				for (const latency of latencies) {
					expect(latency).toBeGreaterThanOrEqual(0);
					expect(latency).toBeLessThan(5000);
				}
			} finally {
				// Close all clients
				await Promise.all(clients.map((c) => c.close().catch(() => {})));
			}
		},
		{ timeout: 60000 },
	);

	test.skipIf(!runTests)(
		"clients can perform independent operations",
		async () => {
			const client1 = new BrowserdClient({
				url: SERVER_URL,
				timeout: 30000,
				autoReconnect: false,
			});
			const client2 = new BrowserdClient({
				url: SERVER_URL,
				timeout: 30000,
				autoReconnect: false,
			});

			try {
				await Promise.all([client1.connect(), client2.connect()]);

				// Client 1 navigates to page with variable
				await client1.navigate(
					"data:text/html,<script>window.testVar = 'client1'</script>",
				);

				// Client 2 navigates to different page
				await client2.navigate(
					"data:text/html,<script>window.testVar = 'client2'</script>",
				);

				// Both clients should be connected
				expect(client1.isConnected()).toBe(true);
				expect(client2.isConnected()).toBe(true);
			} finally {
				await client1.close().catch(() => {});
				await client2.close().catch(() => {});
			}
		},
		{ timeout: 60000 },
	);
});
