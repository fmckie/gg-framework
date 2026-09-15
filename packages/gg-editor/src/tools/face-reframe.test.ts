import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as faceCore from "../core/face-reframe.js";
import * as ffmpegMod from "../core/media/ffmpeg.js";
import * as pythonMod from "../core/python.js";
import { createFaceReframeTool } from "./face-reframe.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createFaceReframeTool>["execute"]>[1];

const samplePlan: faceCore.ReframePlan = {
  shots: [
    {
      startSec: 0,
      endSec: 2,
      frames: [],
      smoothedX: 0.4,
      smoothedY: 0.5,
      mode: "face",
    },
    {
      startSec: 2,
      endSec: 5,
      frames: [],
      smoothedX: 0.6,
      smoothedY: 0.5,
      mode: "static",
    },
  ],
  totalSec: 5,
  fps: 30,
  sourceWidth: 1920,
  sourceHeight: 1080,
};

describe("face_reframe tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ffmpeg-missing error when ffmpeg is absent", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(false);
    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error: ffmpeg not on PATH/);
  });

  it("returns python-missing error when findPython fails", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
    vi.spyOn(pythonMod, "findPython").mockReturnValue(undefined);
    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/Python 3 not on PATH/);
    expect(r).toMatch(/mediapipe/);
  });

  it("composes ffmpeg args from the analysis plan", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(faceCore, "analyzeReframe").mockResolvedValue(samplePlan);
    const ffSpy = vi
      .spyOn(ffmpegMod, "runFfmpeg")
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    const parsed = JSON.parse(r as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.aspect).toBe("9:16");
    expect(parsed.shots).toBe(2);
    expect(parsed.faceShots).toBe(1);
    expect(parsed.fallbackShots).toBe(1);
    expect(parsed.outWidth).toBe(606);
    expect(parsed.outHeight).toBe(1080);

    // Inspect ffmpeg invocation.
    expect(ffSpy).toHaveBeenCalledTimes(1);
    const ffArgs = ffSpy.mock.calls[0][0];
    expect(ffArgs).toContain("-i");
    expect(ffArgs).toContain(resolve("/tmp", "in.mp4"));
    expect(ffArgs).toContain("-vf");
    const vfIdx = ffArgs.indexOf("-vf");
    const vf = ffArgs[vfIdx + 1];
    expect(vf).toMatch(/^crop=606:1080:x='/);
    expect(vf).toContain("between(t\\,0\\,2)");
    expect(vf).toContain("between(t\\,2\\,5)");
    expect(ffArgs).toContain("-c:a");
    expect(ffArgs).toContain("copy");
    expect(ffArgs).toContain("-c:v");
    expect(ffArgs).toContain("libx264"); // default codec
    expect(ffArgs).toContain("-crf");
    expect(ffArgs).toContain("20"); // default crf
  });

  it("static strategy ignores per-shot smoothedX and centres every crop", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(faceCore, "analyzeReframe").mockResolvedValue(samplePlan);
    const ffSpy = vi
      .spyOn(ffmpegMod, "runFfmpeg")
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4", aspect: "9:16", strategy: "static" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.faceShots).toBe(0);
    expect(parsed.fallbackShots).toBe(2);
    const vf = ffSpy.mock.calls[0][0][ffSpy.mock.calls[0][0].indexOf("-vf") + 1];
    // Both shots collapse to the centre X (657 for 1920×1080 → 9:16 crop 606).
    expect(vf).toContain("\\,657\\,");
    // No off-centre 4-digit X values from the original plan (e.g. 1314).
    expect(vf).not.toMatch(/\\,1\d{3}\\,/);
  });

  it("propagates ffmpeg failure as err()", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(faceCore, "analyzeReframe").mockResolvedValue(samplePlan);
    vi.spyOn(ffmpegMod, "runFfmpeg").mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Could not open codec\nframe= 0 fps=0\nMaybe try -c:v libx264",
    });
    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error: ffmpeg failed/);
    expect(r).toMatch(/Could not open codec|libx264/);
  });

  it("propagates a missing-dep sidecar error with the pip-install fix", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    vi.spyOn(faceCore, "analyzeReframe").mockRejectedValue(
      new Error(
        "missing python dep: mediapipe; install: pip install opencv-python mediapipe scenedetect numpy",
      ),
    );
    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "in.mp4", output: "out.mp4", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/mediapipe/);
    expect(r).toMatch(/pip install opencv-python mediapipe scenedetect numpy/);
  });

  it("rejects identical input and output paths", async () => {
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
    vi.spyOn(pythonMod, "findPython").mockReturnValue({ cmd: "python3", args: [] });
    const tool = createFaceReframeTool("/tmp");
    const r = await tool.execute(
      { input: "x.mp4", output: "x.mp4", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/output and input are identical/);
  });
});
