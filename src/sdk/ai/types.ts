/**
 * Types for the AI SDK browser tool
 */

import type { NotificationProvider } from "../notifications";
import type { SandboxProvider } from "../providers/types";

/**
 * Result type for all browser operations
 */
export interface BrowserResult {
	status: "success" | "error";
	operation: string;
	sessionId?: string; // Session ID for tracking across calls
	data?: Record<string, unknown>;
	screenshot?: string; // base64 for screenshot operation
	error?: string;
	errorType?:
		| "timeout"
		| "not_found"
		| "navigation"
		| "evaluation"
		| "session"
		| "unknown";
}

/**
 * Options for creating the browser tool
 */
export interface CreateBrowserToolOptions {
	/**
	 * Sandbox provider for creating browser instances
	 */
	provider: SandboxProvider;

	/**
	 * Default timeout for operations in milliseconds (default: 30000)
	 */
	defaultTimeout?: number;

	/**
	 * Notification provider for human-in-the-loop interventions.
	 * When an agent requests human intervention, this provider is called
	 * to notify the user with the viewer URL.
	 *
	 * If not provided, interventions will still work but no notifications
	 * will be sent (the viewer URL is returned in the tool result).
	 */
	notificationProvider?: NotificationProvider;
}
