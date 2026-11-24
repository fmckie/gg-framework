// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KleioScreen } from "./KleioScreen";

vi.mock("../RadioButton", () => ({ RadioButton: () => <button type="button">Radio</button> }));
vi.mock("../WindowLayoutButton", () => ({
  WindowLayoutButton: () => <button type="button">Layout</button>,
}));
/** How many specialists the stand-in list reports; null = not read yet. */
const cast = vi.hoisted(() => ({ count: 2 as number | null }));
// The pages' own behaviour is tested beside them; here only the screen's wiring.
vi.mock("./BlobsPage", async () => {
  const { useEffect } = await import("react");
  return {
    BlobsPage: ({
      onOpenApps,
      onCountChange,
    }: {
      onOpenApps?: () => void;
      onCountChange?: (count: number | null) => void;
    }) => {
      useEffect(() => onCountChange?.(cast.count), [onCountChange]);
      return (
        <button type="button" onClick={onOpenApps}>
          Connect apps
        </button>
      );
    },
  };
});
vi.mock("./GroupsPage", () => ({ GroupsPage: () => <p>Groups list</p> }));
vi.mock("./LazyAppsPage", () => ({ AppsPage: () => <p>The apps page</p> }));

afterEach(() => {
  cleanup();
  cast.count = 2;
  document.documentElement.classList.remove("platform-ios");
});

async function open(count: number | null): Promise<HTMLElement> {
  cast.count = count;
  await act(async () => {
    render(<KleioScreen onClose={() => undefined} />);
  });
  return screen.getByRole("tab", { name: "Groups" });
}

describe("KleioScreen", () => {
  it("opens Apps from the Specialists list, and Back returns to the list", async () => {
    await act(async () => {
      render(<KleioScreen onClose={() => undefined} />);
    });
    expect(screen.getByRole("tab", { name: "Specialists" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect apps" }));
    expect(screen.getByRole("heading", { name: "Apps" })).toBeTruthy();
    expect(screen.getByText("The apps page")).toBeTruthy();
    // The Specialists/Groups switcher belongs to the lists only.
    expect(screen.queryByRole("tab", { name: "Specialists" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Connect apps" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Specialists" })).toBeTruthy();
  });

  it("holds Groups back on the desktop until there is a first specialist", async () => {
    const groups = await open(0);
    expect(groups.getAttribute("aria-disabled")).toBe("true");
    expect(groups.title).toBe("Create a specialist first");
    expect(screen.getByRole("tab", { name: "Specialists" }).hasAttribute("aria-disabled")).toBe(
      false,
    );
    fireEvent.click(groups);
    expect(screen.queryByText("Groups list")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect apps" })).toBeTruthy();
  });

  it("opens Groups as before once there are specialists, or while they are still being read", async () => {
    const loading = await open(null);
    expect(loading.hasAttribute("aria-disabled")).toBe(false);
    cleanup();

    const groups = await open(2);
    expect(groups.hasAttribute("aria-disabled")).toBe(false);
    expect(groups.title).toBe("");
    fireEvent.click(groups);
    expect(screen.getByText("Groups list")).toBeTruthy();
  });

  it("never holds Groups back on the iPhone, which keeps today's switcher", async () => {
    document.documentElement.classList.add("platform-ios");
    const groups = await open(0);
    expect(groups.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(groups);
    expect(screen.getByText("Groups list")).toBeTruthy();
  });
});
