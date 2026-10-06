// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getRadioState } from "./agent";
import { isPhone } from "./platform";
import { RadioButton } from "./RadioButton";

vi.mock("./platform", () => ({ isPhone: vi.fn(() => false) }));
vi.mock("./agent", () => ({
  getRadioState: vi.fn(async () => ({ stations: [], current: null, volume: 70 })),
  setRadio: vi.fn(),
  setRadioVolume: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(isPhone).mockReturnValue(false);
});

describe("RadioButton", () => {
  it("shows the radio in the Mac's header", async () => {
    render(<RadioButton />);
    expect(await screen.findByTitle("Internet radio")).toBeTruthy();
  });

  it("has no button on the iPhone, and never asks the Mac for the radio", () => {
    vi.mocked(isPhone).mockReturnValue(true);
    const { container } = render(<RadioButton />);
    expect(container.innerHTML).toBe("");
    expect(getRadioState).not.toHaveBeenCalled();
  });
});
