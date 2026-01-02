import { createClient, VercelSandboxProvider } from "../src/sdk";

async function main() {
	// Parse CLI args: [sandboxId] [--dev]
	const args = process.argv.slice(2);
	const devMode = args.includes("--dev");
	const sandboxId = args.find((a) => !a.startsWith("--"));

	if (sandboxId) {
		console.log(`Reusing sandbox: ${sandboxId}${devMode ? " (dev mode)" : ""}`);
	}

	const provider = new VercelSandboxProvider({
		sandboxId,
		devMode,
	});

	const { sandbox, createSession, listSessions } = await createClient({
		provider,
	});

	try {
		console.log(`Sandbox ID: ${sandbox.id}`);
		console.log(`Domain: ${sandbox.domain}`);

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

		process.exit(0);
	} catch (err) {
		console.error("\n--- Error ---");
		console.error(err);
		process.exit(1);
	}
}

main();
