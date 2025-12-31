/**
 * Sandbox Provider Interface
 *
 * Abstract interface for sandbox infrastructure providers.
 * Allows swapping out the underlying compute platform (Vercel, Docker, AWS, etc.)
 */

import type { CreateSandboxOptions, SandboxInfo } from "../types";

/**
 * Abstract interface for sandbox providers
 *
 * Implementations handle the specifics of provisioning and managing
 * remote compute instances where browserd runs.
 */
export interface SandboxProvider {
	/**
	 * Provider name for identification
	 */
	readonly name: string;

	/**
	 * Create a new sandbox with browserd running
	 *
	 * @param options - Configuration options for the sandbox
	 * @returns Information about the created sandbox
	 */
	create(options?: CreateSandboxOptions): Promise<SandboxInfo>;

	/**
	 * Destroy a sandbox
	 *
	 * @param sandboxId - ID of the sandbox to destroy
	 */
	destroy(sandboxId: string): Promise<void>;

	/**
	 * Check if a sandbox is ready to accept connections
	 *
	 * @param sandboxId - ID of the sandbox to check
	 * @returns true if the sandbox is ready
	 */
	isReady(sandboxId: string): Promise<boolean>;

	/**
	 * Get information about a sandbox
	 *
	 * @param sandboxId - ID of the sandbox
	 * @returns Sandbox information or undefined if not found
	 */
	get(sandboxId: string): Promise<SandboxInfo | undefined>;
}

/**
 * Base options for all sandbox providers
 */
export interface SandboxProviderOptions {
	/** Default timeout for sandbox operations in milliseconds */
	defaultTimeout?: number;
}

/**
 * Options for Vercel Sandbox Provider
 */
export interface VercelSandboxProviderOptions extends SandboxProviderOptions {
	/** Base URL for blob storage where install.sh and browserd.tar.gz are stored */
	blobBaseUrl: string;
	/** Vercel sandbox runtime (default: "node24") */
	runtime?: string;
}

/**
 * Options for Local Docker Provider
 */
export interface LocalSandboxProviderOptions extends SandboxProviderOptions {
	/** Run browser in headed mode with Xvfb (default: true) */
	headed?: boolean;
	/** Docker image name (default: 'browserd-sandbox') */
	imageName?: string;
	/** Container name prefix (default: 'browserd') */
	containerNamePrefix?: string;
	/** Timeout for ready check in ms (default: 60000) */
	readyTimeout?: number;
	/** Working directory to mount (default: process.cwd()) */
	workingDir?: string;
	/** Enable debug logging for timing analysis (default: false) */
	debug?: boolean;
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
