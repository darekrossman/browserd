/**
 * Notification Providers for Human-in-the-Loop
 *
 * This module provides notification providers for alerting users
 * when human intervention is needed during browser automation.
 */

// Types
export type {
	InterventionNotification,
	NotificationProvider,
	NotificationProviderConfig,
} from "./types";

// Providers
export {
	ConsoleNotificationProvider,
	type ConsoleNotificationProviderConfig,
} from "./console";

export {
	WebhookNotificationProvider,
	type WebhookNotificationProviderConfig,
	type WebhookPayload,
} from "./webhook";
