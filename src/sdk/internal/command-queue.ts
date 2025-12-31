/**
 * Command Queue
 *
 * Manages pending commands and correlates responses by ID
 */

import type { PlaywrightMethod, ResultMessage } from "../../protocol/types";
import { BrowserdError } from "../errors";

export interface PendingCommand {
	id: string;
	method: string;
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	createdAt: number;
}

export interface CommandQueueOptions {
	/** Default timeout for commands in milliseconds */
	defaultTimeout?: number;
}

/**
 * Manages command execution and response correlation
 */
export class CommandQueue {
	private pending = new Map<string, PendingCommand>();
	private idCounter = 0;
	private defaultTimeout: number;

	constructor(options: CommandQueueOptions = {}) {
		this.defaultTimeout = options.defaultTimeout ?? 30000;
	}

	/**
	 * Generate a unique command ID
	 */
	private generateId(): string {
		this.idCounter++;
		return `cmd_${Date.now()}_${this.idCounter}`;
	}

	/**
	 * Create a command and return its ID and a promise for the result
	 */
	create<T = unknown>(
		method: PlaywrightMethod | string,
		timeout?: number,
	): { id: string; promise: Promise<T> } {
		const id = this.generateId();
		const effectiveTimeout = timeout ?? this.defaultTimeout;

		const promise = new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(BrowserdError.commandTimeout(method, effectiveTimeout));
			}, effectiveTimeout);

			const command: PendingCommand = {
				id,
				method,
				resolve: resolve as (result: unknown) => void,
				reject,
				timer,
				createdAt: Date.now(),
			};

			this.pending.set(id, command);
		});

		return { id, promise };
	}

	/**
	 * Handle a result message from the server
	 */
	handleResult(result: ResultMessage): boolean {
		const command = this.pending.get(result.id);
		if (!command) {
			// Command not found - might have timed out or been cancelled
			return false;
		}

		// Clear timeout and remove from pending
		clearTimeout(command.timer);
		this.pending.delete(result.id);

		if (result.ok) {
			command.resolve(result.result);
		} else if (result.error) {
			command.reject(BrowserdError.commandFailed(command.method, result.error));
		} else {
			command.reject(
				new BrowserdError(
					"COMMAND_FAILED",
					"Command failed without error details",
				),
			);
		}

		return true;
	}

	/**
	 * Cancel all pending commands with an error
	 */
	cancelAll(error: Error): void {
		for (const command of this.pending.values()) {
			clearTimeout(command.timer);
			command.reject(error);
		}
		this.pending.clear();
	}

	/**
	 * Cancel a specific command
	 */
	cancel(id: string, error?: Error): boolean {
		const command = this.pending.get(id);
		if (!command) {
			return false;
		}

		clearTimeout(command.timer);
		this.pending.delete(id);
		command.reject(
			error ?? new BrowserdError("COMMAND_FAILED", "Command cancelled"),
		);
		return true;
	}

	/**
	 * Get number of pending commands
	 */
	get size(): number {
		return this.pending.size;
	}

	/**
	 * Check if a command is pending
	 */
	isPending(id: string): boolean {
		return this.pending.has(id);
	}

	/**
	 * Get all pending command IDs
	 */
	getPendingIds(): string[] {
		return Array.from(this.pending.keys());
	}

	/**
	 * Clear all pending commands (for cleanup)
	 */
	clear(): void {
		for (const command of this.pending.values()) {
			clearTimeout(command.timer);
		}
		this.pending.clear();
	}
}
