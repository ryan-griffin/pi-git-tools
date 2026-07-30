/**
 * Unit tests for src/validation.ts — all 11 validation functions.
 *
 * Tests cover: valid inputs, invalid inputs, boundary conditions,
 * null/undefined handling, and error message format.
 *
 * Usage: node --test test/validation.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Node 26 supports TypeScript via --experimental-strip-types.

const {
	ValidationError,
	validateGitRef,
	validateBranchName,
	validateTagName,
	validateRemoteName,
	validateGitPath,
	validateConfigKey,
	validateCommitish,
	validateRepo,
	validateRemoteUrl,
	validateSearchQuery,
	validateExcludePattern,
} = await import("../../src/validation.ts");

const { validateDestinationPath, validateCommandValue } = await import(
	"../../src/validation.ts"
);

const { validateGhHeadRef } = await import("../../src/validation.ts");

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function expectError(fn, expectedMsg) {
	try {
		fn();
		assert.fail(`Expected ValidationError: "${expectedMsg}"`);
	} catch (err) {
		assert.ok(
			err instanceof ValidationError,
			`Expected ValidationError, got ${err.constructor.name}`,
		);
		if (expectedMsg) {
			assert.ok(
				err.message.includes(expectedMsg),
				`Error message "${err.message}" should include "${expectedMsg}"`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------
describe("ValidationError", () => {
	it("is an Error subclass", () => {
		const err = new ValidationError("test");
		assert.ok(err instanceof Error);
		assert.equal(err.name, "ValidationError");
		assert.equal(err.message, "test");
	});
});

// ---------------------------------------------------------------------------
// validateGitRef
// ---------------------------------------------------------------------------
describe("validateGitRef", () => {
	it("accepts valid refs", () => {
		assert.equal(validateGitRef("main"), "main");
		assert.equal(validateGitRef("feature/x"), "feature/x");
		assert.equal(validateGitRef("v1.0"), "v1.0");
		assert.equal(validateGitRef("fix_bug-123"), "fix_bug-123");
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateGitRef(""), "must be a non-empty string");
		expectError(() => validateGitRef(null), "must be a non-empty string");
		expectError(() => validateGitRef(undefined), "must be a non-empty string");
	});

	it("rejects too-long refs", () => {
		expectError(
			() => validateGitRef("a".repeat(256)),
			"exceeds 255 characters",
		);
	});

	it("rejects double dots", () => {
		expectError(() => validateGitRef("main..feature"), "invalid format");
	});

	it("rejects starting with dot", () => {
		expectError(() => validateGitRef(".hidden"), "invalid format");
	});

	it("rejects ending with slash", () => {
		expectError(() => validateGitRef("feature/"), "invalid format");
	});

	it("rejects ending with .lock", () => {
		expectError(() => validateGitRef("main.lock"), "invalid format");
	});

	it("rejects special chars ~ ^ : * ? [ ] \\", () => {
		expectError(
			() => validateGitRef("branch~1"),
			"contains invalid characters",
		);
		expectError(
			() => validateGitRef("branch:name"),
			"contains invalid characters",
		);
		expectError(() => validateGitRef("branch*"), "contains invalid characters");
		expectError(() => validateGitRef("branch^"), "contains invalid characters");
	});

	it("accepts @ and non-ASCII in refs", () => {
		assert.equal(validateGitRef("branch@1"), "branch@1");
		assert.equal(validateGitRef("foo@bar"), "foo@bar");
		assert.equal(validateGitRef("f\u00F6\u00F6"), "f\u00F6\u00F6");
	});

	it("rejects whitespace", () => {
		expectError(
			() => validateGitRef("bad branch"),
			"contains invalid characters",
		);
		expectError(
			() => validateGitRef("branch\nname"),
			"contains invalid characters",
		);
	});

	it("rejects '.' and '..'", () => {
		expectError(() => validateGitRef("."), "invalid format");
		expectError(() => validateGitRef(".."), "invalid format");
	});

	it("accepts non-ASCII branch names", () => {
		assert.equal(validateGitRef("branch_123"), "branch_123");
		assert.equal(validateGitRef("f\u00F6\u00F6"), "f\u00F6\u00F6");
	});
});

// ---------------------------------------------------------------------------
// validateBranchName
// ---------------------------------------------------------------------------
describe("validateBranchName", () => {
	it("accepts valid branch names", () => {
		assert.equal(validateBranchName("main"), "main");
		assert.equal(validateBranchName("feature/awesome"), "feature/awesome");
		assert.equal(validateBranchName("v2.0.1"), "v2.0.1");
	});

	it("rejects branch starting with dash", () => {
		expectError(() => validateBranchName("-branch"), "invalid branch name");
	});

	it("rejects branch ending with .lock", () => {
		expectError(() => validateBranchName("heads/main.lock"), "invalid format");
	});

	it("rejects empty/invalid via validateGitRef", () => {
		expectError(() => validateBranchName(""), "must be a non-empty string");
		expectError(() => validateBranchName("bad..ref"), "invalid format");
	});

	it("accepts remote tracking refs", () => {
		assert.equal(validateBranchName("origin/main"), "origin/main");
	});
});

// ---------------------------------------------------------------------------
// validateTagName
// ---------------------------------------------------------------------------
describe("validateTagName", () => {
	it("accepts valid tag names", () => {
		assert.equal(validateTagName("v1.0.0"), "v1.0.0");
		assert.equal(validateTagName("release/2024-01"), "release/2024-01");
	});

	it("rejects invalid refs via validateGitRef", () => {
		expectError(() => validateTagName(""), "must be a non-empty string");
		expectError(
			() => validateTagName("branch^"),
			"contains invalid characters",
		);
	});
});

// ---------------------------------------------------------------------------
// validateRemoteName
// ---------------------------------------------------------------------------
describe("validateRemoteName", () => {
	it("accepts valid remote names", () => {
		assert.equal(validateRemoteName("origin"), "origin");
		assert.equal(validateRemoteName("upstream"), "upstream");
		assert.equal(validateRemoteName("my-remote_1"), "my-remote_1");
		assert.equal(validateRemoteName("gitlab.com"), "gitlab.com");
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateRemoteName(""), "must be a non-empty string");
		expectError(() => validateRemoteName(null), "must be a non-empty string");
	});

	it("rejects names with slashes or special chars", () => {
		expectError(() => validateRemoteName("bad/name"), "invalid remote name");
		expectError(() => validateRemoteName("bad@name"), "invalid remote name");
		expectError(() => validateRemoteName("bad name"), "invalid remote name");
	});

	it("rejects names longer than 50 chars", () => {
		expectError(() => validateRemoteName("a".repeat(51)), "name too long");
	});
});

// ---------------------------------------------------------------------------
// validateGitPath
// ---------------------------------------------------------------------------
describe("validateGitPath", () => {
	it("accepts valid relative paths", () => {
		assert.equal(validateGitPath("src/index.ts"), "src/index.ts");
		assert.equal(validateGitPath("path/to/file.txt"), "path/to/file.txt");
		assert.equal(validateGitPath("README.md"), "README.md");
		assert.equal(validateGitPath("a/b/c/d/e"), "a/b/c/d/e");
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateGitPath(""), "must be a non-empty string");
		expectError(() => validateGitPath(null), "must be a non-empty string");
	});

	it("rejects directory traversal", () => {
		expectError(() => validateGitPath("../outside"), "path traversal");
		expectError(() => validateGitPath("foo/../../bar"), "path traversal");
	});

	it("rejects absolute paths", () => {
		expectError(
			() => validateGitPath("/etc/passwd"),
			"path must be repository-relative",
		);
	});

	it("rejects ~ paths", () => {
		expectError(
			() => validateGitPath("~/config"),
			"path must be repository-relative",
		);
	});

	it("rejects null bytes", () => {
		expectError(() => validateGitPath("bad\0file"), "null byte");
	});

	it("rejects paths longer than 4096 chars", () => {
		expectError(() => validateGitPath("a".repeat(4097)), "path too long");
	});
});

// ---------------------------------------------------------------------------
// validateConfigKey
// ---------------------------------------------------------------------------
describe("validateConfigKey", () => {
	it("accepts valid config keys", () => {
		assert.equal(validateConfigKey("user.name"), "user.name");
		assert.equal(validateConfigKey("core.editor"), "core.editor");
		assert.equal(validateConfigKey("remote.origin.url"), "remote.origin.url");
		assert.equal(validateConfigKey("branch.main.merge"), "branch.main.merge");
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateConfigKey(""), "must be a non-empty string");
		expectError(() => validateConfigKey(null), "must be a non-empty string");
	});

	it("rejects invalid key formats", () => {
		expectError(() => validateConfigKey("nokey"), "invalid format");
		expectError(() => validateConfigKey("section..empty"), "invalid format");
		expectError(() => validateConfigKey("trailing."), "invalid format");
		expectError(() => validateConfigKey("UPPERCASE"), "invalid format");
		expectError(() => validateConfigKey("a b"), "invalid format");
	});
});

// ---------------------------------------------------------------------------
// validateCommitish
// ---------------------------------------------------------------------------
describe("validateCommitish", () => {
	it("accepts valid commit-ish references", () => {
		assert.equal(validateCommitish("abc123"), "abc123");
		assert.equal(validateCommitish("main"), "main");
		assert.equal(validateCommitish("HEAD~3"), "HEAD~3");
		assert.equal(validateCommitish("v1.0.0"), "v1.0.0");
		assert.equal(validateCommitish("feature/branch"), "feature/branch");
		assert.equal(
			validateCommitish("abc123def456abc123def456abc123def456abc123"),
			"abc123def456abc123def456abc123def456abc123",
		);
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateCommitish(""), "must be a non-empty string");
		expectError(() => validateCommitish(null), "must be a non-empty string");
	});

	it("rejects shell metacharacters", () => {
		expectError(() => validateCommitish("abc;def"), "shell metacharacters");
		expectError(() => validateCommitish("abc|def"), "shell metacharacters");
		expectError(() => validateCommitish("abc`def"), "shell metacharacters");
		expectError(() => validateCommitish("$(whoami)"), "shell metacharacters");
		expectError(() => validateCommitish("abc>def"), "shell metacharacters");
		expectError(() => validateCommitish("abc<def"), "shell metacharacters");
	});

	it("rejects too-long refs", () => {
		expectError(() => validateCommitish("a".repeat(256)), "too long");
	});

	it("rejects option-like commit-ish values", () => {
		expectError(
			() => validateCommitish("--exec=touch /tmp/x"),
			"may not start with '-'",
		);
		expectError(
			() => validateCommitish("--output=/tmp/f"),
			"may not start with '-'",
		);
		expectError(() => validateCommitish("--abort"), "may not start with '-'");
		expectError(
			() => validateCommitish("--format=%H"),
			"may not start with '-'",
		);
	});

	it("rejects control characters in commit-ish", () => {
		expectError(
			() => validateCommitish("abc\u0000def"),
			"contains invalid characters",
		);
	});
});

// ---------------------------------------------------------------------------
// validateRepo
// ---------------------------------------------------------------------------
describe("validateRepo", () => {
	it("accepts valid owner/repo", () => {
		assert.equal(validateRepo("owner/repo"), "owner/repo");
		assert.equal(validateRepo("my-org/my-repo"), "my-org/my-repo");
		assert.equal(validateRepo("org123/repo_123"), "org123/repo_123");
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateRepo(""), "must be a non-empty string");
		expectError(() => validateRepo(null), "must be a non-empty string");
	});

	it("rejects invalid formats", () => {
		expectError(() => validateRepo("only-owner"), "invalid format");
		expectError(() => validateRepo("owner/repo/extra"), "invalid format");
		expectError(() => validateRepo("owner/repo!@#"), "invalid format");
		expectError(() => validateRepo("/repo"), "invalid format");
	});
});

// ---------------------------------------------------------------------------
// validateRemoteUrl
// ---------------------------------------------------------------------------
describe("validateRemoteUrl", () => {
	it("accepts HTTPS URLs", () => {
		assert.equal(
			validateRemoteUrl("https://github.com/owner/repo.git"),
			"https://github.com/owner/repo.git",
		);
		assert.equal(
			validateRemoteUrl("http://example.com/path"),
			"http://example.com/path",
		);
	});

	it("accepts SSH (git@host:path) URLs", () => {
		assert.equal(
			validateRemoteUrl("git@github.com:owner/repo.git"),
			"git@github.com:owner/repo.git",
		);
		assert.equal(
			validateRemoteUrl("git@gitlab.com:org/project.git"),
			"git@gitlab.com:org/project.git",
		);
	});

	it("accepts ssh:// and git:// protocol URLs", () => {
		assert.equal(
			validateRemoteUrl("ssh://git@host:22/path"),
			"ssh://git@host:22/path",
		);
		assert.equal(
			validateRemoteUrl("git://host/repo.git"),
			"git://host/repo.git",
		);
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateRemoteUrl(""), "must be a non-empty string");
		expectError(() => validateRemoteUrl(null), "must be a non-empty string");
	});

	it("rejects shell metacharacters and null bytes", () => {
		expectError(() => validateRemoteUrl("bad;echo"), "invalid characters");
		expectError(() => validateRemoteUrl("url|pipe"), "invalid characters");
		expectError(() => validateRemoteUrl("bad\0url"), "null byte");
	});

	it("accepts local filesystem paths and file://", () => {
		assert.equal(validateRemoteUrl("/absolute/path"), "/absolute/path");
		assert.equal(validateRemoteUrl("./relative/path"), "./relative/path");
		assert.equal(validateRemoteUrl("../parent/repo"), "../parent/repo");
		assert.equal(
			validateRemoteUrl("file:///path/to/repo"),
			"file:///path/to/repo",
		);
	});
});

// ---------------------------------------------------------------------------
// validateSearchQuery
// ---------------------------------------------------------------------------
describe("validateSearchQuery", () => {
	it("accepts valid search queries", () => {
		assert.equal(validateSearchQuery("react hooks"), "react hooks");
		assert.equal(
			validateSearchQuery("is:issue label:bug"),
			"is:issue label:bug",
		);
		assert.equal(
			validateSearchQuery("org:my-org language:go"),
			"org:my-org language:go",
		);
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateSearchQuery(""), "must be a non-empty string");
		expectError(() => validateSearchQuery(null), "must be a non-empty string");
	});

	it("rejects shell metacharacters", () => {
		expectError(
			() => validateSearchQuery("query; rm -rf /"),
			"invalid characters",
		);
		expectError(
			() => validateSearchQuery("$(cat /etc/passwd)"),
			"invalid characters",
		);
	});

	it("rejects too-long queries", () => {
		expectError(() => validateSearchQuery("a".repeat(1001)), "too long");
	});
});

// ---------------------------------------------------------------------------
// validateExcludePattern
// ---------------------------------------------------------------------------
describe("validateExcludePattern", () => {
	it("accepts valid patterns", () => {
		assert.equal(validateExcludePattern("*.log"), "*.log");
		assert.equal(validateExcludePattern("build/"), "build/");
		assert.equal(validateExcludePattern(".DS_Store"), ".DS_Store");
	});

	it("rejects null/undefined/empty", () => {
		expectError(() => validateExcludePattern(""), "must be a non-empty string");
		expectError(
			() => validateExcludePattern(null),
			"must be a non-empty string",
		);
	});

	it("rejects shell metacharacters", () => {
		expectError(() => validateExcludePattern("rm -rf;"), "invalid characters");
		expectError(
			() => validateExcludePattern("$(whoami)"),
			"invalid characters",
		);
	});
});

// ---------------------------------------------------------------------------
// validateDestinationPath
// ---------------------------------------------------------------------------
describe("validateDestinationPath", () => {
	it("accepts absolute and relative destinations", () => {
		assert.equal(validateDestinationPath("/tmp/clone"), "/tmp/clone");
		assert.equal(validateDestinationPath("relative/path"), "relative/path");
		assert.equal(validateDestinationPath("./foo"), "./foo");
	});

	it("rejects empty / null", () => {
		expectError(
			() => validateDestinationPath(""),
			"must be a non-empty string",
		);
		expectError(
			() => validateDestinationPath(null),
			"must be a non-empty string",
		);
	});

	it("rejects option-like destinations", () => {
		expectError(
			() => validateDestinationPath("--help"),
			"may not start with '-'",
		);
		expectError(() => validateDestinationPath("-x"), "may not start with '-'");
	});

	it("rejects control characters", () => {
		expectError(
			() => validateDestinationPath("a\u0000b"),
			"control characters",
		);
	});

	it("rejects paths longer than 4096 chars", () => {
		expectError(
			() => validateDestinationPath("a".repeat(4097)),
			"path too long",
		);
	});
});

// ---------------------------------------------------------------------------
// validateGhHeadRef
// ---------------------------------------------------------------------------
describe("validateGhHeadRef", () => {
	it("accepts plain branch names", () => {
		assert.equal(validateGhHeadRef("feature/x"), "feature/x");
		assert.equal(validateGhHeadRef("main"), "main");
	});

	it("accepts cross-repo owner:branch heads", () => {
		assert.equal(validateGhHeadRef("octocat:feature/x"), "octocat:feature/x");
		assert.equal(validateGhHeadRef("my-org:main"), "my-org:main");
	});

	it("rejects empty/null", () => {
		expectError(() => validateGhHeadRef(""), "must be a non-empty string");
		expectError(() => validateGhHeadRef(null), "must be a non-empty string");
	});

	it("rejects malformed owner:branch forms", () => {
		expectError(() => validateGhHeadRef(":branch"), "invalid format");
		expectError(
			() => validateGhHeadRef("owner:branch:extra"),
			"invalid format",
		);
		expectError(() => validateGhHeadRef("bad owner:x"), "invalid owner");
		expectError(() => validateGhHeadRef("-owner:x"), "invalid owner");
		expectError(() => validateGhHeadRef("owner:--flag"), "invalid branch name");
		expectError(() => validateGhHeadRef("owner:bad..name"), "invalid format");
	});
});

// ---------------------------------------------------------------------------
// validateCommandValue
// ---------------------------------------------------------------------------
describe("validateCommandValue", () => {
	it("accepts normal values", () => {
		assert.equal(validateCommandValue("blob:none"), "blob:none");
		assert.equal(validateCommandValue("ort"), "ort");
		assert.equal(validateCommandValue("ours"), "ours");
	});

	it("rejects option-like values", () => {
		expectError(() => validateCommandValue("--help"), "may not start with '-'");
		expectError(() => validateCommandValue("-s"), "may not start with '-'");
	});

	it("rejects empty", () => {
		expectError(() => validateCommandValue(""), "must be a non-empty string");
	});

	it("rejects control characters", () => {
		expectError(() => validateCommandValue("a\u0000b"), "control characters");
	});
});
