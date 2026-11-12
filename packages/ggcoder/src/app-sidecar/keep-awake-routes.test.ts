import type http from "node:http";
import { describe, expect, it } from "vitest";
import { KeepAwake } from "../core/keep-awake.js";
import { handleKeepAwakeRoutes } from "./keep-awake-routes.js";
import type { DaemonRouteContext } from "./route-context.js";

function fakeResponse(): { res: http.ServerResponse; reply: () => unknown } {
  let body: unknown;
  const res = {
    writeHead() {
      return this;
    },
    end(payload: string) {
      body = JSON.parse(payload) as unknown;
    },
  };
  return { res: res as unknown as http.ServerResponse, reply: () => body };
}

function get(keepAwake: KeepAwake): unknown {
  const { res, reply } = fakeResponse();
  const daemon = { keepAwake } as unknown as DaemonRouteContext;
  expect(handleKeepAwakeRoutes(daemon, {} as http.IncomingMessage, res, "/keep-awake", "GET")).toBe(
    true,
  );
  return reply();
}

describe("GET /keep-awake", () => {
  it("says whether the OS assertion is held right now", () => {
    const keepAwake = new KeepAwake({
      platform: "darwin",
      log: () => {},
      onProcessExit: () => {},
      spawner: () => ({ stop() {}, onExit() {}, onError() {} }),
    });
    expect(get(keepAwake)).toEqual({ enabled: true, holding: false });

    const release = keepAwake.acquire("run");
    expect(get(keepAwake)).toEqual({ enabled: true, holding: true });

    keepAwake.setEnabled(false);
    expect(get(keepAwake)).toEqual({ enabled: false, holding: false });

    release();
    keepAwake.dispose();
  });
});
