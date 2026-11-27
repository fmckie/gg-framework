// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GODS } from "../olympus/gods";
import { GoalStele } from "./GoalStele";
import { LAUREL_LEAVES, type Stele } from "./goal-stele";
import { copyStele } from "./stele-image";

vi.mock("./stele-image", () => ({ copyStele: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const STELE: Stele = {
  id: 8000,
  outcome: "done",
  title: "Job done",
  laurel: "12:a",
  lines: [
    {
      key: "12:a",
      god: GODS.athena,
      name: "survey",
      ending: "Done",
      status: "done",
      time: "1m 5s",
      tools: "4",
      tokens: "↑ 900 · ↓ 1.2k",
      laurel: true,
    },
    {
      key: "12:b",
      god: GODS.hermes,
      name: "Agent 2",
      ending: "Stopped",
      status: "error",
      time: "–",
      tools: "9",
      tokens: "–",
      laurel: false,
    },
  ],
  totals: [
    { label: "Time", value: "7s" },
    { label: "Workers", value: "2 (1 failed)" },
    { label: "Turns", value: "5" },
    { label: "Tokens written", value: "1.5k" },
  ],
};

describe("GoalStele", () => {
  it("carries the outcome on its cap and a line for each worker", () => {
    render(<GoalStele stele={STELE} />);
    const stele = screen.getByRole("region", { name: "Job done: each worker's account" });
    expect(stele.className).toBe("goal-stele");
    expect(stele.getAttribute("data-outcome")).toBe("done");
    expect(within(stele).getByRole("heading", { name: "Job done" }).parentElement?.className).toBe(
      "goal-stele-cap",
    );
    expect(
      within(stele)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Worker", "Ended", "Time", "Tools used", "Tokens"]);
    const rows = within(stele).getAllByRole("row").slice(1);
    expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
      ["surveyLaurels: most tools used", "Done", "1m 5s", "4", "↑ 900 · ↓ 1.2k"],
      ["Agent 2", "Stopped", "–", "9", "–"],
    ]);
    expect(rows.map((row) => row.getAttribute("data-key"))).toEqual(["12:a", "12:b"]);
    // Its row's status, which the rows' own rule dims a stopped worker's cameo by.
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["done", "error"]);
    // Each line opens with its god's cameo, as its row does: decoration.
    expect(
      rows.map((row) => row.querySelector("img.goal-worker-cameo")?.getAttribute("src")),
    ).toEqual([GODS.athena.cameo, GODS.hermes.cameo]);
    expect(rows[0]!.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("marks the crowned worker's line with a laurel, and says what for", () => {
    render(<GoalStele stele={STELE} />);
    const [crowned, other] = screen.getAllByRole("row").slice(1);
    expect(crowned!.classList.contains("is-laurel")).toBe(true);
    const mark = crowned!.querySelector("svg.goal-stele-mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelectorAll("ellipse")).toHaveLength(LAUREL_LEAVES.length);
    expect(within(crowned!).getByText("Laurels: most tools used").className).toBe(
      "goal-stele-laurel",
    );
    expect(other!.classList.contains("is-laurel")).toBe(false);
    expect(other!.querySelector(".goal-stele-mark, .goal-stele-laurel")).toBeNull();
  });

  it("repeats the finish card's totals in a last line", () => {
    render(<GoalStele stele={STELE} />);
    const totals = document.querySelector("dl.goal-stele-totals")!;
    expect([...totals.children].map((el) => el.textContent)).toEqual([
      "Time7s",
      "Workers2 (1 failed)",
      "Turns5",
      "Tokens written1.5k",
    ]);
    expect(totals.parentElement?.className).toBe("goal-stele-foot");
    expect(totals.parentElement?.previousElementSibling?.tagName).toBe("TABLE");
  });

  it("stands without a table when nobody was brought in, and crowns nobody", () => {
    render(
      <GoalStele
        stele={{ ...STELE, outcome: "failed", title: "Couldn't finish", lines: [], laurel: null }}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Couldn't finish: each worker's account" }),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No workers were brought in.")).toBeTruthy();
    expect(document.querySelector(".goal-stele-mark")).toBeNull();
    expect(screen.getByText("Tokens written")).toBeTruthy();
  });

  it("copies its picture, says Copied, then offers the copy again", async () => {
    vi.useFakeTimers();
    vi.mocked(copyStele).mockResolvedValue("copied");
    render(<GoalStele stele={STELE} />);
    const button = screen.getByRole("button", { name: "Copy as image" });
    // Beside the totals, not on the marble.
    expect(button.parentElement?.className).toBe("goal-stele-foot");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(copyStele).toHaveBeenCalledExactlyOnceWith(STELE);
    expect(button.textContent).toBe("Copied");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(button.textContent).toBe("Copy as image");
  });

  it("says so when the picture went to the image viewer instead, or nowhere", async () => {
    vi.mocked(copyStele).mockResolvedValueOnce("opened").mockResolvedValueOnce("failed");
    const { unmount } = render(<GoalStele stele={STELE} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy as image" }));
    });
    expect(screen.getByRole("button").textContent).toBe("Opened in your image viewer");
    unmount();
    render(<GoalStele stele={STELE} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy as image" }));
    });
    expect(screen.getByRole("button").textContent).toBe("Couldn't copy the picture");
  });

  it("makes one picture at a time", async () => {
    let done: (how: "copied") => void = () => undefined;
    vi.mocked(copyStele).mockReturnValue(new Promise((resolve) => (done = resolve)));
    render(<GoalStele stele={STELE} />);
    const button = screen.getByRole("button", { name: "Copy as image" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(copyStele).toHaveBeenCalledTimes(1);
    await act(async () => {
      done("copied");
    });
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.textContent).toBe("Copied");
  });
});
