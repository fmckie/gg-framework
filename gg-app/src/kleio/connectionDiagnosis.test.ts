import { describe, expect, it } from "vitest";
import {
  diagnose,
  RESTART_ENGINE,
  RESTART_HOST,
  TAILSCALE_DOWNLOAD,
  TAILSCALE_MACHINES,
  unreachableReason,
  type DiagnosisInput,
  type HealthCheck,
} from "./connectionDiagnosis";
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
