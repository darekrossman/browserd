/**
 * Stealth injection scripts for anti-bot evasion
 *
 * These scripts are injected into pages to mask automation indicators
 * and provide consistent browser fingerprints.
 *
 * Target systems: DataDome, PerimeterX, Cloudflare, Akamai
 */

import type { BrowserProfile, FingerprintConfig } from "./types";

/**
 * Script to clean up Playwright's __pwInitScripts leak
 * This must run FIRST before any other scripts.
 * Uses multiple techniques to hide the property:
 * 1. Delete the property if it exists
 * 2. Override Object.getOwnPropertyNames to filter it out
 * 3. Define a getter that returns undefined
 */
export const PW_INIT_SCRIPTS_CLEANUP = `
(function() {
	// Store original functions
	const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
	const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
	const originalKeys = Object.keys;

	// List of properties to hide
	const hiddenProps = ['__pwInitScripts', '__playwright', '__pw_manual'];

	// Override Object.getOwnPropertyNames to filter hidden props
	Object.getOwnPropertyNames = function(obj) {
		const props = originalGetOwnPropertyNames.call(this, obj);
		if (obj === window || obj === globalThis) {
			return props.filter(p => !hiddenProps.includes(p));
		}
		return props;
	};

	// Override Object.keys similarly
	Object.keys = function(obj) {
		const keys = originalKeys.call(this, obj);
		if (obj === window || obj === globalThis) {
			return keys.filter(k => !hiddenProps.includes(k));
		}
		return keys;
	};

	// Delete existing properties
	hiddenProps.forEach(prop => {
		try {
			delete window[prop];
		} catch(e) {}
	});

	// Redefine as non-enumerable getters returning undefined
	hiddenProps.forEach(prop => {
		try {
			Object.defineProperty(window, prop, {
				get: () => undefined,
				set: () => {},
				configurable: true,
				enumerable: false,
			});
		} catch(e) {}
	});
})();
`;

/**
 * Script to spoof Chrome runtime
 */
export const CHROME_RUNTIME_SPOOF = `
if (!window.chrome) {
	window.chrome = {};
}
window.chrome.runtime = {
	onConnect: { addListener: () => {} },
	onMessage: { addListener: () => {} },
	sendMessage: () => {},
	connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
};
window.chrome.loadTimes = function() {
	return {
		commitLoadTime: Date.now() / 1000 - Math.random() * 5,
		connectionInfo: "h2",
		finishDocumentLoadTime: Date.now() / 1000,
		finishLoadTime: Date.now() / 1000,
		firstPaintAfterLoadTime: 0,
		firstPaintTime: Date.now() / 1000 - Math.random(),
		navigationType: "Other",
		npnNegotiatedProtocol: "h2",
		requestTime: Date.now() / 1000 - Math.random() * 10,
		startLoadTime: Date.now() / 1000 - Math.random() * 5,
		wasAlternateProtocolAvailable: false,
		wasFetchedViaSpdy: true,
		wasNpnNegotiated: true,
	};
};
window.chrome.csi = function() {
	return {
		onloadT: Date.now(),
		pageT: Date.now() - Math.random() * 10000,
		startE: Date.now() - Math.random() * 50000,
		tran: 15,
	};
};
`;

/**
 * Script to handle permissions API properly
 */
export const PERMISSIONS_SPOOF = `
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = function(parameters) {
	if (parameters.name === 'notifications') {
		return Promise.resolve({ state: Notification.permission, onchange: null });
	}
	return originalQuery.call(this, parameters);
};
`;

/**
 * Generate WebGL vendor/renderer spoofing script
 */
export function generateWebGLSpoof(profile: BrowserProfile): string {
	return `
const getParameterProxyHandler = {
	apply(target, thisArg, args) {
		const param = args[0];
		// UNMASKED_VENDOR_WEBGL
		if (param === 37445) return '${profile.webglVendor}';
		// UNMASKED_RENDERER_WEBGL
		if (param === 37446) return '${profile.webglRenderer}';
		return Reflect.apply(target, thisArg, args);
	}
};

const getParameterProxy = new Proxy(
	WebGLRenderingContext.prototype.getParameter,
	getParameterProxyHandler
);
WebGLRenderingContext.prototype.getParameter = getParameterProxy;

if (typeof WebGL2RenderingContext !== 'undefined') {
	const getParameterProxy2 = new Proxy(
		WebGL2RenderingContext.prototype.getParameter,
		getParameterProxyHandler
	);
	WebGL2RenderingContext.prototype.getParameter = getParameterProxy2;
}
`;
}

/**
 * Canvas fingerprint noise injection
 * Adds imperceptible noise to break fingerprint databases
 */
export const CANVAS_NOISE = `
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
	const context = this.getContext('2d');
	if (context) {
		const imageData = context.getImageData(0, 0, this.width, this.height);
		const data = imageData.data;
		// Add subtle noise that doesn't visibly affect the image
		for (let i = 0; i < data.length; i += 4) {
			// Only modify every 100th pixel slightly
			if (i % 400 === 0) {
				data[i] = Math.min(255, data[i] + (Math.random() > 0.5 ? 1 : -1));
			}
		}
		context.putImageData(imageData, 0, 0);
	}
	return originalToDataURL.call(this, type, quality);
};

const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
	const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
	const data = imageData.data;
	// Add subtle noise
	for (let i = 0; i < data.length; i += 4) {
		if (i % 400 === 0) {
			data[i] = Math.min(255, data[i] + (Math.random() > 0.5 ? 1 : -1));
		}
	}
	return imageData;
};
`;

/**
 * Audio context fingerprint spoofing
 */
export const AUDIO_SPOOF = `
const originalGetChannelData = AudioBuffer.prototype.getChannelData;
AudioBuffer.prototype.getChannelData = function(channel) {
	const data = originalGetChannelData.call(this, channel);
	// Add imperceptible noise to audio fingerprint
	for (let i = 0; i < data.length; i += 100) {
		data[i] = data[i] + (Math.random() * 0.0001 - 0.00005);
	}
	return data;
};

const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
AudioContext.prototype.createAnalyser = function() {
	const analyser = originalCreateAnalyser.call(this);
	const originalGetFloatFrequencyData = analyser.getFloatFrequencyData;
	analyser.getFloatFrequencyData = function(array) {
		originalGetFloatFrequencyData.call(this, array);
		for (let i = 0; i < array.length; i += 10) {
			array[i] = array[i] + (Math.random() * 0.1 - 0.05);
		}
	};
	return analyser;
};
`;

/**
 * WebRTC IP leak prevention
 * Prevents real IP from being exposed via WebRTC
 */
export const WEBRTC_PROTECTION = `
// Override RTCPeerConnection to prevent IP leaks
const originalRTCPeerConnection = window.RTCPeerConnection;
const originalWebkitRTCPeerConnection = window.webkitRTCPeerConnection;

function patchedRTCPeerConnection(config, constraints) {
	// Force disable non-proxied UDP to prevent IP leaks
	if (config && config.iceServers) {
		config.iceServers = config.iceServers.map(server => {
			if (server.urls) {
				// Filter out STUN/TURN servers that could leak IP
				const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
				server.urls = urls.filter(url => !url.includes('stun:'));
			}
			return server;
		});
	}

	const pc = originalRTCPeerConnection
		? new originalRTCPeerConnection(config, constraints)
		: new originalWebkitRTCPeerConnection(config, constraints);

	// Override createDataChannel to prevent fingerprinting
	const originalCreateDataChannel = pc.createDataChannel.bind(pc);
	pc.createDataChannel = function(label, options) {
		return originalCreateDataChannel(label, options);
	};

	return pc;
}

if (originalRTCPeerConnection) {
	window.RTCPeerConnection = patchedRTCPeerConnection;
	window.RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
}
if (originalWebkitRTCPeerConnection) {
	window.webkitRTCPeerConnection = patchedRTCPeerConnection;
}
`;

/**
 * Performance timing noise
 * Adds slight randomness to performance.now() to prevent timing attacks
 */
export const PERFORMANCE_TIMING_NOISE = `
// Add noise to performance.now() to prevent timing-based fingerprinting
const originalPerformanceNow = performance.now.bind(performance);
const randomOffset = Math.random() * 0.1; // Small random offset

performance.now = function() {
	// Add small random noise (0-0.1ms) to each call
	return originalPerformanceNow() + randomOffset + (Math.random() * 0.05);
};

// Also add noise to Date.now() for consistency
const originalDateNow = Date.now;
Date.now = function() {
	return originalDateNow() + Math.floor(Math.random() * 2);
};
`;

/**
 * Screen and display spoofing
 * Provides consistent screen info
 */
export const SCREEN_SPOOF = `
// Spoof screen properties for consistency
Object.defineProperty(screen, 'colorDepth', {
	get: () => 24,
	configurable: true,
});

Object.defineProperty(screen, 'pixelDepth', {
	get: () => 24,
	configurable: true,
});

// Spoof available screen dimensions to match viewport
Object.defineProperty(screen, 'availWidth', {
	get: () => screen.width,
	configurable: true,
});

Object.defineProperty(screen, 'availHeight', {
	get: () => screen.height,
	configurable: true,
});

Object.defineProperty(screen, 'availTop', {
	get: () => 0,
	configurable: true,
});

Object.defineProperty(screen, 'availLeft', {
	get: () => 0,
	configurable: true,
});
`;

/**
 * Combine all stealth scripts for a given profile
 *
 * IMPORTANT: rebrowser-playwright handles navigator.webdriver and other core
 * navigator properties internally. DO NOT add scripts that use
 * Object.defineProperty(navigator, ...) as this creates "own" properties
 * that are detectable via Object.getOwnPropertyNames(navigator).
 *
 * Only include scripts that:
 * - Modify non-navigator objects (window.chrome, WebGL, Canvas, Audio, etc.)
 * - Wrap existing methods rather than replacing properties
 */
export function generateStealthScript(
	profile: BrowserProfile,
	options?: FingerprintConfig,
): string {
	const scripts: string[] = [
		// MUST BE FIRST: Clean up Playwright's __pwInitScripts leak
		PW_INIT_SCRIPTS_CLEANUP,
		// Chrome runtime spoof (modifies window.chrome, not navigator)
		CHROME_RUNTIME_SPOOF,
		// Permissions API wrapper (wraps method, doesn't add own property)
		PERMISSIONS_SPOOF,
	];

	// Optional fingerprint masking (these modify non-navigator objects)
	if (options?.webgl !== false) {
		scripts.push(generateWebGLSpoof(profile));
	}

	if (options?.canvas !== false) {
		scripts.push(CANVAS_NOISE);
	}

	if (options?.audio !== false) {
		scripts.push(AUDIO_SPOOF);
	}

	// WebRTC protection (modifies RTCPeerConnection, not navigator)
	if (options?.webrtc !== false) {
		scripts.push(WEBRTC_PROTECTION);
	}

	// Performance timing noise (modifies performance object)
	if (options?.performance !== false) {
		scripts.push(PERFORMANCE_TIMING_NOISE);
	}

	// Screen spoof (modifies screen object, not navigator)
	if (options?.screen !== false) {
		scripts.push(SCREEN_SPOOF);
	}

	return scripts.join("\n\n");
}

/**
 * Known bot detection domains to block
 */
export const BOT_DETECTION_DOMAINS = [
	"**/recaptcha/**",
	"**/captcha/**",
	"**datadome**",
	"**perimeterx**",
	"**px-cdn**",
	"**imperva**",
	"**distil**",
	"**kasada**",
	"**akamai**bot**",
	"**cloudflare**turnstile**",
] as const;
