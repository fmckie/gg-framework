// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as KleioApi from "./kleioApi";
import { KleioApiError, startVoiceCall } from "./kleioApi";
import { callError, callState, resetCall, startCall } from "./voiceCall";

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

describe("startCall", () => {
  afterEach(() => {
    resetCall();
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
});
