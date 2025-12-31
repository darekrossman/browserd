/**
 * WebSocket Connection Manager
 *
 * Handles WebSocket lifecycle, reconnection, and message routing
 */

import type { ClientMessage, ServerMessage } from "../../protocol/types";
import { BrowserdError } from "../errors";
import type { ConnectionState, ConnectionStateChange } from "../types";

export interface ConnectionManagerOptions {
	/** WebSocket URL to connect to */
	url: string;
	/** Connection timeout in milliseconds */
	timeout?: number;
	/** Whether to automatically reconnect on disconnect */
	autoReconnect?: boolean;
	/** Interval between reconnect attempts in milliseconds */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts */
	maxReconnectAttempts?: number;
}

type MessageHandler = (message: ServerMessage) => void;
type StateChangeHandler = (change: ConnectionStateChange) => void;
type ErrorHandler = (error: Error) => void;

/**
 * Manages WebSocket connection lifecycle
 */
export class ConnectionManager {
	private ws: WebSocket | null = null;
	private state: ConnectionState = "disconnected";
	private url: string;
	private timeout: number;
	private autoReconnect: boolean;
	private reconnectInterval: number;
	private maxReconnectAttempts: number;
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	private messageHandlers: MessageHandler[] = [];
	private stateChangeHandlers: StateChangeHandler[] = [];
	private errorHandlers: ErrorHandler[] = [];

	private connectPromise: Promise<void> | null = null;

	constructor(options: ConnectionManagerOptions) {
		this.url = options.url;
		this.timeout = options.timeout ?? 30000;
		this.autoReconnect = options.autoReconnect ?? true;
		this.reconnectInterval = options.reconnectInterval ?? 2000;
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
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
	 * Connect to the WebSocket server
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

		this.connectPromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.cleanup();
				const error = BrowserdError.connectionTimeout(this.timeout);
				this.handleError(error);
				reject(error);
			}, this.timeout);

			try {
				this.ws = new WebSocket(this.url);

				this.ws.onopen = () => {
					clearTimeout(timeoutId);
					this.reconnectAttempts = 0;
					this.setState("connected");
					resolve();
				};

				this.ws.onerror = (event) => {
					clearTimeout(timeoutId);
					const error = BrowserdError.connectionFailed(
						`WebSocket error: ${event}`,
					);
					this.handleError(error);
					// Don't reject here - onclose will be called
				};

				this.ws.onclose = (event) => {
					clearTimeout(timeoutId);
					const wasConnected = this.state === "connected";
					this.ws = null;

					if (this.state === "connecting") {
						// Failed to connect initially
						const error = BrowserdError.connectionFailed(
							`Connection closed: ${event.code} ${event.reason}`,
						);
						this.setState("disconnected");
						reject(error);
					} else if (wasConnected && this.autoReconnect) {
						// Lost connection, try to reconnect
						this.attemptReconnect();
					} else {
						this.setState("disconnected");
					}
				};

				this.ws.onmessage = (event) => {
					this.handleMessage(event.data);
				};
			} catch (err) {
				clearTimeout(timeoutId);
				const error = BrowserdError.connectionFailed(
					err instanceof Error ? err.message : String(err),
					err instanceof Error ? err : undefined,
				);
				this.handleError(error);
				reject(error);
			}
		});

		try {
			await this.connectPromise;
		} finally {
			this.connectPromise = null;
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
	 * Send a message to the server
	 */
	send(message: ClientMessage): void {
		if (!this.ws || this.state !== "connected") {
			throw BrowserdError.notConnected();
		}
		this.ws.send(JSON.stringify(message));
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
	 * Cleanup WebSocket
	 */
	private cleanup(): void {
		if (this.ws) {
			// Remove handlers to prevent callbacks during close
			this.ws.onopen = null;
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.onmessage = null;

			if (
				this.ws.readyState === WebSocket.OPEN ||
				this.ws.readyState === WebSocket.CONNECTING
			) {
				this.ws.close();
			}
			this.ws = null;
		}
	}
}
