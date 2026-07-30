/**
 * pi-git-tools — git_diff tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish, validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_diff",
		label: "Git Diff",
		description:
			"Show the diff of changes — unstaged changes by default, or staged changes with --staged. " +
			"Supports optional path filtering, --stat, --name-only, and --word-diff. " +
			"Pass 'ref' to diff against a commit, or a range like 'main...HEAD'.",
		promptSnippet: "Show file changes",
		parameters: Type.Object({
			staged: Type.Optional(
				Type.Boolean({
					description:
						"Show staged changes (--cached) instead of unstaged changes.",
				}),
			),
			ref: Type.Optional(
				Type.String({
					description:
						"Commit-ish to diff against the working tree, or a range (e.g. 'main', 'HEAD~1', 'main..HEAD', 'main...HEAD').",
				}),
			),
			ref2: Type.Optional(
				Type.String({
					description:
						"Optional second endpoint for a two-commit diff (e.g. ref='main' ref2='feature'). Not valid with a range in 'ref'.",
				}),
			),
			path: Type.Optional(
				Type.String({
					description:
						"Optional path or glob to filter the diff (e.g. 'src/', '*.ts').",
				}),
			),
			contextLines: Type.Optional(
				Type.Integer({
					description:
						"Number of context lines (default: 3, pass 0 for minimal, -1 for full file). Use -U0 for no context, -U3 default.",
					minimum: -1,
				}),
			),
			stat: Type.Optional(
				Type.Boolean({
					description:
						"Show diffstat summary instead of the full patch (--stat).",
				}),
			),
			nameOnly: Type.Optional(
				Type.Boolean({
					description: "Show only names of changed files (--name-only).",
				}),
			),
			wordDiff: Type.Optional(
				Type.Boolean({
					description:
						"Show word-level changes instead of line-level (--word-diff).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			const ref =
				typeof params.ref === "string" && params.ref !== ""
					? params.ref
					: undefined;
			const ref2 =
				typeof params.ref2 === "string" && params.ref2 !== ""
					? params.ref2
					: undefined;
			if (ref2 && !ref) {
				throw new Error(
					"'ref2' requires 'ref' (use ref='main' ref2='feature' for a two-commit diff).",
				);
			}
			if (params.staged && ref) {
				throw new Error(
					"'staged' cannot be combined with 'ref' (git rejects --cached with commits).",
				);
			}
			if (ref) validateCommitish(ref, "diff ref");
			if (ref2) validateCommitish(ref2, "diff ref2");
			// --no-color: never leak ANSI escapes into tool output, even with
			// color.ui=always in the user's git config.
			const args = ["diff", "--no-color"];
			if (params.staged) args.push("--staged");
			if (params.stat) args.push("--stat");
			if (params.nameOnly) args.push("--name-only");
			if (params.wordDiff) args.push("--word-diff");
			if (typeof params.contextLines === "number") {
				if (params.contextLines < 0) {
					args.push("-U99999"); // full file for any negative value
				} else {
					args.push(`-U${params.contextLines}`);
				}
			}
			if (ref) args.push(ref);
			if (ref2) args.push(ref2);
			if (typeof params.path === "string" && params.path) {
				validateGitPath(params.path, "path");
				args.push("--", params.path);
			}
			const output = await run("git", args, root, undefined, _signal);

			if (!output) {
				return {
					content: [{ type: "text", text: "No changes." }],
					details: { empty: true, staged: !!params.staged },
				};
			}

			// Count changed files and lines via diff --numstat for accuracy
			// (unless name-only or stat override which changes output format)
			let files = 0;
			let insertions = 0;
			let deletions = 0;
			if (!params.nameOnly && !params.stat) {
				const numstatArgs = ["diff", "--numstat", "--no-color"];
				if (params.staged) numstatArgs.push("--staged");
				if (ref) numstatArgs.push(ref);
				if (ref2) numstatArgs.push(ref2);
				if (typeof params.path === "string" && params.path) {
					numstatArgs.push("--", params.path);
				}
				try {
					const numstat = await run(
						"git",
						numstatArgs,
						root,
						undefined,
						_signal,
					);
					if (numstat) {
						const numLines = numstat.split("\n").filter(Boolean);
						files = numLines.length;
						for (const line of numLines) {
							const parts = line.split("\t");
							if (parts.length >= 2) {
								const ins = Number.parseInt(parts[0] ?? "", 10);
								const del = Number.parseInt(parts[1] ?? "", 10);
								if (!Number.isNaN(ins)) insertions += ins;
								if (!Number.isNaN(del)) deletions += del;
							}
						}
					}
				} catch {
					// Fallback to rough counts if numstat fails
					files = output
						.split("\n")
						.filter((l) => l.startsWith("diff --git")).length;
					insertions = (output.match(/^\+(?!\+\+\s)/gm) || []).length;
					deletions = (output.match(/^-(?!--\s)/gm) || []).length;
				}
			}

			return {
				content: [{ type: "text", text: output }],
				details: {
					files,
					insertions,
					deletions,
					staged: !!params.staged,
					charCount: output.length,
				},
			};
		},
	});
}
