/**
 * Browser profiles for fingerprint consistency
 *
 * Each profile provides a complete, consistent set of browser fingerprint data
 * that mimics a real browser on a specific platform.
 */

import type { BrowserProfile, ProfileName } from "./types";

/**
 * Chrome on macOS (Apple Silicon)
 */
export const CHROME_MAC: BrowserProfile = {
	name: "chrome-mac",
	userAgent:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	platform: "MacIntel",
	vendor: "Google Inc.",
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 2,
	locale: "en-US",
	timezone: "America/New_York",
	webglVendor: "Google Inc. (Apple)",
	webglRenderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
};

/**
 * Chrome on Windows
 */
export const CHROME_WIN: BrowserProfile = {
	name: "chrome-win",
	userAgent:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	platform: "Win32",
	vendor: "Google Inc.",
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 1,
	locale: "en-US",
	timezone: "America/Chicago",
	webglVendor: "Google Inc. (NVIDIA)",
	webglRenderer:
		"ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
};

/**
 * Chrome on Linux
 */
export const CHROME_LINUX: BrowserProfile = {
	name: "chrome-linux",
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	platform: "Linux x86_64",
	vendor: "Google Inc.",
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 1,
	locale: "en-US",
	timezone: "America/Los_Angeles",
	webglVendor: "Google Inc. (Intel)",
	webglRenderer:
		"ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)",
};

/**
 * Firefox on macOS
 */
export const FIREFOX_MAC: BrowserProfile = {
	name: "firefox-mac",
	userAgent:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
	platform: "MacIntel",
	vendor: "",
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	locale: "en-US",
	timezone: "America/New_York",
	webglVendor: "Intel Inc.",
	webglRenderer: "Intel(R) Iris(TM) Plus Graphics OpenGL Engine",
};

/**
 * Firefox on Windows
 */
export const FIREFOX_WIN: BrowserProfile = {
	name: "firefox-win",
	userAgent:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
	platform: "Win32",
	vendor: "",
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 1,
	locale: "en-US",
	timezone: "America/Chicago",
	webglVendor: "NVIDIA Corporation",
	webglRenderer: "GeForce RTX 3080/PCIe/SSE2",
};

/**
 * All available profiles
 */
export const BROWSER_PROFILES: Record<string, BrowserProfile> = {
	"chrome-mac": CHROME_MAC,
	"chrome-win": CHROME_WIN,
	"chrome-linux": CHROME_LINUX,
	"firefox-mac": FIREFOX_MAC,
	"firefox-win": FIREFOX_WIN,
};

/**
 * Get a random browser profile
 */
export function getRandomProfile(): BrowserProfile {
	const profiles = Object.values(BROWSER_PROFILES);
	const index = Math.floor(Math.random() * profiles.length);
	return profiles[index]!;
}

/**
 * Get a browser profile by name
 */
export function getProfile(name: ProfileName): BrowserProfile {
	if (name === "random") {
		return getRandomProfile();
	}
	return BROWSER_PROFILES[name] ?? CHROME_MAC;
}

/**
 * Viewport variations for more realistic fingerprinting
 * These represent common screen resolutions
 */
export const VIEWPORT_VARIATIONS = [
	{ width: 1920, height: 1080 }, // Full HD
	{ width: 1440, height: 900 }, // MacBook Pro 15"
	{ width: 1536, height: 864 }, // Common Windows laptop
	{ width: 1366, height: 768 }, // Common laptop
	{ width: 2560, height: 1440 }, // QHD
	{ width: 1680, height: 1050 }, // WSXGA+
] as const;

/**
 * Get a random viewport from common variations
 */
export function getRandomViewport(): { width: number; height: number } {
	const variation =
		VIEWPORT_VARIATIONS[
			Math.floor(Math.random() * VIEWPORT_VARIATIONS.length)
		] ?? VIEWPORT_VARIATIONS[0]!;
	return { width: variation.width, height: variation.height };
}
