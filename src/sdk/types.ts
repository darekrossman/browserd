/**
 * SDK Types for Browserd Client
 *
 * Types specific to the SDK that extend/complement protocol types
 */

import type { Viewport } from "../protocol/types";

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Configuration options for BrowserdClient
 */
export interface BrowserdClientOptions {
	/**
	 * URL to connect to
	 * - For WebSocket: "ws://localhost:3000/ws" or "wss://..."
	 * - For SSE: "http://localhost:3000" or "https://..." (base URL)
	 */
	url: string;
	/**
	 * Transport type to use (default: "ws")
	 * - "ws": WebSocket (best latency, requires WebSocket support)
	 * - "sse": Server-Sent Events + HTTP POST (works through HTTP-only proxies)
	 */
	transport?: TransportType;
	/** Default timeout for commands in milliseconds (default: 30000) */
	timeout?: number;
	/** Whether to automatically reconnect on disconnect (default: true) */
	autoReconnect?: boolean;
	/** Interval between reconnect attempts in milliseconds (default: 2000) */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts (default: 5) */
	maxReconnectAttempts?: number;
	/** Auth token for authenticated SSE connections (e.g., sprites.dev) */
	authToken?: string;
}

// ============================================================================
// Command Options
// ============================================================================

/**
 * Options for navigation commands
 */
export interface NavigateOptions {
	/** When to consider navigation succeeded */
	waitUntil?: "load" | "domcontentloaded" | "networkidle";
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Result of a navigation command
 */
export interface NavigateResult {
	/** Final URL after navigation */
	url: string;
	/** Page title */
	title?: string;
}

/**
 * Options for click commands
 */
export interface ClickOptions {
	/** Mouse button to use (default: "left") */
	button?: "left" | "right" | "middle";
	/** Number of clicks (default: 1) */
	clickCount?: number;
	/** Time to wait between mousedown and mouseup in milliseconds */
	delay?: number;
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Options for type commands
 */
export interface TypeOptions {
	/** Time to wait between key presses in milliseconds */
	delay?: number;
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Options for fill commands
 */
export interface FillOptions {
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Options for hover commands
 */
export interface HoverOptions {
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Options for press commands
 */
export interface PressOptions {
	/** Time to wait between keydown and keyup in milliseconds */
	delay?: number;
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Options for waitForSelector commands
 */
export interface WaitOptions {
	/** State to wait for */
	state?: "visible" | "hidden" | "attached" | "detached";
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

/**
 * Options for screenshot commands
 */
export interface ScreenshotOptions {
	/** Capture full scrollable page (default: false) */
	fullPage?: boolean;
	/** Image format */
	type?: "png" | "jpeg";
	/** JPEG quality (0-100), only applicable for jpeg */
	quality?: number;
}

/**
 * Result of a screenshot command
 */
export interface ScreenshotResult {
	/** Base64-encoded image data */
	data: string;
	/** Image format */
	format: "png" | "jpeg";
}

/**
 * Options for evaluate commands
 */
export interface EvaluateOptions {
	/** Maximum time to wait in milliseconds */
	timeout?: number;
}

// ============================================================================
// Connection State
// ============================================================================

/**
 * WebSocket connection states
 */
export type ConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";

/**
 * Connection state change event
 */
export interface ConnectionStateChange {
	previousState: ConnectionState;
	currentState: ConnectionState;
	error?: Error;
}

// ============================================================================
// Sandbox Types
// ============================================================================

/**
 * Options for creating a sandbox
 */
export interface CreateSandboxOptions {
	/** Sandbox lifetime in milliseconds (default: 300000 = 5 min) */
	timeout?: number;
	/** Resource configuration */
	resources?: {
		/** Number of virtual CPUs (default: 4) */
		vcpus?: number;
	};
	/** Port for browserd server (default: 3000) */
	port?: number;
}

/**
 * Sandbox status
 */
export type SandboxStatus = "creating" | "ready" | "destroyed";

/**
 * Transport type for browser communication
 */
export type TransportType = "ws" | "sse";

/**
 * Information about a provisioned sandbox
 */
export interface SandboxInfo {
	/** Unique sandbox identifier */
	id: string;
	/** HTTPS domain for the sandbox */
	domain: string;
	/** WebSocket URL for browserd connection */
	wsUrl: string;
	/** SSE stream URL for browserd connection (when transport is "sse") */
	streamUrl?: string;
	/** Current status */
	status: SandboxStatus;
	/** Creation timestamp */
	createdAt: number;
	/**
	 * Recommended transport for this sandbox
	 * - "ws": WebSocket (default, best latency)
	 * - "sse": Server-Sent Events + HTTP POST (for HTTP-only proxies)
	 */
	transport?: TransportType;
	/** Auth token for authenticated connections (e.g., sprites.dev SSE mode) */
	authToken?: string;
}

/**
 * Session management methods returned from sandbox creation
 */
export interface SessionMethods {
	/** Create a new browser session and return a connected client ready to use */
	createSession: (
		options?: CreateSessionOptions,
	) => Promise<import("./client").BrowserdClient>;
	/** List all active sessions */
	listSessions: () => Promise<ListSessionsResponse>;
	/** Get an existing session's connected client (cached or creates new connection) */
	getSession: (sessionId: string) => Promise<import("./client").BrowserdClient>;
	/** Get session info without connecting */
	getSessionInfo: (sessionId: string) => Promise<SessionInfo>;
	/** Destroy a session */
	destroySession: (sessionId: string) => Promise<void>;
}

/**
 * Result of creating a sandbox with manager
 */
export interface CreateSandboxResult extends SessionMethods {
	/** Sandbox information */
	sandbox: SandboxInfo;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Options for creating a new browser session
 */
export interface CreateSessionOptions {
	/** Viewport dimensions */
	viewport?: {
		width: number;
		height: number;
	};
	/** Browser profile to use (e.g., "chrome-mac", "chrome-win") */
	profile?: string;
	/** Initial URL to navigate to */
	initialUrl?: string;
}

/**
 * Information about a browser session
 */
export interface SessionInfo {
	/** Unique session identifier */
	id: string;
	/** Session status */
	status: "creating" | "ready" | "closing" | "closed" | "awaiting_intervention";
	/** WebSocket URL for this session */
	wsUrl: string;
	/** SSE stream URL for this session */
	streamUrl: string;
	/** HTTP input URL for this session */
	inputUrl: string;
	/** Viewer URL for this session */
	viewerUrl: string;
	/** Session viewport */
	viewport: {
		width: number;
		height: number;
	};
	/** Number of connected clients */
	clientCount?: number;
	/** Creation timestamp */
	createdAt: number;
	/** Last activity timestamp */
	lastActivity?: number;
	/** Current page URL */
	url?: string;
	/** Active intervention if session is awaiting intervention */
	intervention?: Intervention;
}

/**
 * Response from listing sessions
 */
export interface ListSessionsResponse {
	/** List of sessions */
	sessions: SessionInfo[];
	/** Total count */
	count: number;
	/** Maximum allowed sessions */
	maxSessions: number;
}

// ============================================================================
// Intervention Types (Human-in-the-Loop)
// ============================================================================

/**
 * Status of a human intervention request
 */
export type InterventionStatus = "pending" | "completed" | "cancelled";

/**
 * A human intervention request
 */
export interface Intervention {
	/** Unique intervention identifier */
	id: string;
	/** Session ID this intervention belongs to */
	sessionId: string;
	/** Reason for requesting intervention (e.g., "CAPTCHA detected") */
	reason: string;
	/** Instructions for the human (e.g., "Please solve the CAPTCHA") */
	instructions: string;
	/** Current status */
	status: InterventionStatus;
	/** Creation timestamp */
	createdAt: Date;
	/** Resolution timestamp (when human completed) */
	resolvedAt?: Date;
}

/**
 * Callback called when intervention is created (before human completes it)
 */
export interface InterventionCreatedInfo {
	interventionId: string;
	viewerUrl: string;
	reason: string;
	instructions: string;
}

/**
 * Options for requesting human intervention
 */
export interface InterventionOptions {
	/** Reason for requesting intervention (e.g., "CAPTCHA detected") */
	reason: string;
	/** Instructions for the human (e.g., "Please solve the CAPTCHA") */
	instructions: string;
	/** Optional timeout in milliseconds (default: no timeout) */
	timeout?: number;
	/**
	 * Callback called when the intervention is created and the viewer URL is available.
	 * Use this to send notifications to the user before waiting for completion.
	 */
	onCreated?: (info: InterventionCreatedInfo) => void | Promise<void>;
}

/**
 * Result of a human intervention request
 */
export interface InterventionResult {
	/** Intervention ID */
	interventionId: string;
	/** Viewer URL with intervention parameter for human to access */
	viewerUrl: string;
	/** Timestamp when intervention was resolved */
	resolvedAt: Date;
}

// ============================================================================
// Re-exports from protocol
// ============================================================================

export type { Viewport };
