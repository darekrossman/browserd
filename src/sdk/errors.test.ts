/**
 * BrowserdError Tests
 */

import { describe, expect, it } from "bun:test";
import { BrowserdError } from "./errors";

describe("BrowserdError", () => {
	describe("constructor", () => {
		it("should create error with code and message", () => {
			const error = new BrowserdError("CONNECTION_FAILED", "Failed to connect");

			expect(error.code).toBe("CONNECTION_FAILED");
			expect(error.message).toBe("Failed to connect");
			expect(error.name).toBe("BrowserdError");
		});

		it("should support details option", () => {
			const error = new BrowserdError("COMMAND_FAILED", "Command failed", {
				details: { method: "click", selector: "#button" },
			});

			expect(error.details).toEqual({ method: "click", selector: "#button" });
		});

		it("should support cause option", () => {
			const cause = new Error("Original error");
			const error = new BrowserdError("CONNECTION_FAILED", "Failed", { cause });

			expect(error.cause).toBe(cause);
		});
	});

	describe("static factory methods", () => {
		it("should create connectionFailed error", () => {
			const error = BrowserdError.connectionFailed("Server unreachable");

			expect(error.code).toBe("CONNECTION_FAILED");
			expect(error.message).toBe("Server unreachable");
		});

		it("should create connectionTimeout error", () => {
			const error = BrowserdError.connectionTimeout(5000);

			expect(error.code).toBe("CONNECTION_TIMEOUT");
			expect(error.message).toContain("5000");
		});

		it("should create notConnected error", () => {
			const error = BrowserdError.notConnected();

			expect(error.code).toBe("NOT_CONNECTED");
		});

		it("should create commandTimeout error", () => {
			const error = BrowserdError.commandTimeout("navigate", 30000);

			expect(error.code).toBe("COMMAND_TIMEOUT");
			expect(error.message).toContain("navigate");
			expect(error.message).toContain("30000");
		});

		it("should create commandFailed error", () => {
			const error = BrowserdError.commandFailed("click", {
				code: "SELECTOR_NOT_FOUND",
				message: "Element not found",
			});

			expect(error.code).toBe("SELECTOR_NOT_FOUND");
			expect(error.message).toBe("Element not found");
		});

		it("should map unknown server codes to COMMAND_FAILED", () => {
			const error = BrowserdError.commandFailed("test", {
				code: "UNKNOWN_SERVER_CODE",
				message: "Something happened",
			});

			expect(error.code).toBe("COMMAND_FAILED");
		});

		it("should create sandboxCreationFailed error", () => {
			const error = BrowserdError.sandboxCreationFailed("Out of resources");

			expect(error.code).toBe("SANDBOX_CREATION_FAILED");
		});

		it("should create sandboxNotFound error", () => {
			const error = BrowserdError.sandboxNotFound("sbx_123");

			expect(error.code).toBe("SANDBOX_NOT_FOUND");
			expect(error.message).toContain("sbx_123");
		});

		it("should create sandboxTimeout error", () => {
			const error = BrowserdError.sandboxTimeout("sbx_123", 60000);

			expect(error.code).toBe("SANDBOX_TIMEOUT");
		});

		it("should create providerError", () => {
			const error = BrowserdError.providerError("Provider failed");

			expect(error.code).toBe("PROVIDER_ERROR");
		});
	});

	describe("isBrowserdError", () => {
		it("should return true for BrowserdError", () => {
			const error = new BrowserdError("CONNECTION_FAILED", "Failed");

			expect(BrowserdError.isBrowserdError(error)).toBe(true);
		});

		it("should return false for regular Error", () => {
			const error = new Error("Regular error");

			expect(BrowserdError.isBrowserdError(error)).toBe(false);
		});

		it("should return false for non-error values", () => {
			expect(BrowserdError.isBrowserdError(null)).toBe(false);
			expect(BrowserdError.isBrowserdError(undefined)).toBe(false);
			expect(BrowserdError.isBrowserdError("string")).toBe(false);
			expect(BrowserdError.isBrowserdError({})).toBe(false);
		});
	});

	describe("hasCode", () => {
		it("should return true for matching code", () => {
			const error = new BrowserdError("CONNECTION_FAILED", "Failed");

			expect(error.hasCode("CONNECTION_FAILED")).toBe(true);
		});

		it("should return false for non-matching code", () => {
			const error = new BrowserdError("CONNECTION_FAILED", "Failed");

			expect(error.hasCode("COMMAND_TIMEOUT")).toBe(false);
		});
	});

	describe("toJSON", () => {
		it("should serialize error to JSON object", () => {
			const error = new BrowserdError(
				"CONNECTION_FAILED",
				"Failed to connect",
				{
					details: { url: "ws://localhost:3000" },
				},
			);

			const json = error.toJSON();

			expect(json.name).toBe("BrowserdError");
			expect(json.code).toBe("CONNECTION_FAILED");
			expect(json.message).toBe("Failed to connect");
			expect(json.details).toEqual({ url: "ws://localhost:3000" });
			expect(json.stack).toBeString();
		});
	});
});
