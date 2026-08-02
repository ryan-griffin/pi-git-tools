/**
 * pi-git-tools — Git tool aggregator.
 *
 * Imports each git tool from its own module and registers them all
 * with the pi ExtensionAPI.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register as registerAdd } from "./tools/git/add.js";
import { register as registerApply } from "./tools/git/apply.js";
import { register as registerBlame } from "./tools/git/blame.js";
import { register as registerBranch } from "./tools/git/branch.js";
import { register as registerCherryPick } from "./tools/git/cherry_pick.js";
import { register as registerClean } from "./tools/git/clean.js";
import { register as registerClone } from "./tools/git/clone.js";
import { register as registerCommit } from "./tools/git/commit.js";
import { register as registerConfig } from "./tools/git/config.js";
import { register as registerDiff } from "./tools/git/diff.js";
import { register as registerFetch } from "./tools/git/fetch.js";
import { register as registerInit } from "./tools/git/init.js";
import { register as registerLog } from "./tools/git/log.js";
import { register as registerMerge } from "./tools/git/merge.js";
import { register as registerPull } from "./tools/git/pull.js";
import { register as registerPush } from "./tools/git/push.js";
import { register as registerRebase } from "./tools/git/rebase.js";
import { register as registerReflog } from "./tools/git/reflog.js";
import { register as registerRemote } from "./tools/git/remote.js";
import { register as registerReset } from "./tools/git/reset.js";
import { register as registerRestore } from "./tools/git/restore.js";
import { register as registerRevert } from "./tools/git/revert.js";
import { register as registerShow } from "./tools/git/show.js";
import { register as registerStash } from "./tools/git/stash.js";
import { register as registerStatus } from "./tools/git/status.js";
import { register as registerTag } from "./tools/git/tag.js";
import { register as registerWorktree } from "./tools/git/worktree.js";
import { withOutputLimits } from "./utils.js";

/** Register all git tools with the given ExtensionAPI. */
export function registerGitTools(pi: ExtensionAPI) {
	const boundedPi = withOutputLimits(pi);
	registerAdd(boundedPi);
	registerApply(boundedPi);
	registerBlame(boundedPi);
	registerBranch(boundedPi);
	registerCherryPick(boundedPi);
	registerClean(boundedPi);
	registerClone(boundedPi);
	registerCommit(boundedPi);
	registerConfig(boundedPi);
	registerDiff(boundedPi);
	registerFetch(boundedPi);
	registerInit(boundedPi);
	registerLog(boundedPi);
	registerMerge(boundedPi);
	registerPull(boundedPi);
	registerPush(boundedPi);
	registerRebase(boundedPi);
	registerRemote(boundedPi);
	registerReflog(boundedPi);
	registerReset(boundedPi);
	registerRestore(boundedPi);
	registerRevert(boundedPi);
	registerShow(boundedPi);
	registerStash(boundedPi);
	registerStatus(boundedPi);
	registerTag(boundedPi);
	registerWorktree(boundedPi);
}
