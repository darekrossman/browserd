#!/usr/bin/env bun
/**
 * Test script for SpritesProvider with Multi-Session Support
 *
 * Demonstrates how to run multiple isolated browser sessions on a single sandbox.
 * Each session has its own browser context with isolated cookies, storage, and page state.
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

import { createClient, SpritesSandboxProvider } from "../src/sdk";

async function main() {
	const token = process.env.SPRITE_TOKEN;
	if (!token) {
		console.error("Error: SPRITE_TOKEN environment variable required");
		process.exit(1);
	}

	const spriteName = process.argv[2] || "sb1";
	console.log(`Testing SpritesProvider with sprite: ${spriteName}`);

	const provider = new SpritesSandboxProvider({
		token,
		spriteName,
		debug: true,
	});

	const {
		sandbox,
		createSession,
		listSessions,
	} = await createClient({ provider });

	try {
		console.log(`Sandbox ID: ${sandbox.id}`);
		console.log(`Domain: ${sandbox.domain}`);
		console.log(`Transport: ${sandbox.transport}`);

		// Create session 1 - for bot detection testing (returns connected client)
		console.log("\nCreating Session 1 (bot detector)...");
		const client1 = await createSession({
			viewport: { width: 1920, height: 1080 },
		});
		console.log(`Session 1 ID: ${client1.sessionId}`);
		console.log(`Session 1 Viewer URL: ${client1.sessionInfo?.viewerUrl}`);

		// Create session 2 - for search testing (returns connected client)
		console.log("\nCreating Session 2 (search)...");
		const client2 = await createSession({
			viewport: { width: 1280, height: 720 },
		});
		console.log(`Session 2 ID: ${client2.sessionId}`);
		console.log(`Session 2 Viewer URL: ${client2.sessionInfo?.viewerUrl}`);

		// Navigate sessions to different pages (in parallel)
		const startTime = Date.now();

		// Navigate all sessions concurrently
		await Promise.all([
			client1.navigate("https://bot-detector.rebrowser.net/").then(() => {
				console.log("  - Session 1: Bot detector loaded");
			}),
			client2.navigate("https://www.google.com").then(() => {
				console.log("  - Session 2: Google loaded");
			}),
		]);

		const elapsed = Date.now() - startTime;
		console.log(`\nAll navigations completed in ${elapsed}ms`);

		// Get titles from each session
		const [title1, title2] = await Promise.all([
			client1.evaluate<string>("document.title"),
			client2.evaluate<string>("document.title"),
		]);

		console.log(`\nSession titles (should be different):`);
		console.log(`  Session 1: "${title1}"`);
		console.log(`  Session 2: "${title2}"`);

		// Get URLs from each session
		const [url1, url2] = await Promise.all([
			client1.evaluate<string>("window.location.href"),
			client2.evaluate<string>("window.location.href"),
		]);

		console.log(`\nSession URLs:`);
		console.log(`  Session 1: ${url1}`);
		console.log(`  Session 2: ${url2}`);

		// List all sessions
		const { sessions, count, maxSessions } = await listSessions();
		console.log(`\nActive sessions: ${count}/${maxSessions}`);

		for (const sess of sessions) {
			console.log(`\n  Session: ${sess.id}`);
			console.log(`    Status: ${sess.status}`);
			console.log(
				`    Viewport: ${sess.viewport.width}x${sess.viewport.height}`,
			);
			console.log(`    Clients: ${sess.clientCount ?? 0}`);
			console.log(`    URL: ${sess.url ?? "N/A"}`);
		}

		// Type in Google search (Session 2) while Session 1 stays on bot detector
		try {
			await client2.click('textarea[name="q"]', { timeout: 5000 });
			await client2.type('textarea[name="q"]', "browserd multi-session test");
		} catch (err) {
			console.log("  - Google search input not found (may have different UI)");
		}

		// Take screenshots from each session
		const [ss1, ss2] = await Promise.all([
			client1.screenshot({ type: "jpeg", quality: 80 }),
			client2.screenshot({ type: "jpeg", quality: 80 }),
		]);

		console.log(
			`  Session 1 screenshot: ${ss1.format}, ${Math.round(ss1.data.length / 1024)}KB`,
		);
		console.log(
			`  Session 2 screenshot: ${ss2.format}, ${Math.round(ss2.data.length / 1024)}KB`,
		);

		// Close session clients - close() destroys sessions automatically
		await client1.close();
		await client2.close();

		// List remaining sessions (should be 0)
		const remaining = await listSessions();
		console.log(`\nRemaining sessions: ${remaining.count}`);

		process.exit(0);
	} catch (err) {
		console.error("\n--- Error ---");
		console.error(err);
		process.exit(1);
	}
}

main();
