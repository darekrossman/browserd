/**
 * SDK End-to-End Tests
 *
 * Tests the SDK against a real browserd server with real browser automation.
 * Starts a local server, runs tests, then stops the server.
 *
 * Requires:
 * - Playwright Chromium browser installed (bunx playwright install chromium)
 * - HEADLESS=true recommended for CI environments
 *
 * Run with: bun test tests/e2e/sdk-e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { BrowserdClient } from "../../src/sdk";
import { hasBrowserSupport, sleep } from "../helpers/setup";

const SERVER_PORT = 3099;
const SERVER_URL = `ws://localhost:${SERVER_PORT}/ws`;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/readyz`;
const STARTUP_TIMEOUT = 30000;
const TEST_TIMEOUT = 60000;

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

describe("SDK E2E", () => {
	let client: BrowserdClient;

	beforeAll(async () => {
		if (!runTests) return;
		await startServer();
		client = new BrowserdClient({
			url: SERVER_URL,
			timeout: TEST_TIMEOUT,
			autoReconnect: false,
		});
		await client.connect();
	});

	afterAll(async () => {
		if (client) {
			await client.close().catch(() => {});
		}
		await stopServer();
	});

	describe("Basic Operations", () => {
		test.skipIf(!runTests)("pings server", async () => {
			const latency = await client.ping();
			expect(latency).toBeGreaterThanOrEqual(0);
		});

		test.skipIf(!runTests)("navigates to example.com", async () => {
			const result = await client.navigate("https://example.com");
			expect(result.url).toContain("example.com");
		});

		test.skipIf(!runTests)("waits for selector", async () => {
			await client.waitForSelector("h1", { timeout: 5000 });
		});

		test.skipIf(!runTests)("evaluates JavaScript", async () => {
			const title = await client.evaluate<string>("document.title");
			expect(title).toBeTruthy();
			expect(typeof title).toBe("string");
		});

		test.skipIf(!runTests)("gets page text content", async () => {
			const text = await client.evaluate<string>("document.body.innerText");
			expect(text).toContain("Example");
		});

		test.skipIf(!runTests)("takes screenshot", async () => {
			const screenshot = await client.screenshot();
			expect(screenshot.data.length).toBeGreaterThan(100);
		});

		test.skipIf(!runTests)("sets viewport", async () => {
			await client.setViewport(800, 600);
		});
	});

	describe("Form Interactions", () => {
		test.skipIf(!runTests)("navigates to data URL", async () => {
			const html = encodeURIComponent(
				"<html><body><button id='btn'>Click Me</button></body></html>",
			);
			await client.navigate(`data:text/html,${html}`);
		});

		test.skipIf(!runTests)("clicks button", async () => {
			await client.waitForSelector("#btn", { timeout: 5000 });
			await client.click("#btn");
		});

		test.skipIf(!runTests)("fills and types into form fields", async () => {
			const html = encodeURIComponent(
				'<html><body><input id="name" type="text"><input id="email" type="email"></body></html>',
			);
			await client.navigate(`data:text/html,${html}`);

			await client.waitForSelector("#name", { timeout: 5000 });
			await client.fill("#name", "Test User");

			await client.click("#email");
			await client.type("#email", "test@example.com", { delay: 10 });
		});

		test.skipIf(!runTests)("hovers over element", async () => {
			await client.hover("#name");
		});

		test.skipIf(!runTests)("presses key", async () => {
			await client.press("Tab");
		});
	});

	describe("Navigation History", () => {
		test.skipIf(!runTests)("goes back and forward", async () => {
			await client.navigate("https://example.com");
			await client.goBack();
			await client.goForward();
		});

		test.skipIf(!runTests)("reloads page", async () => {
			await client.reload();
		});
	});

	describe("Error Handling", () => {
		test.skipIf(!runTests)(
			"handles non-existent selector with timeout",
			async () => {
				expect(
					client.waitForSelector("#does-not-exist", { timeout: 1000 }),
				).rejects.toThrow();
			},
		);
	});
});
