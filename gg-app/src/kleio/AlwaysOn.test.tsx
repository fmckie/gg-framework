// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AlwaysOnCard, hostRowWords, stayOnSteps } from "./AlwaysOn";
import type { AlwaysOnReason, HostKind } from "./kleioApi";

afterEach(cleanup);

function host(
  os: string,
  reasons: AlwaysOnReason[],
  state: "may_sleep" | "yes" = "may_sleep",
): HostKind {
  return { os, laptop: false, alwaysOn: { state, reasons } };
}

/** The steps as plain text, one per item. */
function stepsOf(kind: HostKind, name = "mac-mini"): string[] {
  const { container } = render(
    <ol>
      {stayOnSteps(kind, name).map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>,
  );
  return [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
}

describe("stayOnSteps", () => {
  it("lists only the Mac settings that are off, after where to find them", () => {
    const steps = stepsOf(host("darwin", ["sleeps_on_ac", "no_wake_for_network"]));
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain("System Settings, then click Energy");
    expect(steps[1]).toContain("Prevent automatic sleeping when the display is off");
    expect(steps[2]).toContain("Wake for network access");
    expect(steps.join(" ")).not.toContain("power failure");
  });

  it("names the Mac's power-failure setting when that is the one that's off", () => {
    const steps = stepsOf(host("darwin", ["no_autorestart"]));
    expect(steps).toHaveLength(2);
    expect(steps[1]).toContain("Start up automatically after a power failure");
  });

  it("gives a Mac no steps when none of its settings are off", () => {
    expect(stayOnSteps(host("darwin", ["check_failed"]), "mac-mini")).toEqual([]);
  });

  it("gives a Windows host its sleep timeout, and nothing for a Mac's reasons", () => {
    const steps = stepsOf(host("win32", ["sleeps_on_ac"]));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain("Power & battery");
    expect(steps[1]).toContain("Make my device sleep after");
    expect(stayOnSteps(host("win32", ["no_wake_for_network"]), "pc")).toEqual([]);
  });

  it("gives a Linux host the command to run on it, and how to undo it", () => {
    const steps = stepsOf(host("linux", ["sleep_not_masked"]), "home-server");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain(
      "In a terminal on home-server, run sudo systemctl mask sleep.target",
    );
    expect(steps[1]).toContain("unmask");
    expect(stayOnSteps(host("linux", ["sleeps_on_ac"]), "home-server")).toEqual([]);
  });

  it("gives an OS it doesn't know no steps", () => {
    expect(stayOnSteps(host("freebsd", ["sleeps_on_ac"]), "box")).toEqual([]);
  });
});

describe("AlwaysOnCard", () => {
  it("shows the steps under the line that says the host may sleep", () => {
    render(<AlwaysOnCard kind={host("darwin", ["sleeps_on_ac"])} name="mac-mini" />);
    const card = screen.getByRole("region", { name: "Always on" });
    expect(within(card).getByText("May sleep")).toBeTruthy();
    expect(
      within(card).getByText(
        "mac-mini may fall asleep. To keep it on, do this on mac-mini itself:",
      ),
    ).toBeTruthy();
    expect(within(card).getAllByRole("listitem")).toHaveLength(2);
  });

  it("has no steps for a host that stays on", () => {
    render(<AlwaysOnCard kind={host("darwin", [], "yes")} name="mac-mini" />);
    const card = screen.getByRole("region", { name: "Always on" });
    expect(
      within(card).getByText("Yes. mac-mini stays on, so Kleio can answer any time."),
    ).toBeTruthy();
    expect(within(card).queryByRole("listitem")).toBeNull();
  });
});

describe("hostRowWords", () => {
  it("calls the host always on only when it says so", () => {
    expect(hostRowWords(host("darwin", [], "yes"), "mac-mini")).toEqual({
      benefit: "Lives on mac-mini, always on",
      status: "Connected",
      keepOn: false,
    });
  });

  it("offers Keep it on for a host that may sleep", () => {
    expect(hostRowWords(host("darwin", ["sleeps_on_ac"]), "mac-mini")).toEqual({
      benefit: "Lives on mac-mini",
      status: "Connected · may fall asleep",
      keepOn: true,
    });
  });

  it("says when a laptop works, and when it couldn't check, without an offer", () => {
    expect(
      hostRowWords(
        { os: "darwin", laptop: true, alwaysOn: { state: "laptop", reasons: [] } },
        "macbook",
      ),
    ).toEqual({
      benefit: "Lives on macbook",
      status: "Connected · works while macbook is open and awake",
      keepOn: false,
    });
    const couldnt = {
      benefit: "Lives on mac-mini",
      status: "Connected · couldn't check whether it stays on",
      keepOn: false,
    };
    expect(hostRowWords(null, "mac-mini")).toEqual(couldnt);
    // A host too old to say.
    expect(hostRowWords({ os: "darwin", laptop: false }, "mac-mini")).toEqual(couldnt);
  });

  it("says only Connected while it is still asking", () => {
    expect(hostRowWords(undefined, "mac-mini")).toEqual({
      benefit: "Lives on mac-mini",
      status: "Connected",
      keepOn: false,
    });
  });
});
