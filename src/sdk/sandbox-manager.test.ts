/**
 * SandboxManager Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SandboxManager } from "./sandbox-manager";
import { MockSandboxProvider } from "./testing/mock-provider";

describe("SandboxManager", () => {
	let provider: MockSandboxProvider;
	let manager: SandboxManager;

	beforeEach(() => {
		provider = new MockSandboxProvider();
		manager = new SandboxManager({ provider });
	});

	afterEach(async () => {
		await manager.destroyAll();
		await provider.cleanup();
	});

	describe("providerName", () => {
		it("should return the provider name", () => {
			expect(manager.providerName).toBe("mock");
		});
	});

	describe("create", () => {
		it("should create sandbox and return session methods", async () => {
			const { sandbox, createSession, listSessions, getSession, getSessionInfo, destroySession } =
				await manager.create();

			expect(sandbox.id).toMatch(/^mock_sandbox_\d+$/);
			expect(sandbox.status).toBe("ready");
			expect(sandbox.wsUrl).toMatch(/^ws:\/\/localhost:\d+\/ws$/);

			// Verify session methods are functions
			expect(typeof createSession).toBe("function");
			expect(typeof listSessions).toBe("function");
			expect(typeof getSession).toBe("function");
			expect(typeof getSessionInfo).toBe("function");
			expect(typeof destroySession).toBe("function");
		});

		it("should track created sandbox", async () => {
			const { sandbox } = await manager.create();

			expect(manager.has(sandbox.id)).toBe(true);
			expect(manager.size).toBe(1);
		});

		it("should return sandbox info via get()", async () => {
			const { sandbox } = await manager.create();

			const info = manager.get(sandbox.id);
			expect(info).toBeDefined();
			expect(info?.id).toBe(sandbox.id);
		});

		it("should handle provider errors", async () => {
			provider.setFailOnCreate(true);

			try {
				await manager.create();
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(Error);
			}
		});

		it("should create multiple sandboxes", async () => {
			const { sandbox: s1 } = await manager.create();
			const { sandbox: s2 } = await manager.create();

			expect(s1.id).not.toBe(s2.id);
			expect(manager.size).toBe(2);
		});
	});

	describe("destroy", () => {
		it("should destroy sandbox", async () => {
			const { sandbox } = await manager.create();

			await manager.destroy(sandbox.id);

			expect(manager.has(sandbox.id)).toBe(false);
			expect(manager.size).toBe(0);
		});

		it("should handle destroying non-existent sandbox", async () => {
			// Should not throw
			await manager.destroy("non-existent");
		});
	});

	describe("destroyAll", () => {
		it("should destroy all sandboxes", async () => {
			await manager.create();
			await manager.create();
			await manager.create();

			expect(manager.size).toBe(3);

			await manager.destroyAll();

			expect(manager.size).toBe(0);
		});
	});

	describe("list", () => {
		it("should list all sandboxes", async () => {
			const { sandbox: s1 } = await manager.create();
			const { sandbox: s2 } = await manager.create();

			const list = manager.list();

			expect(list).toHaveLength(2);
			expect(list.map((s) => s.id)).toContain(s1.id);
			expect(list.map((s) => s.id)).toContain(s2.id);
		});

		it("should return empty array when no sandboxes", () => {
			expect(manager.list()).toEqual([]);
		});
	});
});
