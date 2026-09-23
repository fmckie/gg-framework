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

export interface Nudge {
  readonly sessionId: string;
  /** A short label for the lock screen, e.g. the routine's prompt. */
  readonly title?: string;
  readonly body?: string;
}

export interface ApnsPusher {
  readonly configured: boolean;
  /**
   * One best-effort alert to every registered device for this env. Returns the
   * number of devices that accepted. Coalesced within MIN_PUSH_INTERVAL_MS.
   */
  notify(nudge: Nudge, devices: readonly PairedDevice[]): Promise<number>;
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

  function sendHttp1(base: string, path: string, headers: Record<string, string>, body: string) {
    return new Promise<boolean>((resolve) => {
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
          res.on("end", () => resolve(res.statusCode === 200));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
      req.end(body);
    });
  }

  function sendHttp2(base: string, path: string, headers: Record<string, string>, body: string) {
    return new Promise<boolean>((resolve) => {
      const client = http2Connect(base);
      const done = (ok: boolean): void => {
        client.close();
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), REQUEST_TIMEOUT_MS);
      client.on("error", () => {
        clearTimeout(timer);
        done(false);
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
        req.on("end", () => done(status === 200));
      });
      req.on("error", () => {
        clearTimeout(timer);
        done(false);
      });
      req.end(body);
    });
  }

  async function send(cfg: ApnsConfig, push: PushRegistration, payload: unknown): Promise<boolean> {
    const path = `/3/device/${push.token}`;
    const headers: Record<string, string> = {
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    };
    const body = JSON.stringify(payload);
    if (cfg.endpoint) return sendHttp1(cfg.endpoint, path, headers, body);
    headers.authorization = `bearer ${await authToken!()}`;
    return sendHttp2(cfg.env === "production" ? PRODUCTION : SANDBOX, path, headers, body);
  }

  return {
    configured: config !== null,
    async notify(nudge, devices) {
      if (!config) return 0;
      const t = now();
      if (t - lastPushAt < MIN_PUSH_INTERVAL_MS) return 0;
      // Stamp first so a near-simultaneous second completion coalesces.
      lastPushAt = t;
      const targets = devices.filter(
        (d): d is PairedDevice & { push: PushRegistration } =>
          !d.revoked && d.push !== null && d.push.env === config.env,
      );
      if (targets.length === 0) return 0;
      const payload = {
        aps: {
          alert: {
            title: nudge.title ?? "Kleio",
            body: nudge.body ?? "A run finished on your host. Open to see the result.",
          },
          sound: "default",
          "thread-id": nudge.sessionId,
          "interruption-level": "time-sensitive",
          "relevance-score": 0.8,
          "mutable-content": 1,
        },
        kleio: { sessionId: nudge.sessionId },
      };
      try {
        const results = await Promise.allSettled(targets.map((d) => send(config, d.push, payload)));
        const okCount = results.filter((r) => r.status === "fulfilled" && r.value).length;
        log(`[apns] nudged ${okCount}/${targets.length} device(s) for ${nudge.sessionId}`);
        return okCount;
      } catch (e) {
        log(`[apns] push failed: ${String(e)}`);
        return 0;
      }
    },
  };
}
