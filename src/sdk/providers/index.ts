/**
 * Browserd SDK Providers
 *
 * Infrastructure providers for provisioning browserd instances.
 *
 * @example Local Docker development
 * ```typescript
 * import { LocalSandboxProvider } from 'browserd/providers';
 *
 * const provider = new LocalSandboxProvider({
 *   headed: true,
 *   debug: true,
 * });
 * ```
 *
 * @example Vercel Sandbox
 * ```typescript
 * import { VercelSandboxProvider } from 'browserd/providers';
 *
 * const provider = new VercelSandboxProvider({
 *   blobBaseUrl: 'https://blob.vercel-storage.com/browserd',
 * });
 * ```
 *
 * @example Sprites.dev
 * ```typescript
 * import { SpritesSandboxProvider } from 'browserd/providers';
 *
 * const provider = new SpritesSandboxProvider({
 *   spriteName: 'my-browserd',
 *   autoSetup: true,
 * });
 * ```
 */

export { LocalSandboxProvider } from "./local";
export { SpritesSandboxProvider } from "./sprites";
export type {
	LocalSandboxProviderOptions,
	SandboxProvider,
	SandboxProviderOptions,
	SpritesSandboxProviderOptions,
	VercelSandboxProviderOptions,
} from "./types";
export { VercelSandboxProvider } from "./vercel";
