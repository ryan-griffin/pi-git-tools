/**
 * Unit tests for src/activate.ts — dynamic tool loading.
 *
 * Tests cover: catalog integrity, the `PI_GIT_TOOLS_ACTIVE` override
 * resolution, the loader tool's activation logic (fake pi with captured
 * active set), and session_start deactivation (feature detection + env).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
	TOOL_CATALOG,
	LAZY_TOOL_NAMES,
	LAZY_TOOL_NAME_SET,
	GROUPS,
	resolveActiveOverride,
	toolsToDeactivate,
	registerActivateTool,
	registerDeactivation,
} = await import("../../src/activate.ts");

const GH_TOOLS = ["gh_api", "gh_issue", "gh_pr", "gh_repo", "gh_search"];
const GIT_ADVANCED = [
	"git_apply",
	"git_blame",
	"git_cherry_pick",
	"git_clean",
	"git_clone",
	"git_config",
	"git_init",
	"git_reflog",
	"git_revert",
	"git_worktree",
];

/** Fake ExtensionAPI capturing tool registrations and active-set changes. */
function makeFakePi({ withActiveTools = true } = {}) {
	const registered = [];
	const state = {
		active: ["read", "bash", "git_status", "git_diff", "git_log"],
		setCalls: [],
		handlers: {},
	};
	const pi = {
		registerTool: (def) => registered.push(def),
		on: (event, handler) => {
			state.handlers[event] = handler;
		},
	};
	if (withActiveTools) {
		pi.getActiveTools = () => [...state.active];
		pi.setActiveTools = (names) => {
			state.setCalls.push(names);
			state.active = [...names];
		};
	}
	return { pi, registered, state };
}

describe("activate catalog integrity", () => {
	it("has unique lazy tool names", () => {
		assert.equal(new Set(LAZY_TOOL_NAMES).size, LAZY_TOOL_NAMES.length);
	});

	it("every group in GROUPS is used by the catalog", () => {
		for (const group of GROUPS) {
			assert.ok(
				TOOL_CATALOG.some((entry) => entry.group === group),
				`group ${group} present in catalog`,
			);
		}
	});

	it("git-advanced and gh cover all lazy tools", () => {
		const grouped = TOOL_CATALOG.filter((e) => GROUPS.includes(e.group));
		assert.equal(grouped.length, LAZY_TOOL_NAMES.length);
		assert.deepEqual(
			[...new Set(GH_TOOLS.concat(GIT_ADVANCED))].sort(),
			[...LAZY_TOOL_NAME_SET].sort(),
		);
	});
});

describe("resolveActiveOverride", () => {
	it("returns null for unset/empty/whitespace env", () => {
		assert.equal(resolveActiveOverride(undefined), null);
		assert.equal(resolveActiveOverride(""), null);
		assert.equal(resolveActiveOverride("   "), null);
	});

	it("returns 'all' for the all keyword", () => {
		assert.equal(resolveActiveOverride("all"), "all");
		assert.equal(resolveActiveOverride(" gh , all "), "all");
	});

	it("expands group names to their tool lists", () => {
		const kept = resolveActiveOverride("gh");
		assert.ok(kept instanceof Set);
		assert.deepEqual([...kept].sort(), [...GH_TOOLS].sort());
	});

	it("accepts a mix of tool names and groups", () => {
		const kept = resolveActiveOverride("git_apply,gh");
		assert.ok(kept.has("git_apply"));
		for (const name of GH_TOOLS) assert.ok(kept.has(name));
	});

	it("ignores unknown names", () => {
		const kept = resolveActiveOverride("git_apply,bogus_tool");
		assert.ok(kept.has("git_apply"));
		assert.equal(kept.size, 1);
	});
});

describe("toolsToDeactivate", () => {
	it("defaults to deactivating the whole lazy set", () => {
		const toRemove = toolsToDeactivate(undefined);
		assert.equal(toRemove.size, LAZY_TOOL_NAMES.length);
	});

	it("keeps everything with env 'all'", () => {
		assert.equal(toolsToDeactivate("all").size, 0);
	});

	it("with env 'gh', deactivates only git-advanced tools", () => {
		const toRemove = toolsToDeactivate("gh");
		assert.deepEqual([...toRemove].sort(), [...GIT_ADVANCED].sort());
	});

	it("with env 'git-advanced', deactivates only gh tools", () => {
		const toRemove = toolsToDeactivate("git-advanced");
		assert.deepEqual([...toRemove].sort(), [...GH_TOOLS].sort());
	});

	it("with env 'git_apply', deactivates everything else in the lazy set", () => {
		const toRemove = toolsToDeactivate("git_apply");
		assert.equal(toRemove.size, LAZY_TOOL_NAMES.length - 1);
		assert.ok(!toRemove.has("git_apply"));
	});
});

describe("registerActivateTool", () => {
	it("registers the loader with a catalog in the description", () => {
		const { pi, registered } = makeFakePi();
		registerActivateTool(pi);
		assert.equal(registered.length, 1);
		const loader = registered[0];
		assert.equal(loader.name, "git_tools_activate");
		assert.ok(loader.description.includes("git_apply"));
		assert.ok(loader.description.includes("gh_pr"));
	});

	it("activates requested tools additively", async () => {
		const { pi, registered, state } = makeFakePi();
		registerActivateTool(pi);
		const def = registered[0];
		const res = await def.execute(
			"id",
			{ tools: ["gh_pr", "git_apply"] },
			undefined,
		);
		assert.deepEqual(
			[...res.details.added].sort(),
			["gh_pr", "git_apply"].sort(),
		);
		// The fake pi captured setActiveTools calls.
		const lastCall = state.setCalls.at(-1);
		assert.ok(lastCall.includes("gh_pr"));
		assert.ok(lastCall.includes("git_apply"));
		assert.ok(lastCall.includes("read"), "preserves builtin tools");
		assert.equal(
			res.content[0].text.includes("Available starting next turn."),
			true,
		);
	});

	it("expands a group to all its tools", async () => {
		const { pi, registered } = makeFakePi();
		registerActivateTool(pi);
		const res = await registered[0].execute("id", { group: "gh" }, undefined);
		assert.deepEqual([...res.details.added].sort(), [...GH_TOOLS].sort());
	});

	it("expands multiple groups in one call", async () => {
		const { pi, registered, state } = makeFakePi();
		registerActivateTool(pi);
		const res = await registered[0].execute(
			"id",
			{ group: ["git-advanced", "gh"] },
			undefined,
		);
		assert.equal(res.details.added.length, LAZY_TOOL_NAMES.length);
		assert.equal(state.setCalls.length, 1, "single setActiveTools call");
	});

	it("reports already-active tools and skips setActiveTools when nothing new", async () => {
		const { pi, registered, state } = makeFakePi();
		registerActivateTool(pi);
		const def = registered[0];
		const first = await def.execute("id", { tools: ["gh_pr"] }, undefined);
		assert.equal(first.details.added.length, 1, "first activation adds");
		assert.equal(state.setCalls.length, 1);
		// Second request for the same tool: nothing new to add.
		const second = await def.execute("id", { tools: ["gh_pr"] }, undefined);
		assert.deepEqual(second.details.added, []);
		assert.deepEqual(second.details.alreadyActive, ["gh_pr"]);
		assert.equal(state.setCalls.length, 1, "no second setActiveTools call");
	});

	it("rejects an empty request", async () => {
		const defs = [];
		const pi = { registerTool: (d) => defs.push(d) };
		registerActivateTool(pi);
		const res = await defs[0].execute("id", {}, undefined);
		assert.equal(res.isError, true);
		assert.ok(res.content[0].text.includes("Available:"));
	});
});

describe("registerDeactivation", () => {
	it("is a no-op on hosts without getActiveTools/setActiveTools", () => {
		const { pi, state } = makeFakePi({ withActiveTools: false });
		registerDeactivation(pi);
		assert.equal(state.handlers.session_start, undefined);
	});

	it("removes lazy tools from the active set at session_start (default)", async () => {
		const { pi, state } = makeFakePi();
		registerDeactivation(pi);
		assert.ok(state.handlers.session_start, "session_start handler registered");
		const prevEnv = process.env.PI_GIT_TOOLS_ACTIVE;
		delete process.env.PI_GIT_TOOLS_ACTIVE;
		try {
			await state.handlers.session_start({});
		} finally {
			if (prevEnv === undefined) delete process.env.PI_GIT_TOOLS_ACTIVE;
			else process.env.PI_GIT_TOOLS_ACTIVE = prevEnv;
		}
		for (const name of LAZY_TOOL_NAMES) {
			assert.ok(!state.active.includes(name), `${name} deactivated`);
		}
		assert.ok(state.active.includes("read"), "builtins preserved");
		assert.ok(state.active.includes("git_status"), "core git preserved");
	});

	it("honors PI_GIT_TOOLS_ACTIVE=gh at session_start", async () => {
		const { pi, state } = makeFakePi();
		// Seed a session where the gh tools were already active.
		state.active = [...GH_TOOLS, "read", "bash", "git_status"];
		registerDeactivation(pi);
		const prevEnv = process.env.PI_GIT_TOOLS_ACTIVE;
		process.env.PI_GIT_TOOLS_ACTIVE = "gh";
		try {
			await state.handlers.session_start({});
		} finally {
			if (prevEnv === undefined) delete process.env.PI_GIT_TOOLS_ACTIVE;
			else process.env.PI_GIT_TOOLS_ACTIVE = prevEnv;
		}
		for (const name of GH_TOOLS) {
			assert.ok(state.active.includes(name), `${name} kept with env gh`);
		}
		for (const name of GIT_ADVANCED) {
			assert.ok(
				!state.active.includes(name),
				`${name} deactivated with env gh`,
			);
		}
	});

	it("keeps everything with PI_GIT_TOOLS_ACTIVE=all", async () => {
		const { pi, state } = makeFakePi();
		registerDeactivation(pi);
		const prevEnv = process.env.PI_GIT_TOOLS_ACTIVE;
		process.env.PI_GIT_TOOLS_ACTIVE = "all";
		try {
			await state.handlers.session_start({});
		} finally {
			if (prevEnv === undefined) delete process.env.PI_GIT_TOOLS_ACTIVE;
			else process.env.PI_GIT_TOOLS_ACTIVE = prevEnv;
		}
		assert.equal(state.setCalls.length, 0, "active set untouched");
	});
});
