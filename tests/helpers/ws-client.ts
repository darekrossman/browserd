/**
 * WebSocket Test Client
 *
 * Utility for testing WebSocket connections
 */

import {
	type ClientMessage,
	type EventMessage,
	type FrameMessage,
	isEventMessage,
	isFrameMessage,
	isPongMessage,
	isResultMessage,
	type ResultMessage,
	type ServerMessage,
} from "../../src/protocol/types";

export interface WSClientOptions {
	url: string;
	timeout?: number;
}

export interface ReceivedMessages {
	frames: FrameMessage[];
	results: ResultMessage[];
	events: EventMessage[];
	pongs: Array<{ t: number }>;
	all: ServerMessage[];
}

/**
 * Test WebSocket client for integration tests
 */
export class TestWSClient {
	private ws: WebSocket | null = null;
	private url: string;
	private timeout: number;
	private connected = false;
	private messages: ReceivedMessages = {
		frames: [],
		results: [],
		events: [],
		pongs: [],
		all: [],
	};
	private messageHandlers: Array<(msg: ServerMessage) => void> = [];
	private connectPromise: Promise<void> | null = null;
	private closePromise: Promise<void> | null = null;

	constructor(options: WSClientOptions) {
		this.url = options.url;
		this.timeout = options.timeout || 5000;
	}

	/**
	 * Connect to the WebSocket server
	 */
	async connect(): Promise<void> {
		if (this.connected || this.connectPromise) {
			return this.connectPromise || Promise.resolve();
		}

		this.connectPromise = new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Connection timeout after ${this.timeout}ms`));
			}, this.timeout);

			this.ws = new WebSocket(this.url);

			this.ws.onopen = () => {
				clearTimeout(timeoutId);
				this.connected = true;
				resolve();
			};

			this.ws.onerror = (error) => {
				clearTimeout(timeoutId);
				reject(new Error(`WebSocket error: ${error}`));
			};

			this.ws.onclose = () => {
				this.connected = false;
			};

			this.ws.onmessage = (event) => {
				this.handleMessage(event.data);
			};
		});

		return this.connectPromise;
	}

	/**
	 * Handle incoming message
	 */
	private handleMessage(data: string): void {
		try {
			const msg = JSON.parse(data) as ServerMessage;
			this.messages.all.push(msg);

			if (isFrameMessage(msg)) {
				this.messages.frames.push(msg);
			} else if (isResultMessage(msg)) {
				this.messages.results.push(msg);
			} else if (isEventMessage(msg)) {
				this.messages.events.push(msg);
			} else if (isPongMessage(msg)) {
				this.messages.pongs.push(msg);
			}

			// Notify handlers
			for (const handler of this.messageHandlers) {
				handler(msg);
			}
		} catch {
			// Ignore parse errors
		}
	}

	/**
	 * Send a message to the server
	 */
	send(message: ClientMessage): void {
		if (!this.ws || !this.connected) {
			throw new Error("Not connected");
		}
		this.ws.send(JSON.stringify(message));
	}

	/**
	 * Send a ping message
	 */
	sendPing(): void {
		this.send({ type: "ping", t: Date.now() });
	}

	/**
	 * Send an input message
	 */
	sendInput(
		device: "mouse" | "key",
		action: string,
		params: Record<string, unknown> = {},
	): void {
		this.send({
			type: "input",
			device,
			action,
			...params,
		} as ClientMessage);
	}

	/**
	 * Send a command message
	 */
	sendCommand(method: string, params: Record<string, unknown> = {}): string {
		const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		this.send({
			id,
			type: "cmd",
			method,
			params,
		} as ClientMessage);
		return id;
	}

	/**
	 * Wait for a specific message type
	 */
	async waitForMessage<T extends ServerMessage>(
		predicate: (msg: ServerMessage) => msg is T,
		timeout = this.timeout,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.removeMessageHandler(handler);
				reject(new Error(`Timeout waiting for message after ${timeout}ms`));
			}, timeout);

			const handler = (msg: ServerMessage) => {
				if (predicate(msg)) {
					clearTimeout(timeoutId);
					this.removeMessageHandler(handler);
					resolve(msg);
				}
			};

			// Check existing messages
			for (const msg of this.messages.all) {
				if (predicate(msg)) {
					clearTimeout(timeoutId);
					resolve(msg);
					return;
				}
			}

			this.messageHandlers.push(handler);
		});
	}

	/**
	 * Wait for a frame message
	 */
	async waitForFrame(timeout?: number): Promise<FrameMessage> {
		return this.waitForMessage(isFrameMessage, timeout);
	}

	/**
	 * Wait for an event message with specific name
	 */
	async waitForEvent(name: string, timeout?: number): Promise<EventMessage> {
		return this.waitForMessage(
			(msg): msg is EventMessage => isEventMessage(msg) && msg.name === name,
			timeout,
		);
	}

	/**
	 * Wait for a result message with specific id
	 */
	async waitForResult(id: string, timeout?: number): Promise<ResultMessage> {
		return this.waitForMessage(
			(msg): msg is ResultMessage => isResultMessage(msg) && msg.id === id,
			timeout,
		);
	}

	/**
	 * Wait for multiple frames
	 */
	async waitForFrames(
		count: number,
		timeout?: number,
	): Promise<FrameMessage[]> {
		const frames: FrameMessage[] = [];
		const effectiveTimeout = timeout || this.timeout;
		const deadline = Date.now() + effectiveTimeout;

		while (frames.length < count && Date.now() < deadline) {
			try {
				const remaining = deadline - Date.now();
				const frame = await this.waitForFrame(remaining);
				frames.push(frame);
			} catch {
				break;
			}
		}

		if (frames.length < count) {
			throw new Error(`Only received ${frames.length}/${count} frames`);
		}

		return frames;
	}

	/**
	 * Add a message handler
	 */
	onMessage(handler: (msg: ServerMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	/**
	 * Remove a message handler
	 */
	private removeMessageHandler(handler: (msg: ServerMessage) => void): void {
		const index = this.messageHandlers.indexOf(handler);
		if (index !== -1) {
			this.messageHandlers.splice(index, 1);
		}
	}

	/**
	 * Get all received messages
	 */
	getMessages(): ReceivedMessages {
		return { ...this.messages };
	}

	/**
	 * Clear received messages
	 */
	clearMessages(): void {
		this.messages = {
			frames: [],
			results: [],
			events: [],
			pongs: [],
			all: [],
		};
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Close the connection
	 */
	async close(): Promise<void> {
		if (!this.ws || !this.connected) {
			return;
		}

		this.closePromise = new Promise((resolve) => {
			if (this.ws) {
				this.ws.onclose = () => {
					this.connected = false;
					resolve();
				};
				this.ws.close();
			} else {
				resolve();
			}
		});

		return this.closePromise;
	}
}

/**
 * Create a test WebSocket client
 */
export function createTestClient(port: number | string): TestWSClient {
	return new TestWSClient({
		url: `ws://localhost:${port}/ws`,
		timeout: 10000,
	});
}

/**
 * Wait utility
 */
export function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
