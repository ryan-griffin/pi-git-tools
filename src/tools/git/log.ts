/**
 * pi-git-tools — git_log tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish, validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_log",
		label: "Git Log",
		description:
			"Show commit history with optional count, file filter, author filter, and search string.",
		promptSnippet: "Show commit history",
		parameters: Type.Object({
			count: Type.Optional(
				Type.Integer({
					description: "Number of commits to show (default: 10, max: 100).",
					minimum: 1,
					maximum: 100,
				}),
			),
			path: Type.Optional(
				Type.String({
					description: "Filter commits by file path.",
				}),
			),
			author: Type.Optional(
				Type.String({
					description: "Filter commits by author (pattern/regex accepted).",
				}),
			),
			grep: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Search commit messages for these strings (case-insensitive). Multiple entries use --all-match logic.",
				}),
			),
			branch: Type.Optional(
				Type.String({
					description:
						"Branch name, tag, or revision range (e.g. 'main', 'HEAD~5..HEAD'). Defaults to HEAD.",
				}),
			),
			format: Type.Optional(
				Type.Union(
					[
						Type.Literal("oneline"),
						Type.Literal("full"),
						Type.Literal("detailed"),
					],
					{
						description:
							"Output format: 'oneline' (default), 'full' (with diffstat), or 'detailed' (full body + date).",
					},
				),
			),
			since: Type.Optional(
				Type.String({
					description:
						"Show commits after this date (any format git accepts, e.g. '2024-01-01', '2 weeks ago', 'yesterday').",
				}),
			),
			until: Type.Optional(
				Type.String({
					description:
						"Show commits before this date (any format git accepts, e.g. '2024-06-01', '1 month ago').",
				}),
			),
			noMerges: Type.Optional(
				Type.Boolean({
					description: "Exclude merge commits from the log.",
				}),
			),
			graph: Type.Optional(
				Type.Boolean({
					description: "Show ASCII commit graph (--graph).",
				}),
			),
			all: Type.Optional(
				Type.Boolean({
					description: "Show all branches, not just the current one (--all).",
				}),
			),
			decorate: Type.Optional(
				Type.Boolean({
					description: "Show ref names (--decorate).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			const count = Math.min(params.count ?? 10, 100);
			const args = ["log", `-${count}`, "--no-color"];
			if (params.all) args.push("--all");
			if (params.decorate) args.push("--decorate=short");
			if (params.graph) args.push("--graph");

			if (params.format === "detailed") {
				// %x1e (record separator) marks the start of each commit block so
				// counting is robust against '---' lines in commit bodies and
				// --graph line prefixing. It is stripped from the output below.
				args.push("--format=format:%x1e%H%n%an <%ae>%n%ai%n%s%n%b%n---");
			} else if (params.format === "full") {
				// %C(auto) is a no-op under --no-color; the marker replaces it.
				args.push("--format=format:%x1e%h %s", "--stat");
			} else {
				args.push("--oneline");
			}

			if (params.author) args.push("--author", params.author);
			if (params.grep && params.grep.length > 0) {
				for (const pattern of params.grep) {
					args.push("--grep", pattern);
				}
				args.push("-i");
				// With multiple patterns, require ALL to match
				if (params.grep.length > 1) args.push("--all-match");
			}
			if (params.since) args.push("--since", params.since);
			if (params.until) args.push("--until", params.until);
			if (params.noMerges) args.push("--no-merges");
			if (params.branch) {
				validateCommitish(params.branch, "log branch/range");
				args.push(params.branch);
			}
			if (params.path) {
				validateGitPath(params.path, "path");
				args.push("--", params.path);
			}

			const output = await run("git", args, root, undefined, _signal);
			if (!output) {
				return {
					content: [{ type: "text", text: "No commits found." }],
					details: { empty: true },
				};
			}

			// Count commits. oneline: count lines, but with --graph only commit
			// lines carry the '*' marker (connector lines are |, \, /);
			// detailed/full: count %x1e sentinels.
			let commitCount = 0;
			if (params.format === "oneline" || !params.format) {
				const lines = output.split("\n").filter(Boolean);
				commitCount = params.graph
					? lines.filter((l) => l.includes("*")).length
					: lines.length;
			} else {
				commitCount = output.split("\x1e").length - 1;
			}

			return {
				content: [{ type: "text", text: output.replaceAll("\x1e", "") }],
				details: { count: commitCount },
			};
		},
	});
}
