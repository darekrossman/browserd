/**
 * Inter-operation timing configuration for realistic browser automation
 *
 * Adds automatic delays between browser operations to avoid detection
 * based on timing patterns. OAuth flows especially benefit from human-like timing.
 *
 * Designed specifically for DataDome/PerimeterX bypass which analyze timing patterns.
 */

import { randomBetween, randomSleep } from "./human-behavior";
import type { TimingConfig, TimingOperation } from "./types";

/**
 * Default timing configuration - human-like delays
 * Tuned for DataDome/PerimeterX bypass
 */
export const DEFAULT_TIMING_CONFIG: TimingConfig = {
	afterNavigation: [800, 2000],
	beforeFormFill: [300, 800],
	afterFormFill: [200, 500],
	beforeClick: [150, 400],
	afterClick: [500, 1500],
	oauthRedirectWait: [1000, 3000],
	beforeType: [200, 500],
	afterType: [150, 400],
	beforeScroll: [100, 300],
	afterScroll: [200, 500],
	beforeHover: [100, 250],
	hoverDuration: [150, 400],
};

/**
 * Fast timing for non-stealth operations (testing)
 */
export const FAST_TIMING_CONFIG: TimingConfig = {
	afterNavigation: [0, 100],
	beforeFormFill: [0, 50],
	afterFormFill: [0, 50],
	beforeClick: [0, 50],
	afterClick: [0, 100],
	oauthRedirectWait: [100, 300],
	beforeType: [0, 50],
	afterType: [0, 50],
	beforeScroll: [0, 50],
	afterScroll: [0, 50],
	beforeHover: [0, 25],
	hoverDuration: [0, 50],
};

/**
 * Global timing config storage per session
 */
const sessionTimingConfig = new Map<string, TimingConfig>();

/**
 * Session action counter for fatigue simulation
 */
const sessionActionCount = new Map<string, number>();

/**
 * Set timing config for a session
 */
export function setSessionTimingConfig(
	sessionId: string,
	config: Partial<TimingConfig>,
): void {
	const current = sessionTimingConfig.get(sessionId) ?? DEFAULT_TIMING_CONFIG;
	sessionTimingConfig.set(sessionId, { ...current, ...config });
}

/**
 * Get timing config for a session
 */
export function getSessionTimingConfig(sessionId: string): TimingConfig {
	return sessionTimingConfig.get(sessionId) ?? DEFAULT_TIMING_CONFIG;
}

/**
 * Clear timing config for a session
 */
export function clearSessionTimingConfig(sessionId: string): void {
	sessionTimingConfig.delete(sessionId);
	sessionActionCount.delete(sessionId);
}

/**
 * Increment action count for fatigue simulation
 */
function incrementActionCount(sessionId: string): number {
	const count = (sessionActionCount.get(sessionId) ?? 0) + 1;
	sessionActionCount.set(sessionId, count);
	return count;
}

/**
 * Calculate fatigue multiplier based on action count
 * Users get slightly slower after many actions
 */
function getFatigueMultiplier(actionCount: number): number {
	// After 50 actions, start adding up to 20% delay
	if (actionCount < 50) return 1.0;
	if (actionCount < 100) return 1.0 + (actionCount - 50) * 0.002; // Up to 10%
	return 1.1 + Math.min((actionCount - 100) * 0.001, 0.1); // Cap at 20%
}

/**
 * Apply timing delay for an operation
 *
 * Features:
 * - Micro-randomness (±5-15% variation)
 * - Fatigue simulation (slower after many actions)
 * - Configurable stealth/fast mode
 */
export async function applyTimingDelay(
	sessionId: string,
	operation: TimingOperation,
	stealthEnabled = true,
): Promise<void> {
	if (!stealthEnabled) {
		// Use fast timing for non-stealth
		const [min, max] = FAST_TIMING_CONFIG[operation];
		if (max > 0) {
			await randomSleep(min, max);
		}
		return;
	}

	const config = getSessionTimingConfig(sessionId);
	const [baseMin, baseMax] = config[operation];

	// Apply micro-randomness (±10% variation)
	const variance = 0.1;
	const min = Math.floor(baseMin * (1 - variance + Math.random() * variance));
	const max = Math.ceil(baseMax * (1 + Math.random() * variance));

	// Apply fatigue multiplier
	const actionCount = incrementActionCount(sessionId);
	const fatigue = getFatigueMultiplier(actionCount);

	const delay = randomBetween(min, max) * fatigue;
	await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wrap an async operation with pre and post timing delays
 */
export async function withTiming<T>(
	sessionId: string,
	preOp: TimingOperation | null,
	postOp: TimingOperation | null,
	fn: () => Promise<T>,
	stealthEnabled = true,
): Promise<T> {
	if (preOp) {
		await applyTimingDelay(sessionId, preOp, stealthEnabled);
	}

	const result = await fn();

	if (postOp) {
		await applyTimingDelay(sessionId, postOp, stealthEnabled);
	}

	return result;
}

/**
 * Detect if a URL is an OAuth redirect
 */
export function isOAuthRedirect(url: string): boolean {
	const oauthPatterns = [
		/oauth/i,
		/authorize/i,
		/callback/i,
		/auth\/login/i,
		/accounts\.google/i,
		/login\.microsoftonline/i,
		/github\.com\/login/i,
		/facebook\.com\/.*dialog/i,
		/twitter\.com\/oauth/i,
		/api\.twitter\.com\/oauth/i,
		/appleid\.apple\.com/i,
		/auth0\.com/i,
		/okta\.com/i,
		/login\.salesforce/i,
	];

	return oauthPatterns.some((pattern) => pattern.test(url));
}

/**
 * Detect if a URL is a login/auth page
 */
export function isLoginPage(url: string): boolean {
	const loginPatterns = [
		/login/i,
		/signin/i,
		/sign-in/i,
		/authenticate/i,
		/auth\//i,
		/sso/i,
		/session\/new/i,
	];

	return loginPatterns.some((pattern) => pattern.test(url));
}
