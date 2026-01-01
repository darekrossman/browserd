/**
 * SSE Connection Manager Tests
 */

import { describe, expect, test } from "bun:test";
import { SSEConnectionManager } from "./sse-connection";

describe("SSEConnectionManager", () => {
	describe("URL derivation", () => {
		test("derives URLs from base URL", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000",
			});
			// Access private properties via type assertion for testing
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/stream");
			expect(inputUrl).toBe("http://localhost:3000/input");
		});

		test("derives URLs from stream URL", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000/stream",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/stream");
			expect(inputUrl).toBe("http://localhost:3000/input");
		});

		test("derives URLs from ws URL", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000/ws",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/stream");
			expect(inputUrl).toBe("http://localhost:3000/input");
		});

		test("converts ws:// to http://", () => {
			const manager = new SSEConnectionManager({
				url: "ws://localhost:3000/ws",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/stream");
			expect(inputUrl).toBe("http://localhost:3000/input");
		});

		test("converts wss:// to https://", () => {
			const manager = new SSEConnectionManager({
				url: "wss://secure.example.com/ws",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("https://secure.example.com/stream");
			expect(inputUrl).toBe("https://secure.example.com/input");
		});

		test("derives session-specific URLs from session stream URL", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000/sessions/sess-abc123/stream",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/sessions/sess-abc123/stream");
			expect(inputUrl).toBe("http://localhost:3000/sessions/sess-abc123/input");
		});

		test("derives session-specific URLs from session ws URL", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000/sessions/sess-abc123/ws",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/sessions/sess-abc123/stream");
			expect(inputUrl).toBe("http://localhost:3000/sessions/sess-abc123/input");
		});

		test("handles default session ID", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000/sessions/default/stream",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("http://localhost:3000/sessions/default/stream");
			expect(inputUrl).toBe("http://localhost:3000/sessions/default/input");
		});

		test("handles HTTPS with session URLs", () => {
			const manager = new SSEConnectionManager({
				url: "https://sandbox.example.com/sessions/sess-xyz/stream",
			});
			const streamUrl = (manager as unknown as { streamUrl: string }).streamUrl;
			const inputUrl = (manager as unknown as { inputUrl: string }).inputUrl;

			expect(streamUrl).toBe("https://sandbox.example.com/sessions/sess-xyz/stream");
			expect(inputUrl).toBe("https://sandbox.example.com/sessions/sess-xyz/input");
		});
	});

	describe("state", () => {
		test("starts in disconnected state", () => {
			const manager = new SSEConnectionManager({
				url: "http://localhost:3000",
			});
			expect(manager.getState()).toBe("disconnected");
			expect(manager.isConnected()).toBe(false);
		});
	});
});
