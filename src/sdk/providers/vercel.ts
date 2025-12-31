/**
 * Vercel Sandbox Provider
 *
 * Drop-in provider for provisioning browserd instances on Vercel Sandboxes.
 * Can be swapped for other providers (Docker, AWS, etc.) without changing SDK usage.
 *
 * Requires @vercel/sandbox to be installed:
 *   bun add @vercel/sandbox
 */

import { BrowserdError } from "../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../types";
import type { SandboxProvider, VercelSandboxProviderOptions } from "./types";

/**
 * Type definitions for @vercel/sandbox
 * These are defined here to avoid requiring the package at compile time.
 * The package is loaded dynamically at runtime.
 */
interface VercelSandbox {
	id: string;
	getHost(): string;
	runCommand(options: { cmd: string; args: string[] }): Promise<{
		exitCode: number;
		stdout: string;
		stderr: string;
	}>;
	close(): Promise<void>;
}

interface VercelSandboxCreateOptions {
	resources?: {
		vcpus?: number;
	};
	ports?: number[];
	runtime?: string;
	timeout?: number;
}

interface SandboxModule {
	Sandbox: {
		create(options?: VercelSandboxCreateOptions): Promise<VercelSandbox>;
	};
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
	private sandboxes = new Map<
		string,
		{ sandbox: VercelSandbox; info: SandboxInfo }
	>();
	private SandboxClass: SandboxModule["Sandbox"] | null = null;

	constructor(options: VercelSandboxProviderOptions) {
		this.blobBaseUrl = options.blobBaseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.runtime = options.runtime ?? "node24";
		this.defaultTimeout = options.defaultTimeout ?? 300000; // 5 minutes
	}

	/**
	 * Lazily load @vercel/sandbox module
	 *
	 * Uses dynamic import to avoid compile-time dependency on @vercel/sandbox.
	 * The package must be installed at runtime when using VercelSandboxProvider.
	 */
	private async getSandboxClass(): Promise<SandboxModule["Sandbox"]> {
		if (this.SandboxClass) {
			return this.SandboxClass;
		}

		try {
			// Use a variable to prevent TypeScript from checking the import
			const moduleName = "@vercel/sandbox";
			const module = (await import(
				/* @vite-ignore */ moduleName
			)) as SandboxModule;
			this.SandboxClass = module.Sandbox;
			return this.SandboxClass;
		} catch (err) {
			throw BrowserdError.providerError(
				"Failed to load @vercel/sandbox. Make sure it is installed: bun add @vercel/sandbox",
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Create a new sandbox with browserd running
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const Sandbox = await this.getSandboxClass();

		const port = options?.port ?? 3000;
		const timeout = options?.timeout ?? this.defaultTimeout;

		let sandbox: VercelSandbox;

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

		const sandboxId = sandbox.id;
		const domain = `https://${sandbox.getHost()}`;
		const wsUrl = `wss://${sandbox.getHost()}/ws`;

		// Create initial sandbox info
		const info: SandboxInfo = {
			id: sandboxId,
			domain,
			wsUrl,
			status: "creating",
			createdAt: Date.now(),
		};

		this.sandboxes.set(sandboxId, { sandbox, info });

		try {
			// Run the install script to set up browserd
			const installScript = `${this.blobBaseUrl}/install.sh`;
			const tarballUrl = `${this.blobBaseUrl}/browserd.tar.gz`;

			const installResult = await sandbox.runCommand({
				cmd: "sh",
				args: [
					"-c",
					`curl -fsSL "${installScript}" | TARBALL_URL="${tarballUrl}" PORT="${port}" sh`,
				],
			});

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
			await entry.sandbox.close();
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
