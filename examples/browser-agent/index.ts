import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { createClient, DockerContainerProvider, LocalProvider } from "@/sdk";
import { createTaskTool } from "./task-tool";

async function main() {
	// const provider = new LocalProvider();
	const provider = new DockerContainerProvider({
		imageName: "browserd-sandbox-rtc",
	});

	console.log("\nStarting AI task...\n");

	try {
		const agent = new ToolLoopAgent({
			model: gateway("anthropic/claude-opus-4-5"),
			instructions:
				"You are a helpful agent that only uses the task tool to answer questions and perform tasks for the user.",
			tools: { task: createTaskTool(provider) },
			stopWhen: stepCountIs(50),
		});

		const stream = await agent.stream({
			prompt: "get the top headlines from techcrunch.com",
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
		const client = await createClient({ provider });
		const sessionsResponse = await client.listSessions();
		for (const session of sessionsResponse.sessions) {
			await client.destroySession(session.id);
		}
	}
}

main().catch(console.error);
