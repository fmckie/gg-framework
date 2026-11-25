import { describe, expect, it } from "vitest";
import { manualHost } from "./fixtures";
import { createSim } from "./sim";

describe("the lane's clock", () => {
  it("handles steps in time order, each at its own moment, however late the frame", () => {
    const host = manualHost();
    const sim = createSim(host);
    const seen: string[] = [];
    sim.at(300, () => seen.push(`c ${sim.now()}`));
    sim.at(100, () => seen.push(`a ${sim.now()}`));
    sim.at(200, () => seen.push(`b ${sim.now()}`));
    host.advance(50);
    expect(seen).toEqual([]);
    host.advance(1000);
    expect(seen).toEqual(["a 100", "b 200", "c 300"]);
  });

  it("handles steps for the same moment in the order they were asked for", () => {
    const host = manualHost();
    const sim = createSim(host);
    const seen: number[] = [];
    for (const n of [1, 2, 3]) sim.at(40, () => seen.push(n));
    host.advance(40);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("counts `after` from the step being handled, and never schedules into the past", () => {
    const host = manualHost();
    const sim = createSim(host);
    const seen: number[] = [];
    sim.at(100, () => {
      sim.after(250, () => seen.push(sim.now()));
      sim.at(20, () => seen.push(sim.now()));
    });
    host.advance(2000);
    expect(seen).toEqual([100, 350]);
  });

  it("handles what comes from outside at the clock's present moment", () => {
    const host = manualHost();
    const sim = createSim(host);
    host.advance(5000); // asleep: nothing to do
    let at = -1;
    sim.soon(() => (at = sim.now()));
    expect(at).toBe(-1);
    host.advance(0);
    expect(at).toBe(5000);
  });

  it("drops a cancelled step", () => {
    const host = manualHost();
    const sim = createSim(host);
    let ran = false;
    const step = sim.at(100, () => (ran = true));
    sim.cancel(step);
    sim.cancel(null);
    host.advance(500);
    expect(ran).toBe(false);
    expect(host.pending()).toBe(0);
  });

  it("sleeps until its next step while every view is still", () => {
    const host = manualHost();
    const sim = createSim(host);
    let frames = 0;
    sim.view(() => {
      frames += 1;
      return false;
    });
    sim.at(3000, () => {});
    host.advance(2999);
    expect(frames).toBe(1); // the frame that found nothing due, and went to sleep
    expect(host.pending()).toBe(1);
    host.advance(1);
    expect(frames).toBe(2);
    expect(host.pending()).toBe(0);
  });

  it("draws frame after frame while a view is moving", () => {
    const host = manualHost();
    const sim = createSim(host);
    const drawn: number[] = [];
    sim.view((now) => {
      drawn.push(now);
      return now < 30;
    });
    for (let i = 0; i < 6; i++) host.advance(10);
    expect(drawn).toEqual([0, 10, 20, 30]);
    expect(host.pending()).toBe(0);
  });

  it("stops for good", () => {
    const host = manualHost();
    const sim = createSim(host);
    let ran = false;
    sim.at(100, () => (ran = true));
    sim.stop();
    sim.at(200, () => (ran = true));
    sim.wake();
    host.advance(1000);
    expect(ran).toBe(false);
    expect(host.pending()).toBe(0);
  });
});
