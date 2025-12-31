import path from "node:path";
import { $ } from "bun";
import * as tar from "tar";

const projectRoot = path.join(import.meta.dir, "..");
const bundleDir = path.join(projectRoot, "bundle");
const buildDir = path.join(projectRoot, "build");
const entry = "src/server/index.ts";
const bundleName = `browserd.js`;
const tarballName = `browserd.tar.gz`;
const tarballPath = path.join(bundleDir, tarballName);
const bundlePath = path.join(buildDir, bundleName);

await $`mkdir -p ${buildDir}`;
await $`mkdir -p ${bundleDir}`;

await Bun.build({
	entrypoints: [entry],
	outdir: buildDir,
	naming: bundleName,
	minify: true,
	external: ["rebrowser-playwright"],
});

await tar.create(
	{
		gzip: true,
		file: tarballPath,
		portable: true,
	},
	[bundlePath],
);

// Summary
console.log("\n\x1b[32mBuild complete!\x1b[0m");

const bundleSizeKB = ((await Bun.file(bundlePath).stat()).size / 1024).toFixed(
	2,
);

const tarballSizeKB = (
	(await Bun.file(tarballPath).stat()).size / 1024
).toFixed(2);

const bundlePathStr = `build/${bundleName}`;
const tarballPathStr = `bundle/${tarballName}`;
const maxWidth = Math.max(bundlePathStr.length, tarballPathStr.length);

console.log(
	`- ${bundlePathStr.padEnd(maxWidth)} \x1b[90m(${bundleSizeKB} KB)\x1b[0m`,
);
console.log(
	`- ${tarballPathStr.padEnd(maxWidth)} \x1b[90m(${tarballSizeKB} KB)\x1b[0m`,
);
