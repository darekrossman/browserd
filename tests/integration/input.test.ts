/**
 * Input Integration Tests
 *
 * Tests mouse and keyboard input dispatch (run in container)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { InputMessage } from "../../src/protocol/types";
import { BrowserManager } from "../../src/server/browser-manager";
import { CDPSessionManager } from "../../src/server/cdp-session";
import {
	focusInMainContext,
	inputValueInMainContext,
	textContentInMainContext,
} from "../../src/stealth";
import {
	forceCloseBrowser,
	hasBrowserSupport,
	sleep,
	withTimeout,
} from "../helpers/setup";

const runTests = hasBrowserSupport();

describe("Input Dispatch Integration", () => {
	let browserManager: BrowserManager;
	let cdpSession: CDPSessionManager;

	beforeEach(async () => {
		browserManager = new BrowserManager({
			headless: true,
			viewport: { width: 800, height: 600 },
		});

		await browserManager.launch();

		const page = browserManager.getPage();
		cdpSession = new CDPSessionManager(page, {});
		await cdpSession.init();
	});

	afterEach(async () => {
		if (cdpSession) {
			await withTimeout(
				cdpSession.close().catch(() => {}),
				3000,
			);
		}
		await forceCloseBrowser(browserManager);
		// Delay to ensure browser process fully terminates before next test
		await sleep(500);
	});

	describe("Mouse Events", () => {
		test.skipIf(!runTests)("dispatches mouse move event", async () => {
			const page = browserManager.getPage();

			// Create page that tracks mouse position
			await page.goto(`data:text/html,
        <div id="output" style="font-size:24px">x: 0, y: 0</div>
        <script>
          document.addEventListener('mousemove', (e) => {
            document.getElementById('output').textContent = 'x: ' + e.clientX + ', y: ' + e.clientY;
          });
        </script>
      `);

			// Dispatch mouse move
			const input: InputMessage = {
				type: "input",
				device: "mouse",
				action: "move",
				x: 100,
				y: 150,
			};

			await cdpSession.dispatchInput(input);
			await sleep(100);

			// Verify mouse position was captured
			const output = await textContentInMainContext(page, "#output");
			expect(output).toContain("x: 100");
			expect(output).toContain("y: 150");
		});

		test.skipIf(!runTests)("dispatches mouse click event", async () => {
			const page = browserManager.getPage();

			// Create page with clickable button
			await page.goto(`data:text/html,
        <button id="btn" style="width:200px;height:100px;position:absolute;left:100px;top:100px;">Click Me</button>
        <div id="result">Not clicked</div>
        <script>
          document.getElementById('btn').addEventListener('click', () => {
            document.getElementById('result').textContent = 'Clicked!';
          });
        </script>
      `);

			// Click in the center of the button (100 + 100, 100 + 50)
			const input: InputMessage = {
				type: "input",
				device: "mouse",
				action: "click",
				x: 200,
				y: 150,
				button: "left",
				clickCount: 1,
			};

			await cdpSession.dispatchInput(input);
			await sleep(100);

			const result = await textContentInMainContext(page, "#result");
			expect(result).toBe("Clicked!");
		});

		test.skipIf(!runTests)("dispatches mouse double click", async () => {
			const page = browserManager.getPage();

			await page.goto(
				`data:text/html,<html><body style="margin:0;padding:0;"><div id="target" style="width:200px;height:200px;background:%23ccc;position:absolute;left:0;top:0;">Double click me</div><div id="result">0</div><script>var c=0;document.getElementById('target').addEventListener('dblclick',function(){c++;document.getElementById('result').textContent=String(c);});</script></body></html>`,
			);

			await cdpSession.dispatchInput({
				type: "input",
				device: "mouse",
				action: "dblclick",
				x: 50,
				y: 50,
				button: "left",
			});
			await sleep(200);

			const result = await textContentInMainContext(page, "#result");
			expect(result).toBe("1");
		});

		test.skipIf(!runTests)("dispatches mouse wheel event", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <div id="scroll" style="width:100%;height:200px;overflow:auto;">
          <div style="height:1000px;background:linear-gradient(to bottom, red, blue);">
            Scroll content
          </div>
        </div>
        <div id="result">0</div>
        <script>
          document.getElementById('scroll').addEventListener('wheel', (e) => {
            document.getElementById('result').textContent = String(e.deltaY);
          });
        </script>
      `);

			const input: InputMessage = {
				type: "input",
				device: "mouse",
				action: "wheel",
				x: 100,
				y: 100,
				deltaX: 0,
				deltaY: 100,
			};

			await cdpSession.dispatchInput(input);
			await sleep(100);

			const result = await textContentInMainContext(page, "#result");
			expect(parseInt(result || "0", 10)).toBe(100);
		});

		test.skipIf(!runTests)("dispatches right click", async () => {
			const page = browserManager.getPage();

			await page.goto(
				`data:text/html,<html><body style="margin:0;padding:0;"><div id="target" style="width:200px;height:200px;background:%23ccc;position:absolute;left:0;top:0;">Right click me</div><div id="result">none</div><script>document.getElementById('target').addEventListener('contextmenu',function(e){e.preventDefault();document.getElementById('result').textContent='right';});</script></body></html>`,
			);

			// Mouse down with right button
			await cdpSession.dispatchInput({
				type: "input",
				device: "mouse",
				action: "down",
				x: 50,
				y: 50,
				button: "right",
			});

			await cdpSession.dispatchInput({
				type: "input",
				device: "mouse",
				action: "up",
				x: 50,
				y: 50,
				button: "right",
			});

			await sleep(200);

			const result = await textContentInMainContext(page, "#result");
			expect(result).toBe("right");
		});
	});

	describe("Keyboard Events", () => {
		test.skipIf(!runTests)("dispatches key press event", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <input id="input" type="text" autofocus />
        <script>
          document.getElementById('input').focus();
        </script>
      `);

			// Focus input first
			await focusInMainContext(page, "#input");

			// Type a character
			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "a",
				code: "KeyA",
				text: "a",
			});

			await sleep(100);

			const value = await inputValueInMainContext(page, "#input");
			expect(value).toBe("a");
		});

		test.skipIf(!runTests)("dispatches multiple key presses", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <input id="input" type="text" />
      `);

			await focusInMainContext(page, "#input");

			// Type "hello"
			for (const char of "hello") {
				await cdpSession.dispatchInput({
					type: "input",
					device: "key",
					action: "press",
					key: char,
					code: `Key${char.toUpperCase()}`,
					text: char,
				});
			}

			await sleep(100);

			const value = await inputValueInMainContext(page, "#input");
			expect(value).toBe("hello");
		});

		test.skipIf(!runTests)("dispatches Enter key", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <form id="form">
          <input id="input" type="text" value="test" autofocus />
        </form>
        <div id="result">not submitted</div>
        <script>
          document.getElementById('form').addEventListener('submit', (e) => {
            e.preventDefault();
            document.getElementById('result').textContent = 'submitted';
          });
          // Ensure input is focused
          document.getElementById('input').focus();
        </script>
      `);

			// Wait for page to be ready and input to have focus
			await sleep(100);
			await focusInMainContext(page, "#input");
			await sleep(50);

			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "Enter",
				code: "Enter",
				text: "\r",
			});

			await sleep(200);

			const result = await textContentInMainContext(page, "#result");
			expect(result).toBe("submitted");
		});

		test.skipIf(!runTests)("dispatches keyboard with modifiers", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <input id="input" type="text" value="hello world" />
        <div id="result">none</div>
        <script>
          document.getElementById('input').addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'a') {
              document.getElementById('result').textContent = 'ctrl+a';
            }
          });
        </script>
      `);

			await focusInMainContext(page, "#input");

			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "a",
				code: "KeyA",
				modifiers: { ctrl: true },
			});

			await sleep(100);

			const result = await textContentInMainContext(page, "#result");
			expect(result).toBe("ctrl+a");
		});

		test.skipIf(!runTests)("dispatches special keys", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <input id="input" type="text" value="hello" />
      `);

			await focusInMainContext(page, "#input");

			// Move cursor to end
			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "End",
				code: "End",
			});

			// Press backspace to delete last character
			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "Backspace",
				code: "Backspace",
			});

			await sleep(100);

			const value = await inputValueInMainContext(page, "#input");
			expect(value).toBe("hell");
		});
	});

	describe("Combined Input", () => {
		test.skipIf(!runTests)("click and type sequence", async () => {
			const page = browserManager.getPage();

			await page.goto(`data:text/html,
        <input id="input1" type="text" style="position:absolute;left:10px;top:10px;width:200px;height:30px;" />
        <input id="input2" type="text" style="position:absolute;left:10px;top:50px;width:200px;height:30px;" />
      `);

			// Click on first input
			await cdpSession.dispatchInput({
				type: "input",
				device: "mouse",
				action: "click",
				x: 110,
				y: 25,
				button: "left",
			});

			await sleep(50);

			// Type in first input
			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "a",
				text: "a",
			});

			// Click on second input
			await cdpSession.dispatchInput({
				type: "input",
				device: "mouse",
				action: "click",
				x: 110,
				y: 65,
				button: "left",
			});

			await sleep(50);

			// Type in second input
			await cdpSession.dispatchInput({
				type: "input",
				device: "key",
				action: "press",
				key: "b",
				text: "b",
			});

			await sleep(100);

			const value1 = await inputValueInMainContext(page, "#input1");
			const value2 = await inputValueInMainContext(page, "#input2");

			expect(value1).toBe("a");
			expect(value2).toBe("b");
		});
	});
});
