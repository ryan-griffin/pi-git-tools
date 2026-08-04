/**
 * Unit tests for tool schema strictness.
 *
 * TypeBox's Type.Object accepts unknown keys by default, and pi validates
 * tool-call arguments against the registered schema before execute(). Every
 * tool must therefore opt into `additionalProperties: false` so a misspelled
 * parameter key is rejected by the host instead of silently reaching the
 * tool.
 *
 * The helper-level fallback in assertParamsValidForAction ("not valid for
 * any action") remains as defense-in-depth: it covers the test harness
 * (which calls execute() directly, bypassing schemas) and table drift
 * (a schema param added without a matching ACTION_PARAMS entry).
 */
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import { registerActivateTool } from "../../src/activate.ts";
import { registerGhTools } from "../../src/gh-tools.ts";
import { registerGitTools } from "../../src/git-tools.ts";
import { assert } from "../helpers.mjs";

function allToolDefinitions() {
	const tools = new Map();
	registerGitTools({
		registerTool: (config) => tools.set(config.name, config),
	});
	registerGhTools({ registerTool: (config) => tools.set(config.name, config) });
	registerActivateTool({
		registerTool: (config) => tools.set(config.name, config),
	});
	return [...tools.entries()];
}

describe("tool schemas are strict", () => {
	const tools = allToolDefinitions();

	it("every tool schema sets additionalProperties: false", () => {
		assert.ok(tools.length >= 33, `expected 33 tools, got ${tools.length}`);
		for (const [name, def] of tools) {
			assert.equal(
				def.parameters.additionalProperties,
				false,
				`${name} parameters schema must set additionalProperties: false`,
			);
		}
	});

	it("unknown keys fail schema validation", () => {
		for (const [name, def] of tools) {
			assert.equal(
				Value.Check(def.parameters, { bogus: true }),
				false,
				`${name} must reject unknown keys`,
			);
		}
	});
});
