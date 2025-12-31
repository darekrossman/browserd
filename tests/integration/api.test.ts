/**
 * API Integration Tests
 *
 * Tests HTTP API endpoints
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { clearAllSessions } from "../../src/api/sessions";
import { hasBrowserSupport } from "../helpers/setup";

const runTests = hasBrowserSupport();
const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Simple server for API testing (without browser)
let testServer: ReturnType<typeof Bun.serve> | null = null;

// Import server request handler dynamically to avoid browser launch
async function startTestServer() {
	console.log("[api.test] Starting test server on port", TEST_PORT);

	const { handleSessionRequest } = await import("../../src/api/sessions");
	const {
		createHealthResponse,
		createLivenessResponse,
		createReadinessResponse,
	} = await import("../../src/server/health");

	console.log("[api.test] Imports successful");

	testServer = Bun.serve({
		port: TEST_PORT,
		hostname: "0.0.0.0",
		async fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			// Health endpoints (mock browser manager)
			if (path === "/health" || path === "/healthz") {
				return createHealthResponse(null);
			}
			if (path === "/livez") {
				return createLivenessResponse();
			}
			if (path === "/readyz") {
				return createReadinessResponse(null);
			}

			// Session API
			const sessionResponse = await handleSessionRequest(req, BASE_URL);
			if (sessionResponse) {
				return sessionResponse;
			}

			return new Response(JSON.stringify({ error: "Not Found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		},
	});

	console.log("[api.test] Server started successfully, info:", {
		port: testServer.port,
		hostname: testServer.hostname,
		url: testServer.url,
	});
}

function stopTestServer() {
	if (testServer) {
		testServer.stop();
		testServer = null;
	}
}

describe("HTTP API Endpoints", () => {
	beforeAll(async () => {
		try {
			await startTestServer();
			// Give server time to fully start
			await new Promise((resolve) => setTimeout(resolve, 100));
		} catch (error) {
			console.error("Failed to start test server:", error);
			throw error;
		}
	});

	afterAll(() => {
		stopTestServer();
	});

	beforeEach(() => {
		clearAllSessions();
	});

	describe("Health Endpoints", () => {
		test("GET /health returns status", async () => {
			const res = await fetch(`${BASE_URL}/health`);
			const data = (await res.json()) as Record<string, unknown>;

			expect(res.status).toBe(200);
			expect(data).toHaveProperty("status");
			expect(data).toHaveProperty("timestamp");
			expect(data).toHaveProperty("uptime");
			expect(data).toHaveProperty("memory");
		});

		test("GET /healthz is alias for /health", async () => {
			const res = await fetch(`${BASE_URL}/healthz`);
			expect(res.status).toBe(200);

			const data = (await res.json()) as Record<string, unknown>;
			expect(data).toHaveProperty("status");
		});

		test("GET /livez returns ok", async () => {
			const res = await fetch(`${BASE_URL}/livez`);
			const data = (await res.json()) as { ok: boolean };

			expect(res.status).toBe(200);
			expect(data.ok).toBe(true);
		});

		test("GET /readyz returns readiness", async () => {
			const res = await fetch(`${BASE_URL}/readyz`);
			const data = (await res.json()) as { ready: boolean };

			// Without browser, should not be ready
			expect(res.status).toBe(503);
			expect(data.ready).toBe(false);
		});
	});

	interface SessionResponse {
		id: string;
		status: string;
		wsUrl: string;
		createdAt: string;
		viewport: { width: number; height: number };
	}

	interface SessionListResponse {
		sessions: SessionResponse[];
		count: number;
	}

	interface ErrorResponse {
		error: string;
		code?: string;
	}

	interface DeleteResponse {
		deleted: boolean;
		id: string;
	}

	describe("Sessions API", () => {
		test("POST /api/sessions creates session", async () => {
			const res = await fetch(`${BASE_URL}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(201);

			const data = (await res.json()) as SessionResponse;
			expect(data.id).toBeDefined();
			expect(data.id).toMatch(/^session-/);
			expect(data.status).toBe("ready");
			expect(data.wsUrl).toBe(`ws://127.0.0.1:${TEST_PORT}/ws`);
			expect(data.createdAt).toBeDefined();
			expect(data.viewport).toEqual({ width: 1280, height: 720 });
		});

		test("POST /api/sessions with custom viewport", async () => {
			const res = await fetch(`${BASE_URL}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					viewport: { width: 1920, height: 1080 },
				}),
			});

			expect(res.status).toBe(201);

			const data = (await res.json()) as SessionResponse;
			expect(data.viewport).toEqual({ width: 1920, height: 1080 });
		});

		test("GET /api/sessions lists all sessions", async () => {
			// Create a few sessions
			await fetch(`${BASE_URL}/api/sessions`, { method: "POST" });
			await fetch(`${BASE_URL}/api/sessions`, { method: "POST" });

			const res = await fetch(`${BASE_URL}/api/sessions`);
			const data = (await res.json()) as SessionListResponse;

			expect(res.status).toBe(200);
			expect(data.sessions).toHaveLength(2);
			expect(data.count).toBe(2);
		});

		test("GET /api/sessions/:id returns session", async () => {
			// Create session
			const createRes = await fetch(`${BASE_URL}/api/sessions`, {
				method: "POST",
			});
			const created = (await createRes.json()) as SessionResponse;

			// Get session
			const res = await fetch(`${BASE_URL}/api/sessions/${created.id}`);
			const data = (await res.json()) as SessionResponse;

			expect(res.status).toBe(200);
			expect(data.id).toBe(created.id);
			expect(data.status).toBe("ready");
		});

		test("GET /api/sessions/:id returns 404 for non-existent", async () => {
			const res = await fetch(`${BASE_URL}/api/sessions/fake-id`);
			const data = (await res.json()) as ErrorResponse;

			expect(res.status).toBe(404);
			expect(data.error).toBe("Session not found");
			expect(data.code).toBe("SESSION_NOT_FOUND");
		});

		test("DELETE /api/sessions/:id deletes session", async () => {
			// Create session
			const createRes = await fetch(`${BASE_URL}/api/sessions`, {
				method: "POST",
			});
			const created = (await createRes.json()) as SessionResponse;

			// Delete session
			const deleteRes = await fetch(`${BASE_URL}/api/sessions/${created.id}`, {
				method: "DELETE",
			});
			const deleteData = (await deleteRes.json()) as DeleteResponse;

			expect(deleteRes.status).toBe(200);
			expect(deleteData.deleted).toBe(true);
			expect(deleteData.id).toBe(created.id);

			// Verify it's gone
			const getRes = await fetch(`${BASE_URL}/api/sessions/${created.id}`);
			expect(getRes.status).toBe(404);
		});

		test("DELETE /api/sessions/:id returns 404 for non-existent", async () => {
			const res = await fetch(`${BASE_URL}/api/sessions/fake-id`, {
				method: "DELETE",
			});

			expect(res.status).toBe(404);
		});
	});

	describe("Error Handling", () => {
		test("returns 404 for unknown routes", async () => {
			const res = await fetch(`${BASE_URL}/unknown/path`);

			expect(res.status).toBe(404);

			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not Found");
		});
	});
});
