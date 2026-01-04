/**
 * Intervention Manager
 *
 * Manages human intervention requests for browser sessions.
 * Tracks interventions and coordinates between SDK clients and human viewers.
 */

import type { ServerWebSocket } from "bun";
import {
	createInterventionCompletedMessage,
	createInterventionCreatedMessage,
} from "../protocol/types";

/**
 * Intervention status
 */
export type InterventionStatus = "pending" | "completed" | "cancelled";

/**
 * A human intervention request
 */
export interface Intervention {
	/** Unique intervention identifier */
	id: string;
	/** Session ID this intervention belongs to */
	sessionId: string;
	/** Reason for requesting intervention (e.g., "CAPTCHA detected") */
	reason: string;
	/** Instructions for the human (e.g., "Please solve the CAPTCHA") */
	instructions: string;
	/** Current status */
	status: InterventionStatus;
	/** Creation timestamp */
	createdAt: Date;
	/** Resolution timestamp (when human completed) */
	resolvedAt?: Date;
	/** Command ID that requested the intervention (for sending response) */
	waitingCommandId: string;
	/** WebSocket that's waiting for completion */
	waitingSocket?: ServerWebSocket<unknown>;
}

/**
 * Options for creating an intervention
 */
export interface CreateInterventionOptions {
	sessionId: string;
	reason: string;
	instructions: string;
	commandId: string;
	socket?: ServerWebSocket<unknown>;
}

/**
 * Manages intervention lifecycle
 */
export class InterventionManager {
	/** All interventions by ID */
	private interventions = new Map<string, Intervention>();
	/** Active intervention per session (only one allowed at a time) */
	private sessionInterventions = new Map<string, string>();
	/** Base URL for viewer URLs */
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl;
	}

	/**
	 * Update base URL (e.g., after server starts with dynamic port)
	 */
	setBaseUrl(baseUrl: string): void {
		this.baseUrl = baseUrl;
	}

	/**
	 * Create a new intervention request
	 */
	create(options: CreateInterventionOptions): Intervention {
		const { sessionId, reason, instructions, commandId, socket } = options;

		// Check if session already has a pending intervention
		const existingId = this.sessionInterventions.get(sessionId);
		if (existingId) {
			const existing = this.interventions.get(existingId);
			if (existing && existing.status === "pending") {
				throw new Error(
					`Session ${sessionId} already has a pending intervention: ${existingId}`,
				);
			}
		}

		const intervention: Intervention = {
			id: this.generateId(),
			sessionId,
			reason,
			instructions,
			status: "pending",
			createdAt: new Date(),
			waitingCommandId: commandId,
			waitingSocket: socket,
		};

		this.interventions.set(intervention.id, intervention);
		this.sessionInterventions.set(sessionId, intervention.id);

		console.log(
			`[intervention-manager] Created intervention ${intervention.id} for session ${sessionId}`,
		);

		return intervention;
	}

	/**
	 * Get viewer URL for an intervention
	 */
	getViewerUrl(intervention: Intervention): string {
		return `${this.baseUrl}/sessions/${intervention.sessionId}/viewer?intervention=${intervention.id}`;
	}

	/**
	 * Get an intervention by ID
	 */
	get(interventionId: string): Intervention | undefined {
		return this.interventions.get(interventionId);
	}

	/**
	 * Get active intervention for a session
	 */
	getBySession(sessionId: string): Intervention | undefined {
		const interventionId = this.sessionInterventions.get(sessionId);
		if (!interventionId) return undefined;
		return this.interventions.get(interventionId);
	}

	/**
	 * Complete an intervention (called when human finishes)
	 */
	complete(interventionId: string): boolean {
		const intervention = this.interventions.get(interventionId);
		if (!intervention) {
			console.error(
				`[intervention-manager] Cannot complete: intervention ${interventionId} not found`,
			);
			return false;
		}

		if (intervention.status !== "pending") {
			console.error(
				`[intervention-manager] Cannot complete: intervention ${interventionId} is ${intervention.status}`,
			);
			return false;
		}

		intervention.status = "completed";
		intervention.resolvedAt = new Date();

		console.log(
			`[intervention-manager] Completed intervention ${interventionId}`,
		);

		// Send completion message to waiting socket
		if (intervention.waitingSocket) {
			try {
				const message = createInterventionCompletedMessage(
					intervention.waitingCommandId,
					intervention.id,
					intervention.resolvedAt.toISOString(),
				);
				intervention.waitingSocket.send(JSON.stringify(message));
			} catch (error) {
				console.error(
					`[intervention-manager] Error sending completion message:`,
					error,
				);
			}
		}

		// Cleanup
		this.cleanup(intervention);

		return true;
	}

	/**
	 * Cancel an intervention
	 */
	cancel(interventionId: string): boolean {
		const intervention = this.interventions.get(interventionId);
		if (!intervention) return false;

		if (intervention.status !== "pending") return false;

		intervention.status = "cancelled";
		console.log(
			`[intervention-manager] Cancelled intervention ${interventionId}`,
		);

		// Cleanup
		this.cleanup(intervention);

		return true;
	}

	/**
	 * Cancel all interventions for a session (e.g., when session is destroyed)
	 */
	cancelBySession(sessionId: string): void {
		const interventionId = this.sessionInterventions.get(sessionId);
		if (interventionId) {
			this.cancel(interventionId);
		}
	}

	/**
	 * Send intervention_created message to client
	 */
	sendCreatedMessage(intervention: Intervention): void {
		if (!intervention.waitingSocket) return;

		const viewerUrl = this.getViewerUrl(intervention);
		const message = createInterventionCreatedMessage(
			intervention.waitingCommandId,
			intervention.id,
			viewerUrl,
		);

		try {
			intervention.waitingSocket.send(JSON.stringify(message));
		} catch (error) {
			console.error(
				`[intervention-manager] Error sending created message:`,
				error,
			);
		}
	}

	/**
	 * Cleanup intervention resources
	 */
	private cleanup(intervention: Intervention): void {
		// Remove from session map if this was the active intervention
		const currentId = this.sessionInterventions.get(intervention.sessionId);
		if (currentId === intervention.id) {
			this.sessionInterventions.delete(intervention.sessionId);
		}

		// Clear socket reference
		intervention.waitingSocket = undefined;

		// Note: We keep the intervention in the map for a while
		// for status queries. A background cleanup could remove old ones.
	}

	/**
	 * Generate unique intervention ID
	 */
	private generateId(): string {
		return `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	/**
	 * Get all pending interventions (for monitoring)
	 */
	listPending(): Intervention[] {
		const pending: Intervention[] = [];
		for (const intervention of this.interventions.values()) {
			if (intervention.status === "pending") {
				pending.push(intervention);
			}
		}
		return pending;
	}

	/**
	 * Cleanup old completed/cancelled interventions
	 */
	cleanupOld(maxAgeMs = 3600000): number {
		const now = Date.now();
		let cleaned = 0;

		for (const [id, intervention] of this.interventions) {
			if (intervention.status === "pending") continue;

			const age = now - intervention.createdAt.getTime();
			if (age > maxAgeMs) {
				this.interventions.delete(id);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			console.log(
				`[intervention-manager] Cleaned up ${cleaned} old interventions`,
			);
		}

		return cleaned;
	}
}

/**
 * Create singleton intervention manager
 */
let instance: InterventionManager | null = null;

export function getInterventionManager(baseUrl = ""): InterventionManager {
	if (!instance) {
		instance = new InterventionManager(baseUrl);
	} else if (baseUrl) {
		instance.setBaseUrl(baseUrl);
	}
	return instance;
}
