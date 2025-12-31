/**
 * Stealth module types for browserd
 *
 * Provides type definitions for browser fingerprint profiles, human behavior emulation,
 * and stealth configuration to bypass bot detection systems like DataDome and PerimeterX.
 */

/**
 * Browser profile for fingerprint consistency
 */
export interface BrowserProfile {
	name: string;
	userAgent: string;
	platform: string;
	vendor: string;
	viewport: { width: number; height: number };
	deviceScaleFactor: number;
	locale: string;
	timezone: string;
	webglVendor: string;
	webglRenderer: string;
}

/**
 * Profile names
 */
export type ProfileName =
	| "chrome-mac"
	| "chrome-win"
	| "chrome-linux"
	| "firefox-mac"
	| "firefox-win"
	| "random";

/**
 * Human behavior emulation settings
 */
export interface HumanBehaviorConfig {
	/** Enable natural mouse movement with bezier curves */
	mouseMovement?: boolean;
	/** Enable realistic typing patterns with variable delays */
	typingPatterns?: boolean;
	/** Enable human-like scroll behavior */
	scrollBehavior?: boolean;
	/** Enable idle mouse simulation */
	idleMouseSimulation?: boolean;
	/** Probability of making typos (0-1), default 0.02 */
	typoRate?: number;
	/** Min delay between keystrokes in ms, default 50 */
	minTypingDelay?: number;
	/** Max delay between keystrokes in ms, default 150 */
	maxTypingDelay?: number;
}

/**
 * Fingerprint masking settings
 */
export interface FingerprintConfig {
	/** Mask WebGL fingerprint */
	webgl?: boolean;
	/** Mask canvas fingerprint */
	canvas?: boolean;
	/** Mask audio context fingerprint */
	audio?: boolean;
	/** Protect against WebRTC IP leaks */
	webrtc?: boolean;
	/** Add performance timing noise */
	performance?: boolean;
	/** Spoof screen properties */
	screen?: boolean;
}

/**
 * Stealth configuration for anti-bot evasion
 */
export interface StealthConfig {
	/** Enable stealth mode (default: true) */
	enabled: boolean;
	/** Browser profile to use, or 'random' for random selection */
	profile?: ProfileName;
	/** Human behavior emulation settings */
	humanBehavior?: HumanBehaviorConfig;
	/** Fingerprint masking settings */
	fingerprint?: FingerprintConfig;
	/** Block known bot detection scripts */
	blockBotDetection?: boolean;
	/** Use 'stealth' for human-like delays, 'fast' for testing */
	timing?: "stealth" | "fast";
}

/**
 * Default stealth configuration
 */
export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
	enabled: true,
	profile: "chrome-mac",
	humanBehavior: {
		mouseMovement: true,
		typingPatterns: true,
		scrollBehavior: true,
		idleMouseSimulation: true,
		typoRate: 0.02,
		minTypingDelay: 50,
		maxTypingDelay: 150,
	},
	fingerprint: {
		webgl: true,
		canvas: true,
		audio: true,
		webrtc: true,
		performance: true,
		screen: true,
	},
	blockBotDetection: true,
	timing: "stealth",
};

/**
 * Mouse position and movement history for session-level tracking
 */
export interface MouseState {
	x: number;
	y: number;
	lastMoveTime: number;
	movementHistory: Array<{ x: number; y: number; timestamp: number }>;
}

/**
 * Timing ranges for different operation types (min, max in ms)
 */
export interface TimingConfig {
	/** Delay after page navigation completes */
	afterNavigation: [number, number];
	/** Delay before filling a form field */
	beforeFormFill: [number, number];
	/** Delay after filling a form field */
	afterFormFill: [number, number];
	/** Delay before clicking an element */
	beforeClick: [number, number];
	/** Delay after clicking (especially submit buttons) */
	afterClick: [number, number];
	/** Delay after OAuth redirects */
	oauthRedirectWait: [number, number];
	/** Delay before typing in a field */
	beforeType: [number, number];
	/** Delay after typing */
	afterType: [number, number];
	/** Delay before scrolling */
	beforeScroll: [number, number];
	/** Delay after scrolling */
	afterScroll: [number, number];
	/** Delay before hovering (for DataDome/PerimeterX) */
	beforeHover: [number, number];
	/** Delay while hovering before click */
	hoverDuration: [number, number];
}

/**
 * Operation types for timing delays
 */
export type TimingOperation =
	| "afterNavigation"
	| "beforeFormFill"
	| "afterFormFill"
	| "beforeClick"
	| "afterClick"
	| "oauthRedirectWait"
	| "beforeType"
	| "afterType"
	| "beforeScroll"
	| "afterScroll"
	| "beforeHover"
	| "hoverDuration";

/**
 * Context bridge message types
 */
export interface ContextBridgeRequest {
	scriptId: number;
	scriptText: string;
}

export interface ContextBridgeResponse {
	scriptId: number;
	fromMain: true;
	result?: unknown;
	error?: string;
}
