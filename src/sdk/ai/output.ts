/**
 * Output transformation for AI-readable results
 */

import type { BrowserResult } from "./types";

interface ToModelOutputParams {
	output: BrowserResult;
}

interface ModelOutput {
	type: "text" | "error-text";
	value: string;
}

/**
 * Convert BrowserResult to AI-readable text output
 */
export function toModelOutput({ output }: ToModelOutputParams): ModelOutput {
	if (output.status === "error") {
		let errorMsg = `Browser ${output.operation} failed: ${output.error}`;
		if (output.sessionId) {
			errorMsg += `\nSession: ${output.sessionId}`;
		}
		return { type: "error-text", value: errorMsg };
	}

	let value = `Browser ${output.operation} completed successfully.`;

	// Always include sessionId for tracking
	if (output.sessionId) {
		value += `\nSession: ${output.sessionId}`;
	}

	value += "\n";
	const data = output.data ?? {};

	switch (output.operation) {
		case "navigate":
			value += `URL: ${data.url}\n`;
			if (data.title) value += `Title: ${data.title}\n`;
			break;

		case "goBack":
		case "goForward":
		case "reload":
			value += "Navigation action completed.\n";
			break;

		case "click":
		case "dblclick":
		case "hover":
		case "fill":
			value += `Selector: ${data.selector}\n`;
			break;

		case "type":
			value += `Selector: ${data.selector}\n`;
			value += `Typed ${data.textLength} characters.\n`;
			break;

		case "press":
			value += `Key: ${data.key}\n`;
			break;

		case "waitForSelector":
			value += `Selector: ${data.selector}\n`;
			value += `State: ${data.state}\n`;
			break;

		case "evaluate": {
			value += `Result type: ${data.resultType}\n`;
			const resultStr = JSON.stringify(data.result, null, 2);
			// Truncate long results
			if (resultStr.length > 5000) {
				value += `Result: ${resultStr.slice(0, 5000)}... (truncated)\n`;
			} else {
				value += `Result: ${resultStr}\n`;
			}
			break;
		}

		case "screenshot":
			value += `Format: ${data.format}\n`;
			value += `Size: ${data.size} bytes\n`;
			value += "(base64 data available in screenshot field)\n";
			break;

		case "setViewport":
			value += `Viewport set to ${data.width}x${data.height}\n`;
			break;

		case "closeSession":
			value +=
				"Browser session closed. You can start a new session by calling the browser tool without a sessionId.\n";
			break;

		default:
			if (Object.keys(data).length > 0) {
				value += JSON.stringify(data, null, 2);
			}
	}

	return { type: "text", value };
}
