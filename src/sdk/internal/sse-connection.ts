/**
 * SSE Connection Manager
 *
 * Handles Server-Sent Events connection for receiving frames/events
 * and HTTP POST for sending commands/input.
 *
 * Uses fetch-based SSE parsing for Node/Bun compatibility (no EventSource API).
 */

import type { ClientMessage, ServerMessage } from "../../protocol/types";
import { BrowserdError } from "../errors";
import type { ConnectionState, ConnectionStateChange } from "../types";

export interface SSEConnectionManagerOptions {
	/**
	 * URL for SSE connection. Can be:
	 * - Base URL: "https://example.com" (will use /stream and /input)
	 * - Stream URL: "https://example.com/stream" (will derive /input)
	 * - Session URL: "https://example.com/sessions/{id}/stream" (will derive session-specific /input)
	 */
	url: string;
	/** Connection timeout in milliseconds */
	timeout?: number;
	/** Whether to automatically reconnect on disconnect */
	autoReconnect?: boolean;
	/** Interval between reconnect attempts in milliseconds */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts */
	maxReconnectAttempts?: number;
	/** Optional auth token for authenticated requests */
	authToken?: string;
}

type MessageHandler = (message: ServerMessage) => void;
type StateChangeHandler = (change: ConnectionStateChange) => void;
type ErrorHandler = (error: Error) => void;

/**
 * Manages SSE connection for receiving events and HTTP for sending commands.
 * Uses fetch streaming instead of EventSource for server-side compatibility.
 */
export class SSEConnectionManager {
	private state: ConnectionState = "disconnected";
	private streamUrl: string;
	private inputUrl: string;
	private timeout: number;
	private autoReconnect: boolean;
	private reconnectInterval: number;
	private maxReconnectAttempts: number;
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private authToken?: string;

	private messageHandlers: MessageHandler[] = [];
	private stateChangeHandlers: StateChangeHandler[] = [];
	private errorHandlers: ErrorHandler[] = [];

	private connectPromise: Promise<void> | null = null;
	private abortController: AbortController | null = null;
	private streamReader: ReadableStreamDefaultReader | null = null;

	constructor(options: SSEConnectionManagerOptions) {
		// Normalize URL (convert ws:// to http://)
		const url = options.url
			.replace(/^wss:\/\//, "https://")
			.replace(/^ws:\/\//, "http://");

		// Derive stream and input URLs based on URL format
		const { streamUrl, inputUrl } = this.deriveEndpointUrls(url);
		this.streamUrl = streamUrl;
		this.inputUrl = inputUrl;

		this.timeout = options.timeout ?? 30000;
		this.autoReconnect = options.autoReconnect ?? true;
		this.reconnectInterval = options.reconnectInterval ?? 2000;
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
		this.authToken = options.authToken;
	}

	/**
	 * Derive stream and input URLs from the provided URL.
	 * Handles various URL formats:
	 * - Base URL: "http://host:3000" → stream="/stream", input="/input"
	 * - Legacy stream: "http://host:3000/stream" → stream="/stream", input="/input"
	 * - Session stream: "http://host:3000/sessions/{id}/stream" → session-specific URLs
	 * - Legacy ws path: "http://host:3000/ws" → stream="/stream", input="/input"
	 */
	private deriveEndpointUrls(url: string): {
		streamUrl: string;
		inputUrl: string;
	} {
		// Check for session-specific URL pattern: /sessions/{id}/stream
		const sessionMatch = url.match(/^(.+)\/sessions\/([^/]+)\/(stream|ws)$/);
		if (sessionMatch) {
			const baseUrl = sessionMatch[1];
			const sessionId = sessionMatch[2];
			return {
				streamUrl: `${baseUrl}/sessions/${sessionId}/stream`,
				inputUrl: `${baseUrl}/sessions/${sessionId}/input`,
			};
		}

		// Check for legacy /stream or /ws suffix
		if (url.endsWith("/stream")) {
			const baseUrl = url.replace(/\/stream$/, "");
			return {
				streamUrl: `${baseUrl}/stream`,
				inputUrl: `${baseUrl}/input`,
			};
		}

		if (url.endsWith("/ws")) {
			const baseUrl = url.replace(/\/ws$/, "");
			return {
				streamUrl: `${baseUrl}/stream`,
				inputUrl: `${baseUrl}/input`,
			};
		}

		// Plain base URL
		return {
			streamUrl: `${url}/stream`,
			inputUrl: `${url}/input`,
		};
	}

	/**
	 * Get headers for requests, including auth if configured
	 */
	private getHeaders(
		additionalHeaders?: Record<string, string>,
	): Record<string, string> {
		const headers: Record<string, string> = { ...additionalHeaders };
		if (this.authToken) {
			headers.Authorization = `Bearer ${this.authToken}`;
		}
		return headers;
	}

	/**
	 * Get current connection state
	 */
	getState(): ConnectionState {
		return this.state;
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.state === "connected";
	}

	/**
	 * Connect to the SSE stream using fetch
	 * Includes retry logic for transient proxy errors (502, 503, 504)
	 */
	async connect(): Promise<void> {
		// Already connected or connecting
		if (this.state === "connected") {
			return;
		}

		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.setState("connecting");
		this.abortController = new AbortController();

		this.connectPromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.cleanup();
				const error = BrowserdError.connectionTimeout(this.timeout);
				this.handleError(error);
				reject(error);
			}, this.timeout);

			const doConnect = async () => {
				// Retry logic for transient proxy errors
				const maxRetries = 3;
				const retryDelay = 500;
				let lastError: Error | null = null;

				for (let attempt = 1; attempt <= maxRetries; attempt++) {
					try {
						const response = await fetch(this.streamUrl, {
							method: "GET",
							headers: this.getHeaders({
								Accept: "text/event-stream",
							}),
							signal: this.abortController!.signal,
						});

						// Check for retryable errors (proxy/gateway issues)
						if (
							[502, 503, 504].includes(response.status) &&
							attempt < maxRetries
						) {
							lastError = new Error(
								`HTTP ${response.status}: ${response.statusText}`,
							);
							await new Promise((r) => setTimeout(r, retryDelay * attempt));
							continue;
						}

						if (!response.ok) {
							throw new Error(
								`HTTP ${response.status}: ${response.statusText}`,
							);
						}

						if (!response.body) {
							throw new Error("Response body is null");
						}

						// Start reading the stream
						this.streamReader = response.body.getReader();
						const decoder = new TextDecoder();
						const buffer = "";

						// Mark as connected once we start receiving data
						clearTimeout(timeoutId);
						this.reconnectAttempts = 0;
						this.setState("connected");
						resolve();

						// Process stream in background
						this.processStream(decoder, buffer);
						return;
					} catch (err) {
						// Re-throw non-retryable errors immediately
						if (err instanceof Error && err.name === "AbortError") {
							throw err;
						}
						// For other errors, store and retry if attempts remain
						lastError = err instanceof Error ? err : new Error(String(err));
						if (attempt < maxRetries) {
							await new Promise((r) => setTimeout(r, retryDelay * attempt));
						}
					}
				}

				// All retries exhausted
				throw lastError || new Error("Connection failed after retries");
			};

			doConnect().catch((err) => {
				clearTimeout(timeoutId);

				if (err instanceof Error && err.name === "AbortError") {
					// Connection was intentionally closed
					this.setState("disconnected");
					resolve(); // Resolve instead of leaving hanging
					return;
				}

				const error = BrowserdError.connectionFailed(
					err instanceof Error ? err.message : String(err),
					err instanceof Error ? err : undefined,
				);
				this.handleError(error);
				this.setState("disconnected");
				reject(error);
			});
		});

		try {
			await this.connectPromise;
		} finally {
			this.connectPromise = null;
		}
	}

	/**
	 * Process the SSE stream
	 */
	private async processStream(
		decoder: TextDecoder,
		buffer: string,
	): Promise<void> {
		if (!this.streamReader) return;

		try {
			while (true) {
				const { done, value } = await this.streamReader.read();

				if (done) {
					// Stream ended
					const wasConnected = this.state === "connected";
					this.cleanup();

					if (wasConnected && this.autoReconnect) {
						this.attemptReconnect();
					} else {
						this.setState("disconnected");
					}
					return;
				}

				// Decode chunk and add to buffer
				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE messages
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				let eventType = "message";
				let eventData = "";

				for (const line of lines) {
					if (line.startsWith("event:")) {
						eventType = line.slice(6).trim();
					} else if (line.startsWith("data:")) {
						eventData = line.slice(5).trim();
					} else if (line === "" && eventData) {
						// Empty line = end of message
						if (eventType === "connected") {
							// Connection confirmed, already handled
						} else {
							// Handle data message
							this.handleMessage(eventData);
						}
						eventType = "message";
						eventData = "";
					}
				}
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				// Connection was intentionally closed
				return;
			}

			const wasConnected = this.state === "connected";
			this.cleanup();

			if (wasConnected && this.autoReconnect) {
				this.attemptReconnect();
			} else {
				this.setState("disconnected");
				this.handleError(err instanceof Error ? err : new Error(String(err)));
			}
		}
	}

	/**
	 * Close the connection
	 */
	async close(): Promise<void> {
		this.autoReconnect = false;
		this.cancelReconnect();
		this.cleanup();
		this.setState("disconnected");
	}

	/**
	 * Send a message to the server via HTTP POST
	 */
	send(message: ClientMessage): void {
		if (this.state !== "connected") {
			throw BrowserdError.notConnected();
		}

		// Send asynchronously via HTTP POST
		this.sendAsync(message).catch((err) => {
			this.handleError(err instanceof Error ? err : new Error(String(err)));
		});
	}

	/**
	 * Send a message and wait for HTTP response
	 */
	private async sendAsync(message: ClientMessage): Promise<void> {
		try {
			const response = await fetch(this.inputUrl, {
				method: "POST",
				headers: this.getHeaders({
					"Content-Type": "application/json",
				}),
				body: JSON.stringify(message),
				signal: AbortSignal.timeout(this.timeout),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			// For command messages, the response contains the result
			if (message.type === "cmd") {
				const result = await response.json();
				// Route the result through the message handler
				this.handleMessage(JSON.stringify(result));
			}
		} catch (err) {
			throw BrowserdError.connectionFailed(
				`Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Register a message handler
	 */
	onMessage(handler: MessageHandler): () => void {
		this.messageHandlers.push(handler);
		return () => {
			const index = this.messageHandlers.indexOf(handler);
			if (index !== -1) {
				this.messageHandlers.splice(index, 1);
			}
		};
	}

	/**
	 * Register a state change handler
	 */
	onStateChange(handler: StateChangeHandler): () => void {
		this.stateChangeHandlers.push(handler);
		return () => {
			const index = this.stateChangeHandlers.indexOf(handler);
			if (index !== -1) {
				this.stateChangeHandlers.splice(index, 1);
			}
		};
	}

	/**
	 * Register an error handler
	 */
	onError(handler: ErrorHandler): () => void {
		this.errorHandlers.push(handler);
		return () => {
			const index = this.errorHandlers.indexOf(handler);
			if (index !== -1) {
				this.errorHandlers.splice(index, 1);
			}
		};
	}

	/**
	 * Update connection state
	 */
	private setState(newState: ConnectionState, error?: Error): void {
		if (this.state === newState) return;

		const change: ConnectionStateChange = {
			previousState: this.state,
			currentState: newState,
			error,
		};

		this.state = newState;

		for (const handler of this.stateChangeHandlers) {
			try {
				handler(change);
			} catch {
				// Ignore handler errors
			}
		}
	}

	/**
	 * Handle incoming message
	 */
	private handleMessage(data: string): void {
		try {
			const message = JSON.parse(data) as ServerMessage;
			for (const handler of this.messageHandlers) {
				try {
					handler(message);
				} catch {
					// Ignore handler errors
				}
			}
		} catch {
			// Ignore parse errors
		}
	}

	/**
	 * Handle error
	 */
	private handleError(error: Error): void {
		for (const handler of this.errorHandlers) {
			try {
				handler(error);
			} catch {
				// Ignore handler errors
			}
		}
	}

	/**
	 * Attempt to reconnect
	 */
	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			const error = new BrowserdError(
				"RECONNECT_FAILED",
				`Failed to reconnect after ${this.maxReconnectAttempts} attempts`,
			);
			this.setState("disconnected", error);
			this.handleError(error);
			return;
		}

		this.setState("reconnecting");
		this.reconnectAttempts++;

		const delay = this.reconnectInterval * 1.5 ** (this.reconnectAttempts - 1);

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectTimer = null;
			try {
				await this.connect();
			} catch {
				// connect() will handle the error and potentially retry
			}
		}, delay);
	}

	/**
	 * Cancel pending reconnect
	 */
	private cancelReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	/**
	 * Cleanup resources
	 */
	private cleanup(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.streamReader) {
			this.streamReader.cancel().catch(() => {});
			this.streamReader = null;
		}
	}
}
