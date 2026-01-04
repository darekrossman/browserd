/**
 * WebSocket Protocol Types for Browserd
 *
 * Defines all message types for client-server communication
 */

// Re-export stealth configuration types for API consumers
export type {
	BrowserProfile,
	FingerprintConfig,
	HumanBehaviorConfig,
	ProfileName,
	StealthConfig,
	TimingConfig,
	TimingOperation,
} from "../stealth";

// ============================================================================
// Playwright Methods
// ============================================================================

export type PlaywrightMethod =
	| "navigate"
	| "click"
	| "dblclick"
	| "hover"
	| "type"
	| "press"
	| "fill"
	| "waitForSelector"
	| "setViewport"
	| "evaluate"
	| "screenshot"
	| "goBack"
	| "goForward"
	| "reload";

// ============================================================================
// Client → Server Messages
// ============================================================================

/**
 * Command message for executing Playwright methods
 */
export interface CommandMessage {
	id: string;
	type: "cmd";
	method: PlaywrightMethod;
	params?: Record<string, unknown>;
}

/**
 * Mouse device actions
 */
export type MouseAction =
	| "move"
	| "down"
	| "up"
	| "click"
	| "dblclick"
	| "wheel";

/**
 * Mouse button types
 */
export type MouseButton = "left" | "middle" | "right";

/**
 * Keyboard device actions
 */
export type KeyAction = "down" | "up" | "press";

/**
 * Input message for mouse/keyboard events
 */
export interface InputMessage {
	type: "input";
	device: "mouse" | "key";
	action: MouseAction | KeyAction;
	// Mouse-specific
	x?: number;
	y?: number;
	button?: MouseButton;
	deltaX?: number;
	deltaY?: number;
	clickCount?: number;
	// Keyboard-specific
	key?: string;
	code?: string;
	text?: string;
	// Modifiers (both)
	modifiers?: {
		ctrl?: boolean;
		shift?: boolean;
		alt?: boolean;
		meta?: boolean;
	};
}

/**
 * Ping message for latency measurement
 */
export interface PingMessage {
	type: "ping";
	t: number;
}

/**
 * Union of all client-to-server message types
 */
export type ClientMessage = CommandMessage | InputMessage | PingMessage;

// ============================================================================
// Server → Client Messages
// ============================================================================

/**
 * Viewport dimensions
 */
export interface Viewport {
	w: number;
	h: number;
	dpr: number;
}

/**
 * Frame message containing screencast data
 */
export interface FrameMessage {
	type: "frame";
	format: "jpeg";
	data: string; // base64 encoded
	viewport: Viewport;
	timestamp: number;
}

/**
 * Result message for command responses
 */
export interface ResultMessage {
	id: string;
	type: "result";
	ok: boolean;
	result?: unknown;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
}

/**
 * Event names emitted by the server
 */
export type EventName = "ready" | "navigated" | "console" | "error";

/**
 * Event message for browser/session events
 */
export interface EventMessage {
	type: "event";
	name: EventName;
	data?: unknown;
}

/**
 * Pong response to ping
 */
export interface PongMessage {
	type: "pong";
	t: number;
}

// ============================================================================
// Intervention Messages (Human-in-the-Loop)
// ============================================================================

/**
 * Intervention created message - sent when SDK requests human intervention
 * The SDK should block until receiving InterventionCompletedMessage
 */
export interface InterventionCreatedMessage {
	type: "intervention_created";
	/** Command ID that requested the intervention */
	id: string;
	/** Unique intervention identifier */
	interventionId: string;
	/** Viewer URL with intervention parameter for human to access */
	viewerUrl: string;
}

/**
 * Intervention completed message - sent when human completes intervention
 * The SDK should unblock and continue after receiving this
 */
export interface InterventionCompletedMessage {
	type: "intervention_completed";
	/** Command ID that requested the intervention */
	id: string;
	/** Intervention identifier */
	interventionId: string;
	/** Timestamp when intervention was resolved */
	resolvedAt: string;
}

/**
 * Union of all server-to-client message types
 */
export type ServerMessage =
	| FrameMessage
	| ResultMessage
	| EventMessage
	| PongMessage
	| InterventionCreatedMessage
	| InterventionCompletedMessage;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid client message
 */
export function isClientMessage(value: unknown): value is ClientMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	if (msg.type === "cmd") return isCommandMessage(value);
	if (msg.type === "input") return isInputMessage(value);
	if (msg.type === "ping") return isPingMessage(value);

	return false;
}

/**
 * Check if a value is a CommandMessage
 */
export function isCommandMessage(value: unknown): value is CommandMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	// Accept any method string - let the executor handle unknown methods
	// This allows returning UNKNOWN_METHOD errors instead of silent rejection
	return (
		msg.type === "cmd" &&
		typeof msg.id === "string" &&
		typeof msg.method === "string"
	);
}

/**
 * Check if a string is a valid PlaywrightMethod
 */
export function isPlaywrightMethod(value: unknown): value is PlaywrightMethod {
	const methods: PlaywrightMethod[] = [
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
	return (
		typeof value === "string" && methods.includes(value as PlaywrightMethod)
	);
}

/**
 * Check if a value is an InputMessage
 */
export function isInputMessage(value: unknown): value is InputMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	if (msg.type !== "input") return false;
	if (msg.device !== "mouse" && msg.device !== "key") return false;
	if (typeof msg.action !== "string") return false;

	// Validate mouse-specific fields
	if (msg.device === "mouse") {
		const mouseActions: MouseAction[] = [
			"move",
			"down",
			"up",
			"click",
			"dblclick",
			"wheel",
		];
		if (!mouseActions.includes(msg.action as MouseAction)) return false;
		// x and y should be numbers if present
		if (msg.x !== undefined && typeof msg.x !== "number") return false;
		if (msg.y !== undefined && typeof msg.y !== "number") return false;
	}

	// Validate keyboard-specific fields
	if (msg.device === "key") {
		const keyActions: KeyAction[] = ["down", "up", "press"];
		if (!keyActions.includes(msg.action as KeyAction)) return false;
	}

	return true;
}

/**
 * Check if a value is a PingMessage
 */
export function isPingMessage(value: unknown): value is PingMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	return msg.type === "ping" && typeof msg.t === "number";
}

/**
 * Check if a value is a valid server message
 */
export function isServerMessage(value: unknown): value is ServerMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	if (msg.type === "frame") return isFrameMessage(value);
	if (msg.type === "result") return isResultMessage(value);
	if (msg.type === "event") return isEventMessage(value);
	if (msg.type === "pong") return isPongMessage(value);
	if (msg.type === "intervention_created")
		return isInterventionCreatedMessage(value);
	if (msg.type === "intervention_completed")
		return isInterventionCompletedMessage(value);

	return false;
}

/**
 * Check if a value is a FrameMessage
 */
export function isFrameMessage(value: unknown): value is FrameMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	return (
		msg.type === "frame" &&
		msg.format === "jpeg" &&
		typeof msg.data === "string" &&
		isViewport(msg.viewport) &&
		typeof msg.timestamp === "number"
	);
}

/**
 * Check if a value is a valid Viewport
 */
export function isViewport(value: unknown): value is Viewport {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;

	return (
		typeof v.w === "number" &&
		typeof v.h === "number" &&
		typeof v.dpr === "number"
	);
}

/**
 * Check if a value is a ResultMessage
 */
export function isResultMessage(value: unknown): value is ResultMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	return (
		msg.type === "result" &&
		typeof msg.id === "string" &&
		typeof msg.ok === "boolean"
	);
}

/**
 * Check if a value is an EventMessage
 */
export function isEventMessage(value: unknown): value is EventMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	const eventNames: EventName[] = ["ready", "navigated", "console", "error"];
	return (
		msg.type === "event" &&
		typeof msg.name === "string" &&
		eventNames.includes(msg.name as EventName)
	);
}

/**
 * Check if a value is a PongMessage
 */
export function isPongMessage(value: unknown): value is PongMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	return msg.type === "pong" && typeof msg.t === "number";
}

/**
 * Check if a value is an InterventionCreatedMessage
 */
export function isInterventionCreatedMessage(
	value: unknown,
): value is InterventionCreatedMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	return (
		msg.type === "intervention_created" &&
		typeof msg.id === "string" &&
		typeof msg.interventionId === "string" &&
		typeof msg.viewerUrl === "string"
	);
}

/**
 * Check if a value is an InterventionCompletedMessage
 */
export function isInterventionCompletedMessage(
	value: unknown,
): value is InterventionCompletedMessage {
	if (typeof value !== "object" || value === null) return false;
	const msg = value as Record<string, unknown>;

	return (
		msg.type === "intervention_completed" &&
		typeof msg.id === "string" &&
		typeof msg.interventionId === "string" &&
		typeof msg.resolvedAt === "string"
	);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a JSON string into a ClientMessage
 */
export function parseClientMessage(json: string): ClientMessage | null {
	try {
		const parsed = JSON.parse(json);
		return isClientMessage(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Serialize a server message to JSON
 */
export function serializeServerMessage(message: ServerMessage): string {
	return JSON.stringify(message);
}

/**
 * Create a result message for successful command execution
 */
export function createSuccessResult(
	id: string,
	result?: unknown,
): ResultMessage {
	return {
		id,
		type: "result",
		ok: true,
		result,
	};
}

/**
 * Create a result message for failed command execution
 */
export function createErrorResult(
	id: string,
	code: string,
	message: string,
	details?: unknown,
): ResultMessage {
	return {
		id,
		type: "result",
		ok: false,
		error: { code, message, details },
	};
}

/**
 * Create an event message
 */
export function createEventMessage(
	name: EventName,
	data?: unknown,
): EventMessage {
	return {
		type: "event",
		name,
		data,
	};
}

/**
 * Create a frame message
 */
export function createFrameMessage(
	data: string,
	viewport: Viewport,
	timestamp: number,
): FrameMessage {
	return {
		type: "frame",
		format: "jpeg",
		data,
		viewport,
		timestamp,
	};
}

/**
 * Create a pong message
 */
export function createPongMessage(t: number): PongMessage {
	return {
		type: "pong",
		t,
	};
}

/**
 * Create an intervention created message
 */
export function createInterventionCreatedMessage(
	id: string,
	interventionId: string,
	viewerUrl: string,
): InterventionCreatedMessage {
	return {
		type: "intervention_created",
		id,
		interventionId,
		viewerUrl,
	};
}

/**
 * Create an intervention completed message
 */
export function createInterventionCompletedMessage(
	id: string,
	interventionId: string,
	resolvedAt: string,
): InterventionCompletedMessage {
	return {
		type: "intervention_completed",
		id,
		interventionId,
		resolvedAt,
	};
}
