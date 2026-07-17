// Moved to @kleio/core. Shim keeps `../core/voice-transcriber.js`
// imports working.
export {
  setProgressCallback,
  resample,
  downmixToMono,
  decodeOggOpus,
  isModelLoaded,
  transcribeVoice,
  type ProgressCallback,
} from "@kleio/core";
