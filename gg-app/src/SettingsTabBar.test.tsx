// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GearSixIcon, KeyIcon, SyringeIcon } from "@phosphor-icons/react";
import { SettingsTabBar, type SettingsTab } from "./SettingsTabBar";

afterEach(() => {
  cleanup();
});

type Id = "general" | "providers" | "steroids";

const TABS: SettingsTab<Id>[] = [
  { id: "general", label: "General", icon: GearSixIcon },
  { id: "providers", label: "AI Providers", icon: KeyIcon },
  { id: "steroids", label: "Steroids", icon: SyringeIcon, alert: true },
];

function Harness({
  onSelect,
  tooltips,
  tabs = TABS,
}: {
  onSelect?: (id: Id) => void;
  tooltips?: boolean;
  tabs?: SettingsTab<Id>[];
}): React.ReactElement {
  const [selected, setSelected] = useState<Id>("general");
  return (
    <SettingsTabBar
      tabs={tabs}
      selected={selected}
      onSelect={(id) => {
        onSelect?.(id);
        setSelected(id);
      }}
      panelId="panel"
      {...(tooltips === undefined ? {} : { tooltips })}
    />
  );
}

function titles(): (string | null)[] {
  return screen.getAllByRole("tab").map((t) => t.getAttribute("title"));
}

function selectedName(): string | null {
  return (
    screen
      .getAllByRole("tab")
      .find((t) => t.getAttribute("aria-selected") === "true")
      ?.getAttribute("aria-label") ?? null
  );
}

describe("SettingsTabBar", () => {
  it("is a named tab list whose tabs control the panel", () => {
    render(<Harness />);

    expect(screen.getByRole("tablist", { name: "Settings sections" })).toBeTruthy();
    for (const name of ["General", "AI Providers", "Steroids"]) {
      expect(screen.getByRole("tab", { name }).getAttribute("aria-controls")).toBe("panel");
    }
    expect(selectedName()).toBe("General");
    expect(document.querySelector(".settings-tabs-pill")?.classList.contains("is-placed")).toBe(
      true,
    );
  });

  it("supports a distinct name and tab ids when reused outside Settings", () => {
    render(
      <SettingsTabBar
        tabs={TABS}
        selected="general"
        onSelect={vi.fn()}
        panelId="checklist-panel"
        label="Checklist views"
        tabIdPrefix="checklist-tab"
      />,
    );
    expect(screen.getByRole("tablist", { name: "Checklist views" })).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "General" });
    expect(tab.id).toBe("checklist-tab-general");
    expect(tab.getAttribute("aria-controls")).toBe("checklist-panel");
    expect(document.querySelector("#settings-tab-general")).toBeNull();
  });

  it("moves only on click, not on hover", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const providers = screen.getByRole("tab", { name: "AI Providers" });

    fireEvent.pointerEnter(providers);
    fireEvent.pointerMove(providers, { clientX: 40, clientY: 10 });
    expect(selectedName()).toBe("General");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(providers);
    expect(selectedName()).toBe("AI Providers");
    expect(onSelect).toHaveBeenCalledWith("providers");
  });

  it("does not re-select the tab that is already selected", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("tab", { name: "General" }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("walks the tabs with arrow keys, Home and End, keeping one Tab stop", () => {
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowRight" });
    expect(selectedName()).toBe("AI Providers");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("AI Providers");

    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(selectedName()).toBe("Steroids");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(selectedName()).toBe("General");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(selectedName()).toBe("Steroids");
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(selectedName()).toBe("General");

    const stops = screen.getAllByRole("tab").filter((t) => t.tabIndex === 0);
    expect(stops.map((t) => t.getAttribute("aria-label"))).toEqual(["General"]);
  });

  it("gives no tab a title unless asked", () => {
    render(<Harness />);

    expect(titles()).toEqual([null, null, null]);
    fireEvent.click(screen.getByRole("tab", { name: "AI Providers" }));
    expect(titles()).toEqual([null, null, null]);
  });

  it("names each unselected tab in its title when asked, and never the selected one", () => {
    render(<Harness tooltips />);

    expect(titles()).toEqual([null, "AI Providers", "Steroids"]);

    fireEvent.click(screen.getByRole("tab", { name: "AI Providers" }));
    expect(titles()).toEqual(["General", null, "Steroids"]);
    // The accessible name is the label either way.
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
      "General",
      "AI Providers",
      "Steroids",
    ]);
  });

  it("passes by a tab that isn't available yet, and says why", () => {
    const onSelect = vi.fn();
    const tabs = TABS.map((t) =>
      t.id === "providers" ? { ...t, disabled: "Add a key first" } : t,
    );
    render(<Harness tabs={tabs} onSelect={onSelect} tooltips />);
    const providers = screen.getByRole("tab", { name: "AI Providers" });
    expect(providers.getAttribute("aria-disabled")).toBe("true");
    // Its reason is its tooltip, in place of its name.
    expect(titles()).toEqual([null, "Add a key first", "Steroids"]);
    expect(screen.getAllByRole("tab").filter((t) => t.hasAttribute("aria-disabled"))).toHaveLength(
      1,
    );

    fireEvent.click(providers);
    expect(selectedName()).toBe("General");
    expect(onSelect).not.toHaveBeenCalled();

    // The arrow keys step over it, both ways and at the ends.
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowRight" });
    expect(selectedName()).toBe("Steroids");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(selectedName()).toBe("General");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(selectedName()).toBe("Steroids");
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(selectedName()).toBe("General");
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(selectedName()).toBe("Steroids");
    expect(onSelect.mock.calls.map((c) => c[0])).not.toContain("providers");
  });

  it("marks a tab that needs attention", () => {
    render(<Harness />);

    expect(
      screen.getByRole("tab", { name: "Steroids" }).querySelector(".settings-tab-alert"),
    ).not.toBeNull();
    expect(document.querySelectorAll(".settings-tab-alert")).toHaveLength(1);
  });
});

describe("SettingsTabBar on the iPhone", () => {
  afterEach(() => {
    document.documentElement.classList.remove("platform-ios");
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("scrolls the open tab into its sideways tray; the desktop's never scrolls", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const desktop = render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Steroids" }));
    expect(scrollIntoView).not.toHaveBeenCalled();
    desktop.unmount();

    document.documentElement.classList.add("platform-ios");
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Steroids" }));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    expect(scrollIntoView.mock.contexts[scrollIntoView.mock.contexts.length - 1]).toBe(
      screen.getByRole("tab", { name: "Steroids" }),
    );
  });
});
