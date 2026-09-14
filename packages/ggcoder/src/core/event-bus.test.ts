/**
 * `forwardAgentEvent` copies agent events onto the bus field by field, so a new
 * field on an agent event is silently dropped unless it is added here too. That
 * already happened once with `invalidArgAttempt` (the schema-rejection repeat
 * counter), which reached the sidecar as `undefined` and left the log unable to
 * distinguish a self-corrected retry from a loop that killed the turn.
 */
import { describe, it, expect } from "vitest";
import { EventBus } from "./event-bus.js";

describe("EventBus.forwardAgentEvent", () => {
  it("carries invalidArgAttempt through to listeners", () => {
    const bus = new EventBus();
    const seen: (number | undefined)[] = [];
    bus.on("tool_call_end", (d) => seen.push(d.invalidArgAttempt));

    bus.forwardAgentEvent({
      type: "tool_call_end",
      toolCallId: "t1",
      result: "Invalid arguments for tool `edit`",
      isError: true,
      durationMs: 0,
      invalidArgAttempt: 2,
    });
    bus.forwardAgentEvent({
      type: "tool_call_end",
      toolCallId: "t2",
      result: "applied",
      isError: false,
      durationMs: 5,
    });

    expect(seen).toEqual([2, undefined]);
  });
});
