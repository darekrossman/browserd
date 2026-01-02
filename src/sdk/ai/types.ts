/**
 * Types for the AI SDK browser tool
 */

import type { BrowserdClient } from "../client";

/**
 * Result type for all browser operations
 */
export interface BrowserResult {
	status: "success" | "error";
	operation: string;
	data?: Record<string, unknown>;
	screenshot?: string; // base64 for screenshot operation
	error?: string;
	errorType?: "timeout" | "not_found" | "navigation" | "evaluation" | "unknown";
}

/**
 * Options for creating the browser tool
 */
export interface CreateBrowserToolOptions {
	/**
	 * Pre-connected BrowserdClient instance
	 */
	client: BrowserdClient;

	/**
	 * Default timeout for operations in milliseconds (default: 30000)
	 */
	defaultTimeout?: number;
}
