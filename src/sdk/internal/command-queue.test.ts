/**
 * CommandQueue Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ResultMessage } from "../../protocol/types";
import { BrowserdError } from "../errors";
import { CommandQueue } from "./command-queue";

describe("CommandQueue", () => {
	let queue: CommandQueue;

	beforeEach(() => {
		queue = new CommandQueue({ defaultTimeout: 1000 });
	});

	afterEach(() => {
		queue.clear();
	});

	describe("create", () => {
		it("should generate unique command IDs", () => {
			const { id: id1 } = queue.create("navigate");
			const { id: id2 } = queue.create("click");

			expect(id1).not.toBe(id2);
			expect(id1).toMatch(/^cmd_\d+_\d+$/);
			expect(id2).toMatch(/^cmd_\d+_\d+$/);
		});

		it("should track pending commands", () => {
			const { id } = queue.create("navigate");

			expect(queue.size).toBe(1);
			expect(queue.isPending(id)).toBe(true);
		});

		it("should return pending IDs", () => {
			const { id: id1 } = queue.create("navigate");
			const { id: id2 } = queue.create("click");

			const pendingIds = queue.getPendingIds();
			expect(pendingIds).toContain(id1);
			expect(pendingIds).toContain(id2);
		});
	});

	describe("handleResult", () => {
		it("should resolve successful result", async () => {
			const { id, promise } = queue.create<{ url: string }>("navigate");

			const result: ResultMessage = {
				id,
				type: "result",
				ok: true,
				result: { url: "https://example.com" },
			};

			const handled = queue.handleResult(result);
			expect(handled).toBe(true);

			const value = await promise;
			expect(value).toEqual({ url: "https://example.com" });
			expect(queue.size).toBe(0);
		});

		it("should reject failed result", async () => {
			const { id, promise } = queue.create("click");

			const result: ResultMessage = {
				id,
				type: "result",
				ok: false,
				error: {
					code: "SELECTOR_NOT_FOUND",
					message: "Element not found: button",
				},
			};

			queue.handleResult(result);

			try {
				await promise;
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
				if (BrowserdError.isBrowserdError(err)) {
					expect(err.code).toBe("SELECTOR_NOT_FOUND");
				}
			}
		});

		it("should return false for unknown command ID", () => {
			const result: ResultMessage = {
				id: "unknown-id",
				type: "result",
				ok: true,
			};

			const handled = queue.handleResult(result);
			expect(handled).toBe(false);
		});
	});

	describe("timeout", () => {
		it("should reject command on timeout", async () => {
			const { promise } = queue.create("navigate", 50);

			try {
				await promise;
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
				if (BrowserdError.isBrowserdError(err)) {
					expect(err.code).toBe("COMMAND_TIMEOUT");
				}
			}
		});

		it("should use custom timeout when provided", async () => {
			const start = Date.now();
			const { promise } = queue.create("navigate", 100);

			try {
				await promise;
			} catch {
				// Expected
			}

			const elapsed = Date.now() - start;
			expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
			expect(elapsed).toBeLessThan(200);
		});
	});

	describe("cancel", () => {
		it("should cancel a specific command", async () => {
			const { id, promise } = queue.create("navigate");

			const cancelled = queue.cancel(id);
			expect(cancelled).toBe(true);
			expect(queue.size).toBe(0);

			try {
				await promise;
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
			}
		});

		it("should return false for unknown command", () => {
			const cancelled = queue.cancel("unknown-id");
			expect(cancelled).toBe(false);
		});
	});

	describe("cancelAll", () => {
		it("should cancel all pending commands", async () => {
			const { promise: p1 } = queue.create("navigate");
			const { promise: p2 } = queue.create("click");

			const error = new BrowserdError("CONNECTION_CLOSED", "Disconnected");
			queue.cancelAll(error);

			expect(queue.size).toBe(0);

			for (const promise of [p1, p2]) {
				try {
					await promise;
					expect.unreachable("Should have thrown");
				} catch (err) {
					expect(err).toBe(error);
				}
			}
		});
	});

	describe("clear", () => {
		it("should clear all commands without rejecting", () => {
			queue.create("navigate");
			queue.create("click");

			expect(queue.size).toBe(2);

			queue.clear();

			expect(queue.size).toBe(0);
		});
	});
});
