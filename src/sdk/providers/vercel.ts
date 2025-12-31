/**
 * Vercel Sandbox Provider
 *
 * Drop-in provider for provisioning browserd instances on Vercel Sandboxes.
 * Can be swapped for other providers (Docker, AWS, etc.) without changing SDK usage.
 *
 * Requires @vercel/sandbox to be installed:
 *   bun add @vercel/sandbox
 */

import { Sandbox } from "@vercel/sandbox";
import { BrowserdError } from "../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../types";
import type { SandboxProvider, VercelSandboxProviderOptions } from "./types";

interface SandboxEntry {
	sandbox: Sandbox;
	info: SandboxInfo;
	port: number;
}

/**
 * Vercel Sandbox Provider implementation
 *
 * Provisions browserd instances on Vercel's managed sandbox infrastructure.
 */
export class VercelSandboxProvider implements SandboxProvider {
	readonly name = "vercel";

	private blobBaseUrl: string;
	private runtime: string;
	private defaultTimeout: number;
	private sandboxes = new Map<string, SandboxEntry>();

	constructor(options: VercelSandboxProviderOptions) {
		this.blobBaseUrl = options.blobBaseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.runtime = options.runtime ?? "node24";
		this.defaultTimeout = options.defaultTimeout ?? 300000; // 5 minutes
	}

	/**
	 * Create a new sandbox with browserd running
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const port = options?.port ?? 3000;
		const timeout = options?.timeout ?? this.defaultTimeout;

		let sandbox: Sandbox;

		try {
			// Create the Vercel sandbox
			sandbox = await Sandbox.create({
				resources: {
					vcpus: options?.resources?.vcpus ?? 4,
				},
				ports: [port],
				runtime: this.runtime,
				timeout,
			});
		} catch (err) {
			throw BrowserdError.sandboxCreationFailed(
				`Failed to create Vercel sandbox: ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}

		const sandboxId = sandbox.sandboxId;
		const domain = sandbox.domain(port);
		const wsUrl = domain.replace("https://", "wss://") + "/ws";

		// Create initial sandbox info
		const info: SandboxInfo = {
			id: sandboxId,
			domain,
			wsUrl,
			status: "creating",
			createdAt: Date.now(),
		};

		this.sandboxes.set(sandboxId, { sandbox, info, port });

		try {
			// Run the install script to set up browserd
			const installScript = `${this.blobBaseUrl}/install.sh`;
			const tarballUrl = `${this.blobBaseUrl}/browserd.tar.gz`;

			const installResult = await sandbox.runCommand(
				"sh",
				[
					"-c",
					`curl -fsSL "${installScript}" | TARBALL_URL="${tarballUrl}" PORT="${port}" sh`,
				],
			);

			if (installResult.exitCode !== 0) {
				throw new Error(
					`Install script failed with exit code ${installResult.exitCode}: ${installResult.stderr}`,
				);
			}

			// Wait for browserd to be ready
			const ready = await this.waitForReady(sandboxId, domain, port, 60000);
			if (!ready) {
				throw new Error("browserd server did not become ready within timeout");
			}

			// Update status to ready
			info.status = "ready";

			return { ...info };
		} catch (err) {
			// Cleanup on failure
			await this.destroy(sandboxId).catch(() => {});
			throw BrowserdError.sandboxCreationFailed(
				`Failed to initialize browserd in sandbox: ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Destroy a sandbox
	 */
	async destroy(sandboxId: string): Promise<void> {
		const entry = this.sandboxes.get(sandboxId);
		if (!entry) {
			return; // Already destroyed or never existed
		}

		try {
			await entry.sandbox.stop();
		} catch {
			// Ignore close errors
		} finally {
			entry.info.status = "destroyed";
			this.sandboxes.delete(sandboxId);
		}
	}

	/**
	 * Check if a sandbox is ready
	 */
	async isReady(sandboxId: string): Promise<boolean> {
		const entry = this.sandboxes.get(sandboxId);
		if (!entry) {
			return false;
		}

		return entry.info.status === "ready";
	}

	/**
	 * Get sandbox information
	 */
	async get(sandboxId: string): Promise<SandboxInfo | undefined> {
		const entry = this.sandboxes.get(sandboxId);
		if (!entry) {
			return undefined;
		}

		return { ...entry.info };
	}

	/**
	 * Wait for browserd to be ready by polling the health endpoint
	 */
	private async waitForReady(
		sandboxId: string,
		domain: string,
		_port: number,
		timeout: number,
	): Promise<boolean> {
		const healthUrl = `${domain}/readyz`;
		const deadline = Date.now() + timeout;
		const pollInterval = 1000;

		while (Date.now() < deadline) {
			try {
				const response = await fetch(healthUrl, {
					method: "GET",
					signal: AbortSignal.timeout(5000),
				});

				if (response.ok) {
					return true;
				}
			} catch {
				// Server not ready yet
			}

			// Check if sandbox was destroyed while waiting
			const entry = this.sandboxes.get(sandboxId);
			if (!entry || entry.info.status === "destroyed") {
				return false;
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
