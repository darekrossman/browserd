/**
 * Local Provider
 *
 * Simple provider for connecting to a locally running browserd server.
 * Designed for local development where the browserd server is started
 * manually (e.g., via `bun run dev`).
 *
 * Unlike DockerContainerProvider, this provider does not manage any
 * infrastructure - it simply connects to an already running server.
 */

import { BrowserdError } from "../../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../../types";
import type { SandboxProvider, SandboxProviderOptions } from "../types";

/**
 * Options for Local Provider
 *
 * Simple provider for connecting to a locally running browserd server.
 */
export interface LocalProviderOptions extends SandboxProviderOptions {
	/** Host to connect to (default: 'localhost') */
	host?: string;
	/** Port to connect to (default: 3000) */
	port?: number;
	/** Timeout for ready check in ms (default: 5000) */
	readyTimeout?: number;
}

/**
 * Local Provider implementation
 *
 * Connects to a locally running browserd server for development.
 * The server must be started externally (e.g., `bun run dev`).
 *
 * @example
 * ```typescript
 * // Start browserd server first: bun run dev
 *
 * const provider = new LocalProvider();
 * const sandbox = await provider.create();
 * // sandbox.wsUrl = "ws://localhost:3000/ws"
 * ```
 */
export class LocalProvider implements SandboxProvider {
	readonly name = "local";

	private host: string;
	private port: number;
	private readyTimeout: number;
	private sandbox: SandboxInfo | null = null;

	constructor(options: LocalProviderOptions = {}) {
		this.host = options.host ?? "localhost";
		this.port = options.port ?? 3000;
		this.readyTimeout = options.readyTimeout ?? 5000;
	}

	/**
	 * Create a sandbox connection to the local browserd server
	 *
	 * Verifies the server is running by checking the /readyz endpoint
	 * before returning connection information.
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const timeout = options?.timeout ?? this.readyTimeout;
		const sandboxId = `local-${Date.now()}`;

		// Build connection URLs
		const domain = `http://${this.host}:${this.port}`;
		const wsUrl = `ws://${this.host}:${this.port}/ws`;

		// Create sandbox info
		const info: SandboxInfo = {
			id: sandboxId,
			domain,
			wsUrl,
			status: "creating",
			createdAt: Date.now(),
		};

		// Verify server is running
		const ready = await this.waitForReady(timeout);
		if (!ready) {
			throw BrowserdError.providerError(
				`Local browserd server not responding at ${domain}/readyz. ` +
					`Make sure the server is running (e.g., 'bun run dev').`,
			);
		}

		info.status = "ready";
		this.sandbox = info;
		return { ...info };
	}

	/**
	 * Destroy the sandbox connection
	 *
	 * This is a no-op since the local server lifecycle is managed externally.
	 * The server continues running after this call.
	 */
	async destroy(_sandboxId: string): Promise<void> {
		this.sandbox = null;
		// No-op - local server lifecycle managed externally
	}

	/**
	 * Check if the local server is ready
	 */
	async isReady(_sandboxId: string): Promise<boolean> {
		return this.checkHealth();
	}

	/**
	 * Get sandbox information
	 */
	async get(_sandboxId: string): Promise<SandboxInfo | undefined> {
		if (!this.sandbox) {
			return undefined;
		}
		return { ...this.sandbox };
	}

	/**
	 * Check server health by hitting the /readyz endpoint
	 */
	private async checkHealth(): Promise<boolean> {
		const healthUrl = `http://${this.host}:${this.port}/readyz`;
		try {
			const response = await fetch(healthUrl, {
				method: "GET",
				signal: AbortSignal.timeout(2000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Wait for the local server to be ready
	 */
	private async waitForReady(timeout: number): Promise<boolean> {
		const deadline = Date.now() + timeout;
		const pollInterval = 200;

		while (Date.now() < deadline) {
			if (await this.checkHealth()) {
				return true;
			}
			await sleep(pollInterval);
		}

		return false;
	}
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
