import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const buildStep =
  workflow
    .split(/(?=^ {6}- )/m)
    .find((step) => /^ {6}- name: Build framework packages\r?$/m.test(step)) ?? "";

describe("release framework build", () => {
  it("builds all retained packages in dependency order", () => {
    const commands = buildStep.match(/^ {10}pnpm --filter .+$/gm)?.map((line) => line.trim());
    expect(commands).toEqual([
      "pnpm --filter @kleio/ai build",
      "pnpm --filter @kleio/agent build",
      "pnpm --filter @kleio/core build",
      "pnpm --filter @kenkaiiii/gg-pixel build",
      "pnpm --filter @kleio/coder build",
      "pnpm --filter @kleio/manager build",
    ]);
  });

  it("guards every publication job against running in the fork", () => {
    const jobs = workflow.split(/^jobs:\s*$/m)[1];
    expect(jobs).toBeDefined();
    const sections = jobs.split(/(?=^ {2}[a-zA-Z][\w-]*:\s*$)/m).filter((part) => part.trim());
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section).toMatch(/^ {4}if: github\.repository == 'KenKaiii\/gg-framework'\s*$/m);
    }
  });

  it("uses bash so intermediate failures stop Windows releases", () => {
    expect(buildStep).toMatch(/^ {8}shell: bash\s*$/m);
  });
});
