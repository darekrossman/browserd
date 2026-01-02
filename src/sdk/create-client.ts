/**
 * Convenience function for creating a browserd sandbox
 *
 * Simplifies the common pattern of creating a SandboxManager and immediately
 * provisioning a sandbox.
 */

import { SandboxManager, type SandboxManagerOptions } from "./sandbox-manager";
import type {
	CreateSandboxOptions,
	SandboxInfo,
	SessionMethods,
} from "./types";

/**
 * Result of createClient function
 */
export interface CreateClientResult extends SessionMethods {
	/** The SandboxManager instance (for cleanup and multi-sandbox management) */
	manager: SandboxManager;
	/** Sandbox information */
	sandbox: SandboxInfo;
}

/**
 * Options for createClient function
 */
export interface CreateClientOptions extends SandboxManagerOptions {
	/** Options passed to sandbox creation */
	sandboxOptions?: CreateSandboxOptions;
}

/**
 * Create a browserd sandbox with session management
 *
 * This is a convenience function that combines SandboxManager creation
 * and sandbox provisioning into a single call.
 *
 * @example
 * ```typescript
 * import { createClient, SpritesSandboxProvider } from "browserd";
 *
 * const { sandbox, manager, createSession, destroySession } = await createClient({
 *   provider: new SpritesSandboxProvider({ token: "your-token" }),
 * });
 *
 * // createSession() returns an already-connected BrowserdClient
 * const browser = await createSession();
 *
 * // Now you can interact with the browser
 * await browser.navigate("https://example.com");
 * const title = await browser.evaluate("document.title");
 *
 * // Cleanup when done
 * await browser.close();
 * await manager.destroy(sandbox.id);
 * ```
 *
 * @param options - Manager and sandbox options
 * @returns Session management methods, sandbox info, and manager instance
 */
export async function createClient(
	options: CreateClientOptions,
): Promise<CreateClientResult> {
	const { sandboxOptions, ...managerOptions } = options;

	const manager = new SandboxManager(managerOptions);
	const result = await manager.create(sandboxOptions);

	return { ...result, manager };
}
