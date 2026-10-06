// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { KenPowerBanner } from "./KenPowerBanner";

afterEach(cleanup);

describe("KenPowerBanner", () => {
  it.each([
    ["on", "Kleio is on."],
    ["off", "Kleio is off."],
  ] as const)("Autopilot %s says %s", (mode, text) => {
    const { container } = render(<KenPowerBanner mode={mode} onDone={() => undefined} />);
    expect(container.textContent).toBe(text);
  });
});
