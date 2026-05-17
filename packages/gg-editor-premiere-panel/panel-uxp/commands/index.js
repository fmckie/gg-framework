/* eslint-disable */
/**
 * RPC method handlers for the Premiere UXP plugin.
 *
 * Each method is invoked by `main.js` after parsing a wire message of the
 * form `{ id, method, params }`. Methods return raw values; main.js
 * wraps `{ ok: true, result }` and serialises errors via try/catch.
 *
 * Wire shapes intentionally mirror the CEP panel's JSX runtime so the
 * gg-editor adapter doesn't need to branch on transport.
 */

const ppro = require("premierepro");
const { TICKS_PER_SECOND, TRACK_TYPE, MARKER_COLOR_INDEX } = require("./consts.js");
const {
  getActiveProject,
  getActiveSequence,
  findProjectItemByName,
  fpsOf,
  framesToTicks,
  ticksToFrames,
  withTransaction,
} = require("./utils.js");

// ── Helpers specific to this layer ──────────────────────────

function colorIndex(name) {
  const k = (name || "blue").toLowerCase();
  return Object.prototype.hasOwnProperty.call(MARKER_COLOR_INDEX, k)
    ? MARKER_COLOR_INDEX[k]
    : MARKER_COLOR_INDEX.blue;
}

function basename(p) {
  return String(p).replace(/\\/g, "/").split("/").pop();
}

async function collectClips(sequence, kind) {
  const out = [];
  let count;
  if (kind === TRACK_TYPE.VIDEO) count = await sequence.getVideoTrackCount();
  else if (kind === TRACK_TYPE.AUDIO) count = await sequence.getAudioTrackCount();
  else return out;

  for (let ti = 0; ti < count; ti++) {
    const track =
      kind === TRACK_TYPE.VIDEO
        ? await sequence.getVideoTrack(ti)
        : await sequence.getAudioTrack(ti);
    if (!track) continue;
    // 1 = clips (TrackItem.kClipType_Clip); skip transitions.
    const items = await track.getTrackItems(1, false);
    for (let ci = 0; ci < items.length; ci++) {
      const c = items[ci];
      try {
        const startTicks = (await c.getStartTime()).ticks;
        const endTicks = (await c.getEndTime()).ticks;
        const projectItem = await c.getProjectItem();
        const name = projectItem ? projectItem.name : "(unnamed)";
        out.push({
          id: name + ":" + ti + ":" + ci,
          track: ti + 1,
          trackKind: kind,
          startFrame: await ticksToFrames(parseInt(startTicks, 10), sequence),
          endFrame: await ticksToFrames(parseInt(endTicks, 10), sequence),
          name,
        });
      } catch (_) {
        // Skip uninspectable items.
      }
    }
  }
  return out;
}

// ── Method implementations ──────────────────────────────────

async function ping() {
  // app.version may not be exposed via require("premierepro") on every release.
  let version = "?";
  try {
    if (ppro.App && ppro.App.getVersion) version = await ppro.App.getVersion();
  } catch (_) {}
  return { product: "Premiere Pro", version };
}

async function get_timeline() {
  const { sequence } = await getActiveSequence();
  const fps = await fpsOf(sequence);

  const videoClips = await collectClips(sequence, TRACK_TYPE.VIDEO);
  const audioClips = await collectClips(sequence, TRACK_TYPE.AUDIO);
  const clips = videoClips.concat(audioClips);

  const markers = await collectMarkers(sequence);

  const endTime = await sequence.getEndTime();
  const durationFrames = endTime
    ? await ticksToFrames(parseInt(endTime.ticks, 10), sequence)
    : 0;

  return {
    name: sequence.name,
    frameRate: fps,
    durationFrames,
    clips,
    markers,
  };
}

async function collectMarkers(sequence) {
  const out = [];
  let markers;
  try {
    markers = await sequence.getMarkers();
  } catch (_) {
    return out;
  }
  if (!markers) return out;
  let list;
  try {
    list = await markers.getMarkers();
  } catch (_) {
    list = markers; // some API versions return the list directly
  }
  if (!list || !list.length) return out;

  for (const m of list) {
    try {
      const startTicks = parseInt((await m.getStart()).ticks, 10);
      let endTicks = startTicks;
      try {
        endTicks = parseInt((await m.getEnd()).ticks, 10);
      } catch (_) {}
      const startFrame = await ticksToFrames(startTicks, sequence);
      const endFrame = await ticksToFrames(endTicks, sequence);
      let comments = "";
      let name = "";
      try {
        comments = await m.getComments();
      } catch (_) {}
      try {
        name = await m.getName();
      } catch (_) {}
      let color = 6;
      try {
        color = await m.getColor();
      } catch (_) {}
      out.push({
        frame: startFrame,
        note: comments || name || "",
        color,
        durationFrames: Math.max(0, endFrame - startFrame),
      });
    } catch (_) {
      // Skip unreadable marker.
    }
  }
  return out;
}

async function get_markers() {
  const { sequence } = await getActiveSequence();
  return collectMarkers(sequence);
}

async function add_marker(params) {
  const { sequence, project } = await getActiveSequence();
  const startTicks = await framesToTicks(params.frame || 0, sequence);
  const durationFrames = Math.max(1, params.durationFrames || 1);
  const endTicks = await framesToTicks((params.frame || 0) + durationFrames, sequence);
  const note = params.note || "";
  const color = colorIndex(params.color);

  const markers = await sequence.getMarkers();
  if (!markers) throw new Error("Sequence has no markers collection.");

  withTransaction(project, () => {
    const startTickTime = ppro.TickTime.createWithTicks(String(startTicks));
    const endTickTime = ppro.TickTime.createWithTicks(String(endTicks));
    const action = markers.createAddMarkerAction(
      note.substring(0, 60) || "marker",
      "Comment",
      startTickTime,
      endTickTime,
      note,
    );
    return [action];
  });

  // Color is set in a follow-up transaction; older API versions only expose
  // setColor outside the create call. Best-effort: swallow errors.
  try {
    const list = await (await sequence.getMarkers()).getMarkers();
    if (list && list.length) {
      const last = list[list.length - 1];
      if (last && last.createSetColorAction) {
        withTransaction(project, () => [last.createSetColorAction(color)]);
      }
    }
  } catch (_) {}

  return null;
}

async function append_clip(params) {
  const { project, sequence } = await getActiveSequence();
  const trackIndex = Math.max(1, params.track || 1) - 1;

  await ppro.Project.importFiles(project, [params.mediaPath], { addToActiveSequence: false });
  const item = await findProjectItemByName(project, basename(params.mediaPath));
  if (!item) throw new Error("Imported item not found in project: " + params.mediaPath);

  const track = await sequence.getVideoTrack(trackIndex);
  if (!track) throw new Error("Video track " + (trackIndex + 1) + " does not exist.");

  const endTime = await sequence.getEndTime();
  const insertTicks = endTime ? parseInt(endTime.ticks, 10) : 0;

  withTransaction(project, () => {
    const tickTime = ppro.TickTime.createWithTicks(String(insertTicks));
    const action = track.createInsertProjectItemAction(item, tickTime);
    return [action];
  });

  // Read back the inserted clip's range for the result envelope.
  const clips = await track.getTrackItems(1, false);
  const inserted = clips[clips.length - 1];
  const startTicks = parseInt((await inserted.getStartTime()).ticks, 10);
  const endTicks = parseInt((await inserted.getEndTime()).ticks, 10);
  const projectItem = await inserted.getProjectItem();

  return {
    id: (projectItem ? projectItem.name : "clip") + ":" + trackIndex + ":" + (clips.length - 1),
    track: trackIndex + 1,
    trackKind: "video",
    startFrame: await ticksToFrames(startTicks, sequence),
    endFrame: await ticksToFrames(endTicks, sequence),
    name: projectItem ? projectItem.name : params.mediaPath,
  };
}

async function replace_clip(params) {
  const { project, sequence } = await getActiveSequence();
  if (!params.clipId) throw new Error("replace_clip: clipId required");
  if (!params.mediaPath) throw new Error("replace_clip: mediaPath required");

  // clipId encodes track:index by our convention from get_timeline().
  const parts = String(params.clipId).split(":");
  const trackIndex = parseInt(parts[parts.length - 2], 10);
  const clipIndex = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(trackIndex) || !Number.isFinite(clipIndex)) {
    throw new Error("replace_clip: malformed clipId (expected name:track:index)");
  }

  await ppro.Project.importFiles(project, [params.mediaPath], { addToActiveSequence: false });
  const newItem = await findProjectItemByName(project, basename(params.mediaPath));
  if (!newItem) throw new Error("Imported item not found in project: " + params.mediaPath);

  const track = await sequence.getVideoTrack(trackIndex);
  if (!track) throw new Error("Video track " + (trackIndex + 1) + " does not exist.");

  const items = await track.getTrackItems(1, false);
  const target = items[clipIndex];
  if (!target) throw new Error("Clip index " + clipIndex + " does not exist on track.");

  withTransaction(project, () => {
    if (typeof target.createReplaceProjectItemAction === "function") {
      return [target.createReplaceProjectItemAction(newItem)];
    }
    throw new Error("replace_clip: this Premiere version does not expose Replace via UXP.");
  });

  return null;
}

async function clone_timeline(params) {
  const project = await getActiveProject();
  const seq = await project.getActiveSequence();
  if (!seq) throw new Error("No active sequence to clone.");

  const newName = params.newName || seq.name + " (copy)";
  if (typeof project.createCloneSequenceAction !== "function") {
    throw new Error("clone_timeline: this Premiere version doesn't expose sequence cloning.");
  }
  withTransaction(project, () => [project.createCloneSequenceAction(seq, newName)]);

  return { name: newName };
}

async function save_project() {
  const project = await getActiveProject();
  if (typeof project.save === "function") {
    await project.save();
    return null;
  }
  throw new Error("save_project: project.save() not exposed on this Premiere version.");
}

async function import_to_media_pool(params) {
  const project = await getActiveProject();
  const paths = params.paths || [];
  if (!paths.length) return null;

  let targetBin = null;
  if (params.bin) {
    targetBin = await findProjectItemByName(project, params.bin);
  }
  await ppro.Project.importFiles(project, paths, {
    addToActiveSequence: false,
    targetBin: targetBin || undefined,
  });
  return null;
}

async function import_subtitles(params) {
  const project = await getActiveProject();
  if (!params.srtPath) throw new Error("import_subtitles: srtPath required");
  await ppro.Project.importFiles(project, [params.srtPath], { addToActiveSequence: false });
  // Premiere imports SRT as a caption project item but doesn't auto-attach to
  // the sequence \u2014 the user does that manually. Surface that explicitly.
  return {
    imported: true,
    attached: false,
    note: "SRT imported into project; drag onto a caption track to attach.",
  };
}

async function import_timeline(params) {
  const project = await getActiveProject();
  if (!params.filePath) throw new Error("import_timeline: filePath required");
  await ppro.Project.importFiles(project, [params.filePath], { addToActiveSequence: true });
  return null;
}

async function insert_clip_on_track(params) {
  const { project, sequence } = await getActiveSequence();
  const trackIndex = Math.max(1, params.track || 1) - 1;

  await ppro.Project.importFiles(project, [params.mediaPath], { addToActiveSequence: false });
  const item = await findProjectItemByName(project, basename(params.mediaPath));
  if (!item) throw new Error("Imported item not found: " + params.mediaPath);

  const track = await sequence.getVideoTrack(trackIndex);
  if (!track) throw new Error("Video track " + (trackIndex + 1) + " does not exist.");

  const recordTicks = await framesToTicks(params.recordFrame || 0, sequence);

  withTransaction(project, () => {
    const tickTime = ppro.TickTime.createWithTicks(String(recordTicks));
    return [track.createInsertProjectItemAction(item, tickTime)];
  });

  const clips = await track.getTrackItems(1, false);
  // Find the clip that starts at recordTicks (close enough \u2014 it's the one we just inserted).
  let inserted = clips[clips.length - 1];
  for (const c of clips) {
    const t = parseInt((await c.getStartTime()).ticks, 10);
    if (Math.abs(t - recordTicks) <= 1) {
      inserted = c;
      break;
    }
  }
  const startTicks = parseInt((await inserted.getStartTime()).ticks, 10);
  const endTicks = parseInt((await inserted.getEndTime()).ticks, 10);
  const projectItem = await inserted.getProjectItem();

  return {
    id: (projectItem ? projectItem.name : "clip") + ":" + trackIndex + ":" + (clips.length - 1),
    track: trackIndex + 1,
    trackKind: "video",
    startFrame: await ticksToFrames(startTicks, sequence),
    endFrame: await ticksToFrames(endTicks, sequence),
    name: projectItem ? projectItem.name : params.mediaPath,
  };
}

// ── Dispatcher ──────────────────────────────────────────────

const HANDLERS = {
  ping,
  get_timeline,
  get_markers,
  add_marker,
  append_clip,
  replace_clip,
  clone_timeline,
  save_project,
  import_to_media_pool,
  import_subtitles,
  import_timeline,
  insert_clip_on_track,
};

async function handle(method, params) {
  const fn = HANDLERS[method];
  if (!fn) throw new Error("Unknown method: " + method);
  return fn(params || {});
}

module.exports = { handle, HANDLERS };
