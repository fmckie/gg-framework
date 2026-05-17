import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import type { Provider } from "../types.js";
import { streamOpenAI } from "./openai.js";

const createMock = vi.fn();

vi.mock("openai", () => {
  class OpenAIMock {
    chat = {
      completions: {
        create: createMock,
      },
    };
  }
  return { default: OpenAIMock };
});

function createStreamingResult(argsJson: string): AsyncIterable<OpenAI.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 1,
      model: "test",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "bash", arguments: argsJson },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    yield {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 1,
      model: "test",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  })() as AsyncIterable<OpenAI.ChatCompletionChunk>;
}

async function collectResponse(provider: Provider, argsJson: string) {
  createMock.mockResolvedValueOnce(createStreamingResult(argsJson));
  const result = streamOpenAI({
    provider,
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    apiKey: "token",
  });

  const events = [];
  for await (const event of result) events.push(event);
  return { events, response: await result.response };
}

describe("streamOpenAI tool argument parsing", () => {
  afterEach(() => {
    createMock.mockReset();
  });

  it.each<Provider>(["openai", "glm", "moonshot", "xiaomi", "deepseek", "openrouter"])(
    "preserves streamed function call arguments for %s",
    async (provider) => {
      const { events, response } = await collectResponse(provider, '{"command":"echo ok"}');

      expect(response).toMatchObject({
        message: {
          content: [
            {
              type: "tool_call",
              id: "call_1",
              name: "bash",
              args: { command: "echo ok" },
            },
          ],
        },
        stopReason: "tool_use",
      });
      expect(events).toContainEqual({
        type: "toolcall_done",
        id: "call_1",
        name: "bash",
        args: { command: "echo ok" },
      });
    },
  );

  it("unwraps double-encoded streamed function call arguments", async () => {
    const { response } = await collectResponse("glm", JSON.stringify('{"command":"echo ok"}'));

    expect(response.message.content).toMatchObject([
      {
        type: "tool_call",
        id: "call_1",
        name: "bash",
        args: { command: "echo ok" },
      },
    ]);
  });
});
