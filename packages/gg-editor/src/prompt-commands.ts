/**
 * Bundled slash-command prompt templates for gg-editor.
 *
 * Mirrors Kleio Coder's `core/prompt-commands.ts` pattern: each command name maps
 * to a full prompt that the agent loop executes. When the user types `/X`,
 * the App.tsx slash dispatcher looks up the command, optionally appends any
 * args, and runs the prompt as if it were a normal user message.
 *
 * Why bundled (not custom): these are core gg-editor workflows tied to our
 * tool surface (`brand_kit`, `audit_*`, `verify_thumbnail_promise`, etc.).
 * Per-project custom commands could still live in `<cwd>/.gg/commands/*.md`
 * if we wire that loader in later — bundled commands take priority either
 * way.
 */

export interface PromptCommand {
  name: string;
  aliases: string[];
  description: string;
  prompt: string;
}

export const EDITOR_PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "setup-channel",
    aliases: ["brand-kit"],
    description: "Walk through brand-kit setup, write .gg/brand.json",
    prompt: `# Brand kit setup

Walk the user through configuring their channel's brand kit. The output is a single JSON file at \`<cwd>/.gg/brand.json\` that every render-time tool inherits from.

## Why this matters

Once the brand kit is set up, the user never has to re-specify channel name, logo, fonts, colours, intro/outro, or CTA on any future video. Tools like \`generate_outro\`, \`compose_thumbnail_variants\`, \`compose_thumbnail\`, and \`generate_youtube_metadata\` automatically inherit the kit's defaults.

## How to run this

ASK the user the questions below ONE AT A TIME (or in small grouped batches). DO NOT ask them all at once — that's overwhelming. Skip optional fields cleanly when the user says "skip" or "n/a". Show your work as you go.

After each answer, validate quickly:
- Path fields → confirm the file exists at the given path (use \`probe_media\` for video files, just check existence for fonts/images via your read tool's error behaviour).
- Hex colours → must be 6 hex chars, no leading \`#\`. If the user provides \`#FF6B35\`, strip the \`#\` automatically.
- URLs → no validation needed, just record.

If validation fails, tell the user clearly and ask once more.

## The questions, in order

### Required
1. **Channel name** — display name surfaced in outros / lower-thirds / metadata. Free text.
2. **Channel niche / topic** — one-sentence description. Used to give \`generate_youtube_metadata\` topical context for descriptions.

### Visual identity (recommended, but skippable)
3. **Logo** — relative path to a PNG with alpha (used by \`overlay_watermark\` and \`generate_outro\`). Skip if none.
4. **Watermark** — separate path if they have a positioned/sized variant (otherwise the agent uses logo). Optional.
5. **Intro video** — pre-rendered intro mp4 to splice via \`concat_videos\`. Optional.
6. **Outro video** — pre-rendered outro mp4. Optional. (\`generate_outro\` can produce one on-the-fly if they don't have one.)

### Typography (one-time pain, lifelong save)
7. **Heading font** — path to a .ttf/.otf used for thumbnail text + outro headline. Bebas Neue, Inter Black, Anton, Impact are common choices. If they don't have one, suggest downloading Bebas Neue (free, https://fonts.google.com/specimen/Bebas+Neue) and recommend a path like \`assets/Bebas-Bold.ttf\`.
8. **Body font** — for lower-thirds / captions. Optional; skip is fine.

### Colours (6-char hex, no #)
9. **Primary colour** — used for thumbnail text outline, accent. e.g. \`FF6B35\`.
10. **Secondary colour** — optional accent.
11. **Accent colour** — optional third.

### Voice
12. **CTA text** — what the outro card says. Default suggestion: "Subscribe for more". Free text.
13. **Subscribe URL** — full URL of their channel (e.g. \`youtube.com/@kenkaidoesai\`). Optional but useful for description templates.

## Writing the file

Use the file-write tool path you have access to (the agent's general write tool — not a video tool). The file must be valid JSON with at minimum the fields the user provided. Skip fields they declined; do NOT write empty strings or null values.

Schema (only include keys the user actually answered):

\`\`\`json
{
  "channelName": "string",
  "logo": "string (relative path)",
  "watermark": "string",
  "intro": "string",
  "outro": "string",
  "fonts": { "heading": "string", "body": "string" },
  "colors": { "primary": "RRGGBB", "secondary": "RRGGBB", "accent": "RRGGBB" },
  "ctaText": "string",
  "subscribeUrl": "string"
}
\`\`\`

\`channelStyle\` (the niche from question 2) is NOT a brand-kit field — it goes into a separate \`<cwd>/.gg/editor-styles/channel.md\` if the user wants the LLM to consistently match their voice. Offer this as a follow-up after the kit is saved.

After writing \`<cwd>/.gg/brand.json\`:
1. Show the user the final saved JSON (pretty-printed) so they can sanity-check.
2. Tell them what's next:

> Brand kit saved to \`.gg/brand.json\`. From now on, every render automatically uses these defaults. Drop your footage in this directory and try:
>
> \`Make me a YouTube video from <filename>\`
>
> The agent will pick up the brand kit silently and produce a long-form cut + Shorts + thumbnails + metadata in one prompt.

3. If they skipped colours / fonts, gently note what they're missing — the kit still works without them, but thumbnail consistency takes a hit.

## Idempotency

If \`<cwd>/.gg/brand.json\` ALREADY exists, read it first. Tell the user what's currently set and ask whether they want to (a) update specific fields, (b) start over, or (c) cancel. Default to update-specific-fields and only ask the relevant questions.

## Constraints

- Don't fabricate paths. If the user says "I have a logo at \`assets/logo.png\`" — verify the file actually exists before writing it into the JSON. If it doesn't, say so and ask if they want to fix the path or skip the field.
- Don't over-engineer. The brand kit is small. Don't ask about lower-third templates, end-screen positioning, or other advanced stuff in this command.
- Keep tone friendly and quick. This should take the user under 3 minutes.
`,
  },
  {
    name: "audit",
    aliases: ["pre-render"],
    description: "Run the canonical pre-render audit chain on a video",
    prompt: `# Pre-render audit

Run the canonical audit chain before declaring a video ready to ship. The user will provide the video path (or thumbnail + video) as args; if not provided, ASK them which file to audit and whether it's a Short or long-form.

## For Shorts (short-form)

\`\`\`
audit_first_frame(input)               # is t=0 thumbnail-quality?
analyze_hook(input)                    # does the spoken line earn the watch in the first 3s?
verify_thumbnail_promise(thumbnail, input, windowSec=15)
\`\`\`

If any score is below the gate (\`audit_first_frame.score < 60\`, \`analyze_hook.score < 60\`, \`verify_thumbnail_promise.matches < 0.6\`), surface the failing check + the tool's suggestion. **Don't say it passes when it doesn't.**

If the hook fails specifically, run \`rewrite_hook(currentHook=..., pattern="auto")\` to produce 3 candidate rewrites and surface them to the user. Be explicit: the agent can't re-record the line — the user has to either pick an alternative opener from existing source or re-shoot.

## For long-form

\`\`\`
analyze_hook(input)                                     # first 3s
audit_retention_structure(transcript, checkpoints=...)  # 3min, 6min, 9min
verify_thumbnail_promise(thumbnail, input, windowSec=60) # MrBeast: match clickbait promise in first minute
pre_render_check(timelineEmpty=false, expectCaptions=true,
                 loudnessSource=..., loudnessTarget="youtube")
\`\`\`

For each weak retention checkpoint, propose ONE concrete fix (\`cut_filler_words\`, \`text_based_cut\`, \`punch_in\`, or \`add_sfx_at_cuts\`) on the surrounding window. Don't dump the whole menu.

## Reporting

End with a structured pass/fail summary:

\`\`\`
✅ first_frame:        82 — strong subject, clear contrast
⚠️  hook:              54 — silent open, no on-screen text
✅ thumbnail_promise:  0.78
❌ retention[3min]:    0.42 — flat 2:30–3:30; suggested: punch_in + add_sfx_at_cuts
✅ retention[6min]:    0.71
✅ pre_render:         pass
\`\`\`

The user reads the table and decides what to fix. Don't auto-fix without asking.
`,
  },
  {
    name: "diagnose",
    aliases: ["why-no-views"],
    description: "Diagnose an underperforming video from Studio metrics",
    prompt: `# Diagnose underperformance

The user's video isn't getting views and they want to know why. The agent does NOT have access to YouTube Studio. Don't fabricate diagnoses.

## Step 1 — Get the numbers

ASK the user to paste from YouTube Studio:

- **Impressions** (total)
- **Click-through rate (CTR)** as a %
- **Average view duration (AVD)** as M:SS
- **Average percentage viewed (AVP%)** as a %
- **Total video length** in seconds or M:SS

If they have the retention CSV exported, accept that too — it gives much more diagnostic power. Otherwise the four numbers above are enough.

## Step 2 — Diagnose in order, surface the FIRST failing metric

Use the order from the \`youtube-algorithm-primer\` skill (read it via \`read_skill\` if you haven't this session):

1. **CTR < 4% vs the channel's typical baseline?**
   → The package (thumbnail + title) isn't earning the click.
   → Recommend running \`compose_thumbnail_variants(input=..., strategy="expression", count=3)\` plus \`generate_youtube_metadata\` for 3 fresh title candidates.
   → Tell the user to upload the resulting variants to YouTube Studio's **Test & Compare** (which the agent CANNOT trigger directly — it lives only in Studio). YouTube picks the winner by Watch Time Share over 1–14 days.

2. **CTR ok but AVP% < 30%?**
   → Hook problem.
   → Run \`analyze_hook\` on the video. If Shorts, also \`audit_first_frame\`.
   → If hook scores low, run \`rewrite_hook(pattern="auto")\` and surface 3 candidates.
   → Be explicit: the agent CAN'T re-record. Options: pick a different opener from existing source via \`text_based_cut\`, or re-shoot.

3. **AVP% ok but AVD low (in absolute time)?**
   → Pacing.
   → Run \`audit_retention_structure(transcript)\` to find the flat stretches.
   → For each weak checkpoint propose ONE fix (\`cut_filler_words\` / \`text_based_cut\` / \`punch_in\` / \`add_sfx_at_cuts\`).

4. **AVD ok but no growth past initial views?** (Session contribution.)
   → Outro / next-video pointer missing. Use \`generate_outro\` with the brand kit's outro chain.

5. **Engagement velocity zero in first 24h?**
   → Either no question in description (run \`generate_youtube_metadata\` to add one) OR small-channel reality (no algorithmic fix; tell the user honestly).

## Step 3 — Surface ONE concrete fix

Don't dump the menu. Pick the FIRST failing metric and propose one tool call. After the user runs that fix and re-uploads / re-tests, they can come back and \`/diagnose\` again on the new numbers.

## Constraints

- If the user gives one number and asks for a full diagnosis, ask for the others first. CTR alone isn't enough; CTR plus AVP% is.
- If the channel is genuinely small (< 1k subs) and CTR is fine but views are low, tell them: this is community-size, not an algorithmic problem. No tool fix.
- Cite the source from the \`youtube-algorithm-primer\` skill when the user asks "why does that metric matter?" — don't paraphrase from memory.
`,
  },
  {
    name: "youtube",
    aliases: ["yt"],
    description: "Make a YouTube video (long-form + Shorts) from footage",
    prompt: `# Canonical YouTube delivery

Run the \`youtube-end-to-end\` skill on the footage the user provides. If they didn't specify a file, ASK once for the path; otherwise just go.

## Steps (the skill is authoritative — read it if you haven't this session)

1. \`read_skill(name="youtube-end-to-end")\` if not already in your context.
2. \`probe_media(input)\` — duration determines whether to produce long-form, Shorts, or both. Default per the skill: > 5min source → both.
3. Read \`<cwd>/.gg/brand.json\` if it exists. Mention which fields you'll inherit. If it DOESN'T exist, mention that running \`/setup-channel\` first would mean every future video uses the channel's defaults automatically — but don't block on it.
4. Run the canonical pipeline.
5. Run the pre-render audit chain (\`audit_first_frame\` on Shorts, \`analyze_hook\`, \`verify_thumbnail_promise\`, \`audit_retention_structure\` for long-form).
6. End with the structured deliverable summary the skill prescribes (long-form path, Shorts paths, 3 candidate titles, 3 thumbnail variants, description, dropped candidates with reasons).

## Reminders

- Don't paraphrase the skill's pipeline — call it out and follow it.
- The agent CANNOT generate footage. If a hook fails after \`rewrite_hook\`, surface the candidates and let the user choose between recutting and re-shooting.
- The agent CANNOT trigger Test & Compare. Tell the user to upload the 3 thumbnails to Studio manually.
`,
  },
];

/** Look up a prompt command by name or alias. Returns undefined when not found. */
export function getEditorPromptCommand(name: string): PromptCommand | undefined {
  return EDITOR_PROMPT_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases.includes(name));
}
