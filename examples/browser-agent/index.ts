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

import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { createClient, VercelSandboxProvider } from "@/sdk";
import { createBrowserTool } from "@/sdk/ai";

async function main() {
	// Create a provider for the browser tool. If sandboxId is not provided,
	// or the sandbox is not found, a new one will be created.
	const provider = new VercelSandboxProvider({
		sandboxId: "sbx_hVTBO6rBAnsOYeV9HABo9eInJWvK",
		defaultTimeout: 60 * 60000, // 1 hour
	});

	const client = await createClient({ provider });

	// List and close all existing sessions
	const sessionsResponse = await client.listSessions();
	for (const session of sessionsResponse.sessions) {
		await client.destroySession(session.id);
	}

	const browserTool = createBrowserTool({ provider });

	console.log("\nStarting AI task...\n");

	try {
		const agent = new ToolLoopAgent({
			model: gateway("anthropic/claude-opus-4-5"),
			tools: { browser: browserTool },
			stopWhen: stepCountIs(50),
		});

		const stream = await agent.stream({
			prompt:
				"go to npmjs.com and create an account using my email address darek@subpopular.dev, my name is Darek Rossman. My preferred username is 'subpopular'. If the username is not available, stop. Use password 'Lightspeed700'",
		});

		for await (const chunk of stream.fullStream) {
			switch (chunk.type) {
				case "text-delta":
					process.stdout.write(chunk.text);
					break;
				case "text-end":
					process.stdout.write("\n");
					break;
				case "tool-call":
					console.log(`\n[Tool Call: ${chunk.toolName}]`, chunk.input);
					break;
				case "tool-result":
					console.log(`\n[Tool Result: ${chunk.toolName}]`, chunk.output);
					break;
				case "error":
					console.log(`[ERROR]`, chunk.error);
					break;
			}
		}
	} finally {
		console.log("\nTask complete");

		// Clean up all remaining sessions
		const sessionsResponse = await client.listSessions();
		for (const session of sessionsResponse.sessions) {
			await client.destroySession(session.id);
		}
	}
}

main().catch(console.error);
