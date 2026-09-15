// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SettingsModal } from "./LazySettingsModal";

const native = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ projectsRoot: "/synthetic/projects" })),
  saveSettings: vi.fn(async () => {}),
  getPermissionsStatus: vi.fn(async () => ({ applicable: false, granted: false })),
}));
vi.mock("./agent", () => ({ ...native, openPermissionsSettings: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./toast", () => ({ toast: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("lazy settings", () => {
  it("loads only when opened, preserves saving, Escape and focus return", async () => {
    const onSaved = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open settings</button>
          {open && <SettingsModal onClose={() => setOpen(false)} onSaved={onSaved} />}
        </>
      );
    }
    render(<Host />);
    expect(native.getSettings).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "Open settings" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const input = within(dialog).getByRole("textbox");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("/synthetic/projects"));
    fireEvent.change(input, { target: { value: "/synthetic/updated" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("/synthetic/updated"));
    expect(native.saveSettings).toHaveBeenCalledWith("/synthetic/updated");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
