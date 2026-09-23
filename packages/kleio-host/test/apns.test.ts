import { createServer, type Server } from "node:http";
import { generateKeyPairSync, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apnsConfigFromEnv,
  createApnsPusher,
  createProviderTokenSigner,
  MIN_PUSH_INTERVAL_MS,
} from "../src/apns.js";
import type { PairedDevice } from "../src/device-registry.js";

/** Fake Apple: records every push; 200 unless the token says otherwise. */
interface FakeApns {
  server: Server;
  base: string;
  pushes: { path: string; headers: Record<string, string | string[] | undefined>; body: unknown }[];
  close(): Promise<void>;
}
async function fakeApns(): Promise<FakeApns> {
  const pushes: FakeApns["pushes"] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      pushes.push({ path: req.url ?? "", headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(req.url?.endsWith("bad") ? 410 : 200);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    pushes,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function device(over: Partial<PairedDevice>): PairedDevice {
  return {
    deviceId: "d-" + Math.random().toString(36).slice(2, 8),
    label: "phone",
    created: "2026-01-01T00:00:00Z",
    lastSeen: null,
    revoked: false,
    admin: false,
    push: null,
    ...over,
  };
}
const reg = (token: string, env: "sandbox" | "production" = "sandbox") => ({
  token,
  env,
  registeredAt: "2026-01-01T00:00:00Z",
});

let apple: FakeApns;
let dir: string;
let keyPath: string;
let publicPem: string;
let clock: number;

beforeEach(async () => {
  apple = await fakeApns();
  dir = mkdtempSync(join(tmpdir(), "kleio-apns-"));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  keyPath = join(dir, "AuthKey.p8");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  clock = 1_700_000_000_000;
});
afterEach(async () => {
  await apple.close();
  rmSync(dir, { recursive: true, force: true });
});

function pusher(over: Partial<NonNullable<ReturnType<typeof apnsConfigFromEnv>>> = {}) {
  return createApnsPusher({
    config: {
      keyPath,
      keyId: "KEY123",
      teamId: "TEAM456",
      bundleId: "com.kleio.app",
      env: "sandbox",
      endpoint: apple.base,
      ...over,
    },
    now: () => clock,
  });
}

describe("apnsConfigFromEnv", () => {
  it("is null unless every Apple credential is present; env defaults to sandbox", () => {
    expect(apnsConfigFromEnv({})).toBeNull();
    expect(
      apnsConfigFromEnv({
        KLEIO_APNS_KEY_PATH: "k",
        KLEIO_APNS_KEY_ID: "i",
        KLEIO_APNS_TEAM_ID: "t",
      }),
    ).toBeNull();
    const full = {
      KLEIO_APNS_KEY_PATH: "k",
      KLEIO_APNS_KEY_ID: "i",
      KLEIO_APNS_TEAM_ID: "t",
      KLEIO_APNS_BUNDLE_ID: "b",
    };
    expect(apnsConfigFromEnv(full)).toMatchObject({ env: "sandbox" });
    expect(apnsConfigFromEnv({ ...full, KLEIO_APNS_ENV: "production" })).toMatchObject({
      env: "production",
    });
    expect(apnsConfigFromEnv({ ...full, KLEIO_APNS_ENV: "nonsense" })).toMatchObject({
      env: "sandbox",
    });
  });
});

describe("liveActivity", () => {
  it("updates a Live Activity on its own token, topic and push type", async () => {
    const p = pusher();
    const r = await p.liveActivity(
      { token: "cd".repeat(32), env: "sandbox" },
      { event: "update", contentState: { step: "Tool", statusText: "Running bash" }, priority: 5 },
    );
    expect(r).toBe("ok");
    const push = apple.pushes[0]!;
    expect(push.path).toBe(`/3/device/${"cd".repeat(32)}`);
    expect(push.headers["apns-topic"]).toBe("com.kleio.app.push-type.liveactivity");
    expect(push.headers["apns-push-type"]).toBe("liveactivity");
    expect(push.headers["apns-priority"]).toBe("5");
    expect(push.body).toEqual({
      aps: {
        timestamp: Math.floor(clock / 1000),
        event: "update",
        "content-state": { step: "Tool", statusText: "Running bash" },
      },
    });
  });

  it("ends with priority 10 and a dismissal date", async () => {
    const p = pusher();
    await p.liveActivity(
      { token: "cd".repeat(32), env: "sandbox" },
      { event: "end", contentState: { done: true }, priority: 10, dismissalDate: 123 },
    );
    const push = apple.pushes[0]!;
    expect(push.headers["apns-priority"]).toBe("10");
    expect(push.body).toMatchObject({ aps: { event: "end", "dismissal-date": 123 } });
  });

  it("reports gone on 410, and sends nothing for the wrong env or when unconfigured", async () => {
    const p = pusher();
    expect(
      await p.liveActivity(
        { token: "ab".repeat(15) + "bad", env: "sandbox" },
        { event: "update", contentState: {}, priority: 5 },
      ),
    ).toBe("gone");
    expect(
      await p.liveActivity(
        { token: "cd".repeat(32), env: "production" },
        { event: "update", contentState: {}, priority: 5 },
      ),
    ).toBe("failed");
    expect(
      await createApnsPusher({ config: null }).liveActivity(
        { token: "cd".repeat(32), env: "sandbox" },
        { event: "update", contentState: {}, priority: 5 },
      ),
    ).toBe("failed");
    expect(apple.pushes).toHaveLength(1); // only the 410 one reached "Apple"
  });

  it("the alert nudge is unchanged by the shared transport: topic is the bare bundle id", async () => {
    const p = pusher();
    await p.notify({ sessionId: "s" }, [device({ push: reg("11".repeat(16)) })]);
    expect(apple.pushes[0]!.headers["apns-topic"]).toBe("com.kleio.app");
    expect(apple.pushes[0]!.headers["apns-push-type"]).toBe("alert");
  });
});

describe("createApnsPusher", () => {
  it("is a no-op when unconfigured", async () => {
    const p = createApnsPusher({ config: null });
    expect(p.configured).toBe(false);
    expect(await p.notify({ sessionId: "s" }, [device({ push: reg("aa".repeat(16)) })])).toBe(0);
    expect(apple.pushes).toHaveLength(0);
  });

  it("pushes to registered, live devices of the configured env only — one alert each", async () => {
    const p = pusher();
    const devices = [
      device({ label: "iphone", push: reg("11".repeat(16)) }),
      device({ label: "old iphone", push: reg("22".repeat(16), "production") }),
      device({ label: "revoked", revoked: true, push: reg("33".repeat(16)) }),
      device({ label: "laptop" }),
    ];
    expect(await p.notify({ sessionId: "sess-1", title: "Nightly check" }, devices)).toBe(1);
    expect(apple.pushes).toHaveLength(1);
    const push = apple.pushes[0]!;
    expect(push.path).toBe(`/3/device/${"11".repeat(16)}`);
    expect(push.headers["apns-topic"]).toBe("com.kleio.app");
    expect(push.headers["apns-push-type"]).toBe("alert");
    expect(push.body).toMatchObject({
      aps: { alert: { title: "Nightly check" }, "thread-id": "sess-1", "mutable-content": 1 },
      kleio: { sessionId: "sess-1" },
    });
    // The nudge carries no transcript: content comes from the ring on attach.
    expect(JSON.stringify(push.body)).not.toMatch(/text_delta|prompt/);
  });

  it("coalesces completions inside MIN_PUSH_INTERVAL_MS", async () => {
    const p = pusher();
    const devices = [device({ push: reg("11".repeat(16)) })];
    expect(await p.notify({ sessionId: "a" }, devices)).toBe(1);
    clock += MIN_PUSH_INTERVAL_MS - 1;
    expect(await p.notify({ sessionId: "b" }, devices)).toBe(0);
    clock += 1;
    expect(await p.notify({ sessionId: "c" }, devices)).toBe(1);
    expect(
      apple.pushes.map((x) => (x.body as { kleio: { sessionId: string } }).kleio.sessionId),
    ).toEqual(["a", "c"]);
  });

  it("counts only accepted pushes and never throws on a rejection", async () => {
    const p = pusher();
    const devices = [
      device({ push: reg("11".repeat(16)) }),
      device({ push: reg("ab".repeat(15) + "bad") }),
    ];
    // "bad" is not hex, so it would be rejected at registration; force it in
    // here to exercise the 410 path.
    expect(await p.notify({ sessionId: "s" }, devices)).toBe(1);
    expect(apple.pushes).toHaveLength(2);
  });

  it("signs Apple's provider JWT (ES256, kid/iss/iat) that verifies with the key's public half, and caches it", async () => {
    const sign = createProviderTokenSigner(
      { keyPath, keyId: "KEY123", teamId: "TEAM456", bundleId: "b", env: "sandbox" },
      () => clock,
    );
    const jwt = await sign();
    const [header, claims, sig] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY123",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "TEAM456",
      iat: Math.floor(clock / 1000),
    });
    const ok = cryptoVerify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(publicPem), dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url"),
    );
    expect(ok).toBe(true);
    // Reused inside Apple's hour; re-signed after.
    clock += 49 * 60_000;
    expect(await sign()).toBe(jwt);
    clock += 2 * 60_000;
    expect(await sign()).not.toBe(jwt);
  });
});
