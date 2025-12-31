/**
 * Input Mapper
 *
 * Maps client coordinates and input events to CDP-compatible format
 */

import type { InputMessage, MouseButton, Viewport } from "./types";

/**
 * CDP modifier flags
 */
export const ModifierFlags = {
	ALT: 1,
	CTRL: 2,
	META: 4,
	SHIFT: 8,
} as const;

/**
 * Scaling configuration for coordinate mapping
 */
export interface ScaleConfig {
	sourceWidth: number;
	sourceHeight: number;
	targetWidth: number;
	targetHeight: number;
	dpr?: number;
}

/**
 * CDP mouse event parameters
 */
export interface CDPMouseParams {
	type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
	x: number;
	y: number;
	modifiers: number;
	button?: "none" | "left" | "middle" | "right" | "back" | "forward";
	clickCount?: number;
	deltaX?: number;
	deltaY?: number;
}

/**
 * CDP keyboard event parameters
 */
export interface CDPKeyParams {
	type: "keyDown" | "keyUp" | "char" | "rawKeyDown";
	modifiers: number;
	key?: string;
	code?: string;
	text?: string;
	windowsVirtualKeyCode?: number;
	nativeVirtualKeyCode?: number;
}

/**
 * Scale coordinates from client viewport to browser viewport
 */
export function scaleCoordinates(
	clientX: number,
	clientY: number,
	config: ScaleConfig,
): { x: number; y: number } {
	const {
		sourceWidth,
		sourceHeight,
		targetWidth,
		targetHeight,
		dpr = 1,
	} = config;

	// Handle edge cases
	if (sourceWidth <= 0 || sourceHeight <= 0) {
		return { x: 0, y: 0 };
	}

	// Calculate scale factors
	const scaleX = targetWidth / sourceWidth;
	const scaleY = targetHeight / sourceHeight;

	// Scale and apply DPR
	let x = Math.round(clientX * scaleX);
	let y = Math.round(clientY * scaleY);

	// Clamp to viewport bounds
	x = Math.max(0, Math.min(x, targetWidth - 1));
	y = Math.max(0, Math.min(y, targetHeight - 1));

	return { x, y };
}

/**
 * Convert modifiers object to CDP modifier flags
 */
export function modifiersToFlags(modifiers?: {
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	meta?: boolean;
}): number {
	if (!modifiers) return 0;

	let flags = 0;
	if (modifiers.alt) flags |= ModifierFlags.ALT;
	if (modifiers.ctrl) flags |= ModifierFlags.CTRL;
	if (modifiers.meta) flags |= ModifierFlags.META;
	if (modifiers.shift) flags |= ModifierFlags.SHIFT;
	return flags;
}

/**
 * Convert CDP modifier flags to modifiers object
 */
export function flagsToModifiers(flags: number): {
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	meta: boolean;
} {
	return {
		alt: (flags & ModifierFlags.ALT) !== 0,
		ctrl: (flags & ModifierFlags.CTRL) !== 0,
		meta: (flags & ModifierFlags.META) !== 0,
		shift: (flags & ModifierFlags.SHIFT) !== 0,
	};
}

/**
 * Map mouse button to CDP button name
 */
export function mapMouseButton(
	button?: MouseButton,
): "none" | "left" | "middle" | "right" {
	switch (button) {
		case "left":
			return "left";
		case "middle":
			return "middle";
		case "right":
			return "right";
		default:
			return "none";
	}
}

/**
 * Map mouse action to CDP event type
 */
export function mapMouseAction(action: string): CDPMouseParams["type"] | null {
	switch (action) {
		case "move":
			return "mouseMoved";
		case "down":
			return "mousePressed";
		case "up":
			return "mouseReleased";
		case "wheel":
			return "mouseWheel";
		default:
			return null;
	}
}

/**
 * Map keyboard action to CDP event type
 */
export function mapKeyAction(action: string): CDPKeyParams["type"] | null {
	switch (action) {
		case "down":
			return "keyDown";
		case "up":
			return "keyUp";
		case "press":
			return "keyDown"; // Press is handled as down + char + up sequence
		default:
			return null;
	}
}

/**
 * Convert InputMessage to CDP mouse event parameters
 */
export function inputToMouseParams(
	input: InputMessage,
	viewport: Viewport,
	clientViewport?: { width: number; height: number },
): CDPMouseParams | null {
	if (input.device !== "mouse") return null;

	const type = mapMouseAction(input.action);
	if (!type) return null;

	// Scale coordinates if client viewport provided
	let x = input.x ?? 0;
	let y = input.y ?? 0;

	if (
		clientViewport &&
		(clientViewport.width !== viewport.w ||
			clientViewport.height !== viewport.h)
	) {
		const scaled = scaleCoordinates(x, y, {
			sourceWidth: clientViewport.width,
			sourceHeight: clientViewport.height,
			targetWidth: viewport.w,
			targetHeight: viewport.h,
			dpr: viewport.dpr,
		});
		x = scaled.x;
		y = scaled.y;
	}

	const params: CDPMouseParams = {
		type,
		x,
		y,
		modifiers: modifiersToFlags(input.modifiers),
	};

	if (type === "mousePressed" || type === "mouseReleased") {
		params.button = mapMouseButton(input.button);
		params.clickCount = input.clickCount ?? 1;
	}

	if (type === "mouseWheel") {
		params.deltaX = input.deltaX ?? 0;
		params.deltaY = input.deltaY ?? 0;
	}

	return params;
}

/**
 * Convert InputMessage to CDP keyboard event parameters
 */
export function inputToKeyParams(input: InputMessage): CDPKeyParams | null {
	if (input.device !== "key") return null;

	const type = mapKeyAction(input.action);
	if (!type) return null;

	const params: CDPKeyParams = {
		type,
		modifiers: modifiersToFlags(input.modifiers),
		key: input.key,
		code: input.code,
	};

	// Add text for character input
	if (input.text) {
		params.text = input.text;
	}

	// Add virtual key codes for special keys
	const vkCode = getVirtualKeyCode(input.key);
	if (vkCode) {
		params.windowsVirtualKeyCode = vkCode;
		params.nativeVirtualKeyCode = vkCode;
	}

	return params;
}

/**
 * Get Windows virtual key code for common keys
 */
export function getVirtualKeyCode(key?: string): number | undefined {
	if (!key) return undefined;

	const codes: Record<string, number> = {
		Backspace: 8,
		Tab: 9,
		Enter: 13,
		Shift: 16,
		Control: 17,
		Alt: 18,
		Pause: 19,
		CapsLock: 20,
		Escape: 27,
		Space: 32,
		" ": 32,
		PageUp: 33,
		PageDown: 34,
		End: 35,
		Home: 36,
		ArrowLeft: 37,
		ArrowUp: 38,
		ArrowRight: 39,
		ArrowDown: 40,
		Insert: 45,
		Delete: 46,
		Meta: 91,
		F1: 112,
		F2: 113,
		F3: 114,
		F4: 115,
		F5: 116,
		F6: 117,
		F7: 118,
		F8: 119,
		F9: 120,
		F10: 121,
		F11: 122,
		F12: 123,
	};

	// Check for special key
	if (codes[key]) {
		return codes[key];
	}

	// Single character - return ASCII code
	if (key.length === 1) {
		const code = key.toUpperCase().charCodeAt(0);
		// 0-9
		if (code >= 48 && code <= 57) return code;
		// A-Z
		if (code >= 65 && code <= 90) return code;
	}

	return undefined;
}

/**
 * Input mapper class for stateful coordinate scaling
 */
export class InputMapper {
	private viewport: Viewport;
	private clientViewport: { width: number; height: number } | null = null;

	constructor(viewport: Viewport) {
		this.viewport = { ...viewport };
	}

	/**
	 * Set the browser viewport
	 */
	setViewport(viewport: Viewport): void {
		this.viewport = { ...viewport };
	}

	/**
	 * Set the client viewport for coordinate scaling
	 */
	setClientViewport(width: number, height: number): void {
		this.clientViewport = { width, height };
	}

	/**
	 * Get current viewport
	 */
	getViewport(): Viewport {
		return { ...this.viewport };
	}

	/**
	 * Convert input message to CDP mouse params
	 */
	toMouseParams(input: InputMessage): CDPMouseParams | null {
		return inputToMouseParams(
			input,
			this.viewport,
			this.clientViewport ?? undefined,
		);
	}

	/**
	 * Convert input message to CDP key params
	 */
	toKeyParams(input: InputMessage): CDPKeyParams | null {
		return inputToKeyParams(input);
	}

	/**
	 * Scale coordinates from client to browser
	 */
	scalePoint(clientX: number, clientY: number): { x: number; y: number } {
		if (!this.clientViewport) {
			return { x: clientX, y: clientY };
		}

		return scaleCoordinates(clientX, clientY, {
			sourceWidth: this.clientViewport.width,
			sourceHeight: this.clientViewport.height,
			targetWidth: this.viewport.w,
			targetHeight: this.viewport.h,
			dpr: this.viewport.dpr,
		});
	}
}
