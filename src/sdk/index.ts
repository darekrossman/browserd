/**
 * Browserd SDK
 *
 * Client SDK for connecting to and controlling remote browserd instances.
 *
 * @example Quick start with createClient (recommended)
 * ```typescript
 * import { createClient, SpritesSandboxProvider } from "browserd";
 *
 * // Create sandbox with session management methods
 * const { sandbox, manager, createSession } = await createClient({
 *   provider: new SpritesSandboxProvider({ token: "your-token" }),
 * });
 *
 * // createSession() returns an already-connected BrowserdClient
 * const browser = await createSession();
 *
 * // Use the browser
 * await browser.navigate("https://example.com");
 * await browser.click("button#submit");
 *
 * // Cleanup
 * await browser.close();
 * await manager.destroy(sandbox.id);
 * ```
 *
 * @example Connect to existing browserd server directly
 * ```typescript
 * import { BrowserdClient } from "browserd";
 *
 * const client = new BrowserdClient({
 *   url: "ws://localhost:3000/sessions/my-session/ws",
 * });
 *
 * await client.connect();
 * await client.navigate("https://example.com");
 * await client.click("button#submit");
 * await client.close();
 * ```
 */

// Main client
export { BrowserdClient } from "./client";
// Convenience function
export {
	type CreateClientOptions,
	type CreateClientResult,
	createClient,
} from "./create-client";
// Errors
export { BrowserdError, type BrowserdErrorCode } from "./errors";
export type {
	DockerContainerProviderOptions,
	LocalProviderOptions,
	/** @deprecated Use DockerContainerProviderOptions instead */
	LocalSandboxProviderOptions,
	SandboxProvider,
	SandboxProviderOptions,
	SpritesSandboxProviderOptions,
	VercelSandboxProviderOptions,
} from "./providers";
// Providers
export {
	DockerContainerProvider,
	LocalProvider,
	/** @deprecated Use DockerContainerProvider instead */
	LocalSandboxProvider,
	SpritesSandboxProvider,
	VercelSandboxProvider,
} from "./providers";
export type { SandboxManagerOptions } from "./sandbox-manager";
// Sandbox management
export { SandboxManager } from "./sandbox-manager";

// Notification providers (Human-in-the-Loop)
export {
	ConsoleNotificationProvider,
	WebhookNotificationProvider,
	type ConsoleNotificationProviderConfig,
	type InterventionNotification,
	type NotificationProvider,
	type NotificationProviderConfig,
	type WebhookNotificationProviderConfig,
	type WebhookPayload,
} from "./notifications";

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
	// Session
	CreateSessionOptions,
	EvaluateOptions,
	FillOptions,
	HoverOptions,
	// Intervention (Human-in-the-Loop)
	Intervention,
	InterventionCreatedInfo,
	InterventionOptions,
	InterventionResult,
	InterventionStatus,
	ListSessionsResponse,
	NavigateOptions,
	NavigateResult,
	PressOptions,
	SandboxInfo,
	SandboxStatus,
	ScreenshotOptions,
	ScreenshotResult,
	SessionInfo,
	SessionMethods,
	TypeOptions,
	// Protocol re-exports
	Viewport,
	WaitOptions,
} from "./types";
