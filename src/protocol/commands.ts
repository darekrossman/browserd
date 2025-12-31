/**
 * Command Definitions
 *
 * Type definitions and schemas for Playwright RPC commands
 */

import type { PlaywrightMethod } from "./types";

/**
 * Parameter schema for validation
 */
export interface ParamSchema {
	type: "string" | "number" | "boolean" | "object";
	required?: boolean;
	description?: string;
	default?: unknown;
}

/**
 * Command definition with parameter schemas
 */
export interface CommandDefinition {
	method: PlaywrightMethod;
	description: string;
	params: Record<string, ParamSchema>;
	returns: string;
}

/**
 * All command definitions
 */
export const COMMAND_DEFINITIONS: CommandDefinition[] = [
	{
		method: "navigate",
		description: "Navigate to a URL",
		params: {
			url: {
				type: "string",
				required: true,
				description: "URL to navigate to",
			},
			waitUntil: {
				type: "string",
				required: false,
				description: "When to consider navigation complete",
				default: "domcontentloaded",
			},
			timeout: {
				type: "number",
				required: false,
				description: "Navigation timeout in ms",
				default: 30000,
			},
		},
		returns: "{ url: string }",
	},
	{
		method: "click",
		description: "Click on an element",
		params: {
			selector: {
				type: "string",
				required: true,
				description: "Element selector",
			},
			button: {
				type: "string",
				required: false,
				description: "Mouse button (left, right, middle)",
				default: "left",
			},
			clickCount: {
				type: "number",
				required: false,
				description: "Number of clicks",
				default: 1,
			},
			delay: {
				type: "number",
				required: false,
				description: "Delay between clicks in ms",
			},
			timeout: {
				type: "number",
				required: false,
				description: "Timeout in ms",
				default: 30000,
			},
		},
		returns: "{ clicked: string }",
	},
	{
		method: "dblclick",
		description: "Double-click on an element",
		params: {
			selector: {
				type: "string",
				required: true,
				description: "Element selector",
			},
			button: { type: "string", required: false, default: "left" },
			delay: { type: "number", required: false },
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ dblclicked: string }",
	},
	{
		method: "hover",
		description: "Hover over an element",
		params: {
			selector: {
				type: "string",
				required: true,
				description: "Element selector",
			},
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ hovered: string }",
	},
	{
		method: "type",
		description: "Type text into an element",
		params: {
			selector: {
				type: "string",
				required: true,
				description: "Element selector",
			},
			text: { type: "string", required: true, description: "Text to type" },
			delay: {
				type: "number",
				required: false,
				description: "Delay between keystrokes in ms",
			},
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ typed: string, into: string }",
	},
	{
		method: "press",
		description: "Press a key",
		params: {
			key: {
				type: "string",
				required: true,
				description: "Key to press (e.g., Enter, Tab)",
			},
			selector: {
				type: "string",
				required: false,
				description: "Optional element selector",
			},
			delay: { type: "number", required: false },
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ pressed: string }",
	},
	{
		method: "fill",
		description: "Fill an input field (clears existing content)",
		params: {
			selector: {
				type: "string",
				required: true,
				description: "Element selector",
			},
			value: { type: "string", required: true, description: "Value to fill" },
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ filled: string, with: string }",
	},
	{
		method: "waitForSelector",
		description: "Wait for an element to appear",
		params: {
			selector: {
				type: "string",
				required: true,
				description: "Element selector",
			},
			state: {
				type: "string",
				required: false,
				description: "State to wait for (visible, hidden, attached, detached)",
				default: "visible",
			},
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ found: string }",
	},
	{
		method: "setViewport",
		description: "Set viewport size",
		params: {
			width: { type: "number", required: true, description: "Viewport width" },
			height: {
				type: "number",
				required: true,
				description: "Viewport height",
			},
		},
		returns: "{ viewport: { width: number, height: number } }",
	},
	{
		method: "evaluate",
		description: "Evaluate JavaScript in the page",
		params: {
			expression: {
				type: "string",
				required: true,
				description: "JavaScript expression to evaluate",
			},
		},
		returns: "{ result: unknown }",
	},
	{
		method: "screenshot",
		description: "Take a screenshot",
		params: {
			fullPage: {
				type: "boolean",
				required: false,
				description: "Capture full page",
			},
			type: {
				type: "string",
				required: false,
				description: "Image type (png, jpeg)",
				default: "png",
			},
			quality: {
				type: "number",
				required: false,
				description: "JPEG quality (0-100)",
			},
		},
		returns: "{ data: string, type: string }",
	},
	{
		method: "goBack",
		description: "Navigate back in history",
		params: {
			waitUntil: {
				type: "string",
				required: false,
				default: "domcontentloaded",
			},
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ url: string }",
	},
	{
		method: "goForward",
		description: "Navigate forward in history",
		params: {
			waitUntil: {
				type: "string",
				required: false,
				default: "domcontentloaded",
			},
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ url: string }",
	},
	{
		method: "reload",
		description: "Reload the current page",
		params: {
			waitUntil: {
				type: "string",
				required: false,
				default: "domcontentloaded",
			},
			timeout: { type: "number", required: false, default: 30000 },
		},
		returns: "{ url: string }",
	},
];

/**
 * Get command definition by method name
 */
export function getCommandDefinition(
	method: PlaywrightMethod,
): CommandDefinition | undefined {
	return COMMAND_DEFINITIONS.find((def) => def.method === method);
}

/**
 * Validate command parameters
 */
export function validateCommandParams(
	method: PlaywrightMethod,
	params: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
	const definition = getCommandDefinition(method);
	if (!definition) {
		return { valid: false, errors: [`Unknown method: ${method}`] };
	}

	const errors: string[] = [];

	// Check required params
	for (const [name, schema] of Object.entries(definition.params)) {
		if (schema.required && params[name] === undefined) {
			errors.push(`Missing required parameter: ${name}`);
		}
	}

	// Check param types
	for (const [name, value] of Object.entries(params)) {
		const schema = definition.params[name];
		if (schema && value !== undefined) {
			const actualType = typeof value;
			if (schema.type !== actualType) {
				errors.push(
					`Invalid type for parameter ${name}: expected ${schema.type}, got ${actualType}`,
				);
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Get all available methods
 */
export function getAvailableMethods(): PlaywrightMethod[] {
	return COMMAND_DEFINITIONS.map((def) => def.method);
}

/**
 * Generate help text for a command
 */
export function getCommandHelp(method: PlaywrightMethod): string | null {
	const definition = getCommandDefinition(method);
	if (!definition) return null;

	const lines = [`${method}: ${definition.description}`];
	lines.push("Parameters:");

	for (const [name, schema] of Object.entries(definition.params)) {
		const required = schema.required ? " (required)" : "";
		const defaultVal =
			schema.default !== undefined ? ` [default: ${schema.default}]` : "";
		lines.push(`  ${name}: ${schema.type}${required}${defaultVal}`);
		if (schema.description) {
			lines.push(`    ${schema.description}`);
		}
	}

	lines.push(`Returns: ${definition.returns}`);

	return lines.join("\n");
}
