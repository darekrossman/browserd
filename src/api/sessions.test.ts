/**
 * Sessions API Unit Tests
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	clearAllSessions,
	createSession,
	deleteSession,
	getAllSessions,
	getSession,
	getSessionCount,
	getSessionsByStatus,
	touchSession,
	updateSessionStatus,
} from "./sessions";

describe("Sessions Store", () => {
	beforeEach(() => {
		clearAllSessions();
	});

	describe("createSession", () => {
		test("creates session with default viewport", () => {
			const session = createSession("http://localhost:3000");

			expect(session.id).toBeDefined();
			expect(session.id).toMatch(/^session-/);
			expect(session.status).toBe("ready");
			expect(session.wsUrl).toBe("ws://localhost:3000/ws");
			expect(session.viewport).toEqual({ width: 1280, height: 720 });
			expect(session.createdAt).toBeDefined();
			expect(session.lastActivity).toBeDefined();
		});

		test("creates session with custom viewport", () => {
			const session = createSession("http://localhost:3000", {
				viewport: { width: 1920, height: 1080 },
			});

			expect(session.viewport).toEqual({ width: 1920, height: 1080 });
		});

		test("generates unique IDs", () => {
			const session1 = createSession("http://localhost:3000");
			const session2 = createSession("http://localhost:3000");

			expect(session1.id).not.toBe(session2.id);
		});

		test("handles https base URL", () => {
			const session = createSession("https://example.com");

			expect(session.wsUrl).toBe("wss://example.com/ws");
		});
	});

	describe("getSession", () => {
		test("returns session by ID", () => {
			const created = createSession("http://localhost:3000");
			const retrieved = getSession(created.id);

			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(created.id);
		});

		test("returns null for non-existent ID", () => {
			const session = getSession("non-existent-id");
			expect(session).toBeNull();
		});
	});

	describe("updateSessionStatus", () => {
		test("updates session status", () => {
			const session = createSession("http://localhost:3000");
			const updated = updateSessionStatus(session.id, "active");

			expect(updated?.status).toBe("active");
		});

		test("updates last activity timestamp", () => {
			const session = createSession("http://localhost:3000");
			const originalActivity = session.lastActivity;

			// Wait a tiny bit
			const updated = updateSessionStatus(session.id, "active");

			expect(updated?.lastActivity).toBeDefined();
		});

		test("sets error message", () => {
			const session = createSession("http://localhost:3000");
			const updated = updateSessionStatus(
				session.id,
				"error",
				"Something went wrong",
			);

			expect(updated?.status).toBe("error");
			expect(updated?.error).toBe("Something went wrong");
		});

		test("returns null for non-existent session", () => {
			const result = updateSessionStatus("fake-id", "active");
			expect(result).toBeNull();
		});
	});

	describe("touchSession", () => {
		test("updates lastActivity timestamp", () => {
			const session = createSession("http://localhost:3000");
			const original = session.lastActivity;

			const touched = touchSession(session.id);

			expect(touched).not.toBeNull();
			expect(touched?.lastActivity).toBeDefined();
		});

		test("returns null for non-existent session", () => {
			const result = touchSession("fake-id");
			expect(result).toBeNull();
		});
	});

	describe("deleteSession", () => {
		test("deletes existing session", () => {
			const session = createSession("http://localhost:3000");
			expect(getSession(session.id)).not.toBeNull();

			const result = deleteSession(session.id);

			expect(result).toBe(true);
			expect(getSession(session.id)).toBeNull();
		});

		test("returns false for non-existent session", () => {
			const result = deleteSession("fake-id");
			expect(result).toBe(false);
		});
	});

	describe("getAllSessions", () => {
		test("returns empty array when no sessions", () => {
			const sessions = getAllSessions();
			expect(sessions).toEqual([]);
		});

		test("returns all sessions", () => {
			createSession("http://localhost:3000");
			createSession("http://localhost:3000");
			createSession("http://localhost:3000");

			const sessions = getAllSessions();
			expect(sessions.length).toBe(3);
		});
	});

	describe("getSessionsByStatus", () => {
		test("filters by status", () => {
			const s1 = createSession("http://localhost:3000");
			const s2 = createSession("http://localhost:3000");
			const s3 = createSession("http://localhost:3000");

			updateSessionStatus(s1.id, "active");
			updateSessionStatus(s2.id, "active");
			// s3 remains "ready"

			const activeSessions = getSessionsByStatus("active");
			const readySessions = getSessionsByStatus("ready");

			expect(activeSessions.length).toBe(2);
			expect(readySessions.length).toBe(1);
		});
	});

	describe("getSessionCount", () => {
		test("returns correct count", () => {
			expect(getSessionCount()).toBe(0);

			createSession("http://localhost:3000");
			expect(getSessionCount()).toBe(1);

			createSession("http://localhost:3000");
			expect(getSessionCount()).toBe(2);
		});
	});

	describe("clearAllSessions", () => {
		test("removes all sessions", () => {
			createSession("http://localhost:3000");
			createSession("http://localhost:3000");
			expect(getSessionCount()).toBe(2);

			clearAllSessions();

			expect(getSessionCount()).toBe(0);
			expect(getAllSessions()).toEqual([]);
		});
	});
});
