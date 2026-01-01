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
import type { BrowserSession, SessionManager } from "./session-manager";

export interface WebSocketData {
	id: string;
	connectedAt: number;
	/** Session ID this client is connected to */
	sessionId: string;
}

export interface WSHandlerOptions {
	browserManager: BrowserManager;
	onCommand?: (
		ws: ServerWebSocket<WebSocketData>,
		cmd: CommandMessage,
	) => Promise<void>;
	/** External broadcast callback for SSE clients */
	onBroadcast?: (message: ServerMessage) => void;
}

export interface MultiSessionWSHandlerOptions {
	sessionManager: SessionManager;
	onCommand?: (
		ws: ServerWebSocket<WebSocketData>,
		cmd: CommandMessage,
		session: BrowserSession,
	) => Promise<void>;
	/** External broadcast callback for SSE clients (with session ID) */
	onBroadcast?: (sessionId: string, message: ServerMessage) => void;
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
				await this.dispatchInput(message);
				break;

			case "cmd":
				// Handle command
				await this.handleCommand(ws, message);
				break;
		}
	}

	/**
	 * Handle input message (mouse/keyboard)
	 * Public to allow HTTP input endpoint to dispatch input
	 */
	async dispatchInput(input: InputMessage): Promise<void> {
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

		// Broadcast to all WebSocket clients
		const message = serializeServerMessage(frame);
		for (const client of this.clients.values()) {
			try {
				client.send(message);
			} catch {
				// Client might have disconnected
			}
		}

		// Notify external listeners (SSE clients)
		this.options.onBroadcast?.(frame);
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

		// Notify external listeners (SSE clients)
		this.options.onBroadcast?.(event);
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
	 * Get the last frame for new clients
	 */
	getLastFrame(): FrameMessage | null {
		return this.frameBuffer;
	}

	/**
	 * Get viewport info for new clients
	 */
	getViewport(): { w: number; h: number; dpr: number } | null {
		return this.cdpSession?.getViewport() ?? null;
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
export function createWebSocketData(sessionId = "default"): WebSocketData {
	return {
		id: generateClientId(),
		connectedAt: Date.now(),
		sessionId,
	};
}

/**
 * Multi-session WebSocket handler
 * Routes messages to the correct session based on WebSocket data
 */
export class MultiSessionWSHandler {
	private sessionManager: SessionManager;
	private clients = new Map<string, ServerWebSocket<WebSocketData>>();
	private clientsBySession = new Map<string, Set<string>>();
	private options: MultiSessionWSHandlerOptions;

	constructor(options: MultiSessionWSHandlerOptions) {
		this.sessionManager = options.sessionManager;
		this.options = options;

		// Wire up session frame broadcasts
		this.sessionManager.onSessionFrame = (sessionId, frame) => {
			this.broadcastToSession(sessionId, frame);
		};

		this.sessionManager.onSessionEvent = (sessionId, event) => {
			this.broadcastToSession(sessionId, event);
		};
	}

	/**
	 * Handle new WebSocket connection for a specific session
	 */
	handleOpen(ws: ServerWebSocket<WebSocketData>): void {
		const { id: clientId, sessionId } = ws.data;

		// Track client
		this.clients.set(clientId, ws);

		// Track client by session
		if (!this.clientsBySession.has(sessionId)) {
			this.clientsBySession.set(sessionId, new Set());
		}
		this.clientsBySession.get(sessionId)!.add(clientId);

		// Register with session
		this.sessionManager.addClient(sessionId, clientId);

		console.log(
			`[ws] Client ${clientId} connected to session ${sessionId} (${this.clients.size} total)`,
		);

		// Send ready event and last frame from session
		const session = this.sessionManager.getSession(sessionId);
		if (session) {
			// Send viewport info
			const viewport = session.cdpSession.getViewport();
			this.send(ws, createEventMessage("ready", { viewport }));

			// Send last frame if available
			if (session.frameBuffer) {
				this.send(ws, session.frameBuffer);
			}
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
		const { sessionId } = ws.data;

		const parsed = parseClientMessage(data);
		if (!parsed) {
			console.warn(
				`[ws] Invalid message from ${ws.data.id}:`,
				data.slice(0, 100),
			);
			return;
		}

		// Get session for routing
		const session = this.sessionManager.getSession(sessionId);
		if (!session) {
			console.warn(`[ws] Session ${sessionId} not found for client ${ws.data.id}`);
			if (parsed.type === "cmd") {
				this.send(
					ws,
					createErrorResult(parsed.id, "SESSION_NOT_FOUND", `Session ${sessionId} not found`),
				);
			}
			return;
		}

		// Update session activity
		this.sessionManager.touchSession(sessionId);

		await this.routeMessage(ws, parsed, session);
	}

	/**
	 * Route message to appropriate handler
	 */
	private async routeMessage(
		ws: ServerWebSocket<WebSocketData>,
		message: ClientMessage,
		session: BrowserSession,
	): Promise<void> {
		switch (message.type) {
			case "ping":
				this.send(ws, createPongMessage(message.t));
				break;

			case "input":
				await this.dispatchInput(session, message);
				break;

			case "cmd":
				await this.handleCommand(ws, message, session);
				break;
		}
	}

	/**
	 * Dispatch input to session's CDP
	 */
	async dispatchInput(session: BrowserSession, input: InputMessage): Promise<void> {
		try {
			await session.cdpSession.dispatchInput(input);
		} catch (error) {
			console.error(`[ws] Input dispatch error for session ${session.id}:`, error);
		}
	}

	/**
	 * Handle command message
	 */
	private async handleCommand(
		ws: ServerWebSocket<WebSocketData>,
		cmd: CommandMessage,
		session: BrowserSession,
	): Promise<void> {
		if (this.options.onCommand) {
			await this.options.onCommand(ws, cmd, session);
		} else {
			this.send(
				ws,
				createErrorResult(cmd.id, "NOT_IMPLEMENTED", "Command handling not implemented"),
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
		const { id: clientId, sessionId } = ws.data;

		// Remove from tracking
		this.clients.delete(clientId);

		const sessionClients = this.clientsBySession.get(sessionId);
		if (sessionClients) {
			sessionClients.delete(clientId);
			if (sessionClients.size === 0) {
				this.clientsBySession.delete(sessionId);
			}
		}

		// Unregister from session
		this.sessionManager.removeClient(sessionId, clientId);

		console.log(
			`[ws] Client ${clientId} disconnected from session ${sessionId} (code=${code}, reason=${reason || "none"})`,
		);
	}

	/**
	 * Handle WebSocket error
	 */
	handleError(ws: ServerWebSocket<WebSocketData>, error: Error): void {
		console.error(`[ws] Error for client ${ws.data.id}:`, error.message);
	}

	/**
	 * Broadcast message to all clients of a specific session
	 */
	broadcastToSession(sessionId: string, message: ServerMessage): void {
		const serialized = serializeServerMessage(message);
		const sessionClients = this.clientsBySession.get(sessionId);

		if (!sessionClients) return;

		for (const clientId of sessionClients) {
			const client = this.clients.get(clientId);
			if (client) {
				try {
					client.send(serialized);
				} catch {
					// Client might have disconnected
				}
			}
		}

		// Notify external listeners (SSE clients)
		this.options.onBroadcast?.(sessionId, message);
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
	 * Get total client count
	 */
	getClientCount(): number {
		return this.clients.size;
	}

	/**
	 * Get client count for a specific session
	 */
	getSessionClientCount(sessionId: string): number {
		return this.clientsBySession.get(sessionId)?.size ?? 0;
	}

	/**
	 * Get session manager
	 */
	getSessionManager(): SessionManager {
		return this.sessionManager;
	}

	/**
	 * Get last frame for a session (for new SSE clients)
	 */
	getSessionLastFrame(sessionId: string): FrameMessage | null {
		return this.sessionManager.getSession(sessionId)?.frameBuffer ?? null;
	}

	/**
	 * Get viewport for a session
	 */
	getSessionViewport(sessionId: string): { w: number; h: number; dpr: number } | null {
		const session = this.sessionManager.getSession(sessionId);
		return session?.cdpSession.getViewport() ?? null;
	}

	/**
	 * Close all connections
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
		this.clientsBySession.clear();
	}
}
