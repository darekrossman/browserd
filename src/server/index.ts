/**
 * Browserd Server
 *
 * Main entry point for the browser service
 */

import type { ServerWebSocket } from "bun";
import { handleSessionRequest } from "../api/sessions";
import { createViewerResponse } from "../client/viewer-template";
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
