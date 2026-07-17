import { describe, expect, it } from "vitest";
import { LEGACY_CODER_PROJECT_SOURCE, type ProjectSource } from "./discover.js";
import { LEGACY_MANAGER_LOG_COMPONENT } from "./logger.js";
import { createBossTools } from "./tools.js";
import { TRUNCATION_MARKER } from "./truncate-tool-results.js";

describe("Kleio Manager machine compatibility", () => {
  it("retains project-source, logger, and persisted truncation values byte-for-byte", () => {
    const projectSource: ProjectSource = LEGACY_CODER_PROJECT_SOURCE;
    expect(projectSource).toBe("ggcoder");
    expect(LEGACY_MANAGER_LOG_COMPONENT).toBe("gg-boss");
    expect(TRUNCATION_MARKER).toBe("[[gg-boss:truncated]]");
  });

  it("retains every Manager tool name byte-for-byte", () => {
    expect(
      createBossTools({ workers: new Map(), lastSummaries: new Map() }).map((tool) => tool.name),
    ).toEqual([
      "list_workers",
      "get_worker_status",
      "prompt_worker",
      "get_worker_summary",
      "get_worker_activity",
      "cancel_worker",
      "reset_worker",
    ]);
  });
});
