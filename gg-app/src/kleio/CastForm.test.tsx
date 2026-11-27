// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { JOB_EXAMPLES } from "./BlobForm";
import { systemTimezone } from "./blobFormat";
import { CAST_MODELS, CAST_NOW, castRoster } from "./castFixtures";
import { CastForm } from "./CastForm";
import castCss from "./kleio-cast.css?raw";
import { createBlob, listModels, updateBlob, type Blob, type BlobSaved } from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { useKleioRemote } from "./useKleioRemote";

vi.mock("../RadioButton", () => ({ RadioButton: () => null }));
vi.mock("../WindowLayoutButton", () => ({ WindowLayoutButton: () => null }));
vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  listModels: vi.fn(),
  createBlob: vi.fn(),
  updateBlob: vi.fn(),
}));
vi.mock("./useKleioRemote", () => ({ useKleioRemote: vi.fn() }));

const roster = (): Blob[] => castRoster(7);
const chef = (): Blob => roster().find((b) => b.id === "chef") as Blob;
const onSaved = vi.fn();
const onCancel = vi.fn();
const onChanged = vi.fn(async () => undefined);

/** The form for `blob` (none = a new specialist) among `others`. */
async function draw(
  blob?: Blob,
  others: Blob[] = roster().filter((b) => b.id !== blob?.id),
): Promise<void> {
  render(
    <CastForm
      {...(blob ? { blob } : {})}
      others={others}
      onSaved={onSaved}
      onCancel={onCancel}
      onChanged={onChanged}
      now={CAST_NOW}
    />,
  );
  // The models land.
  await act(async () => {});
}

const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
};
const nameBox = (): HTMLInputElement => screen.getByLabelText("Name");
const jobBox = (): HTMLTextAreaElement => screen.getByLabelText("Job");
const chosen = (group: string): string | null =>
  within(screen.getByRole("radiogroup", { name: new RegExp(`^${group}`) }))
    .getByRole("radio", { checked: true })
    .getAttribute("aria-label");
const submit = (name: string): HTMLButtonElement => screen.getByRole("button", { name });
const press = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const hero = (): HTMLElement =>
  document.querySelector(".cast-mini .cast-slot.is-hero") as HTMLElement;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ now: CAST_NOW, toFake: ["Date"] });
  vi.mocked(listModels).mockResolvedValue(CAST_MODELS);
  vi.mocked(useKleioRemote).mockReturnValue({
    status: null,
    refresh: vi.fn(async () => undefined),
  });
  const saved = (blob: Blob): BlobSaved => ({ blob, autoSchedules: [] }) as unknown as BlobSaved;
  vi.mocked(updateBlob).mockImplementation(async () => saved(chef()));
  vi.mocked(createBlob).mockImplementation(async () => saved(chef()));
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the Cast's form, editing a specialist", () => {
  it("shows who Chef is on the left and what it does on the right", async () => {
    await draw(chef());
    expect(screen.getByRole("heading", { name: "Edit Chef" })).toBeTruthy();
    expect(nameBox().value).toBe("Chef");
    expect(nameBox().maxLength).toBe(40);

    // The character stands on its own shelf, in the spotlight, feet on the line.
    expect(hero().style.getPropertyValue("--foot")).toBe("11%");
    expect(hero().querySelector(".cast-figure .blob-av.cast-bob")).toBeTruthy();
    expect(document.querySelector(".cast-mini .cast-shelf")).toBeTruthy();

    expect([chosen("Shape"), chosen("Face"), chosen("Colour")]).toEqual([
      "Mochi",
      "Happy",
      "Peach",
    ]);
    expect(
      ["Shape", "Face", "Colour"].map(
        (g) =>
          within(screen.getByRole("radiogroup", { name: new RegExp(`^${g}`) })).getAllByRole(
            "radio",
          ).length,
      ),
    ).toEqual([8, 8, 12]);
    expect(screen.getByRole("button", { name: "Brain" }).textContent).toBe(
      "Default — Claude Sonnet 4.5",
    );
    expect(screen.getByText("Cloud — runs on the provider's servers.")).toBeTruthy();

    expect(jobBox().value).toBe(chef().job);
    expect(jobBox().rows).toBe(3);
    expect(
      screen.getByText("One job, in plain words. Say when it should happen and what to send back."),
    ).toBeTruthy();
    expect(
      screen.getByText(/^When the job changes, “every weekday at 7:30” replaces/),
    ).toBeTruthy();
    expect((screen.getByLabelText("Read timing from the job") as HTMLInputElement).checked).toBe(
      true,
    );
    // Only a new specialist is offered example jobs.
    expect(screen.queryByRole("group", { name: "Example jobs" })).toBeNull();

    // Its schedules are in the form, beside the job.
    const schedules = screen.getByRole("region", { name: /^Schedules/ });
    expect(within(schedules).getByRole("group", { name: "Thursday top-up" })).toBeTruthy();
    expect(within(schedules).getByRole("button", { name: "Add" })).toBeTruthy();
    expect(submit("Save").disabled).toBe(false);
  });

  it("keeps the schedules out of the specialist's own form, so saving one never saves the other", async () => {
    await draw(chef());
    const form = screen.getByRole("form", { name: "Edit Chef" }) as HTMLFormElement;
    expect(form.contains(nameBox())).toBe(true);
    // The job's fields sit beside it and join it by id.
    expect(form.contains(jobBox())).toBe(false);
    expect(jobBox().form).toBe(form);
    expect(submit("Save").getAttribute("form")).toBe(form.id);
    expect(form.contains(screen.getByRole("region", { name: /^Schedules/ }))).toBe(false);
    for (const b of within(screen.getByRole("region", { name: /^Schedules/ })).getAllByRole(
      "button",
    ))
      expect((b as HTMLButtonElement).type).toBe("button");
  });

  it("saves the name and the look, and leaves the schedules alone when the job is the same", async () => {
    await draw(chef());
    type(nameBox(), "  Sous chef ");
    fireEvent.click(screen.getByRole("radio", { name: "Star" }));
    fireEvent.click(screen.getByRole("radio", { name: "Wink" }));
    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    expect([chosen("Shape"), chosen("Face"), chosen("Colour")]).toEqual(["Star", "Wink", "Teal"]);
    // The star's own feet meet the shelf.
    expect(hero().style.getPropertyValue("--foot")).toBe("9%");
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Edit Chef" }));
    });
    expect(updateBlob).toHaveBeenCalledWith("chef", {
      name: "Sous chef",
      color: "teal",
      shape: "star",
      face: "wink",
      job: chef().job,
      model: null,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("reads the timing again when the job changes, unless you switch that off", async () => {
    await draw(chef());
    type(jobBox(), "Every Saturday at 10, plan the week’s dinners.");
    let land: (v: BlobSaved) => void = () => undefined;
    vi.mocked(updateBlob).mockImplementation(() => new Promise<BlobSaved>((ok) => (land = ok)));
    await press(submit("Save"));
    // The host is reading the job: say so, and don't send it twice.
    expect(submit("Saving… reading the job").disabled).toBe(true);
    expect(updateBlob).toHaveBeenCalledWith(
      "chef",
      expect.objectContaining({
        job: "Every Saturday at 10, plan the week’s dinners.",
        timezone: systemTimezone(),
        autoSchedule: true,
      }),
    );
    await act(async () => land({ blob: chef(), autoSchedules: [] } as unknown as BlobSaved));
    expect(onSaved).toHaveBeenCalledTimes(1);
    cleanup();

    await draw(chef());
    type(jobBox(), "Plan dinners when I ask.");
    fireEvent.click(screen.getByLabelText("Read timing from the job"));
    await press(submit("Save"));
    expect(submit("Saving…")).toBeTruthy();
    expect(vi.mocked(updateBlob).mock.lastCall?.[1]).toMatchObject({ autoSchedule: false });
  });

  it("says what went wrong when the host refuses, and lets you try again", async () => {
    vi.mocked(updateBlob).mockRejectedValue(new Error("That name is taken."));
    await draw(chef());
    await press(submit("Save"));
    expect(screen.getByRole("alert").textContent).toBe("That name is taken.");
    expect(submit("Save").disabled).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("won't save without a name or a job", async () => {
    await draw(chef());
    type(nameBox(), "   ");
    expect(submit("Save").disabled).toBe(true);
    type(nameBox(), "Chef");
    type(jobBox(), "");
    expect(submit("Save").disabled).toBe(true);
    expect(nameBox().required && jobBox().required).toBe(true);
  });

  it("counts the job's length once it is long enough to matter", async () => {
    await draw(chef());
    expect(document.querySelector(".kleio-count-line")).toBeNull();
    type(jobBox(), "x".repeat(6000));
    expect(screen.getByText("6,000 / 8,000")).toBeTruthy();
    expect(jobBox().maxLength).toBe(8000);
  });

  it("moves through a row of looks with the arrow keys, and shuffles to another look", async () => {
    await draw(chef());
    fireEvent.keyDown(screen.getByRole("radio", { name: "Mochi" }), { key: "ArrowRight" });
    expect(chosen("Shape")).toBe("Drop");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Drop" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "Sky" }), { key: "ArrowLeft" });
    expect(chosen("Colour")).toBe("Slate");

    const before = [chosen("Shape"), chosen("Face"), chosen("Colour")].join();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle the look" }));
    expect([chosen("Shape"), chosen("Face"), chosen("Colour")].join()).not.toBe(before);
  });

  it("offers the brains once they load, and says where the chosen one runs", async () => {
    let land: (v: typeof CAST_MODELS) => void = () => undefined;
    vi.mocked(listModels).mockImplementation(() => new Promise((ok) => (land = ok)));
    await draw(chef());
    const brain = (): HTMLButtonElement => screen.getByRole("button", { name: "Brain" });
    expect(brain().disabled).toBe(true);
    expect(brain().textContent).toBe("Default");
    expect(document.querySelector(".cast-note")).toBeNull();
    await act(async () => land(CAST_MODELS));
    expect(brain().disabled).toBe(false);

    fireEvent.click(brain());
    fireEvent.click(screen.getByRole("option", { name: /^Qwen3 14B/ }));
    expect(screen.getByText("Private — runs on your host.")).toBeTruthy();
    fireEvent.click(brain());
    fireEvent.click(screen.getByRole("option", { name: /^Llama 3\.3 70B/ }));
    expect(screen.getByText("Private — runs in Tinfoil's sealed cloud.")).toBeTruthy();
    await press(submit("Save"));
    expect(vi.mocked(updateBlob).mock.lastCall?.[1]).toMatchObject({ model: "llama" });
  });

  it("still opens when the host can't list its brains", async () => {
    vi.mocked(listModels).mockRejectedValue(new Error("offline"));
    await draw(chef());
    expect(screen.getByRole("button", { name: "Brain" }).textContent).toBe("Default");
    expect(document.querySelector(".cast-note")).toBeNull();
    expect(submit("Save").disabled).toBe(false);
  });

  it("offers an older host only the six colours it knows, and sends it no shape or face", async () => {
    const old = (b: Blob): Blob => {
      const { shape: _shape, face: _face, ...rest } = b;
      return rest;
    };
    await draw(old(chef()), roster().slice(0, 3).map(old));
    expect(
      within(screen.getByRole("radiogroup", { name: /^Colour/ })).getAllByRole("radio"),
    ).toHaveLength(6);
    await press(submit("Save"));
    expect(vi.mocked(updateBlob).mock.lastCall?.[1]).toEqual({
      name: "Chef",
      color: "peach",
      job: chef().job,
      model: null,
    });
  });

  it("leaves by Cancel or Back without saving", async () => {
    await draw(chef());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(updateBlob).not.toHaveBeenCalled();
  });

  it("asks before Cancel or Back loses a schedule edit, and stays when you keep editing", async () => {
    await draw(chef());
    const scheduleName = (): HTMLInputElement => screen.getByLabelText("Schedule name");
    type(scheduleName(), "Thursday shop");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const ask = screen.getByRole("dialog", { name: "Discard schedule changes?" });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(scheduleName().value).toBe("Thursday shop");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Discard schedule changes?" })).getByRole(
        "button",
        { name: "Discard" },
      ),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before the header's Save leaves a schedule edit behind, then saves the specialist alone", async () => {
    await draw(chef());
    type(screen.getByLabelText("Schedule name"), "Thursday shop");
    type(nameBox(), "Cook");
    await press(submit("Save"));
    const ask = screen.getByRole("dialog", { name: "Discard schedule changes?" });
    expect(updateBlob).not.toHaveBeenCalled();
    await press(within(ask).getByRole("button", { name: "Discard" }));
    expect(updateBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateBlob).mock.calls[0]?.[1]).toMatchObject({ name: "Cook" });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask once the schedule edit is put back", async () => {
    await draw(chef());
    type(screen.getByLabelText("Schedule name"), "Thursday shop");
    fireEvent.click(screen.getByRole("button", { name: "Cancel schedule changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("the Cast's form, making a specialist", () => {
  it("starts empty with a look unlike the others, and can't create yet", async () => {
    await draw();
    expect(screen.getByRole("heading", { name: "New specialist" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "New specialist" })).toBeTruthy();
    expect(nameBox().value).toBe("");
    expect(nameBox().placeholder).toBe("Chef");
    expect(document.activeElement).toBe(nameBox());
    expect(jobBox().value).toBe("");
    expect(submit("Create").disabled).toBe(true);
    const look = [chosen("Shape"), chosen("Face"), chosen("Colour")].join().toLowerCase();
    expect(roster().map((b) => `${b.shape},${b.face},${b.color}`)).not.toContain(look);
    expect(
      screen.getByText("“Every weekday at 7:30” becomes a schedule you can change later."),
    ).toBeTruthy();

    // Nothing to schedule until it exists: the week, the zone, and no Add.
    const schedules = screen.getByRole("region", { name: "Schedules" });
    expect(within(schedules).getAllByRole("listitem")).toHaveLength(7);
    expect(within(schedules).getByText(`Times are in ${systemTimezone()}.`)).toBeTruthy();
    expect(within(schedules).queryByRole("button")).toBeNull();
  });

  it("starts from the job of an example picked on the first run", async () => {
    const startJob = JOB_EXAMPLES[1]?.job ?? "";
    render(
      <CastForm
        others={[]}
        startJob={startJob}
        onSaved={onSaved}
        onCancel={onCancel}
        onChanged={onChanged}
        now={CAST_NOW}
      />,
    );
    await act(async () => {});
    expect(startJob).toMatch(/^Every Sunday at 5pm/);
    expect(jobBox().value).toBe(startJob);
    // The job is there, so the form's own examples step aside; the name is still to give.
    expect(screen.queryByRole("group", { name: "Example jobs" })).toBeNull();
    expect(nameBox().value).toBe("");
    expect(document.activeElement).toBe(nameBox());
    expect(submit("Create").disabled).toBe(true);
    type(nameBox(), "Chef");
    await press(submit("Create"));
    expect(vi.mocked(createBlob).mock.calls[0]?.[0]).toMatchObject({
      name: "Chef",
      job: startJob,
      autoSchedule: true,
    });
  });

  it("fills the job from an example, then creates it on this Mac's clock", async () => {
    await draw();
    const examples = screen.getByRole("group", { name: "Example jobs" });
    expect(
      within(examples)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Morning news", "Weekly meal plan", "Research on request"]);
    fireEvent.click(within(examples).getByRole("button", { name: "Weekly meal plan" }));
    expect(jobBox().value).toMatch(/^Every Sunday at 5pm, plan three dinners/);
    expect(screen.queryByRole("group", { name: "Example jobs" })).toBeNull();
    expect(submit("Create").disabled).toBe(true);

    type(nameBox(), "Chef");
    fireEvent.click(screen.getByRole("radio", { name: "Mochi" }));
    fireEvent.click(screen.getByRole("radio", { name: "Happy" }));
    fireEvent.click(screen.getByRole("radio", { name: "Peach" }));
    let land: (v: BlobSaved) => void = () => undefined;
    vi.mocked(createBlob).mockImplementation(() => new Promise<BlobSaved>((ok) => (land = ok)));
    await press(submit("Create"));
    expect(submit("Saving… reading the job").disabled).toBe(true);
    expect(createBlob).toHaveBeenCalledWith({
      name: "Chef",
      color: "peach",
      shape: "mochi",
      face: "happy",
      job: jobBox().value,
      timezone: systemTimezone(),
      autoSchedule: true,
    });
    const made = { blob: chef(), autoSchedules: [] } as unknown as BlobSaved;
    await act(async () => land(made));
    expect(onSaved).toHaveBeenCalledWith(made);
    expect(updateBlob).not.toHaveBeenCalled();
  });

  it("creates with a chosen brain and without reading the timing, when asked", async () => {
    await draw();
    type(nameBox(), "Scout");
    type(jobBox(), "Research a topic when I ask.");
    fireEvent.click(screen.getByLabelText("Read timing from the job"));
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    fireEvent.click(screen.getByRole("option", { name: /^Claude Haiku 4\.5/ }));
    await press(submit("Create"));
    expect(vi.mocked(createBlob).mock.calls[0]?.[0]).toMatchObject({
      model: "haiku",
      autoSchedule: false,
    });
  });
});

describe("the Cast's form with reduced motion", () => {
  it("holds its character, switches and menus still", async () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}\n?$/.exec(castCss);
    const rule = /^\s*([^{]+)\{([^}]*)\}/.exec(block?.[1] ?? "");
    expect(rule?.[2]).toContain("animation: none !important");
    expect(rule?.[2]).toContain("transition: none !important");
    const still = (rule?.[1] ?? "").split(",").map((s) => s.trim());
    expect(still).toEqual(
      expect.arrayContaining([".cast-form *", ".cast-form *::before", ".cast-form *::after"]),
    );

    // Everything the form animates or eases is inside it, so that rule reaches it:
    // the character's bob, the shuffle and look buttons, the switches, the menu.
    await draw(chef());
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    const root = document.querySelector(".cast-form") as HTMLElement;
    for (const sel of [
      ".blob-av.cast-bob",
      ".cast-shuffle",
      ".kleio-look-option",
      ".cast-switch > span",
      ".cast-slot.is-hero",
      ".dropdown-menu",
      ".dropdown-chevron",
    ]) {
      const found = [...document.querySelectorAll(sel)];
      expect(found.length, sel).toBeGreaterThan(0);
      for (const el of found) expect(root.contains(el) && el !== root, sel).toBe(true);
    }
    // And every transition the form's own styles declare is on something inside it.
    const eased = [
      ...castCss
        .slice(castCss.indexOf("/* ── the form"), castCss.indexOf("/* ── the group's room"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{[^{}]*\btransition:/g),
    ].map((m) => (m[1] ?? "").trim());
    expect(eased.length).toBeGreaterThanOrEqual(4);
    for (const sel of eased) expect(sel, sel).toMatch(/^\.cast-(shuffle|pickers|switch)/);
  });
});

describe("the Cast's form in a wide window", () => {
  it("widens the spotlight with the character, as the mockup does from 1400 px", () => {
    const form = castCss
      .slice(castCss.indexOf("/* ── the form"), castCss.indexOf("/* ── a group's form"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const wide = /@media \(min-width: 1400px\) \{([\s\S]*?)\n\}/.exec(form)?.[1] ?? "";
    const mini = /\n {2}\.cast-mini \{([^}]*)\}/.exec(wide)?.[1] ?? "";
    expect(mini).toMatch(/--size: 168px;/);
    expect(mini).toMatch(/--cone-w: 300px;/);
    expect(mini).toMatch(/--cone-h: 230px;/);
  });
});
