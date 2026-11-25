import { describe, expect, it } from "vitest";
import { framedHost, manualHost } from "./fixtures";
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

  it("a step that only wakes it starts the frames again: a view still till then moves from that moment", () => {
    const host = manualHost();
    const sim = createSim(host);
    const drawn: number[] = [];
    // Still until 1000, then moving for 50ms: as a ribbon held whole, then furled.
    sim.view((now) => {
      drawn.push(now);
      return now >= 1000 && now < 1050;
    });
    sim.at(1000, () => {});
    sim.at(1050, () => {});
    host.run(999, 10);
    expect(drawn).toEqual([0]); // asleep all the while
    host.advance(1);
    for (let i = 0; i < 8; i++) host.advance(10);
    // A frame at its moment, then one each time the window gives one, until it is still again.
    expect([...new Set(drawn)]).toEqual([0, 1000, 1010, 1020, 1030, 1040, 1050]);
    expect(host.pending()).toBe(0);
  });

  it("a still view may say when it will next move: the clock sleeps until then, with no step put on it", () => {
    const host = manualHost();
    const sim = createSim(host);
    const drawn: number[] = [];
    // A gesture every second: still until its moment, moving for 40ms, still again.
    sim.view((now) => {
      drawn.push(now);
      const into = now % 1000;
      return into < 40 ? true : now - into + 1000;
    });
    for (let i = 0; i < 5; i++) host.advance(10);
    expect(drawn).toEqual([0, 10, 20, 30, 40]);
    expect(host.pending()).toBe(1); // a wait, and nothing else
    host.run(949, 10);
    expect(drawn).toEqual([0, 10, 20, 30, 40]); // asleep all the while
    host.advance(1);
    expect(drawn[5]).toBe(1000); // at its moment, to the ms
    for (let i = 0; i < 6; i++) host.advance(10);
    // A frame each time the window gives one, until it is still again.
    expect([...new Set(drawn)]).toEqual([0, 10, 20, 30, 40, 1000, 1010, 1020, 1030, 1040]);
    expect(host.pending()).toBe(1); // asleep until the next
    sim.stop();
    expect(host.pending()).toBe(0);
  });

  it("wakes for whichever comes first, a step or a view's own moment; a moment already past is the next frame", () => {
    const host = manualHost();
    const sim = createSim(host);
    const drawn: number[] = [];
    const steps: number[] = [];
    sim.view((now) => {
      drawn.push(now);
      return now < 700 ? 700 : false;
    });
    sim.at(300, () => steps.push(sim.now()));
    host.advance(1000);
    expect(steps).toEqual([300]);
    expect(drawn).toEqual([0, 300, 700]); // the step first, then the view's moment
    expect(host.pending()).toBe(0); // and then nothing: asleep for good
    // A moment that has passed by the time it is named: frame after frame, as if it were moving.
    const late = manualHost();
    const frames: number[] = [];
    createSim(late).view((now) => {
      frames.push(now);
      return frames.length < 3 ? now - 1 : false;
    });
    for (let i = 0; i < 5; i++) late.advance(10);
    expect(frames).toEqual([0, 10, 20]);
    expect(late.pending()).toBe(0);
  });

  it("handles the same steps at the same moments however the frames fall, and draws the last for the moment it ends on", () => {
    const play = (every: number | null): { steps: string[]; last: number } => {
      const host = every === null ? framedHost() : manualHost();
      const sim = createSim(host);
      const steps: string[] = [];
      let last = -1;
      // Moving all the while, and what it draws is the time alone.
      sim.view((now) => {
        last = now;
        return true;
      });
      const beat = (n: number): void => {
        steps.push(`${n} at ${sim.now()}`);
        if (n < 9) sim.after(137, () => beat(n + 1));
      };
      sim.at(40, () => beat(0));
      if (every === null) host.advance(2000);
      else host.run(2000, every);
      return { steps, last };
    };
    const none = play(null);
    expect(none.steps).toHaveLength(10);
    expect(none.steps[9]).toBe("9 at 1273");
    expect(none.last).toBe(2000);
    for (const every of [7, 1000 / 60, 33, 250]) expect(play(every)).toEqual(none);
  });
});
