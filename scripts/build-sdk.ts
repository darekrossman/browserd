/**
 * Build script for the browserd SDK
 *
 * Generates ESM bundles and TypeScript declarations for npm publishing.
 *
 * Usage: bun run scripts/build-sdk.ts
 */

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";

const projectRoot = path.join(import.meta.dir, "..");
const distDir = path.join(projectRoot, "dist", "sdk");

// Entrypoints
const entrypoints = [
	"src/sdk/index.ts",
	"src/sdk/providers/index.ts",
	"src/sdk/ai/index.ts",
];

// External dependencies (not bundled)
const external = [
	// Optional provider dependencies
	"@vercel/sandbox",
	"@fly/sprites",
	// AI SDK dependencies (peer deps)
	"ai",
	"zod",
];

console.log("\x1b[36m🔨 Building browserd SDK...\x1b[0m\n");

// Step 1: Clean dist/sdk directory
if (existsSync(distDir)) {
	console.log("Cleaning dist/sdk...");
	rmSync(distDir, { recursive: true });
}

// Step 2: Build with Bun
console.log("Building ESM bundles...");
const result = await Bun.build({
	entrypoints: entrypoints.map((e) => path.join(projectRoot, e)),
	outdir: distDir,
	target: "bun",
	format: "esm",
	minify: true,
	splitting: true, // Enable code splitting for shared chunks
	external,
	naming: {
		entry: "[dir]/[name].js",
		chunk: "[name]-[hash].js",
	},
});

if (!result.success) {
	console.error("\x1b[31m❌ Build failed:\x1b[0m");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

// Step 3: Generate TypeScript declarations
console.log("Generating TypeScript declarations...");
const tscResult = await $`tsc -p tsconfig.build.json`.quiet().nothrow();

if (tscResult.exitCode !== 0) {
	console.error("\x1b[31m❌ TypeScript declaration generation failed:\x1b[0m");
	console.error(tscResult.stderr.toString());
	process.exit(1);
}

// Step 4: Summary
console.log("\n\x1b[32m✓ Build complete!\x1b[0m\n");

// List output files with sizes
const outputs = result.outputs;
const maxPathLen = Math.max(
	...outputs.map((o) => path.relative(projectRoot, o.path).length),
);

for (const output of outputs) {
	const relPath = path.relative(projectRoot, output.path);
	const sizeKB = (output.size / 1024).toFixed(2);
	console.log(`  ${relPath.padEnd(maxPathLen)}  \x1b[90m${sizeKB} KB\x1b[0m`);
}

// Count declaration files
const { stdout: findOutput } =
	await $`find ${distDir} -name "*.d.ts" | wc -l`.quiet();
const dtsCount = findOutput.toString().trim();
console.log(`\n  \x1b[90m+ ${dtsCount} declaration files (.d.ts)\x1b[0m`);

console.log("\n\x1b[90mReady for: bun publish\x1b[0m");
