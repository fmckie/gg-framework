# @kenkaiiii/ggcoder

## 4.5.0

### Minor Changes

- Add native video analysis for Kimi K2.6, Gemini, and MiniMax. Attached and read videos are sent to the model in its required format (Kimi file-service upload, Gemini inlineData, MiniMax base64), with per-model size caps and automatic ffmpeg compression for oversized clips. Non-video models now show a clean "this model can't analyze video" message instead of an opaque provider error, and Kimi OAuth login was fixed to pass the coding-endpoint client identity.

### Patch Changes

- @kenkaiiii/gg-ai@4.5.0
- @kenkaiiii/gg-agent@4.5.0
- @kenkaiiii/gg-core@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [9e381ad]
  - @kenkaiiii/gg-core@4.4.0
  - @kenkaiiii/gg-ai@4.4.0
  - @kenkaiiii/gg-agent@4.4.0
