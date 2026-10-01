// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KleioScreen } from "./KleioScreen";

vi.mock("../RadioButton", () => ({ RadioButton: () => <button type="button">Radio</button> }));
vi.mock("../WindowLayoutButton", () => ({
  WindowLayoutButton: () => <button type="button">Layout</button>,
}));
// The pages' own behaviour is tested beside them; here only the screen's wiring.
vi.mock("./BlobsPage", () => ({
  BlobsPage: ({ onOpenApps }: { onOpenApps?: () => void }) => (
    <button type="button" onClick={onOpenApps}>
      Connect apps
    </button>
  ),
}));
vi.mock("./GroupsPage", () => ({ GroupsPage: () => <p>Groups list</p> }));
vi.mock("./LazyAppsPage", () => ({ AppsPage: () => <p>The apps page</p> }));

afterEach(() => {
  cleanup();
});

describe("KleioScreen", () => {
  it("opens Apps from the Agents list, and Back returns to the list", async () => {
    await act(async () => {
      render(<KleioScreen onClose={() => undefined} />);
    });
    expect(screen.getByRole("tab", { name: "Agents" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect apps" }));
    expect(screen.getByRole("heading", { name: "Apps" })).toBeTruthy();
    expect(screen.getByText("The apps page")).toBeTruthy();
    // The Agents/Groups switcher belongs to the lists only.
    expect(screen.queryByRole("tab", { name: "Agents" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Connect apps" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Agents" })).toBeTruthy();
  });
});
