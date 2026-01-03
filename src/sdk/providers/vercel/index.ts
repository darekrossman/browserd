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
import { BrowserdError } from "../../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../../types";
import type { SandboxProvider, SandboxProviderOptions } from "../types";

interface SandboxEntry {
	sandbox: Sandbox;
	info: SandboxInfo;
	port: number;
}

/**
 * Options for Vercel Sandbox Provider
 */
export interface VercelSandboxProviderOptions extends SandboxProviderOptions {
	/**
	 * Base URL for blob storage where browserd.tar.gz is stored (optional)
	 *
	 * If not provided, the provider will use the local bundle/browserd.tar.gz
	 * file and deploy it via writeFiles.
	 */
	blobBaseUrl?: string;
	/** Vercel sandbox runtime (default: "node24") */
	runtime?: string;
	/** Run browser in headed mode (default: false - headless) */
	headed?: boolean;
	/**
	 * Existing sandbox ID to reuse (optional)
	 *
	 * If provided, the provider will attempt to connect to this sandbox
	 * instead of creating a new one. If the sandbox is not running or
	 * browserd is not healthy, behavior depends on devMode.
	 */
	sandboxId?: string;
	/**
	 * Development mode for quick iteration (default: false)
	 *
	 * When true and sandboxId is provided:
	 * - Skips system dependency installation (assumes already installed)
	 * - Kills any running browserd process
	 * - Re-uploads and starts browserd with latest bundle
	 *
	 * This allows rapid testing of browserd changes without full reprovisioning.
	 */
	devMode?: boolean;
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
	private existingSandboxId?: string;
	private devMode: boolean;
	private sandboxes = new Map<string, SandboxEntry>();

	constructor(options: VercelSandboxProviderOptions = {}) {
		this.blobBaseUrl = options.blobBaseUrl?.replace(/\/$/, ""); // Remove trailing slash
		this.runtime = options.runtime ?? "node24";
		this.defaultTimeout = options.defaultTimeout ?? 300000; // 5 minutes
		// Default to headless mode since Vercel sandboxes don't have a display
		this.headed = options.headed ?? false;
		this.existingSandboxId = options.sandboxId;
		this.devMode = options.devMode ?? false;
	}

	/**
	 * Create a new sandbox with browserd running, or reuse an existing one
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const port = options?.port ?? 3000;
		const timeout = options?.timeout ?? this.defaultTimeout;

		console.log(`[vercel] create() called, port=${port}, timeout=${timeout}`);

		// Try to reuse existing sandbox if sandboxId was provided
		if (this.existingSandboxId) {
			console.log(
				`[vercel] attempting to reuse existing sandbox: ${this.existingSandboxId}`,
			);
			const existing = await this.tryReuseExistingSandbox(
				this.existingSandboxId,
				port,
				timeout,
			);
			if (existing) {
				console.log(`[vercel] successfully reused sandbox: ${existing.id}`);
				return existing;
			}
			// Existing sandbox not usable, fall through to create new one
			console.log(`[vercel] existing sandbox not usable, creating new one`);
		}

		let sandbox: Sandbox;

		try {
			// Create the Vercel sandbox
			console.log(`[vercel] creating new sandbox...`);
			sandbox = await Sandbox.create({
				resources: {
					vcpus: options?.resources?.vcpus ?? 4,
				},
				ports: [port],
				runtime: this.runtime,
				timeout,
			});
			console.log(`[vercel] sandbox created: ${sandbox.sandboxId}`);
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
			// Deploy browserd to the sandbox (full setup)
			console.log(`[vercel] deploying browserd to new sandbox...`);
			await this.deployBrowserd(sandbox, port, false);

			// Wait for browserd to be ready
			console.log(`[vercel] waiting for browserd to be ready...`);
			const ready = await this.waitForReady(sandboxId, domain, port, 60000);
			if (!ready) {
				throw new Error("browserd server did not become ready within timeout");
			}

			// Update status to ready
			info.status = "ready";
			console.log(`[vercel] sandbox ready: ${sandboxId}`);

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
	 * Try to reuse an existing sandbox
	 *
	 * @returns SandboxInfo if sandbox was reused, null if should create new
	 */
	private async tryReuseExistingSandbox(
		sandboxId: string,
		port: number,
		_timeout: number,
	): Promise<SandboxInfo | null> {
		let sandbox: Sandbox;

		console.log(`[vercel] tryReuseExistingSandbox: ${sandboxId}`);

		try {
			sandbox = await Sandbox.get({ sandboxId });
			console.log(
				`[vercel] found sandbox: ${sandbox.sandboxId}, status: ${sandbox.status}`,
			);
		} catch (err) {
			// Sandbox doesn't exist or can't connect
			console.log(
				`[vercel] sandbox not found: ${err instanceof Error ? err.message : String(err)}`,
			);
			return null;
		}

		// Check if sandbox is running
		if (sandbox.status !== "running") {
			console.log(`[vercel] sandbox not running, status: ${sandbox.status}`);
			return null;
		}

		const domain = sandbox.domain(port);
		const wsUrl = `${domain.replace("https://", "wss://")}/ws`;

		const info: SandboxInfo = {
			id: sandboxId,
			domain,
			wsUrl,
			status: "creating",
			createdAt: Date.now(),
		};

		this.sandboxes.set(sandboxId, { sandbox, info, port });

		// Check if browserd is already running and healthy
		console.log(`[vercel] checking if browserd is healthy...`);
		const browserdHealthy = await this.checkBrowserdHealth(domain);
		console.log(`[vercel] browserd healthy: ${browserdHealthy}`);

		if (browserdHealthy && !this.devMode) {
			// Browserd is running and healthy, reuse as-is
			console.log(`[vercel] browserd healthy, reusing sandbox as-is`);
			info.status = "ready";
			return { ...info };
		}

		if (this.devMode) {
			console.log(`[vercel] dev mode: redeploying browserd...`);
			// Dev mode: kill existing browserd, redeploy bundle, restart
			try {
				await this.redeployBrowserdDevMode(sandbox, port);

				const ready = await this.waitForReady(sandboxId, domain, port, 30000);
				if (!ready) {
					throw new Error(
						"browserd did not become ready after dev mode redeploy",
					);
				}

				info.status = "ready";
				return { ...info };
			} catch (err) {
				throw BrowserdError.sandboxCreationFailed(
					`Dev mode redeploy failed: ${err instanceof Error ? err.message : String(err)}`,
					err instanceof Error ? err : undefined,
				);
			}
		}

		// Sandbox exists but browserd not healthy, and not in dev mode
		// Check if deps are installed before deciding to skip
		const depsInstalled = await this.checkDepsInstalled(sandbox);
		console.log(
			`deploying browserd to existing sandbox (depsInstalled: ${depsInstalled})`,
		);
		await this.deployBrowserd(sandbox, port, depsInstalled);

		const ready = await this.waitForReady(sandboxId, domain, port, 60000);
		if (!ready) {
			throw BrowserdError.sandboxCreationFailed(
				`browserd did not become ready on existing sandbox ${sandboxId}`,
			);
		}

		info.status = "ready";
		return { ...info };
	}

	/**
	 * Check if required dependencies (bun, chromium) are installed in the sandbox
	 */
	private async checkDepsInstalled(sandbox: Sandbox): Promise<boolean> {
		const home = "/home/vercel-sandbox";
		console.log(`[vercel] checking if deps are installed...`);

		// Check if bun exists
		const bunCheck = await sandbox.runCommand("sh", [
			"-c",
			`test -f ${home}/.bun/bin/bun && echo "ok"`,
		]);
		if (bunCheck.exitCode !== 0) {
			console.log(`[vercel] bun not found`);
			return false;
		}
		console.log(`[vercel] bun found`);

		// Check if chromium is installed via playwright
		const chromiumCheck = await sandbox.runCommand("sh", [
			"-c",
			`ls ${home}/.cache/playwright-browsers/chromium-* 2>/dev/null | head -1`,
		]);
		if (chromiumCheck.exitCode !== 0) {
			console.log(`[vercel] chromium check failed`);
			return false;
		}
		const chromiumPath = (await chromiumCheck.stdout()).trim();
		if (!chromiumPath) {
			console.log(`[vercel] chromium not found`);
			return false;
		}
		console.log(`[vercel] chromium found: ${chromiumPath}`);

		return true;
	}

	/**
	 * Check if browserd is running and healthy on the given domain
	 */
	private async checkBrowserdHealth(domain: string): Promise<boolean> {
		try {
			const response = await fetch(`${domain}/readyz`, {
				method: "GET",
				signal: AbortSignal.timeout(5000),
			});
			if (response.ok) {
				const text = await response.text();
				return text.includes("ready");
			}
		} catch {
			// Not healthy
		}
		return false;
	}

	/**
	 * Redeploy browserd in dev mode (skip deps, just redeploy bundle)
	 */
	private async redeployBrowserdDevMode(
		sandbox: Sandbox,
		port: number,
	): Promise<void> {
		const browserdPath = "/tmp/browserd.js";
		const headless = this.headed ? "false" : "true";

		// Environment setup
		const home = "/home/vercel-sandbox";
		const envSetup = [
			`export HOME=${home}`,
			`export BUN_INSTALL=${home}/.bun`,
			`export PLAYWRIGHT_BROWSERS_PATH=${home}/.cache/playwright-browsers`,
			`export PATH=${home}/.bun/bin:${home}/.local/bin:$PATH`,
		].join(" && ");

		// Kill existing browserd process
		await sandbox.runCommand("sh", ["-c", "pkill -f 'bun.*browserd' || true"]);

		// Wait a moment for process to die
		await sleep(500);

		// Deploy the bundle (same logic as deployBrowserd but without deps)
		await this.uploadAndExtractBundle(sandbox, browserdPath);

		// Start browserd
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
	 * Upload and extract the browserd bundle to the sandbox
	 */
	private async uploadAndExtractBundle(
		sandbox: Sandbox,
		browserdPath: string,
	): Promise<void> {
		// Extract script: extract tarball, find browserd.js, move to known location
		const extractScript = `
			rm -rf /tmp/browserd-extract &&
			mkdir -p /tmp/browserd-extract &&
			tar xzf /tmp/browserd.tar.gz -C /tmp/browserd-extract &&
			find /tmp/browserd-extract -name 'browserd.js' -exec mv {} ${browserdPath} \\; &&
			rm -rf /tmp/browserd-extract /tmp/browserd.tar.gz
		`
			.replace(/\n\s*/g, " ")
			.trim();

		if (this.blobBaseUrl) {
			// Download from blob storage
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
			// Upload local tarball via writeFiles
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
			const extractResult = await sandbox.runCommand("sh", [
				"-c",
				extractScript,
			]);
			if (extractResult.exitCode !== 0) {
				throw new Error(
					`Failed to extract tarball: exit ${extractResult.exitCode}`,
				);
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
	}

	/**
	 * Deploy browserd to the sandbox
	 *
	 * @param sandbox - The Vercel sandbox instance
	 * @param port - Port to run browserd on
	 * @param skipDeps - If true, skip installing system deps (for reusing existing sandbox)
	 */
	private async deployBrowserd(
		sandbox: Sandbox,
		port: number,
		skipDeps: boolean,
	): Promise<void> {
		const browserdPath = "/tmp/browserd.js";
		const headless = this.headed ? "false" : "true";

		console.log(
			`[vercel] deployBrowserd: skipDeps=${skipDeps}, headless=${headless}`,
		);

		// Upload and extract the bundle
		console.log(`[vercel] uploading and extracting bundle...`);
		await this.uploadAndExtractBundle(sandbox, browserdPath);
		console.log(`[vercel] bundle extracted to ${browserdPath}`);

		// Environment setup matching Dockerfile.sandbox-node
		const home = "/home/vercel-sandbox";
		const envSetup = [
			`export HOME=${home}`,
			`export BUN_INSTALL=${home}/.bun`,
			`export PLAYWRIGHT_BROWSERS_PATH=${home}/.cache/playwright-browsers`,
			`export PATH=${home}/.bun/bin:${home}/.local/bin:$PATH`,
		].join(" && ");

		if (!skipDeps) {
			// Install Bun
			console.log(`[vercel] installing bun...`);
			const bunResult = await sandbox.runCommand("sh", [
				"-c",
				`curl -fsSL https://bun.sh/install | bash 2>&1`,
			]);
			if (bunResult.exitCode !== 0) {
				const stdout = await bunResult.stdout();
				throw new Error(
					`Failed to install Bun: exit ${bunResult.exitCode}\n${stdout}`,
				);
			}
			console.log(`[vercel] bun installed`);

			// Install system deps (dnf) and rebrowser-playwright + chromium in one command
			console.log(
				`[vercel] installing system deps and chromium (this takes ~30s)...`,
			);
			const setupResult = await sandbox.runCommand("sh", [
				"-c",
				`sudo dnf install -y nss nspr atk at-spi2-atk cups-libs libdrm libxkbcommon mesa-libgbm alsa-lib libXcomposite libXdamage libXfixes libXrandr pango cairo liberation-fonts mesa-libEGL gtk3 dbus-glib libXScrnSaver xorg-x11-server-Xvfb 2>&1 && ${envSetup} && mkdir -p ${home}/.cache && bun install -g rebrowser-playwright 2>&1 && bunx rebrowser-playwright-core install chromium 2>&1`,
			]);
			if (setupResult.exitCode !== 0) {
				const stdout = await setupResult.stdout();
				throw new Error(
					`Failed to setup browser: exit ${setupResult.exitCode}\n${stdout}`,
				);
			}
			console.log(`[vercel] system deps and chromium installed`);
		} else {
			console.log(`[vercel] skipping deps installation (already installed)`);
		}

		// Start browserd server in detached mode
		console.log(`[vercel] starting browserd server on port ${port}...`);
		await sandbox.runCommand({
			cmd: "sh",
			args: [
				"-c",
				`${envSetup} && HEADLESS=${headless} PORT=${port} bun ${browserdPath} > /tmp/browserd.log 2>&1`,
			],
			detached: true,
		});
		console.log(`[vercel] browserd server started (detached)`);
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
		let attempts = 0;

		console.log(
			`[vercel] waitForReady: polling ${healthUrl} (timeout: ${timeout}ms)`,
		);

		while (Date.now() < deadline) {
			attempts++;
			try {
				const response = await fetch(healthUrl, {
					method: "GET",
					signal: AbortSignal.timeout(5000),
				});

				if (response.ok) {
					// Vercel returns 200 with empty body when no server is listening
					// Check that we actually got content back
					const text = await response.text();
					if (text?.includes("ready")) {
						console.log(`[vercel] browserd ready after ${attempts} attempts`);
						return true;
					}
					if (attempts % 5 === 0) {
						console.log(
							`[vercel] health check attempt ${attempts}: 200 but empty/not ready`,
						);
					}
				} else if (attempts % 5 === 0) {
					console.log(
						`[vercel] health check attempt ${attempts}: status ${response.status}`,
					);
				}
			} catch (err) {
				// Server not ready yet
				if (attempts % 5 === 0) {
					console.log(
						`[vercel] health check attempt ${attempts}: ${err instanceof Error ? err.message : "error"}`,
					);
				}
			}

			// Check if sandbox was destroyed while waiting
			const entry = this.sandboxes.get(sandboxId);
			if (!entry || entry.info.status === "destroyed") {
				console.log(`[vercel] sandbox destroyed while waiting`);
				return false;
			}

			await sleep(pollInterval);
		}

		console.log(`[vercel] waitForReady timed out after ${attempts} attempts`);
		return false;
	}
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
