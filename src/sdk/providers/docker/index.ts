/**
 * Docker Container Provider
 *
 * Provider for running browserd in local Docker containers.
 * Simulates remote provider behavior by copying a pre-built JS bundle tarball
 * into the container and running it with `bun browserd.js`.
 *
 * Uses OrbStack's DNS feature (container-name.orb.local) for unique hostnames,
 * allowing multiple containers to run concurrently without port conflicts.
 */

import path from "node:path";
import { BrowserdError } from "../../errors";
import type { CreateSandboxOptions, SandboxInfo } from "../../types";
import type { SandboxProvider, SandboxProviderOptions } from "../types";

// Single bundled tarball (architecture-agnostic JS bundle)
const BUNDLE_TARBALL = "bundle/browserd.tar.gz";

// Container paths
const CONTAINER_WORKDIR = "/vercel/sandbox";

interface ContainerEntry {
	containerId: string;
	containerName: string;
	hostname: string;
	info: SandboxInfo;
}

/**
 * Options for Docker Container Provider
 */
export interface DockerContainerProviderOptions extends SandboxProviderOptions {
	/** Run browser in headed mode with Xvfb (default: true) */
	headed?: boolean;
	/** Docker image name (default: 'browserd-sandbox') */
	imageName?: string;
	/** Container name prefix (default: 'browserd') */
	containerNamePrefix?: string;
	/** Timeout for ready check in ms (default: 60000) */
	readyTimeout?: number;
	/** Working directory to mount (default: process.cwd()) */
	workingDir?: string;
	/** Enable debug logging for timing analysis (default: false) */
	debug?: boolean;
}

/**
 * @deprecated Use DockerContainerProviderOptions instead
 */
export type LocalSandboxProviderOptions = DockerContainerProviderOptions;

/**
 * Docker Container Provider implementation
 *
 * Runs browserd in local Docker containers for development and testing.
 * Simulates remote provider behavior by deploying a pre-built JS bundle.
 * Each container gets a unique hostname via OrbStack DNS (container-name.orb.local),
 * eliminating port conflicts when running multiple instances.
 */
export class DockerContainerProvider implements SandboxProvider {
	readonly name = "docker";

	private headed: boolean;
	private imageName: string;
	private containerNamePrefix: string;
	private readyTimeout: number;
	private packageDir: string;
	private defaultTimeout: number;
	private containers = new Map<string, ContainerEntry>();
	private debug: boolean;

	constructor(options: DockerContainerProviderOptions = {}) {
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
		console.log(`[DockerProvider]${elapsed} ${message}`);
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

		// Ensure bundle tarball exists
		stepStart = Date.now();
		await this.ensureBundleTarball();
		this.log("ensureBundleTarball() completed", stepStart);

		// Generate unique container name and ID
		const sandboxId = `docker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
				`Failed to start Docker container: ${err instanceof Error ? err.message : String(err)}`,
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
	 * Ensure the bundle tarball exists
	 */
	private async ensureBundleTarball(): Promise<void> {
		const tarballPath = path.join(this.packageDir, BUNDLE_TARBALL);
		const file = Bun.file(tarballPath);

		if (!(await file.exists())) {
			throw BrowserdError.providerError(
				`Bundle tarball not found at ${tarballPath}. Run 'bun run build:bundle' first.`,
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
	 * Copy the bundle tarball into the container
	 */
	private async copyTarballToContainer(containerName: string): Promise<void> {
		const tarballPath = path.join(this.packageDir, BUNDLE_TARBALL);

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
	 * - Extract tarball (JS bundle)
	 * - Run with bun browserd.js
	 * - Clean up tarball
	 */
	private async setupAndStartBrowserd(containerName: string): Promise<void> {
		// Build the setup command
		// Extract tarball and find browserd.js (handles any path structure in tarball)
		const setupScript = [
			// Extract tarball to temp location
			`mkdir -p /tmp/browserd-extract`,
			`tar -xzf ${CONTAINER_WORKDIR}/browserd.tar.gz -C /tmp/browserd-extract`,
			// Find and move browserd.js to workdir
			`find /tmp/browserd-extract -name 'browserd.js' -exec mv {} ${CONTAINER_WORKDIR}/browserd.js \\;`,
			// Clean up
			`rm -rf /tmp/browserd-extract`,
			`rm ${CONTAINER_WORKDIR}/browserd.tar.gz`,
		].join(" && ");

		// Run setup commands
		await this.dockerExec(containerName, ["bash", "-c", setupScript]);

		// Start browserd with bun in background
		const startCommand = this.headed
			? `Xvfb :99 -screen 0 1280x720x24 &>/dev/null & sleep 0.2 && DISPLAY=:99 bun ${CONTAINER_WORKDIR}/browserd.js`
			: `bun ${CONTAINER_WORKDIR}/browserd.js`;

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
		if (!cmd) {
			throw new Error("No command specified");
		}

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
