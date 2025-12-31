/**
 * Test Environment Setup
 *
 * Preloaded by Bun test runner to configure test environment
 */

import { afterAll, beforeAll } from "bun:test";

// Set default test timeout
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT || "30000", 10);

// Environment variables for testing
const testEnv = {
	// Let browser-manager set REBROWSER_PATCHES_RUNTIME_FIX_MODE to "alwaysIsolated"
	// This is required for proper stealth operation and context bridge usage
	// DO NOT override this - it must remain in alwaysIsolated mode

	// Playwright browser path (in container)
	PLAYWRIGHT_BROWSERS_PATH:
		process.env.PLAYWRIGHT_BROWSERS_PATH ||
		"/vercel/sandbox/browser-service/.playwright-browsers",

	// Display for Xvfb (in container)
	DISPLAY: process.env.DISPLAY || ":99",

	// Test server port
	TEST_PORT: process.env.TEST_PORT || "3001",

	// Whether running in container
	IN_CONTAINER: process.env.IN_CONTAINER === "true",
};

// Export for use in tests
export { testEnv, TEST_TIMEOUT };

/**
 * Check if we're running in an environment with browser support
 */
export function hasBrowserSupport(): boolean {
	// Check if we're in the container environment or on a supported platform
	return (
		testEnv.IN_CONTAINER ||
		process.env.DISPLAY !== undefined ||
		process.platform === "linux" ||
		process.platform === "darwin" // macOS supports headless Playwright
	);
}

/**
 * Skip test if browser support is not available
 */
export function skipIfNoBrowser(description: string): void {
	if (!hasBrowserSupport()) {
		console.log(`[SKIP] ${description} - No browser support available`);
	}
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Wait for a specific duration
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async operation with a timeout - returns void after timeout to prevent hanging
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T | undefined> {
	let timeoutId: ReturnType<typeof setTimeout>;
	const timeoutPromise = new Promise<undefined>((resolve) => {
		timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
	});

	try {
		const result = await Promise.race([promise, timeoutPromise]);
		clearTimeout(timeoutId!);
		return result;
	} catch {
		clearTimeout(timeoutId!);
		// Silently ignore errors - this is used for cleanup
		return undefined;
	}
}

/**
 * Force close a browser manager with timeout
 * Waits a bit after close to let rebrowser-patches cleanup complete
 */
export async function forceCloseBrowser(
	browserManager: { close: () => Promise<void> } | null | undefined,
): Promise<void> {
	if (!browserManager) return;

	// Close with timeout
	await withTimeout(
		browserManager.close().catch(() => {}),
		3000,
	);

	// Small delay to let any pending rebrowser-patches cleanup complete
	// This prevents "cannot get world" errors from affecting next test
	await sleep(100);
}

/**
 * Create a test server URL
 */
export function getTestServerUrl(path = ""): string {
	return `http://localhost:${testEnv.TEST_PORT}${path}`;
}

// Global setup
beforeAll(() => {
	// Set environment for tests
	Object.entries(testEnv).forEach(([key, value]) => {
		if (!process.env[key]) {
			process.env[key] = String(value);
		}
	});
});

// Global cleanup
afterAll(() => {
	// Any global cleanup
});

// Export test utilities
export const testUtils = {
	hasBrowserSupport,
	skipIfNoBrowser,
	waitFor,
	sleep,
	withTimeout,
	forceCloseBrowser,
	getTestServerUrl,
};
