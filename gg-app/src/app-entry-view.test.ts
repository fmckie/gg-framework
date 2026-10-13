import { describe, expect, it } from "vitest";
import { initialEntryView, shouldOpenSetup } from "./app-entry-view";

describe("App initial entry view", () => {
  it("opens both primary and secondary windows on Home", () => {
    expect(initialEntryView(false)).toBe("home");
    expect(initialEntryView(true)).toBe("home");
  });
});

describe("shouldOpenSetup", () => {
  const store = (v: string | null) => ({ getItem: () => v });

  it("opens Setup in the main window until it has been seen", () => {
    expect(shouldOpenSetup(store(null), false)).toBe(true);
    expect(shouldOpenSetup(store("1"), false)).toBe(false);
  });

  it("never opens Setup in a secondary window", () => {
    expect(shouldOpenSetup(store(null), true)).toBe(false);
  });

  it("counts storage it can't read as seen", () => {
    expect(shouldOpenSetup(null, false)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(shouldOpenSetup(broken, false)).toBe(false);
  });
});
