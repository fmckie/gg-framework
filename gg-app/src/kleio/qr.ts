// A small QR Code (Model 2) encoder, for the pairing ticket the Kleio iPhone
// app reads. Byte mode, error-correction level M, versions 1–40, and the mask
// with the lowest standard penalty. Pure, synchronous, no dependencies.
//
// The algorithm follows ISO/IEC 18004 as structured by Project Nayuki's QR
// Code generator library (MIT License, Copyright (c) Project Nayuki).

export interface QrCode {
  /** Symbol version, 1–40. */
  readonly version: number;
  /** Modules per side: 17 + 4 × version. */
  readonly size: number;
  /** Row-major: the module at (x, y) is `dark[y * size + x]`. */
  readonly dark: readonly boolean[];
}

export type QrResult = { ok: true; value: QrCode } | { ok: false; error: string };

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// Level M, indexed by version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
] as const;
const NUM_ECC_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
] as const;
/** Format-information bits for level M. */
const ECC_FORMAT_BITS = 0;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function at(table: readonly number[], version: number): number {
  const v = table[version];
  if (v === undefined || v < 0) throw new RangeError(`no QR table entry for version ${version}`);
  return v;
}

function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0;
}

/** Modules left for data and error correction once function patterns are placed. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    at(ECC_CODEWORDS_PER_BLOCK, version) * at(NUM_ECC_BLOCKS, version)
  );
}

function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

// ─── Reed–Solomon over GF(2^8), primitive polynomial 0x11D ─────────────────

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < result.length) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Split into blocks, append each block's ECC, and interleave. */
function addEccAndInterleave(data: readonly number[], version: number): number[] {
  const numBlocks = at(NUM_ECC_BLOCKS, version);
  const blockEccLen = at(ECC_CODEWORDS_PER_BLOCK, version);
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    // Short blocks get a placeholder so every block has the same length.
    if (i < numShortBlocks) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  const blockLen = blocks[0]?.length ?? 0;
  for (let i = 0; i < blockLen; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i] ?? 0);
    });
  }
  return result;
}

// ─── data bits ─────────────────────────────────────────────────────────────

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const append = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4); // byte mode
  append(bytes.length, charCountBits(version));
  for (const b of bytes) append(b, 8);
  const capacityBits = dataCodewords(version) * 8;
  append(0, Math.min(4, capacityBits - bits.length)); // terminator
  append(0, (8 - (bits.length % 8)) % 8); // to a byte boundary
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    codewords.push(byte);
  }
  return codewords;
}

// ─── the symbol ────────────────────────────────────────────────────────────

class Grid {
  readonly dark: boolean[];
  readonly isFunction: boolean[];

  constructor(readonly size: number) {
    this.dark = new Array<boolean>(size * size).fill(false);
    this.isFunction = new Array<boolean>(size * size).fill(false);
  }

  get(x: number, y: number): boolean {
    return this.dark[y * this.size + x] ?? false;
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.dark[y * this.size + x] = dark;
    this.isFunction[y * this.size + x] = true;
  }
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFinder(g: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < g.size && y >= 0 && y < g.size)
        g.setFunction(x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(g: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      g.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFormatBits(g: Grid, mask: number): void {
  const data = (ECC_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const size = g.size;
  for (let i = 0; i <= 5; i++) g.setFunction(8, i, bit(bits, i));
  g.setFunction(8, 7, bit(bits, 6));
  g.setFunction(8, 8, bit(bits, 7));
  g.setFunction(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) g.setFunction(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) g.setFunction(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) g.setFunction(8, size - 15 + i, bit(bits, i));
  g.setFunction(8, size - 8, true); // the always-dark module
}

function drawVersion(g: Grid, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = bit(bits, i);
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    g.setFunction(a, b, dark);
    g.setFunction(b, a, dark);
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  for (let i = 0; i < g.size; i++) {
    g.setFunction(6, i, i % 2 === 0);
    g.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(g, 3, 3);
  drawFinder(g, g.size - 4, 3);
  drawFinder(g, 3, g.size - 4);
  const pos = alignmentPositions(version, g.size);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Skip the three corners the finder patterns already occupy.
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      drawAlignment(g, pos[i] ?? 0, pos[j] ?? 0);
    }
  }
  drawFormatBits(g, 0); // reserved now, rewritten once the mask is chosen
  drawVersion(g, version);
}

function drawCodewords(g: Grid, codewords: readonly number[]): void {
  const size = g.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const idx = y * size + x;
        if (!g.isFunction[idx] && i < codewords.length * 8) {
          g.dark[idx] = bit(codewords[i >>> 3] ?? 0, 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XOR the mask over the data modules; applying it twice undoes it. */
function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      const idx = y * g.size + x;
      if (!g.isFunction[idx] && maskApplies(mask, x, y)) g.dark[idx] = !g.dark[idx];
    }
  }
}

// ─── mask penalty (ISO/IEC 18004 §7.8.3) ───────────────────────────────────

function addRun(runLength: number, history: number[], size: number): void {
  // The symbol's light border extends the first run.
  const len = history[0] === 0 ? runLength + size : runLength;
  history.pop();
  history.unshift(len);
}

function countFinderLike(history: readonly number[]): number {
  const n = history[1] ?? 0;
  const core =
    n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  const h0 = history[0] ?? 0;
  const h6 = history[6] ?? 0;
  return (core && h0 >= n * 4 && h6 >= n ? 1 : 0) + (core && h6 >= n * 4 && h0 >= n ? 1 : 0);
}

function lineRunPenalty(g: Grid, read: (i: number) => boolean): number {
  let result = 0;
  let runColor = false;
  let runLength = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < g.size; i++) {
    const color = read(i);
    if (color === runColor) {
      runLength++;
      if (runLength === 5) result += PENALTY_N1;
      else if (runLength > 5) result++;
    } else {
      addRun(runLength, history, g.size);
      if (!runColor) result += countFinderLike(history) * PENALTY_N3;
      runColor = color;
      runLength = 1;
    }
  }
  // Close the line against the light border.
  if (runColor) {
    addRun(runLength, history, g.size);
    runLength = 0;
  }
  addRun(runLength + g.size, history, g.size);
  return result + countFinderLike(history) * PENALTY_N3;
}

function penaltyScore(g: Grid): number {
  const size = g.size;
  let result = 0;
  for (let y = 0; y < size; y++) result += lineRunPenalty(g, (x) => g.get(x, y));
  for (let x = 0; x < size; x++) result += lineRunPenalty(g, (y) => g.get(x, y));
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = g.get(x, y);
      if (c === g.get(x + 1, y) && c === g.get(x, y + 1) && c === g.get(x + 1, y + 1)) {
        result += PENALTY_N2;
      }
    }
  }
  const dark = g.dark.reduce((n, d) => n + (d ? 1 : 0), 0);
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

// ─── public ────────────────────────────────────────────────────────────────

/** Encode UTF-8 text in the smallest version that holds it at level M. */
export function encodeQr(text: string): QrResult {
  const bytes = new TextEncoder().encode(text);
  let version = MIN_VERSION;
  for (; version <= MAX_VERSION; version++) {
    const used = 4 + charCountBits(version) + bytes.length * 8;
    if (used <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) return { ok: false, error: "Too much text for a QR code." };

  const size = version * 4 + 17;
  const g = new Grid(size);
  drawFunctionPatterns(g, version);
  drawCodewords(g, addEccAndInterleave(encodeData(bytes, version), version));

  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(g, mask);
    drawFormatBits(g, mask);
    const penalty = penaltyScore(g);
    if (penalty < bestPenalty) {
      bestMask = mask;
      bestPenalty = penalty;
    }
    applyMask(g, mask);
  }
  applyMask(g, bestMask);
  drawFormatBits(g, bestMask);
  return { ok: true, value: { version, size, dark: g.dark } };
}

/**
 * One SVG path covering every dark module, offset by a `border` of light
 * modules (the quiet zone scanners need; the standard asks for 4). Pair with
 * `viewBox="0 0 {size + 2·border} {size + 2·border}"`.
 */
export function qrSvgPath(qr: QrCode, border = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.dark[y * qr.size + x]) parts.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }
  return parts.join("");
}
