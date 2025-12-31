/**
 * BrowserdClient Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CommandMessage } from "../protocol/types";
import { BrowserdClient } from "./client";
import { BrowserdError } from "./errors";
import { createMockServer, type MockServer } from "./testing/mock-server";

describe("BrowserdClient", () => {
	let server: MockServer;
	let client: BrowserdClient;

	beforeEach(async () => {
		server = await createMockServer();
		client = new BrowserdClient({
			url: server.getUrl(),
			timeout: 5000,
			autoReconnect: false,
		});
	});

	afterEach(async () => {
		await client.close().catch(() => {});
		await server.stop();
	});

	describe("connection", () => {
		it("should connect to the server", async () => {
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it("should report not connected before connect()", () => {
			expect(client.isConnected()).toBe(false);
		});

		it("should disconnect properly", async () => {
			await client.connect();
			expect(client.isConnected()).toBe(true);

			await client.close();
			expect(client.isConnected()).toBe(false);
		});

		it("should throw when server is not available", async () => {
			await server.stop();

			const badClient = new BrowserdClient({
				url: "ws://localhost:59999/ws",
				timeout: 1000,
				autoReconnect: false,
			});

			try {
				await badClient.connect();
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
			}
		});

		it("should notify on connection state changes", async () => {
			const states: string[] = [];
			client.onConnectionStateChange((state) => {
				states.push(state);
			});

			await client.connect();
			await client.close();

			expect(states).toContain("connecting");
			expect(states).toContain("connected");
			expect(states).toContain("disconnected");
		});
	});

	describe("commands", () => {
		beforeEach(async () => {
			await client.connect();
		});

		it("should send navigate command and receive result", async () => {
			server.onMessage((msg, respond) => {
				if (
					msg.type === "cmd" &&
					(msg as CommandMessage).method === "navigate"
				) {
					respond({
						id: (msg as CommandMessage).id,
						type: "result",
						ok: true,
						result: { url: "https://example.com", title: "Example" },
					});
				}
			});

			const result = await client.navigate("https://example.com");
			expect(result.url).toBe("https://example.com");
			expect(result.title).toBe("Example");
		});

		it("should handle command errors", async () => {
			server.onMessage((msg, respond) => {
				if (msg.type === "cmd" && (msg as CommandMessage).method === "click") {
					respond({
						id: (msg as CommandMessage).id,
						type: "result",
						ok: false,
						error: {
							code: "SELECTOR_NOT_FOUND",
							message: "Element not found: #missing",
						},
					});
				}
			});

			try {
				await client.click("#missing");
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
				if (BrowserdError.isBrowserdError(err)) {
					expect(err.code).toBe("SELECTOR_NOT_FOUND");
				}
			}
		});

		it("should timeout if no response", async () => {
			// Don't set up a handler, so no response will come
			const shortTimeoutClient = new BrowserdClient({
				url: server.getUrl(),
				timeout: 100,
				autoReconnect: false,
			});
			await shortTimeoutClient.connect();

			try {
				await shortTimeoutClient.navigate("https://example.com");
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
				if (BrowserdError.isBrowserdError(err)) {
					expect(err.code).toBe("COMMAND_TIMEOUT");
				}
			} finally {
				await shortTimeoutClient.close();
			}
		});

		it("should throw if not connected", async () => {
			await client.close();

			try {
				await client.navigate("https://example.com");
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(BrowserdError.isBrowserdError(err)).toBe(true);
				if (BrowserdError.isBrowserdError(err)) {
					expect(err.code).toBe("NOT_CONNECTED");
				}
			}
		});
	});

	describe("navigation commands", () => {
		beforeEach(async () => {
			await client.connect();

			server.onMessage((msg, respond) => {
				if (msg.type !== "cmd") return;
				const cmd = msg as CommandMessage;

				switch (cmd.method) {
					case "navigate":
						respond({
							id: cmd.id,
							type: "result",
							ok: true,
							result: { url: cmd.params?.url },
						});
						break;
					case "goBack":
					case "goForward":
					case "reload":
						respond({
							id: cmd.id,
							type: "result",
							ok: true,
						});
						break;
				}
			});
		});

		it("should navigate to URL", async () => {
			const result = await client.navigate("https://example.com");
			expect(result.url).toBe("https://example.com");
		});

		it("should go back", async () => {
			await expect(client.goBack()).resolves.toBeUndefined();
		});

		it("should go forward", async () => {
			await expect(client.goForward()).resolves.toBeUndefined();
		});

		it("should reload", async () => {
			await expect(client.reload()).resolves.toBeUndefined();
		});
	});

	describe("interaction commands", () => {
		beforeEach(async () => {
			await client.connect();

			server.onMessage((msg, respond) => {
				if (msg.type !== "cmd") return;
				const cmd = msg as CommandMessage;

				// Simple success for all interaction commands
				respond({
					id: cmd.id,
					type: "result",
					ok: true,
				});
			});
		});

		it("should click", async () => {
			await expect(client.click("button")).resolves.toBeUndefined();
		});

		it("should double-click", async () => {
			await expect(client.dblclick("button")).resolves.toBeUndefined();
		});

		it("should hover", async () => {
			await expect(client.hover(".menu-item")).resolves.toBeUndefined();
		});

		it("should type", async () => {
			await expect(client.type("#input", "hello")).resolves.toBeUndefined();
		});

		it("should fill", async () => {
			await expect(
				client.fill("#email", "test@example.com"),
			).resolves.toBeUndefined();
		});

		it("should press key", async () => {
			await expect(client.press("Enter")).resolves.toBeUndefined();
		});
	});

	describe("ping", () => {
		beforeEach(async () => {
			await client.connect();
		});

		it("should measure latency", async () => {
			const latency = await client.ping();
			expect(latency).toBeGreaterThanOrEqual(0);
			expect(latency).toBeLessThan(1000); // Should be quick for local connection
		});
	});

	describe("screenshot", () => {
		beforeEach(async () => {
			await client.connect();

			server.onMessage((msg, respond) => {
				if (msg.type !== "cmd") return;
				const cmd = msg as CommandMessage;

				if (cmd.method === "screenshot") {
					respond({
						id: cmd.id,
						type: "result",
						ok: true,
						result: {
							data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
							format: "png",
						},
					});
				}
			});
		});

		it("should take screenshot", async () => {
			const result = await client.screenshot();
			expect(result.format).toBe("png");
			expect(result.data).toBeString();
			expect(result.data.length).toBeGreaterThan(0);
		});
	});

	describe("evaluate", () => {
		beforeEach(async () => {
			await client.connect();

			server.onMessage((msg, respond) => {
				if (msg.type !== "cmd") return;
				const cmd = msg as CommandMessage;

				if (cmd.method === "evaluate") {
					// Simulate simple evaluation - client expects { result: value }
					respond({
						id: cmd.id,
						type: "result",
						ok: true,
						result: { result: "evaluated" },
					});
				}
			});
		});

		it("should evaluate expression", async () => {
			const result = await client.evaluate("document.title");
			expect(result).toBe("evaluated");
		});
	});
});
