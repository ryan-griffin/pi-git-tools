/**
 * pi-git-tools — GitHub CLI tool aggregator.
 *
 * Imports each gh tool from its own module and registers them all
 * with the pi ExtensionAPI.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { register as registerApi } from "./tools/gh/api.js";
import { register as registerIssue } from "./tools/gh/issue.js";
import { register as registerPr } from "./tools/gh/pr.js";
import { register as registerRepo } from "./tools/gh/repo.js";
import { register as registerSearch } from "./tools/gh/search.js";

/** Register all gh tools with the given ExtensionAPI. */
export function registerGhTools(pi: ExtensionAPI) {
	registerApi(pi);
	registerIssue(pi);
	registerPr(pi);
	registerRepo(pi);
	registerSearch(pi);
}
