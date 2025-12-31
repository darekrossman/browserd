/**
 * Browserd SDK
 *
 * Client SDK for connecting to and controlling remote browserd instances.
 *
 * @example Connect to existing browserd
 * ```typescript
 * import { BrowserdClient } from '@repo/browserd/sdk';
 *
 * const client = new BrowserdClient({
 *   url: 'ws://localhost:3000/ws',
 * });
 *
 * await client.connect();
 * await client.navigate('https://example.com');
 * await client.click('button#submit');
 * await client.close();
 * ```
 *
 * @example Provision new sandbox with browserd
 * ```typescript
 * import { SandboxManager, VercelSandboxProvider } from '@repo/browserd/sdk';
 *
 * const provider = new VercelSandboxProvider({
 *   blobBaseUrl: 'https://blob.vercel-storage.com/browserd',
 * });
 *
 * const manager = new SandboxManager({ provider });
 * const { client, sandbox } = await manager.create();
 *
 * await client.navigate('https://example.com');
 * // ... use the browser
 *
 * await manager.destroy(sandbox.id);
 * ```
 */

// Main client
export { BrowserdClient } from "./client";
// Errors
export { BrowserdError, type BrowserdErrorCode } from "./errors";
export type {
	LocalSandboxProviderOptions,
	SandboxProvider,
	SandboxProviderOptions,
	VercelSandboxProviderOptions,
} from "./providers/types";

// Providers
export { LocalSandboxProvider } from "./providers/local";
export { VercelSandboxProvider } from "./providers/vercel";
export type { SandboxManagerOptions } from "./sandbox-manager";
// Sandbox management
export { SandboxManager } from "./sandbox-manager";

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
	// Protocol re-exports
	Viewport,
	WaitOptions,
} from "./types";
