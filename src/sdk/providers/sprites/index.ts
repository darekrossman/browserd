/**
 * Sprites.dev Provider
 *
 * Provider for running browserd on sprites.dev infrastructure.
 * Supports both creating new sprites and reusing existing ones.
 *
 * Features:
 * - Auto-setup: Installs system deps and Chromium if missing
 * - Checkpoints: Can restore from and create checkpoints
 * - Services: Uses sprite services for persistent browserd process
 * - Headed mode: Xvfb support for visual browser rendering
 * - Local proxy: SSH tunnel for WebSocket connectivity
 *
 * Requires @fly/sprites to be installed:
 *   bun add @fly/sprites
 *
 * IMPORTANT: The sprite URL HTTPS proxy does NOT support WebSocket.
 * For WebSocket connectivity (required for browser control), you must
 * either enable useLocalProxy (default) or manage port forwarding yourself.
 */

import { type Sprite, SpritesClient } from "@fly/sprites";
import { type Subprocess, spawn } from "bun";
import { BrowserdError } from "../../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../../types";
import type { SandboxProvider, SandboxProviderOptions } from "../types";

/**
 * Extended Sprite type that includes the `url` property from the API response.
 * The SDK merges API response data into the Sprite instance but doesn't type it.
 */
interface SpriteWithUrl extends Sprite {
	url?: string;
}

interface SpriteEntry {
	sprite: SpriteWithUrl;
	info: SandboxInfo;
	createdByUs: boolean;
	proxyProcess?: Subprocess<"ignore", "pipe", "pipe">;
	localProxyPort?: number;
}

/**
 * Options for Sprites.dev Provider
 */
export interface SpritesSandboxProviderOptions extends SandboxProviderOptions {
	/** API token (defaults to SPRITE_TOKEN env var) */
	token?: string;
	/** Organization name (optional) */
	org?: string;
	/** Existing sprite name to reuse (optional - creates new if not provided) */
	spriteName?: string;
	/** Checkpoint ID to restore from before starting (optional) */
	checkpointId?: string;
	/** Auto-install system deps if missing (default: true) */
	autoSetup?: boolean;
	/** Create checkpoint after setup (default: true) */
	createCheckpointAfterSetup?: boolean;
	/** Run browser in headed mode with Xvfb (default: true) */
	headed?: boolean;
	/** Timeout for ready check in ms (default: 120000 for cold start) */
	readyTimeout?: number;
	/** Enable debug logging (default: false) */
	debug?: boolean;
	/** Base URL for blob storage where browserd.tar.gz is stored (optional) */
	blobBaseUrl?: string;
	/**
	 * Use local SSH tunnel for WebSocket connectivity (default: true)
	 *
	 * The sprite URL HTTPS proxy doesn't support WebSocket connections.
	 * When enabled, spawns `sprite proxy` to create an SSH tunnel for
	 * WebSocket access. The wsUrl will use localhost with the proxy port.
	 *
	 * Set to false if you only need HTTP access or handle proxy separately.
	 */
	useLocalProxy?: boolean;
	/**
	 * Local port for the proxy tunnel (default: auto-assigned)
	 *
	 * Only used when useLocalProxy is true. If not specified,
	 * a random available port will be used.
	 */
	localProxyPort?: number;
	/**
	 * Auto-install the sprite CLI if not found (default: false)
	 *
	 * When enabled, automatically downloads and installs the sprite CLI
	 * from https://sprites.dev/install.sh if it's not already installed.
	 *
	 * Note: Authentication still requires manual `sprite login` which
	 * opens a browser for OAuth.
	 */
	autoInstallCli?: boolean;
}

/**
 * Sprites.dev Provider implementation
 *
 * Provisions browserd instances on sprites.dev managed infrastructure.
 *
 * IMPORTANT: WebSocket connectivity requires the `sprite` CLI for port forwarding.
 * The sprite HTTPS URL proxy does not support WebSocket connections.
 *
 * @example Check dependencies before use
 * ```typescript
 * const { available, message } = await SpritesSandboxProvider.checkDependencies();
 * if (!available) {
 *   console.error(message);
 * }
 * ```
 */
export class SpritesSandboxProvider implements SandboxProvider {
	readonly name = "sprites";

	private token: string;
	private org?: string;
	private spriteName?: string;
	private checkpointId?: string;
	private autoSetup: boolean;
	private createCheckpointAfterSetup: boolean;
	private headed: boolean;
	private readyTimeout: number;
	private defaultTimeout: number;
	private debug: boolean;
	private blobBaseUrl?: string;
	private useLocalProxy: boolean;
	private localProxyPort?: number;
	private autoInstallCli: boolean;

	private sprites = new Map<string, SpriteEntry>();
	private client: SpritesClient | null = null;
	private static cliAvailable: boolean | null = null;

	constructor(options: SpritesSandboxProviderOptions = {}) {
		this.token = options.token ?? process.env.SPRITE_TOKEN ?? "";
		this.org = options.org;
		this.spriteName = options.spriteName;
		this.checkpointId = options.checkpointId;
		this.autoSetup = options.autoSetup ?? true;
		this.createCheckpointAfterSetup =
			options.createCheckpointAfterSetup ?? true;
		this.headed = options.headed ?? true;
		this.readyTimeout = options.readyTimeout ?? 120000;
		this.defaultTimeout = options.defaultTimeout ?? 300000;
		this.debug = options.debug ?? false;
		this.blobBaseUrl = options.blobBaseUrl;
		this.useLocalProxy = options.useLocalProxy ?? false;
		this.localProxyPort = options.localProxyPort;
		this.autoInstallCli = options.autoInstallCli ?? false;
	}

	/** Check if all dependencies are available */
	static async checkDependencies(): Promise<{
		available: boolean;
		message: string;
	}> {
		if (!(await SpritesSandboxProvider.isCliInstalled()))
			return { available: false, message: "sprite CLI not installed" };
		if (!(await SpritesSandboxProvider.isCliAuthenticated()))
			return { available: false, message: "sprite CLI not authenticated" };
		return { available: true, message: "OK" };
	}

	/** Check if sprite CLI is installed */
	static async isCliInstalled(): Promise<boolean> {
		if (SpritesSandboxProvider.cliAvailable !== null)
			return SpritesSandboxProvider.cliAvailable;
		try {
			const result = Bun.spawnSync(["sprite", "--version"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			SpritesSandboxProvider.cliAvailable = result.exitCode === 0;
			return SpritesSandboxProvider.cliAvailable;
		} catch {
			SpritesSandboxProvider.cliAvailable = false;
			return false;
		}
	}

	/** Check if sprite CLI is authenticated (via SPRITE_TOKEN or interactive login) */
	static async isCliAuthenticated(): Promise<boolean> {
		if (process.env.SPRITE_TOKEN) return true;
		try {
			return (
				Bun.spawnSync(["sprite", "list"], { stdout: "pipe", stderr: "pipe" })
					.exitCode === 0
			);
		} catch {
			return false;
		}
	}

	/** Install the sprite CLI from sprites.dev */
	static async installCli(): Promise<{
		success: boolean;
		message: string;
		output?: string;
	}> {
		try {
			const result = Bun.spawnSync(
				["sh", "-c", "curl -fsSL https://sprites.dev/install.sh | sh"],
				{
					stdout: "pipe",
					stderr: "pipe",
					env: {
						...process.env,
						PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
					},
				},
			);

			const output = result.stdout.toString() + result.stderr.toString();
			if (result.exitCode !== 0) {
				return {
					success: false,
					message: `Installation failed (exit ${result.exitCode})`,
					output,
				};
			}

			SpritesSandboxProvider.cliAvailable = null;
			if (!(await SpritesSandboxProvider.isCliInstalled())) {
				return {
					success: false,
					message: "CLI not found in PATH. Add ~/.local/bin to PATH.",
					output,
				};
			}

			return {
				success: true,
				message: 'CLI installed. Run "sprite login" or set SPRITE_TOKEN.',
				output,
			};
		} catch (err) {
			return {
				success: false,
				message: `Installation error: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	private log(message: string, startTime?: number): void {
		if (!this.debug) return;
		const elapsed = startTime ? ` [${Date.now() - startTime}ms]` : "";
		console.log(`[SpritesProvider]${elapsed} ${message}`);
	}

	/**
	 * Create a new sandbox with browserd running
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const createStart = Date.now();
		this.log("create() started");

		// Check CLI availability upfront if local proxy is needed
		if (this.useLocalProxy) {
			// Auto-install CLI if enabled and not installed
			if (
				this.autoInstallCli &&
				!(await SpritesSandboxProvider.isCliInstalled())
			) {
				const installResult = await SpritesSandboxProvider.installCli();
				if (!installResult.success) {
					throw BrowserdError.providerError(
						`Failed to auto-install sprite CLI: ${installResult.message}\n\nSee https://docs.sprites.dev`,
					);
				}
			}

			const deps = await SpritesSandboxProvider.checkDependencies();
			if (!deps.available) {
				throw BrowserdError.providerError(
					`${deps.message}\n\nSee https://docs.sprites.dev`,
				);
			}
		}

		const timeout = options?.timeout ?? this.defaultTimeout;
		if (!this.token) {
			throw BrowserdError.providerError(
				"Sprites API token required. Set SPRITE_TOKEN env var or pass token option.",
			);
		}
		this.client ??= new SpritesClient(this.token);
		const client = this.client;

		// Get or create sprite
		const { sprite, createdByUs } = await this.getOrCreateSprite(client);

		// Get sprite URL (available via Object.assign from API response)
		const spriteUrl = sprite.url;
		if (!spriteUrl) {
			throw BrowserdError.providerError(
				"Sprite URL not available. This may be an API issue.",
			);
		}

		const sandboxId = sprite.id ?? sprite.name;

		// Create initial sandbox info
		// Note: transport will be set to 'sse' if useLocalProxy is false,
		// since sprite URL HTTPS proxy doesn't support WebSocket
		const info: SandboxInfo = {
			id: sandboxId,
			domain: spriteUrl,
			wsUrl: `${spriteUrl.replace("https://", "wss://")}/ws`,
			streamUrl: `${spriteUrl}/stream`,
			status: "creating",
			createdAt: Date.now(),
			transport: this.useLocalProxy ? "ws" : "sse",
			// Include auth token for SSE mode (required for sprites.dev proxy)
			authToken: this.useLocalProxy ? undefined : this.token,
		};

		this.sprites.set(sandboxId, { sprite, info, createdByUs });

		try {
			// Restore checkpoint if specified
			if (this.checkpointId) {
				await sprite.restoreCheckpoint(this.checkpointId).then((r) => r.text());
			}

			// Auto-setup if enabled
			if (this.autoSetup) {
				await this.ensureSetup(sprite);
			}

			// Deploy and start browserd
			await this.deployAndStartBrowserd(sprite);

			// Wait for browserd to be ready
			const ready = await this.waitForReady(
				sandboxId,
				Math.min(this.readyTimeout, timeout),
			);
			if (!ready) {
				throw new Error("browserd server did not become ready within timeout");
			}

			// Start local proxy for WebSocket access if enabled
			const entry = this.sprites.get(sandboxId)!;
			if (this.useLocalProxy) {
				const proxyPort = await this.startLocalProxy(sprite.name, entry);
				info.wsUrl = `ws://localhost:${proxyPort}/ws`;
			} else {
				// SSE mode: make URL public so users can access the viewer
				await this.makeUrlPublic(sprite.name);

				// Wait for external connectivity to be ready
				// The sprites.dev proxy may take a moment to route traffic after making URL public
				const externalReady = await this.waitForExternalReady(
					spriteUrl,
					Math.min(30000, timeout),
				);
				if (!externalReady) {
					throw new Error(
						"External connectivity to browserd not ready. The sprites.dev proxy may not be routing traffic correctly.",
					);
				}
			}

			// Update status to ready
			info.status = "ready";
			this.log("create() completed", createStart);
			return { ...info };
		} catch (err) {
			// Cleanup on failure
			await this.destroy(sandboxId).catch(() => {});
			throw BrowserdError.sandboxCreationFailed(
				`Failed to start browserd on sprite: ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Destroy a sandbox
	 */
	async destroy(sandboxId: string): Promise<void> {
		const entry = this.sprites.get(sandboxId);
		if (!entry) return;

		try {
			if (entry.proxyProcess) {
				entry.proxyProcess.kill();
				entry.proxyProcess = undefined;
			}
			await this.stopBrowserdService(entry.sprite);
		} catch {
			// Ignore cleanup errors
		} finally {
			entry.info.status = "destroyed";
			this.sprites.delete(sandboxId);
		}
	}

	/**
	 * Check if a sandbox is ready
	 */
	async isReady(sandboxId: string): Promise<boolean> {
		const entry = this.sprites.get(sandboxId);
		if (!entry) {
			return false;
		}
		return entry.info.status === "ready";
	}

	/**
	 * Get sandbox information
	 */
	async get(sandboxId: string): Promise<SandboxInfo | undefined> {
		const entry = this.sprites.get(sandboxId);
		if (!entry) {
			return undefined;
		}
		return { ...entry.info };
	}

	/**
	 * Start local proxy for WebSocket access
	 *
	 * Spawns `sprite proxy` command to create an SSH tunnel to the sprite.
	 * This is necessary because the sprite URL HTTPS proxy doesn't support WebSocket.
	 */
	private async startLocalProxy(
		spriteName: string,
		entry: SpriteEntry,
	): Promise<number> {
		// Determine port - use configured or find available
		let port = this.localProxyPort;
		if (!port) {
			const server = Bun.serve({ port: 0, fetch: () => new Response() });
			port = server.port ?? 3001;
			server.stop();
		}

		// Spawn sprite proxy command
		// Format: sprite proxy -s <sprite-name> <local>:<remote>
		// We map local port to remote 3000 (browserd)
		const proxyProcess = spawn(
			["sprite", "proxy", "-s", spriteName, `${port}:3000`],
			{
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		// Store in entry for cleanup
		entry.proxyProcess = proxyProcess;
		entry.localProxyPort = port;

		// Wait for proxy to be ready by checking if we can connect
		const ready = await this.waitForProxyReady(port, 10000);
		if (!ready) {
			// Try to get stderr for more info
			let stderrText = "";
			try {
				const stderr = proxyProcess.stderr;
				const reader = stderr.getReader();
				const { value } = await reader.read();
				if (value) {
					stderrText = new TextDecoder().decode(value);
				}
				reader.releaseLock();
			} catch {
				// Ignore errors reading stderr
			}
			proxyProcess.kill();

			const errorDetails = stderrText ? `\nProxy stderr: ${stderrText}` : "";
			throw BrowserdError.providerError(
				`Local proxy failed to connect to sprite '${spriteName}' on port ${port}.${errorDetails}\n\n` +
					"Possible causes:\n" +
					"- The sprite may be hibernating (first request wakes it)\n" +
					"- Network connectivity issues\n" +
					"- The browserd service may not be running on the sprite\n\n" +
					"Try manually: sprite proxy -s " +
					spriteName +
					" " +
					port +
					":3000",
			);
		}

		return port;
	}

	/**
	 * Get existing sprite or create a new one
	 */
	private async getOrCreateSprite(
		client: SpritesClient,
	): Promise<{ sprite: SpriteWithUrl; createdByUs: boolean }> {
		const name =
			this.spriteName ??
			`browserd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		// Try to get existing sprite if name was provided
		if (this.spriteName) {
			const existing = (await client
				.getSprite(name)
				.catch(() => null)) as SpriteWithUrl | null;
			if (existing?.url) return { sprite: existing, createdByUs: false };
		}

		// Create new sprite
		try {
			await client.createSprite(name);
			const sprite = await this.waitForSpriteReady(client, name, 30000);
			return { sprite, createdByUs: true };
		} catch (err) {
			throw BrowserdError.sandboxCreationFailed(
				`Failed to create sprite '${name}': ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Wait for a newly created sprite to be ready and have a URL
	 */
	private async waitForSpriteReady(
		client: SpritesClient,
		name: string,
		timeout: number,
	): Promise<SpriteWithUrl> {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const sprite = (await client
				.getSprite(name)
				.catch(() => null)) as SpriteWithUrl | null;
			if (sprite?.url) return sprite;
			await sleep(1000);
		}
		throw new Error(
			`Sprite '${name}' did not become ready within ${timeout}ms`,
		);
	}

	/**
	 * Wait for local proxy to be ready
	 */
	private async waitForProxyReady(
		port: number,
		timeout: number,
	): Promise<boolean> {
		const deadline = Date.now() + timeout;
		const pollInterval = 200;

		while (Date.now() < deadline) {
			try {
				// Try to connect to the proxy health endpoint
				const response = await fetch(`http://localhost:${port}/health`, {
					method: "GET",
					signal: AbortSignal.timeout(1000),
				});
				if (response.ok) {
					return true;
				}
			} catch {
				// Not ready yet
			}
			await sleep(pollInterval);
		}

		return false;
	}

	/**
	 * Wait for external connectivity to browserd via sprites.dev proxy
	 * This verifies we can reach the health endpoint from outside the sprite
	 */
	private async waitForExternalReady(
		spriteUrl: string,
		timeout: number,
	): Promise<boolean> {
		const deadline = Date.now() + timeout;
		const pollInterval = 1000;
		const healthUrl = `${spriteUrl}/health`;

		this.log(`Waiting for external connectivity at ${healthUrl}...`);

		while (Date.now() < deadline) {
			try {
				const response = await fetch(healthUrl, {
					method: "GET",
					headers: this.token
						? { Authorization: `Bearer ${this.token}` }
						: undefined,
					signal: AbortSignal.timeout(5000),
				});

				if (response.ok) {
					const data = (await response.json().catch(() => ({}))) as {
						status?: string;
						browser?: { ready?: boolean };
					};
					if (data.status === "healthy" || data.browser?.ready) {
						this.log("External connectivity verified");
						return true;
					}
				}

				// Log non-success responses for debugging
				if (this.debug && response.status !== 502) {
					this.log(`Health check returned ${response.status}`);
				}
			} catch (err) {
				// Log errors for debugging (but not every iteration)
				if (this.debug && Date.now() > deadline - timeout + 5000) {
					this.log(
						`Health check error: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
			await sleep(pollInterval);
		}

		return false;
	}

	/**
	 * Ensure sprite has all required dependencies
	 */
	private async ensureSetup(sprite: SpriteWithUrl): Promise<void> {
		// Check if Chromium is installed
		const checkResult = await this.exec(
			sprite,
			"ls -d $HOME/.cache/ms-playwright/chromium-* 2>/dev/null && echo exists",
			true,
		).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }));

		if (!checkResult.stdout.includes("exists")) {
			this.log("Installing system dependencies and Chromium...");
			await this.installDeps(sprite);

			// Create checkpoint after setup if enabled
			if (this.createCheckpointAfterSetup) {
				try {
					const response = await sprite.createCheckpoint("browserd-deps-ready");
					await response.text();
				} catch {
					// Non-fatal - checkpoint creation can fail
				}
			}
		}
	}

	/**
	 * Execute a command on the sprite. Use loginShell=true for commands needing PATH.
	 */
	private async exec(
		sprite: SpriteWithUrl,
		command: string,
		loginShell = false,
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const result = await sprite.execFile("bash", [
			loginShell ? "-lc" : "-c",
			command,
		]);
		return {
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
			exitCode: result.exitCode,
		};
	}

	/**
	 * Stop the browserd service on a sprite
	 */
	private async stopBrowserdService(sprite: SpriteWithUrl): Promise<void> {
		// Delete the service via API (browserd will cleanup Xvfb and Chromium on SIGTERM)
		await this.exec(
			sprite,
			"sprite-env curl -X DELETE /v1/services/browserd 2>/dev/null || true",
		).catch(() => {});

		// Give browserd time to cleanup child processes
		await sleep(1000);

		// Safety net: kill any orphaned processes that may have escaped cleanup
		await this.exec(
			sprite,
			"pkill -9 -f 'browserd.js|Xvfb|chromium.*playwright' 2>/dev/null || true",
		).catch(() => {});

		// Give processes time to exit
		await sleep(500);
	}

	/**
	 * Make the sprite URL public for browser access
	 * Uses the sprite CLI to update URL auth settings
	 */
	private async makeUrlPublic(spriteName: string): Promise<void> {
		const result = Bun.spawnSync(
			["sprite", "url", "update", "--auth", "public", "-s", spriteName],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		if (result.exitCode !== 0) {
			const stderr = result.stderr.toString();
			this.log(`Warning: Failed to make URL public: ${stderr}`);
			// Non-fatal - continue anyway, auth token will still work
		}
	}

	/**
	 * Install system dependencies and Chromium
	 */
	private async installDeps(sprite: SpriteWithUrl): Promise<void> {
		// Install Playwright system deps (needs sudo)
		const depsResult = await this.exec(
			sprite,
			"sudo env PATH=$PATH bunx playwright install-deps chromium",
			true,
		);
		if (depsResult.exitCode !== 0) {
			throw new Error(`Failed to install system deps: ${depsResult.stderr}`);
		}

		// Install rebrowser-playwright globally
		const installResult = await this.exec(
			sprite,
			"bun install -g rebrowser-playwright",
			true,
		);
		if (installResult.exitCode !== 0) {
			throw new Error(
				`Failed to install rebrowser-playwright: ${installResult.stderr}`,
			);
		}

		// Install Chromium browser
		const chromiumResult = await this.exec(
			sprite,
			"bunx rebrowser-playwright-core install chromium",
			true,
		);
		if (chromiumResult.exitCode !== 0) {
			throw new Error(`Failed to install Chromium: ${chromiumResult.stderr}`);
		}
	}

	/**
	 * Deploy browserd bundle and start as a service
	 */
	private async deployAndStartBrowserd(sprite: SpriteWithUrl): Promise<void> {
		// Check if browserd service is already running and healthy
		try {
			const healthCheck = await this.exec(
				sprite,
				"curl -sf http://localhost:3000/readyz",
				true,
			);
			if (healthCheck.exitCode === 0 && healthCheck.stdout.includes("ready"))
				return;
		} catch {
			// Service not running, continue with setup
		}

		// Stop any existing unhealthy service
		await this.stopBrowserdService(sprite);

		this.log("Deploying browserd bundle...");

		// Extract script: extract to temp, find browserd.js, move to /home/sprite
		const extractScript = `
			rm -rf /tmp/browserd-extract
			mkdir -p /tmp/browserd-extract
			tar -xzf /tmp/browserd.tar.gz -C /tmp/browserd-extract
			find /tmp/browserd-extract -name 'browserd.js' -exec mv {} /home/sprite/browserd.js \\;
			rm -rf /tmp/browserd-extract /tmp/browserd.tar.gz
		`
			.trim()
			.replace(/\n\s*/g, " && ");

		if (this.blobBaseUrl) {
			// Download from blob storage
			const tarballUrl = `${this.blobBaseUrl}/browserd.tar.gz`;
			const deployResult = await this.exec(
				sprite,
				`curl -fsSL "${tarballUrl}" -o /tmp/browserd.tar.gz && ${extractScript}`,
			);
			if (deployResult.exitCode !== 0) {
				throw new Error(
					`Failed to deploy bundle from ${tarballUrl}: ${deployResult.stderr}`,
				);
			}
		} else {
			// Read local bundle and deploy via base64
			const bundlePath = "bundle/browserd.tar.gz";
			const file = Bun.file(bundlePath);

			if (!(await file.exists())) {
				throw BrowserdError.providerError(
					`Bundle tarball not found at ${bundlePath}. Run 'bun run bundle' first, or provide blobBaseUrl option.`,
				);
			}

			const bundleData = await file.arrayBuffer();
			const base64 = Buffer.from(bundleData).toString("base64");
			const deployResult = await this.exec(
				sprite,
				`echo '${base64}' | base64 -d > /tmp/browserd.tar.gz && ${extractScript}`,
			);
			if (deployResult.exitCode !== 0) {
				throw new Error(`Failed to deploy bundle: ${deployResult.stderr}`);
			}
		}

		this.log("Starting browserd service...");

		// Create browserd service using sprite-env curl (avoids jq dependency)
		// Note: browserd now manages Xvfb internally when HEADLESS=false
		// We use bash -c with inline env var because the service `env` object isn't reliably applied
		const headlessValue = this.headed ? "false" : "true";
		const serviceJson = JSON.stringify({
			cmd: "bash",
			args: ["-c", `HEADLESS=${headlessValue} bun /home/sprite/browserd.js`],
			http_port: 3000,
		});

		const result = await this.exec(
			sprite,
			`sprite-env curl -X PUT /v1/services/browserd -d '${serviceJson}'`,
		);
		if (result.exitCode !== 0) {
			throw new Error(`Failed to create browserd service: ${result.stderr}`);
		}
	}

	/**
	 * Wait for browserd to be ready by polling internal health endpoint
	 */
	private async waitForReady(
		sandboxId: string,
		timeout: number,
	): Promise<boolean> {
		const entry = this.sprites.get(sandboxId);
		if (!entry) return false;

		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			try {
				const result = await this.exec(
					entry.sprite,
					"curl -sf http://localhost:3000/readyz",
					true,
				);
				if (result.exitCode === 0 && result.stdout.includes("ready")) {
					return true;
				}
			} catch {
				// Not ready yet
			}
			if (entry.info.status === "destroyed") return false;
			await sleep(2000);
		}
		return false;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
