# pi-git-tools

Git and GitHub CLI tools for the [pi](https://github.com/earendil-works/pi-coding-agent) coding agent.

Provides 33 typed, validated tools covering git porcelain operations and `gh` CLI commands — all executed through `execFile` with no shell interpolation. Every tool is designed agent-first while following modern git workflows.

## Design principles

These tools are curated interfaces for an agent, not mirrors of the git command line. Every tool and parameter is judged against the same criteria:

- **Agent-first** — A parameter must earn its place: it must change what git does, filter what the agent sees, or make the output smaller. Flags that are redundant, dangerous without precision, or purely cosmetic are not offered.
- **Modern git, when simple** — Follow where git itself has moved, and avoid legacy usage git has superseded. Keep deliberate exceptions only when they enable a workflow with no clean alternative.
- **Output is the product** — Tool output is what the agent reasons over. Flags that shrink output usefully are kept; flags that discard it are not.
- **Safety by construction** — Interactive and editor-driven flags cannot work headlessly; destructive operations require precise, explicit forms rather than broad ones. Where a choice is forced, the safe variant is the default.

## Requirements

- **git** ≥ 2.30 (uses `switch`, `restore`, `--porcelain`)
- **gh** (GitHub CLI) — required for `gh_pr`, `gh_issue`, `gh_repo`, `gh_search`, `gh_api`

Install `gh`: <https://cli.github.com/> and authenticate with `gh auth login`.

## Tools

### Git (27 tools)

| Tool                 | Actions / purpose                                                           |
| -------------------- | --------------------------------------------------------------------------- |
| `git_status`         | Working tree state (porcelain + summary, detached HEAD, ahead/behind)       |
| `git_diff`           | Diff with refs/ranges, path filter, context lines, stats                    |
| `git_log`            | Commit history (oneline/full/detailed, filter by author/date/path)          |
| `git_branch`         | List, create, delete, rename, switch (with track, startPoint, checkout)     |
| `git_commit`         | Stage paths, commit, amend (`--no-edit` safe), signoff                      |
| `git_add`            | Stage paths, `-A`/`-u`/`-N`/`-f`                                            |
| `git_apply`          | Apply patches (--3way, --reverse, --check, --cached)                        |
| `git_worktree`       | List, add, remove, prune, lock, unlock                                      |
| `git_stash`          | List, push (with paths), pop, apply, drop, show                             |
| `git_clone`          | Clone (depth, branch, filter, submodules)                                   |
| `git_fetch`          | Fetch with prune, depth, remote/branch                                      |
| `git_init`           | Create repo (bare, initial branch, object/ref format)                       |
| `git_merge`          | Merge branch, continue, abort (`--no-ff`, `--squash`, `--ff-only`)          |
| `git_rebase`         | Rebase onto, continue, abort, skip (autosquash)                             |
| `git_reset`          | Soft/mixed/hard/keep; file-level unstage/discard via `git_restore`          |
| `git_restore`        | Restore files from index/source, ours/theirs, staged, worktree              |
| `git_pull`           | Pull with rebase, ff-only, autostash                                        |
| `git_push`           | Push, force-with-lease, delete branch, tags, dry-run                        |
| `git_tag`            | List, create (light/annotated), delete, verify                              |
| `git_cherry_pick`    | Pick commits, continue, abort, skip                                         |
| `git_revert`         | Revert commit, continue, abort                                              |
| `git_clean`          | Remove untracked files (dry-run, force, directories, exclude)               |
| `git_remote`         | List, add, remove, rename, set-url, get-url                                 |
| `git_reflog`         | Reflog (limit, ref, all, custom format)                                     |
| `git_config`         | Get, set, add, unset, unset-all, remove-section, list (local/global/system) |
| `git_show`           | Show commit/tag metadata and patch                                          |
| `git_blame`          | Line-by-line authorship, range support                                      |
| `git_tools_activate` | Loader: activate lazy tools/groups (see below)                              |

### GitHub (5 tools)

| Tool        | Actions / purpose                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh_pr`     | List, view, create (incl. `--fill`, fork heads), edit, checkout, merge (`--delete-branch`), close (`--comment`), reopen, comment, review, diff, checks, ready |
| `gh_issue`  | List, view, create, edit, close (`--comment`), reopen, comment                                                                                                |
| `gh_repo`   | View info, list branches, list languages, open in browser                                                                                                     |
| `gh_search` | Search repos, issues, PRs, code, commits                                                                                                                      |
| `gh_api`    | Any REST endpoint (method, JSON data, query params, jq field, paginate)                                                                                       |

## Dynamic tool loading

To keep the model context lean, not every tool is active by default. All 33 tools are always registered (tests and introspection see them), but 19 of them — the `git-advanced` group (`git_apply`, `git_blame`, `git_cherry_pick`, `git_clean`, `git_clone`, `git_config`, `git_init`, `git_merge`, `git_rebase`, `git_reflog`, `git_revert`, `git_stash`, `git_tag`, `git_worktree`) and the `gh` group (`gh_api`, `gh_issue`, `gh_pr`, `gh_repo`, `gh_search`) — are removed from the active set at session start, saving ~5.3k tokens of tool schemas per turn (their definitions stay lazily available; Anthropic ≥ 4.5 and OpenAI gpt-5.4+ models get them via native deferred loading at the loader's tool-result position, other models via the full active list).

The always-active **`git_tools_activate`** loader re-enables them:

```text
git_tools_activate({ tools: ["git_apply", "gh_pr"], group: "gh" })
```

- `tools` — exact lazy tool names (see the loader's description for the catalog)
- `group` — one or more groups: `"gh"` or `["git-advanced", "gh"]` (all tools in the group(s))
- At least one of the two is required; activation is additive (never drops active tools) and takes effect on the next turn.

Individual tools are the token-optimal choice (activation is sticky for the session, so a whole group costs its full schema weight every turn after). Groups are for when the task will use several tools from a category and the exact set isn't worth predicting.

## Configuration

Environment variables:

| Variable                  | Default           | Description                                                                                                                                                                                           |
| ------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI_GIT_TOOLS_TIMEOUT_MS` | `600000` (10 min) | Per-command timeout in milliseconds. Invalid, zero, negative, or non-integer values use the default.                                                                                                  |
| `PI_GIT_TOOLS_ACTIVE`     | unset             | Comma-separated tool/group names to keep active from session start (`git-advanced`, `gh`, specific tool names, or `all`). Default: 13 core git tools active; the rare-git and GitHub groups are lazy. |

## Output truncation

All tool results are truncated to **2000 lines or 50 KB** (whichever is hit first), per pi's output contract for custom tools:

- The full output is saved to a temp file, and the result text includes a `[Output truncated: ...]` footer with the file path, so the model can read the complete output when needed.
- The truncation stats (`TruncationResult`) and the full-output path are also available in `details.truncation` and `details.fullOutputPath`.
- Error messages from git/gh are capped the same way (tail-first, so the fatal line survives); full stderr remains on the `CommandError` object.
- Temp output files are removed at session shutdown.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run check         # biome check
npm run format        # biome format --write
npm run test          # integration + unit tests
npm run test:smoke    # structural smoke test
npm run precommit     # all of the above
```

## Safety design

- **No shell**: All commands run through `child_process.execFile` with argument arrays
- **GIT_TERMINAL_PROMPT=0**: Never hangs on auth prompts
- **GIT_EDITOR=true**: Blocks editor prompts in headless mode (`--no-edit` for amend/revert); callers cannot override safety-critical prompt/editor variables
- **GH_PROMPT_DISABLED=1**: Blocks interactive gh prompts
- **Input validation**: refs, paths, config keys, remote URLs, search queries, destinations, and command values are validated before execution; option-like values are rejected
- **Action-scoped params**: every tool with an `action` parameter rejects parameters that don't apply to the requested action (e.g. `title` with `action=close`) instead of silently ignoring them; the error names the actions where each parameter is valid
- **Repository-relative paths**: Git file paths reject traversal and absolute paths; clone/worktree destinations may be absolute but may not begin with `-`
- **GitHub numbers**: PR and issue numbers must be positive safe integers
- **Per-command timeout**: All commands have a configurable 10-minute timeout via `AbortSignal`
- **Editor/rebase/edit flags**: Rejected with clear error messages in agent contexts
- **GitHub remotes**: Automatic repository detection checks configured remotes for `github.com`; explicit repositories use `owner/repo` format
