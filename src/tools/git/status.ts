/**
 * pi-git-tools — git_status tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_status",
		label: "Git Status",
		description:
			"Show the working tree status — staged, unstaged, and untracked changes. Run this first before other git operations to understand the current state of the repository.",
		promptSnippet: "Check working tree status",
		parameters: Type.Object({}),
		async execute(_callId, _params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			// -b: include the `## <branch>...<upstream> [ahead N, behind M]` header line
			// (also handles detached HEAD and unborn branches) in a single call.
			const status = await run(
				"git",
				["status", "--porcelain", "-b"],
				root,
				undefined,
				_signal,
			);

			const lines = status.split("\n").filter(Boolean);
			const branchLine = lines.find((l) => l.startsWith("## ")) ?? "";
			const fileLines = lines.filter((l) => !l.startsWith("## "));

			// Parse `## <branch>...<upstream> [ahead N, behind M]`.
			let branch = "(unknown)";
			let tracking = "";
			const branchInfo = branchLine.slice(3);
			if (branchInfo) {
				const match = branchInfo.match(/^(.+?)(?:\.\.\.\S+)?(?: \[(.*)\])?$/);
				if (match) {
					branch = match[1] || "(unknown)";
					tracking = match[2] ?? "";
				}
			}
			if (branch === "HEAD (no branch)") branch = "(detached HEAD)";
			if (branch.startsWith("No commits yet on ")) {
				branch = `${branch.slice("No commits yet on ".length)} (no commits yet)`;
			}

			let summary = "";
			if (fileLines.length === 0) {
				summary = "Working tree clean.";
			} else {
				const staged = fileLines.filter(
					(l) => l[0] !== " " && l[0] !== "?",
				).length;
				const unstaged = fileLines.filter(
					(l) => l[1] !== " " && l[1] !== "?",
				).length;
				const untracked = fileLines.filter((l) => l.startsWith("??")).length;
				summary = `${staged} staged · ${unstaged} unstaged · ${untracked} untracked`;
			}

			const branchDisplay = tracking ? `${branch} (${tracking})` : branch;
			const output = `Repository: ${root}\nBranch: ${branchDisplay}\n${summary}\n\n${status || "(clean)"}`;

			return {
				content: [{ type: "text", text: output }],
				details: {
					branch,
					tracking: tracking || null,
					root,
					clean: fileLines.length === 0,
				},
			};
		},
	});
}
