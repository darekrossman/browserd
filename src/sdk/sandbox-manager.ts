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
	SandboxInfo,
} from "./types";

export interface SandboxManagerOptions {
	/** The sandbox provider to use */
	provider: SandboxProvider;
	/** Default options for BrowserdClient connections */
	clientOptions?: Partial<Omit<BrowserdClientOptions, "url">>;
}

/**
 * Manages sandbox lifecycle and client connections
 *
 * This is the main entry point for provisioning new sandboxes with browserd.
 * It abstracts the provider-specific logic and handles client lifecycle.
 */
export class SandboxManager {
	private provider: SandboxProvider;
	private clientOptions: Partial<Omit<BrowserdClientOptions, "url">>;
	private sandboxes = new Map<string, SandboxInfo>();
	private clients = new Map<string, BrowserdClient>();

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
	 * Create a new sandbox with browserd and connect a client
	 *
	 * @param options - Sandbox creation options
	 * @returns Connected client and sandbox information
	 */
	async create(options?: CreateSandboxOptions): Promise<CreateSandboxResult> {
		// Create the sandbox via provider
		const sandbox = await this.provider.create(options);

		// Track the sandbox
		this.sandboxes.set(sandbox.id, sandbox);

		// Create and connect client with appropriate transport
		const client = new BrowserdClient({
			url: sandbox.wsUrl,
			transport: sandbox.transport ?? "ws",
			authToken: sandbox.authToken,
			...this.clientOptions,
		});

		try {
			await client.connect();
		} catch (err) {
			// Cleanup sandbox on connection failure
			await this.provider.destroy(sandbox.id).catch(() => {});
			this.sandboxes.delete(sandbox.id);

			throw BrowserdError.connectionFailed(
				`Failed to connect to sandbox ${sandbox.id}: ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}

		// Track the client
		this.clients.set(sandbox.id, client);

		return { client, sandbox };
	}

	/**
	 * Destroy a sandbox and close its client
	 *
	 * @param sandboxId - ID of the sandbox to destroy
	 */
	async destroy(sandboxId: string): Promise<void> {
		// Close the client first
		const client = this.clients.get(sandboxId);
		if (client) {
			await client.close().catch(() => {});
			this.clients.delete(sandboxId);
		}

		// Destroy the sandbox
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
		return this.sandboxes.get(sandboxId);
	}

	/**
	 * Get the client for a sandbox
	 *
	 * @param sandboxId - ID of the sandbox
	 * @returns BrowserdClient or undefined if not found
	 */
	getClient(sandboxId: string): BrowserdClient | undefined {
		return this.clients.get(sandboxId);
	}

	/**
	 * List all managed sandboxes
	 *
	 * @returns Array of sandbox information
	 */
	list(): SandboxInfo[] {
		return Array.from(this.sandboxes.values());
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
