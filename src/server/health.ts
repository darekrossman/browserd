/**
 * Health Check Module
 *
 * Provides health check endpoints and status information
 */

import type { BrowserManager } from "./browser-manager";

export interface HealthStatus {
	status: "healthy" | "unhealthy" | "degraded";
	timestamp: string;
	uptime: number;
	browser: {
		running: boolean;
		connected: boolean;
		url: string | null;
	};
	memory: {
		heapUsed: number;
		heapTotal: number;
		rss: number;
	};
}

const startTime = Date.now();

/**
 * Get comprehensive health status
 */
export function getHealthStatus(
	browserManager: BrowserManager | null,
): HealthStatus {
	const browserStatus = browserManager?.getStatus() ?? {
		running: false,
		connected: false,
		viewport: null,
		url: null,
	};

	const memoryUsage = process.memoryUsage();

	// Determine overall health
	let status: HealthStatus["status"] = "healthy";
	if (browserManager && !browserStatus.running) {
		status = "degraded";
	}
	if (browserManager && browserStatus.running && !browserStatus.connected) {
		status = "unhealthy";
	}

	return {
		status,
		timestamp: new Date().toISOString(),
		uptime: Math.floor((Date.now() - startTime) / 1000),
		browser: {
			running: browserStatus.running,
			connected: browserStatus.connected,
			url: browserStatus.url,
		},
		memory: {
			heapUsed: memoryUsage.heapUsed,
			heapTotal: memoryUsage.heapTotal,
			rss: memoryUsage.rss,
		},
	};
}

/**
 * Simple liveness check - just returns ok
 */
export function getLivenessStatus(): { ok: boolean } {
	return { ok: true };
}

/**
 * Readiness check - requires browser to be available
 */
export function getReadinessStatus(browserManager: BrowserManager | null): {
	ready: boolean;
	reason?: string;
} {
	if (!browserManager) {
		return { ready: false, reason: "Browser manager not initialized" };
	}

	const status = browserManager.getStatus();

	if (!status.running) {
		return { ready: false, reason: "Browser not running" };
	}

	if (!status.connected) {
		return { ready: false, reason: "Browser disconnected" };
	}

	return { ready: true };
}

/**
 * Create health check HTTP response
 */
export function createHealthResponse(
	browserManager: BrowserManager | null,
): Response {
	const health = getHealthStatus(browserManager);
	const statusCode =
		health.status === "healthy"
			? 200
			: health.status === "degraded"
				? 200
				: 503;

	return new Response(JSON.stringify(health, null, 2), {
		status: statusCode,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-cache, no-store, must-revalidate",
		},
	});
}

/**
 * Create liveness check HTTP response
 */
export function createLivenessResponse(): Response {
	return new Response(JSON.stringify(getLivenessStatus()), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Create readiness check HTTP response
 */
export function createReadinessResponse(
	browserManager: BrowserManager | null,
): Response {
	const readiness = getReadinessStatus(browserManager);
	const statusCode = readiness.ready ? 200 : 503;

	return new Response(JSON.stringify(readiness), {
		status: statusCode,
		headers: { "Content-Type": "application/json" },
	});
}
