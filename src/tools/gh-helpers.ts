/**
 * pi-git-tools — Shared GitHub CLI helpers.
 *
 * These are used by gh_* tool registrations.
 */
import { run } from "../utils.js";
import { validateRepo } from "../validation.js";

export async function requireGh(repoRoot?: string, signal?: AbortSignal) {
	try {
		await run("gh", ["--version"], undefined, undefined, signal);
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new Error(
			"GitHub CLI (gh) is not installed or not in PATH. Install it from https://cli.github.com/",
		);
	}
	// Check auth status silently — only fail if there's a real problem.
	// No -h flag: checks the active host (works for GitHub Enterprise hosts too).
	try {
		await run("gh", ["auth", "status"], repoRoot, undefined, signal);
	} catch (err: unknown) {
		if (signal?.aborted) throw err;
		if (
			err instanceof Error &&
			(err.message.includes("not logged in") ||
				err.message.includes("auth login"))
		) {
			throw err;
		}
		// Other errors (e.g. no network, rate limit) are non-fatal — gh may still work partially
		if (err instanceof Error) {
			console.warn(`[pi-git-tools] gh auth check warning: ${err.message}`);
		}
	}
}

export async function resolveRepo(
	target?: string,
	repoRoot?: string,
	signal?: AbortSignal,
): Promise<string> {
	if (target) return validateRepo(target, "repo");
	try {
		const remotes = await run("git", ["remote"], repoRoot, undefined, signal);
		for (const remote of remotes
			.split("\n")
			.map((name) => name.trim())
			.filter(Boolean)) {
			const remoteUrl = await run(
				"git",
				["remote", "get-url", remote],
				repoRoot,
				undefined,
				signal,
			);
			const match = remoteUrl.match(
				/(?:github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?\/?$/i,
			);
			const repo = match?.[1];
			if (repo) return validateRepo(repo, "repo");
		}
		throw new Error("No GitHub remote found.");
	} catch (err) {
		if (err instanceof Error && err.message.includes("invalid format"))
			throw err;
		throw new Error(
			"No repository specified and could not detect from git remote.",
		);
	}
}

/** Extract a display login from gh JSON author fields (object or string). */
export function formatGhAuthor(author: unknown): string {
	if (!author) return "?";
	if (typeof author === "string") return author;
	if (typeof author === "object") {
		const a = author as Record<string, unknown>;
		if (typeof a.login === "string" && a.login) return a.login;
		if (typeof a.name === "string" && a.name) return a.name;
		if (typeof a.id === "string" && a.id) return a.id;
	}
	return "?";
}
