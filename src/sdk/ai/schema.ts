/**
 * Zod schema for browser tool input validation
 */

import { z } from "zod";

/**
 * Input schema for the browser tool.
 * Uses a flat structure with an operation discriminator field.
 */
export const browserToolInputSchema = z.object({
	operation: z
		.enum([
			"navigate",
			"goBack",
			"goForward",
			"reload",
			"click",
			"dblclick",
			"hover",
			"type",
			"fill",
			"press",
			"waitForSelector",
			"evaluate",
			"screenshot",
			"setViewport",
			"closeSession",
			"requestHumanIntervention",
		])
		.describe("The browser operation to perform"),

	// Session management
	sessionId: z
		.string()
		.optional()
		.describe(
			"Session ID from a previous call. REQUIRED for all calls after the first one to maintain your browser session. " +
				"If not provided, a new session will be created.",
		),

	// Common
	timeout: z
		.number()
		.optional()
		.describe("Operation timeout in milliseconds (default: 30000)"),

	// Navigate
	url: z.string().optional().describe("URL to navigate to (navigate only)"),
	waitUntil: z
		.enum(["load", "domcontentloaded", "networkidle"])
		.optional()
		.describe("When to consider navigation complete (navigate only)"),

	// Element selector (click, dblclick, hover, type, fill, waitForSelector)
	selector: z
		.string()
		.optional()
		.describe(
			"CSS selector, XPath, text, or other locator (click, dblclick, hover, type, fill, waitForSelector)",
		),

	// Click options
	button: z
		.enum(["left", "right", "middle"])
		.optional()
		.describe("Mouse button (click, dblclick only)"),
	clickCount: z.number().optional().describe("Number of clicks (click only)"),

	// Type/Fill
	text: z
		.string()
		.optional()
		.describe("Text to type character by character (type only)"),
	value: z
		.string()
		.optional()
		.describe("Value to fill, clears existing content (fill only)"),
	delay: z
		.number()
		.optional()
		.describe("Delay between keystrokes in ms (type, click, dblclick, press)"),

	// Press
	key: z
		.string()
		.optional()
		.describe("Key or key combination to press (press only)"),

	// WaitForSelector
	state: z
		.enum(["visible", "hidden", "attached", "detached"])
		.optional()
		.describe("State to wait for (waitForSelector only)"),

	// Evaluate
	expression: z
		.string()
		.optional()
		.describe("JavaScript expression to evaluate (evaluate only)"),
	args: z
		.array(z.unknown())
		.optional()
		.describe("Arguments for evaluation (evaluate only)"),

	// Screenshot
	fullPage: z
		.boolean()
		.optional()
		.describe("Capture full scrollable page (screenshot only)"),
	type: z
		.enum(["png", "jpeg"])
		.optional()
		.describe("Image format (screenshot only)"),
	quality: z
		.number()
		.optional()
		.describe("JPEG quality 0-100 (screenshot only, jpeg format)"),

	// SetViewport
	width: z
		.number()
		.optional()
		.describe("Viewport width in pixels (setViewport only)"),
	height: z
		.number()
		.optional()
		.describe("Viewport height in pixels (setViewport only)"),

	// Human Intervention
	reason: z
		.string()
		.optional()
		.describe(
			"Why human intervention is needed (requestHumanIntervention only). " +
				"E.g., 'CAPTCHA detected', 'Login required', 'Complex verification'",
		),
	instructions: z
		.string()
		.optional()
		.describe(
			"Clear instructions for the human on what to do (requestHumanIntervention only). " +
				"E.g., 'Please solve the CAPTCHA and click Mark Complete when done'",
		),
});

export type BrowserToolInput = z.infer<typeof browserToolInputSchema>;
