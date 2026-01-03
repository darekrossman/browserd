/**
 * Human behavior emulation module
 *
 * Provides realistic mouse movements, typing patterns, and scroll behavior
 * to avoid bot detection based on behavioral analysis.
 *
 * Specifically designed to bypass DataDome and PerimeterX which use
 * sophisticated behavioral analysis.
 *
 * Includes session-level mouse tracking for continuous movement patterns
 * that persist across operations.
 */

import type { HumanBehaviorConfig, MouseState } from "./types";

/**
 * Default human behavior settings
 */
export const DEFAULT_HUMAN_BEHAVIOR: Required<HumanBehaviorConfig> = {
	mouseMovement: true,
	typingPatterns: true,
	scrollBehavior: true,
	idleMouseSimulation: true,
	typoRate: 0.02,
	minTypingDelay: 50,
	maxTypingDelay: 150,
};

/**
 * Per-session mouse state tracking
 */
const sessionMouseState = new Map<string, MouseState>();

/**
 * Active idle simulation intervals per session
 */
const idleIntervals = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Sleep for a random amount of time within a range
 */
export function randomSleep(min: number, max: number): Promise<void> {
	const delay = Math.floor(Math.random() * (max - min + 1)) + min;
	return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Generate a random number between min and max
 */
export function randomBetween(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get or initialize mouse state for a session
 */
export function getMouseState(
	sessionId: string,
	viewport?: { width: number; height: number },
): MouseState {
	let state = sessionMouseState.get(sessionId);
	if (!state) {
		// Initialize at viewport center
		const vp = viewport ?? { width: 1280, height: 720 };
		state = {
			x: vp.width / 2,
			y: vp.height / 2,
			lastMoveTime: Date.now(),
			movementHistory: [],
		};
		sessionMouseState.set(sessionId, state);
	}
	return state;
}

/**
 * Update mouse state after a movement
 */
export function updateMouseState(
	sessionId: string,
	x: number,
	y: number,
): void {
	const state = getMouseState(sessionId);
	const now = Date.now();

	// Add to movement history (keep last 50 movements)
	state.movementHistory.push({ x, y, timestamp: now });
	if (state.movementHistory.length > 50) {
		state.movementHistory.shift();
	}

	state.x = x;
	state.y = y;
	state.lastMoveTime = now;
}

/**
 * Stop idle mouse simulation for a session
 */
export function stopIdleMouseSimulation(sessionId: string): void {
	const interval = idleIntervals.get(sessionId);
	if (interval) {
		clearTimeout(interval);
		idleIntervals.delete(sessionId);
	}
}

/**
 * Clean up all mouse state for a session
 */
export function cleanupMouseState(sessionId: string): void {
	stopIdleMouseSimulation(sessionId);
	sessionMouseState.delete(sessionId);
}

/**
 * Adjacent keys on a QWERTY keyboard for typo simulation
 */
const ADJACENT_KEYS: Record<string, string[]> = {
	a: ["q", "w", "s", "z"],
	b: ["v", "g", "h", "n"],
	c: ["x", "d", "f", "v"],
	d: ["s", "e", "r", "f", "c", "x"],
	e: ["w", "r", "d", "s"],
	f: ["d", "r", "t", "g", "v", "c"],
	g: ["f", "t", "y", "h", "b", "v"],
	h: ["g", "y", "u", "j", "n", "b"],
	i: ["u", "o", "k", "j"],
	j: ["h", "u", "i", "k", "m", "n"],
	k: ["j", "i", "o", "l", "m"],
	l: ["k", "o", "p"],
	m: ["n", "j", "k"],
	n: ["b", "h", "j", "m"],
	o: ["i", "p", "l", "k"],
	p: ["o", "l"],
	q: ["w", "a"],
	r: ["e", "t", "f", "d"],
	s: ["a", "w", "e", "d", "x", "z"],
	t: ["r", "y", "g", "f"],
	u: ["y", "i", "j", "h"],
	v: ["c", "f", "g", "b"],
	w: ["q", "e", "s", "a"],
	x: ["z", "s", "d", "c"],
	y: ["t", "u", "h", "g"],
	z: ["a", "s", "x"],
	"1": ["2", "q"],
	"2": ["1", "3", "q", "w"],
	"3": ["2", "4", "w", "e"],
	"4": ["3", "5", "e", "r"],
	"5": ["4", "6", "r", "t"],
	"6": ["5", "7", "t", "y"],
	"7": ["6", "8", "y", "u"],
	"8": ["7", "9", "u", "i"],
	"9": ["8", "0", "i", "o"],
	"0": ["9", "o", "p"],
};

/**
 * Get an adjacent key for typo simulation
 */
export function getAdjacentKey(char: string): string {
	const lower = char.toLowerCase();
	const adjacent = ADJACENT_KEYS[lower];
	if (!adjacent || adjacent.length === 0) {
		return char;
	}
	const randomAdjacent = adjacent[Math.floor(Math.random() * adjacent.length)]!;
	// Preserve case
	return char === char.toUpperCase()
		? randomAdjacent.toUpperCase()
		: randomAdjacent;
}

/**
 * Generate bezier curve control points for natural mouse movement
 * Uses cubic bezier with random control point deviation
 */
function generateBezierPoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
	steps: number,
): Array<{ x: number; y: number }> {
	const points: Array<{ x: number; y: number }> = [];

	// Generate random control points for the bezier curve
	const distance = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
	const deviation = Math.min(distance * 0.3, 100); // Max 30% deviation or 100px

	const cp1 = {
		x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * deviation,
		y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * deviation,
	};

	const cp2 = {
		x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * deviation,
		y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * deviation,
	};

	// Generate points along the bezier curve
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const t2 = t * t;
		const t3 = t2 * t;
		const mt = 1 - t;
		const mt2 = mt * mt;
		const mt3 = mt2 * mt;

		const x =
			mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x;
		const y =
			mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y;

		points.push({ x: Math.round(x), y: Math.round(y) });
	}

	return points;
}

/**
 * Generate a humanized mouse path from current position to target
 *
 * Features for DataDome/PerimeterX bypass:
 * - Bezier curve movement (not linear)
 * - Variable speed (acceleration/deceleration)
 * - Micro-jitter for realism
 * - Overshoot and correction (30% of movements)
 *
 * @param sessionId - Session identifier for state tracking
 * @param targetX - Target X coordinate
 * @param targetY - Target Y coordinate
 * @param viewport - Viewport dimensions
 * @param options - Movement options
 * @returns Array of points with timing information
 */
export function generateHumanMousePath(
	sessionId: string,
	targetX: number,
	targetY: number,
	viewport: { width: number; height: number },
	options?: {
		steps?: number;
		jitter?: number;
		overshoot?: boolean;
	},
): Array<{ x: number; y: number; delay: number }> {
	const { steps = 25, jitter = 2, overshoot = true } = options ?? {};

	const state = getMouseState(sessionId, viewport);
	const start = { x: state.x, y: state.y };
	const end = { x: targetX, y: targetY };

	// Generate bezier path
	const bezierPath = generateBezierPoints(start, end, steps);
	const result: Array<{ x: number; y: number; delay: number }> = [];

	// Add points with jitter and timing
	for (const point of bezierPath) {
		const jitteredX = point.x + (Math.random() - 0.5) * jitter;
		const jitteredY = point.y + (Math.random() - 0.5) * jitter;

		// Variable delay (5-25ms with acceleration curve)
		const delay = randomBetween(5, 25);

		result.push({
			x: Math.round(jitteredX),
			y: Math.round(jitteredY),
			delay,
		});
	}

	// Optional overshoot and correction (30% chance) for realism
	if (overshoot && Math.random() > 0.7) {
		const overX = targetX + (Math.random() - 0.5) * 10;
		const overY = targetY + (Math.random() - 0.5) * 10;
		result.push({ x: Math.round(overX), y: Math.round(overY), delay: 50 });
		result.push({
			x: Math.round(targetX),
			y: Math.round(targetY),
			delay: randomBetween(50, 150),
		});
	}

	// Update final position in state
	const lastPoint = result[result.length - 1];
	if (lastPoint) {
		updateMouseState(sessionId, lastPoint.x, lastPoint.y);
	}

	return result;
}

/**
 * Generate hover micro-movements for DataDome/PerimeterX bypass
 * These subtle movements happen while hovering before a click
 */
export function generateHoverMicroMovements(
	x: number,
	y: number,
	duration: number,
): Array<{ x: number; y: number; delay: number }> {
	const movements: Array<{ x: number; y: number; delay: number }> = [];
	const numMovements = Math.floor(duration / 100); // One movement per 100ms approx

	for (let i = 0; i < numMovements; i++) {
		// Small 1-3px movements
		const jitterX = x + (Math.random() - 0.5) * 6;
		const jitterY = y + (Math.random() - 0.5) * 6;
		movements.push({
			x: Math.round(jitterX),
			y: Math.round(jitterY),
			delay: randomBetween(80, 150),
		});
	}

	return movements;
}

/**
 * Generate humanized typing sequence
 *
 * Features for DataDome/PerimeterX bypass:
 * - Variable inter-keystroke delay
 * - Longer delays at word boundaries
 * - Occasional typos with correction
 * - "Thinking" pauses
 *
 * @param text - Text to type
 * @param config - Human behavior config
 * @returns Array of keystroke events with timing
 */
export function generateHumanTypingSequence(
	text: string,
	config?: HumanBehaviorConfig,
): Array<{ key: string; delay: number; isBackspace?: boolean }> {
	const {
		typoRate = DEFAULT_HUMAN_BEHAVIOR.typoRate,
		minTypingDelay = DEFAULT_HUMAN_BEHAVIOR.minTypingDelay,
		maxTypingDelay = DEFAULT_HUMAN_BEHAVIOR.maxTypingDelay,
	} = config ?? {};

	const sequence: Array<{
		key: string;
		delay: number;
		isBackspace?: boolean;
	}> = [];

	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;

		// Simulate occasional typos (2% default)
		if (Math.random() < typoRate && char.match(/[a-zA-Z0-9]/)) {
			const wrongChar = getAdjacentKey(char);
			// Type wrong key
			sequence.push({
				key: wrongChar,
				delay: randomBetween(minTypingDelay, maxTypingDelay),
			});
			// Pause before noticing
			sequence.push({
				key: "Backspace",
				delay: randomBetween(100, 300),
				isBackspace: true,
			});
		}

		// Calculate delay for this keystroke
		let delay = randomBetween(minTypingDelay, maxTypingDelay);

		// Longer pause after spaces (word boundaries)
		if (char === " ") {
			delay = randomBetween(maxTypingDelay, maxTypingDelay * 2);
		}

		// Occasional longer pause (thinking) - 5% chance
		if (Math.random() < 0.05) {
			delay = randomBetween(300, 600);
		}

		sequence.push({ key: char, delay });
	}

	return sequence;
}

/**
 * Generate humanized scroll sequence
 *
 * Features for DataDome/PerimeterX bypass:
 * - Chunked scrolling (not one smooth scroll)
 * - Variable scroll speed
 * - Reading pauses at content
 *
 * @param direction - Scroll direction
 * @param distance - Total scroll distance
 * @returns Array of scroll events with timing
 */
export function generateHumanScrollSequence(
	direction: "up" | "down",
	distance: number,
): Array<{ deltaY: number; delay: number }> {
	const sequence: Array<{ deltaY: number; delay: number }> = [];
	const scrollDirection = direction === "down" ? 1 : -1;

	let remaining = Math.abs(distance);
	while (remaining > 0) {
		// Scroll 80-120px per "wheel" event
		const scrollAmount = Math.min(randomBetween(80, 120), remaining);
		remaining -= scrollAmount;

		// Variable pause (reading vs normal scroll)
		const pauseTime =
			Math.random() > 0.8
				? randomBetween(500, 1500) // 20% reading pause
				: randomBetween(30, 100); // 80% normal scroll

		sequence.push({
			deltaY: scrollAmount * scrollDirection,
			delay: pauseTime,
		});
	}

	return sequence;
}

/**
 * Generate idle mouse drift for session maintenance
 * Small subtle movements that happen during idle periods
 */
export function generateIdleMouseDrift(
	currentX: number,
	currentY: number,
	viewport: { width: number; height: number },
): { x: number; y: number } {
	// Small random drift (5-20px)
	const driftX = (Math.random() - 0.5) * randomBetween(10, 40);
	const driftY = (Math.random() - 0.5) * randomBetween(10, 40);

	// Keep within viewport bounds
	const newX = Math.max(10, Math.min(viewport.width - 10, currentX + driftX));
	const newY = Math.max(10, Math.min(viewport.height - 10, currentY + driftY));

	return { x: Math.round(newX), y: Math.round(newY) };
}

/**
 * Calculate random point within an element for realistic clicking
 * Humans don't always click dead center
 */
export function getRandomClickPoint(box: {
	x: number;
	y: number;
	width: number;
	height: number;
}): { x: number; y: number } {
	// Click within 30-70% of element bounds (not edges, not always center)
	const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
	const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
	return { x: Math.round(targetX), y: Math.round(targetY) };
}

/**
 * Add random delays between actions to appear more human
 */
export async function humanDelay(
	type: "short" | "medium" | "long" = "short",
): Promise<void> {
	const ranges = {
		short: [100, 300],
		medium: [300, 800],
		long: [800, 2000],
	} as const;
	const [min, max] = ranges[type];
	await randomSleep(min, max);
}
