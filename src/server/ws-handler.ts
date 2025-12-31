/**
 * WebSocket Handler
 *
 * Routes WebSocket messages between clients and the browser
 */

import type { ServerWebSocket } from "bun";
import {
	type ClientMessage,
	type CommandMessage,
	createErrorResult,
	createEventMessage,
	createPongMessage,
	type FrameMessage,
	type InputMessage,
	parseClientMessage,
	type ServerMessage,
	serializeServerMessage,
} from "../protocol/types";
import type { BrowserManager } from "./browser-manager";
import { CDPSessionManager } from "./cdp-session";

export interface WebSocketData {
	id: string;
	connectedAt: number;
}

export interface WSHandlerOptions {
	browserManager: BrowserManager;
	onCommand?: (
		ws: ServerWebSocket<WebSocketData>,
		cmd: CommandMessage,
	) => Promise<void>;
}

/**
 * Manages WebSocket connections and message routing
 */
export class WSHandler {
	private browserManager: BrowserManager;
	private cdpSession: CDPSessionManager | null = null;
	private clients = new Map<string, ServerWebSocket<WebSocketData>>();
	private frameBuffer: FrameMessage | null = null;
	private options: WSHandlerOptions;

	constructor(options: WSHandlerOptions) {
		this.browserManager = options.browserManager;
		this.options = options;
	}

	/**
	 * Initialize CDP session for screencast
	 */
	async initCDP(): Promise<void> {
		if (!this.browserManager.isRunning()) {
			throw new Error("Browser not running");
		}

		const page = this.browserManager.getPage();
		const viewportSize = page.viewportSize() || { width: 1280, height: 720 };

		this.cdpSession = new CDPSessionManager(page, {
			screencast: {
				format: "jpeg",
				quality: 60,
				maxWidth: viewportSize.width,
				maxHeight: viewportSize.height,
			},
			onFrame: this.broadcastFrame.bind(this),
			onEvent: this.broadcastEvent.bind(this),
		});

		await this.cdpSession.init();
		await this.cdpSession.startScreencast();
	}

	/**
	 * Handle new WebSocket connection
	 */
	handleOpen(ws: ServerWebSocket<WebSocketData>): void {
		const clientId = ws.data.id;
		this.clients.set(clientId, ws);

		console.log(
			`[ws] Client connected: ${clientId} (${this.clients.size} total)`,
		);

		// Send ready event with viewport info
		if (this.cdpSession) {
			const viewport = this.cdpSession.getViewport();
			this.send(ws, createEventMessage("ready", { viewport }));
		}

		// Send last frame if available (for quick preview)
		if (this.frameBuffer) {
			this.send(ws, this.frameBuffer);
		}
	}

	/**
	 * Handle WebSocket message
	 */
	async handleMessage(
		ws: ServerWebSocket<WebSocketData>,
		message: string | Buffer,
	): Promise<void> {
		const data = typeof message === "string" ? message : message.toString();

		const parsed = parseClientMessage(data);
		if (!parsed) {
			console.warn(
				`[ws] Invalid message from ${ws.data.id}:`,
				data.slice(0, 100),
			);
			return;
		}

		await this.routeMessage(ws, parsed);
	}

	/**
	 * Route message to appropriate handler
	 */
	private async routeMessage(
		ws: ServerWebSocket<WebSocketData>,
		message: ClientMessage,
	): Promise<void> {
		switch (message.type) {
			case "ping":
				// Respond with pong
				this.send(ws, createPongMessage(message.t));
				break;

			case "input":
				// Dispatch input to browser
				await this.handleInput(message);
				break;

			case "cmd":
				// Handle command
				await this.handleCommand(ws, message);
				break;
		}
	}

	/**
	 * Handle input message (mouse/keyboard)
	 */
	private async handleInput(input: InputMessage): Promise<void> {
		if (!this.cdpSession) {
			return;
		}

		try {
			await this.cdpSession.dispatchInput(input);
		} catch (error) {
			console.error("[ws] Input dispatch error:", error);
		}
	}

	/**
	 * Handle command message
	 */
	private async handleCommand(
		ws: ServerWebSocket<WebSocketData>,
		cmd: CommandMessage,
	): Promise<void> {
		// Delegate to command handler if provided
		if (this.options.onCommand) {
			await this.options.onCommand(ws, cmd);
		} else {
			// No command handler - return error
			this.send(
				ws,
				createErrorResult(
					cmd.id,
					"NOT_IMPLEMENTED",
					"Command handling not implemented",
				),
			);
		}
	}

	/**
	 * Handle WebSocket close
	 */
	handleClose(
		ws: ServerWebSocket<WebSocketData>,
		code: number,
		reason: string,
	): void {
		const clientId = ws.data.id;
		this.clients.delete(clientId);

		console.log(
			`[ws] Client disconnected: ${clientId} (code=${code}, reason=${reason || "none"})`,
		);
	}

	/**
	 * Handle WebSocket error
	 */
	handleError(ws: ServerWebSocket<WebSocketData>, error: Error): void {
		console.error(`[ws] Error for client ${ws.data.id}:`, error.message);
	}

	/**
	 * Broadcast frame to all connected clients
	 */
	private broadcastFrame(frame: FrameMessage): void {
		// Store for new clients
		this.frameBuffer = frame;

		// Broadcast to all clients
		const message = serializeServerMessage(frame);
		for (const client of this.clients.values()) {
			try {
				client.send(message);
			} catch {
				// Client might have disconnected
			}
		}
	}

	/**
	 * Broadcast event to all connected clients
	 */
	private broadcastEvent(event: ServerMessage): void {
		const message = serializeServerMessage(event);
		for (const client of this.clients.values()) {
			try {
				client.send(message);
			} catch {
				// Client might have disconnected
			}
		}
	}

	/**
	 * Send message to a specific client
	 */
	send(ws: ServerWebSocket<WebSocketData>, message: ServerMessage): void {
		try {
			ws.send(serializeServerMessage(message));
		} catch {
			// Client might have disconnected
		}
	}

	/**
	 * Get number of connected clients
	 */
	getClientCount(): number {
		return this.clients.size;
	}

	/**
	 * Get CDP session
	 */
	getCDPSession(): CDPSessionManager | null {
		return this.cdpSession;
	}

	/**
	 * Update screencast dimensions to match new viewport
	 * This should be called after setViewport command completes
	 */
	async updateScreencastForViewport(
		width: number,
		height: number,
	): Promise<void> {
		if (this.cdpSession) {
			await this.cdpSession.updateScreencastSettings({
				maxWidth: width,
				maxHeight: height,
			});
		}
	}

	/**
	 * Close all connections and cleanup
	 */
	async close(): Promise<void> {
		// Close all client connections
		for (const client of this.clients.values()) {
			try {
				client.close(1000, "Server shutting down");
			} catch {
				// Ignore close errors
			}
		}
		this.clients.clear();

		// Close CDP session
		if (this.cdpSession) {
			await this.cdpSession.close();
			this.cdpSession = null;
		}
	}
}

/**
 * Generate a unique client ID
 */
export function generateClientId(): string {
	return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create WebSocket data for a new connection
 */
export function createWebSocketData(): WebSocketData {
	return {
		id: generateClientId(),
		connectedAt: Date.now(),
	};
}
