// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as KleioApi from "./kleioApi";
import { KleioApiError, startVoiceCall } from "./kleioApi";
import {
  callError,
  callState,
  functionCall,
  GREETING,
  isWebSearch,
  resetCall,
  startCall,
} from "./voiceCall";

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  startVoiceCall: vi.fn(),
}));

describe("callError", () => {
  it("says plainly what stopped the conversation", () => {
    const cases: [unknown, RegExp][] = [
      [new DOMException("denied", "NotAllowedError"), /needs your microphone/],
      [new KleioApiError(409, "no_key"), /Add an OpenAI key in Settings/],
      [new KleioApiError(422, "bad_key"), /didn't accept the key/],
      [new KleioApiError(422, "no_credit"), /out of credit/],
      [new KleioApiError(504, "unreachable"), /couldn't reach OpenAI/],
      [new KleioApiError(0, "offline"), /couldn't reach your Mac mini/],
      [new KleioApiError(404, "not_found"), /needs the latest Kleio/],
      [new KleioApiError(502, "rejected", "Model not found"), /OpenAI said: Model not found/],
      [new Error("boom"), /Something went wrong/],
    ];
    for (const [e, want] of cases) expect(callError(e)).toMatch(want);
  });
});

describe("isWebSearch", () => {
  it("spots the backend's hosted web search, and is not a function call", () => {
    const item = { type: "web_search_call", id: "ws1", status: "completed" };
    expect(isWebSearch(item)).toBe(true);
    expect(functionCall(item)).toBeNull();
    expect(isWebSearch({ type: "function_call" })).toBe(false);
    expect(isWebSearch(null)).toBe(false);
  });
});

describe("functionCall", () => {
  it("reads a finished tool call from the backend, and nothing else", () => {
    expect(
      functionCall({
        type: "function_call",
        call_id: "c1",
        name: "draft_plan",
        arguments: '{"to":"Chef","plan":"Eggs."}',
      }),
    ).toEqual({ callId: "c1", name: "draft_plan", args: { to: "Chef", plan: "Eggs." } });
    // Broken arguments: the tool says what's missing.
    expect(
      functionCall({ type: "function_call", call_id: "c2", name: "send_plan", arguments: "{" }),
    ).toEqual({ callId: "c2", name: "send_plan", args: {} });
    expect(functionCall({ type: "message", content: [] })).toBeNull();
    expect(functionCall(null)).toBeNull();
  });
});

describe("startCall", () => {
  afterEach(() => {
    resetCall();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("closing while it connects stops the call and releases the microphone", async () => {
    const track = { stop: vi.fn(), enabled: true };
    const mic = { getAudioTracks: () => [track], getTracks: () => [track] };
    const pcs: { close: ReturnType<typeof vi.fn> }[] = [];
    class FakePC {
      ontrack: unknown = null;
      close = vi.fn();
      constructor() {
        pcs.push(this);
      }
      addTrack(): void {}
      addEventListener(): void {}
      createDataChannel(): unknown {
        return { addEventListener: () => {}, close: () => {}, readyState: "connecting" };
      }
      async createOffer(): Promise<{ type: string; sdp: string }> {
        return { type: "offer", sdp: "v=0\r\n" };
      }
      async setLocalDescription(): Promise<void> {}
      async setRemoteDescription(): Promise<void> {}
    }
    vi.stubGlobal("RTCPeerConnection", FakePC);
    vi.stubGlobal("Audio", class {});
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: async () => mic } });
    let answer: (sdp: string) => void = () => {};
    vi.mocked(startVoiceCall).mockReturnValue(new Promise((r) => (answer = r)));

    const starting = startCall();
    await vi.waitFor(() => expect(startVoiceCall).toHaveBeenCalled());
    expect(callState().phase).toBe("connecting");

    resetCall(); // The user closes the panel before OpenAI answers.
    answer("v=0\r\n");
    await starting;

    expect(callState().phase).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    expect(pcs[0]?.close).toHaveBeenCalled();
  });

  it("opens with a warm welcome, not a report of what isn't happening", async () => {
    const track = { stop: vi.fn(), enabled: true };
    const mic = { getAudioTracks: () => [track], getTracks: () => [track] };
    let onMessage: (m: { data: string }) => void = () => {};
    const channel = {
      readyState: "open",
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: (type: string, fn: (m: { data: string }) => void) => {
        if (type === "message") onMessage = fn;
      },
    };
    class FakePC {
      ontrack: unknown = null;
      close = vi.fn();
      addTrack(): void {}
      addEventListener(): void {}
      createDataChannel(): unknown {
        return channel;
      }
      async createOffer(): Promise<{ type: string; sdp: string }> {
        return { type: "offer", sdp: "v=0\r\n" };
      }
      async setLocalDescription(): Promise<void> {}
      async setRemoteDescription(): Promise<void> {}
    }
    vi.stubGlobal("RTCPeerConnection", FakePC);
    vi.stubGlobal("Audio", class {});
    vi.stubGlobal("MediaStream", class {});
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: async () => mic } });
    vi.mocked(startVoiceCall).mockResolvedValue("v=0\r\n");

    await startCall();
    onMessage({ data: JSON.stringify({ type: "session.started" }) });

    const sent = channel.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(sent).toContainEqual({
      type: "session.instructions.append",
      delegation_id: null,
      content: GREETING,
    });
    // Welcoming: the time of day, their name, an offer to help; never "nothing is pressing".
    expect(GREETING).toMatch(/welcome/i);
    expect(GREETING).toMatch(/good morning, good afternoon or good evening/);
    expect(GREETING).toMatch(/by name/);
    expect(GREETING).toMatch(/If nothing does, don't say so/);
  });

  it("keeps the same state while her words stream in, so the screen doesn't re-render", async () => {
    const track = { stop: vi.fn(), enabled: true };
    const mic = { getAudioTracks: () => [track], getTracks: () => [track] };
    let onMessage: (m: { data: string }) => void = () => {};
    const channel = {
      readyState: "open",
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: (type: string, fn: (m: { data: string }) => void) => {
        if (type === "message") onMessage = fn;
      },
    };
    class FakePC {
      ontrack: unknown = null;
      close = vi.fn();
      addTrack(): void {}
      addEventListener(): void {}
      createDataChannel(): unknown {
        return channel;
      }
      async createOffer(): Promise<{ type: string; sdp: string }> {
        return { type: "offer", sdp: "v=0\r\n" };
      }
      async setLocalDescription(): Promise<void> {}
      async setRemoteDescription(): Promise<void> {}
    }
    vi.stubGlobal("RTCPeerConnection", FakePC);
    vi.stubGlobal("Audio", class {});
    vi.stubGlobal("MediaStream", class {});
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: async () => mic } });
    vi.mocked(startVoiceCall).mockResolvedValue("v=0\r\n");
    const event = (e: Record<string, unknown>): void => onMessage({ data: JSON.stringify(e) });

    await startCall();
    event({ type: "session.output_transcript.delta", delta: "Morning," });
    const speaking = callState();
    expect(speaking.phase).toBe("speaking");

    event({ type: "session.output_transcript.delta", delta: " Finn." });
    expect(callState()).toBe(speaking);
  });

  it("hangs up after 2 minutes with nobody talking; talking starts the countdown again", async () => {
    vi.useFakeTimers();
    const track = { stop: vi.fn(), enabled: true };
    const mic = { getAudioTracks: () => [track], getTracks: () => [track] };
    let onMessage: (m: { data: string }) => void = () => {};
    const channel = {
      readyState: "open",
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: (type: string, fn: (m: { data: string }) => void) => {
        if (type === "message") onMessage = fn;
      },
    };
    class FakePC {
      ontrack: unknown = null;
      close = vi.fn();
      addTrack(): void {}
      addEventListener(): void {}
      createDataChannel(): unknown {
        return channel;
      }
      async createOffer(): Promise<{ type: string; sdp: string }> {
        return { type: "offer", sdp: "v=0\r\n" };
      }
      async setLocalDescription(): Promise<void> {}
      async setRemoteDescription(): Promise<void> {}
    }
    vi.stubGlobal("RTCPeerConnection", FakePC);
    vi.stubGlobal("Audio", class {});
    vi.stubGlobal("MediaStream", class {});
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: async () => mic } });
    vi.mocked(startVoiceCall).mockResolvedValue("v=0\r\n");
    const event = (e: Record<string, unknown>): void => onMessage({ data: JSON.stringify(e) });

    await startCall();
    expect(callState().phase).toBe("listening");

    vi.advanceTimersByTime(90_000);
    event({ type: "session.input_transcript.delta", delta: "Hello?" }); // The countdown restarts.
    vi.advanceTimersByTime(90_000);
    event({ type: "session.usage.updated", usage: { seconds: 180 } }); // Not anyone talking.
    expect(callState().phase).not.toBe("ended");

    vi.advanceTimersByTime(30_000);
    expect(callState()).toMatchObject({
      phase: "ended",
      error: expect.stringMatching(/2 minutes of quiet/),
    });
    // The session ends at OpenAI too, which stops the billing.
    expect(channel.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "session.close" }));
    expect(track.stop).toHaveBeenCalled();
  });
});
