// A model without vision gets images as "[Image saved at /path]"; previews cut that mid-path.
const IMAGE_NOTE = /^\[Image saved at [^\]]*(?:\]|$)\s*/;

export function readableSessionTitle(preview: string): string {
  let rest = preview.trimStart();
  let images = 0;
  let note = IMAGE_NOTE.exec(rest);
  while (note) {
    images += 1;
    rest = rest.slice(note[0].length);
    note = IMAGE_NOTE.exec(rest);
  }
  if (images === 0) return preview;
  return rest.trim() || (images === 1 ? "Image" : `${images} images`);
}
