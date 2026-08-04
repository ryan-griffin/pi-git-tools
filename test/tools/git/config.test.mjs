/**
 * pi-git-tools — config integration tests.
 */
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	assert,
	captureTools,
	execTool,
	setupTempRepo,
} from "../../helpers.mjs";

const { registerGitTools } = await import("../../../src/git-tools.ts");

describe("config", () => {
	let ctx;
	let repoPath;
	let gitTools;

	before(() => {
		const setup = setupTempRepo();
		repoPath = setup.repoPath;
		ctx = setup.ctx;
		execTool.ctx = ctx;
		gitTools = captureTools(registerGitTools);
	});

	after(() => {
		try {
			rmSync(repoPath, { recursive: true, force: true });
		} catch {
			/* ok */
		}
	});

	it("git_config can get a value", async () => {
		const result = await execTool(gitTools, "git_config", {
			action: "get",
			name: "user.name",
		});
		const text = result.content[0].text;
		assert.ok(text.includes("Test User"), `config has test user: "${text}"`);
	});

	it("git_config list returns entries", async () => {
		const result = await execTool(gitTools, "git_config", {
			action: "list",
		});
		assert.ok(result.details.count > 0, "has config entries");
	});

	it("git_config get returns found:false for missing key", async () => {
		const result = await execTool(gitTools, "git_config", {
			action: "get",
			name: "section.nonexistent",
		});
		assert.equal(result.details.found, false);
		assert.ok(
			result.content[0].text.includes("not set"),
			`Expected 'not set' message, got: "${result.content[0].text}"`,
		);
	});

	it("git_config get works with global scope", async () => {
		// Global config uses the user's real git config; user.name is almost always set
		const result = await execTool(gitTools, "git_config", {
			action: "get",
			name: "user.name",
			scope: "global",
		});
		assert.ok(result.content[0].text.length > 0, "global config has user.name");
	});

	it("git_config set and unset a value", async () => {
		const key = "test.pi-git-tools";
		const value = "integration-test-value";

		// Set
		const setResult = await execTool(gitTools, "git_config", {
			action: "set",
			name: key,
			value,
			scope: "local",
		});
		assert.ok(setResult.content[0].text.includes(key));

		// Get it back
		const getResult = await execTool(gitTools, "git_config", {
			action: "get",
			name: key,
		});
		assert.equal(getResult.details.value, value);

		// Unset
		const unsetResult = await execTool(gitTools, "git_config", {
			action: "unset",
			name: key,
		});
		assert.ok(unsetResult.content[0].text.includes(key));

		// Verify it's gone
		const afterResult = await execTool(gitTools, "git_config", {
			action: "get",
			name: key,
		});
		assert.equal(afterResult.details.found, false);
	});

	it("git_config preserves trailing whitespace in values", async () => {
		const key = "test.trailing-space";
		const value = "trailing   ";

		// Set
		const setResult = await execTool(gitTools, "git_config", {
			action: "set",
			name: key,
			value,
			scope: "local",
		});
		assert.ok(setResult.content[0].text.includes(key));

		// Get it back — trailing spaces must survive the round-trip
		const getResult = await execTool(gitTools, "git_config", {
			action: "get",
			name: key,
		});
		assert.equal(getResult.details.value, value);
		assert.ok(
			getResult.content[0].text.endsWith("trailing   "),
			`value retains trailing spaces: "${getResult.content[0].text}"`,
		);
	});

	it("git_config rejects action-inapplicable params", async () => {
		await assert.rejects(
			() =>
				execTool(gitTools, "git_config", {
					action: "list",
					type: "bool",
				}),
			(err) =>
				err.message.includes("'type' is only valid for action(s): get, set"),
		);
		await assert.rejects(
			() =>
				execTool(gitTools, "git_config", {
					action: "unset",
					name: "test.key",
					value: "x",
				}),
			(err) =>
				err.message.includes(
					"'value' is only valid for action(s): set, add, unset-all",
				),
		);
	});
});
