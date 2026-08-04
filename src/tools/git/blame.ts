/**
 * pi-git-tools — git_blame tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish, validateGitPath } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_blame",
		label: "Git Blame",
		description:
			"Show line-by-line authorship for a file. Optionally limit to a line range or blame at a specific revision.",
		promptSnippet: "Blame a file",
		parameters: Type.Object(
			{
				path: Type.String({
					description: "File path to blame (relative to repo root).",
				}),
				ref: Type.Optional(
					Type.String({
						description: "Revision to blame at (default: working tree / HEAD).",
					}),
				),
				lineStart: Type.Optional(
					Type.Integer({
						description: "Start line (1-based) for a ranged blame.",
						minimum: 1,
					}),
				),
				lineEnd: Type.Optional(
					Type.Integer({
						description: "End line (1-based, inclusive) for a ranged blame.",
						minimum: 1,
					}),
				),
				ignoreWhitespace: Type.Optional(
					Type.Boolean({
						description: "Ignore whitespace changes.",
					}),
				),
				detectMoves: Type.Optional(
					Type.Boolean({
						description: "Detect moved lines within or across files.",
					}),
				),
				detectCopies: Type.Optional(
					Type.Boolean({
						description: "Detect lines moved/copied from other files.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);
			validateGitPath(params.path, "blame path");
			if (params.ref) validateCommitish(params.ref, "blame ref");
			if (
				typeof params.lineStart === "number" &&
				typeof params.lineEnd === "number" &&
				params.lineEnd < params.lineStart
			) {
				throw new Error("'lineEnd' must be >= 'lineStart'.");
			}

			const args = ["blame", "--date=short"];
			if (params.ignoreWhitespace) args.push("-w");
			if (params.detectCopies) args.push("-C");
			if (params.detectMoves) args.push("-M");
			if (typeof params.lineStart === "number") {
				const end =
					typeof params.lineEnd === "number"
						? params.lineEnd
						: params.lineStart;
				args.push("-L", `${params.lineStart},${end}`);
			} else if (typeof params.lineEnd === "number") {
				args.push("-L", `1,${params.lineEnd}`);
			}
			if (params.ref) args.push(params.ref);
			args.push("--", params.path);

			const output = await run("git", args, root, undefined, _signal);
			return {
				content: [{ type: "text", text: output || "(no blame output)" }],
				details: {
					path: params.path,
					ref: params.ref || null,
					lineStart: params.lineStart ?? null,
					lineEnd: params.lineEnd ?? null,
					ignoreWhitespace: Boolean(params.ignoreWhitespace),
					detectMoves: Boolean(params.detectMoves),
					detectCopies: Boolean(params.detectCopies),
				},
			};
		},
	});
}
