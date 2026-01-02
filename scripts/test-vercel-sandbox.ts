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
		defaultTimeout: 60 * 60000, // 1 hour
	});

	const { sandbox, createSession } = await createClient({
		provider,
	});

	try {
		console.log(`Sandbox ID: ${sandbox.id}`);
		console.log(`Domain: ${sandbox.domain}`);
		console.log(`View All Sessions: ${sandbox.domain}/sessions/all`);

		// const urls = [
		// 	"https://bot-detector.rebrowser.net",
		// 	"https://github.com",
		// 	"https://news.ycombinator.com",
		// 	"https://vercel.com",
		// 	"https://vercel.com/docs/vercel-sandbox",
		// 	"https://bun.com/docs",
		// 	"https://gemini.google.com/app",
		// 	"https://www.anthropic.com/",
		// 	"https://openai.com/",
		// ];

		// const viewport = { width: 1920, height: 1080 };

		// const clients = await Promise.all(
		// 	urls.map(() => createSession({ viewport })),
		// );

		// // Navigate all sessions concurrently without logging
		// await Promise.all(
		// 	clients.map((client, index) => client.navigate(urls[index])),
		// );

		// // Log all viewer URLs at the end
		// console.log("\n--- Viewer URLs ---");
		// clients.forEach((client, index) => {
		// 	console.log(`${index + 1}. ${urls[index]}`);
		// 	console.log(`   ${client.sessionInfo?.viewerUrl}`);
		// });

		process.exit(0);
	} catch (err) {
		console.error("\n--- Error ---");
		console.error(err);
		process.exit(1);
	}
}

main();
