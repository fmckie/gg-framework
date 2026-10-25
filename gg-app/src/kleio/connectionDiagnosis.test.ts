import { describe, expect, it } from "vitest";
import {
  diagnose,
  diagnoseLink,
  diagnosisText,
  isKleioDown,
  RESTART_ENGINE,
  RESTART_HOST,
  RESTART_LINK,
  RESTART_LINK_SYSTEMD,
  START_ENGINE,
  START_HOST,
  START_LINK_WINDOWS,
  TAILSCALE_DOWNLOAD,
  TAILSCALE_MACHINES,
  unreachableReason,
  type Diagnosis,
  type DiagnosisInput,
  type HealthCheck,
  type LinkDiagnosisInput,
  type LinkHealth,
} from "./connectionDiagnosis";
import type { HostKind } from "./kleioApi";
import type { LinkStatus } from "./kleioLink";
import type { TailscaleNode, TailscaleStatus } from "./useKleioRemote";

const NOW = Date.parse("2026-10-08T12:00:00Z");

const MINI: TailscaleNode = {
  name: "mac-mini-1",
  dnsName: "mac-mini-1.tail0000.ts.net",
  ip: "100.64.0.9",
  os: "macOS",
  online: true,
  lastSeen: null,
  direct: true,
  relay: "lhr",
};

function ts(over: Partial<TailscaleStatus> = {}): TailscaleStatus {
  return {
    installed: true,
    running: true,
    backendState: "Running",
    tailnet: "me@example.com",
    magicDnsSuffix: "tail0000.ts.net",
    version: "1.90.1",
    health: [],
    self: { ...MINI, name: "laptop" },
    host: MINI,
    error: null,
    ...over,
  };
}

const UP: HealthCheck = { state: "ok", value: { sidecar: "up", devices: 2, latencyMs: 38 } };
const NO_REPLY: HealthCheck = { state: "error", reason: "no-reply" };

function mac(health: HealthCheck, net: Partial<TailscaleStatus> = {}): DiagnosisInput {
  return {
    health,
    net: { state: "ok", value: ts(net) },
    hostLabel: "mac-mini-1",
    device: "Mac",
    online: true,
  };
}

function iphone(health: HealthCheck): DiagnosisInput {
  return { health, net: null, hostLabel: "mac-mini-1", device: "iPhone", online: true };
}

const fixText = (input: DiagnosisInput): string[] => diagnose(input, NOW).fix.map((s) => s.text);

describe("unreachableReason", () => {
  it("sorts a failed check by what the network said", () => {
    expect(unreachableReason(502, "Bad gateway")).toBe("replied");
    expect(unreachableReason(0, "Connection refused (os error 61)")).toBe("refused");
    expect(
      unreachableReason(
        0,
        "failed to lookup address information: nodename nor servname provided, or not known",
      ),
    ).toBe("not-found");
    expect(unreachableReason(0, "operation timed out")).toBe("no-reply");
    expect(unreachableReason(0, "Network is unreachable (os error 51)")).toBe("offline");
    expect(unreachableReason(0, "something else")).toBe("unknown");
  });
});

describe("diagnose", () => {
  it("says it works, with nothing to fix", () => {
    const d = diagnose(mac(UP), NOW);
    expect(d).toMatchObject({
      tone: "good",
      badge: "Connected",
      headline: "Connected to mac-mini-1",
    });
    expect(d.fix).toEqual([]);
    expect(d.checks).toEqual([
      { label: "Tailscale on this Mac", tone: "good", text: "On, as laptop" },
      { label: "mac-mini-1 on Tailscale", tone: "good", text: "Online, direct link" },
      { label: "Kleio on mac-mini-1", tone: "good", text: "Running" },
    ]);
  });

  it("reaching the Mac mini proves Tailscale works, even on the iPhone", () => {
    const d = diagnose(iphone(UP), NOW);
    expect(d.tone).toBe("good");
    expect(d.checks[0]).toEqual({
      label: "Tailscale on this iPhone",
      tone: "good",
      text: "Working",
    });
  });

  it("names a stopped engine and how to restart it", () => {
    const d = diagnose(
      mac({ state: "ok", value: { sidecar: "down", devices: 1, latencyMs: 30 } }),
      NOW,
    );
    expect(d.headline).toBe("Kleio has stopped on mac-mini-1");
    expect(d.fix[0]?.command).toBe(RESTART_ENGINE);
  });

  it("walks through Tailscale on this Mac first", () => {
    const missing = diagnose(mac(NO_REPLY, { installed: false, running: false }), NOW);
    expect(missing.headline).toBe("Tailscale isn't installed on this Mac");
    expect(missing.fix[0]?.link?.url).toBe(TAILSCALE_DOWNLOAD);

    expect(diagnose(mac(NO_REPLY, { running: false, backendState: "Stopped" }), NOW).headline).toBe(
      "Tailscale is turned off on this Mac",
    );
    expect(
      diagnose(mac(NO_REPLY, { running: false, backendState: "NeedsLogin" }), NOW).headline,
    ).toBe("Tailscale is signed out on this Mac");
    const approval = diagnose(
      mac(NO_REPLY, { running: false, backendState: "NeedsMachineAuth" }),
      NOW,
    );
    expect(approval.headline).toBe("This Mac is waiting for approval on Tailscale");
    expect(approval.fix[0]?.link?.url).toBe(TAILSCALE_MACHINES);
  });

  it("then whether Tailscale can see the Mac mini", () => {
    const elsewhere = diagnose(mac(NO_REPLY, { host: null }), NOW);
    expect(elsewhere.headline).toBe("mac-mini-1 isn't on your Tailscale network");
    expect(elsewhere.fix[0]?.text).toContain("this Mac uses me@example.com");

    const asleep = diagnose(
      mac(NO_REPLY, { host: { ...MINI, online: false, lastSeen: "2026-10-08T11:55:00Z" } }),
      NOW,
    );
    expect(asleep.headline).toBe("mac-mini-1 is offline");
    expect(asleep.detail).toContain("It was last seen 5 min ago.");
    expect(asleep.checks[1]).toMatchObject({ tone: "bad", text: "Offline, last seen 5 min ago" });
  });

  it("then Kleio itself, with the command to restart it", () => {
    for (const health of [NO_REPLY, { state: "error", reason: "replied" } as const]) {
      const d = diagnose(mac(health), NOW);
      expect(d.headline).toBe("Kleio on mac-mini-1 isn't answering");
      expect(d.fix[0]?.command).toBe(RESTART_HOST);
    }
  });

  it("says this device is offline before blaming anything else", () => {
    const d = diagnose(
      { ...mac(NO_REPLY, { running: false, backendState: "Stopped" }), online: false },
      NOW,
    );
    expect(d.headline).toBe("This Mac is offline");
  });

  it("on the iPhone, goes by how the request failed, and says tap", () => {
    expect(diagnose(iphone({ state: "error", reason: "not-found" }), NOW).headline).toBe(
      "This iPhone can't find mac-mini-1",
    );
    expect(diagnose(iphone(NO_REPLY), NOW).headline).toBe("mac-mini-1 isn't replying");
    expect(fixText(iphone(NO_REPLY))).toContain("Then tap Check again.");
    expect(fixText(mac(NO_REPLY, { running: false, backendState: "Stopped" }))).toContain(
      "Then click Check again.",
    );
  });
});

describe("diagnoseLink", () => {
  const N0 = "https://euc1-1.relay.n0.iroh.link./";

  /** A link in use through n0's relay, last reached 3 minutes ago; `over` replaces fields. */
  function linkStatus(over: Partial<LinkStatus> = {}): LinkStatus {
    return {
      paired: true,
      active: true,
      running: true,
      error: null,
      host: "mac-mini-1.tail0000.ts.net",
      hostKey: "ab".repeat(32),
      relay: N0,
      relayN0: true,
      refused: null,
      refusal: null,
      connected: true,
      dialling: false,
      unreached: null,
      lastReachedMs: NOW - 3 * 60_000,
      path: "relay",
      pathAddr: N0,
      pathN0: true,
      rateLimited: false,
      rttMs: 55,
      connectedSinceMs: NOW - 60_000,
      redials: 0,
      lastResumeMs: null,
      events: [],
      debugBuild: false,
      ...over,
    };
  }

  const LINK_UP: LinkHealth = {
    state: "ok",
    value: { sidecar: "up", devices: 2, latencyMs: 120 },
  };
  const NO_ANSWER: LinkHealth = { state: "error", kleioDown: false };
  const KLEIO_DOWN: LinkHealth = { state: "error", kleioDown: true };
  const MAC_MINI: HostKind = { os: "darwin", laptop: false };
  const LINUX: HostKind = { os: "linux", laptop: false };
  const WINDOWS: HostKind = { os: "win32", laptop: false };

  function input(
    link: Partial<LinkStatus>,
    health: LinkHealth = NO_ANSWER,
    over: Partial<LinkDiagnosisInput> = {},
  ): LinkDiagnosisInput {
    return {
      link: linkStatus(link),
      health,
      host: MAC_MINI,
      hostLabel: "mac-mini-1",
      device: "iPhone",
      online: true,
      ...over,
    };
  }

  /** No connection now, and why, as far as the link could tell. */
  function gone(
    unreached: LinkStatus["unreached"],
    over: Partial<LinkStatus> = {},
  ): Partial<LinkStatus> {
    return { connected: false, path: null, pathAddr: null, pathN0: false, unreached, ...over };
  }

  const ASLEEP = gone({ kind: "host-silent", relays: [] });
  const BLOCKED = gone({
    kind: "no-relay",
    relays: [
      { host: "relay.example.com", n0: false },
      { host: "euc1-1.relay.n0.iroh.link", n0: true },
      { host: "use1-1.relay.n0.iroh.link", n0: true },
    ],
  });
  const check = (d: Diagnosis, label: string) => d.checks.find((c) => c.label === label);

  it("connected through n0's relay, says so in the plan's words", () => {
    const d = diagnoseLink(input({}, LINK_UP), NOW);
    expect(d).toMatchObject({
      tone: "good",
      badge: "Connected",
      headline: "Connected to mac-mini-1",
    });
    expect(d.detail).toBe(
      "Through the relay. n0's public relay is shared and rate-limited, so big files are slower. Chats, specialists and code run on mac-mini-1, so they keep going when this iPhone sleeps.",
    );
    expect(d.fix).toEqual([]);
    expect(check(d, "Path")).toEqual({
      label: "Path",
      tone: "good",
      text: "Through n0's public relay",
    });
    expect(check(d, "Kleio's link on this iPhone")?.text).toBe("Connected");
  });

  it("names a direct path, and a relay of your own", () => {
    const direct = diagnoseLink(
      input({ path: "direct", pathAddr: "192.168.1.20:7842", pathN0: false }, LINK_UP),
      NOW,
    );
    expect(direct.detail).toMatch(
      /^Direct: this iPhone and mac-mini-1 reach each other without a relay\. /,
    );
    expect(check(direct, "Path")?.text).toBe("Direct");
    const own = diagnoseLink(
      input({ pathAddr: "https://relay.example.com/", pathN0: false }, LINK_UP),
      NOW,
    );
    expect(own.detail).toMatch(/^Through your relay \(relay\.example\.com\)\. /);
    expect(check(own, "Path")?.text).toBe("Through your relay (relay.example.com)");
  });

  it("says when the shared relay is slowing it, and that chats are slower while a file downloads", () => {
    const d = diagnoseLink(input({ rateLimited: true }, LINK_UP), NOW);
    expect(d).toMatchObject({
      tone: "warn",
      badge: "Slowed",
      headline: "Connected to mac-mini-1, slowly",
      detail:
        "Slowed by the shared relay, to about 1 MB/s. Chats are slower while a file downloads. A relay of your own is faster.",
    });
    expect(check(d, "Path")).toEqual({
      label: "Path",
      tone: "warn",
      text: "Through n0's public relay, slowed by the relay",
    });
    const own = diagnoseLink(
      input({ rateLimited: true, pathN0: false, pathAddr: "https://relay.example.com/" }, LINK_UP),
      NOW,
    );
    expect(own.detail).toBe(
      "Slowed by your relay, which is limiting this connection. Chats are slower while a file downloads.",
    );
  });

  it("a relay answered and the host didn't: asleep or offline, when it was last reached, and a line for its kind", () => {
    const d = diagnoseLink(input(ASLEEP), NOW);
    expect(diagnosisText(d)).toBe("mac-mini-1 is asleep or offline. Last reached 3 min ago.");
    expect(d).toMatchObject({ tone: "bad", badge: "Asleep or offline" });
    expect(d.fix[0]?.text).toBe("Make sure mac-mini-1 is switched on, awake and online.");

    const laptop = diagnoseLink(
      input(ASLEEP, NO_ANSWER, { host: { os: "darwin", laptop: true } }),
      NOW,
    );
    expect(laptop.detail).toBe(
      "Last reached 3 min ago. mac-mini-1 is a laptop: open it and keep it on power.",
    );
    expect(laptop.fix[0]?.text).toBe("Open mac-mini-1 and plug it in.");
    const vps = diagnoseLink(input(ASLEEP, NO_ANSWER, { host: LINUX }), NOW);
    expect(vps.detail).toBe(
      "Last reached 3 min ago. If mac-mini-1 is a VPS, check in your provider's dashboard that it's running.",
    );

    // Never reached as far as this device knows: what it does know.
    const never = diagnoseLink(input({ ...ASLEEP, lastReachedMs: null }), NOW);
    expect(never.detail).toBe("The relay answered, but mac-mini-1 didn't.");
    // A time a moment after this clock's now is now, not "in 1s".
    const ahead = diagnoseLink(input({ ...ASLEEP, lastReachedMs: NOW + 900 }), NOW);
    expect(ahead.detail).toBe("Last reached just now.");
    const recent = diagnoseLink(input({ ...ASLEEP, lastReachedMs: NOW - 12_000 }), NOW);
    expect(recent.detail).toBe("Last reached 12s ago.");
  });

  it("restarts Kleio's link with the host's own service: launchd, systemd or Windows", () => {
    const linkStep = (host: HostKind | null) =>
      diagnoseLink(input(ASLEEP, NO_ANSWER, { host }), NOW).fix;
    const stopped = "If it is, Kleio's link there may have stopped.";
    expect(linkStep(MAC_MINI)[1]).toEqual({
      text: `${stopped} On mac-mini-1, open Terminal and run:`,
      command: RESTART_LINK,
    });
    expect(RESTART_LINK).toBe('launchctl kickstart -k "gui/$(id -u)/com.kleio.host.link"');
    expect(linkStep(LINUX)[1]).toEqual({
      text: `${stopped} On mac-mini-1, in a terminal, run:`,
      command: RESTART_LINK_SYSTEMD,
    });
    expect(RESTART_LINK_SYSTEMD).toBe("systemctl --user restart kleio-link.service");
    const windows = linkStep(WINDOWS);
    expect(windows[1]).toEqual({
      text: `${stopped} On mac-mini-1, open PowerShell in the folder Kleio is in, and run:`,
      command: START_LINK_WINDOWS,
    });
    expect(START_LINK_WINDOWS).toBe("& .\\bin\\kleio-link-host.exe serve");
    expect(windows[2]?.text).toBe("Leave that window open: closing it stops it.");
    // A host that never said which OS it runs.
    expect(linkStep(null)[1]).toEqual({
      text: `${stopped} On mac-mini-1, start Kleio's link again.`,
    });
    const steps = linkStep(MAC_MINI);
    expect(steps[steps.length - 1]?.text).toBe("Then tap Check again.");
  });

  it("the host's link answering for a stopped Kleio says so, with the host's restart", () => {
    const stopped = (host: HostKind) => diagnoseLink(input({}, KLEIO_DOWN, { host }), NOW);
    expect(diagnosisText(stopped(MAC_MINI))).toBe(
      "Kleio on mac-mini-1 isn't running. mac-mini-1 is online and its link answered, but Kleio itself didn't.",
    );
    expect(stopped(MAC_MINI).fix[0]?.command).toBe(RESTART_HOST);
    expect(stopped(LINUX).fix[0]?.command).toBe(START_HOST);
    expect(stopped(WINDOWS).fix[0]?.command).toBe(START_HOST);
    expect(check(stopped(MAC_MINI), "Kleio on mac-mini-1")?.text).toBe("Not running");

    // Kleio answers, but its engine has stopped.
    const engine: LinkHealth = {
      state: "ok",
      value: { sidecar: "down", devices: 2, latencyMs: 90 },
    };
    expect(diagnoseLink(input({}, engine), NOW).fix[0]?.command).toBe(RESTART_ENGINE);
    expect(diagnoseLink(input({}, engine, { host: LINUX }), NOW).fix[0]?.command).toBe(
      START_ENGINE,
    );
  });

  it("no relay answered: this network may block it, and which relays were tried", () => {
    const d = diagnoseLink(input(BLOCKED), NOW);
    expect(diagnosisText(d)).toBe(
      "Kleio can't reach its relay. This network may block it: try mobile data or another Wi-Fi.",
    );
    expect(d.badge).toBe("Relay blocked");
    // n0's are one entry, as the relay list has them.
    expect(check(d, "Relays tried")).toEqual({
      label: "Relays tried",
      tone: "bad",
      text: "relay.example.com, n0's public relays",
    });
    expect(diagnoseLink(input(BLOCKED, NO_ANSWER, { device: "Mac" }), NOW).detail).toBe(
      "This network may block it: try another Wi-Fi or network.",
    );
  });

  it("a relay that no longer takes this version asks for an update", () => {
    const n0 = diagnoseLink(
      input(
        gone({ kind: "relay-refused", relays: [{ host: "euc1-1.relay.n0.iroh.link", n0: true }] }),
      ),
      NOW,
    );
    expect(n0.detail).toBe("Update Kleio to keep connecting through the shared relay.");
    expect(n0.badge).toBe("Update Kleio");
    const own = diagnoseLink(
      input(gone({ kind: "relay-refused", relays: [{ host: "relay.example.com", n0: false }] })),
      NOW,
    );
    expect(own.headline).toBe("Your relay doesn't take this version");
    expect(own.fix.map((s) => s.text)).toContain("Or update the relay on relay.example.com.");
  });

  it("a host that turned this device away: pair again, before anything else", () => {
    const revoked = diagnoseLink(input(gone(null, { refusal: "revoked" })), NOW);
    expect(revoked).toMatchObject({ badge: "Removed", headline: "mac-mini-1 removed this iPhone" });
    expect(revoked.fix[0]?.command).toBe("kleio-host pair");
    // Pairing case 9, in its words.
    const stranger = diagnoseLink(
      input(gone(BLOCKED.unreached ?? null, { refusal: "not-paired" })),
      NOW,
    );
    expect(diagnosisText(stranger)).toBe(
      "mac-mini-1 doesn't know this iPhone. It may have been set up again. Pair it again.",
    );
  });

  it("says this device is offline before blaming the relay or the host", () => {
    const d = diagnoseLink({ ...input(BLOCKED), online: false }, NOW);
    expect(diagnosisText(d)).toBe(
      "This iPhone is offline. It isn't connected to the internet, so it can't reach mac-mini-1.",
    );
  });

  it("while it redials it says Reconnecting; a link that never started, to open Kleio again", () => {
    const redialling = diagnoseLink(input(gone(null, { dialling: true })), NOW);
    expect(redialling).toMatchObject({
      tone: "warn",
      badge: "Reconnecting",
      headline: "Reconnecting to mac-mini-1…",
    });
    expect(diagnosisText(redialling)).toBe(
      "Reconnecting to mac-mini-1… Kleio is looking for it through its relays.",
    );
    expect(diagnoseLink(input(gone(null)), NOW).badge).toBe("Checking");
    const notRunning = diagnoseLink(
      input(gone(null, { running: false, error: "the link's endpoint didn't start: no socket" })),
      NOW,
    );
    expect(notRunning.headline).toBe("Kleio's link isn't running on this iPhone");
    expect(notRunning.detail).toContain("no socket");
    // The link is up, and Kleio didn't answer in time.
    expect(diagnoseLink(input({}), NOW).headline).toBe("Kleio on mac-mini-1 isn't answering");
  });

  it("gives each case its own words, and never talks about Tailscale", () => {
    const all = [
      diagnoseLink(input({}, LINK_UP), NOW),
      diagnoseLink(input({ rateLimited: true }, LINK_UP), NOW),
      diagnoseLink(input(ASLEEP), NOW),
      diagnoseLink(input({}, KLEIO_DOWN), NOW),
      diagnoseLink(input(BLOCKED), NOW),
      diagnoseLink(input(gone({ kind: "relay-refused", relays: [] })), NOW),
      diagnoseLink(input(gone(null, { refusal: "revoked" })), NOW),
      diagnoseLink(input(gone(null, { refusal: "not-paired" })), NOW),
      diagnoseLink({ ...input(BLOCKED), online: false }, NOW),
      diagnoseLink(input(gone(null, { dialling: true })), NOW),
      diagnoseLink(input(gone(null, { running: false })), NOW),
      diagnoseLink(input({}), NOW),
      diagnoseLink(input(gone(null)), NOW),
    ];
    expect(new Set(all.map((d) => d.headline)).size).toBe(all.length);
    for (const d of all) expect(diagnosisText(d)).not.toMatch(/Tailscale/);
  });

  it("knows the host's link answering for a stopped Kleio", () => {
    expect(isKleioDown(502, "kleio_down")).toBe(true);
    // Tailscale's proxy, or anything else.
    expect(isKleioDown(502, "bad gateway")).toBe(false);
    expect(isKleioDown(502, undefined)).toBe(false);
    expect(isKleioDown(500, "kleio_down")).toBe(false);
  });
});
