// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UpdateInfo } from "./update";
import { UpdateBanner } from "./UpdateBanner";

afterEach(cleanup);

const info = (over: Partial<UpdateInfo>): UpdateInfo => ({
  update: null,
  version: "2.1.1",
  phase: "idle",
  progress: null,
  install: vi.fn(async () => {}),
  ...over,
});

describe("UpdateBanner", () => {
  it("offers a waiting update, and installs it on click", () => {
    const update = info({ phase: "available" });
    render(<UpdateBanner update={update} />);
    const banner = screen.getByRole("button", { name: /Kleio just got an update!/ });
    expect(banner.title).toBe("Update to 2.1.1 — installs and restarts Kleio");
    fireEvent.click(banner);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("turns into the download's progress while installing", () => {
    render(<UpdateBanner update={info({ phase: "installing", progress: 42 })} />);
    const bar = screen.getByRole("progressbar", { name: "Downloading update" });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(bar.textContent).toBe("42%");
  });

  it.each(["idle", "checking", "error"] as const)("shows nothing while %s", (phase) => {
    const { container } = render(<UpdateBanner update={info({ phase })} />);
    expect(container.innerHTML).toBe("");
  });
});
