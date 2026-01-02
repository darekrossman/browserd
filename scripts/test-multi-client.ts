#!/usr/bin/env bun
/**
 * Diagnostic test: Multiple createClient instances
 *
 * Tests whether creating multiple createClient instances and sessions
 * causes 502 errors. Does NOT close sessions.
 *
 * Usage:
 *   bun scripts/test-multi-client.ts [sprite-name]
 */

import { createClient, SpritesSandboxProvider } from "../src/sdk";

async function main() {
	const token = process.env.SPRITE_TOKEN;
	if (!token) {
		console.error("Error: SPRITE_TOKEN environment variable required");
		process.exit(1);
	}

	const spriteName = process.argv[2] || "sb1";
	console.log(
		`Testing multiple createClient instances on sprite: ${spriteName}\n`,
	);

	// First, check existing sessions
	console.log("=== Checking existing sessions ===");
	const checkProvider = new SpritesSandboxProvider({
		token,
		spriteName,
		debug: true,
	});

	const { sandbox: checkSandbox, listSessions: checkList } = await createClient(
		{
			provider: checkProvider,
		},
	);

	const existing = await checkList();
	console.log(`Existing sessions: ${existing.count}/${existing.maxSessions}`);
	for (const sess of existing.sessions) {
		console.log(
			`  - ${sess.id} (clients: ${sess.clientCount}, url: ${sess.url})`,
		);
	}

	// === Client 1 ===
	console.log("\n=== Creating Client 1 ===");
	const provider1 = new SpritesSandboxProvider({
		token,
		spriteName,
		debug: true,
	});

	const { sandbox: sandbox1, createSession: createSession1 } =
		await createClient({
			provider: provider1,
		});

	console.log(`Client 1 - Sandbox ID: ${sandbox1.id}`);
	console.log(`Client 1 - Domain: ${sandbox1.domain}`);
	console.log(`Client 1 - Transport: ${sandbox1.transport}`);

	console.log("\nClient 1 - Creating session...");
	try {
		const session1 = await createSession1({
			viewport: { width: 1280, height: 720 },
		});
		console.log(`Client 1 - Session ID: ${session1.sessionId}`);
		console.log(`Client 1 - Viewer URL: ${session1.sessionInfo?.viewerUrl}`);

		console.log("Client 1 - Navigating to example.com...");
		await session1.navigate("https://example.com");
		console.log("Client 1 - Navigation complete");
	} catch (err) {
		console.error("Client 1 - ERROR creating/navigating session:");
		console.error(err);
	}

	// === Client 2 ===
	console.log("\n=== Creating Client 2 ===");
	const provider2 = new SpritesSandboxProvider({
		token,
		spriteName,
		debug: true,
	});

	const { sandbox: sandbox2, createSession: createSession2 } =
		await createClient({
			provider: provider2,
		});

	console.log(`Client 2 - Sandbox ID: ${sandbox2.id}`);
	console.log(`Client 2 - Domain: ${sandbox2.domain}`);
	console.log(`Client 2 - Transport: ${sandbox2.transport}`);

	console.log("\nClient 2 - Creating session...");
	try {
		const session2 = await createSession2({
			viewport: { width: 1280, height: 720 },
		});
		console.log(`Client 2 - Session ID: ${session2.sessionId}`);
		console.log(`Client 2 - Viewer URL: ${session2.sessionInfo?.viewerUrl}`);

		console.log("Client 2 - Navigating to example.com...");
		await session2.navigate("https://example.com");
		console.log("Client 2 - Navigation complete");
	} catch (err) {
		console.error("Client 2 - ERROR creating/navigating session:");
		console.error(err);
	}

	// Final status
	console.log("\n=== Final Session Status ===");
	const final = await checkList();
	console.log(`Total sessions: ${final.count}/${final.maxSessions}`);
	for (const sess of final.sessions) {
		console.log(
			`  - ${sess.id} (clients: ${sess.clientCount}, url: ${sess.url})`,
		);
	}

	console.log(
		"\nSessions left open. Check viewers to confirm they're working.",
	);
	process.exit(0);
}

main();
