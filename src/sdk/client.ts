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
import {
	isInterventionCompletedMessage,
	isInterventionCreatedMessage,
	isPongMessage,
	isResultMessage,
} from "../protocol/types";
import { BrowserdError } from "./errors";
import { CommandQueue } from "./internal/command-queue";
import { ConnectionManager } from "./internal/connection";
import { SSEConnectionManager } from "./internal/sse-connection";
import type {
	BrowserdClientOptions,
	ClickOptions,
	ConnectionState,
	ConnectionStateChange,
	CreateSessionOptions,
	EvaluateOptions,
	FillOptions,
	HoverOptions,
	InterventionOptions,
	InterventionResult,
	ListSessionsResponse,
	NavigateOptions,
	NavigateResult,
	PressOptions,
	ScreenshotOptions,
	ScreenshotResult,
	SessionInfo,
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
 * Pending intervention request
 */
interface PendingIntervention {
	resolve: (result: InterventionResult) => void;
	reject: (error: Error) => void;
	interventionId?: string;
	viewerUrl?: string;
	timeout?: ReturnType<typeof setTimeout>;
	reason: string;
	instructions: string;
	onCreated?: InterventionOptions["onCreated"];
}

/**
 * Client for connecting to and controlling a remote browserd instance
 */
export class BrowserdClient {
	private connection: IConnectionManager;
	private commands: CommandQueue;
	private defaultTimeout: number;
	private pingHandlers: Array<(latency: number) => void> = [];
	private pendingInterventions = new Map<string, PendingIntervention>();
	private transport: TransportType;
	private baseUrl: string;
	private options: BrowserdClientOptions;

	/** Session ID if this client is connected to a specific session */
	public readonly sessionId?: string;
	/** Session info if this client was created via createSession */
	public readonly sessionInfo?: SessionInfo;

	constructor(
		options: BrowserdClientOptions & {
			sessionId?: string;
			sessionInfo?: SessionInfo;
		},
	) {
		this.sessionId = options.sessionId;
		this.sessionInfo = options.sessionInfo;
		this.options = options;
		this.defaultTimeout = options.timeout ?? 30000;
		this.transport = options.transport ?? "ws";

		// Extract base URL for API calls
		this.baseUrl = this.extractBaseUrl(options.url);

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
	 * Close the connection and destroy the session
	 *
	 * If this client is connected to a specific session (has sessionId),
	 * this will also destroy the session on the server, freeing all resources.
	 */
	async close(): Promise<void> {
		this.commands.cancelAll(
			new BrowserdError("CONNECTION_CLOSED", "Client closed"),
		);
		await this.connection.close();

		// Destroy the session on the server if we have a sessionId
		if (this.sessionId) {
			try {
				await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}`, {
					method: "DELETE",
					headers: {
						...(this.options.authToken && {
							Authorization: `Bearer ${this.options.authToken}`,
						}),
					},
				});
			} catch {
				// Ignore errors - session may already be destroyed
			}
		}
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
	// Human Intervention (Human-in-the-Loop)
	// ============================================================================

	/**
	 * Request human intervention for the current session
	 *
	 * This method pauses browser automation and requests a human to take over.
	 * Use this when the agent encounters something it cannot automate, such as:
	 * - CAPTCHAs or verification challenges
	 * - Complex authentication flows
	 * - Content that requires human judgment
	 *
	 * The method will block until the human completes the intervention and
	 * clicks the "Mark Complete" button in the viewer.
	 *
	 * @param options - Intervention options
	 * @param options.reason - Why intervention is needed (e.g., "CAPTCHA detected")
	 * @param options.instructions - What the human should do
	 * @param options.timeout - Optional timeout in ms (default: no timeout)
	 *
	 * @returns The intervention result with viewer URL and completion time
	 *
	 * @example
	 * ```typescript
	 * // Request intervention when CAPTCHA detected
	 * const result = await client.requestIntervention({
	 *   reason: "CAPTCHA detected on login page",
	 *   instructions: "Please solve the CAPTCHA and click 'Mark Complete' when done",
	 * });
	 * console.log(`Human completed at: ${result.resolvedAt}`);
	 * ```
	 */
	async requestIntervention(
		options: InterventionOptions,
	): Promise<InterventionResult> {
		if (!this.connection.isConnected()) {
			throw BrowserdError.notConnected();
		}

		const id = `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		return new Promise<InterventionResult>((resolve, reject) => {
			const pending: PendingIntervention = {
				resolve,
				reject,
				reason: options.reason,
				instructions: options.instructions,
				onCreated: options.onCreated,
			};

			// Set up timeout if specified
			if (options.timeout) {
				pending.timeout = setTimeout(() => {
					this.pendingInterventions.delete(id);
					reject(
						new BrowserdError(
							"COMMAND_TIMEOUT",
							`Intervention request timed out after ${options.timeout}ms`,
						),
					);
				}, options.timeout);
			}

			this.pendingInterventions.set(id, pending);

			// Send the intervention request
			// Note: We use "requestIntervention" as the method, which the server
			// handles specially (not a Playwright command)
			const message = {
				id,
				type: "cmd" as const,
				method: "requestIntervention",
				params: {
					reason: options.reason,
					instructions: options.instructions,
				},
			};

			this.connection.send(message);
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
		} else if (isInterventionCreatedMessage(message)) {
			// Store intervention info for the pending request
			const pending = this.pendingInterventions.get(message.id);
			if (pending) {
				pending.interventionId = message.interventionId;
				pending.viewerUrl = message.viewerUrl;
				// Call the onCreated callback if provided (for notifications)
				if (pending.onCreated) {
					try {
						const result = pending.onCreated({
							interventionId: message.interventionId,
							viewerUrl: message.viewerUrl,
							reason: pending.reason,
							instructions: pending.instructions,
						});
						// Handle async callbacks (don't block)
						if (result instanceof Promise) {
							result.catch((err) =>
								console.error("[browserd] onCreated callback error:", err),
							);
						}
					} catch (err) {
						console.error("[browserd] onCreated callback error:", err);
					}
				}
				// Don't resolve yet - wait for intervention_completed
			}
		} else if (isInterventionCompletedMessage(message)) {
			// Resolve the pending intervention request
			const pending = this.pendingInterventions.get(message.id);
			if (pending) {
				if (pending.timeout) {
					clearTimeout(pending.timeout);
				}
				this.pendingInterventions.delete(message.id);
				pending.resolve({
					interventionId: message.interventionId,
					viewerUrl: pending.viewerUrl ?? "",
					resolvedAt: new Date(message.resolvedAt),
				});
			}
		}
		// Frame and event messages are not handled by the client
		// They could be exposed via event handlers if needed
	}

	/**
	 * Extract base URL from connection URL
	 */
	private extractBaseUrl(url: string): string {
		// Handle WebSocket URLs
		if (url.startsWith("ws://") || url.startsWith("wss://")) {
			const httpUrl = url.replace(/^ws/, "http");
			// Remove session-specific paths first (longer pattern), then simple /ws
			return httpUrl.replace(/\/sessions\/[^/]+\/ws$/, "").replace(/\/ws$/, "");
		}
		// Handle HTTP URLs (for SSE transport)
		// Remove session-specific paths first (longer pattern), then simple /stream
		return url
			.replace(/\/sessions\/[^/]+\/stream$/, "")
			.replace(/\/stream$/, "");
	}

	// ============================================================================
	// Session Management
	// ============================================================================

	/**
	 * Create a new browser session
	 *
	 * Sessions provide isolated browser contexts with separate cookies, storage,
	 * and page state. Use this when you need multiple independent browser instances.
	 *
	 * @example
	 * ```typescript
	 * const session = await client.createSession({
	 *   viewport: { width: 1920, height: 1080 }
	 * });
	 * const sessionClient = await client.getSessionClient(session.id);
	 * await sessionClient.connect();
	 * await sessionClient.navigate("https://example.com");
	 * ```
	 */
	async createSession(options?: CreateSessionOptions): Promise<SessionInfo> {
		const response = await fetch(`${this.baseUrl}/api/sessions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.options.authToken && {
					Authorization: `Bearer ${this.options.authToken}`,
				}),
			},
			body: JSON.stringify(options ?? {}),
		});

		if (!response.ok) {
			const error = (await response
				.json()
				.catch(() => ({ error: "Unknown error" }))) as { error?: string };
			throw new BrowserdError(
				"SESSION_ERROR",
				error.error || `Failed to create session: ${response.status}`,
			);
		}

		return response.json() as Promise<SessionInfo>;
	}

	/**
	 * List all active sessions
	 */
	async listSessions(): Promise<ListSessionsResponse> {
		const response = await fetch(`${this.baseUrl}/api/sessions`, {
			headers: {
				...(this.options.authToken && {
					Authorization: `Bearer ${this.options.authToken}`,
				}),
			},
		});

		if (!response.ok) {
			throw new BrowserdError(
				"SESSION_ERROR",
				`Failed to list sessions: ${response.status}`,
			);
		}

		return response.json() as Promise<ListSessionsResponse>;
	}

	/**
	 * Get information about a specific session
	 */
	async getSession(sessionId: string): Promise<SessionInfo> {
		const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, {
			headers: {
				...(this.options.authToken && {
					Authorization: `Bearer ${this.options.authToken}`,
				}),
			},
		});

		if (!response.ok) {
			if (response.status === 404) {
				throw new BrowserdError(
					"SESSION_NOT_FOUND",
					`Session ${sessionId} not found`,
				);
			}
			throw new BrowserdError(
				"SESSION_ERROR",
				`Failed to get session: ${response.status}`,
			);
		}

		return response.json() as Promise<SessionInfo>;
	}

	/**
	 * Destroy a session
	 *
	 * This closes the browser context and disconnects all clients.
	 */
	async destroySession(sessionId: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, {
			method: "DELETE",
			headers: {
				...(this.options.authToken && {
					Authorization: `Bearer ${this.options.authToken}`,
				}),
			},
		});

		if (!response.ok) {
			if (response.status === 404) {
				throw new BrowserdError(
					"SESSION_NOT_FOUND",
					`Session ${sessionId} not found`,
				);
			}
			throw new BrowserdError(
				"SESSION_ERROR",
				`Failed to destroy session: ${response.status}`,
			);
		}
	}

	/**
	 * Get a client connected to a specific session
	 *
	 * Creates a new BrowserdClient instance configured to connect to the
	 * specified session's WebSocket endpoint.
	 *
	 * @example
	 * ```typescript
	 * const session = await client.createSession();
	 * const sessionClient = await client.getSessionClient(session.id);
	 * await sessionClient.connect();
	 * await sessionClient.navigate("https://example.com");
	 * ```
	 */
	async getSessionClient(sessionId: string): Promise<BrowserdClient> {
		// Get session info to get the correct URLs
		const session = await this.getSession(sessionId);

		// Create new client with session-specific URL
		const sessionUrl =
			this.transport === "sse" ? session.streamUrl : session.wsUrl;

		return new BrowserdClient({
			...this.options,
			url: sessionUrl,
			transport: this.transport,
		});
	}

	/**
	 * Get the base URL for API calls
	 */
	getBaseUrl(): string {
		return this.baseUrl;
	}
}
