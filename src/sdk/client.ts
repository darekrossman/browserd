/**
 * Browserd Client
 *
 * Main SDK class for connecting to and controlling a remote browserd instance
 */

import type {
	CommandMessage,
	PlaywrightMethod,
	ServerMessage,
} from "../protocol/types";
import { isPongMessage, isResultMessage } from "../protocol/types";
import { BrowserdError } from "./errors";
import { CommandQueue } from "./internal/command-queue";
import { ConnectionManager } from "./internal/connection";
import { SSEConnectionManager } from "./internal/sse-connection";
import type {
	BrowserdClientOptions,
	ClickOptions,
	ConnectionState,
	ConnectionStateChange,
	EvaluateOptions,
	FillOptions,
	HoverOptions,
	NavigateOptions,
	NavigateResult,
	PressOptions,
	ScreenshotOptions,
	ScreenshotResult,
	TransportType,
	TypeOptions,
	WaitOptions,
} from "./types";

/**
 * Common interface for connection managers
 */
interface IConnectionManager {
	connect(): Promise<void>;
	close(): Promise<void>;
	send(message: unknown): void;
	isConnected(): boolean;
	getState(): ConnectionState;
	onMessage(handler: (message: ServerMessage) => void): () => void;
	onStateChange(handler: (change: ConnectionStateChange) => void): () => void;
	onError(handler: (error: Error) => void): () => void;
}

/**
 * Client for connecting to and controlling a remote browserd instance
 */
export class BrowserdClient {
	private connection: IConnectionManager;
	private commands: CommandQueue;
	private defaultTimeout: number;
	private pingHandlers: Array<(latency: number) => void> = [];
	private transport: TransportType;

	constructor(options: BrowserdClientOptions) {
		this.defaultTimeout = options.timeout ?? 30000;
		this.transport = options.transport ?? "ws";

		// Create appropriate connection manager based on transport
		if (this.transport === "sse") {
			this.connection = new SSEConnectionManager({
				url: options.url,
				timeout: options.timeout,
				autoReconnect: options.autoReconnect,
				reconnectInterval: options.reconnectInterval,
				maxReconnectAttempts: options.maxReconnectAttempts,
				authToken: options.authToken,
			});
		} else {
			this.connection = new ConnectionManager({
				url: options.url,
				timeout: options.timeout,
				autoReconnect: options.autoReconnect,
				reconnectInterval: options.reconnectInterval,
				maxReconnectAttempts: options.maxReconnectAttempts,
			});
		}

		this.commands = new CommandQueue({
			defaultTimeout: this.defaultTimeout,
		});

		// Route messages to appropriate handlers
		this.connection.onMessage((message) => this.handleMessage(message));

		// Cancel pending commands on disconnect
		this.connection.onStateChange((change) => {
			if (
				change.currentState === "disconnected" &&
				change.previousState === "connected"
			) {
				this.commands.cancelAll(
					new BrowserdError(
						"CONNECTION_CLOSED",
						"Connection closed while commands were pending",
					),
				);
			}
		});
	}

	/**
	 * Get the transport type being used
	 */
	getTransport(): TransportType {
		return this.transport;
	}

	// ============================================================================
	// Connection Lifecycle
	// ============================================================================

	/**
	 * Connect to the browserd server
	 */
	async connect(): Promise<void> {
		await this.connection.connect();
	}

	/**
	 * Close the connection
	 */
	async close(): Promise<void> {
		this.commands.cancelAll(
			new BrowserdError("CONNECTION_CLOSED", "Client closed"),
		);
		await this.connection.close();
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.connection.isConnected();
	}

	/**
	 * Get current connection state
	 */
	getConnectionState(): ConnectionState {
		return this.connection.getState();
	}

	/**
	 * Register a connection state change handler
	 */
	onConnectionStateChange(
		handler: (state: ConnectionState) => void,
	): () => void {
		return this.connection.onStateChange((change) => {
			handler(change.currentState);
		});
	}

	/**
	 * Register an error handler
	 */
	onError(handler: (error: Error) => void): () => void {
		return this.connection.onError(handler);
	}

	// ============================================================================
	// Navigation Commands
	// ============================================================================

	/**
	 * Navigate to a URL
	 */
	async navigate(
		url: string,
		options?: NavigateOptions,
	): Promise<NavigateResult> {
		return this.executeCommand<NavigateResult>("navigate", {
			url,
			waitUntil: options?.waitUntil,
			timeout: options?.timeout,
		});
	}

	/**
	 * Go back in browser history
	 */
	async goBack(): Promise<void> {
		await this.executeCommand("goBack");
	}

	/**
	 * Go forward in browser history
	 */
	async goForward(): Promise<void> {
		await this.executeCommand("goForward");
	}

	/**
	 * Reload the current page
	 */
	async reload(): Promise<void> {
		await this.executeCommand("reload");
	}

	// ============================================================================
	// Interaction Commands
	// ============================================================================

	/**
	 * Click on an element
	 */
	async click(selector: string, options?: ClickOptions): Promise<void> {
		await this.executeCommand(
			"click",
			{
				selector,
				button: options?.button,
				clickCount: options?.clickCount,
				delay: options?.delay,
			},
			options?.timeout,
		);
	}

	/**
	 * Double-click on an element
	 */
	async dblclick(selector: string, options?: ClickOptions): Promise<void> {
		await this.executeCommand(
			"dblclick",
			{
				selector,
				button: options?.button,
				delay: options?.delay,
			},
			options?.timeout,
		);
	}

	/**
	 * Hover over an element
	 */
	async hover(selector: string, options?: HoverOptions): Promise<void> {
		await this.executeCommand("hover", { selector }, options?.timeout);
	}

	/**
	 * Type text into the focused element
	 */
	async type(
		selector: string,
		text: string,
		options?: TypeOptions,
	): Promise<void> {
		await this.executeCommand(
			"type",
			{
				selector,
				text,
				delay: options?.delay,
			},
			options?.timeout,
		);
	}

	/**
	 * Fill an input element with text (clears existing content)
	 */
	async fill(
		selector: string,
		value: string,
		options?: FillOptions,
	): Promise<void> {
		await this.executeCommand(
			"fill",
			{
				selector,
				value,
			},
			options?.timeout,
		);
	}

	/**
	 * Press a key or key combination
	 */
	async press(key: string, options?: PressOptions): Promise<void> {
		await this.executeCommand(
			"press",
			{
				key,
				delay: options?.delay,
			},
			options?.timeout,
		);
	}

	// ============================================================================
	// Waiting Commands
	// ============================================================================

	/**
	 * Wait for a selector to appear
	 */
	async waitForSelector(
		selector: string,
		options?: WaitOptions,
	): Promise<void> {
		await this.executeCommand(
			"waitForSelector",
			{
				selector,
				state: options?.state,
				timeout: options?.timeout,
			},
			options?.timeout,
		);
	}

	// ============================================================================
	// Viewport Commands
	// ============================================================================

	/**
	 * Set the viewport size
	 */
	async setViewport(width: number, height: number): Promise<void> {
		await this.executeCommand("setViewport", { width, height });
	}

	// ============================================================================
	// Evaluation Commands
	// ============================================================================

	/**
	 * Evaluate JavaScript in the page context
	 */
	async evaluate<T = unknown>(
		expression: string,
		args?: unknown[],
		options?: EvaluateOptions,
	): Promise<T> {
		const response = await this.executeCommand<{ result: T }>(
			"evaluate",
			{
				expression,
				args,
			},
			options?.timeout,
		);
		return response.result;
	}

	// ============================================================================
	// Screenshot Commands
	// ============================================================================

	/**
	 * Take a screenshot of the page
	 */
	async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
		return this.executeCommand<ScreenshotResult>("screenshot", {
			fullPage: options?.fullPage,
			type: options?.type,
			quality: options?.quality,
		});
	}

	// ============================================================================
	// Ping/Latency
	// ============================================================================

	/**
	 * Send a ping to measure latency
	 */
	async ping(): Promise<number> {
		const sent = Date.now();
		this.connection.send({ type: "ping", t: sent });

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup();
				reject(BrowserdError.commandTimeout("ping", 5000));
			}, 5000);

			const handler = (latency: number) => {
				cleanup();
				resolve(latency);
			};

			const cleanup = () => {
				clearTimeout(timeout);
				const index = this.pingHandlers.indexOf(handler);
				if (index !== -1) {
					this.pingHandlers.splice(index, 1);
				}
			};

			this.pingHandlers.push(handler);
		});
	}

	// ============================================================================
	// Internal Methods
	// ============================================================================

	/**
	 * Execute a command and wait for result
	 */
	private async executeCommand<T = unknown>(
		method: PlaywrightMethod,
		params?: Record<string, unknown>,
		timeout?: number,
	): Promise<T> {
		if (!this.connection.isConnected()) {
			throw BrowserdError.notConnected();
		}

		const { id, promise } = this.commands.create<T>(method, timeout);

		const message: CommandMessage = {
			id,
			type: "cmd",
			method,
			params,
		};

		this.connection.send(message);

		return promise;
	}

	/**
	 * Handle incoming server message
	 */
	private handleMessage(message: ServerMessage): void {
		if (isResultMessage(message)) {
			this.commands.handleResult(message);
		} else if (isPongMessage(message)) {
			const latency = Date.now() - message.t;
			// Notify all pending ping handlers
			for (const handler of this.pingHandlers) {
				handler(latency);
			}
		}
		// Frame and event messages are not handled by the client
		// They could be exposed via event handlers if needed
	}
}
