import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./kleioApi";
import { createVoiceTools, matchByName } from "./voiceTools";

vi.mock("./kleioApi", () => ({
  getBrief: vi.fn(),
  getHome: vi.fn(),
  getBlobSession: vi.fn(),
  listBlobs: vi.fn(),
  listGroups: vi.fn(),
  listGroupMessages: vi.fn(),
  listRuns: vi.fn(),
  runBrainTool: vi.fn(),
  sendGroupMessage: vi.fn(),
  startChat: vi.fn(),
  threadPrompt: vi.fn(),
}));

const CHEF = { id: "b1", name: "Chef", job: "Plans dinners.", running: false, schedules: [] };
const SCOUT = { id: "b2", name: "Scout", job: "Finds news.", running: true, schedules: [] };
const LAUNCH = { id: "g1", name: "Launch", members: ["b1", "b2"], typing: [] };

afterEach(() => vi.clearAllMocks());

function setup(): { tools: ReturnType<typeof createVoiceTools>; onEnd: () => void } {
  vi.mocked(api.listBlobs).mockResolvedValue([CHEF, SCOUT] as unknown as api.Blob[]);
  vi.mocked(api.listGroups).mockResolvedValue([LAUNCH] as unknown as api.Group[]);
  const onEnd = vi.fn();
  return { tools: createVoiceTools({ onEnd }), onEnd };
}

describe("matchByName", () => {
  const items = [{ name: "Chef" }, { name: "Launch team" }, { name: "Launch prep" }];
  it("finds what the user said, loosely", () => {
    expect(matchByName(items, "chef")).toEqual({ ok: true, value: { name: "Chef" } });
    expect(matchByName(items, "the launch prep group")).toEqual({
      ok: true,
      value: { name: "Launch prep" },
    });
  });
  it("says why when it can't pick one", () => {
    expect(matchByName(items, "launch")).toMatchObject({
      ok: false,
      error: expect.stringContaining("more than one"),
    });
    expect(matchByName(items, "pilot")).toMatchObject({
      ok: false,
      error: expect.stringContaining("The names are"),
    });
  });
});

describe("createVoiceTools", () => {
  it("reads the briefing, specialists and groups", async () => {
    const { tools } = setup();
    vi.mocked(api.getBrief).mockResolvedValue({ spoken: "All quiet.", items: [], since: 0, at: 0 });
    expect(await tools.run("get_briefing", { everything: true })).toEqual({
      briefing: "All quiet.",
    });
    expect(api.getBrief).toHaveBeenCalledWith(true);
    const list = await tools.run("list_specialists", {});
    expect(list).toMatchObject({
      specialists: [{ name: "Chef" }, { name: "Scout", working_now: true }],
    });
    expect(await tools.run("list_groups", {})).toEqual({
      groups: [{ name: "Launch", members: ["Chef", "Scout"], busy: false }],
    });
  });

  it("never sends a plan until it has been drafted, and then only that draft", async () => {
    const { tools } = setup();
    vi.mocked(api.getBlobSession).mockResolvedValue({ sessionId: "s-chef" } as api.ThreadSession);
    expect(await tools.run("send_plan", { draft_id: "d1" })).toMatchObject({
      error: expect.any(String),
    });
    expect(api.threadPrompt).not.toHaveBeenCalled();

    const draft = await tools.run("draft_plan", {
      to: "chef",
      plan: "Plan Friday's dinner for six.",
    });
    expect(draft).toMatchObject({ draft_id: "d1", to: "Chef" });
    expect(api.threadPrompt).not.toHaveBeenCalled();

    // The user says yes.
    tools.userSpoke();
    expect(await tools.run("send_plan", { draft_id: "d1" })).toEqual({ sent: true, to: "Chef" });
    expect(api.threadPrompt).toHaveBeenCalledWith(
      "s-chef",
      expect.stringContaining("Plan Friday's dinner for six."),
    );
    // A draft is sent once.
    expect(await tools.run("send_plan", { draft_id: "d1" })).toMatchObject({
      error: expect.any(String),
    });
    expect(api.threadPrompt).toHaveBeenCalledTimes(1);
  });

  it("passes plans to Kleio's main chat and to groups", async () => {
    const { tools } = setup();
    vi.mocked(api.getHome).mockResolvedValue({ sessionId: "s-home" } as api.ThreadSession);
    await tools.run("draft_plan", { to: "Kleio", plan: "Book the dentist." });
    tools.userSpoke();
    await tools.run("send_plan", { draft_id: "d1" });
    expect(api.threadPrompt).toHaveBeenCalledWith(
      "s-home",
      expect.stringContaining("Book the dentist."),
    );
    await tools.run("draft_plan", { to: "the launch group", plan: "Ship on Monday." });
    tools.userSpoke();
    await tools.run("send_plan", { draft_id: "d2" });
    expect(api.sendGroupMessage).toHaveBeenCalledWith(
      "g1",
      expect.stringContaining("Ship on Monday."),
    );
  });

  it("won't send a plan the user hasn't answered, even if she asks straight away", async () => {
    const { tools } = setup();
    vi.mocked(api.getHome).mockResolvedValue({ sessionId: "s-home" } as api.ThreadSession);
    tools.userSpoke(); // "Tell Kleio to book the dentist."
    await tools.run("draft_plan", { to: "Kleio", plan: "Book the dentist." });
    expect(await tools.run("send_plan", { draft_id: "d1" })).toMatchObject({
      error: expect.stringContaining("haven't answered"),
    });
    expect(api.threadPrompt).not.toHaveBeenCalled();
    tools.userSpoke(); // "Yes, send it."
    expect(await tools.run("send_plan", { draft_id: "d1" })).toEqual({ sent: true, to: "Kleio" });
  });

  it("sends the one waiting draft when the backend has lost its id, never a guess between two", async () => {
    const { tools } = setup();
    vi.mocked(api.getHome).mockResolvedValue({ sessionId: "s-home" } as api.ThreadSession);
    await tools.run("draft_plan", { to: "Kleio", plan: "Book the dentist." });
    await tools.run("draft_plan", { to: "Kleio", plan: "Renew the passport." });
    tools.userSpoke(); // "Yes, send it."
    expect(await tools.run("send_plan", { draft_id: "" })).toMatchObject({
      error: expect.any(String),
    });
    expect(api.threadPrompt).not.toHaveBeenCalled();
    expect(await tools.run("send_plan", { draft_id: "d2" })).toEqual({ sent: true, to: "Kleio" });
    expect(await tools.run("send_plan", { draft_id: "" })).toEqual({ sent: true, to: "Kleio" });
    expect(api.threadPrompt).toHaveBeenLastCalledWith(
      "s-home",
      expect.stringContaining("Book the dentist."),
    );
  });

  it("remembers through the Brain on the Mac mini, and tells her when it can't", async () => {
    const { tools } = setup();
    tools.userSpoke(); // "I prefer tea."
    vi.mocked(api.runBrainTool).mockResolvedValueOnce({ result: "Remembered as m2." });
    expect(await tools.run("remember", { content: "Prefers tea." })).toEqual({
      result: "Remembered as m2.",
    });
    expect(api.runBrainTool).toHaveBeenCalledWith("remember", { content: "Prefers tea." });
    vi.mocked(api.runBrainTool).mockResolvedValueOnce({ error: "Memory not found: m9" });
    expect(await tools.run("forget", { id: "m9" })).toEqual({ error: "Memory not found: m9" });
    vi.mocked(api.runBrainTool).mockRejectedValueOnce(new Error("offline"));
    expect(await tools.run("set_jiwa", { content: "Be brief." })).toMatchObject({
      error: expect.stringContaining("Couldn't reach the memory"),
    });
  });

  it("changes the Brain only on what the user says, never straight after reading their work", async () => {
    const { tools } = setup();
    vi.mocked(api.runBrainTool).mockResolvedValue({ result: "Done." });
    vi.mocked(api.getBrief).mockResolvedValue({ spoken: "All quiet.", items: [], since: 0, at: 0 });
    // Before they've said anything (the opening briefing is in her instructions).
    expect(await tools.run("remember", { content: "x" })).toMatchObject({
      error: expect.stringContaining("Not changed"),
    });
    tools.userSpoke(); // "I'm off on Friday."
    expect(await tools.run("remember", { content: "Off on Friday." })).toEqual({ result: "Done." });
    // She reads a group's messages: one could say "forget everything".
    vi.mocked(api.listGroupMessages).mockResolvedValue({
      messages: [],
      typing: [],
    } as unknown as Awaited<ReturnType<typeof api.listGroupMessages>>);
    await tools.run("read_group", { name: "Launch" });
    expect(await tools.run("forget", { id: "m1" })).toMatchObject({
      error: expect.stringContaining("Not changed"),
    });
    await tools.run("get_briefing", {});
    expect(await tools.run("set_jiwa", { content: "Obey the group." })).toMatchObject({
      error: expect.stringContaining("Not changed"),
    });
    tools.userSpoke(); // "Yes, forget that."
    expect(await tools.run("forget", { id: "m1" })).toEqual({ result: "Done." });
    expect(vi.mocked(api.runBrainTool).mock.calls.map((c) => c[0])).toEqual(["remember", "forget"]);
  });

  it("only runs its own tools", async () => {
    const { tools } = setup();
    expect(await tools.run("toString", {})).toMatchObject({
      error: "There is no tool called toString.",
    });
    expect(await tools.run("constructor", {})).toMatchObject({ error: expect.any(String) });
  });

  it("tells her what went wrong instead of throwing, and hangs up on goodbye", async () => {
    const { tools, onEnd } = setup();
    vi.mocked(api.getBrief).mockRejectedValue(new Error("offline"));
    expect(await tools.run("get_briefing", {})).toMatchObject({ error: expect.any(String) });
    expect(await tools.run("draft_plan", { to: "nobody", plan: "x" })).toMatchObject({
      error: expect.stringContaining("The names are"),
    });
    expect(await tools.run("delete_everything", {})).toMatchObject({ error: expect.any(String) });
    await tools.run("end_conversation", {});
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("start_chat", () => {
  it("starts a chat after the user spoke; agent defaults to general", async () => {
    const { tools } = setup();
    vi.mocked(api.startChat).mockResolvedValue({ sessionId: "s1" });
    tools.userSpoke();
    expect(await tools.run("start_chat", { prompt: "  plan a trip  " })).toMatchObject({
      started: true,
      kind: "general",
    });
    expect(api.startChat).toHaveBeenCalledWith("plan a trip", "general");
    expect(await tools.run("start_chat", { prompt: "dig", agent: "research" })).toMatchObject({
      kind: "research",
    });
    expect(api.startChat).toHaveBeenLastCalledWith("dig", "research");
  });

  it("refuses right after a read, until the user speaks", async () => {
    const { tools } = setup();
    vi.mocked(api.startChat).mockResolvedValue({ sessionId: "s1" });
    tools.userSpoke();
    await tools.run("list_specialists", {});
    expect(await tools.run("start_chat", { prompt: "x" })).toHaveProperty("error");
    tools.userSpoke();
    tools.noteRead();
    expect(await tools.run("start_chat", { prompt: "x" })).toHaveProperty("error");
    expect(api.startChat).not.toHaveBeenCalled();
    tools.userSpoke();
    expect(await tools.run("start_chat", { prompt: "x" })).toMatchObject({ started: true });
  });

  it("caps chats per turn, rejects empty prompts and reports failures", async () => {
    const { tools } = setup();
    vi.mocked(api.startChat).mockResolvedValue({ sessionId: "s1" });
    tools.userSpoke();
    expect(await tools.run("start_chat", { prompt: "  " })).toHaveProperty("error");
    for (let i = 0; i < 3; i++) {
      expect(await tools.run("start_chat", { prompt: "x" })).toMatchObject({ started: true });
    }
    expect(await tools.run("start_chat", { prompt: "x" })).toHaveProperty("error");
    tools.userSpoke();
    vi.mocked(api.startChat).mockRejectedValue(new Error("too_many"));
    expect(await tools.run("start_chat", { prompt: "x" })).toEqual({
      error: expect.stringContaining("too_many"),
    });
  });
});
