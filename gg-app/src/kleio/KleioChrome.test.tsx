// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KleioHead } from "./KleioChrome";

vi.mock("../RadioButton", () => ({ RadioButton: () => null }));
vi.mock("../WindowLayoutButton", () => ({ WindowLayoutButton: () => null }));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-ios");
});

function head(onApps = vi.fn(), onNew = vi.fn()) {
  return render(
    <KleioHead
      onBack={vi.fn()}
      title="Specialists"
      actions={<button type="button">Connect apps</button>}
      phoneMenu={[
        { label: "Connect apps", onSelect: onApps },
        { label: "New specialist", onSelect: onNew, disabled: true },
      ]}
    />,
  );
}

describe("KleioHead's phone menu", () => {
  it("is the desktop's row of buttons on the desktop, with no menu", () => {
    head();
    expect(screen.getByRole("button", { name: "Connect apps" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("is one '⋯' on the phone, its entries the row's buttons", () => {
    document.documentElement.classList.add("platform-ios");
    const onApps = vi.fn();
    head(onApps);
    expect(screen.queryByRole("button", { name: "Connect apps" })).toBeNull();
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "More" });
    expect(more.getAttribute("aria-controls")).toBe(menu.id);
    const [apps, made] = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(apps);
    expect(made?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(apps!);
    expect(onApps).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape, back on its button, and on a press outside it", () => {
    document.documentElement.classList.add("platform-ios");
    head();
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
