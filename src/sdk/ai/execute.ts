/**
 * Execute function that maps operations to BrowserdClient methods
 */

import type { BrowserdClient } from "../client";
import type { BrowserToolInput } from "./schema";
import type { BrowserResult } from "./types";

/**
 * Execute a browser operation using the BrowserdClient
 */
export async function execute(
	client: BrowserdClient,
	input: BrowserToolInput,
): Promise<BrowserResult> {
	const { operation, timeout } = input;

	try {
		switch (operation) {
			case "navigate": {
				if (!input.url) {
					return errorResult(
						operation,
						"url is required for navigate",
						"unknown",
					);
				}
				const result = await client.navigate(input.url, {
					waitUntil: input.waitUntil,
					timeout,
				});
				return successResult(operation, {
					url: result.url,
					title: result.title,
				});
			}

			case "goBack": {
				await client.goBack();
				return successResult(operation);
			}

			case "goForward": {
				await client.goForward();
				return successResult(operation);
			}

			case "reload": {
				await client.reload();
				return successResult(operation);
			}

			case "click": {
				if (!input.selector) {
					return errorResult(
						operation,
						"selector is required for click",
						"unknown",
					);
				}
				await client.click(input.selector, {
					button: input.button,
					clickCount: input.clickCount,
					delay: input.delay,
					timeout,
				});
				return successResult(operation, { selector: input.selector });
			}

			case "dblclick": {
				if (!input.selector) {
					return errorResult(
						operation,
						"selector is required for dblclick",
						"unknown",
					);
				}
				await client.dblclick(input.selector, {
					button: input.button,
					delay: input.delay,
					timeout,
				});
				return successResult(operation, { selector: input.selector });
			}

			case "hover": {
				if (!input.selector) {
					return errorResult(
						operation,
						"selector is required for hover",
						"unknown",
					);
				}
				await client.hover(input.selector, { timeout });
				return successResult(operation, { selector: input.selector });
			}

			case "type": {
				if (!input.selector) {
					return errorResult(
						operation,
						"selector is required for type",
						"unknown",
					);
				}
				if (!input.text) {
					return errorResult(operation, "text is required for type", "unknown");
				}
				await client.type(input.selector, input.text, {
					delay: input.delay,
					timeout,
				});
				return successResult(operation, {
					selector: input.selector,
					textLength: input.text.length,
				});
			}

			case "fill": {
				if (!input.selector) {
					return errorResult(
						operation,
						"selector is required for fill",
						"unknown",
					);
				}
				if (input.value === undefined) {
					return errorResult(
						operation,
						"value is required for fill",
						"unknown",
					);
				}
				await client.fill(input.selector, input.value, { timeout });
				return successResult(operation, { selector: input.selector });
			}

			case "press": {
				if (!input.key) {
					return errorResult(operation, "key is required for press", "unknown");
				}
				await client.press(input.key, {
					delay: input.delay,
					timeout,
				});
				return successResult(operation, { key: input.key });
			}

			case "waitForSelector": {
				if (!input.selector) {
					return errorResult(
						operation,
						"selector is required for waitForSelector",
						"unknown",
					);
				}
				await client.waitForSelector(input.selector, {
					state: input.state,
					timeout,
				});
				return successResult(operation, {
					selector: input.selector,
					state: input.state ?? "visible",
				});
			}

			case "evaluate": {
				if (!input.expression) {
					return errorResult(
						operation,
						"expression is required for evaluate",
						"unknown",
					);
				}
				const evalResult = await client.evaluate(input.expression, input.args, {
					timeout,
				});
				return successResult(operation, {
					result: evalResult,
					resultType: typeof evalResult,
				});
			}

			case "screenshot": {
				const result = await client.screenshot({
					fullPage: input.fullPage,
					type: input.type,
					quality: input.quality,
				});
				return {
					status: "success",
					operation,
					data: {
						format: result.format,
						size: result.data.length,
					},
					screenshot: result.data,
				};
			}

			case "setViewport": {
				if (!input.width || !input.height) {
					return errorResult(
						operation,
						"width and height are required for setViewport",
						"unknown",
					);
				}
				await client.setViewport(input.width, input.height);
				return successResult(operation, {
					width: input.width,
					height: input.height,
				});
			}

			default: {
				const exhaustiveCheck: never = operation;
				return errorResult(
					String(exhaustiveCheck),
					`Unknown operation: ${exhaustiveCheck}`,
					"unknown",
				);
			}
		}
	} catch (err) {
		return handleError(operation, err);
	}
}

function successResult(
	operation: string,
	data?: Record<string, unknown>,
): BrowserResult {
	return { status: "success", operation, data };
}

function errorResult(
	operation: string,
	error: string,
	errorType: BrowserResult["errorType"],
): BrowserResult {
	return { status: "error", operation, error, errorType };
}

function handleError(operation: string, err: unknown): BrowserResult {
	const message = err instanceof Error ? err.message : String(err);

	// Classify error types based on message patterns
	let errorType: BrowserResult["errorType"] = "unknown";
	if (message.includes("timeout") || message.includes("Timeout")) {
		errorType = "timeout";
	} else if (message.includes("not found") || message.includes("No element")) {
		errorType = "not_found";
	} else if (message.includes("navigation") || message.includes("Navigation")) {
		errorType = "navigation";
	} else if (message.includes("evaluate") || message.includes("Evaluation")) {
		errorType = "evaluation";
	}

	return { status: "error", operation, error: message, errorType };
}
