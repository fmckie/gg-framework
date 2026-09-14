import { describe, expect, it } from "vitest";
import { RunCompletion } from "./run-completion.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("project-switch run completion", () => {
  it("waits for old finalizers and rejects new runs until the switch resumes", async () => {
    const completion = new RunCompletion();
    const finish = deferred();
    const events: string[] = [];
    const run = completion.track(async () => {
      await finish.promise;
      events.push("old persistence finished");
    });
    const suspended = completion.suspend(() => {
      events.push("abort requested");
    });
    let ready = false;
    void suspended.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    await expect(
      completion.track(async () => {
        events.push("must not run");
      }),
    ).rejects.toThrow("switching");
    finish.resolve();
    await run;
    const resume = await suspended;
    expect(events).toEqual(["abort requested", "old persistence finished"]);
    resume();
    await completion.track(async () => {
      events.push("new project");
    });
    expect(events.at(-1)).toBe("new project");
  });

  it("waits for every pending write before reporting a persistence failure", async () => {
    const completion = new RunCompletion();
    const failed = deferred();
    const healthy = deferred();
    const first = completion.track(async () => {
      await failed.promise;
      throw new Error("disk failure");
    });
    const firstResult = expect(first).rejects.toThrow("disk failure");
    const second = completion.track(async () => {
      await healthy.promise;
    });
    const waiting = completion.wait();
    const waitResult = expect(waiting).rejects.toThrow("disk failure");
    failed.resolve();
    await firstResult;
    let settled = false;
    void waiting.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    healthy.resolve();
    await second;
    await waitResult;
  });

  it("leaves input usable when the switch is rejected before aborting", async () => {
    const completion = new RunCompletion();
    await expect(
      completion.suspend(() => {
        throw new Error("queued messages");
      }),
    ).rejects.toThrow("queued messages");
    await expect(completion.track(async () => {})).resolves.toBeUndefined();
  });
});
