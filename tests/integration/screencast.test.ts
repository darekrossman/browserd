/**
 * Screencast Integration Tests
 *
 * Tests CDP screencast functionality (run in container)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
	EventMessage,
	FrameMessage,
	ServerMessage,
} from "../../src/protocol/types";
import { BrowserManager } from "../../src/server/browser-manager";
import { CDPSessionManager } from "../../src/server/cdp-session";
import {
	forceCloseBrowser,
	hasBrowserSupport,
	sleep,
	withTimeout,
} from "../helpers/setup";

const runTests = hasBrowserSupport();

describe("CDPSessionManager Integration", () => {
	let browserManager: BrowserManager;
	let cdpSession: CDPSessionManager;
	let receivedFrames: FrameMessage[];
	let receivedEvents: ServerMessage[];

	beforeEach(async () => {
		receivedFrames = [];
		receivedEvents = [];

		browserManager = new BrowserManager({
			headless: true,
			viewport: { width: 800, height: 600 },
		});

		await browserManager.launch();
	});

	afterEach(async () => {
		if (cdpSession) {
			await withTimeout(
				cdpSession.close().catch(() => {}),
				3000,
			);
		}
		await forceCloseBrowser(browserManager);
	});

	test.skipIf(!runTests)("creates CDP session successfully", async () => {
		const page = browserManager.getPage();

		cdpSession = new CDPSessionManager(page, {
			onFrame: (frame) => receivedFrames.push(frame),
			onEvent: (event) => receivedEvents.push(event),
		});

		await cdpSession.init();

		// Should emit ready event
		expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
		expect(receivedEvents[0]!.type).toBe("event");
		expect((receivedEvents[0]! as EventMessage).name).toBe("ready");
	});

	test.skipIf(!runTests)("starts and stops screencast", async () => {
		const page = browserManager.getPage();

		cdpSession = new CDPSessionManager(page, {
			screencast: {
				format: "jpeg",
				quality: 50,
				maxWidth: 800,
				maxHeight: 600,
			},
			onFrame: (frame) => receivedFrames.push(frame),
			onEvent: (event) => receivedEvents.push(event),
		});

		await cdpSession.init();
		expect(cdpSession.isScreencastActive()).toBe(false);

		await cdpSession.startScreencast();
		expect(cdpSession.isScreencastActive()).toBe(true);

		await cdpSession.stopScreencast();
		expect(cdpSession.isScreencastActive()).toBe(false);
	});

	test.skipIf(!runTests)("emits frames during screencast", async () => {
		const page = browserManager.getPage();

		// Navigate to a page with content
		await page.goto(
			"data:text/html,<h1 style='background:red;height:100vh'>Test Page</h1>",
		);

		cdpSession = new CDPSessionManager(page, {
			screencast: {
				format: "jpeg",
				quality: 60,
				maxWidth: 800,
				maxHeight: 600,
			},
			onFrame: (frame) => receivedFrames.push(frame),
			onEvent: (event) => receivedEvents.push(event),
		});

		await cdpSession.init();
		await cdpSession.startScreencast();

		// Wait for frames
		await sleep(1000);

		expect(receivedFrames.length).toBeGreaterThan(0);

		// Verify frame structure
		const frame = receivedFrames[0]!;
		expect(frame.type).toBe("frame");
		expect(frame.format).toBe("jpeg");
		expect(frame.data).toBeDefined();
		expect(frame.data.length).toBeGreaterThan(100); // Should have actual content
		expect(frame.viewport).toBeDefined();
		expect(frame.viewport.w).toBeGreaterThan(0);
		expect(frame.viewport.h).toBeGreaterThan(0);
		expect(frame.timestamp).toBeGreaterThan(0);
	});

	test.skipIf(!runTests)("frames are valid JPEG data", async () => {
		const page = browserManager.getPage();

		await page.goto(
			"data:text/html,<div style='background:blue;width:100%;height:100%'></div>",
		);

		cdpSession = new CDPSessionManager(page, {
			screencast: { format: "jpeg", quality: 80 },
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();
		await cdpSession.startScreencast();

		// Wait for frame
		await sleep(500);

		expect(receivedFrames.length).toBeGreaterThan(0);

		// Decode base64 and check JPEG magic bytes
		const frame = receivedFrames[0]!;
		const buffer = Buffer.from(frame.data, "base64");

		// JPEG starts with FF D8 FF
		expect(buffer[0]).toBe(0xff);
		expect(buffer[1]).toBe(0xd8);
		expect(buffer[2]).toBe(0xff);
	});

	test.skipIf(!runTests)("viewport info is correct", async () => {
		const page = browserManager.getPage();

		cdpSession = new CDPSessionManager(page, {
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();

		const viewport = cdpSession.getViewport();
		expect(viewport.w).toBe(800);
		expect(viewport.h).toBe(600);
		expect(viewport.dpr).toBeGreaterThanOrEqual(1);
	});

	test.skipIf(!runTests)("stops screencast cleanly", async () => {
		const page = browserManager.getPage();

		cdpSession = new CDPSessionManager(page, {
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();
		await cdpSession.startScreencast();

		// Wait for some frames
		await sleep(500);
		const frameCountBefore = receivedFrames.length;
		expect(frameCountBefore).toBeGreaterThan(0);

		// Stop screencast
		await cdpSession.stopScreencast();

		// Clear and wait
		receivedFrames = [];
		await sleep(500);

		// Should not receive more frames after stopping
		expect(receivedFrames.length).toBe(0);
	});

	test.skipIf(!runTests)("frame acknowledgment works", async () => {
		const page = browserManager.getPage();

		// Use an animated page to ensure continuous frame updates
		await page.goto(`data:text/html,
      <div id="box" style="width:100px;height:100px;background:red;position:absolute;"></div>
      <script>
        let pos = 0;
        setInterval(() => {
          pos = (pos + 5) % 300;
          document.getElementById('box').style.left = pos + 'px';
        }, 50);
      </script>
    `);

		cdpSession = new CDPSessionManager(page, {
			screencast: { everyNthFrame: 1 },
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();
		await cdpSession.startScreencast();

		// Wait to receive multiple frames (proving ack works)
		await sleep(1500);

		// Should receive multiple frames due to animation
		expect(receivedFrames.length).toBeGreaterThan(3);
	});

	test.skipIf(!runTests)("provides stats information", async () => {
		const page = browserManager.getPage();

		// Use animated content to ensure frames are generated
		await page.goto(`data:text/html,
      <div id="counter">0</div>
      <script>
        let i = 0;
        setInterval(() => {
          document.getElementById('counter').textContent = ++i;
        }, 100);
      </script>
    `);

		cdpSession = new CDPSessionManager(page, {
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();
		await cdpSession.startScreencast();

		// Wait for frames
		await sleep(1000);

		const stats = cdpSession.getStats();
		expect(stats.frameCount).toBeGreaterThan(0);
		expect(stats.lastFrameTime).toBeGreaterThan(0);
		// FPS might be 0 if elapsed time is very small, but should be defined
		expect(typeof stats.fps).toBe("number");
	});

	test.skipIf(!runTests)("closes CDP session cleanly", async () => {
		const page = browserManager.getPage();

		cdpSession = new CDPSessionManager(page, {
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();
		await cdpSession.startScreencast();

		await sleep(300);
		expect(cdpSession.isScreencastActive()).toBe(true);

		await cdpSession.close();
		expect(cdpSession.isScreencastActive()).toBe(false);

		// Should not throw when closing again
		await cdpSession.close();
	});
});

describe("CDPSessionManager - Multiple Screencasts", () => {
	let browserManager: BrowserManager;
	let receivedFrames: FrameMessage[];

	beforeEach(async () => {
		receivedFrames = [];
		browserManager = new BrowserManager({ headless: true });
		await browserManager.launch();
	});

	afterEach(async () => {
		await forceCloseBrowser(browserManager);
	});

	test.skipIf(!runTests)("can restart screencast", async () => {
		const page = browserManager.getPage();

		const cdpSession = new CDPSessionManager(page, {
			onFrame: (frame) => receivedFrames.push(frame),
		});

		await cdpSession.init();

		// First screencast session
		await cdpSession.startScreencast();
		await sleep(500);
		const firstSessionFrames = receivedFrames.length;
		await cdpSession.stopScreencast();

		// Clear frames
		receivedFrames = [];

		// Second screencast session
		await cdpSession.startScreencast();
		await sleep(500);

		expect(receivedFrames.length).toBeGreaterThan(0);

		await cdpSession.close();
	});
});
