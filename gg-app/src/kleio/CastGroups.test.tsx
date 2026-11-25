// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CAST_NOW, castGroups, type GroupListSize } from "./castFixtures";
import { CastGroupForm } from "./CastGroupForm";
import { CastGroups } from "./CastGroups";
import castCss from "./kleio-cast.css?raw";
import { createGroup, deleteGroup, updateGroup, type Blob, type Group } from "./kleioApi";
import type * as KleioApi from "./kleioApi";

// The group's parts come by way of useGroupChat, whose Markdown reaches the Tauri bridge on import.
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("../RadioButton", () => ({ RadioButton: () => null }));
vi.mock("../WindowLayoutButton", () => ({ WindowLayoutButton: () => null }));
vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

const onClose = vi.fn();
const onCreate = vi.fn();
const onOpen = vi.fn();
const onEdit = vi.fn();
const onSaved = vi.fn();
const onCancel = vi.fn();
const onDeleted = vi.fn();

/** The shelf with `size` groups from the fixtures, changed by `over`. */
function drawList(
  size: GroupListSize,
  over: { groups?: Group[] | null; blobs?: Blob[]; error?: string | null } = {},
): void {
  const list = castGroups(size);
  render(
    <CastGroups
      groups={over.groups === undefined ? list.groups : over.groups}
      blobs={over.blobs ?? list.blobs}
      error={over.error ?? null}
      onClose={onClose}
      onCreate={onCreate}
      onOpen={onOpen}
      onEdit={onEdit}
      now={CAST_NOW}
    />,
  );
}

function drawForm(group?: Group, blobs: Blob[] = castGroups(12).blobs): void {
  render(
    <CastGroupForm
      {...(group ? { group } : {})}
      blobs={blobs}
      onSaved={onSaved}
      onCancel={onCancel}
      onDeleted={onDeleted}
    />,
  );
}

const shelf = (): HTMLElement => screen.getByRole("group", { name: /^Your \d+ groups?$/ });
const troupe = (name: string): HTMLElement =>
  within(shelf()).getByRole("button", { name: new RegExp(`^${name}\\.`) });
const profile = (name: string): HTMLElement => screen.getByRole("region", { name });
const pressed = (): (string | null)[] =>
  within(shelf())
    .getAllByRole("button", { pressed: true })
    .map((b) => b.querySelector(".cast-name")?.textContent ?? null);
const named = (id: string): Group => castGroups(12).groups.find((g) => g.id === id) as Group;
const picks = (): HTMLButtonElement[] =>
  within(screen.getByRole("list", { name: "Members" })).getAllByRole("button");
const pick = (name: string): HTMLButtonElement =>
  picks().find(
    (b) => b.querySelector(".kleio-member-name")?.textContent === name,
  ) as HTMLButtonElement;
const onStage = (): number =>
  document.querySelectorAll(".cast-gstage .cast-slot:not(.is-place)").length;
const press = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: CAST_NOW, toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("groups on the Cast's shelf", () => {
  it("waits with a skeleton, and shows why the host could not be read", () => {
    drawList(0, { groups: null });
    expect(document.querySelector(".cast-page > .list-skeleton")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No groups yet" })).toBeNull();
    cleanup();

    drawList(0, { groups: null, error: "The host is not reachable." });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("The host is not reachable.");
    expect(alert.matches(".cast-page > .kleio-error.cast-error")).toBe(true);
    expect(document.querySelector(".list-skeleton")).toBeNull();
  });

  it("with no specialists, shows places waiting and holds New group back", () => {
    drawList(0, { blobs: [] });
    expect(screen.getByRole("heading", { name: "No groups yet" })).toBeTruthy();
    expect(screen.getByText(/Create a specialist first, then add it to a group\./)).toBeTruthy();
    expect(document.querySelectorAll(".cast-first.is-group .cast-slot.is-place")).toHaveLength(5);
    const create = screen.getByRole("button", { name: "+ New group" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toBe("Create a specialist first");
    expect(screen.queryByRole("group", { name: /^Your/ })).toBeNull();
  });

  it("with no groups, stands five of your specialists on the stage and offers one button", () => {
    drawList(0);
    expect(screen.getByRole("heading", { name: "No groups yet" })).toBeTruthy();
    expect(screen.getByText(/Everyone replies, or @mention one to ask just them\./)).toBeTruthy();
    const stage = document.querySelector(".cast-first.is-group .cast-stage") as HTMLElement;
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    expect(stage.querySelectorAll(".cast-slot")).toHaveLength(5);
    expect(stage.querySelector(".is-place, .blob-av-outline")).toBeNull();
    // The page's own button, not a second one in the header.
    const create = screen.getAllByRole("button", { name: "+ New group" });
    expect(create).toHaveLength(1);
    expect(create[0]?.matches(".cast-welcome .cast-btn-lg")).toBe(true);
    fireEvent.click(create[0] as HTMLElement);
    expect(onCreate).toHaveBeenCalledTimes(1);
    cleanup();

    // Fewer specialists than places: only they stand there.
    drawList(0, { blobs: castGroups(0).blobs.slice(0, 2) });
    expect(document.querySelectorAll(".cast-stage .cast-slot")).toHaveLength(2);
    expect(
      (document.querySelector(".cast-stage") as HTMLElement).style.getPropertyValue("--n"),
    ).toBe("2");
  });

  it("stands one group large, replying, with a place for the next", () => {
    drawList(1);
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("solo");
    expect(shelf().getAttribute("aria-label")).toBe("Your 1 group");
    const lisbon = troupe("Lisbon offsite");
    expect(lisbon.getAttribute("aria-pressed")).toBe("true");
    expect(lisbon.getAttribute("aria-label")).toMatch(/^Lisbon offsite\. Replying…\. Ledger: /);
    expect(lisbon.matches(".cast-troupe.is-working")).toBe(true);
    // Its first three members stand for it; Quill, the third, is the one replying.
    expect(lisbon.getAttribute("data-n")).toBe("3");
    const standing = [...lisbon.querySelectorAll(".cast-huddle .cast-h .blob-av")];
    expect(standing.map((av) => av.matches(".is-live"))).toEqual([false, false, true]);
    expect(lisbon.querySelectorAll(".cast-bubble.is-typing i")).toHaveLength(3);
    expect(within(lisbon).getByText("Replying…").className).toBe("cast-state");

    const pills = document.querySelectorAll(".cast-pills .cast-pill");
    expect([...pills].map((p) => p.textContent)).toEqual(["1", "1 replying"]);

    const next = within(shelf()).getByRole("button", { name: /^New group/ });
    expect(next.matches(".cast-actor.is-add")).toBe(true);
    fireEvent.click(next);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("shows the selected group's profile: who is replying, the latest message, its members", () => {
    drawList(1);
    const p = profile("Lisbon offsite");
    expect(p.matches(".cast-profile.is-group")).toBe(true);
    expect(within(p).getByRole("heading", { name: "Lisbon offsite", level: 2 })).toBeTruthy();
    const state = p.querySelector(".cast-p-state") as HTMLElement;
    expect(state.textContent).toBe("Replying…Quill");
    expect(state.querySelector(".cast-pill.is-live .cast-dot")).toBeTruthy();

    expect(within(p).getByRole("heading", { name: "Latest message" })).toBeTruthy();
    const who = p.querySelector(".cast-g-who") as HTMLElement;
    expect(who.textContent).toBe("Ledgertoday 14:09");
    expect(who.querySelector(".blob-av")).toBeTruthy();
    // Said plainly: the reply's own link and emphasis marks are not shown.
    const text = p.querySelector(".cast-g-text")?.textContent ?? "";
    expect(text).toMatch(/^Taberna do Largo fits: €456 for 12/);
    expect(text).toContain("the Offsite budget.");
    expect(text).not.toMatch(/[[\]*]|out\//);

    const members = [...p.querySelectorAll(".cast-g-members li")];
    expect(members.map((li) => li.textContent)).toEqual(["Scout", "Ledger", "Quill", "Courier"]);
    expect(members.map((li) => li.className)).toEqual(["", "", "is-live", ""]);

    fireEvent.click(within(p).getByRole("button", { name: "Open chat" }));
    expect(onOpen).toHaveBeenCalledWith("lisbon");
    fireEvent.click(within(p).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith("lisbon");
  });

  it("stands several on one shelf, starts on the one replying, and moves the spotlight on a click", () => {
    drawList(3);
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("one");
    expect(within(shelf()).getAllByRole("button")).toHaveLength(3);
    expect(within(shelf()).queryByRole("button", { name: /^New group/ })).toBeNull();
    expect(pressed()).toEqual(["Lisbon offsite"]);
    // The header's button makes the next one.
    fireEvent.click(screen.getByRole("button", { name: "+ New group" }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    const kitchen = troupe("Kitchen crew");
    expect(kitchen.getAttribute("data-n")).toBe("2");
    expect(kitchen.matches(".is-working")).toBe(false);
    expect(kitchen.querySelector(".cast-bubble")).toBeNull();
    expect(kitchen.querySelector(".cast-state")?.textContent).toBe("21 h ago");
    fireEvent.click(kitchen);
    expect(pressed()).toEqual(["Kitchen crew"]);
    expect(onOpen).not.toHaveBeenCalled();
    const p = profile("Kitchen crew");
    expect(p.style.getPropertyValue("--col")).toBe("1");
    expect(p.querySelector(".cast-p-state")?.textContent).toBe("2 members");
    expect(p.querySelector(".cast-g-who")?.textContent).toBe("ChefSun 8 Nov 17:02");
    expect(p.querySelector(".cast-g-text")?.textContent).toBe(
      "Sunday's list is in: miso salmon, squash orzo and a chickpea curry.",
    );

    // One that has never been used says how many are in it, and that nothing was said.
    const money = troupe("Money desk");
    expect(money.querySelector(".cast-state")?.textContent).toBe("4 members");
    expect(money.getAttribute("aria-label")).toBe(
      "Money desk. 4 members. No messages yet — say hello.",
    );
    fireEvent.click(money);
    expect(within(profile("Money desk")).getByText("No messages yet — say hello.")).toBeTruthy();
    fireEvent.click(within(profile("Money desk")).getByRole("button", { name: "Open chat" }));
    expect(onOpen).toHaveBeenCalledWith("troupe-2");
  });

  it("keeps the spotlight on the picked group when the list is read again", () => {
    const list = castGroups(3);
    const props = {
      blobs: list.blobs,
      error: null,
      onClose,
      onCreate,
      onOpen,
      onEdit,
      now: CAST_NOW,
    };
    const { rerender } = render(<CastGroups groups={list.groups} {...props} />);
    fireEvent.click(troupe("Money desk"));
    rerender(<CastGroups groups={castGroups(3).groups} {...props} />);
    expect(pressed()).toEqual(["Money desk"]);
    // The picked one is gone: back to the one replying.
    rerender(<CastGroups groups={castGroups(1).groups} {...props} />);
    expect(pressed()).toEqual(["Lisbon offsite"]);
  });

  it("stands twelve on two shelves, with deleted members counted and an empty group as a place", () => {
    drawList(12);
    expect(document.querySelector(".cast-page")?.getAttribute("data-tier")).toBe("two");
    expect(document.querySelectorAll(".cast-row")).toHaveLength(2);
    expect(within(shelf()).getAllByRole("button")).toHaveLength(12);
    // On two shelves the profile's head carries the group's picture.
    expect(profile("Lisbon offsite").querySelector(".cast-p-head .blob-cluster")).toBeTruthy();

    // One of eight shows its first three; a message of yours has no blob beside it.
    const study = troupe("Study hall");
    expect(study.getAttribute("data-n")).toBe("3");
    fireEvent.click(study);
    const p = profile("Study hall");
    expect(p.querySelectorAll(".cast-g-members li")).toHaveLength(8);
    expect(p.querySelector(".cast-g-who")?.textContent).toBe("YouSat 7 Nov 19:15");
    expect(p.querySelector(".cast-g-who .blob-av")).toBeNull();
    // It stands on the back shelf, out of the pointer's reach.
    expect(p.style.getPropertyValue("--notch")).toBe("0");

    fireEvent.click(troupe("Travel desk"));
    const travel = profile("Travel desk");
    expect(travel.querySelector(".cast-p-state")?.textContent).toBe("3 members");
    expect(travel.querySelectorAll(".cast-g-members li")).toHaveLength(2);
    expect(
      within(travel).getByText("1 deleted specialist — edit the group to remove."),
    ).toBeTruthy();

    const old = troupe("Old project");
    expect(old.getAttribute("data-n")).toBe("0");
    expect(old.querySelector(".cast-figure > .blob-av-outline")).toBeTruthy();
    expect(old.querySelector(".cast-huddle")).toBeNull();
    fireEvent.click(old);
    const gone = profile("Old project");
    // The front shelf is within the pointer's reach.
    expect(gone.style.getPropertyValue("--notch")).toBe("1");
    expect(gone.querySelector(".cast-g-members")).toBeNull();
    expect(
      within(gone).getByText("2 deleted specialists — edit the group to remove."),
    ).toBeTruthy();
  });

  it("bounces a replying member when it is one of the three that stand for the group", () => {
    const list = castGroups(3);
    const kitchen = list.groups[1] as Group;
    drawList(3, { groups: [{ ...kitchen, typing: ["gardener"] }] });
    const live = [...troupe("Kitchen crew").querySelectorAll(".cast-h")].map((h) =>
      Boolean(h.querySelector(".blob-av.is-live")),
    );
    expect(live).toEqual([false, true]);
  });
});

describe("the Cast's group form", () => {
  it("starts a new group empty: a waiting place, nothing ticked, Create held back", () => {
    drawForm();
    expect(screen.getByRole("heading", { name: "New group", level: 1 })).toBeTruthy();
    expect(screen.getByRole("form", { name: "New group" })).toBeTruthy();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("");
    expect(name.maxLength).toBe(40);
    expect(
      document.querySelector(".cast-gstage .cast-slot.is-place .blob-av-outline"),
    ).toBeTruthy();
    expect(onStage()).toBe(0);
    expect(screen.getByText("Pick its members.").className).toBe("cast-gform-who");
    expect(picks()).toHaveLength(26);
    expect(picks().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.getByText("0 of 8")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("heading", { name: "How it works" })).toBeTruthy();
    expect(document.querySelectorAll(".kleio-howto li")).toHaveLength(4);
    // Nothing to delete yet, and no colour to pick on the desktop.
    expect(screen.queryByRole("heading", { name: "Delete group" })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(document.querySelector(".kleio-swatch, .kleio-preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stands each ticked member on the stage, up to eight, and creates the group", async () => {
    const made = { ...named("troupe-1"), id: "new" };
    vi.mocked(createGroup).mockResolvedValue(made);
    drawForm();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Crew  " } });
    fireEvent.click(pick("Chef"));
    expect(onStage()).toBe(1);
    expect(document.querySelector(".cast-gform-who")?.textContent).toBe("Chef");
    fireEvent.click(pick("Scout"));
    expect(onStage()).toBe(2);
    expect(document.querySelector(".cast-gstage .is-place")).toBeNull();
    expect(
      (document.querySelector(".cast-gstage") as HTMLElement).style.getPropertyValue("--n"),
    ).toBe("2");
    expect(document.querySelector(".cast-gform-who")?.textContent).toBe("Chef, Scout");
    // Unticking takes it off the stage again.
    fireEvent.click(pick("Chef"));
    expect(onStage()).toBe(1);
    fireEvent.click(pick("Chef"));

    for (const b of picks()
      .filter((x) => x.getAttribute("aria-pressed") === "false")
      .slice(0, 6))
      fireEvent.click(b);
    expect(onStage()).toBe(8);
    expect(screen.getByText("8 of 8 — the group is full")).toBeTruthy();
    const rest = picks().filter((x) => x.getAttribute("aria-pressed") === "false");
    expect(rest).toHaveLength(18);
    expect(rest.every((b) => b.disabled)).toBe(true);
    expect(pick("Chef").disabled).toBe(false);

    await press(screen.getByRole("button", { name: "Create" }));
    expect(createGroup).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(createGroup).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ name: "Crew", emoji: "💬", color: "lilac" });
    expect(sent?.members).toHaveLength(8);
    expect(sent?.members.slice(0, 2)).toEqual(["scout", "chef"]);
    expect(onSaved).toHaveBeenCalledWith(made);
  });

  it("edits a group: its members stand ready, and saving keeps its colour and emoji", async () => {
    const kitchen: Group = { ...named("troupe-1"), color: "mint", emoji: "🍳" };
    vi.mocked(updateGroup).mockResolvedValue(kitchen);
    drawForm(kitchen);
    expect(screen.getByRole("heading", { name: "Edit Kitchen crew", level: 1 })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Kitchen crew");
    expect(onStage()).toBe(2);
    expect(pick("Chef").getAttribute("aria-pressed")).toBe("true");
    expect(pick("Gardener").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("2 of 8")).toBeTruthy();

    fireEvent.click(pick("Herald"));
    await press(screen.getByRole("button", { name: "Save" }));
    expect(updateGroup).toHaveBeenCalledWith("troupe-1", {
      name: "Kitchen crew",
      emoji: "🍳",
      color: "mint",
      members: ["chef", "gardener", "herald"],
    });
    expect(onSaved).toHaveBeenCalledWith(kitchen);
  });

  it("holds Save back without a name or without a member", () => {
    drawForm(named("troupe-3"));
    const save = (): HTMLButtonElement => screen.getByRole("button", { name: "Save" });
    expect(save().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Desk" } });
    fireEvent.click(pick("Herald"));
    expect(save().disabled).toBe(true);
    expect(document.querySelector(".cast-gstage .cast-slot.is-place")).toBeTruthy();
  });

  it("lists a deleted member so it can be taken out", () => {
    drawForm(named("troupe-5"));
    expect(screen.getByText("3 of 8")).toBeTruthy();
    expect(onStage()).toBe(2);
    expect(document.querySelector(".cast-gform-who")?.textContent).toBe("Atlas, Courier");
    const gone = pick("Deleted specialist");
    expect(gone.matches(".is-missing")).toBe(true);
    expect(gone.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(gone);
    expect(screen.getByText("2 of 8")).toBeTruthy();
    expect(screen.queryByText("Deleted specialist")).toBeNull();
  });

  it("says there is nobody to pick when there are no specialists", () => {
    drawForm(undefined, []);
    expect(screen.getByText("No specialists yet — create one first.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Members" })).toBeNull();
  });

  it("shows why saving failed and lets you try again", async () => {
    vi.mocked(updateGroup).mockRejectedValueOnce(new Error("The host said no."));
    drawForm(named("troupe-1"));
    await press(screen.getByRole("button", { name: "Save" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("The host said no.");
    expect(alert.matches(".cast-form > .kleio-error.kleio-page-error")).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("asks before deleting, and deletes only on the answer", async () => {
    vi.mocked(deleteGroup).mockResolvedValue(undefined);
    drawForm(named("troupe-1"));
    expect(screen.getByRole("heading", { name: "Delete group" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Kitchen crew" }));
    expect(deleteGroup).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "Delete Kitchen crew?" });
    await press(within(confirm).getByRole("button", { name: "Delete" }));
    expect(deleteGroup).toHaveBeenCalledWith("troupe-1");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});

describe("the groups' shelf and form with reduced motion", () => {
  const rules = castCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}\n?$/.exec(castCss);
  const still = (/^\s*([^{]+)\{/.exec(block?.[1] ?? "")?.[1] ?? "").split(",").map((s) => s.trim());

  it("holds the shelf still: the dots, the bounce, the spotlight and the pointer", () => {
    expect(still).toEqual(
      expect.arrayContaining([".cast-dot", ".cast-page *", ".cast-page *::before"]),
    );
    const list = castGroups(3);
    const kitchen = list.groups[1] as Group;
    drawList(3, { groups: [list.groups[0] as Group, { ...kitchen, typing: ["chef"] }] });
    for (const sel of [
      ".cast-dot",
      ".cast-bubble.is-typing i",
      ".blob-av.is-live .blob-av-body",
      ".cast-actor",
      ".cast-figure",
      ".cast-profile",
    ]) {
      const found = [...document.querySelectorAll(sel)];
      expect(found.length, sel).toBeGreaterThan(0);
      for (const el of found) expect(el.matches(".cast-dot, .cast-page *"), sel).toBe(true);
    }
  });

  it("holds the form still", () => {
    expect(still).toEqual(expect.arrayContaining([".cast-form *", ".cast-form *::before"]));
    drawForm(named("troupe-1"));
    const root = document.querySelector(".cast-form") as HTMLElement;
    for (const sel of [".cast-gstage .blob-av", ".kleio-member-pick", ".cast-name-input"]) {
      const found = [...document.querySelectorAll(sel)];
      expect(found.length, sel).toBeGreaterThan(0);
      for (const el of found) expect(root.contains(el) && el !== root, sel).toBe(true);
    }
  });

  it("adds nothing that moves on its own: the groups' styles animate and ease nothing", () => {
    const own = [
      ...rules.matchAll(
        /([^{}]*\.cast-(?:huddle|h\b|troupe|g-|gstage|gform|profile\.is-group|first\.is-group)[^{}]*)\{([^{}]*)\}/g,
      ),
    ];
    expect(own.length).toBeGreaterThanOrEqual(20);
    for (const m of own) expect(m[2], m[1]).not.toMatch(/\b(animation|transition)\b/);
  });
});

describe("the groups' shelf and form in a wide window", () => {
  const rules = castCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const wide = [...rules.matchAll(/@media \(min-width: 1400px\) \{([\s\S]*?)\n\}/g)];
  const wideRule = (selector: string): { at: number; body: string } => {
    for (const block of wide) {
      const at = (block[1] ?? "").indexOf(`  ${selector} {`);
      if (at < 0) continue;
      const from = (block.index ?? 0) + block[0].indexOf(block[1] ?? "") + at;
      return { at: from, body: rules.slice(from, rules.indexOf("}", from)) };
    }
    return { at: -1, body: "" };
  };

  it("gives the first run's specialists room as they grow, after the rule it replaces", () => {
    const rule = wideRule(".cast-first.is-group .cast-stage");
    expect(rule.body).toMatch(/grid-template-columns: repeat\(var\(--n\), minmax\(0, 250px\)\);/);
    expect(rule.body).toMatch(/height: 336px;/);
    expect(rule.at).toBeGreaterThan(rules.indexOf("\n.cast-first.is-group .cast-stage {"));
  });

  it("grows the form's members with the wider column, after the rule it replaces", () => {
    const rule = wideRule(".cast-mini.cast-gstage");
    expect(rule.body).toMatch(/--size: clamp\(50px, calc\(410px \/ var\(--n\)\), 126px\);/);
    expect(rule.at).toBeGreaterThan(rules.indexOf("\n.cast-mini.cast-gstage {"));
  });
});
