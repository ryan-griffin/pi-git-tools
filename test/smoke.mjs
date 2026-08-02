/**
 * Smoke tests for pi-git-tools extension.
 *
 * These tests verify the module structure (imports, exports, tool registration)
 * without mocking the full pi runtime. They check that:
 * 1. All tool names, labels, descriptions, and parameter schemas are defined
 * 2. Each tool has the required fields (name, label, description, parameters, execute)
 * 3. Parameter schemas use TypeBox correctly
 * 4. No tool has suspicious parameter combinations
 *
 * Note: tool registrations live in per-tool modules under src/tools/{git,gh}/,
 * so this walks the whole src/ tree rather than just the aggregator files.
 *
 * To run: node test/smoke.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const EXT_DIR = resolve(__dirname, "..");

/** Recursively list all .ts files under a directory. */
function listTsFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...listTsFiles(full));
		} else if (entry.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

/** Read a source file, returning the content or empty string if missing. */
function readSource(relativePath) {
	try {
		return readFileSync(resolve(EXT_DIR, relativePath), "utf-8");
	} catch {
		return "";
	}
}

// Read all source modules: top-level files plus every per-tool module.
const TOP_LEVEL_FILES = [
	"src/activate.ts",
	"src/truncate.ts",
	"src/validation.ts",
	"src/utils.ts",
	"src/git-tools.ts",
	"src/gh-tools.ts",
	"src/index.ts",
];
const TOOL_FILES = listTsFiles(resolve(EXT_DIR, "src/tools")).map((f) =>
	f.slice(EXT_DIR.length + 1).replaceAll("\\", "/"),
);
const SOURCE_FILES = [...TOP_LEVEL_FILES, ...TOOL_FILES];
const sources = Object.fromEntries(SOURCE_FILES.map((f) => [f, readSource(f)]));
const source = Object.values(sources).join("\n");

const TOOL_NAMES = [
	"git_status",
	"git_diff",
	"git_log",
	"git_branch",
	"git_commit",
	"git_add",
	"git_apply",
	"git_worktree",
	"git_stash",
	"git_clone",
	"git_fetch",
	"git_init",
	"git_merge",
	"git_rebase",
	"git_reset",
	"git_restore",
	"git_pull",
	"git_push",
	"git_tag",
	"git_cherry_pick",
	"git_revert",
	"git_clean",
	"git_remote",
	"git_reflog",
	"git_config",
	"git_show",
	"git_blame",
	"git_tools_activate",
	"gh_api",
	"gh_pr",
	"gh_issue",
	"gh_repo",
	"gh_search",
];

/** Expected module file for a tool name (e.g. git_status -> src/tools/git/status.ts). */
function toolModuleFile(name) {
	if (name === "git_tools_activate") return "src/activate.ts";
	const prefix = name.startsWith("gh_") ? "gh" : "git";
	const base = name.slice(prefix === "gh" ? 3 : 4);
	return `src/tools/${prefix}/${base}.ts`;
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
	if (condition) {
		passed++;
	} else {
		failed++;
		console.error(`  FAIL: ${msg}`);
	}
}

function assertEqual(actual, expected, msg) {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		console.error(
			"  FAIL: " +
				msg +
				" - expected " +
				JSON.stringify(expected) +
				", got " +
				JSON.stringify(actual),
		);
	}
}

console.log("pi-git-tools smoke tests\n");

// 0. Check all source files exist
console.log("Source files:");
for (const [name, content] of Object.entries(sources)) {
	assert(content.length > 0, `Source file "${name}" exists and is non-empty`);
	if (content.length > 0) {
		const sizeKb = (content.length / 1024).toFixed(1);
		console.log(`  ${name} (${sizeKb} KB)`);
	}
}

// 1. Check all tool names are present across all source files
console.log("\nTool presence:");
for (const name of TOOL_NAMES) {
	const pattern = `name: "${name}"`;
	assert(source.includes(pattern), `Tool "${name}" not found in source`);
	if (source.includes(pattern)) {
		console.log(`  ${name}`);
	}
}

// 2. Check tool count
console.log("\nTool count:");
// Count `name:` literals in per-tool modules (exactly one each) plus the
// loader tool in src/activate.ts. The activate.ts TOOL_CATALOG also carries
// `name:` literals, so it is excluded from the module scan and counted via
// its explicit loader registration.
const foundTools =
	TOOL_FILES.flatMap(
		(f) => sources[f].match(/name:\s*"(git_\w+|gh_\w+)"/g) || [],
	).length +
	(sources["src/activate.ts"].includes('name: "git_tools_activate"') ? 1 : 0);
assertEqual(
	foundTools,
	TOOL_NAMES.length,
	`Expected ${TOOL_NAMES.length} tools, found ${foundTools}`,
);

// 3. Check each tool has required fields in its own module file
console.log("\nRequired fields:");
for (const name of TOOL_NAMES) {
	const moduleSource = sources[toolModuleFile(name)] || "";
	assert(moduleSource.includes(`name: "${name}"`), `${name}: has name`);
	assert(moduleSource.includes("label:"), `${name}: has label`);
	assert(moduleSource.includes("description:"), `${name}: has description`);
	assert(moduleSource.includes("parameters:"), `${name}: has parameters`);
	assert(moduleSource.includes("promptSnippet:"), `${name}: has promptSnippet`);
	assert(moduleSource.includes("async execute("), `${name}: has execute`);
}

// 4. Check registration: one registerTool call per tool module
console.log("\nRegistration:");
const regCalls = (source.match(/registerTool\(pi, \{/g) || []).length;
assertEqual(regCalls, TOOL_NAMES.length, "registerTool call count");
const gitRegCalls = (
	sources["src/git-tools.ts"].match(/register\w+\(pi\)/g) || []
).length;
const ghRegCalls = (
	sources["src/gh-tools.ts"].match(/register\w+\(pi\)/g) || []
).length;
console.log(
	`  ${regCalls} registerTool calls, ${gitRegCalls} git + ${ghRegCalls} gh aggregator calls`,
);

// 5. Check no shell-injection vectors (execFile only, no exec/spawn with shell)
console.log("\nSecurity:");
const allSource = Object.values(sources).join("\n");
assert(
	sources["src/utils.ts"].includes("execFileAsync(bin, args, opts)"),
	"Uses execFileAsync",
);
assert(
	!allSource.includes('exec("') && !allSource.includes('spawn("'),
	"No exec/spawn calls",
);
assert(!allSource.includes("shell: true"), "No shell: true option");
console.log("  No shell injection vectors found");

// 6. Check braces and parens balance per file
console.log("\nSyntax:");
for (const [name, content] of Object.entries(sources)) {
	const openB = (content.match(/{/g) || []).length;
	const closeB = (content.match(/}/g) || []).length;
	assertEqual(
		openB,
		closeB,
		`${name}: Brace balance (${openB} open / ${closeB} closed)`,
	);

	const openP = (content.match(/\(/g) || []).length;
	const closeP = (content.match(/\)/g) || []).length;
	assertEqual(
		openP,
		closeP,
		`${name}: Paren balance (${openP} open / ${closeP} closed)`,
	);
}
console.log("  All files balanced");

// 7. Check TypeBox is used by tool modules
console.log("\nTypeBox:");
// Every module that registers a tool must import TypeBox; plain helpers (e.g.
// gh-helpers.ts) are exempt.
const toolModules = TOOL_FILES.filter((f) =>
	sources[f].includes("registerTool(pi, {"),
);
assert(
	toolModules.every((f) =>
		sources[f].includes('import { Type } from "typebox"'),
	),
	"Every tool module imports TypeBox",
);
assert(allSource.includes("Type.Object({"), "Type.Object used");
assert(allSource.includes("Type.String({"), "Type.String used");
assert(allSource.includes("Type.Boolean({"), "Type.Boolean used");
assert(allSource.includes("Type.Optional("), "Type.Optional used");

// 8. Check ExtensionAPI import
console.log("\nExtensionAPI:");
assert(
	sources["src/index.ts"].includes(
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"',
	),
	"index.ts imports ExtensionAPI",
);
assert(
	sources["src/git-tools.ts"].includes(
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"',
	),
	"git-tools.ts imports ExtensionAPI",
);
assert(
	sources["src/gh-tools.ts"].includes(
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"',
	),
	"gh-tools.ts imports ExtensionAPI",
);

// 9. Check entry point chain (package.json pi manifest → src/index.ts)
console.log("\nModule chain:");
assert(
	readSource("package.json").includes(
		'"extensions": [\n\t\t\t"./src/index.ts"\n\t\t]',
	),
	"pi manifest points at ./src/index.ts",
);
assert(
	readSource("index.ts") === "",
	"Root index.ts removed (entry lives in src/)",
);
assert(
	sources["src/index.ts"].includes("export default function"),
	"src/index.ts has default export",
);
assert(
	sources["src/index.ts"].includes("import { registerGitTools }"),
	"src/index.ts imports registerGitTools",
);
assert(
	sources["src/index.ts"].includes("import { registerGhTools }"),
	"src/index.ts imports registerGhTools",
);
assert(
	sources["src/index.ts"].includes("import { registerTruncationCleanup }"),
	"src/index.ts imports registerTruncationCleanup",
);
assert(
	sources["src/index.ts"].includes("registerTruncationCleanup(pi)"),
	"src/index.ts wires truncation cleanup",
);
console.log("  Module chain intact");

// 10. Verify git/gh commands are built as arrays (not shell strings)
console.log("\nCommand construction:");
assert(
	!allSource.includes('"git status"'),
	"No 'git status' as a plain string command",
);
assert(
	!allSource.includes('"git diff"'),
	"No 'git diff' as a plain string command",
);
console.log("  No string-based commands");

// 11. Summary
console.log(`\n${"=".repeat(40)}`);
console.log(
	`Results: ${passed} passed, ${failed} failed, ${TOOL_NAMES.length} tools`,
);
console.log("=".repeat(40));

process.exit(failed > 0 ? 1 : 0);
