/**
 * Execute function that maps operations to BrowserdClient methods
 * with session lifecycle management
 */

import type { BrowserdClient } from "../client";
import type { NotificationProvider } from "../notifications";
import type { SandboxProvider } from "../providers/types";
import { SandboxManager } from "../sandbox-manager";
import type { CreateSessionOptions } from "../types";
import type { BrowserToolInput } from "./schema";
import type { BrowserResult } from "./types";

/**
 * Internal state for managing sandbox and sessions
 */
interface SessionState {
	manager: SandboxManager | null;
	sandboxId: string | null;
	sessions: Map<string, BrowserdClient>;
	createSession:
		| ((options?: CreateSessionOptions) => Promise<BrowserdClient>)
		| null;
	getSession: ((sessionId: string) => Promise<BrowserdClient>) | null;
}

/**
 * Options for the executor
 */
interface ExecutorOptions {
	/**
	 * Notification provider for human-in-the-loop interventions
	 */
	notificationProvider?: NotificationProvider;
}

/**
 * Create an executor with session state management
 */
export function createExecutor(
	provider: SandboxProvider,
	options: ExecutorOptions = {},
) {
	const { notificationProvider } = options;
	const state: SessionState = {
		manager: null,
		sandboxId: null,
		sessions: new Map(),
		createSession: null,
		getSession: null,
	};

	/**
	 * Ensure sandbox exists (lazy initialization)
	 */
	async function ensureSandbox(): Promise<void> {
		if (state.manager) return;

		state.manager = new SandboxManager({ provider });
		const result = await state.manager.create();
		state.sandboxId = result.sandbox.id;
		state.createSession = result.createSession;
		state.getSession = result.getSession;
	}

	/**
	 * Get or create session based on input sessionId
	 */
	async function getClient(
		sessionId?: string,
	): Promise<{ client: BrowserdClient; sessionId: string }> {
		await ensureSandbox();

		// If sessionId provided, get that session
		if (sessionId) {
			// Check cache first
			let client = state.sessions.get(sessionId);
			if (client?.isConnected()) {
				return { client, sessionId };
			}
			// Reconnect to existing session
			client = await state.getSession!(sessionId);
			state.sessions.set(sessionId, client);
			return { client, sessionId };
		}

		// No sessionId = create new session
		const client = await state.createSession!();
		const newSessionId = client.sessionId!;
		state.sessions.set(newSessionId, client);
		return { client, sessionId: newSessionId };
	}

	/**
	 * Close a session
	 */
	async function closeSession(sessionId?: string): Promise<BrowserResult> {
		if (!sessionId) {
			return {
				status: "error",
				operation: "closeSession",
				error: "sessionId is required to close a session",
				errorType: "session",
			};
		}

		const client = state.sessions.get(sessionId);
		if (client) {
			try {
				await client.close();
			} catch {
				// Ignore close errors - session may already be closed
			}
			state.sessions.delete(sessionId);
		}
		return { status: "success", operation: "closeSession", sessionId };
	}

	/**
	 * Execute a browser operation
	 */
	async function execute(input: BrowserToolInput): Promise<BrowserResult> {
		const { operation, timeout } = input;

		// Handle closeSession specially
		if (operation === "closeSession") {
			return closeSession(input.sessionId);
		}

		try {
			const { client, sessionId } = await getClient(input.sessionId);

			switch (operation) {
				case "navigate": {
					if (!input.url) {
						return errorResult(
							operation,
							"url is required for navigate",
							"unknown",
							sessionId,
						);
					}
					const result = await client.navigate(input.url, {
						waitUntil: input.waitUntil,
						timeout,
					});
					return successResult(
						operation,
						{ url: result.url, title: result.title },
						sessionId,
					);
				}

				case "goBack": {
					await client.goBack();
					return successResult(operation, undefined, sessionId);
				}

				case "goForward": {
					await client.goForward();
					return successResult(operation, undefined, sessionId);
				}

				case "reload": {
					await client.reload();
					return successResult(operation, undefined, sessionId);
				}

				case "click": {
					if (!input.selector) {
						return errorResult(
							operation,
							"selector is required for click",
							"unknown",
							sessionId,
						);
					}
					await client.click(input.selector, {
						button: input.button,
						clickCount: input.clickCount,
						delay: input.delay,
						timeout,
					});
					return successResult(
						operation,
						{ selector: input.selector },
						sessionId,
					);
				}

				case "dblclick": {
					if (!input.selector) {
						return errorResult(
							operation,
							"selector is required for dblclick",
							"unknown",
							sessionId,
						);
					}
					await client.dblclick(input.selector, {
						button: input.button,
						delay: input.delay,
						timeout,
					});
					return successResult(
						operation,
						{ selector: input.selector },
						sessionId,
					);
				}

				case "hover": {
					if (!input.selector) {
						return errorResult(
							operation,
							"selector is required for hover",
							"unknown",
							sessionId,
						);
					}
					await client.hover(input.selector, { timeout });
					return successResult(
						operation,
						{ selector: input.selector },
						sessionId,
					);
				}

				case "type": {
					if (!input.selector) {
						return errorResult(
							operation,
							"selector is required for type",
							"unknown",
							sessionId,
						);
					}
					if (!input.text) {
						return errorResult(
							operation,
							"text is required for type",
							"unknown",
							sessionId,
						);
					}
					await client.type(input.selector, input.text, {
						delay: input.delay,
						timeout,
					});
					return successResult(
						operation,
						{ selector: input.selector, textLength: input.text.length },
						sessionId,
					);
				}

				case "fill": {
					if (!input.selector) {
						return errorResult(
							operation,
							"selector is required for fill",
							"unknown",
							sessionId,
						);
					}
					if (input.value === undefined) {
						return errorResult(
							operation,
							"value is required for fill",
							"unknown",
							sessionId,
						);
					}
					await client.fill(input.selector, input.value, { timeout });
					return successResult(
						operation,
						{ selector: input.selector },
						sessionId,
					);
				}

				case "press": {
					if (!input.key) {
						return errorResult(
							operation,
							"key is required for press",
							"unknown",
							sessionId,
						);
					}
					await client.press(input.key, {
						delay: input.delay,
						timeout,
					});
					return successResult(operation, { key: input.key }, sessionId);
				}

				case "waitForSelector": {
					if (!input.selector) {
						return errorResult(
							operation,
							"selector is required for waitForSelector",
							"unknown",
							sessionId,
						);
					}
					await client.waitForSelector(input.selector, {
						state: input.state,
						timeout,
					});
					return successResult(
						operation,
						{ selector: input.selector, state: input.state ?? "visible" },
						sessionId,
					);
				}

				case "evaluate": {
					if (!input.expression) {
						return errorResult(
							operation,
							"expression is required for evaluate",
							"unknown",
							sessionId,
						);
					}
					const evalResult = await client.evaluate(
						input.expression,
						input.args,
						{ timeout },
					);
					return successResult(
						operation,
						{ result: evalResult, resultType: typeof evalResult },
						sessionId,
					);
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
						sessionId,
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
							sessionId,
						);
					}
					await client.setViewport(input.width, input.height);
					return successResult(
						operation,
						{ width: input.width, height: input.height },
						sessionId,
					);
				}

				case "requestHumanIntervention": {
					if (!input.reason) {
						return errorResult(
							operation,
							"reason is required for requestHumanIntervention",
							"unknown",
							sessionId,
						);
					}
					if (!input.instructions) {
						return errorResult(
							operation,
							"instructions is required for requestHumanIntervention",
							"unknown",
							sessionId,
						);
					}
					const result = await client.requestIntervention({
						reason: input.reason,
						instructions: input.instructions,
						timeout,
						// Call notification provider when intervention is created
						onCreated: notificationProvider
							? async (info) => {
									await notificationProvider.notify({
										interventionId: info.interventionId,
										sessionId,
										viewerUrl: info.viewerUrl,
										reason: info.reason,
										instructions: info.instructions,
										createdAt: new Date(),
									});
								}
							: undefined,
					});
					return successResult(
						operation,
						{
							interventionId: result.interventionId,
							viewerUrl: result.viewerUrl,
							resolvedAt: result.resolvedAt.toISOString(),
						},
						sessionId,
					);
				}

				default: {
					const exhaustiveCheck: never = operation;
					return errorResult(
						String(exhaustiveCheck),
						`Unknown operation: ${exhaustiveCheck}`,
						"unknown",
						sessionId,
					);
				}
			}
		} catch (err) {
			// Try to get sessionId even if operation failed
			const sessionId = input.sessionId;
			return handleError(operation, err, sessionId);
		}
	}

	return { execute };
}

function successResult(
	operation: string,
	data?: Record<string, unknown>,
	sessionId?: string,
): BrowserResult {
	return { status: "success", operation, sessionId, data };
}

function errorResult(
	operation: string,
	error: string,
	errorType: BrowserResult["errorType"],
	sessionId?: string,
): BrowserResult {
	return { status: "error", operation, sessionId, error, errorType };
}

function handleError(
	operation: string,
	err: unknown,
	sessionId?: string,
): BrowserResult {
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
	} else if (message.includes("session") || message.includes("Session")) {
		errorType = "session";
	}

	return { status: "error", operation, sessionId, error: message, errorType };
}
