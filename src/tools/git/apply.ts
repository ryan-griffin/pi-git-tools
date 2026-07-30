/**
 * pi-git-tools — git_apply tool registration.
 *
 * Applies a patch (unified diff) to the working tree, e.g. one produced by
 * git_diff or git_show -p. The patch is written to a temp file and passed to
 * `git apply` — stdin can't be used because run() never feeds the child's
 * stdin, so a piped patch would hang until the timeout.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRepoRoot, resolveCwd, run, tempInputFile } from "../../utils.js";

const MAX_PATCH_BYTES = 10 * 1024 * 1024;

export function register(pi: ExtensionAPI) {
	pi.registerTool({
		name: "git_apply",
		label: "Git Apply",
		description:
			"Apply a unified diff patch to the working tree (e.g. output from git_diff). Supports --3way, --reverse, --check (dry-run), and --cached (index only).",
		promptSnippet: "Apply a patch",
		parameters: Type.Object({
			patch: Type.String({
				description: "The unified diff text to apply (required).",
			}),
			threeway: Type.Optional(
				Type.Boolean({
					description:
						"Fall back to a 3-way merge when the patch context is stale (--3way).",
				}),
			),
			reverse: Type.Optional(
				Type.Boolean({
					description: "Apply the patch in reverse (--reverse).",
				}),
			),
			check: Type.Optional(
				Type.Boolean({
					description:
						"Dry-run: verify the patch applies without changing anything (--check).",
				}),
			),
			cached: Type.Optional(
				Type.Boolean({
					description:
						"Apply the patch to the index only, leaving the working tree untouched (--cached).",
				}),
			),
		}),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx);
			const root = await findRepoRoot(cwd, _signal);

			if (!params.patch) throw new Error("'patch' is required.");
			if (params.patch.length > MAX_PATCH_BYTES) {
				throw new Error(
					`'patch' exceeds the ${MAX_PATCH_BYTES / 1024 / 1024} MB input cap.`,
				);
			}

			const args = ["apply"];
			if (params.threeway) args.push("--3way");
			if (params.reverse) args.push("--reverse");
			if (params.check) args.push("--check");
			if (params.cached) args.push("--cached");

			const { path, cleanup } = tempInputFile("pi-git-apply", params.patch);
			try {
				args.push(path);
				const output = await run("git", args, root, undefined, _signal);
				if (params.check) {
					return {
						content: [
							{
								type: "text",
								text: output || "Patch applies cleanly.",
							},
						],
						details: { action: "check", ok: true },
					};
				}
				return {
					content: [
						{
							type: "text",
							text:
								output ||
								(params.cached
									? "Patch applied to the index."
									: "Patch applied."),
						},
					],
					details: {
						action: params.cached ? "apply-cached" : "apply",
						reversed: !!params.reverse,
						threeway: !!params.threeway,
					},
				};
			} finally {
				cleanup();
			}
		},
	});
}
