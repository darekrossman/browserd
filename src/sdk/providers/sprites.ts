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
import { BrowserdError } from "../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../types";
import type { SandboxProvider, SpritesSandboxProviderOptions } from "./types";

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
 *   console.log(SpritesSandboxProvider.getInstallInstructions());
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
		this.useLocalProxy = options.useLocalProxy ?? true;
		this.localProxyPort = options.localProxyPort;
		this.autoInstallCli = options.autoInstallCli ?? false;
	}

	/**
	 * Check if all dependencies are available
	 *
	 * @returns Object with availability status and message
	 *
	 * @example
	 * ```typescript
	 * const { available, message } = await SpritesSandboxProvider.checkDependencies();
	 * if (!available) {
	 *   console.error(message);
	 * }
	 * ```
	 */
	static async checkDependencies(): Promise<{
		available: boolean;
		cliInstalled: boolean;
		cliAuthenticated: boolean;
		message: string;
	}> {
		// Check if sprite CLI is installed
		const cliInstalled = await SpritesSandboxProvider.isCliInstalled();
		if (!cliInstalled) {
			return {
				available: false,
				cliInstalled: false,
				cliAuthenticated: false,
				message:
					"sprite CLI is not installed. WebSocket connectivity requires the CLI for port forwarding.",
			};
		}

		// Check if authenticated
		const cliAuthenticated = await SpritesSandboxProvider.isCliAuthenticated();
		if (!cliAuthenticated) {
			return {
				available: false,
				cliInstalled: true,
				cliAuthenticated: false,
				message:
					"sprite CLI is not authenticated. Run 'sprite login' to authenticate.",
			};
		}

		return {
			available: true,
			cliInstalled: true,
			cliAuthenticated: true,
			message: "All dependencies available",
		};
	}

	/**
	 * Check if sprite CLI is installed
	 */
	static async isCliInstalled(): Promise<boolean> {
		if (SpritesSandboxProvider.cliAvailable !== null) {
			return SpritesSandboxProvider.cliAvailable;
		}

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

	/**
	 * Check if sprite CLI is authenticated
	 *
	 * Authentication can be via:
	 * - Interactive login (`sprite login`) - stores token in keyring/config
	 * - Environment variable (`SPRITE_TOKEN`) - used as fallback by CLI
	 */
	static async isCliAuthenticated(): Promise<boolean> {
		// Check if SPRITE_TOKEN env var is set (CLI uses this as fallback)
		if (process.env.SPRITE_TOKEN) {
			return true;
		}

		try {
			// Try to list sprites - will fail if not authenticated
			const result = Bun.spawnSync(["sprite", "list"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			return result.exitCode === 0;
		} catch {
			return false;
		}
	}

	/**
	 * Get installation instructions for the sprite CLI
	 */
	static getInstallInstructions(): string {
		return `
Sprite CLI Installation
=======================

The sprite CLI is required for WebSocket connectivity (browser control).

Install:
  curl -fsSL https://sprites.dev/install.sh | sh

Authenticate (choose one):
  Option 1 - Interactive login:
    sprite login

  Option 2 - Environment variable (for CI/CD):
    export SPRITE_TOKEN=spr_xxxxxxxxxxxxx

Verify:
  sprite list

Auto-install option:
  const provider = new SpritesSandboxProvider({
    autoInstallCli: true,  // Auto-install CLI if missing
  });

Alternative (HTTP-only mode):
  If you only need HTTP access (no real-time browser control),
  you can disable the local proxy:

  const provider = new SpritesSandboxProvider({
    useLocalProxy: false,  // Disables WebSocket, HTTP still works
  });

Documentation:
  https://docs.sprites.dev
`.trim();
	}

	/**
	 * Install the sprite CLI
	 *
	 * Downloads and runs the official install script from sprites.dev.
	 * Installs to ~/.local/bin by default.
	 *
	 * After installation, authenticate via:
	 * - `sprite login` (interactive, opens browser)
	 * - `SPRITE_TOKEN` env var (non-interactive, for CI/CD)
	 *
	 * @returns Object with success status and message
	 *
	 * @example
	 * ```typescript
	 * const result = await SpritesSandboxProvider.installCli();
	 * if (result.success) {
	 *   console.log('CLI installed successfully');
	 *   // Authenticate via: sprite login OR set SPRITE_TOKEN env var
	 * }
	 * ```
	 */
	static async installCli(): Promise<{
		success: boolean;
		message: string;
		output?: string;
	}> {
		console.log("[SpritesProvider] Installing sprite CLI...");

		try {
			// Download and run the install script
			const result = Bun.spawnSync(
				["sh", "-c", "curl -fsSL https://sprites.dev/install.sh | sh"],
				{
					stdout: "pipe",
					stderr: "pipe",
					env: {
						...process.env,
						// Ensure ~/.local/bin is in PATH for the install script
						PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
					},
				},
			);

			const stdout = result.stdout.toString();
			const stderr = result.stderr.toString();
			const output = stdout + (stderr ? `\n${stderr}` : "");

			if (result.exitCode !== 0) {
				return {
					success: false,
					message: `Installation failed with exit code ${result.exitCode}`,
					output,
				};
			}

			// Reset the cached CLI availability check
			SpritesSandboxProvider.cliAvailable = null;

			// Verify installation
			const installed = await SpritesSandboxProvider.isCliInstalled();
			if (!installed) {
				return {
					success: false,
					message:
						"Installation completed but CLI not found in PATH. " +
						"You may need to add ~/.local/bin to your PATH:\n" +
						'  export PATH="$HOME/.local/bin:$PATH"',
					output,
				};
			}

			console.log("[SpritesProvider] CLI installed successfully");
			return {
				success: true,
				message:
					"sprite CLI installed successfully. Authenticate via 'sprite login' or set SPRITE_TOKEN env var.",
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
	 * Get or create the SpritesClient instance
	 */
	private getClient(): SpritesClient {
		if (!this.token) {
			throw BrowserdError.providerError(
				"Sprites API token required. Set SPRITE_TOKEN env var or pass token option.",
			);
		}

		if (!this.client) {
			this.client = new SpritesClient(this.token);
		}

		return this.client;
	}

	/**
	 * Create a new sandbox with browserd running
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const createStart = Date.now();
		this.log("create() started");

		// Check CLI availability upfront if local proxy is needed
		if (this.useLocalProxy) {
			let deps = await SpritesSandboxProvider.checkDependencies();

			// Auto-install CLI if enabled and not installed
			if (!deps.cliInstalled && this.autoInstallCli) {
				this.log("CLI not found, attempting auto-install...");
				const installResult = await SpritesSandboxProvider.installCli();
				if (!installResult.success) {
					throw BrowserdError.providerError(
						`Failed to auto-install sprite CLI: ${installResult.message}\n\n` +
							SpritesSandboxProvider.getInstallInstructions(),
					);
				}
				// Re-check dependencies after install
				deps = await SpritesSandboxProvider.checkDependencies();
			}

			if (!deps.available) {
				throw BrowserdError.providerError(
					`${deps.message}\n\n${SpritesSandboxProvider.getInstallInstructions()}`,
				);
			}
		}

		const timeout = options?.timeout ?? this.defaultTimeout;
		const client = this.getClient();

		let sprite: SpriteWithUrl;
		let createdByUs = false;

		// Get or create sprite
		if (this.spriteName) {
			// Reuse existing sprite
			this.log(`Getting existing sprite: ${this.spriteName}`);
			try {
				sprite = (await client.getSprite(this.spriteName)) as SpriteWithUrl;
				this.log(`Got sprite: ${sprite.name}, url: ${sprite.url}`);
			} catch (err) {
				throw BrowserdError.providerError(
					`Sprite '${this.spriteName}' not found. Create it first with: sprite create ${this.spriteName}`,
					err instanceof Error ? err : undefined,
				);
			}
		} else {
			// Create new sprite
			const newName = `browserd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			this.log(`Creating new sprite: ${newName}`);
			try {
				sprite = (await client.createSprite(newName)) as SpriteWithUrl;
				createdByUs = true;
				this.log(`Created sprite: ${sprite.name}`);
			} catch (err) {
				throw BrowserdError.sandboxCreationFailed(
					`Failed to create sprite: ${err instanceof Error ? err.message : String(err)}`,
					err instanceof Error ? err : undefined,
				);
			}
		}

		// Get sprite URL (available via Object.assign from API response)
		const spriteUrl = sprite.url;
		if (!spriteUrl) {
			throw BrowserdError.providerError(
				"Sprite URL not available. This may be an API issue.",
			);
		}

		const sandboxId = sprite.id ?? sprite.name;

		// Create initial sandbox info
		const info: SandboxInfo = {
			id: sandboxId,
			domain: spriteUrl,
			wsUrl: `${spriteUrl.replace("https://", "wss://")}/ws`,
			status: "creating",
			createdAt: Date.now(),
		};

		this.sprites.set(sandboxId, { sprite, info, createdByUs });

		try {
			// Restore checkpoint if specified
			if (this.checkpointId) {
				this.log(`Restoring checkpoint: ${this.checkpointId}`);
				await this.restoreCheckpoint(sprite, this.checkpointId);
				this.log("Checkpoint restored");
			}

			// Auto-setup if enabled
			if (this.autoSetup) {
				const stepStart = Date.now();
				await this.ensureSetup(sprite);
				this.log("ensureSetup() completed", stepStart);
			}

			// Deploy and start browserd
			const stepStart = Date.now();
			await this.deployAndStartBrowserd(sprite);
			this.log("deployAndStartBrowserd() completed", stepStart);

			// Wait for browserd to be ready
			const readyStart = Date.now();
			const ready = await this.waitForReady(
				sandboxId,
				spriteUrl,
				Math.min(this.readyTimeout, timeout),
			);
			this.log("waitForReady() completed", readyStart);

			if (!ready) {
				throw new Error("browserd server did not become ready within timeout");
			}

			// Start local proxy for WebSocket access if enabled
			const entry = this.sprites.get(sandboxId)!;
			if (this.useLocalProxy) {
				const proxyStart = Date.now();
				this.log("Starting local proxy for WebSocket access");
				const proxyPort = await this.startLocalProxy(sprite.name, entry);
				info.wsUrl = `ws://localhost:${proxyPort}/ws`;
				this.log(`Local proxy started on port ${proxyPort}`, proxyStart);
			} else {
				// Warn user that WebSocket won't work through sprite URL
				this.log(
					"WARNING: useLocalProxy=false - WebSocket will NOT work through sprite URL. " +
						"HTTP endpoints will work but real-time browser control requires WebSocket.",
				);
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
		const destroyStart = Date.now();
		this.log(`destroy(${sandboxId}) started`);

		const entry = this.sprites.get(sandboxId);
		if (!entry) {
			this.log("destroy() - sandbox not found, skipping");
			return;
		}

		try {
			// Kill local proxy process if running
			if (entry.proxyProcess) {
				this.log("Killing local proxy process");
				entry.proxyProcess.kill();
				entry.proxyProcess = undefined;
			}

			// Stop browserd service
			this.log("Stopping browserd service");
			await entry.sprite
				.exec("sprite-env services delete browserd 2>/dev/null || true")
				.catch(() => {});

			// Delete sprite only if we created it
			if (entry.createdByUs) {
				this.log("Deleting sprite (created by us)");
				await entry.sprite.delete().catch(() => {});
			}
		} catch {
			// Ignore cleanup errors
		} finally {
			entry.info.status = "destroyed";
			this.sprites.delete(sandboxId);
			this.log("destroy() completed", destroyStart);
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
		const port = this.localProxyPort ?? (await this.findAvailablePort());

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

			const errorDetails = stderrText
				? `\nProxy stderr: ${stderrText}`
				: "";
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
	 * Find an available local port
	 */
	private async findAvailablePort(): Promise<number> {
		// Try to bind to port 0 to get a random available port
		const server = Bun.serve({
			port: 0,
			fetch() {
				return new Response("ok");
			},
		});
		const port = server.port ?? 3001;
		server.stop();
		return port;
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
	 * Restore a checkpoint
	 */
	private async restoreCheckpoint(
		sprite: SpriteWithUrl,
		checkpointId: string,
	): Promise<void> {
		try {
			const response = await sprite.restoreCheckpoint(checkpointId);
			// Consume the NDJSON stream to completion
			await response.text();
		} catch (err) {
			throw BrowserdError.providerError(
				`Failed to restore checkpoint '${checkpointId}': ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Ensure sprite has all required dependencies
	 */
	private async ensureSetup(sprite: SpriteWithUrl): Promise<void> {
		this.log("Checking if deps are installed");

		// Check if Chromium is installed
		const depsInstalled = await this.checkDepsInstalled(sprite);

		if (!depsInstalled) {
			this.log("Dependencies not found, installing...");
			await this.installDeps(sprite);

			// Create checkpoint after setup if enabled
			if (this.createCheckpointAfterSetup) {
				this.log("Creating checkpoint after setup");
				try {
					const response = await sprite.createCheckpoint("browserd-deps-ready");
					await response.text(); // Consume stream
					this.log("Checkpoint created");
				} catch (err) {
					// Non-fatal, just log
					this.log(`Failed to create checkpoint: ${err}`);
				}
			}
		} else {
			this.log("Dependencies already installed");
		}
	}

	/**
	 * Execute a command with login shell to get proper PATH (includes bun)
	 * Uses execFile instead of exec because exec has issues with the SDK
	 */
	private async execWithShell(
		sprite: SpriteWithUrl,
		command: string,
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		// Use execFile with bash -lc to run command in login shell
		const result = await sprite.execFile("bash", ["-lc", command]);
		return {
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
			exitCode: result.exitCode,
		};
	}

	/**
	 * Execute a simple command without login shell (for commands that don't need PATH)
	 */
	private async execSimple(
		sprite: SpriteWithUrl,
		command: string,
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const result = await sprite.execFile("bash", ["-c", command]);
		return {
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
			exitCode: result.exitCode,
		};
	}

	/**
	 * Check if Chromium and deps are installed
	 */
	private async checkDepsInstalled(sprite: SpriteWithUrl): Promise<boolean> {
		try {
			// Check if rebrowser-playwright chromium exists
			const result = await this.execWithShell(
				sprite,
				"ls -d $HOME/.cache/ms-playwright/chromium-* 2>/dev/null && echo exists",
			);
			return result.stdout.includes("exists");
		} catch {
			return false;
		}
	}

	/**
	 * Install system dependencies and Chromium
	 */
	private async installDeps(sprite: SpriteWithUrl): Promise<void> {
		this.log("Installing system dependencies for Chromium");

		// Install Playwright system deps (needs sudo)
		// Use bash -lc to get proper PATH, then sudo with env to pass PATH through
		const depsResult = await this.execWithShell(
			sprite,
			"sudo env PATH=$PATH bunx playwright install-deps chromium",
		);
		if (depsResult.exitCode !== 0) {
			throw new Error(`Failed to install system deps: ${depsResult.stderr}`);
		}
		this.log("System deps installed");

		// Install rebrowser-playwright globally
		this.log("Installing rebrowser-playwright");
		const installResult = await this.execWithShell(
			sprite,
			"bun install -g rebrowser-playwright",
		);
		if (installResult.exitCode !== 0) {
			throw new Error(
				`Failed to install rebrowser-playwright: ${installResult.stderr}`,
			);
		}

		// Install Chromium browser
		this.log("Installing Chromium");
		const chromiumResult = await this.execWithShell(
			sprite,
			"bunx rebrowser-playwright-core install chromium",
		);
		if (chromiumResult.exitCode !== 0) {
			throw new Error(`Failed to install Chromium: ${chromiumResult.stderr}`);
		}
		this.log("Chromium installed");
	}

	/**
	 * Deploy browserd bundle and start as a service
	 *
	 * Uses sprite-env CLI (in PATH via login shell).
	 * See: https://docs.sprites.dev/concepts/services/
	 */
	private async deployAndStartBrowserd(sprite: SpriteWithUrl): Promise<void> {
		// First, stop any existing browserd service
		this.log("Stopping any existing browserd service");
		await this.execWithShell(
			sprite,
			"sprite-env services delete browserd 2>/dev/null || true",
		).catch(() => {});

		// Deploy browserd bundle
		this.log("Deploying browserd bundle");

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
			const deployResult = await this.execSimple(
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

			// Transfer in chunks if large
			const chunkSize = 50000; // ~50KB chunks
			if (base64.length > chunkSize) {
				// Write to temp file in chunks
				this.log(
					`Bundle is large (${base64.length} chars), transferring in chunks`,
				);
				await this.execSimple(sprite, "rm -f /tmp/browserd.b64");

				for (let i = 0; i < base64.length; i += chunkSize) {
					const chunk = base64.slice(i, i + chunkSize);
					await this.execSimple(
						sprite,
						`echo -n '${chunk}' >> /tmp/browserd.b64`,
					);
				}

				const deployResult = await this.execSimple(
					sprite,
					`cat /tmp/browserd.b64 | base64 -d > /tmp/browserd.tar.gz && rm /tmp/browserd.b64 && ${extractScript}`,
				);
				if (deployResult.exitCode !== 0) {
					throw new Error(`Failed to deploy bundle: ${deployResult.stderr}`);
				}
			} else {
				const deployResult = await this.execSimple(
					sprite,
					`echo '${base64}' | base64 -d > /tmp/browserd.tar.gz && ${extractScript}`,
				);
				if (deployResult.exitCode !== 0) {
					throw new Error(`Failed to deploy bundle: ${deployResult.stderr}`);
				}
			}
		}
		this.log("Bundle deployed");

		// Create browserd service using sprite-env CLI
		// See: https://docs.sprites.dev/concepts/services/
		this.log("Creating browserd service");

		let serviceCmd: string;
		if (this.headed) {
			// With Xvfb for headed mode
			// Use bash -c to set up display and env vars
			serviceCmd = [
				"sprite-env services create browserd",
				"--cmd bash",
				`--args "-c,Xvfb :99 -screen 0 1280x720x24 &>/dev/null & sleep 0.5 && DISPLAY=:99 bun /home/sprite/browserd.js"`,
				"--http-port 3000",
				"--env HEADLESS=false",
				"--no-stream",
			].join(" ");
		} else {
			// Headless mode
			serviceCmd = [
				"sprite-env services create browserd",
				"--cmd bun",
				"--args /home/sprite/browserd.js",
				"--http-port 3000",
				"--env HEADLESS=true",
				"--no-stream",
			].join(" ");
		}

		const serviceResult = await this.execWithShell(sprite, serviceCmd);
		if (serviceResult.exitCode !== 0) {
			throw new Error(
				`Failed to create browserd service: ${serviceResult.stderr}`,
			);
		}
		this.log("Browserd service created");
	}

	/**
	 * Wait for browserd to be ready by polling the health endpoint
	 */
	private async waitForReady(
		sandboxId: string,
		spriteUrl: string,
		timeout: number,
	): Promise<boolean> {
		const healthUrl = `${spriteUrl}/readyz`;
		const deadline = Date.now() + timeout;
		const pollInterval = 2000; // Sprites may need to wake from hibernation

		this.log(`Waiting for ${healthUrl} to be ready`);

		while (Date.now() < deadline) {
			try {
				const response = await fetch(healthUrl, {
					method: "GET",
					signal: AbortSignal.timeout(10000),
				});

				if (response.ok) {
					return true;
				}
				this.log(`Health check returned ${response.status}`);
			} catch (err) {
				// Server not ready yet (may be waking from hibernation)
				this.log(
					`Health check failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			// Check if sandbox was destroyed while waiting
			const entry = this.sprites.get(sandboxId);
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
