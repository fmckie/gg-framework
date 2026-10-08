/**
 * APNs "come look" nudge.
 *
 * When a run finishes on a session with NO device attached, the host sends one
 * alert push per registered phone: a nudge, not the content. The transcript
 * itself is in the ring and replays on attach with `Last-Event-ID`. Same model
 * as the old gg-ios-bridge (and Hermes): alert pushes only, never per-frame.
 *
 * Off unless every Apple credential is present — a dev host without the `.p8`
 * key is a silent no-op. Every failure is swallowed: push must never break the
 * streaming/replay path.
 *
 *   KLEIO_APNS_KEY_PATH   Apple `.p8` key (PKCS#8 PEM)
 *   KLEIO_APNS_KEY_ID     JWT `kid`
 *   KLEIO_APNS_TEAM_ID    JWT `iss`
 *   KLEIO_APNS_BUNDLE_ID  apns-topic
 *   KLEIO_APNS_ENV        sandbox | production (default sandbox)
 *   KLEIO_APNS_ENDPOINT   override base URL for tests (HTTP/1, never Apple)
 */

import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect as http2Connect, constants as h2 } from "node:http2";
import { request as httpRequest } from "node:http";
import type { PairedDevice, PushRegistration } from "./device-registry.js";
import { noticeFor, type NoticeInput } from "./notification-copy.js";

const PRODUCTION = "https://api.push.apple.com";
const SANDBOX = "https://api.sandbox.push.apple.com";
/** Apple accepts a token for up to an hour; refresh well inside that. */
const JWT_TTL_MS = 50 * 60 * 1000;
/** Two runs finishing within this window produce one push, not two. */
export const MIN_PUSH_INTERVAL_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApnsConfig {
  readonly keyPath: string;
  readonly keyId: string;
  readonly teamId: string;
  readonly bundleId: string;
  readonly env: "sandbox" | "production";
  /** Test hook: plain-HTTP base URL. Real hosts never set it. */
  readonly endpoint?: string;
}

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyPath = (env.KLEIO_APNS_KEY_PATH ?? "").trim();
  const keyId = (env.KLEIO_APNS_KEY_ID ?? "").trim();
  const teamId = (env.KLEIO_APNS_TEAM_ID ?? "").trim();
  const bundleId = (env.KLEIO_APNS_BUNDLE_ID ?? "").trim();
  if (!keyPath || !keyId || !teamId || !bundleId) return null;
  const envName = (env.KLEIO_APNS_ENV ?? "sandbox").trim().toLowerCase();
  const endpoint = (env.KLEIO_APNS_ENDPOINT ?? "").trim();
  return {
    keyPath,
    keyId,
    teamId,
    bundleId,
    env: envName === "production" ? "production" : "sandbox",
    ...(endpoint ? { endpoint } : {}),
  };
}

/**
 * What a push is about: a session, a group chat (groups.ts), or both. The
 * payload's `kleio` carries whichever is set; thread-id is the group when set.
 */
export type Nudge = NoticeInput &
  (
    | { readonly sessionId: string; readonly groupId?: string }
    | { readonly sessionId?: string; readonly groupId: string }
  );

/** A Live Activity's own push token, registered by the phone for one session. */
export interface LiveActivityTarget {
  /** ActivityKit push token, hex. Not the device's alert token. */
  readonly token: string;
  readonly env: "sandbox" | "production";
}

/** A Live Activity alert: lights the screen and expands the Dynamic Island. */
export interface LiveActivityAlert {
  readonly title: string;
  readonly body: string;
  readonly sound?: "default";
}

export interface LiveActivityPush {
  /**
   * `start` is push-to-start (sent to a device's push-to-start token, needs
   * `attributesType`, `attributes` and an `alert`); `update`/`end` go to the
   * activity's own update token.
   */
  readonly event: "start" | "update" | "end";
  /** Must decode as the app's `KleioActivityAttributes.ContentState`. */
  readonly contentState: Record<string, unknown>;
  /** `start` only: the Swift attributes type name, e.g. "KleioActivityAttributes". */
  readonly attributesType?: string;
  /** `start` only: the activity's static attributes. */
  readonly attributes?: Record<string, unknown>;
  readonly alert?: LiveActivityAlert;
  /** Unix seconds; when iOS should show the activity as out of date. */
  readonly staleDate?: number;
  /** Unix seconds; `end` only. When the lock screen should drop the activity. */
  readonly dismissalDate?: number;
  /** 10 = deliver now (phase changes, alerts); 5 = may be batched by iOS (progress). */
  readonly priority: 5 | 10;
}

/** `gone`: Apple says the activity token is no longer valid (410) — forget it. */
export type LiveActivityResult = "ok" | "gone" | "failed";

export interface ApnsPusher {
  readonly configured: boolean;
  /** The APNs environment pushes go to, when configured. */
  readonly env?: "sandbox" | "production";
  /**
   * One best-effort alert, worded by notification-copy.ts. A `question` (an
   * `ask_user` awaiting the user) is never throttled and never stamps the
   * throttle: a turn is blocked on it. One to every registered device for this env. Returns the
   * number of devices that accepted. Coalesced within MIN_PUSH_INTERVAL_MS.
   */
  notify(nudge: Nudge, devices: readonly PairedDevice[]): Promise<number>;
  /**
   * Start (push-to-start), update or end one Live Activity on the lock screen. Separate from
   * `notify`: different token (the activity's), topic
   * (`<bundle>.push-type.liveactivity`) and push type (`liveactivity`).
   */
  liveActivity(target: LiveActivityTarget, push: LiveActivityPush): Promise<LiveActivityResult>;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Apple's provider token: ES256 JWT, `kid` = key id, `iss` = team id, `iat`
 * now. Cached by the pusher and refreshed inside Apple's one-hour limit.
 */
export function createProviderTokenSigner(cfg: ApnsConfig, now: () => number = Date.now) {
  let key: KeyObject | null = null;
  let jwt: { value: string; issuedAt: number } | null = null;
  return async (): Promise<string> => {
    const t = now();
    if (jwt && t - jwt.issuedAt < JWT_TTL_MS) return jwt.value;
    if (!key) key = createPrivateKey(await readFile(cfg.keyPath, "utf8"));
    const header = base64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
    const claims = base64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(t / 1000) }));
    const input = `${header}.${claims}`;
    const sig = cryptoSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
    jwt = { value: `${input}.${sig.toString("base64url")}`, issuedAt: t };
    return jwt.value;
  };
}

export function createApnsPusher(opts: {
  config: ApnsConfig | null;
  log?: (line: string) => void;
  now?: () => number;
}): ApnsPusher {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const config = opts.config;
  const authToken = config ? createProviderTokenSigner(config, now) : null;
  let lastPushAt = 0;

  // Both transports resolve the HTTP status, or 0 when there was no response.
  function sendHttp1(base: string, path: string, headers: Record<string, string>, body: string) {
    return new Promise<number>((resolve) => {
      const u = new URL(path, base);
      const req = httpRequest(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname,
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(0));
      req.end(body);
    });
  }

  function sendHttp2(base: string, path: string, headers: Record<string, string>, body: string) {
    return new Promise<number>((resolve) => {
      const client = http2Connect(base);
      const done = (status: number): void => {
        client.close();
        resolve(status);
      };
      const timer = setTimeout(() => done(0), REQUEST_TIMEOUT_MS);
      client.on("error", () => {
        clearTimeout(timer);
        done(0);
      });
      const req = client.request({
        [h2.HTTP2_HEADER_METHOD]: "POST",
        [h2.HTTP2_HEADER_PATH]: path,
        "content-type": "application/json",
        ...headers,
      });
      req.on("response", (h) => {
        clearTimeout(timer);
        const status = Number(h[h2.HTTP2_HEADER_STATUS]);
        req.resume();
        req.on("end", () => done(status));
      });
      req.on("error", () => {
        clearTimeout(timer);
        done(0);
      });
      req.end(body);
    });
  }

  async function send(
    cfg: ApnsConfig,
    token: string,
    payload: unknown,
    kind: { pushType: "alert" | "liveactivity"; priority: 5 | 10; collapseId?: string } = {
      pushType: "alert",
      priority: 10,
    },
  ): Promise<number> {
    const path = `/3/device/${token}`;
    const headers: Record<string, string> = {
      "apns-topic":
        kind.pushType === "liveactivity" ? `${cfg.bundleId}.push-type.liveactivity` : cfg.bundleId,
      "apns-push-type": kind.pushType,
      "apns-priority": String(kind.priority),
      ...(kind.collapseId ? { "apns-collapse-id": kind.collapseId } : {}),
    };
    const body = JSON.stringify(payload);
    if (cfg.endpoint) return sendHttp1(cfg.endpoint, path, headers, body);
    headers.authorization = `bearer ${await authToken!()}`;
    return sendHttp2(cfg.env === "production" ? PRODUCTION : SANDBOX, path, headers, body);
  }

  return {
    configured: config !== null,
    ...(config ? { env: config.env } : {}),
    async notify(nudge, devices) {
      if (!config) return 0;
      const ask = nudge.kind === "question";
      if (!ask) {
        const t = now();
        if (t - lastPushAt < MIN_PUSH_INTERVAL_MS) return 0;
        // Stamp first so a near-simultaneous second completion coalesces.
        lastPushAt = t;
      }
      const registered = devices.filter(
        (d): d is PairedDevice & { push: PushRegistration } =>
          !d.revoked && d.push !== null && d.push.env === config.env,
      );
      // One alert per phone. Re-pairing a phone (or replacing its app) leaves
      // older pairings that registered the same APNs token, and each would
      // otherwise ring it again.
      const targets = [...new Map(registered.map((d) => [d.push.token, d])).values()];
      if (targets.length === 0) return 0;
      const thread = nudge.groupId ?? nudge.sessionId;
      const notice = noticeFor(nudge, thread);
      const payload = {
        aps: {
          alert: { title: notice.title, subtitle: notice.subtitle, body: notice.body },
          sound: "default",
          "thread-id": thread,
          // "active", not "time-sensitive": the app has no time-sensitive entitlement.
          "interruption-level": notice.interruptionLevel,
          "relevance-score": notice.relevanceScore,
          "mutable-content": 1,
        },
        kleio: {
          ...(nudge.sessionId ? { sessionId: nudge.sessionId } : {}),
          ...(nudge.groupId ? { groupId: nudge.groupId } : {}),
          ...(ask ? { ask: true } : {}),
        },
      };
      const kind = {
        pushType: "alert" as const,
        priority: 10 as const,
        ...(notice.collapseId ? { collapseId: notice.collapseId } : {}),
      };
      try {
        const results = await Promise.allSettled(
          targets.map((d) => send(config, d.push.token, payload, kind)),
        );
        const okCount = results.filter((r) => r.status === "fulfilled" && r.value === 200).length;
        log(
          `[apns] nudged ${okCount}/${targets.length} device(s) for ${nudge.groupId ?? nudge.sessionId}`,
        );
        return okCount;
      } catch (e) {
        log(`[apns] push failed: ${String(e)}`);
        return 0;
      }
    },
    async liveActivity(target, push) {
      if (!config || target.env !== config.env) return "failed";
      const payload = {
        aps: {
          timestamp: Math.floor(now() / 1000),
          event: push.event,
          ...(push.attributesType !== undefined ? { "attributes-type": push.attributesType } : {}),
          ...(push.attributes !== undefined ? { attributes: push.attributes } : {}),
          "content-state": push.contentState,
          ...(push.alert !== undefined ? { alert: push.alert } : {}),
          ...(push.staleDate !== undefined ? { "stale-date": push.staleDate } : {}),
          ...(push.dismissalDate !== undefined ? { "dismissal-date": push.dismissalDate } : {}),
        },
      };
      try {
        const status = await send(config, target.token, payload, {
          pushType: "liveactivity",
          priority: push.priority,
        });
        if (status === 200) return "ok";
        if (status === 410) return "gone";
        log(`[live] Apple answered ${status || "nothing"} for a ${push.event}`);
        return "failed";
      } catch (e) {
        log(`[live] push failed: ${String(e)}`);
        return "failed";
      }
    },
  };
}
