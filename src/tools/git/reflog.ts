/**
 * pi-git-tools — git_reflog tool registration.
 *
 * Shows the reflog — the history of where HEAD (or another ref) has pointed,
 * including resets, checkouts, rebases, and cherry-picks. The default format
 * matches `git reflog`; a custom format or machine-readable date can be set
 * with 'format' (see gitrevisions / git-log --format placeholders).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerTool } from "../../truncate.js";
import { findRepoRoot, resolveCwd, run } from "../../utils.js";
import { validateCommitish } from "../../validation.js";

export function register(pi: ExtensionAPI) {
	registerTool(pi, {
		name: "git_reflog",
		label: "Git Reflog",
		description:
			"Show the reflog: where HEAD (or another ref) has pointed, including resets, rebases, and checkouts. Useful for recovering 'lost' commits.",
		promptSnippet: "Show reflog (recover lost commits)",
		parameters: Type.Object({
			limit: Type.Optional(
				Type.Integer({
					description: "Max reflog entries (default: 20, max: 200).",
					minimum: 1,
					maximum: 200,
				}),
			),
			ref: Type.Optional(
				Type.String({
					description:
						"Ref whose reflog to show (default: HEAD, e.g. 'main', 'HEAD@{2}').",
				}),
			),
			all: Type.Optional(
				Type.Boolean({
					description: "Show reflogs of all refs (--all).",
				}),
			),
			format: Type.Optional(
				Type.String({
					description:
						"Optional --format for each entry (git log placeholders, e.g. '%h %gd %gs'). Default: git's own reflog format.",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			const args = ["reflog", "--no-color"];
			const limit = Math.min(params.limit ?? 20, 200);
			args.push(`-n${limit}`);
			if (params.all) args.push("--all");
			if (typeof params.format === "string" && params.format) {
				if (params.format.length > 200) {
					throw new Error("'format' is too long (max 200 chars).");
				}
				args.push(`--format=${params.format}`);
			}
			if (typeof params.ref === "string" && params.ref) {
				validateCommitish(params.ref, "reflog ref");
				args.push(params.ref);
			}

			const output = await run("git", args, root, undefined, _signal);
			if (!output) {
				return {
					content: [{ type: "text", text: "No reflog entries." }],
					details: { empty: true, limit },
				};
			}
			return {
				content: [{ type: "text", text: output }],
				details: {
					count: output.split("\n").filter(Boolean).length,
					limit,
					ref: params.ref || "HEAD",
				},
			};
		},
	});
}
