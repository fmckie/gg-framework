import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICodex } from "./openai-codex.js";

function createSseResponse(events: Record<string, unknown>[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("streamOpenAICodex", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves streamed function call arguments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createSseResponse([
          {
            type: "response.output_item.added",
            item: { type: "function_call", call_id: "call_1", id: "item_1", name: "bash" },
          },
          {
            type: "response.function_call_arguments.delta",
            item_id: "item_1",
            delta: '{"command":"echo ok"}',
          },
          {
            type: "response.output_item.done",
            item: { type: "function_call", call_id: "call_1", id: "item_1" },
          },
          {
            type: "response.completed",
            response: { usage: { input_tokens: 10, output_tokens: 5 } },
          },
        ]),
      ),
    );

    const result = streamOpenAICodex({
      provider: "openai",
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "token",
      accountId: "acct",
    });

    const events = [];
    for await (const event of result) events.push(event);

    await expect(result.response).resolves.toMatchObject({
      message: {
        content: [
          {
            type: "tool_call",
            id: "call_1|item_1",
            name: "bash",
            args: { command: "echo ok" },
          },
        ],
      },
      stopReason: "tool_use",
    });
    expect(events).toContainEqual({
      type: "toolcall_done",
      id: "call_1|item_1",
      name: "bash",
      args: { command: "echo ok" },
    });
  });

  it("unwraps double-encoded function call arguments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createSseResponse([
          {
            type: "response.output_item.added",
            item: { type: "function_call", call_id: "call_1", id: "item_1", name: "bash" },
          },
          {
            type: "response.function_call_arguments.done",
            item_id: "item_1",
            arguments: JSON.stringify('{"command":"echo ok"}'),
          },
          {
            type: "response.completed",
            response: { usage: { input_tokens: 10, output_tokens: 5 } },
          },
        ]),
      ),
    );

    const result = streamOpenAICodex({
      provider: "openai",
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "token",
      accountId: "acct",
    });

    for await (const _event of result) {
      // consume stream
    }

    await expect(result.response).resolves.toMatchObject({
      message: {
        content: [
          {
            type: "tool_call",
            id: "call_1|item_1",
            name: "bash",
            args: { command: "echo ok" },
          },
        ],
      },
    });
  });
});
