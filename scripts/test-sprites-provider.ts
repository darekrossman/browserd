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

import { SandboxManager, SpritesSandboxProvider } from "../src/sdk";

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

	const manager = new SandboxManager({ provider });

	try {
		// Create sandbox and connect (uses default session)
		const { client, sandbox } = await manager.create();

		console.log(`Sandbox ID: ${sandbox.id}`);
		console.log(`Domain: ${sandbox.domain}`);
		console.log(`Transport: ${sandbox.transport}`);
		console.log(`Base URL: ${client.getBaseUrl()}`);

		// Navigate default session
		await client.navigate("https://example.com");
		const defaultTitle = await client.evaluate<string>("document.title");
		console.log(`Default session title: "${defaultTitle}"`);

		// Create session 1 - for bot detection testing
		console.log("\nCreating Session 1 (bot detector)...");
		const session1 = await client.createSession({
			viewport: { width: 1920, height: 1080 },
		});
		console.log(`Session 1 ID: ${session1.id}`);
		console.log(`Session 1 Viewer URL: ${session1.viewerUrl}`);

		// Create session 2 - for search testing
		const session2 = await client.createSession({
			viewport: { width: 1280, height: 720 },
		});
		console.log(`Session 2 ID: ${session2.id}`);
		console.log(`Session 2 Viewer URL: ${session2.viewerUrl}`);

		// Get clients for each session
		const client1 = await client.getSessionClient(session1.id);
		const client2 = await client.getSessionClient(session2.id);

		// Connect to both sessions
		await client1.connect();
		await client2.connect();

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
		console.log(`  Default: "${defaultTitle}"`);
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
		const { sessions, count, maxSessions } = await client.listSessions();
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

		// Close session clients
		await client1.close();
		await client2.close();

		// Destroy sessions (optional - they auto-cleanup on idle)
		await client.destroySession(session1.id);
		await client.destroySession(session2.id);

		// List remaining sessions
		const remaining = await client.listSessions();
		console.log(`\nRemaining sessions: ${remaining.count}`);

		// Close main client
		await client.close();

		process.exit(0);
	} catch (err) {
		console.error("\n--- Error ---");
		console.error(err);
		process.exit(1);
	}
}

main();
