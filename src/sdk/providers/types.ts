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
