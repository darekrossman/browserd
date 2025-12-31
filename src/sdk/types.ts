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
	/** WebSocket URL to connect to (e.g., "ws://localhost:3000/ws") */
	url: string;
	/** Default timeout for commands in milliseconds (default: 30000) */
	timeout?: number;
	/** Whether to automatically reconnect on disconnect (default: true) */
	autoReconnect?: boolean;
	/** Interval between reconnect attempts in milliseconds (default: 2000) */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts (default: 5) */
	maxReconnectAttempts?: number;
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
 * Information about a provisioned sandbox
 */
export interface SandboxInfo {
	/** Unique sandbox identifier */
	id: string;
	/** HTTPS domain for the sandbox */
	domain: string;
	/** WebSocket URL for browserd connection */
	wsUrl: string;
	/** Current status */
	status: SandboxStatus;
	/** Creation timestamp */
	createdAt: number;
}

/**
 * Result of creating a sandbox with manager
 */
export interface CreateSandboxResult {
	/** Connected BrowserdClient instance */
	client: import("./client").BrowserdClient;
	/** Sandbox information */
	sandbox: SandboxInfo;
}

// ============================================================================
// Re-exports from protocol
// ============================================================================

export type { Viewport };
