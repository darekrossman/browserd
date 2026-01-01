#!/usr/bin/env bun
/**
 * Test script for SpritesProvider
 *
 * Usage:
 *   SPRITE_TOKEN=<your-token> bun scripts/test-sprites-provider.ts [sprite-name]
 *
 * Arguments:
 *   sprite-name  Name of existing sprite to use (default: sb1)
 *
 * Getting a token:
 *   1. Go to https://sprites.dev/account
 *   2. Generate an API token
 *   3. Export it: export SPRITE_TOKEN="your-token"
 *
 * Example:
 *   export SPRITE_TOKEN="darek-rossman/abc123/token-id/token-value"
 *   bun scripts/test-sprites-provider.ts sb1
 */

import { SandboxManager, SpritesSandboxProvider } from "../src/sdk";

async function main() {
	const token = process.env.SPRITE_TOKEN;
	if (!token) {
		console.error("Error: SPRITE_TOKEN environment variable required");
		console.error("Get a token from sprites.dev/account");
		process.exit(1);
	}

	const spriteName = process.argv[2] || "sb1";
	console.log(`Testing SpritesProvider with sprite: ${spriteName}`);

	const provider = new SpritesSandboxProvider({
		token,
		spriteName,
		debug: true,
	});

	const manager = new SandboxManager({ provider });

	try {
		console.log("\n--- Creating sandbox ---");
		const { client, sandbox } = await manager.create();

		console.log("\n--- Sandbox created ---");
		console.log(`ID: ${sandbox.id}`);
		console.log(`Domain: ${sandbox.domain}`);
		console.log(`Status: ${sandbox.status}`);

		console.log("\n--- Testing navigation ---");
		await client.navigate("https://example.com");
		console.log("Navigation successful!");

		// console.log("\n--- Taking screenshot ---");
		// const screenshot = await client.screenshot();
		// console.log(`Screenshot format: ${screenshot.format}`);
		// console.log(`Screenshot size: ${screenshot.data.length} bytes (base64)`);

		// console.log("\n--- Cleanup ---");
		// await manager.destroy(sandbox.id);
		// console.log("Sandbox destroyed successfully");
	} catch (err) {
		console.error("\n--- Error ---");
		console.error(err);
		process.exit(1);
	}
}

main();
