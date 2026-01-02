/**
 * AI Browser Tool Example
 *
 * This example demonstrates using the browserd AI SDK tool with Vercel AI SDK
 * to enable an AI agent to control a browser.
 *
 * Requirements:
 * - browserd sandbox running (local Docker, Vercel, etc)
 * - AI Gateway API key (or another AI SDK compatible provider)
 */

import { gateway, generateText, stepCountIs } from "ai";
import { createClient } from "browserd";
import { createBrowserTool } from "browserd/ai";
import { VercelSandboxProvider } from "../../src/sdk";

async function main() {
	const { createSession } = await createClient({
		provider: new VercelSandboxProvider({
			sandboxId: "sbx_PGdCpaTIOLEDcXXlLhwOHDoUyiHU",
			defaultTimeout: 60 * 60000, // 1 hour
		}),
	});

	const browser = await createSession();

	const browserTool = createBrowserTool({ client: browser });

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
		// Cleanup
		await browser.close();
		// await manager.destroy(sandbox.id);
		console.log("\nCleanup complete");
	}
}

main().catch(console.error);
