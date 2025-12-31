/**
 * Mock Sandbox Provider for Testing
 *
 * Provides a mock implementation of SandboxProvider that creates
 * local mock servers instead of real sandboxes.
 */

import type { CommandMessage } from "../../protocol/types";
import type { SandboxProvider } from "../providers/types";
import type { CreateSandboxOptions, SandboxInfo } from "../types";
import { MockServer } from "./mock-server";

interface MockSandboxEntry {
	info: SandboxInfo;
	server: MockServer;
}

/**
 * Mock provider that creates local mock WebSocket servers
 */
export class MockSandboxProvider implements SandboxProvider {
	readonly name = "mock";

	private sandboxes = new Map<string, MockSandboxEntry>();
	private idCounter = 0;
	private shouldFail = false;
	private readyDelay = 0;

	/**
	 * Configure the mock to fail on next create
	 */
	setFailOnCreate(fail: boolean): void {
		this.shouldFail = fail;
	}

	/**
	 * Set a delay before sandbox becomes ready
	 */
	setReadyDelay(ms: number): void {
		this.readyDelay = ms;
	}

	async create(_options?: CreateSandboxOptions): Promise<SandboxInfo> {
		if (this.shouldFail) {
			this.shouldFail = false;
			throw new Error("Mock sandbox creation failed");
		}

		// Create a mock WebSocket server
		const server = new MockServer();
		await server.start();

		// Set up default command handler
		server.onMessage((msg, respond) => {
			if (msg.type !== "cmd") return;
			const cmd = msg as CommandMessage;

			// Default: respond with success
			respond({
				id: cmd.id,
				type: "result",
				ok: true,
				result:
					cmd.method === "navigate" ? { url: cmd.params?.url } : undefined,
			});
		});

		const id = `mock_sandbox_${++this.idCounter}`;
		const domain = `http://localhost:${server.port}`;
		const wsUrl = `ws://localhost:${server.port}/ws`;

		const info: SandboxInfo = {
			id,
			domain,
			wsUrl,
			status: this.readyDelay > 0 ? "creating" : "ready",
			createdAt: Date.now(),
		};

		this.sandboxes.set(id, { info, server });

		// Simulate ready delay
		if (this.readyDelay > 0) {
			setTimeout(() => {
				const entry = this.sandboxes.get(id);
				if (entry) {
					entry.info.status = "ready";
				}
			}, this.readyDelay);
		}

		return { ...info };
	}

	async destroy(sandboxId: string): Promise<void> {
		const entry = this.sandboxes.get(sandboxId);
		if (entry) {
			await entry.server.stop();
			entry.info.status = "destroyed";
			this.sandboxes.delete(sandboxId);
		}
	}

	async isReady(sandboxId: string): Promise<boolean> {
		const entry = this.sandboxes.get(sandboxId);
		return entry ? entry.info.status === "ready" : false;
	}

	async get(sandboxId: string): Promise<SandboxInfo | undefined> {
		const entry = this.sandboxes.get(sandboxId);
		return entry ? { ...entry.info } : undefined;
	}

	/**
	 * Get the mock server for a sandbox (for test assertions)
	 */
	getServer(sandboxId: string): MockServer | undefined {
		return this.sandboxes.get(sandboxId)?.server;
	}

	/**
	 * Get all sandbox IDs
	 */
	getAllIds(): string[] {
		return Array.from(this.sandboxes.keys());
	}

	/**
	 * Clean up all sandboxes
	 */
	async cleanup(): Promise<void> {
		for (const id of this.sandboxes.keys()) {
			await this.destroy(id);
		}
	}
}
