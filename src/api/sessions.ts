/**
 * Sessions API
 *
 * In-memory session management for v1
 */

export interface Session {
	id: string;
	status: "creating" | "ready" | "active" | "closing" | "closed" | "error";
	wsUrl: string;
	createdAt: string;
	lastActivity: string;
	viewport: {
		width: number;
		height: number;
	};
	error?: string;
}

export interface CreateSessionOptions {
	viewport?: {
		width: number;
		height: number;
	};
}

// In-memory session store
const sessions = new Map<string, Session>();

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
	return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new session
 */
export function createSession(
	baseUrl: string,
	options: CreateSessionOptions = {},
): Session {
	const id = generateSessionId();
	const now = new Date().toISOString();

	const session: Session = {
		id,
		status: "ready",
		wsUrl: `${baseUrl.replace("http", "ws")}/ws`,
		createdAt: now,
		lastActivity: now,
		viewport: options.viewport || { width: 1280, height: 720 },
	};

	sessions.set(id, session);
	return session;
}

/**
 * Get a session by ID
 */
export function getSession(id: string): Session | null {
	return sessions.get(id) || null;
}

/**
 * Update session status
 */
export function updateSessionStatus(
	id: string,
	status: Session["status"],
	error?: string,
): Session | null {
	const session = sessions.get(id);
	if (!session) return null;

	session.status = status;
	session.lastActivity = new Date().toISOString();
	if (error) {
		session.error = error;
	}

	return session;
}

/**
 * Update session activity timestamp
 */
export function touchSession(id: string): Session | null {
	const session = sessions.get(id);
	if (!session) return null;

	session.lastActivity = new Date().toISOString();
	return session;
}

/**
 * Delete a session
 */
export function deleteSession(id: string): boolean {
	return sessions.delete(id);
}

/**
 * Get all sessions
 */
export function getAllSessions(): Session[] {
	return Array.from(sessions.values());
}

/**
 * Get sessions by status
 */
export function getSessionsByStatus(status: Session["status"]): Session[] {
	return Array.from(sessions.values()).filter((s) => s.status === status);
}

/**
 * Clear all sessions
 */
export function clearAllSessions(): void {
	sessions.clear();
}

/**
 * Get session count
 */
export function getSessionCount(): number {
	return sessions.size;
}

// HTTP handlers for session API

/**
 * Create session response
 */
export function createSessionResponse(
	baseUrl: string,
	options: CreateSessionOptions = {},
): Response {
	const session = createSession(baseUrl, options);
	return new Response(JSON.stringify(session), {
		status: 201,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Get session response
 */
export function getSessionResponse(id: string): Response {
	const session = getSession(id);

	if (!session) {
		return new Response(
			JSON.stringify({ error: "Session not found", code: "SESSION_NOT_FOUND" }),
			{ status: 404, headers: { "Content-Type": "application/json" } },
		);
	}

	return new Response(JSON.stringify(session), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Delete session response
 */
export function deleteSessionResponse(id: string): Response {
	const session = getSession(id);

	if (!session) {
		return new Response(
			JSON.stringify({ error: "Session not found", code: "SESSION_NOT_FOUND" }),
			{ status: 404, headers: { "Content-Type": "application/json" } },
		);
	}

	deleteSession(id);

	return new Response(JSON.stringify({ deleted: true, id }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * List sessions response
 */
export function listSessionsResponse(): Response {
	const sessions = getAllSessions();
	return new Response(JSON.stringify({ sessions, count: sessions.length }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Parse request body for create session
 */
export async function parseCreateSessionBody(
	req: Request,
): Promise<CreateSessionOptions> {
	try {
		const body = (await req.json()) as {
			viewport?: { width: number; height: number };
		};
		return {
			viewport: body.viewport,
		};
	} catch {
		return {};
	}
}

/**
 * Route session API requests
 */
export async function handleSessionRequest(
	req: Request,
	baseUrl: string,
): Promise<Response | null> {
	const url = new URL(req.url);
	const path = url.pathname;

	// POST /api/sessions - Create session
	if (req.method === "POST" && path === "/api/sessions") {
		const options = await parseCreateSessionBody(req);
		return createSessionResponse(baseUrl, options);
	}

	// GET /api/sessions - List sessions
	if (req.method === "GET" && path === "/api/sessions") {
		return listSessionsResponse();
	}

	// GET /api/sessions/:id - Get session
	const getMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
	if (req.method === "GET" && getMatch) {
		return getSessionResponse(getMatch[1]);
	}

	// DELETE /api/sessions/:id - Delete session
	if (req.method === "DELETE" && getMatch) {
		return deleteSessionResponse(getMatch[1]);
	}

	return null;
}
