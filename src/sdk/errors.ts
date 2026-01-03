/**
 * Browserd SDK Error Types
 *
 * Custom error classes for SDK operations
 */

/**
 * Error codes for Browserd SDK
 */
export type BrowserdErrorCode =
	// Connection errors
	| "CONNECTION_FAILED"
	| "CONNECTION_TIMEOUT"
	| "CONNECTION_CLOSED"
	| "NOT_CONNECTED"
	| "RECONNECT_FAILED"
	// Command errors
	| "COMMAND_TIMEOUT"
	| "COMMAND_FAILED"
	| "SELECTOR_NOT_FOUND"
	| "NAVIGATION_ERROR"
	| "EXECUTION_ERROR"
	| "UNKNOWN_METHOD"
	| "INVALID_PARAMS"
	// Session errors
	| "SESSION_ERROR"
	| "SESSION_NOT_FOUND"
	| "SESSION_LIMIT_REACHED"
	// Sandbox errors
	| "SANDBOX_CREATION_FAILED"
	| "SANDBOX_NOT_FOUND"
	| "SANDBOX_TIMEOUT"
	| "SANDBOX_DESTROYED"
	| "PROVIDER_ERROR";

/**
 * Custom error class for Browserd SDK operations
 */
export class BrowserdError extends Error {
	/** Error code for programmatic handling */
	readonly code: BrowserdErrorCode;

	/** Additional error details */
	readonly details?: unknown;

	/** Original error if this wraps another error */
	override readonly cause?: Error;

	constructor(
		code: BrowserdErrorCode,
		message: string,
		options?: { details?: unknown; cause?: Error },
	) {
		super(message);
		this.name = "BrowserdError";
		this.code = code;
		this.details = options?.details;
		this.cause = options?.cause;

		// Maintains proper stack trace for where error was thrown
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, BrowserdError);
		}
	}

	/**
	 * Create a connection failed error
	 */
	static connectionFailed(message: string, cause?: Error): BrowserdError {
		return new BrowserdError("CONNECTION_FAILED", message, { cause });
	}

	/**
	 * Create a connection timeout error
	 */
	static connectionTimeout(timeoutMs: number): BrowserdError {
		return new BrowserdError(
			"CONNECTION_TIMEOUT",
			`Connection timeout after ${timeoutMs}ms`,
		);
	}

	/**
	 * Create a not connected error
	 */
	static notConnected(): BrowserdError {
		return new BrowserdError(
			"NOT_CONNECTED",
			"Not connected to browserd server",
		);
	}

	/**
	 * Create a command timeout error
	 */
	static commandTimeout(method: string, timeoutMs: number): BrowserdError {
		return new BrowserdError(
			"COMMAND_TIMEOUT",
			`Command '${method}' timed out after ${timeoutMs}ms`,
			{ details: { method, timeout: timeoutMs } },
		);
	}

	/**
	 * Create a command failed error from server response
	 */
	static commandFailed(
		method: string,
		serverError: { code: string; message: string; details?: unknown },
	): BrowserdError {
		// Map server error codes to SDK error codes
		const codeMap: Record<string, BrowserdErrorCode> = {
			SELECTOR_NOT_FOUND: "SELECTOR_NOT_FOUND",
			NAVIGATION_ERROR: "NAVIGATION_ERROR",
			EXECUTION_ERROR: "EXECUTION_ERROR",
			UNKNOWN_METHOD: "UNKNOWN_METHOD",
			INVALID_PARAMS: "INVALID_PARAMS",
		};

		const code = codeMap[serverError.code] || "COMMAND_FAILED";

		return new BrowserdError(code, serverError.message, {
			details: {
				method,
				serverCode: serverError.code,
				serverDetails: serverError.details,
			},
		});
	}

	/**
	 * Create a sandbox creation failed error
	 */
	static sandboxCreationFailed(message: string, cause?: Error): BrowserdError {
		return new BrowserdError("SANDBOX_CREATION_FAILED", message, { cause });
	}

	/**
	 * Create a sandbox not found error
	 */
	static sandboxNotFound(sandboxId: string): BrowserdError {
		return new BrowserdError(
			"SANDBOX_NOT_FOUND",
			`Sandbox '${sandboxId}' not found`,
			{ details: { sandboxId } },
		);
	}

	/**
	 * Create a sandbox timeout error
	 */
	static sandboxTimeout(sandboxId: string, timeoutMs: number): BrowserdError {
		return new BrowserdError(
			"SANDBOX_TIMEOUT",
			`Sandbox '${sandboxId}' did not become ready within ${timeoutMs}ms`,
			{ details: { sandboxId, timeout: timeoutMs } },
		);
	}

	/**
	 * Create a provider error
	 */
	static providerError(message: string, cause?: Error): BrowserdError {
		return new BrowserdError("PROVIDER_ERROR", message, { cause });
	}

	/**
	 * Check if an error is a BrowserdError
	 */
	static isBrowserdError(error: unknown): error is BrowserdError {
		return error instanceof BrowserdError;
	}

	/**
	 * Check if error has a specific code
	 */
	hasCode(code: BrowserdErrorCode): boolean {
		return this.code === code;
	}

	/**
	 * Convert to JSON for logging/serialization
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			details: this.details,
			stack: this.stack,
		};
	}
}
