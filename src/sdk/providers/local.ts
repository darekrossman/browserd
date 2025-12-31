/**
 * Local Docker Provider
 *
 * Provider for running browserd in local Docker containers.
 * Simulates remote provider behavior by copying a pre-built binary tarball
 * into the container and executing it, rather than mounting local source.
 *
 * Uses OrbStack's DNS feature (container-name.orb.local) for unique hostnames,
 * allowing multiple containers to run concurrently without port conflicts.
 */

import path from "node:path";
import { BrowserdError } from "../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../types";
import type { LocalSandboxProviderOptions, SandboxProvider } from "./types";

// Binary tarballs by architecture (relative to package root)
const BINARY_TARBALLS: Record<string, string> = {
	x64: "binaries/browserd.bun-linux-x64-baseline-v1.3.5.tar.gz",
	arm64: "binaries/browserd.bun-linux-arm64.tar.gz",
};

/**
 * Get the appropriate binary tarball for the current host architecture
 */
function getBinaryTarball(): string {
	const arch = process.arch; // 'arm64', 'x64', etc.
	const tarball = BINARY_TARBALLS[arch];

	if (!tarball) {
		throw new Error(
			`Unsupported architecture: ${arch}. Supported: ${Object.keys(BINARY_TARBALLS).join(", ")}`,
		);
	}

	return tarball;
}

// Container paths
const CONTAINER_HOME = "/home/vercel-sandbox";
const CONTAINER_WORKDIR = "/vercel/sandbox";
const CONTAINER_BIN_DIR = `${CONTAINER_HOME}/.local/bin`;

interface ContainerEntry {
	containerId: string;
	containerName: string;
	hostname: string;
	info: SandboxInfo;
}

/**
 * Local Docker Provider implementation
 *
 * Runs browserd in local Docker containers for development and testing.
 * Simulates remote provider behavior by deploying a pre-built binary.
 * Each container gets a unique hostname via OrbStack DNS (container-name.orb.local),
 * eliminating port conflicts when running multiple instances.
 */
export class LocalSandboxProvider implements SandboxProvider {
	readonly name = "local";

	private headed: boolean;
	private imageName: string;
	private containerNamePrefix: string;
	private readyTimeout: number;
	private packageDir: string;
	private defaultTimeout: number;
	private containers = new Map<string, ContainerEntry>();
	private debug: boolean;

	constructor(options: LocalSandboxProviderOptions = {}) {
		this.headed = options.headed ?? true;
		this.imageName = options.imageName ?? "browserd-sandbox";
		this.containerNamePrefix = options.containerNamePrefix ?? "browserd";
		this.readyTimeout = options.readyTimeout ?? 60000;
		this.packageDir = options.workingDir ?? process.cwd();
		this.defaultTimeout = options.defaultTimeout ?? 300000;
		this.debug = options.debug ?? false;
	}

	private log(message: string, startTime?: number): void {
		if (!this.debug) return;
		const elapsed = startTime ? ` [${Date.now() - startTime}ms]` : "";
		console.log(`[LocalProvider]${elapsed} ${message}`);
	}

	/**
	 * Create a new sandbox with browserd running in Docker
	 */
	async create(options?: CreateSandboxOptions): Promise<SandboxInfo> {
		const createStart = Date.now();
		this.log("create() started");

		const timeout = options?.timeout ?? this.defaultTimeout;

		// Ensure Docker is available
		let stepStart = Date.now();
		await this.ensureDocker();
		this.log("ensureDocker() completed", stepStart);

		// Ensure image exists (build if needed)
		stepStart = Date.now();
		await this.ensureImage();
		this.log("ensureImage() completed", stepStart);

		// Ensure binary tarball exists
		stepStart = Date.now();
		await this.ensureBinaryTarball();
		this.log("ensureBinaryTarball() completed", stepStart);

		// Generate unique container name and ID
		const sandboxId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const containerName = `${this.containerNamePrefix}-${sandboxId.slice(-8)}`;

		// Use OrbStack DNS: container-name.orb.local
		// All containers use port 3000 internally, no port mapping needed
		const hostname = `${containerName}.orb.local`;
		const port = 3000;

		// Create initial sandbox info
		const info: SandboxInfo = {
			id: sandboxId,
			domain: `http://${hostname}:${port}`,
			wsUrl: `ws://${hostname}:${port}/ws`,
			status: "creating",
			createdAt: Date.now(),
		};

		try {
			// Start the container (idle, waiting for setup)
			stepStart = Date.now();
			const containerId = await this.startContainer(containerName);
			this.log("startContainer() completed", stepStart);

			// Track the container
			this.containers.set(sandboxId, {
				containerId,
				containerName,
				hostname,
				info,
			});

			// Copy tarball into container
			stepStart = Date.now();
			await this.copyTarballToContainer(containerName);
			this.log("copyTarballToContainer() completed", stepStart);

			// Setup and start browserd in container
			stepStart = Date.now();
			await this.setupAndStartBrowserd(containerName);
			this.log("setupAndStartBrowserd() completed", stepStart);

			// Wait for browserd to be ready
			stepStart = Date.now();
			const ready = await this.waitForReady(
				sandboxId,
				hostname,
				port,
				Math.min(this.readyTimeout, timeout),
			);
			this.log("waitForReady() completed", stepStart);

			if (!ready) {
				throw new Error("browserd server did not become ready within timeout");
			}

			// Update status to ready
			info.status = "ready";

			this.log("create() completed", createStart);
			return { ...info };
		} catch (err) {
			// Cleanup on failure
			await this.destroy(sandboxId).catch(() => {});
			throw BrowserdError.sandboxCreationFailed(
				`Failed to start local Docker container: ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Destroy a sandbox (stop and remove the Docker container)
	 */
	async destroy(sandboxId: string): Promise<void> {
		const destroyStart = Date.now();
		this.log(`destroy(${sandboxId}) started`);

		const entry = this.containers.get(sandboxId);
		if (!entry) {
			this.log("destroy() - sandbox not found, skipping");
			return; // Already destroyed or never existed
		}

		try {
			// Stop the container with 1s grace period (--rm flag will auto-remove it)
			// Default is 10s which slows down tests significantly
			const stopStart = Date.now();
			await this.exec(["docker", "stop", "-t", "1", entry.containerName]);
			this.log("docker stop completed", stopStart);
		} catch {
			// Try force removal if stop fails
			try {
				const rmStart = Date.now();
				await this.exec(["docker", "rm", "-f", entry.containerName]);
				this.log("docker rm -f completed", rmStart);
			} catch {
				// Ignore removal errors
			}
		} finally {
			entry.info.status = "destroyed";
			this.containers.delete(sandboxId);
			this.log("destroy() completed", destroyStart);
		}
	}

	/**
	 * Check if a sandbox is ready
	 */
	async isReady(sandboxId: string): Promise<boolean> {
		const entry = this.containers.get(sandboxId);
		if (!entry) {
			return false;
		}

		return entry.info.status === "ready";
	}

	/**
	 * Get sandbox information
	 */
	async get(sandboxId: string): Promise<SandboxInfo | undefined> {
		const entry = this.containers.get(sandboxId);
		if (!entry) {
			return undefined;
		}

		return { ...entry.info };
	}

	/**
	 * Ensure Docker is available and running
	 */
	private async ensureDocker(): Promise<void> {
		try {
			await this.exec(["docker", "info"]);
		} catch (err) {
			throw BrowserdError.providerError(
				"Docker is not available. Make sure Docker is installed and the daemon is running.",
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Ensure the Docker image exists, build if needed
	 */
	private async ensureImage(): Promise<void> {
		try {
			// Check if image exists
			const { stdout } = await this.exec([
				"docker",
				"images",
				"-q",
				this.imageName,
			]);

			if (stdout.trim()) {
				return; // Image exists
			}

			// Build the image
			console.log(`Building Docker image '${this.imageName}'...`);
			await this.exec(
				[
					"docker",
					"build",
					"-f",
					"Dockerfile.sandbox-node",
					"-t",
					this.imageName,
					".",
				],
				{ cwd: this.packageDir },
			);
			console.log(`Docker image '${this.imageName}' built successfully.`);
		} catch (err) {
			throw BrowserdError.sandboxCreationFailed(
				`Failed to build Docker image '${this.imageName}': ${err instanceof Error ? err.message : String(err)}`,
				err instanceof Error ? err : undefined,
			);
		}
	}

	/**
	 * Ensure the binary tarball exists for current architecture
	 */
	private async ensureBinaryTarball(): Promise<void> {
		const tarball = getBinaryTarball();
		const tarballPath = path.join(this.packageDir, tarball);
		const file = Bun.file(tarballPath);

		if (!(await file.exists())) {
			throw BrowserdError.providerError(
				`Binary tarball not found at ${tarballPath}. Run 'bun run build:binary' first.`,
			);
		}
	}

	/**
	 * Start a Docker container in idle mode (no volume mounts)
	 * Uses OrbStack DNS (container-name.orb.local) for access
	 */
	private async startContainer(containerName: string): Promise<string> {
		const args = [
			"docker",
			"run",
			"-d",
			"--rm",
			"--name",
			containerName,
			"--shm-size=1g",
			"-w",
			CONTAINER_WORKDIR,
		];

		if (this.headed) {
			args.push("-e", "HEADLESS=false");
		} else {
			args.push("-e", "HEADLESS=true");
		}

		// Start container in idle mode, waiting for setup
		args.push(this.imageName, "sleep", "infinity");

		const { stdout } = await this.exec(args);
		return stdout.trim(); // Container ID
	}

	/**
	 * Copy the binary tarball into the container
	 */
	private async copyTarballToContainer(containerName: string): Promise<void> {
		const tarball = getBinaryTarball();
		const tarballPath = path.join(this.packageDir, tarball);

		// Copy tarball to container working directory
		await this.exec([
			"docker",
			"cp",
			tarballPath,
			`${containerName}:${CONTAINER_WORKDIR}/browserd.tar.gz`,
		]);
	}

	/**
	 * Setup and start browserd in the container
	 * - Extract tarball
	 * - Move binary to ~/.local/bin
	 * - Clean up tarball
	 * - Start browserd
	 */
	private async setupAndStartBrowserd(containerName: string): Promise<void> {
		// Build the setup command
		const setupScript = [
			// Create bin directory
			`mkdir -p ${CONTAINER_BIN_DIR}`,
			// Extract tarball (contains 'browserd' binary)
			`tar -xzf ${CONTAINER_WORKDIR}/browserd.tar.gz -C ${CONTAINER_WORKDIR}`,
			// Move binary to bin directory
			`mv ${CONTAINER_WORKDIR}/browserd ${CONTAINER_BIN_DIR}/browserd`,
			// Make executable
			`chmod +x ${CONTAINER_BIN_DIR}/browserd`,
			// Remove tarball
			`rm ${CONTAINER_WORKDIR}/browserd.tar.gz`,
		].join(" && ");

		// Run setup commands
		await this.dockerExec(containerName, ["bash", "-c", setupScript]);

		// Start browserd in background
		const startCommand = this.headed
			? `Xvfb :99 -screen 0 1280x720x24 &>/dev/null & sleep 0.2 && DISPLAY=:99 ${CONTAINER_BIN_DIR}/browserd`
			: `${CONTAINER_BIN_DIR}/browserd`;

		// Execute browserd in detached mode
		await this.dockerExec(containerName, [
			"bash",
			"-c",
			`nohup ${startCommand} &>/dev/null &`,
		]);
	}

	/**
	 * Execute a command inside a running container
	 */
	private async dockerExec(
		containerName: string,
		command: string[],
	): Promise<{ stdout: string; stderr: string }> {
		return this.exec(["docker", "exec", containerName, ...command]);
	}

	/**
	 * Wait for browserd to be ready by polling the health endpoint
	 */
	private async waitForReady(
		sandboxId: string,
		hostname: string,
		port: number,
		timeout: number,
	): Promise<boolean> {
		const healthUrl = `http://${hostname}:${port}/readyz`;
		const deadline = Date.now() + timeout;
		const pollInterval = 1000;

		while (Date.now() < deadline) {
			try {
				const response = await fetch(healthUrl, {
					method: "GET",
					signal: AbortSignal.timeout(5000),
				});

				if (response.ok) {
					return true;
				}
			} catch {
				// Server not ready yet (DNS not resolved or server starting)
			}

			// Check if sandbox was destroyed while waiting
			const entry = this.containers.get(sandboxId);
			if (!entry || entry.info.status === "destroyed") {
				return false;
			}

			await sleep(pollInterval);
		}

		return false;
	}

	/**
	 * Execute a command and return stdout/stderr
	 */
	private async exec(
		args: string[],
		options?: { cwd?: string },
	): Promise<{ stdout: string; stderr: string }> {
		const [cmd, ...cmdArgs] = args;

		const proc = Bun.spawn([cmd, ...cmdArgs], {
			cwd: options?.cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);

		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			throw new Error(`Command failed with exit code ${exitCode}: ${stderr}`);
		}

		return { stdout, stderr };
	}
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
