/**
 * AI Browser Tool Example
 *
 * This example demonstrates using the browserd AI SDK tool with Vercel AI SDK
 * to enable an AI agent to control a browser with automatic session management.
 *
 * Requirements:
 * - A sandbox provider (Vercel, Sprites, or Local Docker)
 * - AI Gateway API key (or another AI SDK compatible provider)
 *
 * The AI browser tool automatically:
 * - Creates a sandbox on first use
 * - Manages browser sessions
 * - Returns sessionId for the agent to track
 * - Cleans up via closeSession operation
 */

import { gateway, generateText, stepCountIs } from "ai";
import { VercelSandboxProvider } from "../../src/sdk";
import { createBrowserTool } from "../../src/sdk/ai";

async function main() {
	// Create a provider for the browser tool. If sandboxId is not provided,
	// or the sandbox is not found, a new one will be created.
	const provider = new VercelSandboxProvider({
		sandboxId: "sbx_hVTBO6rBAnsOYeV9HABo9eInJWvK",
		defaultTimeout: 60 * 60000, // 1 hour
	});

	const browserTool = createBrowserTool({ provider });

	const prompt = `
    Go to Hacker News (https://news.ycombinator.com) and find the title of the
    top story on the front page. Return just the title.
  `;

	console.log("\nStarting AI task...\n");

	try {
		const { text, steps } = await generateText({
			model: gateway("anthropic/claude-opus-4.5"),
			tools: { browser: browserTool },
			stopWhen: stepCountIs(25),
			prompt,
		});

		console.log("AI Response:", text);
		console.log("\nSteps taken:", steps.length);

		// Log each step for visibility
		for (const step of steps) {
			if (step.toolCalls) {
				for (const call of step.toolCalls) {
					console.log(`  - ${call.toolName}`);
				}
			}
		}
	} finally {
		console.log("\nTask complete");
		// Note: The AI agent should have called closeSession
		// Sandbox may persist and timeout naturally, or can be
		// cleaned up separately via provider if needed
	}
}

main().catch(console.error);
