/**
 * Session Manager
 *
 * Manages multiple concurrent browser sessions on a single Chromium instance.
 * Each session has an isolated BrowserContext with its own cookies, storage,
 * and stealth fingerprint.
 */

import type { Browser, BrowserContext, Page } from "rebrowser-playwright";
import { chromium } from "rebrowser-playwright";
import type { FrameMessage, ServerMessage } from "../protocol/types";
import {
	BOT_DETECTION_DOMAINS,
	type BrowserProfile,
	cleanupMouseState,
	clearSessionTimingConfig,
	DEFAULT_STEALTH_CONFIG,
	generateStealthScript,
	getProfile,
	MAIN_CONTEXT_BRIDGE_SCRIPT,
	type ProfileName,
	type StealthConfig,
} from "../stealth";
import { CDPSessionManager } from "./cdp-session";
import { CommandQueue } from "./command-queue";

/**
 * Configuration for creating a new session
 */
export interface CreateSessionOptions {
	viewport?: {
		width: number;
		height: number;
	};
	/** Stealth profile to use (e.g., "chrome-mac", "chrome-win") */
	profile?: string;
	/** Custom user agent */
	userAgent?: string;
	/** Timing mode for commands */
	timingMode?: "stealth" | "fast" | "none";
	/** Initial URL to navigate to */
	initialUrl?: string;
}

/**
 * Session configuration from environment
 */
export interface SessionManagerConfig {
	/** Maximum concurrent sessions (default: 10) */
	maxSessions?: number;
	/** Session idle timeout in ms (default: 300000 = 5 min) */
	sessionIdleTimeout?: number;
	/** Session max lifetime in ms (default: 3600000 = 1 hour) */
	sessionMaxLifetime?: number;
	/** GC interval in ms (default: 60000 = 1 min) */
	gcInterval?: number;
	/** Default viewport */
	defaultViewport?: { width: number; height: number };
	/** Headless mode */
	headless?: boolean;
	/** Stealth configuration */
	stealth?: StealthConfig;
}

/**
 * A single browser session with isolated context
 */
export interface BrowserSession {
	/** Unique session identifier */
	id: string;
	/** Isolated browser context */
	context: BrowserContext;
	/** Session's page */
	page: Page;
	/** CDP session for screencast and input */
	cdpSession: CDPSessionManager;
	/** Command queue for this session */
	commandQueue: CommandQueue;
	/** WebSocket client IDs subscribed to this session */
	clients: Set<string>;
	/** Browser profile for fingerprint */
	profile: BrowserProfile;
	/** Session viewport */
	viewport: { width: number; height: number };
	/** Session creation timestamp */
	createdAt: number;
	/** Last activity timestamp */
	lastActivity: number;
	/** Last frame for new clients */
	frameBuffer: FrameMessage | null;
	/** Session status */
	status: "creating" | "ready" | "closing" | "closed";
}

/**
 * Session info returned to clients (excludes internal details)
 */
export interface SessionInfo {
	id: string;
	status: BrowserSession["status"];
	viewport: { width: number; height: number };
	clientCount: number;
	createdAt: number;
	lastActivity: number;
	url: string;
}

// Chromium launch arguments
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
	"--disable-blink-features=AutomationControlled",
	"--disable-features=IsolateOrigins,site-per-process",
	"--disable-site-isolation-trials",
];

/**
 * Manages multiple browser sessions on a single Chromium instance
 */
export class SessionManager {
	private browser: Browser | null = null;
	private sessions = new Map<string, BrowserSession>();
	private config: Required<SessionManagerConfig>;
	private gcIntervalId: ReturnType<typeof setInterval> | null = null;

	/** Callback for frame broadcasts (set by WSHandler) */
	onSessionFrame?: (sessionId: string, frame: FrameMessage) => void;
	/** Callback for session events (set by WSHandler) */
	onSessionEvent?: (sessionId: string, event: ServerMessage) => void;

	constructor(config: SessionManagerConfig = {}) {
		this.config = {
			maxSessions: config.maxSessions ?? 10,
			sessionIdleTimeout: config.sessionIdleTimeout ?? 300000, // 5 min
			sessionMaxLifetime: config.sessionMaxLifetime ?? 3600000, // 1 hour
			gcInterval: config.gcInterval ?? 60000, // 1 min
			defaultViewport: config.defaultViewport ?? { width: 1280, height: 720 },
			headless: config.headless ?? false,
			stealth: config.stealth ?? DEFAULT_STEALTH_CONFIG,
		};
	}

	/**
	 * Initialize the session manager and launch browser
	 */
	async initialize(): Promise<void> {
		if (this.browser) {
			throw new Error("SessionManager already initialized");
		}

		console.log("[session-manager] Launching browser...");
		this.browser = await chromium.launch({
			headless: this.config.headless,
			args: CHROMIUM_ARGS,
		});
		console.log("[session-manager] Browser launched");

		// Start garbage collection
		this.startGC();
	}

	/**
	 * Create a new browser session
	 */
	async createSession(
		options: CreateSessionOptions = {},
	): Promise<BrowserSession> {
		if (!this.browser) {
			throw new Error(
				"SessionManager not initialized. Call initialize() first.",
			);
		}

		// Check session limit
		if (this.sessions.size >= this.config.maxSessions) {
			// Try to evict idle sessions first
			await this.evictIdleSessions();

			if (this.sessions.size >= this.config.maxSessions) {
				throw new Error(
					`Maximum sessions (${this.config.maxSessions}) reached. Cannot create new session.`,
				);
			}
		}

		const sessionId = this.generateSessionId();
		const profileName = (options.profile ?? "chrome-mac") as ProfileName;
		const profile = getProfile(profileName);
		const viewport = options.viewport ?? this.config.defaultViewport;
		const stealthConfig = this.config.stealth;

		console.log(`[session-manager] Creating session ${sessionId}...`);

		// Create isolated browser context with stealth settings
		const context = await this.browser.newContext({
			viewport,
			userAgent: options.userAgent ?? profile.userAgent,
			locale: stealthConfig.enabled ? profile.locale : undefined,
			timezoneId: stealthConfig.enabled ? profile.timezone : undefined,
			deviceScaleFactor: stealthConfig.enabled
				? profile.deviceScaleFactor
				: undefined,
		});

		// Apply stealth scripts
		if (stealthConfig.enabled) {
			const stealthScript = generateStealthScript(
				profile,
				stealthConfig.fingerprint,
			);
			await context.addInitScript(stealthScript);
			await context.addInitScript(MAIN_CONTEXT_BRIDGE_SCRIPT);

			// Block bot detection scripts
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

		// Create page
		const page = await context.newPage();

		// Create CDP session for screencast
		const cdpSession = new CDPSessionManager(page, {
			screencast: {
				format: "jpeg",
				quality: 60,
				maxWidth: viewport.width,
				maxHeight: viewport.height,
			},
			sessionId,
			onFrame: (frame) => {
				const session = this.sessions.get(sessionId);
				if (session) {
					session.frameBuffer = frame;
					session.lastActivity = Date.now();
					this.onSessionFrame?.(sessionId, frame);
				}
			},
			onEvent: (event) => {
				this.onSessionEvent?.(sessionId, event);
			},
		});

		// Create command queue for this session
		const commandQueue = new CommandQueue({
			page,
			timeout: 30000,
			sessionId,
			timingMode: options.timingMode ?? "none",
		});

		const now = Date.now();
		const session: BrowserSession = {
			id: sessionId,
			context,
			page,
			cdpSession,
			commandQueue,
			clients: new Set(),
			profile,
			viewport,
			createdAt: now,
			lastActivity: now,
			frameBuffer: null,
			status: "creating",
		};

		this.sessions.set(sessionId, session);

		// Initialize CDP and start screencast
		await cdpSession.init();
		await cdpSession.startScreencast();

		// Navigate to initial URL if provided
		if (options.initialUrl) {
			await page.goto(options.initialUrl, { waitUntil: "domcontentloaded" });
		}

		session.status = "ready";
		console.log(`[session-manager] Session ${sessionId} ready`);

		return session;
	}

	/**
	 * Get a session by ID
	 */
	getSession(sessionId: string): BrowserSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Check if a session exists
	 */
	hasSession(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	/**
	 * Update session activity timestamp
	 */
	touchSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.lastActivity = Date.now();
		}
	}

	/**
	 * Add a client to a session
	 */
	addClient(sessionId: string, clientId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;

		session.clients.add(clientId);
		session.lastActivity = Date.now();
		return true;
	}

	/**
	 * Remove a client from a session
	 */
	removeClient(sessionId: string, clientId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;

		session.clients.delete(clientId);
		session.lastActivity = Date.now();
		return true;
	}

	/**
	 * Destroy a session and cleanup resources
	 */
	async destroySession(sessionId: string): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session) return false;

		console.log(`[session-manager] Destroying session ${sessionId}...`);
		session.status = "closing";

		// Stop screencast and cleanup CDP
		try {
			await session.cdpSession.close();
		} catch (error) {
			console.error(
				`[session-manager] Error closing CDP for ${sessionId}:`,
				error,
			);
		}

		// Clear command queue
		session.commandQueue.clear();

		// Close context (this also closes all pages)
		try {
			await session.context.close();
		} catch (error) {
			console.error(
				`[session-manager] Error closing context for ${sessionId}:`,
				error,
			);
		}

		// Cleanup stealth state
		cleanupMouseState(sessionId);
		clearSessionTimingConfig(sessionId);

		session.status = "closed";
		this.sessions.delete(sessionId);
		console.log(`[session-manager] Session ${sessionId} destroyed`);

		return true;
	}

	/**
	 * List all sessions
	 */
	listSessions(): SessionInfo[] {
		const sessions: SessionInfo[] = [];
		for (const session of this.sessions.values()) {
			sessions.push({
				id: session.id,
				status: session.status,
				viewport: session.viewport,
				clientCount: session.clients.size,
				createdAt: session.createdAt,
				lastActivity: session.lastActivity,
				url: session.page.url(),
			});
		}
		return sessions;
	}

	/**
	 * Get session count
	 */
	getSessionCount(): number {
		return this.sessions.size;
	}

	/**
	 * Get max sessions limit
	 */
	getMaxSessions(): number {
		return this.config.maxSessions;
	}

	/**
	 * Check if browser is running
	 */
	isRunning(): boolean {
		return this.browser?.isConnected() ?? false;
	}

	/**
	 * Update screencast settings for a session (e.g., after viewport change)
	 */
	async updateSessionScreencast(
		sessionId: string,
		width: number,
		height: number,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		session.viewport = { width, height };
		await session.cdpSession.updateScreencastSettings({
			maxWidth: width,
			maxHeight: height,
		});
	}

	/**
	 * Start garbage collection timer
	 */
	private startGC(): void {
		if (this.gcIntervalId) return;

		this.gcIntervalId = setInterval(() => {
			this.runGC().catch((error) => {
				console.error("[session-manager] GC error:", error);
			});
		}, this.config.gcInterval);
	}

	/**
	 * Stop garbage collection timer
	 */
	private stopGC(): void {
		if (this.gcIntervalId) {
			clearInterval(this.gcIntervalId);
			this.gcIntervalId = null;
		}
	}

	/**
	 * Run garbage collection
	 */
	private async runGC(): Promise<void> {
		const now = Date.now();
		const toDestroy: string[] = [];

		for (const [sessionId, session] of this.sessions) {
			// Check lifetime
			const lifetime = now - session.createdAt;
			if (lifetime > this.config.sessionMaxLifetime) {
				console.log(
					`[session-manager] Session ${sessionId} exceeded max lifetime`,
				);
				toDestroy.push(sessionId);
				continue;
			}

			// Check idle timeout (only if no clients connected)
			if (session.clients.size === 0) {
				const idleTime = now - session.lastActivity;
				if (idleTime > this.config.sessionIdleTimeout) {
					console.log(`[session-manager] Session ${sessionId} idle timeout`);
					toDestroy.push(sessionId);
				}
			}
		}

		// Destroy expired sessions
		for (const sessionId of toDestroy) {
			await this.destroySession(sessionId);
		}

		if (toDestroy.length > 0) {
			console.log(
				`[session-manager] GC cleaned up ${toDestroy.length} sessions`,
			);
		}
	}

	/**
	 * Evict idle sessions to make room for new ones
	 */
	private async evictIdleSessions(): Promise<number> {
		const now = Date.now();
		const idleSessions: Array<{ id: string; idleTime: number }> = [];

		for (const [sessionId, session] of this.sessions) {
			// Only consider sessions with no clients
			if (session.clients.size === 0) {
				idleSessions.push({
					id: sessionId,
					idleTime: now - session.lastActivity,
				});
			}
		}

		// Sort by idle time (most idle first)
		idleSessions.sort((a, b) => b.idleTime - a.idleTime);

		// Evict up to half of idle sessions
		const toEvict = Math.min(Math.ceil(idleSessions.length / 2), 3);
		let evicted = 0;

		for (let i = 0; i < toEvict && i < idleSessions.length; i++) {
			await this.destroySession(idleSessions[i].id);
			evicted++;
		}

		return evicted;
	}

	/**
	 * Generate unique session ID
	 */
	private generateSessionId(): string {
		return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	/**
	 * Close all sessions and browser
	 */
	async close(): Promise<void> {
		console.log("[session-manager] Closing all sessions...");
		this.stopGC();

		// Destroy all sessions
		const sessionIds = Array.from(this.sessions.keys());
		for (const sessionId of sessionIds) {
			await this.destroySession(sessionId);
		}

		// Close browser
		if (this.browser) {
			try {
				await this.browser.close();
			} catch (error) {
				console.error("[session-manager] Error closing browser:", error);
			}
			this.browser = null;
		}

		console.log("[session-manager] Closed");
	}
}

/**
 * Create a session manager with environment configuration
 */
export function createSessionManager(): SessionManager {
	return new SessionManager({
		maxSessions: parseInt(process.env.MAX_SESSIONS || "10", 10),
		sessionIdleTimeout: parseInt(
			process.env.SESSION_IDLE_TIMEOUT || "300000",
			10,
		),
		sessionMaxLifetime: parseInt(
			process.env.SESSION_MAX_LIFETIME || "3600000",
			10,
		),
		gcInterval: parseInt(process.env.SESSION_GC_INTERVAL || "60000", 10),
		defaultViewport: {
			width: parseInt(process.env.VIEWPORT_WIDTH || "1280", 10),
			height: parseInt(process.env.VIEWPORT_HEIGHT || "720", 10),
		},
		headless: process.env.HEADLESS === "true",
	});
}
