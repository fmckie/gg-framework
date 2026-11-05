import { getGitBranch, getGitDirtyFileCount, isGitRepo } from "../utils/git.js";
import { getGitHubRepoSlug } from "../utils/github.js";

export interface GitState {
  branch: string | null;
  isRepo: boolean;
  dirtyFileCount: number;
  gitHubSlug: string | null;
}

/** Read a folder's git state; each part falls back on its own when git fails. */
export async function readGitState(dir: string): Promise<GitState> {
  const [branch, isRepo, dirtyFileCount, gitHubSlug] = await Promise.all([
    getGitBranch(dir).catch(() => null),
    isGitRepo(dir).catch(() => false),
    getGitDirtyFileCount(dir).catch(() => 0),
    getGitHubRepoSlug(dir).catch(() => null),
  ]);
  return { branch, isRepo, dirtyFileCount, gitHubSlug };
}
