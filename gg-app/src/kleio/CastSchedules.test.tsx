// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { systemTimezone } from "./blobFormat";
import { CAST_NOW, castRoster } from "./castFixtures";
import { castWeek, soonest } from "./castLayout";
import { CastSchedules } from "./CastSchedules";
import {
  addSchedule,
  deleteSchedule,
  runScheduleNow,
  updateSchedule,
  type Blob,
  type Schedule,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { useKleioRemote } from "./useKleioRemote";

vi.mock("../RadioButton", () => ({ RadioButton: () => null }));
vi.mock("../WindowLayoutButton", () => ({ WindowLayoutButton: () => null }));
vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  addSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  runScheduleNow: vi.fn(),
}));
vi.mock("./useKleioRemote", () => ({ useKleioRemote: vi.fn() }));

const at = (day: number, hour: number, minute: number): string =>
  new Date(2026, 10, 9 + day, hour, minute).toISOString();

/** The mockup's Chef: Sunday dinners (read from the job) and a Thursday top-up. */
const chef = (): Blob => castRoster(7).find((b) => b.id === "chef") as Blob;
const TOP_UP = (): Schedule => chef().schedules[1] as Schedule;
const one = (over: Partial<Schedule>): Schedule => ({ ...TOP_UP(), ...over });
const KINDS: Record<string, Schedule> = {
  daily: one({ id: "k-daily", label: "Stock check", kind: "daily", time: "09:15" }),
  interval: one({ id: "k-every", label: "Market prices", kind: "interval", everyMinutes: 120 }),
  once: one({ id: "k-once", label: "Birthday cake", kind: "once", at: at(3, 18, 30) }),
  later: one({ id: "k-later", label: "Christmas menu", kind: "once", at: at(41, 10, 0) }),
};

const onChanged = vi.fn(async () => undefined);

async function draw(blob?: Blob): Promise<(next: Blob) => void> {
  const node = (b?: Blob): React.ReactElement => (
    <CastSchedules {...(b ? { blob: b } : {})} onChanged={onChanged} now={CAST_NOW} />
  );
  const view = render(node(blob));
  await act(async () => {});
  return (next) => view.rerender(node(next));
}

const withSchedules = (schedules: Schedule[]): Blob => ({ ...chef(), schedules });
const mark = (name: RegExp): HTMLElement => screen.getByRole("button", { name });
const editor = (name: string): HTMLElement => screen.getByRole("group", { name });
const kindOf = (el: HTMLElement): string | null =>
  within(el).getByRole("radio", { checked: true }).textContent;
const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
};
const settle = (): Promise<void> => act(async () => {});

beforeEach(() => {
  // jsdom has no layout: the menu's "keep the active row in view" has nothing to do.
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ now: CAST_NOW, toFake: ["Date"] });
  vi.mocked(useKleioRemote).mockReturnValue({
    status: {
      active: {
        base: "https://mac-mini-1.example.ts.net:8443",
        host: "mac-mini-1.example.ts.net",
        deviceId: "d1",
        label: "Mac",
        admin: false,
      },
      paired: null,
    },
    refresh: vi.fn(async () => undefined),
  });
  vi.mocked(updateSchedule).mockImplementation(async (_id, sid, patch) =>
    one({ id: sid, ...patch }),
  );
  vi.mocked(addSchedule).mockImplementation(async (_id, input) =>
    one({ ...input, id: "made", nextRunAt: null }),
  );
  vi.mocked(deleteSchedule).mockResolvedValue(undefined);
  vi.mocked(runScheduleNow).mockResolvedValue({} as Awaited<ReturnType<typeof runScheduleNow>>);
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the week in the form", () => {
  it("lays each schedule over Monday to Sunday, and keeps the ones with no day underneath", () => {
    const week = castWeek(
      [...chef().schedules, ...Object.values(KINDS)].map((s) => s),
      CAST_NOW,
    );
    expect(week.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    const on = (day: number): string[] =>
      (week.days.find((d) => d.day === day)?.marks ?? []).map(
        (m) => `${m.text} ${m.schedule.label}`,
      );
    // Daily stands on all seven; a day's marks run in time order, ties as listed.
    expect(on(1)).toEqual(["09:15 Stock check"]);
    expect(on(4)).toEqual(["09:15 Stock check", "18:30 Thursday top-up", "18:30 Birthday cake"]);
    expect(on(0)).toEqual(["09:15 Stock check", "17:00 Sunday dinners"]);
    // A repeat has no day; nor has a one-off in another week.
    expect(week.loose.map((m) => `${m.text} | ${m.schedule.label}`)).toEqual([
      "Every 2 hours | Market prices",
      "Sun 20 Dec 10:00 | Christmas menu",
    ]);
  });

  it("opens on the next schedule to run, else the first", () => {
    expect(soonest(chef().schedules)?.label).toBe("Thursday top-up");
    const off = chef().schedules.map((s) => ({ ...s, enabled: false, nextRunAt: null }));
    expect(soonest(off)?.label).toBe("Sunday dinners");
    expect(soonest([])).toBeNull();
  });

  it("draws Chef's week: the top-up selected on Thursday, the dinners dashed on Sunday", async () => {
    await draw(chef());
    const card = screen.getByRole("region", { name: /^Schedules/ });
    expect(within(card).getByRole("heading").textContent).toBe("Schedules2");
    expect(within(card).getByText(systemTimezone())).toBeTruthy();
    const days = within(screen.getByRole("list", { name: "This week" })).getAllByRole("listitem");
    expect(days.map((d) => d.querySelector(".cast-wd")?.textContent)).toEqual(
      "Mon Tue Wed Thu Fri Sat Sun".split(" "),
    );
    expect(days.map((d) => d.querySelectorAll(".cast-mark").length)).toEqual([0, 0, 0, 1, 0, 0, 1]);

    const topUp = mark(/^Thursday top-up, Thursday 18:30$/);
    expect(topUp.getAttribute("aria-pressed")).toBe("true");
    expect(topUp.className).toBe("cast-mark is-sel");
    expect(topUp.textContent).toBe("18:30Thursday top-up");
    const dinners = mark(/^Sunday dinners, Sunday 17:00, read from the job$/);
    expect(dinners.getAttribute("aria-pressed")).toBe("false");
    expect(dinners.className).toBe("cast-mark is-auto");
    expect(dinners.title).toBe("Read from the job");
    expect(screen.getByText(/^Dashed: read from the job/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Not on a day this week" })).toBeNull();

    // The selected one is open underneath, as the host holds it.
    const open = editor("Thursday top-up");
    expect((within(open).getByLabelText("Schedule name") as HTMLInputElement).value).toBe(
      "Thursday top-up",
    );
    expect((within(open).getByLabelText("What to do") as HTMLTextAreaElement).value).toBe(
      "Check what’s left from Sunday’s list and suggest a top-up shop.",
    );
    expect(within(open).getByText("next Thu 12 Nov 18:30")).toBeTruthy();
    expect((within(open).getByLabelText("Thursday top-up on") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (within(open).getByLabelText("Notify me with the result") as HTMLInputElement).checked,
    ).toBe(true);
    expect(within(open).queryByText("Auto")).toBeNull();

    // Another mark opens that one instead.
    fireEvent.click(dinners);
    expect(mark(/^Sunday dinners/).className).toBe("cast-mark is-auto is-sel");
    expect(within(editor("Sunday dinners")).getByText("Auto").title).toBe("Read from the job");
    expect(within(editor("Sunday dinners")).getByText("next Sun 15 Nov 17:00")).toBeTruthy();
  });

  it("says so when there are none, and shows no editor or legend", async () => {
    await draw(withSchedules([]));
    expect(screen.getByText(/^No schedules\. Mention timing in the job/)).toBeTruthy();
    expect(document.querySelector(".cast-se, .cast-legend, .cast-mark")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("Schedules0");
  });

  it("on a new specialist shows the empty week and the zone, with nothing to add yet", async () => {
    await draw();
    expect(screen.getByRole("heading").textContent).toBe("Schedules");
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText(`Times are in ${systemTimezone()}.`)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a schedule's kinds", () => {
  it("Weekly: its days as letters and its time", async () => {
    await draw(chef());
    const open = editor("Thursday top-up");
    expect(kindOf(open)).toBe("Weekly");
    const days = within(within(open).getByRole("group", { name: "Days" })).getAllByRole("button");
    expect(days.map((d) => d.textContent).join("")).toBe("MTWTFSS");
    expect(days.filter((d) => d.getAttribute("aria-pressed") === "true")).toEqual([
      within(open).getByRole("button", { name: "Thursday" }),
    ]);
    expect((within(open).getByLabelText("Time") as HTMLInputElement).value).toBe("18:30");
    expect(within(open).queryByLabelText("Date and time")).toBeNull();
    expect(within(open).queryByRole("button", { name: "Every" })).toBeNull();
  });

  it("Daily: a time and no days, on every day of the week", async () => {
    await draw(withSchedules([KINDS.daily as Schedule]));
    expect(document.querySelectorAll(".cast-week .cast-mark")).toHaveLength(7);
    expect(mark(/^Stock check, Wednesday 09:15$/).getAttribute("aria-pressed")).toBe("true");
    const open = editor("Stock check");
    expect(kindOf(open)).toBe("Daily");
    expect((within(open).getByLabelText("Time") as HTMLInputElement).value).toBe("09:15");
    expect(within(open).queryByRole("group", { name: "Days" })).toBeNull();
  });

  it("Repeat: how often, under the week since it has no day", async () => {
    await draw(withSchedules([KINDS.interval as Schedule]));
    expect(document.querySelector(".cast-week .cast-mark")).toBeNull();
    const loose = screen.getByRole("group", { name: "Not on a day this week" });
    expect(within(loose).getByRole("button").textContent).toBe("Every 2 hoursMarket prices");
    const open = editor("Market prices");
    expect(kindOf(open)).toBe("Repeat");
    expect(within(open).getByRole("button", { name: "Every" }).textContent).toBe("Every 2 hours");
    expect(within(open).queryByLabelText("Time")).toBeNull();
    expect(within(open).queryByRole("group", { name: "Days" })).toBeNull();
  });

  it("Once: a date and time, on its day this week or under the week", async () => {
    await draw(withSchedules([KINDS.once as Schedule, KINDS.later as Schedule]));
    expect(mark(/^Birthday cake, Thursday 18:30$/)).toBeTruthy();
    const later = mark(/^Christmas menu, Sun 20 Dec 10:00$/);
    expect(later.closest('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Not on a day this week",
    );
    fireEvent.click(later);
    const open = editor("Christmas menu");
    expect(kindOf(open)).toBe("Once");
    expect((within(open).getByLabelText("Date and time") as HTMLInputElement).value).toBe(
      "2026-12-20T10:00",
    );
    expect(within(open).queryByLabelText("Time")).toBeNull();
  });

  it("changes kind in place, and saves what that kind needs", async () => {
    await draw(chef());
    const open = editor("Thursday top-up");
    const pickKind = (name: string): void => {
      fireEvent.click(within(open).getByRole("radio", { name }));
    };
    const save = async (): Promise<unknown> => {
      await act(async () => {
        fireEvent.click(within(open).getByRole("button", { name: "Save schedule" }));
      });
      return vi.mocked(updateSchedule).mock.lastCall?.[2];
    };
    const base = {
      label: "Thursday top-up",
      prompt: "Check what’s left from Sunday’s list and suggest a top-up shop.",
      timezone: "Europe/London",
      notify: true,
    };

    pickKind("Daily");
    expect(within(open).queryByRole("group", { name: "Days" })).toBeNull();
    type(within(open).getByLabelText("Time"), "07:45");
    expect(await save()).toEqual({ ...base, kind: "daily", time: "07:45" });

    pickKind("Repeat");
    fireEvent.click(within(open).getByRole("button", { name: "Every" }));
    fireEvent.click(screen.getByRole("option", { name: "Every 4 hours" }));
    expect(await save()).toEqual({ ...base, kind: "interval", everyMinutes: 240 });

    pickKind("Once");
    type(within(open).getByLabelText("Date and time"), "2026-11-21T09:00");
    expect(await save()).toEqual({
      ...base,
      kind: "once",
      at: new Date(2026, 10, 21, 9, 0).toISOString(),
    });

    pickKind("Weekly");
    fireEvent.click(within(open).getByRole("button", { name: "Monday" }));
    expect(await save()).toEqual({ ...base, kind: "weekly", time: "07:45", days: [1, 4] });
    expect(updateSchedule).toHaveBeenCalledTimes(4);
    expect(vi.mocked(updateSchedule).mock.calls[0]?.slice(0, 2)).toEqual(["chef", "chef-s2"]);
  });
});

describe("editing a schedule in the form", () => {
  it("offers Save and Cancel only once something changed, and Cancel puts it back", async () => {
    await draw(chef());
    const open = (): HTMLElement => editor("Thursday top-up");
    expect(within(open()).getByRole("button", { name: "Run now" })).toBeTruthy();
    expect(within(open()).queryByRole("button", { name: "Save schedule" })).toBeNull();

    type(within(open()).getByLabelText("Schedule name"), "Friday top-up");
    fireEvent.click(within(open()).getByLabelText("Notify me with the result"));
    // A changed schedule is saved or put back before it can be run.
    expect(within(open()).queryByRole("button", { name: "Run now" })).toBeNull();
    expect(within(open()).getByRole("button", { name: "Save schedule" })).toBeTruthy();
    expect(within(open()).getByRole("button", { name: "Delete Thursday top-up" })).toBeTruthy();

    fireEvent.click(within(open()).getByRole("button", { name: "Cancel schedule changes" }));
    expect((within(open()).getByLabelText("Schedule name") as HTMLInputElement).value).toBe(
      "Thursday top-up",
    );
    expect(
      (within(open()).getByLabelText("Notify me with the result") as HTMLInputElement).checked,
    ).toBe(true);
    expect(within(open()).getByRole("button", { name: "Run now" })).toBeTruthy();
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it("saves the words to the host, then shows what the host now holds", async () => {
    const redraw = await draw(chef());
    const open = editor("Thursday top-up");
    type(within(open).getByLabelText("Schedule name"), "  Friday top-up ");
    type(within(open).getByLabelText("What to do"), "Suggest a top-up shop.");
    fireEvent.click(within(open).getByRole("button", { name: "Thursday" }));
    // A weekly schedule needs a day.
    expect(
      within(open).getByRole<HTMLButtonElement>("button", { name: "Save schedule" }).disabled,
    ).toBe(true);
    fireEvent.click(within(open).getByRole("button", { name: "Friday" }));
    await act(async () => {
      fireEvent.click(within(open).getByRole("button", { name: "Save schedule" }));
    });
    expect(updateSchedule).toHaveBeenCalledWith("chef", "chef-s2", {
      label: "Friday top-up",
      prompt: "Suggest a top-up shop.",
      kind: "weekly",
      time: "18:30",
      days: [5],
      timezone: "Europe/London",
      notify: true,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);

    const saved = chef();
    saved.schedules[1] = one({
      label: "Friday top-up",
      prompt: "Suggest a top-up shop.",
      days: [5],
      nextRunAt: at(4, 18, 30),
    });
    redraw(saved);
    const now = editor("Friday top-up");
    expect(mark(/^Friday top-up, Friday 18:30$/).getAttribute("aria-pressed")).toBe("true");
    expect(within(now).getByText("next Fri 13 Nov 18:30")).toBeTruthy();
    expect(within(now).getByRole("button", { name: "Run now" })).toBeTruthy();
  });

  it("needs a name and something to do", async () => {
    await draw(chef());
    const open = editor("Thursday top-up");
    const save = (): HTMLButtonElement =>
      within(open).getByRole("button", { name: "Save schedule" });
    type(within(open).getByLabelText("Schedule name"), " ");
    expect(save().disabled).toBe(true);
    type(within(open).getByLabelText("Schedule name"), "Top-up");
    expect(save().disabled).toBe(false);
    type(within(open).getByLabelText("What to do"), "");
    expect(save().disabled).toBe(true);
  });

  it("says what went wrong when the host refuses, and keeps what was typed", async () => {
    vi.mocked(updateSchedule).mockRejectedValue(new Error("The host said no."));
    await draw(chef());
    const open = editor("Thursday top-up");
    type(within(open).getByLabelText("Schedule name"), "Friday top-up");
    await act(async () => {
      fireEvent.click(within(open).getByRole("button", { name: "Save schedule" }));
    });
    expect(within(open).getByRole("alert").textContent).toBe("The host said no.");
    expect((within(open).getByLabelText("Schedule name") as HTMLInputElement).value).toBe(
      "Friday top-up",
    );
    expect(
      within(open).getByRole<HTMLButtonElement>("button", { name: "Save schedule" }).disabled,
    ).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("switches a schedule off at once, and shows it off", async () => {
    const redraw = await draw(chef());
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Thursday top-up on"));
    });
    expect(updateSchedule).toHaveBeenCalledWith("chef", "chef-s2", { enabled: false });
    expect(onChanged).toHaveBeenCalledTimes(1);

    const off = chef();
    off.schedules[1] = one({ enabled: false, nextRunAt: null });
    redraw(off);
    fireEvent.click(mark(/^Thursday top-up, Thursday 18:30, off$/));
    expect(mark(/^Thursday top-up/).className).toBe("cast-mark is-sel is-off");
    expect(within(editor("Thursday top-up")).getByText("off")).toBeTruthy();
    expect((screen.getByLabelText("Thursday top-up on") as HTMLInputElement).checked).toBe(false);
  });

  it("runs one now and says where the result will show", async () => {
    vi.useFakeTimers({ now: CAST_NOW });
    await draw(chef());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    });
    expect(runScheduleNow).toHaveBeenCalledWith("chef", "chef-s2");
    expect(screen.getByText("Started — the result will show in Recent activity.")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/^Started/)).toBeNull();
  });

  it("asks before deleting one", async () => {
    await draw(chef());
    fireEvent.click(screen.getByRole("button", { name: "Delete Thursday top-up" }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText("Delete “Thursday top-up”?")).toBeTruthy();
    expect(deleteSchedule).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    });
    expect(deleteSchedule).toHaveBeenCalledWith("chef", "chef-s2");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the host's refusal over the week when a switch, run or delete fails", async () => {
    vi.mocked(runScheduleNow).mockRejectedValue(new Error("The host is asleep."));
    await draw(chef());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("The host is asleep.");
    expect(screen.queryByText(/^Started/)).toBeNull();
  });

  it("adds a new one: daily at 08:00 until you say otherwise", async () => {
    const redraw = await draw(chef());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const fresh = editor("New schedule");
    expect(within(fresh).getByText("New schedule")).toBeTruthy();
    expect(kindOf(fresh)).toBe("Daily");
    expect((within(fresh).getByLabelText("Time") as HTMLInputElement).value).toBe("08:00");
    // Nothing on the host yet to switch, run or delete; no mark is selected.
    expect(within(fresh).queryByRole("button", { name: /^(Run now|Delete)/ })).toBeNull();
    expect(within(fresh).queryByLabelText(/ on$/)).toBeNull();
    expect(document.querySelector(".cast-mark.is-sel")).toBeNull();
    const save = within(fresh).getByRole<HTMLButtonElement>("button", { name: "Save schedule" });
    expect(save.disabled).toBe(true);

    type(within(fresh).getByLabelText("Schedule name"), "Stock check");
    type(within(fresh).getByLabelText("What to do"), "List what is running low.");
    fireEvent.click(within(fresh).getByLabelText("Notify me with the result"));
    await act(async () => {
      fireEvent.click(save);
    });
    expect(addSchedule).toHaveBeenCalledWith("chef", {
      label: "Stock check",
      prompt: "List what is running low.",
      kind: "daily",
      time: "08:00",
      timezone: systemTimezone(),
      notify: false,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The host's list now has it: it is the one open.
    const made = one({
      id: "made",
      label: "Stock check",
      kind: "daily",
      time: "08:00",
      notify: false,
    });
    redraw(withSchedules([...chef().schedules, made]));
    expect(editor("Stock check")).toBeTruthy();
    expect(mark(/^Stock check, Monday 08:00$/).getAttribute("aria-pressed")).toBe("true");
  });

  it("drops a new one on Cancel, back to the one that was open", async () => {
    await draw(chef());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel new schedule" }));
    await settle();
    expect(screen.queryByRole("group", { name: "New schedule" })).toBeNull();
    expect(editor("Thursday top-up")).toBeTruthy();
    expect(addSchedule).not.toHaveBeenCalled();
  });

  it("says when a schedule's last run was late because the host slept", async () => {
    const late = one({
      lastRun: { at: at(-4, 18, 52), outcome: "ran", late: { dueAt: "2026-11-05T18:30:00.000Z" } },
    } as Partial<Schedule>);
    await draw(withSchedules([late]));
    expect(screen.getByText("Ran late: mac-mini-1 was asleep at 18:30.")).toBeTruthy();
  });
});
