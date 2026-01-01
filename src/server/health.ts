/**
 * Health Check Module
 *
 * Provides health check endpoints and status information
 */

import type { SessionManager } from "./session-manager";

export interface HealthStatus {
	status: "healthy" | "unhealthy" | "degraded";
	timestamp: string;
	uptime: number;
	browser: {
		running: boolean;
		connected: boolean;
	};
	sessions: {
		count: number;
		maxSessions: number;
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
	sessionManager: SessionManager | null,
): HealthStatus {
	const memoryUsage = process.memoryUsage();
	const isRunning = sessionManager?.isRunning() ?? false;

	// Determine overall health
	let status: HealthStatus["status"] = "healthy";
	if (!sessionManager) {
		status = "degraded";
	} else if (!isRunning) {
		status = "unhealthy";
	}

	return {
		status,
		timestamp: new Date().toISOString(),
		uptime: Math.floor((Date.now() - startTime) / 1000),
		browser: {
			running: isRunning,
			connected: isRunning,
		},
		sessions: {
			count: sessionManager?.getSessionCount() ?? 0,
			maxSessions: sessionManager?.getMaxSessions() ?? 0,
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
 * Readiness check - requires session manager to be available
 */
export function getReadinessStatus(sessionManager: SessionManager | null): {
	ready: boolean;
	reason?: string;
} {
	if (!sessionManager) {
		return { ready: false, reason: "Session manager not initialized" };
	}

	if (!sessionManager.isRunning()) {
		return { ready: false, reason: "Browser not running" };
	}

	return { ready: true };
}

/**
 * Create health check HTTP response
 */
export function createHealthResponse(
	sessionManager: SessionManager | null,
): Response {
	const health = getHealthStatus(sessionManager);
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
	sessionManager: SessionManager | null,
): Response {
	const readiness = getReadinessStatus(sessionManager);
	const statusCode = readiness.ready ? 200 : 503;

	return new Response(JSON.stringify(readiness), {
		status: statusCode,
		headers: { "Content-Type": "application/json" },
	});
}
