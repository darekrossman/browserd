#!/usr/bin/env bun
/**
 * Test SDK with Real Vercel Sandbox Provider
 *
 * This script provisions a real Vercel sandbox, runs browser automation,
 * and cleans up. Requires @vercel/sandbox and valid Vercel credentials.
 *
 * Prerequisites:
 *   - bun add @vercel/sandbox
 *   - BROWSERD_BLOB_URL environment variable set to blob storage URL
 *   - Valid Vercel authentication (via VERCEL_TOKEN or logged in CLI)
 *
 * Usage:
 *   BROWSERD_BLOB_URL=https://your-blob.vercel-storage.com/browserd bun scripts/test-vercel-sandbox.ts
 *
 * Options:
 *   --timeout=300000    Sandbox timeout in ms (default: 300000 = 5 min)
 *   --vcpus=4           Number of vCPUs (default: 4)
 *   --skip-cleanup      Don't destroy sandbox after test (for debugging)
 */

import {
	type BrowserdClient,
	BrowserdError,
	SandboxManager,
	VercelSandboxProvider,
} from "../src/sdk";

// Parse CLI arguments
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		timeout: 300000,
		vcpus: 4,
		skipCleanup: false,
		blobUrl: process.env.BROWSERD_BLOB_URL || "",
	};

	for (const arg of args) {
		if (arg.startsWith("--timeout=")) {
			options.timeout = Number.parseInt(arg.split("=")[1], 10);
		} else if (arg.startsWith("--vcpus=")) {
			options.vcpus = Number.parseInt(arg.split("=")[1], 10);
		} else if (arg === "--skip-cleanup") {
			options.skipCleanup = true;
		} else if (arg.startsWith("--blob-url=")) {
			options.blobUrl = arg.split("=")[1];
		}
	}

	return options;
}

async function main() {
	const options = parseArgs();

	console.log("=== Browserd SDK - Vercel Sandbox Test ===\n");

	// Validate environment
	if (!options.blobUrl) {
		console.error(
			"Error: BROWSERD_BLOB_URL environment variable or --blob-url argument required",
		);
		console.error(
			"Example: BROWSERD_BLOB_URL=https://blob.vercel-storage.com/browserd bun scripts/test-vercel-sandbox.ts",
		);
		process.exit(1);
	}

	console.log("Configuration:");
	console.log(`  Blob URL: ${options.blobUrl}`);
	console.log(`  Timeout: ${options.timeout}ms`);
	console.log(`  vCPUs: ${options.vcpus}`);
	console.log(`  Skip Cleanup: ${options.skipCleanup}`);
	console.log();

	// Create provider and manager
	const provider = new VercelSandboxProvider({
		blobBaseUrl: options.blobUrl,
		defaultTimeout: options.timeout,
	});

	const manager = new SandboxManager({
		provider,
		clientOptions: {
			timeout: 30000,
			autoReconnect: false,
		},
	});

	let client: BrowserdClient | null = null;
	let sandboxId: string | null = null;
	const startTime = Date.now();

	try {
		// Step 1: Create sandbox
		console.log("1. Creating Vercel sandbox...");
		const createStart = Date.now();

		const result = await manager.create({
			timeout: options.timeout,
			resources: { vcpus: options.vcpus },
		});

		client = result.client;
		sandboxId = result.sandbox.id;

		console.log(`   Sandbox ID: ${sandboxId}`);
		console.log(`   Domain: ${result.sandbox.domain}`);
		console.log(`   WebSocket: ${result.sandbox.wsUrl}`);
		console.log(`   Status: ${result.sandbox.status}`);
		console.log(`   Created in: ${Date.now() - createStart}ms`);

		// Step 2: Monitor connection
		console.log("\n2. Setting up connection monitoring...");
		client.onConnectionStateChange((state) => {
			console.log(`   [Connection] State changed: ${state}`);
		});

		client.onError((error) => {
			console.error(`   [Connection] Error: ${error.message}`);
		});
		console.log("   Connection handlers registered");

		// Step 3: Test ping latency
		console.log("\n3. Testing latency...");
		const latency = await client.ping();
		console.log(`   Ping latency: ${latency}ms`);

		// Step 4: Navigate to test page
		console.log("\n4. Navigating to httpbin form...");
		const navStart = Date.now();
		const navResult = await client.navigate("https://httpbin.org/forms/post", {
			waitUntil: "networkidle",
			timeout: 30000,
		});
		console.log(`   URL: ${navResult.url}`);
		console.log(`   Navigation time: ${Date.now() - navStart}ms`);

		// Step 5: Wait for form elements
		console.log("\n5. Waiting for form elements...");
		await client.waitForSelector("form", { timeout: 10000 });
		await client.waitForSelector('input[name="custname"]', { timeout: 10000 });
		console.log("   Form elements found");

		// Step 6: Fill form fields
		console.log("\n6. Filling form fields...");

		await client.fill('input[name="custname"]', "Test User");
		console.log('   Filled: custname = "Test User"');

		await client.fill('input[name="custtel"]', "555-0123");
		console.log('   Filled: custtel = "555-0123"');

		await client.fill('input[name="custemail"]', "test@example.com");
		console.log('   Filled: custemail = "test@example.com"');

		// Try to fill textarea if it exists
		try {
			await client.fill('textarea[name="comments"]', "Automated test comment", {
				timeout: 5000,
			});
			console.log('   Filled: comments = "Automated test comment"');
		} catch {
			console.log("   Skipped: comments field not found");
		}

		// Step 7: Take screenshot before submit
		console.log("\n7. Taking pre-submit screenshot...");
		const preScreenshot = await client.screenshot({
			type: "jpeg",
			quality: 80,
		});
		console.log(`   Format: ${preScreenshot.format}`);
		console.log(
			`   Size: ${Math.round(preScreenshot.data.length / 1024)}KB (base64)`,
		);

		// Step 8: Submit form
		console.log("\n8. Submitting form...");
		await client.click('button[type="submit"]', { timeout: 10000 });
		console.log("   Form submitted");

		// Step 9: Wait for result page
		console.log("\n9. Waiting for result page...");
		await client.waitForSelector("pre", { timeout: 15000 });
		console.log("   Result page loaded");

		// Step 10: Extract form submission result
		console.log("\n10. Extracting form result...");
		const formResult = await client.evaluate<string>(
			"document.querySelector('pre')?.textContent || 'No result found'",
		);
		console.log("   Form submission result:");
		console.log("   ---");
		// Pretty print JSON if valid
		try {
			const parsed = JSON.parse(formResult);
			console.log(
				`   ${JSON.stringify(parsed, null, 2).replace(/\n/g, "\n   ")}`,
			);
		} catch {
			console.log(`   ${formResult.slice(0, 500)}`);
		}
		console.log("   ---");

		// Step 11: Take post-submit screenshot
		console.log("\n11. Taking post-submit screenshot...");
		const postScreenshot = await client.screenshot({
			type: "jpeg",
			quality: 80,
			fullPage: true,
		});
		console.log(
			`   Full page screenshot: ${Math.round(postScreenshot.data.length / 1024)}KB`,
		);

		// Step 12: Test navigation history
		console.log("\n12. Testing navigation history...");
		await client.goBack();
		console.log("   Navigated back");

		await client.waitForSelector("form", { timeout: 10000 });
		console.log("   Form page restored");

		await client.goForward();
		console.log("   Navigated forward");

		await client.waitForSelector("pre", { timeout: 10000 });
		console.log("   Result page restored");

		// Step 13: Test reload
		console.log("\n13. Testing reload...");
		await client.reload();
		await client.waitForSelector("pre", { timeout: 10000 });
		console.log("   Page reloaded successfully");

		// Step 14: Test viewport change
		console.log("\n14. Testing viewport change...");
		await client.setViewport(1920, 1080);
		console.log("   Viewport set to 1920x1080");

		// Step 15: Final latency check
		console.log("\n15. Final latency check...");
		const finalLatency = await client.ping();
		console.log(`   Ping latency: ${finalLatency}ms`);

		// Summary
		const totalTime = Date.now() - startTime;
		console.log("\n=== Test Summary ===");
		console.log(`   Total time: ${totalTime}ms`);
		console.log(`   Initial latency: ${latency}ms`);
		console.log(`   Final latency: ${finalLatency}ms`);
		console.log("   Status: ALL TESTS PASSED");
	} catch (error) {
		console.error("\n=== Test Failed ===");

		if (BrowserdError.isBrowserdError(error)) {
			console.error(`   Error Code: ${error.code}`);
			console.error(`   Message: ${error.message}`);
			if (error.details) {
				console.error(`   Details: ${JSON.stringify(error.details, null, 2)}`);
			}
			if (error.cause) {
				console.error(`   Cause: ${error.cause.message}`);
			}
		} else if (error instanceof Error) {
			console.error(`   Error: ${error.message}`);
			console.error(`   Stack: ${error.stack}`);
		} else {
			console.error(`   Unknown error: ${error}`);
		}

		process.exit(1);
	} finally {
		// Cleanup
		if (sandboxId && !options.skipCleanup) {
			console.log("\n16. Cleaning up...");
			try {
				await manager.destroy(sandboxId);
				console.log(`   Sandbox ${sandboxId} destroyed`);
			} catch (err) {
				console.error(
					`   Failed to destroy sandbox: ${err instanceof Error ? err.message : err}`,
				);
			}
		} else if (sandboxId && options.skipCleanup) {
			console.log("\n16. Skipping cleanup (--skip-cleanup flag set)");
			console.log(`   Sandbox ID: ${sandboxId}`);
			console.log("   Remember to manually destroy the sandbox when done!");
		}

		console.log("\nDone.");
	}
}

main();
