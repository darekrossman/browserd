import { gateway, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { createBrowserTool } from "@/sdk/ai";
import type { SandboxProvider } from "@/sdk/providers";
import { truncateObjectFields } from "./utils";

const description = `Spawns a specialized subagent to perform a focused task.\n\nUse this tool to delegate complex or specialized work to a subagent with its own conversation context. The subagent will execute to completion and return a summary of what it accomplished.`;

export function createTaskTool(provider: SandboxProvider) {
	return tool({
		description,
		inputSchema: z.object({
			prompt: z
				.string()
				.describe(
					"The specific task instruction for the subagent. Be detailed and specific about what you want accomplished.",
				),
		}),
		execute: async ({ prompt }) => {
			try {
				const subagent = new ToolLoopAgent({
					model: gateway("anthropic/claude-opus-4-5"),
					tools: {
						browser: createBrowserTool({ provider }),
					},
				});

				const stream = await subagent.stream({ prompt });

				for await (const chunk of stream.fullStream) {
					switch (chunk.type) {
						case "text-delta":
							process.stdout.write(chunk.text);
							break;
						case "text-end":
							process.stdout.write("\n");
							break;
						case "tool-call": {
							const toolName =
								chunk.toolName.length > 500
									? `${chunk.toolName.slice(0, 500)}...`
									: chunk.toolName;
							const truncatedInput = truncateObjectFields(chunk.input);
							console.log(
								`\x1b[90m\n[SUBAGENT][Tool Call: ${toolName}] ${JSON.stringify(truncatedInput)}\x1b[0m`,
							);
							break;
						}
						case "tool-result": {
							const toolName =
								chunk.toolName.length > 500
									? `${chunk.toolName.slice(0, 500)}...`
									: chunk.toolName;
							const truncatedOutput = truncateObjectFields(chunk.output);
							console.log(
								`\x1b[90m\n[SUBAGENT][Tool Result: ${toolName}] ${JSON.stringify(truncatedOutput)}\x1b[0m`,
							);
							break;
						}
						case "error":
							console.log(`\x1b[90m[SUBAGENT][ERROR] ${chunk.error}\x1b[0m`);
							break;
					}
				}

				const text = await stream.text;

				return {
					status: "success",
					summary: text || "Subagent completed without producing a summary.",
				};
			} catch (error) {
				return {
					status: "error",
					summary: "",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	});
}
