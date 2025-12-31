/**
 * Context Bridge for alwaysIsolated mode
 *
 * When using REBROWSER_PATCHES_RUNTIME_FIX_MODE=alwaysIsolated, all scripts run
 * in an isolated JavaScript context that cannot access main page objects.
 *
 * This module provides a message bridge pattern to access main context objects
 * like window.grecaptcha, custom JS libraries, or DOM elements that need to be
 * queried in the main context.
 *
 * Reference: https://rebrowser.net/blog/how-to-access-main-context-objects-from-isolated-context-in-puppeteer-and-playwright
 */

import type { Page } from "rebrowser-playwright";

/**
 * Script to inject into main context via evaluateOnNewDocument
 * This sets up the message listener in the main context
 */
export const MAIN_CONTEXT_BRIDGE_SCRIPT = `
(function() {
	// Listen for messages from isolated context
	window.addEventListener('message', (event) => {
		// Only process messages from our bridge
		if (!event.data || !event.data.scriptId || event.data.fromMain) return;

		const response = {
			scriptId: event.data.scriptId,
			fromMain: true,
		};

		try {
			// Execute the script in main context
			// Note: Using eval for flexibility, but could use function mapping for CSP
			response.result = eval(event.data.scriptText);
		} catch (err) {
			response.error = err.message;
		}

		// Send response back - serialize to avoid circular refs
		window.postMessage(JSON.parse(JSON.stringify(response)));
	});
})();
`;

/**
 * Script to inject the evaluateMain helper into isolated context
 * This provides the window.evaluateMain function
 */
export const ISOLATED_CONTEXT_BRIDGE_SCRIPT = `
(function() {
	// Listen for responses from main context
	window.addEventListener('message', (event) => {
		if (!(event.data && event.data.scriptId && event.data.fromMain)) return;

		// Dispatch custom event for the specific script ID
		window.dispatchEvent(
			new CustomEvent('scriptId-' + event.data.scriptId, { detail: event.data })
		);
	});

	// Counter for unique script IDs
	window.evaluateMainScriptId = 0;

	// Function to evaluate code in main context
	window.evaluateMain = function(scriptFn) {
		window.evaluateMainScriptId = (window.evaluateMainScriptId || 0) + 1;
		const scriptId = window.evaluateMainScriptId;

		return new Promise(function(resolve) {
			// Listen for response
			window.addEventListener('scriptId-' + scriptId, function(event) {
				resolve(event.detail);
			}, { once: true });

			// Convert function to string if needed
			let scriptText = scriptFn;
			if (typeof scriptText !== 'string') {
				scriptText = '(' + scriptFn.toString() + ')()';
			}

			// Send to main context
			window.postMessage({ scriptId: scriptId, scriptText: scriptText });
		});
	};
})();
`;

/**
 * CSP-safe version that uses function mapping instead of eval
 * Use this when Content-Security-Policy prevents eval
 */
export const MAIN_CONTEXT_BRIDGE_SCRIPT_CSP_SAFE = `
(function() {
	// Predefined safe functions that can be called
	const safeFunctions = {
		'querySelector': (selector) => document.querySelector(selector) !== null,
		'querySelectorAll.length': (selector) => document.querySelectorAll(selector).length,
		'getElementById': (id) => document.getElementById(id) !== null,
		'getElementValue': (selector) => {
			const el = document.querySelector(selector);
			return el ? (el.value || el.textContent) : null;
		},
		'checkObject': (path) => {
			try {
				const parts = path.split('.');
				let obj = window;
				for (const part of parts) {
					obj = obj[part];
					if (obj === undefined) return false;
				}
				return typeof obj !== 'undefined';
			} catch { return false; }
		},
	};

	window.addEventListener('message', (event) => {
		if (!event.data || !event.data.scriptId || event.data.fromMain) return;

		const response = {
			scriptId: event.data.scriptId,
			fromMain: true,
		};

		try {
			const data = JSON.parse(event.data.scriptText);
			if (safeFunctions[data.function]) {
				response.result = safeFunctions[data.function](...(data.args || []));
			} else {
				response.error = 'Unknown function: ' + data.function;
			}
		} catch (err) {
			response.error = err.message;
		}

		window.postMessage(JSON.parse(JSON.stringify(response)));
	});
})();
`;

/**
 * Initialize the context bridge for a page
 * Must be called before navigating to any page
 *
 * @param page - Playwright Page object
 */
export async function initializeContextBridge(page: Page): Promise<void> {
	// Inject main context listener BEFORE page loads
	await page.addInitScript(MAIN_CONTEXT_BRIDGE_SCRIPT);
}

/**
 * Set up the isolated context helper after page load
 * Call this after navigation completes
 *
 * @param page - Playwright Page object
 */
export async function setupIsolatedContextHelper(page: Page): Promise<void> {
	await page.evaluate(ISOLATED_CONTEXT_BRIDGE_SCRIPT);
}

/**
 * Evaluate code in the main context from isolated context
 *
 * Usage:
 * ```typescript
 * const result = await evaluateInMainContext(page, () => {
 *   return typeof window.grecaptcha !== 'undefined';
 * });
 * ```
 *
 * @param page - Playwright Page object
 * @param fn - Function to evaluate in main context
 * @returns Result from main context
 */
export async function evaluateInMainContext<T>(
	page: Page,
	fn: () => T,
): Promise<{ result?: T; error?: string }> {
	return await page.evaluate(async (fnStr) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			return { error: "Context bridge not initialized" };
		}
		// @ts-expect-error - evaluateMain is injected by bridge
		return await window.evaluateMain(fnStr);
	}, fn.toString());
}

/**
 * Wait for an object to exist in the main context
 * Useful for waiting for third-party scripts to load
 *
 * @param page - Playwright Page object
 * @param objectPath - Dot-separated path to object (e.g., 'window.grecaptcha.execute')
 * @param timeout - Maximum wait time in ms
 */
export async function waitForMainContextObject(
	page: Page,
	objectPath: string,
	timeout = 30000,
): Promise<boolean> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		const result = await page.evaluate(async (path) => {
			// @ts-expect-error - evaluateMain is injected by bridge
			if (typeof window.evaluateMain !== "function") {
				return { error: "not_ready" };
			}
			// @ts-expect-error - evaluateMain is injected by bridge
			return await window.evaluateMain(() => {
				try {
					const parts = path.split(".");
					let obj = window as unknown as Record<string, unknown>;
					for (const part of parts) {
						obj = obj[part] as Record<string, unknown>;
						if (obj === undefined) return { result: false };
					}
					return { result: typeof obj !== "undefined" };
				} catch {
					return { result: false };
				}
			});
		}, objectPath);

		if (result.result === true) {
			return true;
		}

		// Wait before next check
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	return false;
}

/**
 * Query selector in main context
 * Useful when you need to check for elements created by main context scripts
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 */
export async function querySelectorInMainContext(
	page: Page,
	selector: string,
): Promise<boolean> {
	const result = await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct query if bridge not available
			return { result: document.querySelector(sel) !== null };
		}
		// @ts-expect-error - evaluateMain is injected by bridge
		return await window.evaluateMain(
			() => document.querySelector(sel) !== null,
		);
	}, selector);

	return result.result === true;
}

/**
 * Fill an input element in the main context
 * This is the alwaysIsolated-compatible version of fill
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector for the input
 * @param value - Value to fill
 * @param options - Fill options
 */
export async function fillInMainContext(
	page: Page,
	selector: string,
	value: string,
	options: { timeout?: number } = {},
): Promise<void> {
	const { timeout = 30000 } = options;

	// First wait for the element to exist
	await waitForSelectorInMainContext(page, selector, {
		state: "visible",
		timeout,
	});

	// Focus and fill using the context bridge
	const result = await page.evaluate(
		async ({ sel, val }) => {
			// @ts-expect-error - evaluateMain is injected by bridge
			if (typeof window.evaluateMain !== "function") {
				// Fallback to direct manipulation if bridge not available
				const el = document.querySelector(sel) as HTMLInputElement | null;
				if (!el) return { success: false, error: "Element not found" };
				el.focus();
				el.value = "";
				el.value = val;
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
				return { success: true };
			}

			// Use context bridge to fill in main world
			// @ts-expect-error - evaluateMain is injected by bridge
			const bridgeResult = await window.evaluateMain(`
				(function() {
					const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
					if (!el) return { success: false, error: 'Element not found' };
					el.focus();
					el.value = '';
					el.value = '${val.replace(/'/g, "\\'")}';
					el.dispatchEvent(new Event('input', { bubbles: true }));
					el.dispatchEvent(new Event('change', { bubbles: true }));
					return { success: true };
				})()
			`);
			return bridgeResult.result || { success: false, error: "Bridge error" };
		},
		{ sel: selector, val: value },
	);

	if (!result.success) {
		throw new Error(`fill: ${result.error || "Failed to fill element"}`);
	}
}

/**
 * Click an element in the main context
 * This is the alwaysIsolated-compatible version of click
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param options - Click options
 */
export async function clickInMainContext(
	page: Page,
	selector: string,
	options: { timeout?: number } = {},
): Promise<void> {
	const { timeout = 30000 } = options;

	// First wait for the element to exist
	await waitForSelectorInMainContext(page, selector, {
		state: "visible",
		timeout,
	});

	// Click using the context bridge
	const result = await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct click if bridge not available
			const el = document.querySelector(sel) as HTMLElement | null;
			if (!el) return { success: false, error: "Element not found" };
			el.click();
			return { success: true };
		}

		// Use context bridge to click in main world
		// @ts-expect-error - evaluateMain is injected by bridge
		const bridgeResult = await window.evaluateMain(`
			(function() {
				const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
				if (!el) return { success: false, error: 'Element not found' };
				el.click();
				return { success: true };
			})()
		`);
		return bridgeResult.result || { success: false, error: "Bridge error" };
	}, selector);

	if (!result.success) {
		throw new Error(`click: ${result.error || "Failed to click element"}`);
	}
}

/**
 * Double-click an element in the main context
 * This is the alwaysIsolated-compatible version of dblclick
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param options - Click options
 */
export async function dblclickInMainContext(
	page: Page,
	selector: string,
	options: { timeout?: number } = {},
): Promise<void> {
	const { timeout = 30000 } = options;

	// First wait for the element to exist
	await waitForSelectorInMainContext(page, selector, {
		state: "visible",
		timeout,
	});

	// Double-click using the context bridge
	const result = await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct dblclick if bridge not available
			const el = document.querySelector(sel) as HTMLElement | null;
			if (!el) return { success: false, error: "Element not found" };
			const event = new MouseEvent("dblclick", {
				bubbles: true,
				cancelable: true,
				view: window,
			});
			el.dispatchEvent(event);
			return { success: true };
		}

		// Use context bridge to dblclick in main world
		// @ts-expect-error - evaluateMain is injected by bridge
		const bridgeResult = await window.evaluateMain(`
			(function() {
				const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
				if (!el) return { success: false, error: 'Element not found' };
				const event = new MouseEvent('dblclick', {
					bubbles: true,
					cancelable: true,
					view: window
				});
				el.dispatchEvent(event);
				return { success: true };
			})()
		`);
		return bridgeResult.result || { success: false, error: "Bridge error" };
	}, selector);

	if (!result.success) {
		throw new Error(
			`dblclick: ${result.error || "Failed to double-click element"}`,
		);
	}
}

/**
 * Hover over an element in the main context
 * This is the alwaysIsolated-compatible version of hover
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param options - Hover options
 */
export async function hoverInMainContext(
	page: Page,
	selector: string,
	options: { timeout?: number } = {},
): Promise<void> {
	const { timeout = 30000 } = options;

	// First wait for the element to exist
	await waitForSelectorInMainContext(page, selector, {
		state: "visible",
		timeout,
	});

	// Hover using the context bridge - dispatch mouseenter/mouseover events
	const result = await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct hover if bridge not available
			const el = document.querySelector(sel) as HTMLElement | null;
			if (!el) return { success: false, error: "Element not found" };
			el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
			el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
			return { success: true };
		}

		// Use context bridge to hover in main world
		// @ts-expect-error - evaluateMain is injected by bridge
		const bridgeResult = await window.evaluateMain(`
			(function() {
				const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
				if (!el) return { success: false, error: 'Element not found' };
				el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
				el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
				return { success: true };
			})()
		`);
		return bridgeResult.result || { success: false, error: "Bridge error" };
	}, selector);

	if (!result.success) {
		throw new Error(`hover: ${result.error || "Failed to hover element"}`);
	}
}

/**
 * Focus an element in the main context
 * Helper for press and type operations
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param options - Focus options
 */
export async function focusInMainContext(
	page: Page,
	selector: string,
	options: { timeout?: number } = {},
): Promise<void> {
	const { timeout = 30000 } = options;

	// First wait for the element to exist
	await waitForSelectorInMainContext(page, selector, {
		state: "visible",
		timeout,
	});

	// Focus the element via context bridge
	await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			const el = document.querySelector(sel) as HTMLElement | null;
			if (el) el.focus();
			return;
		}
		// @ts-expect-error - evaluateMain is injected by bridge
		await window.evaluateMain(`
			(function() {
				const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
				if (el) el.focus();
			})()
		`);
	}, selector);
}

/**
 * Type text into an element in the main context
 * This is the alwaysIsolated-compatible version of type
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param text - Text to type
 * @param options - Type options
 */
export async function typeInMainContext(
	page: Page,
	selector: string,
	text: string,
	options: { timeout?: number; delay?: number } = {},
): Promise<void> {
	// Focus the element first
	await focusInMainContext(page, selector, { timeout: options.timeout });

	// Use keyboard to type (this works in isolated context)
	await page.keyboard.type(text, { delay: options.delay });
}

/**
 * Wait for a selector to appear in the main context
 * This is the alwaysIsolated-compatible version of waitForSelector
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 * @param options - Wait options
 */
export async function waitForSelectorInMainContext(
	page: Page,
	selector: string,
	options: {
		state?: "attached" | "visible";
		timeout?: number;
	} = {},
): Promise<boolean> {
	const { state = "visible", timeout = 30000 } = options;
	const startTime = Date.now();
	const pollInterval = 100;

	while (Date.now() - startTime < timeout) {
		const result = await page.evaluate(
			async ({ sel, checkVisible }) => {
				// @ts-expect-error - evaluateMain is injected by bridge
				if (typeof window.evaluateMain !== "function") {
					// Fallback to direct query if bridge not available
					const el = document.querySelector(sel);
					if (!el) return { found: false };
					if (!checkVisible) return { found: true };
					const rect = el.getBoundingClientRect();
					const style = window.getComputedStyle(el);
					const isVisible =
						rect.width > 0 &&
						rect.height > 0 &&
						style.visibility !== "hidden" &&
						style.display !== "none";
					return { found: isVisible };
				}

				// Use context bridge to check in main world
				// @ts-expect-error - evaluateMain is injected by bridge
				const bridgeResult = await window.evaluateMain(`
					(function() {
						const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
						if (!el) return { found: false };
						if (!${checkVisible}) return { found: true };
						const rect = el.getBoundingClientRect();
						const style = window.getComputedStyle(el);
						const isVisible = rect.width > 0 && rect.height > 0 &&
							style.visibility !== 'hidden' && style.display !== 'none';
						return { found: isVisible };
					})()
				`);
				return bridgeResult.result || { found: false };
			},
			{ sel: selector, checkVisible: state === "visible" },
		);

		if (result.found) {
			return true;
		}

		// Wait before next check
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error(
		`waitForSelector: Timeout ${timeout}ms exceeded waiting for selector "${selector}"`,
	);
}

/**
 * Get page HTML content in the main context
 * This is the alwaysIsolated-compatible version of page.content()
 *
 * @param page - Playwright Page object
 */
export async function contentInMainContext(page: Page): Promise<string> {
	const result = await page.evaluate(async () => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct access if bridge not available
			return { content: document.documentElement.outerHTML };
		}

		// Use context bridge to get content in main world
		// @ts-expect-error - evaluateMain is injected by bridge
		const bridgeResult = await window.evaluateMain(`
			(function() {
				return { content: document.documentElement.outerHTML };
			})()
		`);
		return bridgeResult.result || { content: "" };
	});

	return result.content || "";
}

/**
 * Get text content of an element in the main context
 * This is the alwaysIsolated-compatible version of locator.textContent()
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 */
export async function textContentInMainContext(
	page: Page,
	selector: string,
): Promise<string | null> {
	const result = await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct query if bridge not available
			const el = document.querySelector(sel);
			return { text: el ? el.textContent : null };
		}

		// Use context bridge to get text content in main world
		// @ts-expect-error - evaluateMain is injected by bridge
		const bridgeResult = await window.evaluateMain(`
			(function() {
				const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
				return { text: el ? el.textContent : null };
			})()
		`);
		return bridgeResult.result || { text: null };
	}, selector);

	return result.text ?? null;
}

/**
 * Get input value of an element in the main context
 * This is the alwaysIsolated-compatible version of locator.inputValue()
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector
 */
export async function inputValueInMainContext(
	page: Page,
	selector: string,
): Promise<string> {
	const result = await page.evaluate(async (sel) => {
		// @ts-expect-error - evaluateMain is injected by bridge
		if (typeof window.evaluateMain !== "function") {
			// Fallback to direct query if bridge not available
			const el = document.querySelector(sel) as HTMLInputElement | null;
			return { value: el ? el.value : "" };
		}

		// Use context bridge to get input value in main world
		// @ts-expect-error - evaluateMain is injected by bridge
		const bridgeResult = await window.evaluateMain(`
			(function() {
				const el = document.querySelector('${sel.replace(/'/g, "\\'")}');
				return { value: el ? el.value : '' };
			})()
		`);
		return bridgeResult.result || { value: "" };
	}, selector);

	return result.value ?? "";
}
