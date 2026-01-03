/**
 * Browserd SDK Providers
 *
 * Infrastructure providers for provisioning browserd instances.
 *
 * @example Local development (connect to running server)
 * ```typescript
 * import { LocalProvider } from 'browserd/providers';
 *
 * // Start browserd server first: bun run dev
 * const provider = new LocalProvider();
 * ```
 *
 * @example Docker containers
 * ```typescript
 * import { DockerContainerProvider } from 'browserd/providers';
 *
 * const provider = new DockerContainerProvider({
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

export {
	DockerContainerProvider,
	/** @deprecated Use DockerContainerProvider instead */
	DockerContainerProvider as LocalSandboxProvider,
	type DockerContainerProviderOptions,
	/** @deprecated Use DockerContainerProviderOptions instead */
	type LocalSandboxProviderOptions,
} from "./docker";
// Provider implementations
export { LocalProvider, type LocalProviderOptions } from "./local";
export {
	SpritesSandboxProvider,
	type SpritesSandboxProviderOptions,
} from "./sprites";
// Base types
export type { SandboxProvider, SandboxProviderOptions } from "./types";
export {
	VercelSandboxProvider,
	type VercelSandboxProviderOptions,
} from "./vercel";
