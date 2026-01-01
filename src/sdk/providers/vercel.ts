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
 * Supports two deployment modes:
 * 1. Remote blob storage (if blobBaseUrl provided) - downloads tarball via curl
 * 2. Local tarball (default) - uploads bundle/browserd.tar.gz via writeFiles
 */
export class VercelSandboxProvider implements SandboxProvider {
	readonly name = "vercel";

	private blobBaseUrl?: string;
	private runtime: string;
	private defaultTimeout: number;
	private headed: boolean;
	private sandboxes = new Map<string, SandboxEntry>();

	constructor(options: VercelSandboxProviderOptions = {}) {
		this.blobBaseUrl = options.blobBaseUrl?.replace(/\/$/, ""); // Remove trailing slash
		this.runtime = options.runtime ?? "node24";
		this.defaultTimeout = options.defaultTimeout ?? 300000; // 5 minutes
		// Default to headless mode since Vercel sandboxes don't have a display
		this.headed = options.headed ?? false;
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
		const wsUrl = `${domain.replace("https://", "wss://")}/ws`;

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
			// Deploy browserd to the sandbox
			await this.deployBrowserd(sandbox, port);

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
	 * Deploy browserd to the sandbox
	 *
	 * Two modes:
	 * 1. If blobBaseUrl is set, download tarball via curl
	 * 2. Otherwise, upload local bundle/browserd.tar.gz via writeFiles
	 *
	 * The tarball contains a bundled browserd.js file. We need to:
	 * 1. Extract and find browserd.js
	 * 2. Install rebrowser-playwright (external dependency)
	 * 3. Install Chromium browser
	 * 4. Run browserd.js with bun
	 */
	private async deployBrowserd(sandbox: Sandbox, port: number): Promise<void> {
		const browserdPath = "/tmp/browserd.js";
		const headless = this.headed ? "false" : "true";

		// Extract script: extract tarball, find browserd.js, move to known location
		const extractScript = `
			rm -rf /tmp/browserd-extract &&
			mkdir -p /tmp/browserd-extract &&
			tar xzf /tmp/browserd.tar.gz -C /tmp/browserd-extract &&
			find /tmp/browserd-extract -name 'browserd.js' -exec mv {} ${browserdPath} \\; &&
			rm -rf /tmp/browserd-extract /tmp/browserd.tar.gz
		`.replace(/\n\s*/g, " ").trim();

		if (this.blobBaseUrl) {
			// Mode 1: Download from blob storage
			const tarballUrl = `${this.blobBaseUrl}/browserd.tar.gz`;

			const downloadResult = await sandbox.runCommand("sh", [
				"-c",
				`curl -fsSL "${tarballUrl}" -o /tmp/browserd.tar.gz && ${extractScript}`,
			]);
			if (downloadResult.exitCode !== 0) {
				throw new Error(
					`Failed to download/extract tarball: exit ${downloadResult.exitCode}`,
				);
			}
		} else {
			// Mode 2: Upload local tarball via writeFiles
			const bundlePath = "bundle/browserd.tar.gz";
			const file = Bun.file(bundlePath);

			if (!(await file.exists())) {
				throw BrowserdError.providerError(
					`Bundle tarball not found at ${bundlePath}. Run 'bun run bundle' first, or provide blobBaseUrl option.`,
				);
			}

			const tarballData = Buffer.from(await file.arrayBuffer());

			// Upload tarball to sandbox
			await sandbox.writeFiles([
				{ path: "/tmp/browserd.tar.gz", content: tarballData },
			]);

			// Extract tarball
			const extractResult = await sandbox.runCommand("sh", ["-c", extractScript]);
			if (extractResult.exitCode !== 0) {
				throw new Error(`Failed to extract tarball: exit ${extractResult.exitCode}`);
			}
		}

		// Verify browserd.js was extracted
		const verifyResult = await sandbox.runCommand("sh", [
			"-c",
			`test -f ${browserdPath} && echo "ok"`,
		]);
		if (verifyResult.exitCode !== 0) {
			throw new Error("browserd.js not found after extraction");
		}

		// Environment setup matching Dockerfile.sandbox-node
		const home = "/home/vercel-sandbox";
		const envSetup = [
			`export HOME=${home}`,
			`export BUN_INSTALL=${home}/.bun`,
			`export PLAYWRIGHT_BROWSERS_PATH=${home}/.cache/playwright-browsers`,
			`export PATH=${home}/.bun/bin:${home}/.local/bin:$PATH`,
		].join(" && ");

		// Install Bun
		const bunResult = await sandbox.runCommand("sh", [
			"-c",
			`curl -fsSL https://bun.sh/install | bash 2>&1`,
		]);
		if (bunResult.exitCode !== 0) {
			const stdout = await bunResult.stdout();
			throw new Error(`Failed to install Bun: exit ${bunResult.exitCode}\n${stdout}`);
		}

		// Install system deps (dnf) and rebrowser-playwright + chromium in one command
		const setupResult = await sandbox.runCommand("sh", [
			"-c",
			`sudo dnf install -y nss nspr atk at-spi2-atk cups-libs libdrm libxkbcommon mesa-libgbm alsa-lib libXcomposite libXdamage libXfixes libXrandr pango cairo liberation-fonts mesa-libEGL gtk3 dbus-glib libXScrnSaver xorg-x11-server-Xvfb 2>&1 && ${envSetup} && mkdir -p ${home}/.cache && bun install -g rebrowser-playwright 2>&1 && bunx rebrowser-playwright-core install chromium 2>&1`,
		]);
		if (setupResult.exitCode !== 0) {
			const stdout = await setupResult.stdout();
			throw new Error(`Failed to setup browser: exit ${setupResult.exitCode}\n${stdout}`);
		}

		// Start browserd server in detached mode
		await sandbox.runCommand({
			cmd: "sh",
			args: [
				"-c",
				`${envSetup} && HEADLESS=${headless} PORT=${port} bun ${browserdPath} > /tmp/browserd.log 2>&1`,
			],
			detached: true,
		});
	}

	/**
	 * Wait for browserd to be ready by polling the health endpoint
	 *
	 * Note: Vercel's proxy returns 200 with empty body when no server is listening,
	 * so we must check the response body contains actual content.
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
					// Vercel returns 200 with empty body when no server is listening
					// Check that we actually got content back
					const text = await response.text();
					if (text && text.includes("ready")) {
						return true;
					}
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
