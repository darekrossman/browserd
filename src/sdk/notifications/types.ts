/**
 * Notification Provider Types for Human-in-the-Loop
 *
 * Defines interfaces for notification providers that alert users
 * when human intervention is needed during browser automation.
 */

/**
 * Notification payload sent when intervention is requested
 */
export interface InterventionNotification {
	/** Unique intervention identifier */
	interventionId: string;
	/** Session ID where intervention is needed */
	sessionId: string;
	/** URL for human to access the browser viewer */
	viewerUrl: string;
	/** Reason for requesting intervention (e.g., "CAPTCHA detected") */
	reason: string;
	/** Instructions for the human (e.g., "Please solve the CAPTCHA") */
	instructions: string;
	/** When the intervention was requested */
	createdAt: Date;
}

/**
 * Interface for notification providers
 *
 * Implement this interface to send intervention notifications
 * via different channels (email, Slack, SMS, webhooks, etc.)
 */
export interface NotificationProvider {
	/** Provider name for identification/logging */
	readonly name: string;

	/**
	 * Send a notification about an intervention request
	 *
	 * This method should be non-blocking and handle its own errors.
	 * Failures should be logged but not throw exceptions that would
	 * block the intervention flow.
	 *
	 * @param notification - The intervention details to notify about
	 */
	notify(notification: InterventionNotification): Promise<void>;
}

/**
 * Configuration for creating notification providers
 */
export interface NotificationProviderConfig {
	/** Enable/disable the provider (default: true) */
	enabled?: boolean;
}
