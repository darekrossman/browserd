/**
 * CDP Session Manager
 *
 * Handles Chrome DevTools Protocol session for screencast and input dispatch
 * with humanized input support for DataDome/PerimeterX bypass.
 */

import type { CDPSession, Page } from "rebrowser-playwright";
import {
	createEventMessage,
	createFrameMessage,
	type FrameMessage,
	type InputMessage,
	type ServerMessage,
	type Viewport,
} from "../protocol/types";
import {
	generateHoverMicroMovements,
	generateHumanMousePath,
	generateHumanScrollSequence,
	generateHumanTypingSequence,
	getMouseState,
	type HumanBehaviorConfig,
	updateMouseState,
} from "../stealth";

export interface ScreencastOptions {
	format?: "jpeg" | "png";
	quality?: number;
	maxWidth?: number;
	maxHeight?: number;
	everyNthFrame?: number;
}

export interface CDPSessionManagerOptions {
	screencast?: ScreencastOptions;
	onFrame?: (frame: FrameMessage) => void;
	onEvent?: (event: ServerMessage) => void;
	/** Session ID for human behavior state tracking */
	sessionId?: string;
	/** Enable humanized input (bezier mouse curves, typing patterns) */
	humanizedInput?: boolean;
	/** Human behavior configuration */
	humanBehavior?: HumanBehaviorConfig;
}

const DEFAULT_SCREENCAST_OPTIONS: Required<ScreencastOptions> = {
	format: "jpeg",
	quality: 60,
	maxWidth: 1280,
	maxHeight: 720,
	everyNthFrame: 1,
};

/**
 * Manages a CDP session for a page, handling screencast and input
 * with optional humanized input for stealth automation.
 */
export class CDPSessionManager {
	private page: Page;
	private cdpSession: CDPSession | null = null;
	private screencastActive = false;
	private options: CDPSessionManagerOptions;
	private screencastOptions: Required<ScreencastOptions>;
	private viewport: Viewport;
	private frameCount = 0;
	private lastFrameTime = 0;
	private sessionId: string;
	private humanizedInput: boolean;
	private humanBehavior: HumanBehaviorConfig;

	constructor(page: Page, options: CDPSessionManagerOptions = {}) {
		this.page = page;
		this.options = options;
		this.screencastOptions = {
			...DEFAULT_SCREENCAST_OPTIONS,
			...options.screencast,
		};
		this.sessionId =
			options.sessionId ??
			`cdp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
		this.humanizedInput = options.humanizedInput ?? true;
		this.humanBehavior = options.humanBehavior ?? {};

		const viewportSize = page.viewportSize() || { width: 1280, height: 720 };
		this.viewport = {
			w: viewportSize.width,
			h: viewportSize.height,
			dpr: 1, // Will be updated from screencast metadata
		};
	}

	/**
	 * Initialize the CDP session
	 */
	async init(): Promise<void> {
		if (this.cdpSession) {
			return;
		}

		const context = this.page.context();
		this.cdpSession = await context.newCDPSession(this.page);

		// Listen for screencast frames
		this.cdpSession.on(
			"Page.screencastFrame",
			this.handleScreencastFrame.bind(this),
		);

		// Emit ready event
		this.emitEvent(createEventMessage("ready", { viewport: this.viewport }));
	}

	/**
	 * Start screencast streaming
	 */
	async startScreencast(): Promise<void> {
		if (!this.cdpSession) {
			throw new Error("CDP session not initialized. Call init() first.");
		}

		if (this.screencastActive) {
			return;
		}

		await this.cdpSession.send("Page.startScreencast", {
			format: this.screencastOptions.format,
			quality: this.screencastOptions.quality,
			maxWidth: this.screencastOptions.maxWidth,
			maxHeight: this.screencastOptions.maxHeight,
			everyNthFrame: this.screencastOptions.everyNthFrame,
		});

		this.screencastActive = true;
		this.frameCount = 0;
		this.lastFrameTime = Date.now();
	}

	/**
	 * Stop screencast streaming
	 */
	async stopScreencast(): Promise<void> {
		if (!this.cdpSession || !this.screencastActive) {
			return;
		}

		try {
			await this.cdpSession.send("Page.stopScreencast");
		} catch {
			// Ignore errors when stopping (session might already be closed)
		}

		this.screencastActive = false;
	}

	/**
	 * Handle incoming screencast frame from CDP
	 */
	private async handleScreencastFrame(event: {
		data: string;
		metadata: {
			offsetTop: number;
			pageScaleFactor: number;
			deviceWidth: number;
			deviceHeight: number;
			scrollOffsetX: number;
			scrollOffsetY: number;
			timestamp?: number;
		};
		sessionId: number;
	}): Promise<void> {
		const now = Date.now();
		this.frameCount++;

		// Update viewport from metadata
		this.viewport = {
			w: event.metadata.deviceWidth,
			h: event.metadata.deviceHeight,
			dpr: event.metadata.pageScaleFactor,
		};

		// Create and emit frame message
		const frameMessage = createFrameMessage(event.data, this.viewport, now);

		if (this.options.onFrame) {
			this.options.onFrame(frameMessage);
		}

		// Acknowledge the frame to CDP
		if (this.cdpSession) {
			try {
				await this.cdpSession.send("Page.screencastFrameAck", {
					sessionId: event.sessionId,
				});
			} catch {
				// Ignore ack errors
			}
		}

		this.lastFrameTime = now;
	}

	/**
	 * Dispatch a mouse event via CDP
	 */
	async dispatchMouseEvent(input: InputMessage): Promise<void> {
		if (!this.cdpSession || input.device !== "mouse") {
			return;
		}

		const {
			action,
			x = 0,
			y = 0,
			button = "left",
			deltaX = 0,
			deltaY = 0,
			clickCount = 1,
		} = input;

		// Map action to CDP event type
		let type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
		switch (action) {
			case "down":
				type = "mousePressed";
				break;
			case "up":
				type = "mouseReleased";
				break;
			case "move":
				type = "mouseMoved";
				break;
			case "wheel":
				type = "mouseWheel";
				break;
			case "click":
				// Click is down + up
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x,
					y,
					button: this.mapMouseButton(button),
					clickCount,
					modifiers: this.getModifiers(input),
				});
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x,
					y,
					button: this.mapMouseButton(button),
					clickCount,
					modifiers: this.getModifiers(input),
				});
				return;
			case "dblclick":
				// Double click is two clicks with proper clickCount
				// First click
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x,
					y,
					button: this.mapMouseButton(button),
					clickCount: 1,
					modifiers: this.getModifiers(input),
				});
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x,
					y,
					button: this.mapMouseButton(button),
					clickCount: 1,
					modifiers: this.getModifiers(input),
				});
				// Small delay between clicks
				await new Promise((r) => setTimeout(r, 50));
				// Second click with clickCount: 2 to trigger dblclick
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x,
					y,
					button: this.mapMouseButton(button),
					clickCount: 2,
					modifiers: this.getModifiers(input),
				});
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x,
					y,
					button: this.mapMouseButton(button),
					clickCount: 2,
					modifiers: this.getModifiers(input),
				});
				return;
			default:
				return;
		}

		if (type === "mousePressed" || type === "mouseReleased") {
			await this.cdpSession.send("Input.dispatchMouseEvent", {
				type,
				x,
				y,
				button: this.mapMouseButton(button),
				clickCount,
				modifiers: this.getModifiers(input),
			});
		} else if (type === "mouseWheel") {
			await this.cdpSession.send("Input.dispatchMouseEvent", {
				type,
				x,
				y,
				deltaX,
				deltaY,
				modifiers: this.getModifiers(input),
			});
		} else {
			await this.cdpSession.send("Input.dispatchMouseEvent", {
				type,
				x,
				y,
				modifiers: this.getModifiers(input),
			});
		}
	}

	/**
	 * Get the Windows virtual key code for a key
	 */
	private getWindowsVirtualKeyCode(key: string): number | undefined {
		const keyMap: Record<string, number> = {
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
		return keyMap[key];
	}

	/**
	 * Dispatch a keyboard event via CDP
	 */
	async dispatchKeyEvent(input: InputMessage): Promise<void> {
		if (!this.cdpSession || input.device !== "key") {
			return;
		}

		const { action, key = "", code = "", text = "" } = input;
		const windowsVirtualKeyCode = this.getWindowsVirtualKeyCode(key);

		// Map action to CDP event type
		let type: "keyDown" | "keyUp" | "char";
		switch (action) {
			case "down":
				type = "keyDown";
				break;
			case "up":
				type = "keyUp";
				break;
			case "press":
				// Press is down + char (if text) + up
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "keyDown",
					key,
					code,
					windowsVirtualKeyCode,
					modifiers: this.getModifiers(input),
				});
				if (text) {
					await this.cdpSession.send("Input.dispatchKeyEvent", {
						type: "char",
						text,
						modifiers: this.getModifiers(input),
					});
				}
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "keyUp",
					key,
					code,
					windowsVirtualKeyCode,
					modifiers: this.getModifiers(input),
				});
				return;
			default:
				return;
		}

		if (type === "keyDown" && text) {
			await this.cdpSession.send("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				text,
				windowsVirtualKeyCode,
				modifiers: this.getModifiers(input),
			});
		} else {
			await this.cdpSession.send("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				windowsVirtualKeyCode,
				modifiers: this.getModifiers(input),
			});
		}
	}

	/**
	 * Dispatch an input event (mouse or keyboard)
	 */
	async dispatchInput(input: InputMessage): Promise<void> {
		if (input.device === "mouse") {
			await this.dispatchMouseEvent(input);
		} else if (input.device === "key") {
			await this.dispatchKeyEvent(input);
		}
	}

	/**
	 * Get modifier flags from input message
	 */
	private getModifiers(input: InputMessage): number {
		let modifiers = 0;
		if (input.modifiers?.alt) modifiers |= 1;
		if (input.modifiers?.ctrl) modifiers |= 2;
		if (input.modifiers?.meta) modifiers |= 4;
		if (input.modifiers?.shift) modifiers |= 8;
		return modifiers;
	}

	/**
	 * Map mouse button to CDP button name
	 */
	private mapMouseButton(button: string): "none" | "left" | "middle" | "right" {
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
	 * Emit an event through the callback
	 */
	private emitEvent(event: ServerMessage): void {
		if (this.options.onEvent) {
			this.options.onEvent(event);
		}
	}

	/**
	 * Get current viewport
	 */
	getViewport(): Viewport {
		return { ...this.viewport };
	}

	/**
	 * Update screencast settings and restart if active
	 * This is typically called when viewport changes to ensure frames match new dimensions
	 */
	async updateScreencastSettings(
		newOptions: Partial<ScreencastOptions>,
	): Promise<void> {
		const wasActive = this.screencastActive;

		// Update settings
		this.screencastOptions = {
			...this.screencastOptions,
			...newOptions,
		};

		// Restart screencast if it was active
		if (wasActive) {
			await this.stopScreencast();
			await this.startScreencast();
		}
	}

	/**
	 * Get current screencast options
	 */
	getScreencastOptions(): Required<ScreencastOptions> {
		return { ...this.screencastOptions };
	}

	/**
	 * Check if screencast is active
	 */
	isScreencastActive(): boolean {
		return this.screencastActive;
	}

	/**
	 * Get frame statistics
	 */
	getStats(): { frameCount: number; lastFrameTime: number; fps: number } {
		const elapsed = (Date.now() - this.lastFrameTime) / 1000;
		return {
			frameCount: this.frameCount,
			lastFrameTime: this.lastFrameTime,
			fps: elapsed > 0 ? Math.round(this.frameCount / elapsed) : 0,
		};
	}

	// =============================================
	// Humanized Input Methods for Stealth Automation
	// =============================================

	/**
	 * Move mouse with human-like bezier curves
	 * Includes micro-jitter and occasional overshoot
	 */
	async humanMouseMove(targetX: number, targetY: number): Promise<void> {
		if (!this.cdpSession || !this.humanizedInput) {
			// Fall back to direct move
			await this.cdpSession?.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: targetX,
				y: targetY,
			});
			return;
		}

		const viewport = { width: this.viewport.w, height: this.viewport.h };
		const path = generateHumanMousePath(
			this.sessionId,
			targetX,
			targetY,
			viewport,
		);

		for (const point of path) {
			await this.cdpSession.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: point.x,
				y: point.y,
			});
			await new Promise((r) => setTimeout(r, point.delay));
		}

		// Update state
		updateMouseState(this.sessionId, targetX, targetY);
	}

	/**
	 * Perform human-like click with hover behavior
	 * Includes: move to target, hover micro-movements, click
	 */
	async humanClick(
		x: number,
		y: number,
		options?: {
			button?: "left" | "right" | "middle";
			clickCount?: number;
			hoverDuration?: number;
		},
	): Promise<void> {
		if (!this.cdpSession) return;

		const {
			button = "left",
			clickCount = 1,
			hoverDuration = 150,
		} = options ?? {};

		// First move to target with human-like path
		await this.humanMouseMove(x, y);

		// Perform micro-movements while hovering (DataDome/PerimeterX detection)
		if (this.humanizedInput && hoverDuration > 0) {
			const microMovements = generateHoverMicroMovements(x, y, hoverDuration);
			for (const move of microMovements) {
				await this.cdpSession.send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: move.x,
					y: move.y,
				});
				await new Promise((r) => setTimeout(r, move.delay));
			}
		}

		// Perform click
		await this.cdpSession.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: this.mapMouseButton(button),
			clickCount,
		});
		await this.cdpSession.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x,
			y,
			button: this.mapMouseButton(button),
			clickCount,
		});
	}

	/**
	 * Type text with human-like patterns
	 * Includes variable delays, typos with corrections, thinking pauses
	 */
	async humanType(text: string): Promise<void> {
		if (!this.cdpSession) return;

		if (!this.humanizedInput) {
			// Fall back to fast typing
			for (const char of text) {
				await this.dispatchKeyEvent({
					type: "input",
					device: "key",
					action: "press",
					key: char,
					text: char,
				});
			}
			return;
		}

		const sequence = generateHumanTypingSequence(text, this.humanBehavior);

		for (const keystroke of sequence) {
			if (keystroke.isBackspace) {
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "keyDown",
					key: "Backspace",
					code: "Backspace",
					windowsVirtualKeyCode: 8,
				});
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "keyUp",
					key: "Backspace",
					code: "Backspace",
					windowsVirtualKeyCode: 8,
				});
			} else {
				// Type the character
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "keyDown",
					key: keystroke.key,
					text: keystroke.key,
				});
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "char",
					text: keystroke.key,
				});
				await this.cdpSession.send("Input.dispatchKeyEvent", {
					type: "keyUp",
					key: keystroke.key,
				});
			}

			await new Promise((r) => setTimeout(r, keystroke.delay));
		}
	}

	/**
	 * Scroll with human-like behavior
	 * Includes chunked scrolling with variable pauses
	 */
	async humanScroll(direction: "up" | "down", distance: number): Promise<void> {
		if (!this.cdpSession) return;

		const state = getMouseState(this.sessionId, {
			width: this.viewport.w,
			height: this.viewport.h,
		});

		if (!this.humanizedInput) {
			// Fall back to direct scroll
			await this.cdpSession.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: state.x,
				y: state.y,
				deltaX: 0,
				deltaY: direction === "down" ? distance : -distance,
			});
			return;
		}

		const sequence = generateHumanScrollSequence(direction, distance);

		for (const scroll of sequence) {
			await this.cdpSession.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: state.x,
				y: state.y,
				deltaX: 0,
				deltaY: scroll.deltaY,
			});
			await new Promise((r) => setTimeout(r, scroll.delay));
		}
	}

	/**
	 * Get current session ID
	 */
	getSessionId(): string {
		return this.sessionId;
	}

	/**
	 * Enable/disable humanized input
	 */
	setHumanizedInput(enabled: boolean): void {
		this.humanizedInput = enabled;
	}

	/**
	 * Update human behavior config
	 */
	setHumanBehavior(config: Partial<HumanBehaviorConfig>): void {
		this.humanBehavior = { ...this.humanBehavior, ...config };
	}

	/**
	 * Close the CDP session
	 */
	async close(): Promise<void> {
		await this.stopScreencast();

		if (this.cdpSession) {
			try {
				await this.cdpSession.detach();
			} catch {
				// Ignore detach errors
			}
			this.cdpSession = null;
		}
	}
}
