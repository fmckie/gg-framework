// Fake specialists for the Cast shelf's tests: the redesign mockup's cast of 26
// in every state (working, last run failed, next run, on call, paused), as the
// host would list them, its group chat of four and of eight, and a list of
// groups made from the same cast. Nothing in the app imports this.
//
// It is Monday 9 November 2026, 14:10, in whatever zone the tests run in: every
// time is built in local time, so "tomorrow 07:30" reads the same anywhere.

import type { BlobFaceKind, BlobShape } from "./blobLook";
import type {
  Blob,
  BlobColor,
  Group,
  GroupMessage,
  GroupMessagesPage,
  ModelList,
  Run,
  Schedule,
  ScheduleKind,
  ToolActivityEntry,
} from "./kleioApi";

const at = (day: number, hour: number, minute: number, second = 0): string =>
  new Date(2026, 10, 9 + day, hour, minute, second).toISOString();

export const CAST_NOW = new Date(2026, 10, 9, 14, 10);

export const CAST_MODELS: ModelList = {
  defaultBlobModel: "sonnet",
  models: [
    { id: "qwen", label: "Qwen3 14B", private: true },
    { id: "llama", label: "Llama 3.3 70B (Tinfoil)", private: true },
    { id: "sonnet", label: "Claude Sonnet 4.5", private: false },
    { id: "haiku", label: "Claude Haiku 4.5", private: false },
  ],
};

type When = Pick<Schedule, "kind"> & Partial<Pick<Schedule, "everyMinutes" | "time" | "days">>;
const weekly = (days: number[], time: string): When => ({ kind: "weekly", days, time });
const daily = (time: string): When => ({ kind: "daily" satisfies ScheduleKind, time });
const every = (everyMinutes: number): When => ({ kind: "interval", everyMinutes });
const WEEKDAYS = [1, 2, 3, 4, 5];

/** label, when, next run (null = switched off), set by the host from the job, its own prompt. */
type Sched = readonly [
  label: string,
  when: When,
  next: string | null,
  auto?: boolean,
  prompt?: string,
];
type Ran = readonly [ok: boolean, startedAt: string, text: string];
type Tool = readonly [name: string, summary: string, startedAt: string, endedAt?: string];

interface Member {
  id: string;
  look: readonly [BlobShape, BlobFaceKind, BlobColor];
  job: string;
  model?: string;
  schedules?: readonly Sched[];
  /** Newest first. */
  runs?: readonly Ran[];
  /** Working since then, with these tool calls so far. */
  working?: { since: string; tools: readonly Tool[] };
}

const MEMBERS: readonly Member[] = [
  {
    id: "herald",
    look: ["orb", "calm", "lemon"],
    job: "Every weekday at 7:30, send me the three most important news stories in two lines each.",
    schedules: [["Weekday news", weekly(WEEKDAYS, "07:30"), at(1, 7, 30), true]],
    runs: [
      [
        true,
        at(0, 7, 30),
        "Portugal’s rail strike ends Friday; the ECB holds rates; Lisbon’s new metro line opens.",
      ],
      [
        true,
        at(-3, 7, 30),
        "A mild winter forecast, a chip export deal, and the Booker shortlist.",
      ],
    ],
  },
  {
    id: "chef",
    look: ["mochi", "happy", "peach"],
    job: "Every Sunday at 5pm, plan three dinners for the week from what’s in season, with a shopping list.",
    schedules: [
      ["Sunday dinners", weekly([0], "17:00"), at(6, 17, 0), true],
      [
        "Thursday top-up",
        weekly([4], "18:30"),
        at(3, 18, 30),
        false,
        "Check what’s left from Sunday’s list and suggest a top-up shop.",
      ],
    ],
    runs: [
      [
        true,
        at(-1, 17, 0),
        "Miso salmon, squash and sage orzo, and a chickpea curry, with the shopping list.",
      ],
      [true, at(-4, 18, 30), "Top-up: spinach, two lemons and a bag of basmati."],
    ],
  },
  {
    id: "scout",
    look: ["drop", "curious", "indigo"],
    job: "When I ask, research a topic properly and reply with a short summary and the sources you used.",
  },
  {
    id: "courier",
    look: ["pill", "focused", "sky"],
    job: "Watch the flights for the Lisbon offsite. Every 2 hours, check them and tell me only if a time or gate changes.",
    model: "haiku",
    schedules: [["Flight watch", every(120), at(0, 16, 8), true]],
    runs: [[true, at(0, 12, 8), "No changes. All 12 flights on time."]],
    working: {
      since: at(0, 14, 8),
      tools: [
        ["web_fetch", "flightaware.com/live/flight/TP1351", at(0, 14, 9, 50), at(0, 14, 9, 51)],
        ["web_fetch", "flightaware.com/live/flight/EZY8521", at(0, 14, 9, 52), at(0, 14, 9, 54)],
        ["web_search", "Lisbon arrivals after 22:00", at(0, 14, 9, 54)],
      ],
    },
  },
  {
    id: "quill",
    look: ["ghost", "cheeky", "lilac"],
    job: "When I ask, draft emails, agendas and notes in my voice: short, warm, and no exclamation marks.",
  },
  {
    id: "ledger",
    look: ["cube", "calm", "slate"],
    job: "Every Friday at 4pm, total the week’s receipts from Gmail by category and flag anything over €200.",
    model: "qwen",
    schedules: [["Friday receipts", weekly([5], "16:00"), at(4, 16, 0), true]],
    runs: [
      [false, at(-3, 16, 0), "Gmail needs signing in"],
      [
        true,
        at(-10, 16, 0),
        "€412 this week: food €188, travel €96, other €128. Nothing over €200.",
      ],
    ],
  },
  {
    id: "gardener",
    look: ["puff", "sleepy", "mint"],
    job: "Every Monday at 8, look at the week’s weather and tell me which balcony pots need watering, and when.",
    model: "llama",
    schedules: [["Monday watering", weekly([1], "08:00"), null, true]],
    runs: [[true, at(-7, 8, 0), "Rain Tuesday and Wednesday. Water the herbs on Thursday only."]],
  },
  {
    id: "atlas",
    look: ["star", "focused", "teal"],
    job: "When I ask, plan door-to-door routes and transfers, with times, costs and a backup option.",
    working: {
      since: at(0, 14, 5),
      tools: [
        ["web_search", "Lisbon airport to Chiado after 23:00", at(0, 14, 9, 50), at(0, 14, 9, 52)],
        ["web_fetch", "metrolisboa.pt/en/timetables", at(0, 14, 9, 53), at(0, 14, 9, 54)],
        ["write", "transfer-plan.md", at(0, 14, 9, 55)],
      ],
    },
  },
  {
    id: "tempo",
    look: ["orb", "surprised", "amber"],
    job: "Every weekday at 8:15, look at today’s calendar and flag clashes and the travel time between meetings.",
    schedules: [["Morning calendar", weekly(WEEKDAYS, "08:15"), at(1, 8, 15), true]],
    runs: [
      [
        true,
        at(0, 8, 15),
        "No clashes. Leave by 13:20 for the 14:00 at the studio; it’s 35 minutes.",
      ],
    ],
  },
  {
    id: "keeper",
    look: ["mochi", "wink", "plum"],
    job: "Every Monday at 9, list the subscriptions renewing this week and any I haven’t used in a month.",
    model: "qwen",
    schedules: [["Renewals", weekly([1], "09:00"), at(7, 9, 0), true]],
    runs: [
      [
        true,
        at(0, 9, 0),
        "Figma (€15) renews Wednesday and iCloud+ (€2.99) Friday. Headspace unused since September.",
      ],
    ],
  },
  {
    id: "scribe",
    look: ["pill", "calm", "rose"],
    job: "When I send a meeting transcript, turn it into notes with the decisions, owners and dates.",
    working: {
      since: at(0, 14, 6),
      tools: [
        ["read", "standup-transcript.txt", at(0, 14, 9, 48), at(0, 14, 9, 49)],
        ["read", "team.md", at(0, 14, 9, 50), at(0, 14, 9, 51)],
        ["write", "standup-notes.md", at(0, 14, 9, 51)],
      ],
    },
  },
  {
    id: "concierge",
    look: ["cube", "happy", "indigo"],
    job: "When I ask, find and compare hotels, restaurants and tickets, with links and prices.",
  },
  {
    id: "librarian",
    look: ["ghost", "calm", "amber"],
    job: "Every evening at 9, file the links I saved today into my Notion reading list, each with a one-line summary.",
    schedules: [["Evening filing", daily("21:00"), at(0, 21, 0), true]],
    runs: [
      [false, at(-1, 21, 0), "Notion sign-in expired"],
      [true, at(-2, 21, 0), "Filed 6 links: two on housing, one on Lisbon, three long essays."],
    ],
  },
  {
    id: "postie",
    look: ["drop", "happy", "coral"],
    job: "Every weekday at 9 and 3, sort my inbox and draft replies to anything urgent.",
    schedules: [
      ["Morning sort", weekly(WEEKDAYS, "09:00"), at(1, 9, 0), true],
      ["Afternoon sort", weekly(WEEKDAYS, "15:00"), at(0, 15, 0), true],
    ],
    runs: [
      [
        true,
        at(0, 9, 0),
        "Sorted 41 emails and drafted 2 replies: Priya’s agenda question and the venue invoice.",
      ],
    ],
  },
  {
    id: "reader",
    look: ["puff", "curious", "sky"],
    job: "Every Saturday at 9, pick two long reads from my saved links and summarise each in five lines.",
    schedules: [["Weekend reads", weekly([6], "09:00"), at(5, 9, 0), true]],
    runs: [
      [
        true,
        at(-2, 9, 0),
        "A long read on Lisbon’s housing and one on night trains, five lines each.",
      ],
    ],
  },
  {
    id: "coach",
    look: ["star", "happy", "lemon"],
    job: "Weekday mornings at 6:45, send a 20-minute workout that fits around my calendar.",
    schedules: [["Morning workout", weekly(WEEKDAYS, "06:45"), null, true]],
    runs: [[true, at(-3, 6, 45), "20 minutes: intervals, then mobility. Short day, so no run."]],
  },
  {
    id: "ticker",
    look: ["orb", "focused", "lilac"],
    job: "Every weekday at 5:30pm, summarise how my portfolio moved and the news behind any big move.",
    model: "qwen",
    schedules: [["Market close", weekly(WEEKDAYS, "17:30"), at(0, 17, 30), true]],
    runs: [
      [true, at(-3, 17, 30), "Up 0.8% on the week. The one big move: ASML, after its export news."],
    ],
  },
  {
    id: "archivist",
    look: ["cube", "curious", "peach"],
    job: "Every Friday at 6pm, back up the week’s notes and documents to Dropbox, and list what changed.",
    schedules: [["Friday backup", weekly([5], "18:00"), at(4, 18, 0), true]],
    runs: [
      [false, at(-3, 18, 0), "Dropbox is full"],
      [true, at(-10, 18, 0), "Backed up 38 files, 212 MB. Most changes were in the Lisbon folder."],
    ],
  },
  {
    id: "tidy",
    look: ["pill", "wink", "mint"],
    job: "Every Sunday at 8pm, list the files in Downloads older than 30 days so I can clear them out.",
    schedules: [["Downloads sweep", weekly([0], "20:00"), at(6, 20, 0), true]],
    runs: [
      [true, at(-1, 20, 0), "31 files, 4.2 GB. The biggest: two screen recordings from October."],
    ],
  },
  {
    id: "tutor",
    look: ["ghost", "sleepy", "slate"],
    job: "Every evening at 8, quiz me on ten Portuguese words and repeat the ones I miss.",
    schedules: [["Evening quiz", daily("20:00"), null, true]],
    runs: [[true, at(-4, 20, 0), "8 of 10. Missed ‘embora’ and ‘aliás’; they’re first next time."]],
  },
  // Past 20.
  {
    id: "planner",
    look: ["cube", "focused", "sky"],
    job: "Every Sunday at 6pm, plan my week from my calendar and tasks, top three first.",
    schedules: [["Week plan", weekly([0], "18:00"), at(6, 18, 0), true]],
    runs: [
      [true, at(-1, 18, 0), "Top three: the Lisbon agenda, the venue invoice, Joel’s review."],
    ],
  },
  {
    id: "forecast",
    look: ["orb", "happy", "teal"],
    job: "Every day at 7, tell me whether I need a coat, an umbrella, or both.",
    schedules: [["Morning weather", daily("07:00"), at(1, 7, 0), true]],
    runs: [[true, at(0, 7, 0), "Coat, no umbrella. Dry until Thursday."]],
  },
  {
    id: "sentry",
    look: ["drop", "focused", "rose"],
    job: "Every 30 minutes, check the shop site loads and checkout works; tell me only if they don’t.",
    schedules: [["Shop check", every(30), at(0, 14, 30), true]],
    runs: [
      [false, at(0, 14, 0), "Timed out at 14:00"],
      [true, at(0, 13, 30), "Site and checkout fine. Pages load in 1.4 s."],
    ],
  },
  {
    id: "fixer",
    look: ["puff", "wink", "amber"],
    job: "When something at home breaks, find how to fix it, the part I need, and a repair service nearby.",
  },
  {
    id: "rover",
    look: ["star", "calm", "coral"],
    job: "Every Friday at 6pm, suggest three things to do in Lisbon this weekend.",
    schedules: [["Weekend ideas", weekly([5], "18:00"), null, true]],
    runs: [
      [
        true,
        at(-10, 18, 0),
        "Fado at Tasca do Chico, the LX Factory market, and a walk up to Graça.",
      ],
    ],
  },
  {
    id: "critic",
    look: ["pill", "curious", "plum"],
    job: "When I send a draft, give me honest notes on structure and tone, in five bullets at most.",
  },
];

const R7 = ["herald", "chef", "scout", "courier", "quill", "ledger", "gardener"];
const R20 = [
  ...R7,
  ...["atlas", "tempo", "keeper", "scribe", "concierge", "librarian", "postie"],
  ...["reader", "coach", "ticker", "archivist", "tidy", "tutor"],
];
// Past 20 the six extras slot in among the twenty; Archivist and Sentry fail side by side.
const R26 = [
  ...["herald", "chef", "scout", "courier", "quill", "ledger", "gardener", "atlas", "tempo"],
  ...["keeper", "planner", "scribe", "concierge", "librarian", "postie", "forecast", "reader"],
  ...["coach", "ticker", "archivist", "sentry", "tidy", "fixer", "tutor", "rover", "critic"],
];
const ROSTERS = { 1: ["herald"], 7: R7, 20: R20, 26: R26 } as const;
export type RosterSize = keyof typeof ROSTERS;
export const ROSTER_SIZES: readonly RosterSize[] = [1, 7, 20, 26];

const name = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);
const member = (id: string): Member | undefined => MEMBERS.find((m) => m.id === id);

function schedulesOf(m: Member): Schedule[] {
  return (m.schedules ?? []).map(([label, when, next, auto, prompt], i) => ({
    id: `${m.id}-s${i + 1}`,
    label,
    prompt: prompt ?? m.job,
    ...when,
    timezone: "Europe/London",
    enabled: next !== null,
    notify: true,
    nextRunAt: next,
    source: auto ? "auto" : "manual",
  }));
}

/** A specialist's runs, newest first: the one under way, then the finished ones. */
export function castRuns(id: string): Run[] {
  const m = member(id);
  if (!m) return [];
  const schedule = schedulesOf(m)[0];
  const base = { blobId: id, scheduleId: schedule?.id ?? null, label: schedule?.label ?? name(id) };
  const done = (m.runs ?? []).map(([ok, startedAt, text], i): Run => ({
    ...base,
    id: `${id}-r${i + 1}`,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 40_000).toISOString(),
    ...(ok ? { outcome: "ok", summary: text } : { outcome: "error", error: text }),
  }));
  if (!m.working) return done;
  return [{ ...base, id: `${id}-r0`, startedAt: m.working.since, outcome: "ok" }, ...done];
}

/** The tool calls of a working specialist's turn, oldest first. */
export function castActivity(id: string): ToolActivityEntry[] {
  return (member(id)?.working?.tools ?? []).map(([tool, summary, startedAt, endedAt], i) => ({
    id: `${id}-t${i + 1}`,
    name: tool,
    summary,
    startedAt,
    ...(endedAt ? { status: "done", endedAt } : { status: "running" }),
  }));
}

function blobOf(m: Member): Blob {
  const lastRun = castRuns(m.id)[0];
  return {
    id: m.id,
    name: name(m.id),
    emoji: "",
    shape: m.look[0],
    face: m.look[1],
    color: m.look[2],
    job: m.job,
    model: m.model ?? null,
    createdAt: at(-40, 9, 0),
    updatedAt: at(-40, 9, 0),
    schedules: schedulesOf(m),
    running: Boolean(m.working),
    ...(lastRun ? { lastRun } : {}),
  };
}

/** The mockup's roster of 1, 7, 20 or 26, as the host would list it. */
export function castRoster(size: RosterSize): Blob[] {
  return ROSTERS[size].flatMap((id) => {
    const m = member(id);
    return m ? [blobOf(m)] : [];
  });
}

// ─── the group: Lisbon offsite, as the mockup's room of four and of eight ────

const ROOMS = {
  4: ["scout", "ledger", "quill", "courier"],
  8: ["scout", "ledger", "courier", "atlas", "tempo", "chef", "quill", "concierge"],
} as const;
export type RoomSize = keyof typeof ROOMS;

/** author ("you" or a member), when, what they said. */
type Said = readonly [author: string, at: string, text: string];

const DINNER = [
  "Three places near the hotel can seat 12 on Saturday:",
  "",
  "- **Taberna do Largo**, 4 min walk. 20:00, set menu €38 a head; over 10 needs a €100 deposit.",
  "- **Cervejaria Trindade**, 6 min. 19:30 or 21:30, about €32 a head.",
  "- **Prado**, 9 min. 20:30 only, tasting menu €65 a head.",
  "",
  "They are side by side in [Dinner options](out/dinner-options.md).",
  "",
  "@Ledger can you check these against the offsite budget?",
].join("\n");

const BUDGET = [
  "Taberna do Largo fits: €456 for 12, plus a €100 deposit that comes back on the night. That leaves €544 of the €1,000 food budget in the [Offsite budget](out/offsite-budget.xlsx). Prado would be €780, over the €600 cap.",
  "",
  "@Quill over to you for the invite: Taberna do Largo, Saturday at 20:00.",
].join("\n");

/** The fourth file is Quill's in the room of four, Atlas's in the room of eight. */
const said = (size: RoomSize): readonly Said[] => [
  ["you", at(0, 11, 40), "Where do we stand on arrivals and the agenda for Lisbon?"],
  [
    "scout",
    at(0, 11, 42),
    "Everything is within ten minutes of the hotel: here is a [Chiado walking map](site/index.html).",
  ],
  size === 4
    ? [
        "quill",
        at(0, 11, 47),
        "The [Lisbon agenda (draft)](out/lisbon-agenda.docx) is ready to read.",
      ]
    : [
        "atlas",
        at(0, 11, 47),
        "Airport to hotel is covered in the [Transfer plan](out/transfer-plan.md).",
      ],
  [
    "courier",
    at(0, 11, 52),
    "Two flights land after 22:00. They are in [Late arrivals](out/late-arrivals.csv).",
  ],
  [
    "you",
    at(0, 14, 5),
    "Dinner for 12 on Saturday the 14th, near the hotel in Chiado. Find a few options, check them against the budget, then draft the invite to the team.",
  ],
  ["scout", at(0, 14, 7), DINNER],
  ["ledger", at(0, 14, 9), BUDGET],
];

/** What Quill is doing as the room opens: two files read, the invite under way. */
const QUILL_TOOLS: readonly Tool[] = [
  ["read", "dinner-options.md", at(0, 14, 9, 50), at(0, 14, 9, 51)],
  ["read", "lisbon-agenda.docx", at(0, 14, 9, 53), at(0, 14, 9, 54)],
  ["write", "invite-draft.md", at(0, 14, 9, 56)],
];

/** The mockup's group mid-turn: Scout and Ledger have replied, Ledger's
 *  @mention has handed over to Quill, who is replying; the rest sat it out. */
export function castGroup(size: RoomSize): {
  group: Group;
  blobs: Blob[];
  page: GroupMessagesPage;
} {
  const ids: readonly string[] = ROOMS[size];
  const messages = said(size).map(([author, when, text], i): GroupMessage => ({
    seq: i + 1,
    id: `lisbon-m${i + 1}`,
    author,
    authorName: author === "you" ? "You" : name(author),
    emoji: "",
    text,
    at: when,
  }));
  const last = messages[messages.length - 1];
  return {
    group: {
      id: "lisbon",
      name: "Lisbon offsite",
      emoji: "💬",
      color: "lilac",
      members: [...ids],
      createdAt: at(-20, 9, 0),
      updatedAt: at(0, 14, 9),
      typing: ["quill"],
      ...(last ? { lastMessage: last } : {}),
    },
    blobs: ids.flatMap((id) => {
      const m = member(id);
      return m ? [blobOf(m)] : [];
    }),
    page: {
      messages,
      typing: ["quill"],
      lastSeq: messages.length,
      activity: {
        quill: QUILL_TOOLS.map(([tool, summary, startedAt, endedAt], i) => ({
          id: `quill-g${i + 1}`,
          name: tool,
          summary,
          startedAt,
          ...(endedAt ? { status: "done", endedAt } : { status: "running" }),
        })),
      },
      outcomes: {
        scout: { kind: "replied", reason: "" },
        ledger: { kind: "replied", reason: "" },
      },
    },
  };
}

// ─── the groups list: no mockup draws it, so these are made from the cast ────

/** name, members, and its newest message (author, when, text); none = never used. */
type Troupe = readonly [name: string, members: readonly string[], last?: Said];

const TROUPES: readonly Troupe[] = [
  [
    "Kitchen crew",
    ["chef", "gardener"],
    [
      "chef",
      at(-1, 17, 2),
      "Sunday's list is in: **miso salmon**, squash orzo and a chickpea curry.",
    ],
  ],
  ["Money desk", ["ledger", "ticker", "forecast", "keeper"]],
  [
    "Morning desk",
    ["herald"],
    ["herald", at(0, 7, 31), "Three stories for today, two lines each."],
  ],
  [
    "Study hall",
    ["tutor", "reader", "librarian", "coach", "critic", "scribe", "planner", "archivist"],
    ["you", at(-2, 19, 15), "What should I read before Thursday's seminar?"],
  ],
  // One of its members has since been deleted.
  [
    "Travel desk",
    ["atlas", "courier", "long-gone"],
    ["atlas", at(-6, 10, 0), "Transfers are booked."],
  ],
  [
    "House",
    ["tidy", "fixer", "sentry"],
    ["fixer", at(-9, 16, 40), "The boiler service is on the 19th."],
  ],
  ["Inbox", ["postie", "concierge"], ["postie", at(0, 13, 55), "Two emails need replies."]],
  [
    "Garden",
    ["gardener", "forecast", "rover"],
    ["forecast", at(0, 6, 0), "Frost tonight: cover the dahlias."],
  ],
  ["Writers", ["quill", "critic", "scribe"]],
  [
    "Fitness",
    ["coach", "tempo"],
    ["coach", at(-1, 8, 0), "Rest day. Twenty minutes of stretching."],
  ],
  // Everyone in it has been deleted.
  ["Old project", ["long-gone", "also-gone"]],
];

export const GROUP_LIST_SIZES = [0, 1, 3, 12] as const;
export type GroupListSize = (typeof GROUP_LIST_SIZES)[number];

/** A list of groups as the host would send it, the cast of 26 to draw them
 *  from: none, the Lisbon offsite alone (Quill replying), three, or twelve. */
export function castGroups(size: GroupListSize): { groups: Group[]; blobs: Blob[] } {
  const made = TROUPES.map(([title, members, last], i): Group => ({
    id: `troupe-${i + 1}`,
    name: title,
    emoji: "💬",
    color: "lilac",
    members: [...members],
    createdAt: at(-30, 9, 0),
    updatedAt: last?.[1] ?? at(-30, 9, 0),
    typing: [],
    ...(last
      ? {
          lastMessage: {
            seq: 1,
            id: `troupe-${i + 1}-m1`,
            author: last[0],
            authorName: last[0] === "you" ? "You" : name(last[0]),
            emoji: "",
            text: last[2],
            at: last[1],
          },
        }
      : {}),
  }));
  return { groups: [castGroup(4).group, ...made].slice(0, size), blobs: castRoster(26) };
}
