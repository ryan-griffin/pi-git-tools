/**
 * pi-git-tools — gh-helpers tests.
 *
 * Covers githubRepoFromRemote (host-aware remote URL parsing), resolveRepo
 * (repo auto-detection from git remotes), including lookalike-host rejection
 * (evilgithub.com etc.) that the previous substring regex got wrong, and
 * requireGh (gh availability + auth checks, timeout preservation).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { describe, it } from "node:test";
import { assert, execFileSync, resolve, tmpdir } from "../helpers.mjs";

const { githubRepoFromRemote, requireGh, resolveRepo } = await import(
	"../../src/tools/gh-helpers.ts"
);

describe("githubRepoFromRemote", () => {
	const accepts = [
		["https://github.com/acme/project.git", "acme/project"],
		["http://github.com/acme/project", "acme/project"],
		["ssh://git@github.com/acme/project.git", "acme/project"],
		["ssh://github.com/acme/project.git", "acme/project"],
		["git://github.com/acme/project.git", "acme/project"],
		["git@github.com:acme/project.git", "acme/project"],
		["github.com:acme/project.git", "acme/project"],
		["https://www.github.com/acme/project.git", "acme/project"],
		["HTTPS://GITHUB.COM/acme/project.git", "acme/project"],
		["https://github.com/acme/project", "acme/project"],
		["https://github.com/acme/project.git/", "acme/project"],
		["https://github.com/acme/project.git?x=1", "acme/project"],
		["https://github.com:443/acme/project.git", "acme/project"],
		["https://github.com/acme/foo.bar", "acme/foo.bar"],
		["https://github.com/acme/foo.GIT", "acme/foo"],
		["https://github.com/acme/project.git ", "acme/project"],
		["https://github.com./acme/project.git", "acme/project"],
		// Percent-encoded dots in the host: git/libcurl decode them exactly like
		// the WHATWG parser, so the remote genuinely reaches github.com.
		["https://github%2ecom/acme/project.git", "acme/project"],
		["https://evil.com@github.com/acme/project.git", "acme/project"],
		["ssh://git@github.com:2222/acme/project.git", "acme/project"],
		["git@www.github.com:acme/project.git", "acme/project"],
		["GIT@GITHUB.COM:acme/project.git", "acme/project"],
		["a@b@github.com:acme/project.git", "acme/project"],
	];
	for (const [url, expected] of accepts) {
		it(`resolves ${url}`, () => {
			assert.equal(githubRepoFromRemote(url), expected);
		});
	}

	const rejects = [
		"",
		"   ",
		"not a url",
		"https://evilgithub.com/acme/project.git",
		"git@evilgithub.com:acme/project.git",
		"https://notgithub.com/acme/project.git",
		"https://my-github.com/acme/project.git",
		"https://github.com.evil.com/acme/project.git",
		"https://github.com.cn/acme/project.git",
		"https://gitlab.com/acme/project.git",
		"ssh://git@gitlab.com/acme/project.git",
		"https://ghe.example.com/acme/project.git",
		"git@ghe.example.com:acme/project.git",
		"https://github.example.com/acme/project.git",
		"https://github.com/acme/project/tree/main",
		"https://github.com/acme",
		"https://github.com/",
		"https://github.com/acme/..",
		"https://github.com/acme/..git",
		"https://github.com/acme/...git",
		"https://github.com/acme/....git",
		"C:\\foo\\bar",
		"git@github.com:",
		// OpenSSH does not percent-decode hosts in scp-like URLs, so this
		// remote would reach the literal host "github%2ecom" — not github.com.
		"git@github%2ecom:acme/project.git",
		"https://github.com@evil.com/acme/project.git",
		"https://github.com/acme/.git",
		"https://github.com%2eevil.com/acme/project.git",
		"https://github.com..acme/project.git",
		"https://api.github.com/acme/project.git",
	];
	for (const url of rejects) {
		it(`rejects ${url}`, () => {
			assert.equal(githubRepoFromRemote(url), null);
		});
	}

	it("rejects a host with an embedded newline", () => {
		// The WHATWG URL parser strips ASCII LF, which would make this parse as
		// github.com; the control-character check must run before parsing.
		assert.equal(
			githubRepoFromRemote("https://git\nhub.com/acme/project.git"),
			null,
		);
	});
});

describe("resolveRepo", () => {
	/** Create an empty git repo with a remote-adding helper. */
	function makeRepo() {
		const repoPath = mkdtempSync(resolve(tmpdir(), "pi-git-tools-test-"));
		execFileSync("git", ["init", "-q"], { cwd: repoPath });
		return {
			repoPath,
			addRemote(name, url) {
				execFileSync("git", ["remote", "add", name, url], {
					cwd: repoPath,
				});
			},
			cleanup() {
				try {
					rmSync(repoPath, { recursive: true, force: true });
				} catch {
					/* ok */
				}
			},
		};
	}

	it("resolves a github.com origin", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("origin", "https://github.com/acme/project.git");
			assert.equal(await resolveRepo(undefined, repo.repoPath), "acme/project");
		} finally {
			repo.cleanup();
		}
	});

	it("skips lookalike hosts and resolves the real github.com remote", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("evil", "https://evilgithub.com/acme/evil.git");
			repo.addRemote("upstream", "git@github.com:real/thing.git");
			assert.equal(await resolveRepo(undefined, repo.repoPath), "real/thing");
		} finally {
			repo.cleanup();
		}
	});

	it("skips non-GitHub remotes before the real github.com remote", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("gitlab", "https://gitlab.com/acme/project.git");
			repo.addRemote("origin", "https://github.com/acme/project.git");
			assert.equal(await resolveRepo(undefined, repo.repoPath), "acme/project");
		} finally {
			repo.cleanup();
		}
	});

	it("rejects when only lookalike hosts exist (https)", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("origin", "https://evilgithub.com/acme/evil.git");
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath),
				(err) => err.message.includes("could not detect from git remote"),
			);
		} finally {
			repo.cleanup();
		}
	});

	it("rejects when only lookalike hosts exist (scp-like)", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("origin", "git@evilgithub.com:acme/evil.git");
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath),
				(err) => err.message.includes("could not detect from git remote"),
			);
		} finally {
			repo.cleanup();
		}
	});

	it("rejects when only non-GitHub remotes exist", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("origin", "https://gitlab.com/acme/project.git");
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath),
				(err) => err.message.includes("could not detect from git remote"),
			);
		} finally {
			repo.cleanup();
		}
	});

	it("rejects when no remotes exist", async () => {
		const repo = makeRepo();
		try {
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath),
				(err) => err.message.includes("could not detect from git remote"),
			);
		} finally {
			repo.cleanup();
		}
	});

	it("passes an explicit target through validation", async () => {
		assert.equal(await resolveRepo("acme/project"), "acme/project");
	});

	it("skips a malformed github.com remote and resolves a later valid one", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("origin", "https://github.com/acme/foo%20bar.git");
			repo.addRemote("upstream", "git@github.com:real/thing.git");
			assert.equal(await resolveRepo(undefined, repo.repoPath), "real/thing");
		} finally {
			repo.cleanup();
		}
	});

	it("reports the generic message when an auto-detected remote fails validation", async () => {
		const repo = makeRepo();
		try {
			// "foo%20bar" passes githubRepoFromRemote (URL keeps %20 in the
			// pathname) but fails validateRepo's charset — without an explicit
			// target the error must be the generic message, not an "invalid
			// format" error naming a repo field the user never supplied.
			repo.addRemote("origin", "https://github.com/acme/foo%20bar.git");
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath),
				(err) => err.message.includes("could not detect from git remote"),
			);
		} finally {
			repo.cleanup();
		}
	});

	it("rejects an explicit host-prefixed target (GHES unsupported)", async () => {
		await assert.rejects(
			() => resolveRepo("ghe.example.com/org/repo"),
			(err) => err.message.includes("invalid format"),
		);
	});

	it("rethrows cancellation instead of the generic message", async () => {
		const repo = makeRepo();
		try {
			repo.addRemote("origin", "https://github.com/acme/project.git");
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath, AbortSignal.abort()),
				(err) => err.message.includes("timed out or was cancelled"),
			);
		} finally {
			repo.cleanup();
		}
	});

	it("preserves timeout errors instead of the generic message", async () => {
		const repo = makeRepo();
		const original = process.env.PI_GIT_TOOLS_TIMEOUT_MS;
		process.env.PI_GIT_TOOLS_TIMEOUT_MS = "1";
		try {
			repo.addRemote("origin", "https://github.com/acme/project.git");
			await assert.rejects(
				() => resolveRepo(undefined, repo.repoPath),
				(err) => err.message.includes("timed out or was cancelled"),
			);
		} finally {
			repo.cleanup();
			if (original === undefined) {
				delete process.env.PI_GIT_TOOLS_TIMEOUT_MS;
			} else {
				process.env.PI_GIT_TOOLS_TIMEOUT_MS = original;
			}
		}
	});
});

describe("requireGh", () => {
	/** Run fn with PI_GIT_TOOLS_TIMEOUT_MS set to ms, then restore it. */
	async function withTimeoutMs(ms, fn) {
		const original = process.env.PI_GIT_TOOLS_TIMEOUT_MS;
		process.env.PI_GIT_TOOLS_TIMEOUT_MS = String(ms);
		try {
			await fn();
		} finally {
			if (original === undefined) {
				delete process.env.PI_GIT_TOOLS_TIMEOUT_MS;
			} else {
				process.env.PI_GIT_TOOLS_TIMEOUT_MS = original;
			}
		}
	}

	/** Run fn with GH_TOKEN set to token, then restore it. */
	async function withToken(token, fn) {
		const original = process.env.GH_TOKEN;
		process.env.GH_TOKEN = token;
		try {
			await fn();
		} finally {
			if (original === undefined) {
				delete process.env.GH_TOKEN;
			} else {
				process.env.GH_TOKEN = original;
			}
		}
	}

	it("reports a timeout as a timeout, not as a missing gh", async () => {
		await withTimeoutMs(1, async () => {
			await assert.rejects(
				() => requireGh(),
				(err) =>
					err.message.includes("timed out or was cancelled") &&
					!err.message.includes("not installed"),
			);
		});
	});

	it("propagates host cancellation as an execution failure", async () => {
		await assert.rejects(
			() => requireGh(undefined, AbortSignal.abort()),
			(err) => err.message.includes("timed out or was cancelled"),
		);
	});

	it("fails fast when the configured token is invalid", async () => {
		await withToken("invalid-token", async () => {
			await assert.rejects(
				() => requireGh(),
				(err) =>
					err.message.includes("token") && err.message.includes("invalid"),
			);
		});
	});

	it("returns normally when gh is installed and authenticated", async () => {
		await requireGh();
	});
});
