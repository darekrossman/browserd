/**
 * Console Notification Provider
 *
 * Default notification provider that logs intervention requests to console.
 * Useful for development and testing.
 */

import type {
	InterventionNotification,
	NotificationProvider,
	NotificationProviderConfig,
} from "./types";

export interface ConsoleNotificationProviderConfig
	extends NotificationProviderConfig {
	/** Prefix for console messages (default: "[INTERVENTION]") */
	prefix?: string;
}

/**
 * Notification provider that logs to console
 *
 * This is the default provider used when no notification provider is configured.
 * It outputs intervention details to the console for visibility during development.
 *
 * @example
 * ```typescript
 * const provider = new ConsoleNotificationProvider();
 * const browserTool = createBrowserTool({
 *   provider: new LocalProvider({ port: 3000 }),
 *   notificationProvider: provider,
 * });
 * ```
 */
export class ConsoleNotificationProvider implements NotificationProvider {
	readonly name = "console";
	private readonly prefix: string;
	private readonly enabled: boolean;

	constructor(config: ConsoleNotificationProviderConfig = {}) {
		this.prefix = config.prefix ?? "[INTERVENTION]";
		this.enabled = config.enabled ?? true;
	}

	async notify(notification: InterventionNotification): Promise<void> {
		if (!this.enabled) return;

		const { interventionId, sessionId, viewerUrl, reason, instructions } =
			notification;

		console.log(`
${this.prefix} Human intervention requested
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Intervention ID: ${interventionId}
Session ID:      ${sessionId}
Reason:          ${reason}
Instructions:    ${instructions}

👉 Open viewer to resolve: ${viewerUrl}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
	}
}
