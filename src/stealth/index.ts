/**
 * Stealth module for browserd
 *
 * Provides comprehensive anti-bot evasion capabilities:
 * - Browser fingerprint profiles
 * - Fingerprint masking scripts (Canvas, WebGL, Audio)
 * - Human behavior emulation (mouse, keyboard, scroll)
 * - Action timing with fatigue simulation
 * - Context bridge for alwaysIsolated mode
 *
 * Target systems: DataDome, PerimeterX, Cloudflare, Akamai
 */

// Context bridge
export {
	clickInMainContext,
	contentInMainContext,
	dblclickInMainContext,
	evaluateInMainContext,
	fillInMainContext,
	focusInMainContext,
	hoverInMainContext,
	ISOLATED_CONTEXT_BRIDGE_SCRIPT,
	initializeContextBridge,
	inputValueInMainContext,
	MAIN_CONTEXT_BRIDGE_SCRIPT,
	MAIN_CONTEXT_BRIDGE_SCRIPT_CSP_SAFE,
	querySelectorInMainContext,
	setupIsolatedContextHelper,
	textContentInMainContext,
	typeInMainContext,
	waitForMainContextObject,
	waitForSelectorInMainContext,
} from "./context-bridge";
// Human behavior
export {
	cleanupMouseState,
	DEFAULT_HUMAN_BEHAVIOR,
	generateHoverMicroMovements,
	generateHumanMousePath,
	generateHumanScrollSequence,
	generateHumanTypingSequence,
	generateIdleMouseDrift,
	getAdjacentKey,
	getMouseState,
	getRandomClickPoint,
	humanDelay,
	randomBetween,
	randomSleep,
	stopIdleMouseSimulation,
	updateMouseState,
} from "./human-behavior";

// Profiles
export {
	BROWSER_PROFILES,
	CHROME_LINUX,
	CHROME_MAC,
	CHROME_WIN,
	FIREFOX_MAC,
	FIREFOX_WIN,
	getProfile,
	getRandomProfile,
	getRandomViewport,
	VIEWPORT_VARIATIONS,
} from "./profiles";

// Scripts
export {
	AUDIO_SPOOF,
	BOT_DETECTION_DOMAINS,
	CANVAS_NOISE,
	CHROME_RUNTIME_SPOOF,
	generateStealthScript,
	generateWebGLSpoof,
	PERFORMANCE_TIMING_NOISE,
	PERMISSIONS_SPOOF,
	PW_INIT_SCRIPTS_CLEANUP,
	SCREEN_SPOOF,
	WEBRTC_PROTECTION,
} from "./scripts";
// Timing
export {
	applyTimingDelay,
	clearSessionTimingConfig,
	DEFAULT_TIMING_CONFIG,
	FAST_TIMING_CONFIG,
	getSessionTimingConfig,
	isLoginPage,
	isOAuthRedirect,
	setSessionTimingConfig,
	withTiming,
} from "./timing";
// Types
export type {
	BrowserProfile,
	ContextBridgeRequest,
	ContextBridgeResponse,
	FingerprintConfig,
	HumanBehaviorConfig,
	MouseState,
	ProfileName,
	StealthConfig,
	TimingConfig,
	TimingOperation,
} from "./types";
export { DEFAULT_STEALTH_CONFIG } from "./types";
