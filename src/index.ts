/**
 * Browserd - Cloud Browser Service
 *
 * Main package exports
 */

// Protocol types and utilities
export * from "./protocol/types";
export type { BrowserConfig, BrowserInstance } from "./server/browser-manager";
// Server components
export {
	BrowserManager,
	getDefaultBrowserManager,
	resetDefaultBrowserManager,
} from "./server/browser-manager";
export type { HealthStatus } from "./server/health";
export {
	createHealthResponse,
	createLivenessResponse,
	createReadinessResponse,
	getHealthStatus,
	getLivenessStatus,
	getReadinessStatus,
} from "./server/health";
