/**
 * Browser Integration Tests
 *
 * Tests that require a real browser instance (run in container)
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { ChildProcess } from "node:child_process";
import type { Browser } from "rebrowser-playwright";
import {
	BrowserManager,
	resetDefaultBrowserManager,
} from "../../src/server/browser-manager";
import { forceCloseBrowser, hasBrowserSupport, sleep } from "../helpers/setup";

// Skip all tests if browser support is not available
const runTests = hasBrowserSupport();

describe("BrowserManager Integration", () => {
	let manager: BrowserManager;

	beforeEach(() => {
		manager = new BrowserManager({
			headless: true, // Use headless for faster tests
			viewport: { width: 1280, height: 720 },
		});
	});

	afterEach(async () => {
		await forceCloseBrowser(manager);
	});

	test.skipIf(!runTests)("launches browser successfully", async () => {
		const instance = await manager.launch();

		expect(instance).toBeDefined();
		expect(instance.browser).toBeDefined();
		expect(instance.context).toBeDefined();
		expect(instance.page).toBeDefined();
		expect(manager.isRunning()).toBe(true);
	});

	test.skipIf(!runTests)("creates page with correct viewport", async () => {
		await manager.launch();

		const page = manager.getPage();
		const viewport = page.viewportSize();

		expect(viewport).toBeDefined();
		expect(viewport?.width).toBe(1280);
		expect(viewport?.height).toBe(720);
	});

	test.skipIf(!runTests)("navigates to URL", async () => {
		await manager.launch();

		await manager.navigate("data:text/html,<h1>Test Page</h1>");

		const page = manager.getPage();
		// Use evaluate instead of content() for alwaysIsolated compatibility
		const text = await page.evaluate(() => document.body.innerText);
		expect(text).toContain("Test Page");
	});

	test.skipIf(!runTests)("closes browser cleanly", async () => {
		await manager.launch();
		expect(manager.isRunning()).toBe(true);

		await manager.close();
		expect(manager.isRunning()).toBe(false);
	});

	test.skipIf(!runTests)("throws error when launching twice", async () => {
		await manager.launch();

		await expect(manager.launch()).rejects.toThrow(
			"Browser is already running",
		);
	});

	test.skipIf(!runTests)(
		"throws error when getting instance before launch",
		() => {
			expect(() => manager.getInstance()).toThrow("Browser is not running");
		},
	);

	test.skipIf(!runTests)("can close without launching", async () => {
		// Should not throw
		await manager.close();
	});

	test.skipIf(!runTests)("provides status information", async () => {
		// Before launch
		let status = manager.getStatus();
		expect(status.running).toBe(false);
		expect(status.connected).toBe(false);
		expect(status.url).toBeNull();

		// After launch
		await manager.launch();
		status = manager.getStatus();
		expect(status.running).toBe(true);
		expect(status.connected).toBe(true);
		expect(status.viewport).toEqual({ width: 1280, height: 720 });
		expect(status.url).toBeDefined();

		// After navigation
		await manager.navigate("data:text/html,<h1>Test</h1>");
		status = manager.getStatus();
		expect(status.url).toContain("data:text/html");
	});

	test.skipIf(!runTests)("can change viewport size", async () => {
		await manager.launch();

		await manager.setViewport(800, 600);

		const page = manager.getPage();
		const viewport = page.viewportSize();
		expect(viewport?.width).toBe(800);
		expect(viewport?.height).toBe(600);
	});

	test.skipIf(!runTests)(
		"browser remains connected after navigation",
		async () => {
			await manager.launch();

			// Multiple navigations
			await manager.navigate("data:text/html,<h1>Page 1</h1>");
			expect(manager.isRunning()).toBe(true);

			await manager.navigate("data:text/html,<h1>Page 2</h1>");
			expect(manager.isRunning()).toBe(true);

			await manager.navigate("data:text/html,<h1>Page 3</h1>");
			expect(manager.isRunning()).toBe(true);

			const page = manager.getPage();
			// Use evaluate instead of content() for alwaysIsolated compatibility
			const text = await page.evaluate(() => document.body.innerText);
			expect(text).toContain("Page 3");
		},
	);
});

describe("BrowserManager - No Zombie Processes", () => {
	beforeAll(async () => {
		// Wait for any async cleanup from previous tests
		await sleep(300);
	});

	test.skipIf(!runTests)("cleans up all processes after close", async () => {
		const manager = new BrowserManager({ headless: true });
		await manager.launch();

		// Get the browser and process before closing
		const instance = manager.getInstance();
		const browser = instance.browser;
		// browser.process() exists at runtime but isn't in the type definitions
		const browserProcess = (
			browser as Browser & { process?: () => ChildProcess | null }
		).process?.();

		// Close the browser directly (ignore "cannot get world" errors which are cosmetic)
		try {
			await manager.close();
		} catch {
			// Ignore cleanup errors from rebrowser-patches
		}

		// Wait for process cleanup
		await sleep(200);

		// Browser should be disconnected
		expect(manager.isRunning()).toBe(false);

		// If we had access to the process, verify it exited
		if (browserProcess) {
			const processExited =
				browserProcess.killed ||
				browserProcess.exitCode !== null ||
				browserProcess.signalCode !== null;
			expect(processExited).toBe(true);
		}
	});
});

describe("BrowserManager - Error Handling", () => {
	let manager: BrowserManager;

	beforeEach(() => {
		manager = new BrowserManager({ headless: true });
	});

	afterEach(async () => {
		await forceCloseBrowser(manager);
	});

	test.skipIf(!runTests)("handles navigation to invalid URL", async () => {
		await manager.launch();

		// Navigation to invalid URL should throw or handle gracefully
		await expect(manager.navigate("not-a-valid-url")).rejects.toThrow();
	});

	test.skipIf(!runTests)("page operations fail after close", async () => {
		await manager.launch();
		const page = manager.getPage();

		await manager.close();

		// Operations on closed browser should throw
		await expect(page.goto("data:text/html,test")).rejects.toThrow();
	});
});

describe("Default Browser Manager", () => {
	beforeAll(async () => {
		// Wait for any async cleanup from previous tests
		await sleep(500);
		// Ensure singleton is reset
		await resetDefaultBrowserManager();
	});

	afterEach(async () => {
		await resetDefaultBrowserManager();
	});

	test.skipIf(!runTests)(
		"resetDefaultBrowserManager cleans up properly",
		async () => {
			// Import and use default manager
			const { getDefaultBrowserManager } = await import(
				"../../src/server/browser-manager"
			);

			const manager = getDefaultBrowserManager({ headless: true });
			await manager.launch();
			expect(manager.isRunning()).toBe(true);

			await resetDefaultBrowserManager();

			// Manager should be closed
			expect(manager.isRunning()).toBe(false);
		},
	);
});
