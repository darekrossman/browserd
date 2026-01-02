/**
 * AI SDK Browser Tool for Browserd
 *
 * Creates an AI SDK tool for controlling a remote browser via browserd.
 *
 * @example
 * ```typescript
 * import { createClient, SpritesSandboxProvider } from "browserd";
 * import { createBrowserTool } from "browserd/ai";
 * import { generateText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * const { createSession, manager, sandbox } = await createClient({
 *   provider: new SpritesSandboxProvider({ token: process.env.SPRITE_TOKEN! }),
 * });
 *
 * // createSession() returns an already-connected BrowserdClient
 * const browser = await createSession();
 *
 * const browserTool = createBrowserTool({ client: browser });
 *
 * const { text } = await generateText({
 *   model: openai("gpt-4o"),
 *   tools: { browser: browserTool },
 *   maxSteps: 10,
 *   prompt: "Go to hacker news and find the top story title",
 * });
 *
 * // Cleanup
 * await browser.close();
 * await manager.destroy(sandbox.id);
 * ```
 */

import { tool } from "ai";
import { execute } from "./execute";
import { toModelOutput } from "./output";
import { type BrowserToolInput, browserToolInputSchema } from "./schema";
import type { BrowserResult, CreateBrowserToolOptions } from "./types";

const description = `Browse the web and interact with websites. Use this tool to navigate to URLs, click buttons and links, fill out forms, extract information from pages, and take screenshots.

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

Selectors - how to identify elements:
- CSS: "button.submit", "#login-btn", "input[name='email']"
- Text content: "text=Sign In", "text=Submit"
- Role/ARIA: "role=button[name='Submit']"
- XPath: "xpath=//button[@type='submit']"

Best practices:
- Use 'fill' for form inputs (it clears existing text first)
- Use 'waitForSelector' before clicking elements that load dynamically
- Use 'evaluate' to extract text content: evaluate("document.querySelector('h1')?.textContent")
- Take screenshots to verify the page state when debugging`;

/**
 * Create a browser automation tool for the AI SDK.
 *
 * @param options - Configuration options
 * @param options.client - Pre-connected BrowserdClient instance
 * @param options.defaultTimeout - Default timeout for operations (default: 30000ms)
 * @returns AI SDK tool for browser automation
 */
export function createBrowserTool(options: CreateBrowserToolOptions) {
	const { client, defaultTimeout = 30000 } = options;

	return tool({
		description,
		inputSchema: browserToolInputSchema,
		execute: async (input: BrowserToolInput): Promise<BrowserResult> => {
			// Apply default timeout if not specified
			const inputWithTimeout = {
				...input,
				timeout: input.timeout ?? defaultTimeout,
			};
			return execute(client, inputWithTimeout);
		},
		toModelOutput,
	});
}

// Export types
export type { BrowserToolInput, BrowserResult, CreateBrowserToolOptions };
export { browserToolInputSchema };
