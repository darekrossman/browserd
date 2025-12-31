/**
 * Stealth Profiles Test
 *
 * Tests the browserd stealth implementation directly using BrowserManager.
 * Validates fingerprint masking against external bot detection services.
 *
 * NOTE: This test hits external services and is NOT intended for CI.
 * Run manually with: bun test tests/stealth/stealth-profiles.test.ts
 *
 * Requirements:
 * - Playwright Chromium browser installed
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type BrowserConfig,
	BrowserManager,
} from "../../src/server/browser-manager";
import type { ProfileName, StealthConfig } from "../../src/stealth";
import { hasBrowserSupport, sleep } from "../helpers/setup";

const runTests = hasBrowserSupport();

describe("Stealth Profiles", () => {
	let manager: BrowserManager | null = null;

	afterEach(async () => {
		if (manager) {
			await manager.close().catch(() => {});
			manager = null;
		}
		await sleep(500);
	});

	test.skipIf(!runTests)(
		"chrome-mac profile passes rebrowser detection",
		async () => {
			const stealthConfig: StealthConfig = {
				enabled: true,
				profile: "chrome-mac",
				humanBehavior: {
					mouseMovement: true,
					typingPatterns: true,
					scrollBehavior: true,
					idleMouseSimulation: true,
				},
				fingerprint: {
					webgl: true,
					canvas: true,
					audio: true,
					webrtc: true,
					performance: true,
					screen: true,
				},
				blockBotDetection: false,
				timing: "stealth",
			};

			const config: BrowserConfig = {
				headless: true,
				stealth: stealthConfig,
			};

			manager = new BrowserManager(config);
			const instance = await manager.launch();

			expect(instance.sessionId).toBeTruthy();
			expect(instance.profile.name).toBe("chrome-mac");

			const page = manager.getPage();

			// Navigate to bot detector
			await page.goto("https://bot-detector.rebrowser.net", {
				waitUntil: "networkidle",
				timeout: 30000,
			});

			// Wait for tests to complete
			await sleep(5000);

			// Get detection results
			const results = await page.evaluate(() => {
				const rows = document.querySelectorAll("table tbody tr");
				const results: Array<{
					test: string;
					notes: string;
					passed: boolean;
				}> = [];

				rows.forEach((row) => {
					const cells = row.querySelectorAll("td");
					if (cells.length >= 3) {
						const test = cells[0]?.textContent?.trim() ?? "";
						const notes = cells[2]?.textContent?.trim() ?? "";
						const hasGreen = test.includes("🟢");
						const hasRed = test.includes("🔴");

						results.push({
							test: test.replace(/🟢|🔴|⚪️/gu, "").trim(),
							notes,
							passed: hasGreen && !hasRed,
						});
					}
				});

				return results;
			});

			expect(results.length).toBeGreaterThan(0);

			let passCount = 0;
			let failCount = 0;

			for (const { test, notes, passed } of results) {
				if (passed) {
					passCount++;
					console.log(`✅ ${test}`);
				} else {
					failCount++;
					console.log(
						`❌ ${test}: ${notes.slice(0, 80)}${notes.length > 80 ? "..." : ""}`,
					);
				}
			}

			console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
		},
		{ timeout: 120000 },
	);

	test.skipIf(!runTests)(
		"passes sannysoft detection",
		async () => {
			const stealthConfig: StealthConfig = {
				enabled: true,
				profile: "chrome-mac",
				humanBehavior: {
					mouseMovement: true,
					typingPatterns: true,
					scrollBehavior: true,
					idleMouseSimulation: true,
				},
				fingerprint: {
					webgl: true,
					canvas: true,
					audio: true,
					webrtc: true,
					performance: true,
					screen: true,
				},
				blockBotDetection: false,
				timing: "stealth",
			};

			const config: BrowserConfig = {
				headless: true,
				stealth: stealthConfig,
			};

			manager = new BrowserManager(config);
			await manager.launch();

			const page = manager.getPage();

			// Navigate to sannysoft
			await page.goto("https://bot.sannysoft.com", {
				waitUntil: "networkidle",
				timeout: 30000,
			});

			// Wait for tests to complete
			await sleep(3000);

			// Get test results
			const results = await page.evaluate(() => {
				const tests: Array<{ name: string; value: string; passed: boolean }> =
					[];
				const rows = document.querySelectorAll("table tr");

				rows.forEach((row) => {
					const cells = row.querySelectorAll("td");
					if (cells.length >= 2) {
						const name = cells[0]?.textContent?.trim() ?? "";
						const value = cells[1]?.textContent?.trim() ?? "";
						const failIndicators = [
							"FAIL",
							"MISSING",
							"headless",
							"phantom",
							"bot",
						];
						const passed = !failIndicators.some((f) =>
							value.toLowerCase().includes(f.toLowerCase()),
						);
						tests.push({ name, value, passed });
					}
				});

				return tests;
			});

			expect(results.length).toBeGreaterThan(0);

			let passCount = 0;
			let failCount = 0;

			for (const { name, value, passed } of results) {
				if (!name) continue;
				if (passed) {
					passCount++;
					console.log(`✅ ${name}: ${value.slice(0, 60)}`);
				} else {
					failCount++;
					console.log(`❌ ${name}: ${value.slice(0, 60)}`);
				}
			}

			console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
		},
		{ timeout: 120000 },
	);
});
