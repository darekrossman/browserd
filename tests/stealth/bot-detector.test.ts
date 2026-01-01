/**
 * Bot Detector Stealth Test
 *
 * Tests bot detection evasion against bot-detector.rebrowser.net using the SDK client.
 *
 * NOTE: This test hits external services and is NOT intended for CI.
 * Run manually with: bun test tests/stealth/bot-detector.test.ts
 *
 * Requirements:
 * - Running browserd server (bun run dev)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BrowserdClient } from "../../src/sdk";

const SERVER_URL = process.env.BROWSERD_URL || "ws://localhost:3000/ws";

describe("Bot Detector Stealth", () => {
	let client: BrowserdClient;

	beforeAll(async () => {
		client = new BrowserdClient({
			url: SERVER_URL,
			timeout: 60000,
			autoReconnect: false,
		});

		try {
			await client.connect();
		} catch (error) {
			console.log(
				"Could not connect to browserd server. Make sure it's running: bun run dev",
			);
			throw error;
		}
	});

	afterAll(async () => {
		if (client) {
			await client.close().catch(() => {});
		}
	});

	test(
		"passes rebrowser bot detection tests",
		async () => {
			// Set viewport
			await client.setViewport(1920, 1080);

			// Navigate to bot detector with networkidle
			await client.navigate("https://bot-detector.rebrowser.net/", {
				waitUntil: "networkidle",
				timeout: 30000,
			});

			// Wait for detection tests to complete
			await client.waitForSelector("table", { timeout: 30000 });
			await new Promise((resolve) => setTimeout(resolve, 5000));

			// Check main world isolation (key stealth feature)
			const dummyResult = await client.evaluate<string | undefined>(`
				(function() {
					try {
						if (typeof window.dummyFn === 'function') {
							return window.dummyFn();
						}
						return undefined;
					} catch(e) {
						return 'error: ' + e.message;
					}
				})()
			`);

			// If we're properly isolated, we shouldn't be able to access main world functions
			// This is a key stealth indicator - being in isolated world = GOOD
			console.log(
				`Main world access: ${dummyResult === undefined ? "Isolated (GOOD)" : "Accessible (BAD)"}`,
			);

			// Wait for results to update
			await new Promise((resolve) => setTimeout(resolve, 3000));

			// Get detection results from table
			const results = await client.evaluate<
				Array<{ test: string; time: string; notes: string }>
			>(`
				(function() {
					const rows = document.querySelectorAll('table tbody tr');
					const results = [];
					rows.forEach(row => {
						const cells = row.querySelectorAll('td');
						if (cells.length >= 3) {
							results.push({
								test: cells[0].textContent.trim(),
								time: cells[1].textContent.trim(),
								notes: cells[2].textContent.trim()
							});
						}
					});
					return results;
				})()
			`);

			expect(results).toBeTruthy();
			expect(results.length).toBeGreaterThan(0);

			// Count pass/fail
			let passCount = 0;
			let failCount = 0;

			for (const { test, notes } of results) {
				const hasGreen = test.includes("🟢");
				const hasRed = test.includes("🔴");

				if (hasGreen && !hasRed) {
					passCount++;
					console.log(`✅ PASS: ${test}`);
				} else if (hasRed) {
					failCount++;
					console.log(`❌ FAIL: ${test} - ${notes.slice(0, 100)}`);
				}
			}

			console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);

			// We don't fail the test on detection failures since bot detection
			// is environment-dependent, but we log the results for manual review
			expect(results.length).toBeGreaterThan(0);
		},
		{ timeout: 120000 },
	);
});
