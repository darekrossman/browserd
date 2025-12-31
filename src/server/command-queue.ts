/**
 * Command Queue
 *
 * Serializes Playwright command execution to prevent race conditions
 * with configurable timing delays for human-like behavior
 */

import type { Page } from "rebrowser-playwright";
import {
	type CommandMessage,
	createErrorResult,
	createSuccessResult,
	type PlaywrightMethod,
	type ResultMessage,
} from "../protocol/types";
import {
	applyTimingDelay,
	clickInMainContext,
	DEFAULT_TIMING_CONFIG,
	dblclickInMainContext,
	FAST_TIMING_CONFIG,
	fillInMainContext,
	focusInMainContext,
	hoverInMainContext,
	setSessionTimingConfig,
	type TimingConfig,
	type TimingOperation,
	typeInMainContext,
	waitForSelectorInMainContext,
} from "../stealth";

export interface CommandQueueOptions {
	page: Page;
	timeout?: number;
	onResult?: (result: ResultMessage) => void;
	/** Session ID for timing configuration */
	sessionId?: string;
	/** Timing mode: 'stealth' for human-like delays, 'fast' for minimal delays */
	timingMode?: "stealth" | "fast" | "none";
}

interface QueuedCommand {
	command: CommandMessage;
	resolve: (result: ResultMessage) => void;
}

/**
 * Command executor function type
 */
type CommandExecutor = (
	page: Page,
	params: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Map Playwright methods to timing operations
 */
function getTimingOperation(
	method: PlaywrightMethod,
	phase: "before" | "after",
): TimingOperation | null {
	const beforeMap: Partial<Record<PlaywrightMethod, TimingOperation>> = {
		click: "beforeClick",
		dblclick: "beforeClick",
		hover: "beforeHover",
		type: "beforeType",
		fill: "beforeFormFill",
	};

	const afterMap: Partial<Record<PlaywrightMethod, TimingOperation>> = {
		click: "afterClick",
		dblclick: "afterClick",
		hover: "hoverDuration",
		type: "afterType",
		fill: "afterFormFill",
		navigate: "afterNavigation",
		goBack: "afterNavigation",
		goForward: "afterNavigation",
		reload: "afterNavigation",
	};

	const map = phase === "before" ? beforeMap : afterMap;
	return map[method] ?? null;
}

/**
 * Map of Playwright method names to executor functions
 */
const EXECUTORS: Record<PlaywrightMethod, CommandExecutor> = {
	navigate: async (page, params) => {
		const url = params.url as string;
		if (!url) throw new Error("Missing url parameter");
		await page.goto(url, {
			waitUntil:
				(params.waitUntil as "load" | "domcontentloaded" | "networkidle") ||
				"domcontentloaded",
			timeout: (params.timeout as number) || 30000,
		});
		return { url: page.url() };
	},

	click: async (page, params) => {
		const selector = params.selector as string;
		if (!selector) throw new Error("Missing selector parameter");

		// Always use context bridge for alwaysIsolated compatibility
		await clickInMainContext(page, selector, {
			timeout: (params.timeout as number) || 30000,
		});
		return { clicked: selector };
	},

	dblclick: async (page, params) => {
		const selector = params.selector as string;
		if (!selector) throw new Error("Missing selector parameter");

		// Always use context bridge for alwaysIsolated compatibility
		await dblclickInMainContext(page, selector, {
			timeout: (params.timeout as number) || 30000,
		});
		return { dblclicked: selector };
	},

	hover: async (page, params) => {
		const selector = params.selector as string;
		if (!selector) throw new Error("Missing selector parameter");

		// Always use context bridge for alwaysIsolated compatibility
		await hoverInMainContext(page, selector, {
			timeout: (params.timeout as number) || 30000,
		});
		return { hovered: selector };
	},

	type: async (page, params) => {
		const selector = params.selector as string;
		const text = params.text as string;
		if (!selector) throw new Error("Missing selector parameter");
		if (text === undefined) throw new Error("Missing text parameter");

		// Always use context bridge for alwaysIsolated compatibility
		await typeInMainContext(page, selector, text, {
			delay: (params.delay as number) || 0,
			timeout: (params.timeout as number) || 30000,
		});
		return { typed: text, into: selector };
	},

	press: async (page, params) => {
		const key = params.key as string;
		if (!key) throw new Error("Missing key parameter");
		const selector = params.selector as string;
		if (selector) {
			// Use context bridge to focus, then keyboard to press
			await focusInMainContext(page, selector, {
				timeout: (params.timeout as number) || 30000,
			});
		}
		await page.keyboard.press(key, {
			delay: params.delay as number,
		});
		return { pressed: key };
	},

	fill: async (page, params) => {
		const selector = params.selector as string;
		const value = params.value as string;
		if (!selector) throw new Error("Missing selector parameter");
		if (value === undefined) throw new Error("Missing value parameter");

		// Always use context bridge for alwaysIsolated compatibility
		await fillInMainContext(page, selector, value, {
			timeout: (params.timeout as number) || 30000,
		});
		return { filled: selector, with: value };
	},

	waitForSelector: async (page, params) => {
		const selector = params.selector as string;
		if (!selector) throw new Error("Missing selector parameter");

		// Always use context bridge for alwaysIsolated compatibility
		const state = params.state as "attached" | "visible" | undefined;
		await waitForSelectorInMainContext(page, selector, {
			state: state === "attached" ? "attached" : "visible",
			timeout: (params.timeout as number) || 30000,
		});
		return { found: selector };
	},

	setViewport: async (page, params) => {
		const width = params.width as number;
		const height = params.height as number;
		if (!width || !height) throw new Error("Missing width or height parameter");
		await page.setViewportSize({ width, height });
		return { viewport: { width, height } };
	},

	evaluate: async (page, params) => {
		const expression = params.expression as string;
		if (!expression) throw new Error("Missing expression parameter");
		const result = await page.evaluate(expression);
		return { result };
	},

	screenshot: async (page, params) => {
		const type = (params.type as "jpeg" | "png") || "png";
		const quality = params.quality as number | undefined;

		// In alwaysIsolated mode, fullPage screenshots hang because Playwright's
		// internal page.evaluate() for getting dimensions doesn't work.
		// Workaround: get dimensions directly (fallback works in isolated context)
		if (params.fullPage) {
			// Get page dimensions - works in isolated context via direct DOM access
			const dimensions = await page.evaluate(() => ({
				width: document.documentElement.scrollWidth,
				height: document.documentElement.scrollHeight,
			}));

			// Save original viewport
			const originalViewport = page.viewportSize();

			// Resize to full page dimensions
			await page.setViewportSize({
				width: Math.max(dimensions.width, originalViewport?.width || 1280),
				height: dimensions.height,
			});

			// Take screenshot (without fullPage flag since we already resized)
			const buffer = await page.screenshot({ type, quality });

			// Restore original viewport
			if (originalViewport) {
				await page.setViewportSize(originalViewport);
			}

			return { data: buffer.toString("base64"), format: type };
		}

		// Regular screenshot (works fine in alwaysIsolated mode)
		const buffer = await page.screenshot({ type, quality });
		return { data: buffer.toString("base64"), format: type };
	},

	goBack: async (page, params) => {
		await page.goBack({
			waitUntil:
				(params.waitUntil as "load" | "domcontentloaded" | "networkidle") ||
				"domcontentloaded",
			timeout: (params.timeout as number) || 30000,
		});
		return { url: page.url() };
	},

	goForward: async (page, params) => {
		await page.goForward({
			waitUntil:
				(params.waitUntil as "load" | "domcontentloaded" | "networkidle") ||
				"domcontentloaded",
			timeout: (params.timeout as number) || 30000,
		});
		return { url: page.url() };
	},

	reload: async (page, params) => {
		await page.reload({
			waitUntil:
				(params.waitUntil as "load" | "domcontentloaded" | "networkidle") ||
				"domcontentloaded",
			timeout: (params.timeout as number) || 30000,
		});
		return { url: page.url() };
	},
};

/**
 * Command queue for serialized Playwright command execution
 */
export class CommandQueue {
	private page: Page;
	private timeout: number;
	private onResult?: (result: ResultMessage) => void;
	private queue: QueuedCommand[] = [];
	private processing = false;
	private sessionId: string;
	private timingMode: "stealth" | "fast" | "none";
	private actionCount = 0;

	constructor(options: CommandQueueOptions) {
		this.page = options.page;
		this.timeout = options.timeout || 30000;
		this.onResult = options.onResult;
		this.sessionId =
			options.sessionId ||
			`queue-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
		this.timingMode = options.timingMode ?? "none";

		// Initialize session timing config based on mode
		if (this.timingMode !== "none") {
			const config =
				this.timingMode === "stealth"
					? DEFAULT_TIMING_CONFIG
					: FAST_TIMING_CONFIG;
			setSessionTimingConfig(this.sessionId, config);
		}
	}

	/**
	 * Add a command to the queue
	 */
	async enqueue(command: CommandMessage): Promise<ResultMessage> {
		return new Promise((resolve) => {
			this.queue.push({ command, resolve });
			this.processQueue();
		});
	}

	/**
	 * Process commands in the queue sequentially
	 */
	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0) {
			return;
		}

		this.processing = true;

		while (this.queue.length > 0) {
			const item = this.queue.shift();
			if (!item) continue;

			const result = await this.executeCommand(item.command);

			// Notify via callback
			if (this.onResult) {
				this.onResult(result);
			}

			// Resolve the promise
			item.resolve(result);
		}

		this.processing = false;
	}

	/**
	 * Execute a single command with optional timing delays
	 */
	private async executeCommand(
		command: CommandMessage,
	): Promise<ResultMessage> {
		const { id, method, params = {} } = command;

		const executor = EXECUTORS[method];
		if (!executor) {
			return createErrorResult(
				id,
				"UNKNOWN_METHOD",
				`Unknown method: ${method}`,
			);
		}

		try {
			// Apply pre-command timing delay if enabled
			if (this.timingMode !== "none") {
				const beforeOp = getTimingOperation(method, "before");
				if (beforeOp) {
					await applyTimingDelay(
						this.sessionId,
						beforeOp,
						this.timingMode === "stealth",
					);
				}
			}

			// Execute with timeout
			const result = await Promise.race([
				executor(this.page, params),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error(`Command timeout after ${this.timeout}ms`)),
						this.timeout,
					),
				),
			]);

			// Increment action count for local tracking
			this.actionCount++;

			// Apply post-command timing delay if enabled
			if (this.timingMode !== "none") {
				const afterOp = getTimingOperation(method, "after");
				if (afterOp) {
					await applyTimingDelay(
						this.sessionId,
						afterOp,
						this.timingMode === "stealth",
					);
				}
			}

			return createSuccessResult(id, result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const messageLower = message.toLowerCase();

			// Categorize errors based on error message patterns
			// Playwright error patterns vary by method, so we check multiple patterns
			let code = "EXECUTION_ERROR";

			// Timeout errors - Playwright uses various patterns
			if (
				messageLower.includes("timeout") ||
				messageLower.includes("timed out") ||
				messageLower.includes("exceeded") ||
				messageLower.includes("waiting for") || // "waiting for locator/selector"
				messageLower.includes("strict mode violation") // Multiple elements matched
			) {
				code = "TIMEOUT";
			}
			// Navigation errors - check both message and method context
			else if (
				messageLower.includes("navigation") ||
				messageLower.includes("net::") ||
				messageLower.includes("protocol") ||
				messageLower.includes("invalid url") ||
				messageLower.includes("cannot navigate") ||
				messageLower.includes("err_") || // Chrome error codes like ERR_INVALID_URL
				messageLower.includes("not supported") || // "Protocol X is not supported"
				messageLower.includes("goto") // Playwright prefixes navigation errors with "goto:"
			) {
				code = "NAVIGATION_ERROR";
			}
			// Selector/element errors - for click, fill, type on non-existent elements
			else if (
				messageLower.includes("selector") ||
				messageLower.includes("element not found") ||
				messageLower.includes("no element") ||
				messageLower.includes("locator") ||
				messageLower.includes("click") || // "locator.click: ..."
				messageLower.includes("fill") || // "locator.fill: ..."
				messageLower.includes("type") // "locator.type: ..."
			) {
				// Check if it's actually a timeout (Playwright format: "locator.click: Timeout 500ms")
				if (messageLower.includes("500ms") || messageLower.includes("ms")) {
					code = "TIMEOUT";
				} else {
					code = "SELECTOR_ERROR";
				}
			}

			return createErrorResult(id, code, message);
		}
	}

	/**
	 * Get queue length
	 */
	getQueueLength(): number {
		return this.queue.length;
	}

	/**
	 * Check if processing
	 */
	isProcessing(): boolean {
		return this.processing;
	}

	/**
	 * Clear the queue (pending commands will be rejected)
	 */
	clear(): void {
		const items = this.queue.splice(0, this.queue.length);
		for (const item of items) {
			item.resolve(
				createErrorResult(item.command.id, "CANCELLED", "Queue cleared"),
			);
		}
	}

	/**
	 * Update the page reference
	 */
	setPage(page: Page): void {
		this.page = page;
	}

	/**
	 * Set timing mode
	 */
	setTimingMode(mode: "stealth" | "fast" | "none"): void {
		this.timingMode = mode;
		if (mode !== "none") {
			const config =
				mode === "stealth" ? DEFAULT_TIMING_CONFIG : FAST_TIMING_CONFIG;
			setSessionTimingConfig(this.sessionId, config);
		}
	}

	/**
	 * Get current timing mode
	 */
	getTimingMode(): "stealth" | "fast" | "none" {
		return this.timingMode;
	}

	/**
	 * Set custom timing configuration
	 */
	setTimingConfig(config: TimingConfig): void {
		setSessionTimingConfig(this.sessionId, config);
	}

	/**
	 * Reset action counter (useful for new sessions)
	 */
	resetActionCount(): void {
		this.actionCount = 0;
	}

	/**
	 * Get action count
	 */
	getActionCount(): number {
		return this.actionCount;
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string {
		return this.sessionId;
	}
}

/**
 * Create a command queue for a page
 */
export function createCommandQueue(options: CommandQueueOptions): CommandQueue {
	return new CommandQueue(options);
}
