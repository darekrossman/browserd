/**
 * Protocol Types Tests
 *
 * Unit tests for message type guards and utilities
 */

import { describe, expect, test } from "bun:test";
import {
	type CommandMessage,
	createErrorResult,
	createEventMessage,
	createFrameMessage,
	createPongMessage,
	createSuccessResult,
	type EventMessage,
	type FrameMessage,
	type InputMessage,
	isClientMessage,
	isCommandMessage,
	isEventMessage,
	isFrameMessage,
	isInputMessage,
	isPingMessage,
	isPlaywrightMethod,
	isPongMessage,
	isResultMessage,
	isServerMessage,
	isViewport,
	type PingMessage,
	type PongMessage,
	parseClientMessage,
	type ResultMessage,
	serializeServerMessage,
} from "./types";

describe("Type Guards - Client Messages", () => {
	describe("isCommandMessage", () => {
		test("validates correct command message", () => {
			const msg: CommandMessage = {
				id: "123",
				type: "cmd",
				method: "navigate",
				params: { url: "https://example.com" },
			};
			expect(isCommandMessage(msg)).toBe(true);
			expect(isClientMessage(msg)).toBe(true);
		});

		test("validates command without params", () => {
			const msg: CommandMessage = {
				id: "123",
				type: "cmd",
				method: "reload",
			};
			expect(isCommandMessage(msg)).toBe(true);
		});

		test("rejects missing id", () => {
			const msg = { type: "cmd", method: "navigate" };
			expect(isCommandMessage(msg)).toBe(false);
		});

		test("rejects missing method", () => {
			const msg = { id: "123", type: "cmd" };
			expect(isCommandMessage(msg)).toBe(false);
		});

		test("accepts unknown method (validation delegated to executor)", () => {
			// Unknown methods are accepted so executor can return UNKNOWN_METHOD error
			const msg = { id: "123", type: "cmd", method: "invalidMethod" };
			expect(isCommandMessage(msg)).toBe(true);
		});

		test("rejects null", () => {
			expect(isCommandMessage(null)).toBe(false);
		});

		test("rejects undefined", () => {
			expect(isCommandMessage(undefined)).toBe(false);
		});
	});

	describe("isInputMessage", () => {
		test("validates mouse move message", () => {
			const msg: InputMessage = {
				type: "input",
				device: "mouse",
				action: "move",
				x: 100,
				y: 200,
			};
			expect(isInputMessage(msg)).toBe(true);
			expect(isClientMessage(msg)).toBe(true);
		});

		test("validates mouse click message", () => {
			const msg: InputMessage = {
				type: "input",
				device: "mouse",
				action: "click",
				x: 100,
				y: 200,
				button: "left",
				clickCount: 1,
			};
			expect(isInputMessage(msg)).toBe(true);
		});

		test("validates mouse wheel message", () => {
			const msg: InputMessage = {
				type: "input",
				device: "mouse",
				action: "wheel",
				deltaX: 0,
				deltaY: -100,
			};
			expect(isInputMessage(msg)).toBe(true);
		});

		test("validates keyboard message", () => {
			const msg: InputMessage = {
				type: "input",
				device: "key",
				action: "press",
				key: "Enter",
				code: "Enter",
				modifiers: { ctrl: false, shift: false },
			};
			expect(isInputMessage(msg)).toBe(true);
		});

		test("validates keyboard with modifiers", () => {
			const msg: InputMessage = {
				type: "input",
				device: "key",
				action: "down",
				key: "a",
				modifiers: { ctrl: true, shift: false, alt: false, meta: false },
			};
			expect(isInputMessage(msg)).toBe(true);
		});

		test("rejects invalid device", () => {
			const msg = { type: "input", device: "touch", action: "tap" };
			expect(isInputMessage(msg)).toBe(false);
		});

		test("rejects invalid mouse action", () => {
			const msg = { type: "input", device: "mouse", action: "swipe" };
			expect(isInputMessage(msg)).toBe(false);
		});

		test("rejects invalid key action", () => {
			const msg = { type: "input", device: "key", action: "hold" };
			expect(isInputMessage(msg)).toBe(false);
		});

		test("rejects non-number coordinates", () => {
			const msg = {
				type: "input",
				device: "mouse",
				action: "move",
				x: "100",
				y: 200,
			};
			expect(isInputMessage(msg)).toBe(false);
		});
	});

	describe("isPingMessage", () => {
		test("validates correct ping message", () => {
			const msg: PingMessage = { type: "ping", t: Date.now() };
			expect(isPingMessage(msg)).toBe(true);
			expect(isClientMessage(msg)).toBe(true);
		});

		test("rejects missing timestamp", () => {
			const msg = { type: "ping" };
			expect(isPingMessage(msg)).toBe(false);
		});

		test("rejects non-number timestamp", () => {
			const msg = { type: "ping", t: "now" };
			expect(isPingMessage(msg)).toBe(false);
		});
	});

	describe("isPlaywrightMethod", () => {
		const validMethods = [
			"navigate",
			"click",
			"dblclick",
			"hover",
			"type",
			"press",
			"fill",
			"waitForSelector",
			"setViewport",
			"evaluate",
			"screenshot",
			"goBack",
			"goForward",
			"reload",
		];

		validMethods.forEach((method) => {
			test(`accepts "${method}"`, () => {
				expect(isPlaywrightMethod(method)).toBe(true);
			});
		});

		test("rejects invalid method", () => {
			expect(isPlaywrightMethod("invalidMethod")).toBe(false);
		});

		test("rejects non-string", () => {
			expect(isPlaywrightMethod(123)).toBe(false);
		});
	});
});

describe("Type Guards - Server Messages", () => {
	describe("isFrameMessage", () => {
		test("validates correct frame message", () => {
			const msg: FrameMessage = {
				type: "frame",
				format: "jpeg",
				data: "base64data...",
				viewport: { w: 1280, h: 720, dpr: 1 },
				timestamp: Date.now(),
			};
			expect(isFrameMessage(msg)).toBe(true);
			expect(isServerMessage(msg)).toBe(true);
		});

		test("rejects missing viewport", () => {
			const msg = {
				type: "frame",
				format: "jpeg",
				data: "base64data...",
				timestamp: Date.now(),
			};
			expect(isFrameMessage(msg)).toBe(false);
		});

		test("rejects invalid viewport", () => {
			const msg = {
				type: "frame",
				format: "jpeg",
				data: "base64data...",
				viewport: { width: 1280, height: 720 }, // wrong keys
				timestamp: Date.now(),
			};
			expect(isFrameMessage(msg)).toBe(false);
		});

		test("rejects wrong format", () => {
			const msg = {
				type: "frame",
				format: "png",
				data: "base64data...",
				viewport: { w: 1280, h: 720, dpr: 1 },
				timestamp: Date.now(),
			};
			expect(isFrameMessage(msg)).toBe(false);
		});
	});

	describe("isResultMessage", () => {
		test("validates success result", () => {
			const msg: ResultMessage = {
				id: "123",
				type: "result",
				ok: true,
				result: { url: "https://example.com" },
			};
			expect(isResultMessage(msg)).toBe(true);
			expect(isServerMessage(msg)).toBe(true);
		});

		test("validates error result", () => {
			const msg: ResultMessage = {
				id: "123",
				type: "result",
				ok: false,
				error: { code: "TIMEOUT", message: "Operation timed out" },
			};
			expect(isResultMessage(msg)).toBe(true);
		});

		test("rejects missing ok field", () => {
			const msg = { id: "123", type: "result" };
			expect(isResultMessage(msg)).toBe(false);
		});

		test("rejects non-boolean ok", () => {
			const msg = { id: "123", type: "result", ok: "true" };
			expect(isResultMessage(msg)).toBe(false);
		});
	});

	describe("isEventMessage", () => {
		test("validates ready event", () => {
			const msg: EventMessage = {
				type: "event",
				name: "ready",
				data: { viewport: { w: 1280, h: 720 } },
			};
			expect(isEventMessage(msg)).toBe(true);
			expect(isServerMessage(msg)).toBe(true);
		});

		test("validates navigated event", () => {
			const msg: EventMessage = {
				type: "event",
				name: "navigated",
				data: { url: "https://example.com" },
			};
			expect(isEventMessage(msg)).toBe(true);
		});

		test("validates console event", () => {
			const msg: EventMessage = {
				type: "event",
				name: "console",
				data: { level: "log", text: "Hello" },
			};
			expect(isEventMessage(msg)).toBe(true);
		});

		test("validates error event", () => {
			const msg: EventMessage = {
				type: "event",
				name: "error",
				data: { message: "Page crashed" },
			};
			expect(isEventMessage(msg)).toBe(true);
		});

		test("rejects invalid event name", () => {
			const msg = { type: "event", name: "unknown" };
			expect(isEventMessage(msg)).toBe(false);
		});
	});

	describe("isPongMessage", () => {
		test("validates correct pong message", () => {
			const msg: PongMessage = { type: "pong", t: Date.now() };
			expect(isPongMessage(msg)).toBe(true);
			expect(isServerMessage(msg)).toBe(true);
		});

		test("rejects missing timestamp", () => {
			const msg = { type: "pong" };
			expect(isPongMessage(msg)).toBe(false);
		});
	});

	describe("isViewport", () => {
		test("validates correct viewport", () => {
			expect(isViewport({ w: 1280, h: 720, dpr: 1 })).toBe(true);
		});

		test("validates viewport with decimal dpr", () => {
			expect(isViewport({ w: 1280, h: 720, dpr: 2.5 })).toBe(true);
		});

		test("rejects missing w", () => {
			expect(isViewport({ h: 720, dpr: 1 })).toBe(false);
		});

		test("rejects missing h", () => {
			expect(isViewport({ w: 1280, dpr: 1 })).toBe(false);
		});

		test("rejects missing dpr", () => {
			expect(isViewport({ w: 1280, h: 720 })).toBe(false);
		});

		test("rejects null", () => {
			expect(isViewport(null)).toBe(false);
		});
	});
});

describe("Utility Functions", () => {
	describe("parseClientMessage", () => {
		test("parses valid command message", () => {
			const json = JSON.stringify({
				id: "123",
				type: "cmd",
				method: "navigate",
				params: { url: "https://example.com" },
			});
			const result = parseClientMessage(json);
			expect(result).not.toBeNull();
			expect(result?.type).toBe("cmd");
		});

		test("parses valid input message", () => {
			const json = JSON.stringify({
				type: "input",
				device: "mouse",
				action: "click",
				x: 100,
				y: 200,
			});
			const result = parseClientMessage(json);
			expect(result).not.toBeNull();
			expect(result?.type).toBe("input");
		});

		test("parses valid ping message", () => {
			const json = JSON.stringify({ type: "ping", t: 12345 });
			const result = parseClientMessage(json);
			expect(result).not.toBeNull();
			expect(result?.type).toBe("ping");
		});

		test("returns null for invalid JSON", () => {
			expect(parseClientMessage("not json")).toBeNull();
		});

		test("returns null for invalid message", () => {
			expect(parseClientMessage('{"type":"unknown"}')).toBeNull();
		});

		test("returns null for empty string", () => {
			expect(parseClientMessage("")).toBeNull();
		});
	});

	describe("serializeServerMessage", () => {
		test("serializes frame message", () => {
			const msg: FrameMessage = {
				type: "frame",
				format: "jpeg",
				data: "abc123",
				viewport: { w: 1280, h: 720, dpr: 1 },
				timestamp: 12345,
			};
			const json = serializeServerMessage(msg);
			const parsed = JSON.parse(json);
			expect(parsed.type).toBe("frame");
			expect(parsed.data).toBe("abc123");
		});

		test("serializes result message", () => {
			const msg: ResultMessage = {
				id: "123",
				type: "result",
				ok: true,
				result: { url: "https://example.com" },
			};
			const json = serializeServerMessage(msg);
			const parsed = JSON.parse(json);
			expect(parsed.id).toBe("123");
			expect(parsed.ok).toBe(true);
		});
	});

	describe("createSuccessResult", () => {
		test("creates success result without data", () => {
			const result = createSuccessResult("123");
			expect(result.id).toBe("123");
			expect(result.type).toBe("result");
			expect(result.ok).toBe(true);
			expect(result.result).toBeUndefined();
		});

		test("creates success result with data", () => {
			const result = createSuccessResult("123", { url: "https://example.com" });
			expect(result.result).toEqual({ url: "https://example.com" });
		});
	});

	describe("createErrorResult", () => {
		test("creates error result", () => {
			const result = createErrorResult("123", "TIMEOUT", "Operation timed out");
			expect(result.id).toBe("123");
			expect(result.type).toBe("result");
			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("TIMEOUT");
			expect(result.error?.message).toBe("Operation timed out");
		});

		test("creates error result with details", () => {
			const result = createErrorResult(
				"123",
				"SELECTOR_NOT_FOUND",
				"Element not found",
				{
					selector: "#button",
				},
			);
			expect(result.error?.details).toEqual({ selector: "#button" });
		});
	});

	describe("createEventMessage", () => {
		test("creates event message without data", () => {
			const msg = createEventMessage("ready");
			expect(msg.type).toBe("event");
			expect(msg.name).toBe("ready");
			expect(msg.data).toBeUndefined();
		});

		test("creates event message with data", () => {
			const msg = createEventMessage("navigated", {
				url: "https://example.com",
			});
			expect(msg.data).toEqual({ url: "https://example.com" });
		});
	});

	describe("createFrameMessage", () => {
		test("creates frame message", () => {
			const msg = createFrameMessage(
				"base64data",
				{ w: 1280, h: 720, dpr: 1 },
				12345,
			);
			expect(msg.type).toBe("frame");
			expect(msg.format).toBe("jpeg");
			expect(msg.data).toBe("base64data");
			expect(msg.viewport).toEqual({ w: 1280, h: 720, dpr: 1 });
			expect(msg.timestamp).toBe(12345);
		});
	});

	describe("createPongMessage", () => {
		test("creates pong message", () => {
			const msg = createPongMessage(12345);
			expect(msg.type).toBe("pong");
			expect(msg.t).toBe(12345);
		});
	});
});

describe("Edge Cases", () => {
	test("handles empty objects", () => {
		expect(isClientMessage({})).toBe(false);
		expect(isServerMessage({})).toBe(false);
	});

	test("handles arrays", () => {
		expect(isClientMessage([])).toBe(false);
		expect(isServerMessage([])).toBe(false);
	});

	test("handles primitives", () => {
		expect(isClientMessage("string")).toBe(false);
		expect(isClientMessage(123)).toBe(false);
		expect(isClientMessage(true)).toBe(false);
	});

	test("handles objects with extra properties", () => {
		const msg = {
			id: "123",
			type: "cmd",
			method: "navigate",
			extra: "property",
		};
		expect(isCommandMessage(msg)).toBe(true);
	});
});
