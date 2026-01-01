/**
 * Browserd SDK
 *
 * Client SDK for connecting to and controlling remote browserd instances.
 *
 * @example Quick start with createClient (recommended)
 * ```typescript
 * import { createClient, SpritesSandboxProvider } from '@repo/browserd/sdk';
 *
 * // Create sandbox with session management methods
 * const { sandbox, manager, createSession, getSessionClient, destroySession } = await createClient({
 *   provider: new SpritesSandboxProvider({ token: 'your-token' }),
 * });
 *
 * // Create a browser session
 * const session = await createSession();
 *
 * // Get a connected client for the session
 * const browser = await getSessionClient(session.id);
 * await browser.connect();
 *
 * // Use the browser
 * await browser.navigate('https://example.com');
 * await browser.click('button#submit');
 *
 * // Cleanup
 * await browser.close();
 * await destroySession(session.id);
 * await manager.destroy(sandbox.id);
 * ```
 *
 * @example Connect to existing browserd session
 * ```typescript
 * import { BrowserdClient } from '@repo/browserd/sdk';
 *
 * const client = new BrowserdClient({
 *   url: 'ws://localhost:3000/sessions/my-session/ws',
 * });
 *
 * await client.connect();
 * await client.navigate('https://example.com');
 * await client.click('button#submit');
 * await client.close();
 * ```
 */

// Main client
export { BrowserdClient } from "./client";
// Errors
export { BrowserdError, type BrowserdErrorCode } from "./errors";
// Providers
export { LocalSandboxProvider } from "./providers/local";
export { SpritesSandboxProvider } from "./providers/sprites";
export type {
	LocalSandboxProviderOptions,
	SandboxProvider,
	SandboxProviderOptions,
	SpritesSandboxProviderOptions,
	VercelSandboxProviderOptions,
} from "./providers/types";
export { VercelSandboxProvider } from "./providers/vercel";
export type { SandboxManagerOptions } from "./sandbox-manager";
// Sandbox management
export { SandboxManager } from "./sandbox-manager";
// Convenience function
export {
	createClient,
	type CreateClientOptions,
	type CreateClientResult,
} from "./create-client";

// Types
export type {
	// Client options
	BrowserdClientOptions,
	// Command options
	ClickOptions,
	// Connection
	ConnectionState,
	ConnectionStateChange,
	// Sandbox
	CreateSandboxOptions,
	CreateSandboxResult,
	EvaluateOptions,
	FillOptions,
	HoverOptions,
	NavigateOptions,
	NavigateResult,
	PressOptions,
	SandboxInfo,
	SandboxStatus,
	ScreenshotOptions,
	ScreenshotResult,
	TypeOptions,
	// Session
	CreateSessionOptions,
	ListSessionsResponse,
	SessionInfo,
	SessionMethods,
	// Protocol re-exports
	Viewport,
	WaitOptions,
} from "./types";
