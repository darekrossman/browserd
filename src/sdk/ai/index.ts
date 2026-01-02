/**
 * AI SDK Browser Tool for Browserd
 *
 * Creates an AI SDK tool for controlling a browser with automatic session management.
 *
 * @example
 * ```typescript
 * import { SpritesSandboxProvider } from "browserd/providers";
 * import { createBrowserTool } from "browserd/ai";
 * import { generateText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * // Create tool with provider - sandbox created lazily on first use
 * const provider = new SpritesSandboxProvider({ token: process.env.SPRITE_TOKEN! });
 * const browserTool = createBrowserTool({ provider });
 *
 * const { text } = await generateText({
 *   model: openai("gpt-4o"),
 *   tools: { browser: browserTool },
 *   maxSteps: 10,
 *   prompt: `Go to hacker news and find the top story title.
 *            Make sure to save the sessionId from your first call and
 *            use it in all subsequent calls. Close the session when done.`,
 * });
 * ```
 */

import { tool } from "ai";
import { createExecutor } from "./execute";
import { toModelOutput } from "./output";
import { type BrowserToolInput, browserToolInputSchema } from "./schema";
import type { BrowserResult, CreateBrowserToolOptions } from "./types";

const description = `Browse the web and interact with websites. Use this tool to navigate to URLs, click buttons and links, fill out forms, extract information from pages, and take screenshots.

IMPORTANT - Session Management:
- On your first browser operation, a new session is created and sessionId is returned
- You can optionally pass the sessionId on subsequent calls if you need to continue the same session
- When you're finished browsing and no longer need the session, call the closeSession operation with your sessionId to clean up
- If you don't pass sessionId, a NEW session will be created (losing your previous page state)

Example workflow:
1. navigate to a URL → returns sessionId (save this!)
2. click, fill, evaluate, etc. → pass sessionId each time
3. closeSession with sessionId → cleans up when done

Operations:
- navigate: Go to a URL
- click: Click on buttons, links, or any element
- fill: Enter text into form fields (preferred for inputs)
- type: Type text character by character
- press: Press keyboard keys (Enter, Tab, Escape, etc.)
- hover: Hover over an element
- waitForSelector: Wait for an element to appear or disappear
- evaluate: Run JavaScript to extract data or interact with the page
- screenshot: Capture what the page looks like
- goBack/goForward/reload: Browser navigation
- setViewport: Change the browser window size
- closeSession: Close your browser session (CALL THIS WHEN DONE)

Selectors - how to identify elements:
- CSS: "button.submit", "#login-btn", "input[name='email']"
- Text content: "text=Sign In", "text=Submit"
- Role/ARIA: "role=button[name='Submit']"
- XPath: "xpath=//button[@type='submit']"

Best practices:
- Always save and reuse the sessionId from your first call
- Use 'fill' for form inputs (it clears existing text first)
- Use 'waitForSelector' before clicking elements that load dynamically
- Use 'evaluate' to extract text content: evaluate("document.querySelector('h1')?.textContent")
- Take screenshots to verify the page state when debugging
- ALWAYS call closeSession when you're done browsing`;

/**
 * Create a browser automation tool for the AI SDK.
 *
 * @param options - Configuration options
 * @param options.provider - Sandbox provider for creating browser instances
 * @param options.defaultTimeout - Default timeout for operations (default: 30000ms)
 * @returns AI SDK tool for browser automation
 */
export function createBrowserTool(options: CreateBrowserToolOptions) {
	const { provider, defaultTimeout = 30000 } = options;
	const executor = createExecutor(provider);

	return tool({
		description,
		inputSchema: browserToolInputSchema,
		execute: async (input: BrowserToolInput): Promise<BrowserResult> => {
			// Apply default timeout if not specified
			const inputWithTimeout = {
				...input,
				timeout: input.timeout ?? defaultTimeout,
			};
			return executor.execute(inputWithTimeout);
		},
		toModelOutput,
	});
}

// Export types
export type { BrowserToolInput, BrowserResult, CreateBrowserToolOptions };
export { browserToolInputSchema };
