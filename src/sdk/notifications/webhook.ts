/**
 * Webhook Notification Provider
 *
 * Notification provider that sends intervention requests to a webhook URL.
 * Useful for integrating with external systems, Slack, Discord, etc.
 */

import type {
	InterventionNotification,
	NotificationProvider,
	NotificationProviderConfig,
} from "./types";

export interface WebhookNotificationProviderConfig
	extends NotificationProviderConfig {
	/** Webhook URL to POST notifications to */
	url: string;
	/** Optional authorization header value */
	authorization?: string;
	/** Optional custom headers */
	headers?: Record<string, string>;
	/** Request timeout in milliseconds (default: 10000) */
	timeout?: number;
}

/**
 * Webhook payload sent to the configured URL
 */
export interface WebhookPayload {
	type: "intervention_requested";
	intervention: {
		id: string;
		sessionId: string;
		viewerUrl: string;
		reason: string;
		instructions: string;
		createdAt: string;
	};
	timestamp: string;
}

/**
 * Notification provider that sends HTTP POST to a webhook
 *
 * The webhook receives a JSON payload with intervention details.
 * Errors are logged but do not block the intervention flow.
 *
 * @example
 * ```typescript
 * const provider = new WebhookNotificationProvider({
 *   url: "https://hooks.slack.com/services/xxx",
 *   headers: { "Content-Type": "application/json" },
 * });
 *
 * const browserTool = createBrowserTool({
 *   provider: new LocalProvider({ port: 3000 }),
 *   notificationProvider: provider,
 * });
 * ```
 */
export class WebhookNotificationProvider implements NotificationProvider {
	readonly name = "webhook";
	private readonly url: string;
	private readonly authorization?: string;
	private readonly headers: Record<string, string>;
	private readonly timeout: number;
	private readonly enabled: boolean;

	constructor(config: WebhookNotificationProviderConfig) {
		this.url = config.url;
		this.authorization = config.authorization;
		this.headers = config.headers ?? {};
		this.timeout = config.timeout ?? 10000;
		this.enabled = config.enabled ?? true;
	}

	async notify(notification: InterventionNotification): Promise<void> {
		if (!this.enabled) return;

		const payload: WebhookPayload = {
			type: "intervention_requested",
			intervention: {
				id: notification.interventionId,
				sessionId: notification.sessionId,
				viewerUrl: notification.viewerUrl,
				reason: notification.reason,
				instructions: notification.instructions,
				createdAt: notification.createdAt.toISOString(),
			},
			timestamp: new Date().toISOString(),
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...this.headers,
		};

		if (this.authorization) {
			headers.Authorization = this.authorization;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeout);

			const response = await fetch(this.url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				console.error(
					`[WebhookNotificationProvider] Failed to send notification: ${response.status} ${response.statusText}`,
				);
			}
		} catch (error) {
			// Log error but don't throw - notifications should not block intervention
			console.error(
				"[WebhookNotificationProvider] Error sending notification:",
				error,
			);
		}
	}
}
