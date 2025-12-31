/**
 * Input Mapper Tests
 *
 * Unit tests for coordinate scaling and input mapping
 */

import { describe, expect, test } from "bun:test";
import {
	flagsToModifiers,
	getVirtualKeyCode,
	InputMapper,
	inputToKeyParams,
	inputToMouseParams,
	ModifierFlags,
	mapKeyAction,
	mapMouseAction,
	mapMouseButton,
	modifiersToFlags,
	type ScaleConfig,
	scaleCoordinates,
} from "./input-mapper";
import type { InputMessage, MouseButton, Viewport } from "./types";

describe("scaleCoordinates", () => {
	test("scales 1:1 when viewports match", () => {
		const config: ScaleConfig = {
			sourceWidth: 1280,
			sourceHeight: 720,
			targetWidth: 1280,
			targetHeight: 720,
		};

		const result = scaleCoordinates(640, 360, config);
		expect(result.x).toBe(640);
		expect(result.y).toBe(360);
	});

	test("scales up from smaller to larger viewport", () => {
		const config: ScaleConfig = {
			sourceWidth: 640,
			sourceHeight: 360,
			targetWidth: 1280,
			targetHeight: 720,
		};

		const result = scaleCoordinates(320, 180, config);
		expect(result.x).toBe(640);
		expect(result.y).toBe(360);
	});

	test("scales down from larger to smaller viewport", () => {
		const config: ScaleConfig = {
			sourceWidth: 1280,
			sourceHeight: 720,
			targetWidth: 640,
			targetHeight: 360,
		};

		const result = scaleCoordinates(640, 360, config);
		expect(result.x).toBe(320);
		expect(result.y).toBe(180);
	});

	test("handles non-uniform scaling", () => {
		const config: ScaleConfig = {
			sourceWidth: 800,
			sourceHeight: 600,
			targetWidth: 1280,
			targetHeight: 720,
		};

		const result = scaleCoordinates(400, 300, config);
		expect(result.x).toBe(640);
		expect(result.y).toBe(360);
	});

	test("clamps negative coordinates to 0", () => {
		const config: ScaleConfig = {
			sourceWidth: 1280,
			sourceHeight: 720,
			targetWidth: 1280,
			targetHeight: 720,
		};

		const result = scaleCoordinates(-100, -50, config);
		expect(result.x).toBe(0);
		expect(result.y).toBe(0);
	});

	test("clamps coordinates outside viewport", () => {
		const config: ScaleConfig = {
			sourceWidth: 1280,
			sourceHeight: 720,
			targetWidth: 1280,
			targetHeight: 720,
		};

		const result = scaleCoordinates(2000, 1500, config);
		expect(result.x).toBe(1279);
		expect(result.y).toBe(719);
	});

	test("handles zero source dimensions", () => {
		const config: ScaleConfig = {
			sourceWidth: 0,
			sourceHeight: 0,
			targetWidth: 1280,
			targetHeight: 720,
		};

		const result = scaleCoordinates(100, 100, config);
		expect(result.x).toBe(0);
		expect(result.y).toBe(0);
	});

	test("rounds coordinates to nearest integer", () => {
		const config: ScaleConfig = {
			sourceWidth: 1000,
			sourceHeight: 1000,
			targetWidth: 1280,
			targetHeight: 720,
		};

		// 500 * 1.28 = 640, 500 * 0.72 = 360
		const result = scaleCoordinates(500, 500, config);
		expect(Number.isInteger(result.x)).toBe(true);
		expect(Number.isInteger(result.y)).toBe(true);
	});
});

describe("modifiersToFlags", () => {
	test("returns 0 for no modifiers", () => {
		expect(modifiersToFlags()).toBe(0);
		expect(modifiersToFlags({})).toBe(0);
		expect(modifiersToFlags({ ctrl: false, shift: false })).toBe(0);
	});

	test("sets ctrl flag", () => {
		expect(modifiersToFlags({ ctrl: true })).toBe(ModifierFlags.CTRL);
	});

	test("sets shift flag", () => {
		expect(modifiersToFlags({ shift: true })).toBe(ModifierFlags.SHIFT);
	});

	test("sets alt flag", () => {
		expect(modifiersToFlags({ alt: true })).toBe(ModifierFlags.ALT);
	});

	test("sets meta flag", () => {
		expect(modifiersToFlags({ meta: true })).toBe(ModifierFlags.META);
	});

	test("combines multiple modifiers", () => {
		const flags = modifiersToFlags({
			ctrl: true,
			shift: true,
			alt: true,
			meta: true,
		});

		expect(flags).toBe(
			ModifierFlags.CTRL |
				ModifierFlags.SHIFT |
				ModifierFlags.ALT |
				ModifierFlags.META,
		);
	});

	test("ctrl + shift combination", () => {
		const flags = modifiersToFlags({ ctrl: true, shift: true });
		expect(flags).toBe(ModifierFlags.CTRL | ModifierFlags.SHIFT);
	});
});

describe("flagsToModifiers", () => {
	test("returns all false for 0", () => {
		const result = flagsToModifiers(0);
		expect(result.ctrl).toBe(false);
		expect(result.shift).toBe(false);
		expect(result.alt).toBe(false);
		expect(result.meta).toBe(false);
	});

	test("detects ctrl flag", () => {
		const result = flagsToModifiers(ModifierFlags.CTRL);
		expect(result.ctrl).toBe(true);
		expect(result.shift).toBe(false);
	});

	test("detects combined flags", () => {
		const flags = ModifierFlags.CTRL | ModifierFlags.SHIFT | ModifierFlags.ALT;
		const result = flagsToModifiers(flags);
		expect(result.ctrl).toBe(true);
		expect(result.shift).toBe(true);
		expect(result.alt).toBe(true);
		expect(result.meta).toBe(false);
	});

	test("roundtrip conversion", () => {
		const original = { ctrl: true, shift: false, alt: true, meta: false };
		const flags = modifiersToFlags(original);
		const result = flagsToModifiers(flags);
		expect(result).toEqual(original);
	});
});

describe("mapMouseButton", () => {
	test("maps left button", () => {
		expect(mapMouseButton("left")).toBe("left");
	});

	test("maps middle button", () => {
		expect(mapMouseButton("middle")).toBe("middle");
	});

	test("maps right button", () => {
		expect(mapMouseButton("right")).toBe("right");
	});

	test("returns none for undefined", () => {
		expect(mapMouseButton(undefined)).toBe("none");
	});

	test("returns none for unknown button", () => {
		// Test that unknown values are handled gracefully
		expect(mapMouseButton("unknown" as MouseButton)).toBe("none");
	});
});

describe("mapMouseAction", () => {
	test("maps move action", () => {
		expect(mapMouseAction("move")).toBe("mouseMoved");
	});

	test("maps down action", () => {
		expect(mapMouseAction("down")).toBe("mousePressed");
	});

	test("maps up action", () => {
		expect(mapMouseAction("up")).toBe("mouseReleased");
	});

	test("maps wheel action", () => {
		expect(mapMouseAction("wheel")).toBe("mouseWheel");
	});

	test("returns null for unknown action", () => {
		expect(mapMouseAction("click")).toBeNull(); // click is handled specially
		expect(mapMouseAction("unknown")).toBeNull();
	});
});

describe("mapKeyAction", () => {
	test("maps down action", () => {
		expect(mapKeyAction("down")).toBe("keyDown");
	});

	test("maps up action", () => {
		expect(mapKeyAction("up")).toBe("keyUp");
	});

	test("maps press action to keyDown", () => {
		expect(mapKeyAction("press")).toBe("keyDown");
	});

	test("returns null for unknown action", () => {
		expect(mapKeyAction("hold")).toBeNull();
	});
});

describe("getVirtualKeyCode", () => {
	test("returns code for Enter", () => {
		expect(getVirtualKeyCode("Enter")).toBe(13);
	});

	test("returns code for Escape", () => {
		expect(getVirtualKeyCode("Escape")).toBe(27);
	});

	test("returns code for arrow keys", () => {
		expect(getVirtualKeyCode("ArrowLeft")).toBe(37);
		expect(getVirtualKeyCode("ArrowUp")).toBe(38);
		expect(getVirtualKeyCode("ArrowRight")).toBe(39);
		expect(getVirtualKeyCode("ArrowDown")).toBe(40);
	});

	test("returns code for function keys", () => {
		expect(getVirtualKeyCode("F1")).toBe(112);
		expect(getVirtualKeyCode("F12")).toBe(123);
	});

	test("returns code for letters", () => {
		expect(getVirtualKeyCode("a")).toBe(65);
		expect(getVirtualKeyCode("A")).toBe(65);
		expect(getVirtualKeyCode("z")).toBe(90);
	});

	test("returns code for numbers", () => {
		expect(getVirtualKeyCode("0")).toBe(48);
		expect(getVirtualKeyCode("9")).toBe(57);
	});

	test("returns code for Space", () => {
		expect(getVirtualKeyCode(" ")).toBe(32);
		expect(getVirtualKeyCode("Space")).toBe(32);
	});

	test("returns undefined for unknown key", () => {
		expect(getVirtualKeyCode("UnknownKey")).toBeUndefined();
	});

	test("returns undefined for undefined", () => {
		expect(getVirtualKeyCode(undefined)).toBeUndefined();
	});
});

describe("inputToMouseParams", () => {
	const viewport: Viewport = { w: 1280, h: 720, dpr: 1 };

	test("converts mouse move", () => {
		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "move",
			x: 100,
			y: 200,
		};

		const params = inputToMouseParams(input, viewport);
		expect(params).not.toBeNull();
		expect(params?.type).toBe("mouseMoved");
		expect(params?.x).toBe(100);
		expect(params?.y).toBe(200);
	});

	test("converts mouse down with button", () => {
		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "down",
			x: 100,
			y: 200,
			button: "left",
		};

		const params = inputToMouseParams(input, viewport);
		expect(params?.type).toBe("mousePressed");
		expect(params?.button).toBe("left");
		expect(params?.clickCount).toBe(1);
	});

	test("converts wheel event", () => {
		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "wheel",
			x: 100,
			y: 200,
			deltaX: 0,
			deltaY: -100,
		};

		const params = inputToMouseParams(input, viewport);
		expect(params?.type).toBe("mouseWheel");
		expect(params?.deltaY).toBe(-100);
	});

	test("includes modifiers", () => {
		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "move",
			x: 100,
			y: 200,
			modifiers: { ctrl: true, shift: true },
		};

		const params = inputToMouseParams(input, viewport);
		expect(params?.modifiers).toBe(ModifierFlags.CTRL | ModifierFlags.SHIFT);
	});

	test("scales coordinates when client viewport differs", () => {
		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "move",
			x: 320,
			y: 180,
		};

		const clientViewport = { width: 640, height: 360 };
		const params = inputToMouseParams(input, viewport, clientViewport);

		// 320 scaled from 640 to 1280 = 640
		// 180 scaled from 360 to 720 = 360
		expect(params?.x).toBe(640);
		expect(params?.y).toBe(360);
	});

	test("returns null for keyboard input", () => {
		const input: InputMessage = {
			type: "input",
			device: "key",
			action: "down",
			key: "a",
		};

		expect(inputToMouseParams(input, viewport)).toBeNull();
	});
});

describe("inputToKeyParams", () => {
	test("converts key down", () => {
		const input: InputMessage = {
			type: "input",
			device: "key",
			action: "down",
			key: "a",
			code: "KeyA",
		};

		const params = inputToKeyParams(input);
		expect(params).not.toBeNull();
		expect(params?.type).toBe("keyDown");
		expect(params?.key).toBe("a");
		expect(params?.code).toBe("KeyA");
	});

	test("converts key up", () => {
		const input: InputMessage = {
			type: "input",
			device: "key",
			action: "up",
			key: "Enter",
			code: "Enter",
		};

		const params = inputToKeyParams(input);
		expect(params?.type).toBe("keyUp");
		expect(params?.windowsVirtualKeyCode).toBe(13);
	});

	test("includes text for character input", () => {
		const input: InputMessage = {
			type: "input",
			device: "key",
			action: "press",
			key: "a",
			text: "a",
		};

		const params = inputToKeyParams(input);
		expect(params?.text).toBe("a");
	});

	test("includes modifiers", () => {
		const input: InputMessage = {
			type: "input",
			device: "key",
			action: "down",
			key: "a",
			modifiers: { ctrl: true },
		};

		const params = inputToKeyParams(input);
		expect(params?.modifiers).toBe(ModifierFlags.CTRL);
	});

	test("returns null for mouse input", () => {
		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "move",
			x: 100,
			y: 200,
		};

		expect(inputToKeyParams(input)).toBeNull();
	});
});

describe("InputMapper class", () => {
	test("creates with viewport", () => {
		const mapper = new InputMapper({ w: 1280, h: 720, dpr: 1 });
		const viewport = mapper.getViewport();
		expect(viewport.w).toBe(1280);
		expect(viewport.h).toBe(720);
	});

	test("updates viewport", () => {
		const mapper = new InputMapper({ w: 1280, h: 720, dpr: 1 });
		mapper.setViewport({ w: 1920, h: 1080, dpr: 2 });

		const viewport = mapper.getViewport();
		expect(viewport.w).toBe(1920);
		expect(viewport.h).toBe(1080);
		expect(viewport.dpr).toBe(2);
	});

	test("scales point with client viewport", () => {
		const mapper = new InputMapper({ w: 1280, h: 720, dpr: 1 });
		mapper.setClientViewport(640, 360);

		const point = mapper.scalePoint(320, 180);
		expect(point.x).toBe(640);
		expect(point.y).toBe(360);
	});

	test("returns unscaled point without client viewport", () => {
		const mapper = new InputMapper({ w: 1280, h: 720, dpr: 1 });

		const point = mapper.scalePoint(320, 180);
		expect(point.x).toBe(320);
		expect(point.y).toBe(180);
	});

	test("converts mouse input", () => {
		const mapper = new InputMapper({ w: 1280, h: 720, dpr: 1 });

		const input: InputMessage = {
			type: "input",
			device: "mouse",
			action: "move",
			x: 100,
			y: 200,
		};

		const params = mapper.toMouseParams(input);
		expect(params).not.toBeNull();
		expect(params?.x).toBe(100);
		expect(params?.y).toBe(200);
	});

	test("converts key input", () => {
		const mapper = new InputMapper({ w: 1280, h: 720, dpr: 1 });

		const input: InputMessage = {
			type: "input",
			device: "key",
			action: "down",
			key: "a",
		};

		const params = mapper.toKeyParams(input);
		expect(params).not.toBeNull();
		expect(params?.key).toBe("a");
	});
});
