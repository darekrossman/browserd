#!/usr/bin/env bun
/**
 * Build browserd server into single-file Bun executables for Linux targets
 *
 * Usage:
 *   bun scripts/build-binary.ts
 *
 * Output: binaries/browserd-{target}.tar.gz
 */

import fs from "node:fs";
import path from "node:path";
import { $ } from "bun";
import * as tar from "tar";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const BINARIES_DIR = path.join(PROJECT_ROOT, "binaries");
const BUILD_DIR = path.join(PROJECT_ROOT, "build");
const ENTRY = "src/server/index.ts";

// Linux targets to build
const TARGETS = [
	"bun-linux-x64",
	"bun-linux-x64-baseline",
	"bun-linux-arm64",
	"bun-linux-x64-baseline-v1.3.5",
];

// External packages that should not be bundled
const EXTERNAL_PACKAGES = [
	"rebrowser-playwright",
	"rebrowser-playwright-core",
	"playwright",
	"playwright-core",
];

/**
 * Create a clean tarball without OS-specific extended attributes
 */
async function createTarball(
	sourcePath: string,
	tarballPath: string,
): Promise<void> {
	const sourceDir = path.dirname(sourcePath);
	const sourceFile = path.basename(sourcePath);

	await tar.create(
		{
			gzip: true,
			file: tarballPath,
			cwd: sourceDir,
			portable: true,
		},
		[sourceFile],
	);
}

async function buildTarget(
	target: string,
): Promise<{ tarball: string; size: number }> {
	const binaryPath = path.join(BUILD_DIR, "browserd");
	const tarballName = `browserd.${target}.tar.gz`;
	const tarballPath = path.join(BINARIES_DIR, tarballName);

	console.log(`  Building ${target}...`);

	const args = [
		"build",
		ENTRY,
		"--compile",
		`--target=${target}`,
		`--outfile=${binaryPath}`,
		"--minify",
		...EXTERNAL_PACKAGES.map((p) => `--external=${p}`),
	];

	const result = Bun.spawnSync(["bun", ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});

	if (result.exitCode !== 0) {
		const stderr = new TextDecoder().decode(result.stderr);
		throw new Error(`Build failed for ${target}: ${stderr}`);
	}

	// Create tarball
	await createTarball(binaryPath, tarballPath);

	// Get tarball size
	const stat = await Bun.file(tarballPath).stat();

	// Clean up intermediate binary
	fs.unlinkSync(binaryPath);

	return { tarball: tarballPath, size: stat.size };
}

async function main() {
	console.log("Building browserd server binaries...\n");

	// Ensure directories exist
	await $`mkdir -p ${BUILD_DIR}`;
	await $`mkdir -p ${BINARIES_DIR}`;

	const results: { target: string; tarball: string; size: number }[] = [];

	for (const target of TARGETS) {
		const { tarball, size } = await buildTarget(target);
		results.push({ target, tarball, size });
	}

	// Summary
	console.log("\nBuild complete!\n");
	console.log("Tarballs:");
	for (const { target, tarball, size } of results) {
		const sizeMB = (size / (1024 * 1024)).toFixed(2);
		console.log(`  ${target}: ${path.basename(tarball)} (${sizeMB} MB)`);
	}
}

main();
