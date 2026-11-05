import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readGitState } from "./git-target.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readGitState", () => {
  it("falls back on each part for a folder that is not a repo", async () => {
    // `git status` fails outside a repo; that must read as 0, not reject the whole state.
    const cwd = await mkdtemp(path.join(tmpdir(), "gg-git-target-plain-"));
    tempDirs.push(cwd);
    expect(await readGitState(cwd)).toMatchObject({
      branch: null,
      isRepo: false,
      dirtyFileCount: 0,
      gitHubSlug: null,
    });
  });
});
