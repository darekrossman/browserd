/**
 * Browserd Server
 *
 * Main entry point for the browser service
 * Supports multiple concurrent browser sessions per sandbox
 */

import type { ServerWebSocket } from "bun";
import { createViewerResponse } from "../client/viewer-template";
import {
	type InputMessage,
	type ServerMessage,
	serializeServerMessage,
} from "../protocol/types";
import {
	createHealthResponse,
	createLivenessResponse,
	createReadinessResponse,
} from "./health";
import {
	createSessionManager,
	type SessionManager,
} from "./session-manager";
import {
	createWebSocketData,
	MultiSessionWSHandler,
	type WebSocketData,
} from "./ws-handler";
import { cleanupProcesses, isXvfbNeeded, startXvfb } from "./xvfb-manager";

// SSE Client tracking (now session-aware)
interface SSEClient {
	id: string;
	sessionId: string;
	controller: ReadableStreamDefaultController<Uint8Array>;
	send: (data: string) => void;
}
const sseClients = new Map<string, SSEClient>();
const sseClientsBySession = new Map<string, Set<string>>();

/**
 * Broadcast message to SSE clients of a specific session
 */
function broadcastToSSE(sessionId: string, message: ServerMessage): void {
	const data = serializeServerMessage(message);
	const sessionClients = sseClientsBySession.get(sessionId);

	if (!sessionClients) return;

	for (const clientId of sessionClients) {
		const client = sseClients.get(clientId);
		if (client) {
			client.send(data);
		}
	}
}

/**
 * Generate unique SSE client ID
 */
function generateSSEClientId(): string {
	return `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Service instances
let sessionManager: SessionManager | null = null;
let wsHandler: MultiSessionWSHandler | null = null;

/**
 * Get the base URL for session API responses
 */
function getBaseUrl(): string {
	const protocol = process.env.USE_HTTPS === "true" ? "https" : "http";
	return `${protocol}://localhost:${PORT}`;
}

/**
 * Initialize the session manager and launch browser
 */
async function initBrowser(): Promise<void> {
	sessionManager = createSessionManager();

	console.log("[browserd] Initializing session manager...");
	await sessionManager.initialize();
	console.log("[browserd] Session manager initialized");

	// Initialize WebSocket handler with command handling
	wsHandler = new MultiSessionWSHandler({
		sessionManager,
		onCommand: async (ws, cmd, session) => {
			const result = await session.commandQueue.enqueue(cmd);
			wsHandler?.send(ws, result);

			// If setViewport succeeded, update screencast dimensions to match
			if (
				cmd.method === "setViewport" &&
				result.ok &&
				cmd.params?.width &&
				cmd.params?.height
			) {
				await sessionManager?.updateSessionScreencast(
					session.id,
					cmd.params.width as number,
					cmd.params.height as number,
				);
			}
		},
		// Broadcast frames/events to SSE clients
		onBroadcast: broadcastToSSE,
	});

	console.log("[browserd] Ready - create sessions via POST /api/sessions");
}

/**
 * Parse session ID from URL path
 * Matches: /sessions/{sessionId}/ws, /sessions/{sessionId}/stream, /sessions/{sessionId}/input
 */
function parseSessionPath(path: string): { sessionId: string; endpoint: string } | null {
	const match = path.match(/^\/sessions\/([^/]+)\/(ws|stream|input|viewer)$/);
	if (match) {
		return { sessionId: match[1], endpoint: match[2] };
	}
	return null;
}

/**
 * Create SSE stream response for a session
 */
function createSSEStreamResponse(sessionId: string): Response {
	const clientId = generateSSEClientId();
	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream({
			start(controller) {
				// Create client entry
				const client: SSEClient = {
					id: clientId,
					sessionId,
					controller,
					send: (data: string) => {
						try {
							controller.enqueue(encoder.encode(`data: ${data}\n\n`));
						} catch {
							// Client disconnected, cleanup
							sseClients.delete(clientId);
							const sessionClients = sseClientsBySession.get(sessionId);
							if (sessionClients) {
								sessionClients.delete(clientId);
								if (sessionClients.size === 0) {
									sseClientsBySession.delete(sessionId);
								}
							}
						}
					},
				};

				// Register client
				sseClients.set(clientId, client);
				if (!sseClientsBySession.has(sessionId)) {
					sseClientsBySession.set(sessionId, new Set());
				}
				sseClientsBySession.get(sessionId)!.add(clientId);

				console.log(
					`[sse] Client ${clientId} connected to session ${sessionId} (${sseClients.size} total)`,
				);

				// Send connected event
				controller.enqueue(
					encoder.encode(
						`event: connected\ndata: ${JSON.stringify({ clientId, sessionId })}\n\n`,
					),
				);

				// Send viewport info if available
				const viewport = wsHandler?.getSessionViewport(sessionId);
				if (viewport) {
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ type: "event", event: "ready", data: { viewport } })}\n\n`,
						),
					);
				}

				// Send last frame if available for quick preview
				const lastFrame = wsHandler?.getSessionLastFrame(sessionId);
				if (lastFrame) {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(lastFrame)}\n\n`),
					);
				}
			},
			cancel() {
				sseClients.delete(clientId);
				const sessionClients = sseClientsBySession.get(sessionId);
				if (sessionClients) {
					sessionClients.delete(clientId);
					if (sessionClients.size === 0) {
						sseClientsBySession.delete(sessionId);
					}
				}
				console.log(
					`[sse] Client ${clientId} disconnected from session ${sessionId} (${sseClients.size} remaining)`,
				);
			},
		}),
		{
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
				// Headers to disable proxy buffering (Nginx, Cloudflare, etc.)
				"X-Accel-Buffering": "no",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}

/**
 * Handle HTTP input for a session
 */
async function handleSessionInput(sessionId: string, req: Request): Promise<Response> {
	if (!sessionManager) {
		return Response.json({ ok: false, error: "Server not initialized" }, { status: 503 });
	}

	const session = sessionManager.getSession(sessionId);
	if (!session) {
		return Response.json(
			{ ok: false, error: "Session not found", code: "SESSION_NOT_FOUND" },
			{ status: 404 },
		);
	}

	try {
		const body = await req.json();

		if (body.type === "input") {
			// Dispatch input to session's CDP
			await session.cdpSession.dispatchInput(body as InputMessage);
			return Response.json({ ok: true });
		}

		if (body.type === "cmd") {
			// Handle command via session's queue
			const result = await session.commandQueue.enqueue(body);
			return Response.json(result);
		}

		return Response.json(
			{ ok: false, error: "Unknown message type" },
			{ status: 400 },
		);
	} catch (error) {
		return Response.json(
			{ ok: false, error: String(error) },
			{ status: 500 },
		);
	}
}

/**
 * Handle session API requests
 */
async function handleSessionApiRequest(req: Request): Promise<Response | null> {
	const url = new URL(req.url);
	const path = url.pathname;

	if (!sessionManager) {
		return null;
	}

	// POST /api/sessions - Create new session
	if (req.method === "POST" && path === "/api/sessions") {
		try {
			const body = await req.json().catch(() => ({})) as {
				viewport?: { width: number; height: number };
				profile?: string;
				initialUrl?: string;
			};

			const session = await sessionManager.createSession({
				viewport: body.viewport,
				profile: body.profile,
				initialUrl: body.initialUrl,
			});

			const baseUrl = getBaseUrl();
			return Response.json({
				id: session.id,
				status: session.status,
				wsUrl: `${baseUrl.replace("http", "ws")}/sessions/${session.id}/ws`,
				streamUrl: `${baseUrl}/sessions/${session.id}/stream`,
				inputUrl: `${baseUrl}/sessions/${session.id}/input`,
				viewerUrl: `${baseUrl}/sessions/${session.id}/viewer`,
				viewport: session.viewport,
				createdAt: session.createdAt,
			}, { status: 201 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isLimitError = message.includes("Maximum sessions");
			return Response.json(
				{
					ok: false,
					error: message,
					code: isLimitError ? "SESSION_LIMIT_REACHED" : "SESSION_CREATION_FAILED",
				},
				{ status: isLimitError ? 429 : 500 },
			);
		}
	}

	// GET /api/sessions - List sessions
	if (req.method === "GET" && path === "/api/sessions") {
		const sessions = sessionManager.listSessions();
		return Response.json({
			sessions,
			count: sessions.length,
			maxSessions: sessionManager.getMaxSessions(),
		});
	}

	// GET /api/sessions/:id - Get session info
	const getMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
	if (req.method === "GET" && getMatch) {
		const session = sessionManager.getSession(getMatch[1]);
		if (!session) {
			return Response.json(
				{ error: "Session not found", code: "SESSION_NOT_FOUND" },
				{ status: 404 },
			);
		}

		const baseUrl = getBaseUrl();
		return Response.json({
			id: session.id,
			status: session.status,
			wsUrl: `${baseUrl.replace("http", "ws")}/sessions/${session.id}/ws`,
			streamUrl: `${baseUrl}/sessions/${session.id}/stream`,
			inputUrl: `${baseUrl}/sessions/${session.id}/input`,
			viewerUrl: `${baseUrl}/sessions/${session.id}/viewer`,
			viewport: session.viewport,
			clientCount: session.clients.size,
			createdAt: session.createdAt,
			lastActivity: session.lastActivity,
			url: session.page.url(),
		});
	}

	// DELETE /api/sessions/:id - Destroy session
	if (req.method === "DELETE" && getMatch) {
		const sessionId = getMatch[1];

		const deleted = await sessionManager.destroySession(sessionId);
		if (!deleted) {
			return Response.json(
				{ error: "Session not found", code: "SESSION_NOT_FOUND" },
				{ status: 404 },
			);
		}

		return Response.json({ deleted: true, id: sessionId });
	}

	return null;
}

/**
 * Handle HTTP requests
 */
async function handleRequest(
	req: Request,
	server: ReturnType<typeof Bun.serve>,
): Promise<Response | undefined> {
	const url = new URL(req.url);
	const path = url.pathname;

	// Parse session-specific paths
	const sessionPath = parseSessionPath(path);

	// Session-specific WebSocket: /sessions/{id}/ws
	if (sessionPath?.endpoint === "ws") {
		const { sessionId } = sessionPath;

		// Check session exists
		if (!sessionManager?.hasSession(sessionId)) {
			return new Response(
				JSON.stringify({ error: "Session not found", code: "SESSION_NOT_FOUND" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		const upgraded = server.upgrade(req, {
			data: createWebSocketData(sessionId),
		});

		if (upgraded) {
			return undefined;
		}

		return new Response("WebSocket upgrade failed", { status: 400 });
	}

	// Session-specific SSE: /sessions/{id}/stream
	if (sessionPath?.endpoint === "stream") {
		const { sessionId } = sessionPath;

		if (!sessionManager?.hasSession(sessionId)) {
			return new Response(
				JSON.stringify({ error: "Session not found", code: "SESSION_NOT_FOUND" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		return createSSEStreamResponse(sessionId);
	}

	// Session-specific HTTP input: /sessions/{id}/input
	if (sessionPath?.endpoint === "input") {
		if (req.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		if (req.method === "POST") {
			return handleSessionInput(sessionPath.sessionId, req);
		}
	}

	// Session-specific viewer: /sessions/{id}/viewer
	if (sessionPath?.endpoint === "viewer") {
		const { sessionId } = sessionPath;

		if (!sessionManager?.hasSession(sessionId)) {
			return new Response(
				JSON.stringify({ error: "Session not found", code: "SESSION_NOT_FOUND" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		return createViewerResponse({
			title: `Browserd Viewer - ${sessionId}`,
			showControls: true,
			showStats: true,
			sessionId,
		});
	}


	// Health endpoints
	if (path === "/health" || path === "/healthz") {
		return createHealthResponse(sessionManager);
	}

	if (path === "/livez") {
		return createLivenessResponse();
	}

	if (path === "/readyz") {
		return createReadinessResponse(sessionManager);
	}

	// Sessions list page
	if (path === "/" || path === "/viewer") {
		// Redirect to sessions API - client should create a session first
		const sessions = sessionManager?.listSessions() ?? [];
		if (sessions.length > 0) {
			// If sessions exist, redirect to first one
			return Response.redirect(`/sessions/${sessions[0].id}/viewer`, 302);
		}
		// No sessions - return info page
		return new Response(
			JSON.stringify({
				message: "No active sessions. Create a session first.",
				createSession: "POST /api/sessions",
				listSessions: "GET /api/sessions",
			}),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	// Sessions API
	const sessionResponse = await handleSessionApiRequest(req);
	if (sessionResponse) {
		return sessionResponse;
	}

	// 404 for unknown routes
	return new Response(JSON.stringify({ error: "Not Found" }), {
		status: 404,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Graceful shutdown handler
 */
async function shutdown(): Promise<void> {
	console.log("\n[browserd] Shutting down...");

	if (wsHandler) {
		await wsHandler.close();
		console.log("[browserd] WebSocket handler closed");
	}

	if (sessionManager) {
		await sessionManager.close();
		console.log("[browserd] Session manager closed");
	}

	// Cleanup Xvfb and any orphaned processes
	await cleanupProcesses();

	process.exit(0);
}

// Handle shutdown signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * Start the server
 */
async function main(): Promise<void> {
	try {
		// Start Xvfb if needed for headed mode
		if (isXvfbNeeded()) {
			await startXvfb();
		}

		// Initialize browser
		await initBrowser();

		// Start HTTP server with WebSocket support
		const server = Bun.serve<WebSocketData>({
			port: PORT,
			hostname: HOST,
			fetch: (req, server) => handleRequest(req, server),
			websocket: {
				open(ws: ServerWebSocket<WebSocketData>) {
					wsHandler?.handleOpen(ws);
				},
				message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
					wsHandler?.handleMessage(ws, message);
				},
				close(
					ws: ServerWebSocket<WebSocketData>,
					code: number,
					reason: string,
				) {
					wsHandler?.handleClose(ws, code, reason);
				},
			},
		});

		console.log(`[browserd] Server listening on http://${HOST}:${PORT}`);
		console.log(`[browserd] Sessions API: http://${HOST}:${PORT}/api/sessions`);
		console.log(`[browserd] Create session: POST /api/sessions`);
		console.log(`[browserd] Session endpoints: /sessions/{id}/ws, /sessions/{id}/stream`);
	} catch (error) {
		console.error("[browserd] Failed to start:", error);
		process.exit(1);
	}
}

// Run if this is the main module
main();

// Export for testing
export {
	sessionManager,
	wsHandler,
	handleRequest,
	initBrowser,
	getBaseUrl,
};
