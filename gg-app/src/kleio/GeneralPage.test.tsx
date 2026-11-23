// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AppSettings, PermissionsStatus } from "../agent";

vi.mock("../agent", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getPermissionsStatus: vi.fn(),
  openPermissionsSettings: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../sounds", () => ({
  isSoundEnabled: () => true,
  setSoundEnabled: vi.fn(),
  playSound: vi.fn(),
}));

import { open } from "@tauri-apps/plugin-dialog";
import { getPermissionsStatus, getSettings, openPermissionsSettings, saveSettings } from "../agent";
import { SettingsHeaderProvider } from "../settings-header";
import { toast } from "../toast";
import { GeneralPage } from "./GeneralPage";

const FOLDER = "/Users/you/gg-projects";
const GRANTED: PermissionsStatus = { applicable: true, granted: true };
const NOT_GRANTED: PermissionsStatus = { applicable: true, granted: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage(
  opts: { settings?: AppSettings | null; permissions?: PermissionsStatus } = {},
) {
  vi.mocked(getSettings).mockResolvedValue(
    opts.settings === undefined ? { projectsRoot: FOLDER, configured: true } : opts.settings,
  );
  vi.mocked(getPermissionsStatus).mockResolvedValue(opts.permissions ?? GRANTED);
  vi.mocked(saveSettings).mockResolvedValue(undefined);
  const onSaved = vi.fn();
  const view = render(<GeneralPage onSaved={onSaved} />);
  await settle();
  return { onSaved, ...view };
}

const field = (): HTMLInputElement => screen.getByRole("textbox", { name: "Project folder" });
const saveButton = (): HTMLButtonElement => screen.getByRole("button", { name: /^Sav/ });
const grantButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: "Grant Permissions…" });
const type = (value: string): void => {
  fireEvent.change(field(), { target: { value } });
};
const filled = (): (string | null)[] =>
  screen
    .getAllByRole("button")
    .filter((b) => b.classList.contains("primary"))
    .map((b) => b.textContent);
const comeBack = async (): Promise<void> => {
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
};

describe("GeneralPage: the project folder", () => {
  it("reads the saved folder into a field named Project folder", async () => {
    await renderPage();

    expect(getSettings).toHaveBeenCalledOnce();
    expect(field().value).toBe(FOLDER);
    expect(field().placeholder).toBe("/Users/you/gg-projects");
    expect(field().getAttribute("spellcheck")).toBe("false");
    expect(screen.getByRole("heading", { name: "Project folder" })).toBeTruthy();
    expect(screen.getByText("Where new projects are created.")).toBeTruthy();
  });

  it("leaves the field empty when the folder can't be read", async () => {
    await renderPage({ settings: null });

    expect(field().value).toBe("");
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps Save off until the folder changes, saves it trimmed, and goes off again", async () => {
    const { onSaved } = await renderPage();
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().classList.contains("primary")).toBe(false);

    type("  /Users/you/Code  ");
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().classList.contains("primary")).toBe(true);

    saveButton().focus();
    fireEvent.click(saveButton());
    await settle();

    expect(saveSettings).toHaveBeenCalledOnce();
    expect(saveSettings).toHaveBeenCalledWith("/Users/you/Code");
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith("/Users/you/Code");
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toBe("Save");
    // The field shows the folder as it was saved.
    expect(field().value).toBe("/Users/you/Code");
    // Save is off, so focus went back to the field rather than nowhere.
    expect(document.activeElement).toBe(field());
    // The screen says "saved"; the page raises no toast of its own.
    expect(toast).not.toHaveBeenCalled();
  });

  it("goes live again when the saved folder is edited, and off when it is put back", async () => {
    await renderPage();

    type("/Users/you/Code");
    expect(saveButton().disabled).toBe(false);
    type(` ${FOLDER} `);
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().title).toBe("No changes to save");
  });

  it("saves with Enter in the field", async () => {
    const { onSaved } = await renderPage();
    type("/Users/you/Code");

    const form = field().closest("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    await settle();

    expect(saveSettings).toHaveBeenCalledWith("/Users/you/Code");
    expect(onSaved).toHaveBeenCalledWith("/Users/you/Code");
    expect(saveButton().disabled).toBe(true);
  });

  it("says Saving…, keeps focus and ignores a second press while it saves", async () => {
    let finish: () => void = () => {};
    await renderPage();
    vi.mocked(saveSettings).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    type("/Users/you/Code");
    saveButton().focus();
    fireEvent.click(saveButton());
    await settle();

    expect(saveButton().textContent).toBe("Saving…");
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    expect(saveButton().disabled).toBe(false);
    expect(document.activeElement).toBe(saveButton());
    expect(filled()).toEqual([]);

    fireEvent.click(saveButton());
    await settle();
    expect(saveSettings).toHaveBeenCalledOnce();

    finish();
    await settle();
    expect(saveButton().textContent).toBe("Save");
    expect(saveButton().hasAttribute("aria-disabled")).toBe(false);
    expect(saveButton().disabled).toBe(true);
  });

  it("lets the default folder be saved as it stands while none has been saved", async () => {
    // Home keeps Code shut until a folder is saved, and sends people here.
    const { onSaved } = await renderPage({ settings: { projectsRoot: FOLDER, configured: false } });
    expect(field().value).toBe(FOLDER);
    expect(saveButton().disabled).toBe(false);
    expect(filled()).toEqual(["Save"]);

    fireEvent.click(saveButton());
    await settle();

    expect(saveSettings).toHaveBeenCalledWith(FOLDER);
    expect(onSaved).toHaveBeenCalledWith(FOLDER);
    expect(saveButton().disabled).toBe(true);
    expect(filled()).toEqual([]);
  });

  it("never saves an empty folder", async () => {
    await renderPage({ settings: { projectsRoot: FOLDER, configured: false } });

    type("   ");
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().hasAttribute("title")).toBe(false);
    const form = field().closest("form");
    if (form) fireEvent.submit(form);
    await settle();

    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("says why a save failed and keeps the change unsaved", async () => {
    const { onSaved } = await renderPage();
    vi.mocked(saveSettings).mockRejectedValue(new Error("the disk is full"));
    type("  /Users/you/Code ");

    fireEvent.click(saveButton());
    await settle();

    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Couldn't save: the disk is full", "error");
    expect(onSaved).not.toHaveBeenCalled();
    // Left exactly as typed.
    expect(field().value).toBe("  /Users/you/Code ");
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().textContent).toBe("Save");
    expect(filled()).toEqual(["Save"]);
  });

  it("fills the field from Browse and makes Save live", async () => {
    await renderPage();
    vi.mocked(open).mockResolvedValue("/Users/you/Documents/Work");

    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await settle();

    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Projects folder",
    });
    expect(field().value).toBe("/Users/you/Documents/Work");
    expect(saveButton().disabled).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("changes nothing when Browse is cancelled", async () => {
    await renderPage();
    vi.mocked(open).mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await settle();

    expect(field().value).toBe(FOLDER);
    expect(saveButton().disabled).toBe(true);
  });
});

describe("GeneralPage: permissions", () => {
  it("has no Permissions section where there is nothing to grant", async () => {
    await renderPage({ permissions: { applicable: false, granted: false } });

    expect(screen.queryByRole("heading", { name: "Permissions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grant Permissions…" })).toBeNull();
    expect(screen.queryByText("Full Disk Access is granted.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Effects" })).toBeTruthy();
  });

  it("offers Grant with what happens next, and no badge, while access is missing", async () => {
    await renderPage({ permissions: NOT_GRANTED });

    expect(screen.getByRole("heading", { name: "Permissions" })).toBeTruthy();
    expect(screen.getByText("Full Disk Access for Kleio.")).toBeTruthy();
    expect(
      screen.getByText("System Settings opens: switch Kleio on there, then come back."),
    ).toBeTruthy();
    expect(screen.queryByText("Not granted")).toBeNull();
    expect(document.querySelector(".badge")).toBeNull();
    expect(screen.queryByText("Full Disk Access is granted.")).toBeNull();

    fireEvent.click(grantButton());
    expect(openPermissionsSettings).toHaveBeenCalledOnce();
  });

  it("says access is granted as a status, with no button", async () => {
    await renderPage({ permissions: GRANTED });

    const status = screen.getByText("Full Disk Access is granted.");
    expect(status.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("button", { name: /Grant|granted/i })).toBeNull();
    expect(screen.queryByText("Granted")).toBeNull();
    expect(document.querySelector(".badge")).toBeNull();
  });

  it("reads the permission again when the window regains focus, and moves focus to the status", async () => {
    await renderPage({ permissions: NOT_GRANTED });
    expect(getPermissionsStatus).toHaveBeenCalledOnce();
    grantButton().focus();
    fireEvent.click(grantButton());
    // Opening System Settings changes nothing here by itself.
    await settle();
    expect(screen.queryByText("Full Disk Access is granted.")).toBeNull();

    vi.mocked(getPermissionsStatus).mockResolvedValue(GRANTED);
    await comeBack();

    expect(getPermissionsStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Grant Permissions…" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Full Disk Access is granted."));
  });

  it("leaves focus where it is when Grant didn't have it", async () => {
    await renderPage({ permissions: NOT_GRANTED });
    field().focus();

    vi.mocked(getPermissionsStatus).mockResolvedValue(GRANTED);
    await comeBack();

    expect(screen.getByText("Full Disk Access is granted.")).toBeTruthy();
    expect(document.activeElement).toBe(field());
  });

  it("stops reading the permission once the page has closed", async () => {
    const { unmount } = await renderPage({ permissions: NOT_GRANTED });
    unmount();

    await comeBack();

    expect(getPermissionsStatus).toHaveBeenCalledOnce();
  });
});

describe("GeneralPage: one filled button, Effects and the header", () => {
  it.each([
    ["granted, nothing to save", GRANTED, false, []],
    ["granted, a changed folder", GRANTED, true, ["Save"]],
    ["not granted, nothing to save", NOT_GRANTED, false, ["Grant Permissions…"]],
    ["not granted, a changed folder", NOT_GRANTED, true, ["Save"]],
  ])("fills one button at most: %s", async (_name, permissions, edited, want) => {
    await renderPage({ permissions });
    if (edited) type("/Users/you/Code");

    expect(filled()).toEqual(want);
  });

  it("hands the fill back to Grant once the folder is saved", async () => {
    await renderPage({ permissions: NOT_GRANTED });
    type("/Users/you/Code");
    expect(filled()).toEqual(["Save"]);

    fireEvent.click(saveButton());
    await settle();

    expect(filled()).toEqual(["Grant Permissions…"]);
  });

  it("keeps Sound and Background, and has no Power switch", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Effects" })).toBeTruthy();
    expect(screen.getByText("Sounds, and the home screen's moving background.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sound on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Background on" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /power/i })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/awake/i)).toBeNull();
  });

  it("orders the page: the folder, then Permissions and Effects", async () => {
    await renderPage({ permissions: NOT_GRANTED });

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Project folder",
      "Permissions",
      "Effects",
    ]);
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.textContent)
        .slice(0, 3),
    ).toEqual(["Browse…", "Save", "Grant Permissions…"]);
  });

  it("puts nothing in the screen's header", async () => {
    const status = document.createElement("span");
    const actions = document.createElement("span");
    document.body.append(status, actions);
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: FOLDER, configured: true });
    vi.mocked(getPermissionsStatus).mockResolvedValue(NOT_GRANTED);
    render(
      <SettingsHeaderProvider slots={{ status, actions }}>
        <GeneralPage />
      </SettingsHeaderProvider>,
    );
    await settle();
    type("/Users/you/Code");

    expect(status.childNodes).toHaveLength(0);
    expect(actions.childNodes).toHaveLength(0);
    // Save is on the page, in the field's own row.
    expect(saveButton().closest("form")).toBe(field().closest("form"));
    status.remove();
    actions.remove();
  });
});
