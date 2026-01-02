/**
 * Sandbox Manager
 *
 * Provider-agnostic manager for creating and managing browserd sandboxes.
 * Uses a pluggable SandboxProvider to handle infrastructure specifics.
 */

import { BrowserdClient } from "./client";
import { BrowserdError } from "./errors";
import type { SandboxProvider } from "./providers/types";
import type {
	BrowserdClientOptions,
	CreateSandboxOptions,
	CreateSandboxResult,
	CreateSessionOptions,
	ListSessionsResponse,
	SandboxInfo,
	SessionInfo,
	TransportType,
} from "./types";

export interface SandboxManagerOptions {
	/** The sandbox provider to use */
	provider: SandboxProvider;
	/** Default options for BrowserdClient connections */
	clientOptions?: Partial<Omit<BrowserdClientOptions, "url">>;
}

/**
 * Internal state for a managed sandbox
 */
interface ManagedSandbox {
	sandbox: SandboxInfo;
	baseUrl: string;
	transport: TransportType;
	/** Connected clients per session */
	clients: Map<string, BrowserdClient>;
}

/**
 * Manages sandbox lifecycle and session management
 *
 * This is the main entry point for provisioning new sandboxes with browserd.
 * It abstracts the provider-specific logic and provides session management.
 */
export class SandboxManager {
	private provider: SandboxProvider;
	private clientOptions: Partial<Omit<BrowserdClientOptions, "url">>;
	private sandboxes = new Map<string, ManagedSandbox>();

	constructor(options: SandboxManagerOptions) {
		this.provider = options.provider;
		this.clientOptions = options.clientOptions ?? {};
	}

	/**
	 * Get the provider name
	 */
	get providerName(): string {
		return this.provider.name;
	}

	/**
	 * Create a new sandbox with browserd
	 *
	 * Returns session management methods for creating and managing browser sessions.
	 *
	 * @param options - Sandbox creation options
	 * @returns Session management methods and sandbox information
	 *
	 * @example
	 * ```typescript
	 * const { sandbox, createSession, getSessionClient } = await manager.create();
	 *
	 * // Create a browser session
	 * const session = await createSession({ viewport: { width: 1920, height: 1080 } });
	 *
	 * // Get a connected client for that session
	 * const browser = await getSessionClient(session.id);
	 * await browser.connect();
	 *
	 * // Use the browser
	 * await browser.navigate("https://example.com");
	 * ```
	 */
	async create(options?: CreateSandboxOptions): Promise<CreateSandboxResult> {
		// Create the sandbox via provider
		const sandbox = await this.provider.create(options);

		// Determine the base URL for API calls
		const transport = sandbox.transport ?? "ws";

		// Extract base URL from wsUrl or streamUrl
		let baseUrl: string;
		if (sandbox.streamUrl) {
			// Remove /stream suffix if present
			baseUrl = sandbox.streamUrl.replace(/\/stream$/, "");
		} else {
			// Convert ws:// to http:// and remove /ws suffix
			baseUrl = sandbox.wsUrl
				.replace(/^ws:/, "http:")
				.replace(/^wss:/, "https:")
				.replace(/\/ws$/, "");
		}

		// Track the sandbox
		this.sandboxes.set(sandbox.id, {
			sandbox,
			baseUrl,
			transport,
			clients: new Map(),
		});

		// Create bound session management methods
		const createSession = (sessionOptions?: CreateSessionOptions) =>
			this.createSession(sandbox.id, sessionOptions);
		const listSessions = () => this.listSessions(sandbox.id);
		const getSession = (sessionId: string) =>
			this.getSession(sandbox.id, sessionId);
		const getSessionInfo = (sessionId: string) =>
			this.getSessionInfo(sandbox.id, sessionId);
		const destroySession = (sessionId: string) =>
			this.destroySession(sandbox.id, sessionId);

		return {
			sandbox,
			createSession,
			listSessions,
			getSession,
			getSessionInfo,
			destroySession,
		};
	}

	/**
	 * Create a new browser session on a sandbox and return a connected client
	 */
	private async createSession(
		sandboxId: string,
		options?: CreateSessionOptions,
	): Promise<BrowserdClient> {
		const managed = this.sandboxes.get(sandboxId);
		if (!managed) {
			throw new BrowserdError(
				"SANDBOX_NOT_FOUND",
				`Sandbox ${sandboxId} not found`,
			);
		}

		// Retry logic for transient proxy errors (502, 503, 504)
		const maxRetries = 3;
		const retryDelay = 1000;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			const response = await fetch(`${managed.baseUrl}/api/sessions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(managed.sandbox.authToken && {
						Authorization: `Bearer ${managed.sandbox.authToken}`,
					}),
				},
				body: JSON.stringify(options ?? {}),
			});

			if (response.ok) {
				const sessionInfo: SessionInfo = await response.json();
				return this.setupSessionClient(managed, sessionInfo);
			}

			// Check for retryable errors (proxy/gateway issues)
			if ([502, 503, 504].includes(response.status) && attempt < maxRetries) {
				lastError = new Error(
					`HTTP ${response.status}: ${response.statusText}`,
				);
				await new Promise((r) => setTimeout(r, retryDelay * attempt));
				continue;
			}

			// Non-retryable error or last attempt
			const error = await response
				.json()
				.catch(() => ({ error: "Unknown error" }));
			throw new BrowserdError(
				"SESSION_ERROR",
				error.error || `Failed to create session: ${response.status}`,
			);
		}

		throw new BrowserdError(
			"SESSION_ERROR",
			`Failed to create session after ${maxRetries} attempts: ${lastError?.message}`,
		);
	}

	/**
	 * Set up a connected client for a session
	 */
	private async setupSessionClient(
		managed: ManagedSandbox,
		sessionInfo: SessionInfo,
	): Promise<BrowserdClient> {
		// Fix URLs to use sandbox's external base URL (server returns localhost URLs)
		const wsBase = managed.baseUrl.replace(/^http/, "ws");
		sessionInfo.wsUrl = `${wsBase}/sessions/${sessionInfo.id}/ws`;
		sessionInfo.streamUrl = `${managed.baseUrl}/sessions/${sessionInfo.id}/stream`;
		sessionInfo.inputUrl = `${managed.baseUrl}/sessions/${sessionInfo.id}/input`;
		sessionInfo.viewerUrl = `${managed.baseUrl}/sessions/${sessionInfo.id}/viewer`;

		const sessionUrl =
			managed.transport === "sse" ? sessionInfo.streamUrl : sessionInfo.wsUrl;

		const client = new BrowserdClient({
			url: sessionUrl,
			transport: managed.transport,
			authToken: managed.sandbox.authToken,
			sessionId: sessionInfo.id,
			sessionInfo,
			...this.clientOptions,
		});

		await client.connect();

		// Cache the connected client
		managed.clients.set(sessionInfo.id, client);

		return client;
	}

	/**
	 * List all sessions on a sandbox
	 */
	private async listSessions(sandboxId: string): Promise<ListSessionsResponse> {
		const managed = this.sandboxes.get(sandboxId);
		if (!managed) {
			throw new BrowserdError(
				"SANDBOX_NOT_FOUND",
				`Sandbox ${sandboxId} not found`,
			);
		}

		const response = await fetch(`${managed.baseUrl}/api/sessions`, {
			headers: {
				...(managed.sandbox.authToken && {
					Authorization: `Bearer ${managed.sandbox.authToken}`,
				}),
			},
		});

		if (!response.ok) {
			throw new BrowserdError(
				"SESSION_ERROR",
				`Failed to list sessions: ${response.status}`,
			);
		}

		return response.json();
	}

	/**
	 * Get a connected client for a session (cached or creates new connection)
	 */
	private async getSession(
		sandboxId: string,
		sessionId: string,
	): Promise<BrowserdClient> {
		const managed = this.sandboxes.get(sandboxId);
		if (!managed) {
			throw new BrowserdError(
				"SANDBOX_NOT_FOUND",
				`Sandbox ${sandboxId} not found`,
			);
		}

		// Return cached client if available and connected
		const cached = managed.clients.get(sessionId);
		if (cached?.isConnected()) {
			return cached;
		}

		// Get session info and create new connected client
		const sessionInfo = await this.getSessionInfo(sandboxId, sessionId);
		return this.setupSessionClient(managed, sessionInfo);
	}

	/**
	 * Get information about a specific session without connecting
	 */
	private async getSessionInfo(
		sandboxId: string,
		sessionId: string,
	): Promise<SessionInfo> {
		const managed = this.sandboxes.get(sandboxId);
		if (!managed) {
			throw new BrowserdError(
				"SANDBOX_NOT_FOUND",
				`Sandbox ${sandboxId} not found`,
			);
		}

		const response = await fetch(
			`${managed.baseUrl}/api/sessions/${sessionId}`,
			{
				headers: {
					...(managed.sandbox.authToken && {
						Authorization: `Bearer ${managed.sandbox.authToken}`,
					}),
				},
			},
		);

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

		return response.json();
	}

	/**
	 * Destroy a session on a sandbox
	 *
	 * Note: If you have a client reference, calling `client.close()` is preferred
	 * as it handles both disconnection and session destruction.
	 * This method is useful when you need to destroy a session without a client reference.
	 */
	private async destroySession(
		sandboxId: string,
		sessionId: string,
	): Promise<void> {
		const managed = this.sandboxes.get(sandboxId);
		if (!managed) {
			throw new BrowserdError(
				"SANDBOX_NOT_FOUND",
				`Sandbox ${sandboxId} not found`,
			);
		}

		// Remove from cache (don't call close() to avoid double API call)
		managed.clients.delete(sessionId);

		const response = await fetch(
			`${managed.baseUrl}/api/sessions/${sessionId}`,
			{
				method: "DELETE",
				headers: {
					...(managed.sandbox.authToken && {
						Authorization: `Bearer ${managed.sandbox.authToken}`,
					}),
				},
			},
		);

		if (!response.ok) {
			if (response.status === 404) {
				// Session already destroyed (likely via client.close())
				return;
			}
			throw new BrowserdError(
				"SESSION_ERROR",
				`Failed to destroy session: ${response.status}`,
			);
		}
	}

	/**
	 * Destroy a sandbox
	 *
	 * @param sandboxId - ID of the sandbox to destroy
	 */
	async destroy(sandboxId: string): Promise<void> {
		const managed = this.sandboxes.get(sandboxId);
		if (managed) {
			// Close all cached session clients
			for (const client of managed.clients.values()) {
				await client.close().catch(() => {});
			}
			managed.clients.clear();
		}

		// Destroy the sandbox via provider
		await this.provider.destroy(sandboxId);
		this.sandboxes.delete(sandboxId);
	}

	/**
	 * Destroy all managed sandboxes
	 */
	async destroyAll(): Promise<void> {
		const ids = Array.from(this.sandboxes.keys());
		await Promise.all(ids.map((id) => this.destroy(id).catch(() => {})));
	}

	/**
	 * Get sandbox information
	 *
	 * @param sandboxId - ID of the sandbox
	 * @returns Sandbox information or undefined if not found
	 */
	get(sandboxId: string): SandboxInfo | undefined {
		return this.sandboxes.get(sandboxId)?.sandbox;
	}

	/**
	 * List all managed sandboxes
	 *
	 * @returns Array of sandbox information
	 */
	list(): SandboxInfo[] {
		return Array.from(this.sandboxes.values()).map((m) => m.sandbox);
	}

	/**
	 * Get the number of managed sandboxes
	 */
	get size(): number {
		return this.sandboxes.size;
	}

	/**
	 * Check if a sandbox is managed
	 *
	 * @param sandboxId - ID of the sandbox
	 */
	has(sandboxId: string): boolean {
		return this.sandboxes.has(sandboxId);
	}
}
