/**
 * Browser Manager
 *
 * Manages Chromium browser lifecycle using rebrowser-playwright
 * with comprehensive stealth capabilities for DataDome/PerimeterX bypass.
 */

/**
 * Configure rebrowser-patches environment variables
 * MUST be set BEFORE importing rebrowser-playwright
 */
function configureRebrowserPatches(): void {
	// Runtime.Enable leak fix mode
	// 'alwaysIsolated' - best for CDP leak prevention (required for DataDome/PerimeterX)
	// Uses context bridge for main context access
	// Only override if not already set by environment
	if (!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE) {
		process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = "alwaysIsolated";
	}

	// Disguise sourceURL in page.evaluate() calls to look like a normal library
	if (!process.env.REBROWSER_PATCHES_SOURCE_URL) {
		process.env.REBROWSER_PATCHES_SOURCE_URL = "jquery.min.js";
	}

	// Disguise utility world name (hides "UtilityScript" from stack traces)
	// MUST be set before importing rebrowser-playwright
	if (!process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME) {
		process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME = "util";
	}
}

// Configure patches BEFORE importing rebrowser-playwright
configureRebrowserPatches();

import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "rebrowser-playwright";

import {
	BOT_DETECTION_DOMAINS,
	type BrowserProfile,
	cleanupMouseState,
	clearSessionTimingConfig,
	DEFAULT_STEALTH_CONFIG,
	generateStealthScript,
	getProfile,
	MAIN_CONTEXT_BRIDGE_SCRIPT,
	type StealthConfig,
} from "../stealth";

export interface BrowserConfig {
	headless?: boolean;
	viewport?: {
		width: number;
		height: number;
	};
	userAgent?: string;
	/** Stealth configuration for anti-bot evasion */
	stealth?: StealthConfig;
	/** Session ID for tracking mouse state and timing */
	sessionId?: string;
	/** Internal flag to track if viewport was explicitly provided */
	_viewportProvided?: boolean;
}

export interface BrowserInstance {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	/** Active browser profile for fingerprint consistency */
	profile: BrowserProfile;
	/** Session ID for state tracking */
	sessionId: string;
}

const DEFAULT_CONFIG: Required<BrowserConfig> = {
	headless: false,
	viewport: {
		width: 1280,
		height: 720,
	},
	userAgent:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	stealth: DEFAULT_STEALTH_CONFIG,
	sessionId: "",
	_viewportProvided: false,
};

// Note: PW_INIT_SCRIPTS_CLEANUP is now part of generateStealthScript() in stealth module

/**
 * Launch arguments for Chromium in Docker environment
 */
const CHROMIUM_ARGS = [
	"--disable-dev-shm-usage",
	"--no-sandbox",
	"--disable-setuid-sandbox",
	"--disable-gpu",
	"--disable-background-timer-throttling",
	"--disable-backgrounding-occluded-windows",
	"--disable-renderer-backgrounding",
	"--disable-features=TranslateUI",
	"--disable-ipc-flooding-protection",
	// Stealth args for bot detection evasion
	"--disable-blink-features=AutomationControlled",
	"--disable-features=IsolateOrigins,site-per-process",
	"--disable-site-isolation-trials",
];

/**
 * BrowserManager handles the lifecycle of a single browser instance
 * with comprehensive stealth capabilities for DataDome/PerimeterX bypass.
 */
export class BrowserManager {
	private instance: BrowserInstance | null = null;
	private config: Required<BrowserConfig>;

	constructor(config: BrowserConfig = {}) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			stealth: { ...DEFAULT_STEALTH_CONFIG, ...config.stealth },
			// Track if viewport was explicitly provided
			_viewportProvided: config.viewport !== undefined,
		};

		// Generate session ID if not provided
		if (!this.config.sessionId) {
			this.config.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
		}
	}

	/**
	 * Launch a new browser instance with stealth capabilities
	 * @throws Error if browser is already running
	 */
	async launch(): Promise<BrowserInstance> {
		if (this.instance) {
			throw new Error("Browser is already running. Call close() first.");
		}

		const stealthConfig = this.config.stealth;
		const profile = getProfile(stealthConfig.profile ?? "chrome-mac");

		const browser = await chromium.launch({
			headless: this.config.headless,
			args: CHROMIUM_ARGS,
		});

		// Use profile viewport/userAgent if stealth is enabled, unless explicitly provided
		// If viewport was explicitly provided in config, always use it
		const viewport = this.config._viewportProvided
			? this.config.viewport
			: stealthConfig.enabled
				? profile.viewport
				: this.config.viewport;
		const userAgent = stealthConfig.enabled
			? profile.userAgent
			: this.config.userAgent;

		const context = await browser.newContext({
			viewport,
			userAgent,
			locale: stealthConfig.enabled ? profile.locale : undefined,
			timezoneId: stealthConfig.enabled ? profile.timezone : undefined,
			deviceScaleFactor: stealthConfig.enabled
				? profile.deviceScaleFactor
				: undefined,
		});

		// Apply stealth scripts if enabled
		if (stealthConfig.enabled) {
			// Generate combined stealth script with profile-specific spoofing
			const stealthScript = generateStealthScript(
				profile,
				stealthConfig.fingerprint,
			);
			await context.addInitScript(stealthScript);

			// Add context bridge for alwaysIsolated mode
			await context.addInitScript(MAIN_CONTEXT_BRIDGE_SCRIPT);

			// Block bot detection scripts if configured
			if (stealthConfig.blockBotDetection) {
				for (const pattern of BOT_DETECTION_DOMAINS) {
					await context.route(pattern, (route) =>
						route.abort("blockedbyclient"),
					);
				}
			}

			// Set realistic HTTP headers
			await context.setExtraHTTPHeaders({
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Encoding": "gzip, deflate, br",
				"Accept-Language": "en-US,en;q=0.9",
				"Sec-CH-UA":
					'"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
				"Sec-CH-UA-Mobile": "?0",
				"Sec-CH-UA-Platform": `"${profile.platform.includes("Mac") ? "macOS" : profile.platform.includes("Win") ? "Windows" : "Linux"}"`,
				"Sec-Fetch-Dest": "document",
				"Sec-Fetch-Mode": "navigate",
				"Sec-Fetch-Site": "none",
				"Sec-Fetch-User": "?1",
				"Upgrade-Insecure-Requests": "1",
			});
		}

		const page = await context.newPage();

		this.instance = {
			browser,
			context,
			page,
			profile,
			sessionId: this.config.sessionId,
		};

		return this.instance;
	}

	/**
	 * Get the current browser instance
	 * @throws Error if browser is not running
	 */
	getInstance(): BrowserInstance {
		if (!this.instance) {
			throw new Error("Browser is not running. Call launch() first.");
		}
		return this.instance;
	}

	/**
	 * Check if browser is currently running
	 */
	isRunning(): boolean {
		return this.instance?.browser.isConnected() ?? false;
	}

	/**
	 * Get browser status information
	 */
	getStatus(): {
		running: boolean;
		connected: boolean;
		viewport: { width: number; height: number } | null;
		url: string | null;
	} {
		if (!this.instance) {
			return {
				running: false,
				connected: false,
				viewport: null,
				url: null,
			};
		}

		return {
			running: true,
			connected: this.instance.browser.isConnected(),
			viewport: this.config.viewport,
			url: this.instance.page.url(),
		};
	}

	/**
	 * Close the browser and clean up resources
	 */
	async close(): Promise<void> {
		if (!this.instance) {
			return;
		}

		const sessionId = this.instance.sessionId;

		try {
			await this.instance.context.close();
		} catch {
			// Context may already be closed
		}

		try {
			await this.instance.browser.close();
		} catch {
			// Browser may already be closed
		}

		// Clean up session state
		cleanupMouseState(sessionId);
		clearSessionTimingConfig(sessionId);

		this.instance = null;
	}

	/**
	 * Get the current session ID
	 */
	getSessionId(): string {
		return this.instance?.sessionId ?? this.config.sessionId;
	}

	/**
	 * Get the current browser profile
	 */
	getProfile(): BrowserProfile | null {
		return this.instance?.profile ?? null;
	}

	/**
	 * Get the stealth configuration
	 */
	getStealthConfig(): StealthConfig {
		return this.config.stealth;
	}

	/**
	 * Navigate to a URL
	 */
	async navigate(url: string): Promise<void> {
		const { page } = this.getInstance();
		await page.goto(url, { waitUntil: "domcontentloaded" });
	}

	/**
	 * Set viewport size
	 */
	async setViewport(width: number, height: number): Promise<void> {
		const { page } = this.getInstance();
		await page.setViewportSize({ width, height });
		this.config.viewport = { width, height };
	}

	/**
	 * Get current page
	 */
	getPage(): Page {
		return this.getInstance().page;
	}

	/**
	 * Get browser context
	 */
	getContext(): BrowserContext {
		return this.getInstance().context;
	}
}

// Singleton instance for simple usage
let defaultManager: BrowserManager | null = null;

/**
 * Get or create the default browser manager
 */
export function getDefaultBrowserManager(
	config?: BrowserConfig,
): BrowserManager {
	if (!defaultManager) {
		defaultManager = new BrowserManager(config);
	}
	return defaultManager;
}

/**
 * Reset the default browser manager (for testing)
 */
export async function resetDefaultBrowserManager(): Promise<void> {
	if (defaultManager) {
		await defaultManager.close();
		defaultManager = null;
	}
}
