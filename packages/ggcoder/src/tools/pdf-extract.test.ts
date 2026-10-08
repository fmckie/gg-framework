import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPdfText, extractPdfTextPages } from "./pdf-extract.js";

const fixturePath = fileURLToPath(new URL("./__fixtures__/sample.pdf", import.meta.url));

const unpdfInstalled = await import("unpdf").then(() => true).catch(() => false);

describe.skipIf(!unpdfInstalled)("extractPdfText", () => {
  it("extracts text and page count from a minimal PDF", async () => {
    const bytes = new Uint8Array(await readFile(fixturePath));
    const { text, pages } = await extractPdfText(bytes);

    expect(text).toContain("Hello PDF World");
    expect(pages).toBe(1);
  });
});

describe.skipIf(!unpdfInstalled)("extractPdfTextPages", () => {
  it("reads at most the asked pages but reports the total", async () => {
    const bytes = new Uint8Array(await readFile(fixturePath));
    const one = await extractPdfTextPages(bytes, 200);
    expect(one.text).toContain("Hello PDF World");
    expect(one.pages).toBe(1);
    const none = await extractPdfTextPages(new Uint8Array(await readFile(fixturePath)), 0);
    expect(none).toEqual({ text: "", pages: 1 });
  });
});
