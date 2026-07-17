import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { FusionCompArgs, VideoHost } from "../core/hosts/types.js";

/**
 * fusion_comp — single tool with an `action` discriminator that drives
 * Resolve's Fusion node graph for motion graphics.
 *
 * Why one tool with `action=` instead of one tool per action? Fusion is a
 * graph editor — every action takes the same comp scope (timeline-clip comp
 * or active Fusion-page comp), and the agent will typically chain 5-10 of
 * them per lower-third / title build. Splitting into 8 sibling tools would
 * 8x the per-tool description tokens for a feature that's effectively one
 * compound op.
 *
 * Resolve only. Premiere has no Fusion equivalent — agents that need motion
 * graphics on Premiere should render the graphic separately and replace_clip,
 * or use After Effects via Dynamic Link (out of scope here).
 *
 * Common tool IDs the agent will reach for:
 *   Background, TextPlus, Merge, Transform, ColorCorrector, DeltaKeyer,
 *   Brightness/Contrast, Glow, Blur.
 *
 * Canonical recipe — lower third:
 *   1. add_node toolId=Background name=BG    (the strap)
 *   2. add_node toolId=TextPlus  name=TXT     (the text)
 *   3. add_node toolId=Merge     name=COMP    (composite text over strap)
 *   4. connect  fromNode=BG  toNode=COMP toInput=Background
 *   5. connect  fromNode=TXT toNode=COMP toInput=Foreground
 *   6. set_input node=TXT input=StyledText value="Name · Title"
 *   7. set_input node=BG  input=TopLeft     value=[0.05, 0.10]
 */
const ListNodes = z.object({
  action: z.literal("list_nodes"),
  clipId: z
    .string()
    .optional()
    .describe(
      "When set, operate on this clip's first Fusion comp instead of the active Fusion-page comp.",
    ),
});

const AddNode = z.object({
  action: z.literal("add_node"),
  toolId: z
    .string()
    .min(1)
    .describe(
      "Fusion tool ID — e.g. 'TextPlus', 'Background', 'Merge', 'Transform', 'ColorCorrector', 'DeltaKeyer'.",
    ),
  name: z.string().optional().describe("Optional human name for the new node."),
  clipId: z.string().optional(),
});

const DeleteNode = z.object({
  action: z.literal("delete_node"),
  name: z.string().min(1),
  clipId: z.string().optional(),
});

const Connect = z.object({
  action: z.literal("connect"),
  fromNode: z.string().min(1),
  toNode: z.string().min(1),
  fromOutput: z
    .string()
    .optional()
    .describe("Defaults to the main 'Output'. Use for non-default outputs (e.g. 'Mask')."),
  toInput: z
    .string()
    .optional()
    .describe(
      "Defaults to the main input. For Merge, use 'Background' or 'Foreground' explicitly.",
    ),
  clipId: z.string().optional(),
});

const SetInput = z.object({
  action: z.literal("set_input"),
  node: z.string().min(1),
  input: z.string().min(1),
  value: z.unknown().describe("Number, string, [r,g,b], [x,y], etc. — Fusion input shape."),
  clipId: z.string().optional(),
});

const GetInput = z.object({
  action: z.literal("get_input"),
  node: z.string().min(1),
  input: z.string().min(1),
  clipId: z.string().optional(),
});

const SetKeyframe = z.object({
  action: z.literal("set_keyframe"),
  node: z.string().min(1),
  input: z.string().min(1),
  frame: z.number().int().min(0),
  value: z.unknown(),
  clipId: z.string().optional(),
});

const SetRenderRange = z.object({
  action: z.literal("set_render_range"),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  clipId: z.string().optional(),
});

const FusionCompParams = z.discriminatedUnion("action", [
  ListNodes,
  AddNode,
  DeleteNode,
  Connect,
  SetInput,
  GetInput,
  SetKeyframe,
  SetRenderRange,
]);

export function createFusionCompTool(host: VideoHost): AgentTool<typeof FusionCompParams> {
  return {
    name: "fusion_comp",
    description:
      "Drive a Fusion composition for motion graphics — lower-thirds, title cards, simple " +
      "comps. Single tool with an `action` discriminator: list_nodes, add_node, delete_node, " +
      "connect, set_input, get_input, set_keyframe, set_render_range. Operates on the active " +
      "Fusion-page comp by default, or pass clipId to scope to that clip's first Fusion comp " +
      "(auto-created if missing). Resolve only — Premiere has no Fusion equivalent. " +
      "Common tool IDs: Background, TextPlus, Merge, Transform, ColorCorrector, DeltaKeyer. " +
      "Lower-third recipe: Background + TextPlus + Merge, wire Background→Merge.Background " +
      "and TextPlus→Merge.Foreground.",
    parameters: FusionCompParams,
    async execute(args) {
      if (typeof host.executeFusionComp !== "function") {
        return err(
          "not_supported: this host has no Fusion equivalent",
          "switch to Resolve, or render the graphic separately and use replace_clip",
        );
      }
      try {
        const result = await host.executeFusionComp(args as FusionCompArgs);
        return compact({ ok: true, result });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
