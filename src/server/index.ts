/**
 * Browserd Server
 *
 * Main entry point for the browser service
 */

import type { ServerWebSocket } from "bun";
import { handleSessionRequest } from "../api/sessions";
import { createViewerResponse } from "../client/viewer-template";
import {
	type InputMessage,
	type ServerMessage,
	serializeServerMessage,
} from "../protocol/types";
import { BrowserManager } from "./browser-manager";
import { CommandQueue } from "./command-queue";
import {
	createHealthResponse,
	createLivenessResponse,
	createReadinessResponse,
} from "./health";
import {
	createWebSocketData,
	type WebSocketData,
	WSHandler,
} from "./ws-handler";

// SSE Client tracking
interface SSEClient {
	id: string;
	controller: ReadableStreamDefaultController<Uint8Array>;
	send: (data: string) => void;
}
const sseClients = new Map<string, SSEClient>();

/**
 * Broadcast message to all SSE clients
 */
function broadcastToSSE(message: ServerMessage): void {
	const data = serializeServerMessage(message);
	for (const client of sseClients.values()) {
		client.send(data);
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
let browserManager: BrowserManager | null = null;
let wsHandler: WSHandler | null = null;
let commandQueue: CommandQueue | null = null;

/**
 * Get the base URL for session API responses
 */
function getBaseUrl(): string {
	const protocol = process.env.USE_HTTPS === "true" ? "https" : "http";
	return `${protocol}://localhost:${PORT}`;
}

/**
 * Initialize the browser manager and launch browser
 */
async function initBrowser(): Promise<void> {
	browserManager = new BrowserManager({
		headless: process.env.HEADLESS === "true",
		viewport: {
			width: parseInt(process.env.VIEWPORT_WIDTH || "1280", 10),
			height: parseInt(process.env.VIEWPORT_HEIGHT || "720", 10),
		},
	});

	console.log("[browserd] Launching browser...");
	await browserManager.launch();
	console.log("[browserd] Browser launched successfully");

	// Initialize command queue
	commandQueue = new CommandQueue({
		page: browserManager.getPage(),
		timeout: parseInt(process.env.COMMAND_TIMEOUT || "30000", 10),
	});
	console.log("[browserd] Command queue initialized");

	// Initialize WebSocket handler with command handling
	wsHandler = new WSHandler({
		browserManager,
		onCommand: async (ws, cmd) => {
			if (commandQueue) {
				const result = await commandQueue.enqueue(cmd);
				wsHandler?.send(ws, result);

				// If setViewport succeeded, update screencast dimensions to match
				if (
					cmd.method === "setViewport" &&
					result.ok &&
					cmd.params?.width &&
					cmd.params?.height
				) {
					await wsHandler?.updateScreencastForViewport(
						cmd.params.width as number,
						cmd.params.height as number,
					);
				}
			}
		},
		// Broadcast frames/events to SSE clients
		onBroadcast: broadcastToSSE,
	});

	// Initialize CDP session for screencast
	await wsHandler.initCDP();
	console.log("[browserd] CDP session initialized, screencast active");

	// Navigate to a default page
	const defaultUrl = process.env.DEFAULT_URL || "about:blank";
	await browserManager.navigate(defaultUrl);
	console.log(`[browserd] Navigated to ${defaultUrl}`);
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

	// WebSocket upgrade
	if (path === "/ws") {
		const upgraded = server.upgrade(req, {
			data: createWebSocketData(),
		});

		if (upgraded) {
			return undefined;
		}

		return new Response("WebSocket upgrade failed", { status: 400 });
	}

	// SSE stream endpoint
	if (path === "/stream") {
		const clientId = generateSSEClientId();
		const encoder = new TextEncoder();

		return new Response(
			new ReadableStream({
				start(controller) {
					// Create client entry
					const client: SSEClient = {
						id: clientId,
						controller,
						send: (data: string) => {
							try {
								controller.enqueue(encoder.encode(`data: ${data}\n\n`));
							} catch {
								// Client disconnected, will be cleaned up
								sseClients.delete(clientId);
							}
						},
					};

					// Register client
					sseClients.set(clientId, client);
					console.log(
						`[sse] Client connected: ${clientId} (${sseClients.size} total)`,
					);

					// Send connected event
					controller.enqueue(
						encoder.encode(
							`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`,
						),
					);

					// Send viewport info if available
					const viewport = wsHandler?.getViewport();
					if (viewport) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({ type: "event", event: "ready", data: { viewport } })}\n\n`,
							),
						);
					}

					// Send last frame if available for quick preview
					const lastFrame = wsHandler?.getLastFrame();
					if (lastFrame) {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify(lastFrame)}\n\n`),
						);
					}
				},
				cancel() {
					sseClients.delete(clientId);
					console.log(
						`[sse] Client disconnected: ${clientId} (${sseClients.size} remaining)`,
					);
				},
			}),
			{
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
				},
			},
		);
	}

	// HTTP input endpoint (for SSE mode)
	if (path === "/input" && req.method === "POST") {
		try {
			const body = await req.json();

			if (body.type === "input") {
				// Dispatch input to browser
				await wsHandler?.dispatchInput(body as InputMessage);
				return Response.json({ ok: true });
			}

			if (body.type === "cmd" && commandQueue) {
				// Handle command
				const result = await commandQueue.enqueue(body);
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

	// CORS preflight for /input
	if (path === "/input" && req.method === "OPTIONS") {
		return new Response(null, {
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			},
		});
	}

	// Health endpoints
	if (path === "/health" || path === "/healthz") {
		return createHealthResponse(browserManager);
	}

	if (path === "/livez") {
		return createLivenessResponse();
	}

	if (path === "/readyz") {
		return createReadinessResponse(browserManager);
	}

	// Viewer page
	if (path === "/" || path === "/viewer") {
		return createViewerResponse({
			title: "Browserd Viewer",
			showControls: true,
			showStats: true,
		});
	}

	// Sessions API
	const sessionResponse = await handleSessionRequest(req, getBaseUrl());
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

	if (browserManager) {
		await browserManager.close();
		console.log("[browserd] Browser closed");
	}

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
		console.log(`[browserd] Viewer available at http://${HOST}:${PORT}/`);
		console.log(`[browserd] WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
		console.log(`[browserd] SSE stream endpoint: http://${HOST}:${PORT}/stream`);
		console.log(`[browserd] HTTP input endpoint: http://${HOST}:${PORT}/input`);
	} catch (error) {
		console.error("[browserd] Failed to start:", error);
		process.exit(1);
	}
}

// Run if this is the main module
main();

// Export for testing
export {
	browserManager,
	wsHandler,
	commandQueue,
	handleRequest,
	initBrowser,
	getBaseUrl,
};
