/**
 * Xvfb Manager
 *
 * Manages Xvfb (X Virtual Framebuffer) lifecycle for headed browser mode.
 * Starts Xvfb as a child process and ensures cleanup on shutdown.
 */

import { type Subprocess, spawn } from "bun";

export interface XvfbConfig {
	/** Display number (default: 99) */
	display?: number;
	/** Screen dimensions (default: 1920x1080x24) */
	screen?: string;
	/** Startup timeout in ms (default: 5000) */
	timeout?: number;
}

interface XvfbState {
	process: Subprocess<"ignore", "pipe", "pipe">;
	display: string;
}

let xvfbState: XvfbState | null = null;

/**
 * Check if Xvfb is needed (headed mode without existing DISPLAY)
 */
export function isXvfbNeeded(): boolean {
	const headless = process.env.HEADLESS?.toLowerCase();
	const hasDisplay = !!process.env.DISPLAY;

	// Need Xvfb if NOT headless AND no existing DISPLAY
	return headless === "false" && !hasDisplay;
}

/**
 * Start Xvfb if needed for headed mode
 *
 * @returns The DISPLAY string (e.g., ":99") or null if not started
 */
export async function startXvfb(
	config: XvfbConfig = {},
): Promise<string | null> {
	// Skip if already running
	if (xvfbState) {
		return xvfbState.display;
	}

	// Skip if not needed
	if (!isXvfbNeeded()) {
		return process.env.DISPLAY || null;
	}

	const displayNum = config.display ?? 99;
	const screen = config.screen ?? "1920x1080x24";
	const timeout = config.timeout ?? 5000;
	const display = `:${displayNum}`;

	console.log(`[xvfb] Starting Xvfb on display ${display}...`);

	// Start Xvfb
	const xvfbProcess = spawn(["Xvfb", display, "-screen", "0", screen], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	// Wait for Xvfb to be ready by checking if the display socket exists
	const socketPath = `/tmp/.X11-unix/X${displayNum}`;
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		// Check if process died
		if (xvfbProcess.exitCode !== null) {
			const stderr = await new Response(xvfbProcess.stderr).text();
			throw new Error(`Xvfb failed to start: ${stderr}`);
		}

		// Check if socket exists using shell test (Bun.file doesn't handle unix sockets)
		const result = Bun.spawnSync(["test", "-e", socketPath]);
		if (result.exitCode === 0) {
			// Socket exists, Xvfb is ready
			xvfbState = { process: xvfbProcess, display };
			process.env.DISPLAY = display;
			console.log(`[xvfb] Started on display ${display}`);
			return display;
		}

		await Bun.sleep(100);
	}

	// Timeout - kill the process
	xvfbProcess.kill();
	throw new Error(`Xvfb startup timeout (${timeout}ms)`);
}

/**
 * Stop Xvfb if running
 */
export async function stopXvfb(): Promise<void> {
	if (!xvfbState) {
		return;
	}

	console.log(`[xvfb] Stopping Xvfb on display ${xvfbState.display}...`);

	try {
		// Kill the Xvfb process
		xvfbState.process.kill("SIGTERM");

		// Wait briefly for graceful shutdown
		await Promise.race([xvfbState.process.exited, Bun.sleep(1000)]);

		// Force kill if still running
		if (xvfbState.process.exitCode === null) {
			xvfbState.process.kill("SIGKILL");
		}
	} catch {
		// Process may already be dead
	}

	xvfbState = null;
	console.log("[xvfb] Stopped");
}

/**
 * Check if Xvfb is currently running
 */
export function isXvfbRunning(): boolean {
	return xvfbState !== null && xvfbState.process.exitCode === null;
}

/**
 * Get the current DISPLAY value
 */
export function getDisplay(): string | null {
	return xvfbState?.display ?? process.env.DISPLAY ?? null;
}

/**
 * Cleanup all child processes (Xvfb + any orphaned Chromium)
 * Called on shutdown to ensure no orphan processes remain
 */
export async function cleanupProcesses(): Promise<void> {
	await stopXvfb();

	// Also kill any orphaned Chromium processes started by this browserd instance
	// This is a safety net - browser.close() should handle this normally
	try {
		const result = Bun.spawnSync(["pkill", "-9", "-f", "chromium.*playwright"]);
		if (result.exitCode === 0) {
			console.log("[xvfb] Cleaned up orphaned Chromium processes");
		}
	} catch {
		// pkill may not exist or no processes to kill
	}
}
