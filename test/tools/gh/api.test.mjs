/**
 * pi-git-tools — gh_api validation tests.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { before, describe, it } from "node:test";

import { assert, captureTools, execTool, withEnv } from "../../helpers.mjs";

const { registerGhTools } = await import("../../../src/gh-tools.ts");

function createFakeGh() {
	const dir = mkdtempSync(join(tmpdir(), "pi-git-tools-gh-api-"));
	const implementationPath = join(dir, "fake-gh.mjs");
	writeFileSync(implementationPath, "process.stdout.write(process.cwd());\n");

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
		cleanup() {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("gh_api", () => {
	let ghTools;

	before(() => {
		ghTools = captureTools(registerGhTools);
	});

	it("gh_api is registered", () => {
		assert.ok(ghTools.has("gh_api"), "gh_api registered");
	});

	it("uses the supplied cwd outside a Git repository", async () => {
		const requestedCwd = mkdtempSync(
			join(tmpdir(), "pi-git-tools-gh-api-cwd-"),
		);
		const fakeGh = createFakeGh();
		try {
			await withEnv(
				{
					PATH: `${fakeGh.dir}${delimiter}${process.env.PATH ?? ""}`,
				},
				async () => {
					const result = await ghTools
						.get("gh_api")
						.execute(
							"test-call",
							{ path: "/user" },
							new AbortController().signal,
							undefined,
							{ cwd: requestedCwd },
						);
					assert.equal(result.content[0].text, requestedCwd);
				},
			);
		} finally {
			fakeGh.cleanup();
			rmSync(requestedCwd, { recursive: true, force: true });
		}
	});

	it("uses the repository root when cwd is inside a Git repository", async () => {
		const fakeGh = createFakeGh();
		try {
			await withEnv(
				{
					PATH: `${fakeGh.dir}${delimiter}${process.env.PATH ?? ""}`,
				},
				async () => {
					const result = await ghTools
						.get("gh_api")
						.execute(
							"test-call",
							{ path: "/user" },
							new AbortController().signal,
							undefined,
							{ cwd: join(process.cwd(), "src") },
						);
					assert.equal(result.content[0].text, process.cwd());
				},
			);
		} finally {
			fakeGh.cleanup();
		}
	});

	it("requires a path", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "" }),
			(err) => err.message.includes("path"),
		);
	});

	it("rejects paths not starting with /", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "repos/owner/repo" }),
			(err) => err.message.includes("start with '/'"),
		);
	});

	it("rejects paths with whitespace", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "/repos/own er/repo" }),
			(err) => err.message.includes("invalid characters"),
		);
	});

	it("rejects invalid methods", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "/user", method: "FETCH" }),
			(err) => err.message.includes("Invalid method"),
		);
	});

	it("rejects data on GET", async () => {
		await assert.rejects(
			() => execTool(ghTools, "gh_api", { path: "/user", data: "{}" }),
			(err) => err.message.includes("not valid for GET"),
		);
	});

	it("rejects malformed JSON data", async () => {
		await assert.rejects(
			() =>
				execTool(ghTools, "gh_api", {
					path: "/repos/o/r",
					method: "POST",
					data: "{nope",
				}),
			(err) => err.message.includes("valid JSON"),
		);
	});
});
