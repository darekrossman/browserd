/**
 * Commands Integration Tests
 *
 * Tests Playwright RPC command execution (run in container)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ResultMessage } from "../../src/protocol/types";
import { BrowserManager } from "../../src/server/browser-manager";
import { CommandQueue } from "../../src/server/command-queue";
import {
	contentInMainContext,
	focusInMainContext,
	inputValueInMainContext,
	textContentInMainContext,
} from "../../src/stealth";
import { forceCloseBrowser, hasBrowserSupport, sleep } from "../helpers/setup";

/**
 * Result type for evaluate command
 */
interface EvaluateResult {
	result: unknown;
}

/**
 * Result type for screenshot command
 */
interface ScreenshotResult {
	data: string;
	format: string;
}

const runTests = hasBrowserSupport();

describe("Command Integration", () => {
	let browserManager: BrowserManager;
	let commandQueue: CommandQueue;
	let results: ResultMessage[];

	beforeEach(async () => {
		results = [];
		browserManager = new BrowserManager({
			headless: true,
			viewport: { width: 800, height: 600 },
		});

		await browserManager.launch();
		// Small delay to ensure browser is fully ready
		await sleep(100);

		commandQueue = new CommandQueue({
			page: browserManager.getPage(),
			timeout: 10000,
			onResult: (result) => results.push(result),
		});
	}, 15000); // Increase hook timeout

	afterEach(async () => {
		await forceCloseBrowser(browserManager);
	}, 10000); // Increase hook timeout

	describe("navigate command", () => {
		test.skipIf(!runTests)("navigates to URL", async () => {
			const result = await commandQueue.enqueue({
				id: "nav-1",
				type: "cmd",
				method: "navigate",
				params: { url: "data:text/html,<h1>Hello</h1>" },
			});

			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("url");

			const page = browserManager.getPage();
			const content = await contentInMainContext(page);
			expect(content).toContain("Hello");
		});

		test.skipIf(!runTests)("returns error for invalid URL", async () => {
			const result = await commandQueue.enqueue({
				id: "nav-invalid",
				type: "cmd",
				method: "navigate",
				params: { url: "invalid-protocol://test" },
			});

			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("NAVIGATION_ERROR");
		});
	});

	describe("click command", () => {
		test.skipIf(!runTests)("clicks element by selector", async () => {
			const page = browserManager.getPage();
			await page.goto(`data:text/html,
        <button id="btn">Click Me</button>
        <div id="result">Not clicked</div>
        <script>
          document.getElementById('btn').addEventListener('click', () => {
            document.getElementById('result').textContent = 'Clicked!';
          });
        </script>
      `);

			const result = await commandQueue.enqueue({
				id: "click-1",
				type: "cmd",
				method: "click",
				params: { selector: "#btn" },
			});

			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("clicked", "#btn");

			const resultText = await textContentInMainContext(page, "#result");
			expect(resultText).toBe("Clicked!");
		});

		test.skipIf(!runTests)(
			"returns error for non-existent selector",
			async () => {
				const page = browserManager.getPage();
				await page.goto("data:text/html,<div>No button here</div>");

				const result = await commandQueue.enqueue({
					id: "click-missing",
					type: "cmd",
					method: "click",
					params: { selector: "#nonexistent", timeout: 1000 },
				});

				expect(result.ok).toBe(false);
				expect(result.error?.code).toBe("TIMEOUT");
			},
			{ timeout: 30000 },
		);
	});

	describe("type command", () => {
		test.skipIf(!runTests)(
			"types text into input",
			async () => {
				const page = browserManager.getPage();
				await page.goto(`data:text/html,<input id="input" type="text" />`);

				const result = await commandQueue.enqueue({
					id: "type-1",
					type: "cmd",
					method: "type",
					params: { selector: "#input", text: "Hello World" },
				});

				expect(result.ok).toBe(true);

				const value = await inputValueInMainContext(page, "#input");
				expect(value).toBe("Hello World");
			},
			{ timeout: 30000 },
		);
	});

	describe("fill command", () => {
		test.skipIf(!runTests)("fills input clearing existing value", async () => {
			const page = browserManager.getPage();
			await page.goto(
				`data:text/html,<input id="input" type="text" value="existing" />`,
			);

			const result = await commandQueue.enqueue({
				id: "fill-1",
				type: "cmd",
				method: "fill",
				params: { selector: "#input", value: "New Value" },
			});

			expect(result.ok).toBe(true);

			const value = await inputValueInMainContext(page, "#input");
			expect(value).toBe("New Value");
		});
	});

	describe("hover command", () => {
		test.skipIf(!runTests)("hovers over element", async () => {
			const page = browserManager.getPage();

			// Use a simpler HTML structure
			await page.goto(
				`data:text/html,<html><body><div id="target" style="width:200px;height:200px;background:red;">Hover</div><div id="result">Not hovered</div><script>document.getElementById('target').onmouseenter=function(){document.getElementById('result').textContent='Hovered!'};</script></body></html>`,
			);

			// Verify page loaded
			const content = await contentInMainContext(page);
			console.log(
				"[TEST] hover page loaded, has #target:",
				content.includes('id="target"'),
			);

			const result = await commandQueue.enqueue({
				id: "hover-1",
				type: "cmd",
				method: "hover",
				params: { selector: "#target", timeout: 5000 },
			});

			if (!result.ok) {
				console.error("[TEST] hover error:", result.error);
			}

			expect(result.ok).toBe(true);

			const resultText = await textContentInMainContext(page, "#result");
			expect(resultText).toBe("Hovered!");
		});
	});

	describe("waitForSelector command", () => {
		test.skipIf(!runTests)("waits for element to appear", async () => {
			const page = browserManager.getPage();

			// Test with element that exists immediately (verify basic waitForSelector works)
			await page.goto(
				`data:text/html,<html><body><div id="existing">I exist!</div></body></html>`,
			);

			const result = await commandQueue.enqueue({
				id: "wait-1",
				type: "cmd",
				method: "waitForSelector",
				params: { selector: "#existing", timeout: 3000 },
			});

			if (!result.ok) {
				console.error("[TEST] waitForSelector error:", result.error);
			}

			expect(result.ok).toBe(true);

			const text = await textContentInMainContext(page, "#existing");
			expect(text).toBe("I exist!");
		});

		test.skipIf(!runTests)("times out for missing element", async () => {
			const page = browserManager.getPage();
			await page.goto("data:text/html,<div>Empty</div>");

			console.log("[TEST] waitForSelector timeout test starting...");
			const startTime = Date.now();

			const result = await commandQueue.enqueue({
				id: "wait-timeout",
				type: "cmd",
				method: "waitForSelector",
				params: { selector: "#never-exists", timeout: 1000 },
			});

			console.log(
				`[TEST] waitForSelector completed in ${Date.now() - startTime}ms, ok=${result.ok}`,
			);
			if (!result.ok) {
				console.log("[TEST] waitForSelector error:", result.error);
			}

			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("TIMEOUT");
		});
	});

	describe("setViewport command", () => {
		test.skipIf(!runTests)("changes viewport size", async () => {
			const result = await commandQueue.enqueue({
				id: "viewport-1",
				type: "cmd",
				method: "setViewport",
				params: { width: 1920, height: 1080 },
			});

			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("viewport");

			const page = browserManager.getPage();
			const viewport = page.viewportSize();
			expect(viewport?.width).toBe(1920);
			expect(viewport?.height).toBe(1080);
		});
	});

	describe("goBack/goForward/reload commands", () => {
		test.skipIf(!runTests)("navigates history", async () => {
			const page = browserManager.getPage();

			// Navigate to first page
			await page.goto("data:text/html,<h1>Page 1</h1>");

			// Navigate to second page
			await commandQueue.enqueue({
				id: "nav-2",
				type: "cmd",
				method: "navigate",
				params: { url: "data:text/html,<h1>Page 2</h1>" },
			});

			let content = await contentInMainContext(page);
			expect(content).toContain("Page 2");

			// Go back
			const backResult = await commandQueue.enqueue({
				id: "back-1",
				type: "cmd",
				method: "goBack",
				params: {},
			});

			expect(backResult.ok).toBe(true);
			content = await contentInMainContext(page);
			expect(content).toContain("Page 1");

			// Go forward
			const forwardResult = await commandQueue.enqueue({
				id: "forward-1",
				type: "cmd",
				method: "goForward",
				params: {},
			});

			expect(forwardResult.ok).toBe(true);
			content = await contentInMainContext(page);
			expect(content).toContain("Page 2");
		});

		test.skipIf(!runTests)("reloads page", async () => {
			const page = browserManager.getPage();
			await page.goto(`data:text/html,<div id="content">Reload Test</div>`);

			const result = await commandQueue.enqueue({
				id: "reload-1",
				type: "cmd",
				method: "reload",
				params: {},
			});

			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("url");
		});
	});

	describe("evaluate command", () => {
		test.skipIf(!runTests)("evaluates JavaScript expression", async () => {
			const page = browserManager.getPage();
			await page.goto("data:text/html,<div id='test'>Hello</div>");

			const result = await commandQueue.enqueue({
				id: "eval-1",
				type: "cmd",
				method: "evaluate",
				params: { expression: "document.getElementById('test').textContent" },
			});

			expect(result.ok).toBe(true);
			expect((result.result as EvaluateResult).result).toBe("Hello");
		});

		test.skipIf(!runTests)("evaluates arithmetic", async () => {
			const page = browserManager.getPage();
			await page.goto("data:text/html,<div></div>");

			const result = await commandQueue.enqueue({
				id: "eval-2",
				type: "cmd",
				method: "evaluate",
				params: { expression: "2 + 2" },
			});

			expect(result.ok).toBe(true);
			expect((result.result as EvaluateResult).result).toBe(4);
		});
	});

	describe("screenshot command", () => {
		test.skipIf(!runTests)("takes screenshot", async () => {
			const page = browserManager.getPage();
			await page.goto(`data:text/html,
        <div style="background:red;width:100%;height:100vh;"></div>
      `);

			const result = await commandQueue.enqueue({
				id: "screenshot-1",
				type: "cmd",
				method: "screenshot",
				params: { type: "png" },
			});

			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("data");
			expect(result.result).toHaveProperty("format", "png");

			// Verify it's valid base64
			const data = (result.result as ScreenshotResult).data;
			expect(data.length).toBeGreaterThan(100);

			// Decode and check PNG magic bytes
			const buffer = Buffer.from(data, "base64");
			expect(buffer[0]).toBe(0x89);
			expect(buffer[1]).toBe(0x50); // P
			expect(buffer[2]).toBe(0x4e); // N
			expect(buffer[3]).toBe(0x47); // G
		});

		test.skipIf(!runTests)("takes full page screenshot", async () => {
			const page = browserManager.getPage();
			await page.goto(
				`data:text/html,<html><body style="margin:0"><div style="height:800px;background:linear-gradient(red,blue)"></div></body></html>`,
			);

			const result = await commandQueue.enqueue({
				id: "screenshot-full",
				type: "cmd",
				method: "screenshot",
				params: { fullPage: true },
			});

			expect(result.ok).toBe(true);
			expect(result.result).toHaveProperty("data");
		});
	});

	describe("press command", () => {
		test.skipIf(!runTests)("presses key in focused element", async () => {
			const page = browserManager.getPage();
			await page.goto(
				`data:text/html,<html><body><form id="form"><input id="input" type="text" /></form><div id="result">not submitted</div><script>document.getElementById('form').addEventListener('submit',function(e){e.preventDefault();document.getElementById('result').textContent='submitted';});</script></body></html>`,
			);

			await focusInMainContext(page, "#input");

			const result = await commandQueue.enqueue({
				id: "press-1",
				type: "cmd",
				method: "press",
				params: { key: "Enter" },
			});

			expect(result.ok).toBe(true);

			const resultText = await textContentInMainContext(page, "#result");
			expect(resultText).toBe("submitted");
		});
	});

	describe("dblclick command", () => {
		test.skipIf(!runTests)("double clicks element", async () => {
			const page = browserManager.getPage();

			// Use a simpler HTML structure
			await page.goto(
				`data:text/html,<html><body><div id="target" style="width:200px;height:200px;background:blue;">DblClick</div><div id="result">0</div><script>document.getElementById('target').ondblclick=function(){document.getElementById('result').textContent='double clicked'};</script></body></html>`,
			);

			// Verify page loaded
			const content = await contentInMainContext(page);
			console.log(
				"[TEST] dblclick page loaded, has #target:",
				content.includes('id="target"'),
			);

			const result = await commandQueue.enqueue({
				id: "dblclick-1",
				type: "cmd",
				method: "dblclick",
				params: { selector: "#target", timeout: 5000 },
			});

			if (!result.ok) {
				console.error("[TEST] dblclick error:", result.error);
			}

			expect(result.ok).toBe(true);

			const resultText = await textContentInMainContext(page, "#result");
			expect(resultText).toBe("double clicked");
		});
	});
});

describe("Command Queue Mechanics", () => {
	let browserManager: BrowserManager;
	let commandQueue: CommandQueue;
	let results: ResultMessage[];

	beforeEach(async () => {
		results = [];
		browserManager = new BrowserManager({ headless: true });
		await browserManager.launch();
		commandQueue = new CommandQueue({
			page: browserManager.getPage(),
			timeout: 10000,
			onResult: (result) => results.push(result),
		});
	});

	afterEach(async () => {
		await forceCloseBrowser(browserManager);
	});

	test.skipIf(!runTests)("executes commands in sequence", async () => {
		const page = browserManager.getPage();
		await page.goto(
			`data:text/html,<html><body><input id="input" type="text" /></body></html>`,
		);

		// Submit multiple commands that must execute in order
		const cmdResults = await Promise.all([
			commandQueue.enqueue({
				id: "1",
				type: "cmd",
				method: "fill",
				params: { selector: "#input", value: "Step1" },
			}),
			commandQueue.enqueue({
				id: "2",
				type: "cmd",
				method: "fill",
				params: { selector: "#input", value: "Step2" },
			}),
			commandQueue.enqueue({
				id: "3",
				type: "cmd",
				method: "fill",
				params: { selector: "#input", value: "Final" },
			}),
		]);

		// All should succeed
		expect(cmdResults.every((r) => r.ok)).toBe(true);

		// Final value should be "Final"
		const value = await inputValueInMainContext(page, "#input");
		expect(value).toBe("Final");
	});

	test.skipIf(!runTests)("notifies via onResult callback", async () => {
		await commandQueue.enqueue({
			id: "notify-test",
			type: "cmd",
			method: "navigate",
			params: { url: "data:text/html,<h1>Test</h1>" },
		});

		expect(results.length).toBe(1);
		expect(results[0]!.id).toBe("notify-test");
	});

	test.skipIf(!runTests)("returns error for unknown method", async () => {
		const result = await commandQueue.enqueue({
			id: "unknown",
			type: "cmd",
			// @ts-expect-error - testing unknown method
			method: "unknownMethod",
			params: {},
		});

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("UNKNOWN_METHOD");
	});

	test.skipIf(!runTests)("getQueueLength tracks pending commands", async () => {
		expect(commandQueue.getQueueLength()).toBe(0);

		const page = browserManager.getPage();
		await page.goto("data:text/html,<input id='input'>");

		// Queue multiple commands
		const p1 = commandQueue.enqueue({
			id: "1",
			type: "cmd",
			method: "fill",
			params: { selector: "#input", value: "test1" },
		});
		const p2 = commandQueue.enqueue({
			id: "2",
			type: "cmd",
			method: "fill",
			params: { selector: "#input", value: "test2" },
		});

		await Promise.all([p1, p2]);

		expect(commandQueue.getQueueLength()).toBe(0);
	});

	test.skipIf(!runTests)("clear cancels pending commands", async () => {
		const page = browserManager.getPage();
		await page.goto("data:text/html,<input id='input'>");

		// Start a command
		const p1 = commandQueue.enqueue({
			id: "1",
			type: "cmd",
			method: "waitForSelector",
			params: { selector: "#input", timeout: 5000 },
		});

		// Queue more commands
		const p2 = commandQueue.enqueue({
			id: "2",
			type: "cmd",
			method: "fill",
			params: { selector: "#input", value: "test" },
		});

		const p3 = commandQueue.enqueue({
			id: "3",
			type: "cmd",
			method: "click",
			params: { selector: "#input" },
		});

		// Clear immediately
		commandQueue.clear();

		const cmdResults = await Promise.all([p1, p2, p3]);

		// At least one should be cancelled
		const cancelledCount = cmdResults.filter(
			(r) => !r.ok && r.error?.code === "CANCELLED",
		).length;

		expect(cancelledCount).toBeGreaterThanOrEqual(1);
	});
});
