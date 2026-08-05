/**
 * gh_pr checks execution tests.
 *
 * Uses a fake gh executable so the tests can exercise the command's
 * non-zero status handling without requiring GitHub authentication.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { assert, captureTools, withEnv } from "../../helpers.mjs";

const { registerGhTools } = await import("../../../src/gh-tools.ts");

const ghTools = captureTools(registerGhTools);

function createFakeGh(output) {
	const dir = mkdtempSync(join(tmpdir(), "pi-git-tools-gh-checks-"));
	const outputPath = join(dir, "checks.json");
	const implementationPath = join(dir, "fake-gh.mjs");
	writeFileSync(outputPath, output);
	writeFileSync(
		implementationPath,
		`import { readFileSync } from "node:fs";

const [command, subcommand] = process.argv.slice(2);
if (command === "--version") {
	process.stdout.write("gh version fake\\n");
	process.exit(0);
}
if (command === "auth" && subcommand === "status") {
	process.exit(0);
}
if (command === "pr" && subcommand === "checks") {
	process.stdout.write(readFileSync(process.env.PI_TEST_GH_OUTPUT, "utf8"));
	process.exit(Number(process.env.PI_TEST_GH_EXIT));
}
process.stderr.write("unsupported fake gh invocation");
process.exit(99);
`,
	);

	if (process.platform === "win32") {
		writeFileSync(
			join(dir, "gh.cmd"),
			`@echo off\r\n"${process.execPath}" "%~dp0fake-gh.mjs" %*\r\n`,
		);
	} else {
		const launcherPath = join(dir, "gh");
		writeFileSync(
			launcherPath,
			`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(implementationPath)} "$@"\n`,
		);
		chmodSync(launcherPath, 0o755);
	}

	return {
		dir,
		outputPath,
		cleanup() {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

async function withFakeGh(output, exitCode, fn) {
	const fakeGh = createFakeGh(output);
	try {
		return await withEnv(
			{
				PATH: `${fakeGh.dir}${delimiter}${process.env.PATH ?? ""}`,
				PI_TEST_GH_OUTPUT: fakeGh.outputPath,
				PI_TEST_GH_EXIT: String(exitCode),
			},
			fn,
		);
	} finally {
		fakeGh.cleanup();
	}
}

async function executeChecks() {
	const tool = ghTools.get("gh_pr");
	return tool.execute(
		"test-call",
		{ action: "checks", repo: "test/repo", number: 1 },
		new AbortController().signal,
		undefined,
		{ cwd: process.cwd() },
	);
}

describe("gh_pr checks", () => {
	it("returns pending checks when gh exits with status 8", async () => {
		await withFakeGh(
			JSON.stringify([
				{
					name: "CI",
					state: "PENDING",
					bucket: "pending",
					link: "https://example.test/checks/1",
				},
			]),
			8,
			async () => {
				const result = await executeChecks();
				assert.match(result.content[0].text, /pending\s+CI/);
				assert.equal(result.details.pending, true);
			},
		);
	});

	it("keeps successful checks behavior unchanged", async () => {
		await withFakeGh(
			JSON.stringify([{ name: "CI", state: "SUCCESS", bucket: "pass" }]),
			0,
			async () => {
				const result = await executeChecks();
				assert.match(result.content[0].text, /pass\s+CI/);
				assert.equal(result.details.pending, false);
			},
		);
	});

	it("does not turn an empty exit-8 response into success", async () => {
		await withFakeGh("\n", 8, async () => {
			await assert.rejects(
				() => executeChecks(),
				(err) => err.exitCode === 8 && err.stdout === "\n",
			);
		});
	});

	it("propagates unrelated gh failures", async () => {
		await withFakeGh("unexpected failure", 2, async () => {
			await assert.rejects(
				() => executeChecks(),
				(err) => err.exitCode === 2 && err.stdout === "unexpected failure",
			);
		});
	});
});
