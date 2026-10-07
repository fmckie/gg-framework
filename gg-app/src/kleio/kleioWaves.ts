/**
 * Kleio's dithered waves (HomeDither.tsx), shared by the home screen and the
 * voice screen. Deep crimson waves on the warm near-black (RGB 0–1). The
 * dither snaps each channel to a few levels, so a brighter red turns into
 * loud, saturated dots; this stays a quiet backdrop behind the text, as Ken's
 * grey does.
 */
export const KLEIO_WAVES = [0.22, 0.03, 0.05] as const;
export const KLEIO_BACKGROUND = [0.047, 0.035, 0.039] as const;
