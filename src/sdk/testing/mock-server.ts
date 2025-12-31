/**
 * Mock WebSocket Server for Testing
 *
 * Provides a simple WebSocket server that can be used to test the SDK client.
 */

import type {
	ClientMessage,
	EventMessage,
	PongMessage,
	ResultMessage,
} from "../../protocol/types";

export interface MockServerOptions {
	port?: number;
}

interface WebSocketData {
	id: string;
}

/**
 * Mock WebSocket server for testing BrowserdClient
 */
export class MockServer {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private clients = new Map<string, { ws: unknown; id: string }>();
	private messageHandler:
		| ((msg: ClientMessage, respond: (msg: unknown) => void) => void)
		| null = null;
	private clientIdCounter = 0;
	public port = 0;

	/**
	 * Start the mock server
	 */
	async start(options?: MockServerOptions): Promise<number> {
		const requestedPort = options?.port ?? 0;

		this.server = Bun.serve<WebSocketData>({
			port: requestedPort,
			fetch: (req, server) => {
				const url = new URL(req.url);
				if (url.pathname === "/ws") {
					const clientId = `client_${++this.clientIdCounter}`;
					const upgraded = server.upgrade(req, { data: { id: clientId } });
					if (upgraded) {
						return undefined;
					}
					return new Response("WebSocket upgrade failed", { status: 400 });
				}
				return new Response("Not found", { status: 404 });
			},
			websocket: {
				open: (ws) => {
					this.clients.set(ws.data.id, { ws, id: ws.data.id });
				},
				message: (ws, message) => {
					if (typeof message !== "string") return;

					try {
						const parsed = JSON.parse(message) as ClientMessage;
						this.handleMessage(ws, parsed);
					} catch {
						// Ignore parse errors
					}
				},
				close: (ws) => {
					this.clients.delete(ws.data.id);
				},
			},
		});

		this.port = this.server.port ?? 0;
		return this.port;
	}

	/**
	 * Stop the mock server
	 */
	async stop(): Promise<void> {
		if (this.server) {
			this.server.stop();
			this.server = null;
		}
		this.clients.clear();
	}

	/**
	 * Set a message handler for incoming client messages
	 */
	onMessage(
		handler: (msg: ClientMessage, respond: (msg: unknown) => void) => void,
	): void {
		this.messageHandler = handler;
	}

	/**
	 * Send a message to all connected clients
	 */
	broadcast(message: unknown): void {
		const data = JSON.stringify(message);
		for (const { ws } of this.clients.values()) {
			(ws as { send: (data: string) => void }).send(data);
		}
	}

	/**
	 * Send a result message for a specific command ID
	 */
	sendResult(
		id: string,
		ok: boolean,
		result?: unknown,
		error?: ResultMessage["error"],
	): void {
		const msg: ResultMessage = {
			id,
			type: "result",
			ok,
			result,
			error,
		};
		this.broadcast(msg);
	}

	/**
	 * Send an event message
	 */
	sendEvent(name: EventMessage["name"], data?: unknown): void {
		const msg: EventMessage = {
			type: "event",
			name,
			data,
		};
		this.broadcast(msg);
	}

	/**
	 * Get the WebSocket URL for this server
	 */
	getUrl(): string {
		return `ws://localhost:${this.port}/ws`;
	}

	/**
	 * Get the number of connected clients
	 */
	get clientCount(): number {
		return this.clients.size;
	}

	/**
	 * Handle incoming message from client
	 */
	private handleMessage(
		ws: { send: (data: string) => void },
		message: ClientMessage,
	): void {
		// Handle ping/pong automatically
		if (message.type === "ping") {
			const pong: PongMessage = {
				type: "pong",
				t: message.t,
			};
			ws.send(JSON.stringify(pong));
			return;
		}

		// Delegate to custom handler
		if (this.messageHandler) {
			this.messageHandler(message, (response) => {
				ws.send(JSON.stringify(response));
			});
		}
	}
}

/**
 * Create and start a mock server
 */
export async function createMockServer(
	options?: MockServerOptions,
): Promise<MockServer> {
	const server = new MockServer();
	await server.start(options);
	return server;
}
