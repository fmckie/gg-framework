// Run: pnpm --filter gg-app exec node scripts/share-desktop-css.mjs [--check]
// Shares the desktop's rules with the iPhone. Every rule scoped
// `html:not(.platform-ios)` is rescoped `html:root` (the same weight, 0,1,1, so
// the desktop's cascade does not move), except what needs a pointer: a selector
// with `:hover` keeps the old scope, because a tap leaves iOS's hover stuck on.
// A list that mixes hover with a state is split, so the state is shared.
// Safe to re-run (after a merge brings new desktop-only rules). --check changes
// nothing and exits 1 if a rule would change.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
export const SHEETS = [
  "src/kleio/kleio-theme.css",
  "src/kleio/kleio-settings.css",
  "src/kleio/kleio-chrome.css",
  "src/olympus/olympus-lane.css",
];
export const DESKTOP = "html:not(.platform-ios)";
export const SHARED = "html:root";

// Index after the comment or string that starts at `i`, or `i` if neither does.
function skipOpaque(css, i) {
  if (css.startsWith("/*", i)) {
    const end = css.indexOf("*/", i + 2);
    return end < 0 ? css.length : end + 2;
  }
  const quote = css[i];
  if (quote !== '"' && quote !== "'") return i;
  let j = i + 1;
  while (j < css.length && css[j] !== quote) j += css[j] === "\\" ? 2 : 1;
  return j + 1;
}

// Split on `separator` outside brackets, strings and comments.
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length;) {
    const next = skipOpaque(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const char = text[i];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
    i += 1;
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim().replace(/\s+/g, " "));
}

// Index of the bracket that closes the one opened at `open`.
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length;) {
    const next = skipOpaque(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (text[i] === "(" || text[i] === "[") depth += 1;
    else if (text[i] === ")" || text[i] === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error(`Unclosed bracket in: ${text}`);
}

// A selector's weight as [ids, classes, types]. Enough of Selectors 4 for these
// sheets: :is/:not/:has take their heaviest argument, :where weighs nothing.
export function weight(selector) {
  const total = [0, 0, 0];
  const add = (other) => other.forEach((value, index) => (total[index] += value));
  for (let i = 0; i < selector.length;) {
    const char = selector[i];
    if (char === "[") {
      total[1] += 1;
      i = closing(selector, i) + 1;
    } else if (char === "#" || char === ".") {
      total[char === "#" ? 0 : 1] += 1;
      i += 1 + /^[\w-]*/.exec(selector.slice(i + 1))[0].length;
    } else if (char === ":") {
      const element = selector[i + 1] === ":";
      const name = /^[\w-]*/.exec(selector.slice(i + (element ? 2 : 1)))[0];
      i += name.length + (element ? 2 : 1);
      const args = selector[i] === "(" ? selector.slice(i + 1, closing(selector, i)) : null;
      if (args !== null) i += args.length + 2;
      if (element) total[2] += 1;
      else if (name === "where") continue;
      else if (name === "is" || name === "not" || name === "has") {
        add(
          splitTop(args, ",")
            .map(weight)
            .reduce((a, b) => (a.join() >= b.join() ? a : b)),
        );
      } else total[1] += 1;
    } else if (/[a-zA-Z]/.test(char)) {
      total[2] += 1;
      i += /^[\w-]*/.exec(selector.slice(i))[0].length;
    } else i += 1;
  }
  return total.map((value) => String(value).padStart(3, "0"));
}

const simpleArm = /^[:.[#][^\s>+~]*$/;

// One desktop-only selector → { shared, desktop }: what the phone gets too and
// what stays behind. Either may be absent.
export function shareSelector(selector, warn = () => {}) {
  if (!selector.startsWith(DESKTOP)) return { desktop: selector };
  const tail = selector.slice(DESKTOP.length);
  if (!tail.includes(":hover")) return { shared: SHARED + tail };
  // A hover inside :is()/:where(), beside arms that are not hover: split the arms.
  for (const match of tail.matchAll(/:(is|where)\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closing(tail, open);
    const arms = splitTop(tail.slice(open + 1, close), ",");
    const hover = arms.filter((arm) => arm.includes(":hover"));
    const rest = arms.filter((arm) => !arm.includes(":hover"));
    const outside = tail.slice(0, match.index) + tail.slice(close + 1);
    if (hover.length === 0 || rest.length === 0 || outside.includes(":hover")) continue;
    if (match[1] === "is" && new Set(arms.map((arm) => weight(arm).join())).size > 1) {
      warn(`Arms of unequal weight, left desktop only: ${selector}`);
      continue;
    }
    const withArms = (list) =>
      tail.slice(0, match.index) +
      (list.length === 1 && match[1] === "is" && simpleArm.test(list[0])
        ? list[0]
        : `:${match[1]}(${list.join(", ")})`) +
      tail.slice(close + 1);
    return { shared: SHARED + withArms(rest), desktop: DESKTOP + withArms(hover) };
  }
  return { desktop: selector };
}

// Every style rule whose selector list names the desktop scope: where its
// selectors and its block sit in the sheet.
export function desktopRules(css) {
  const rules = [];
  let prelude = -1;
  for (let i = 0; i < css.length;) {
    const next = skipOpaque(css, i);
    if (next !== i) {
      // A string opens a prelude (never seen); a comment does not.
      if (prelude < 0 && !css.startsWith("/*", i)) prelude = i;
      i = next;
      continue;
    }
    const char = css[i];
    if (char === "{") {
      const text = prelude < 0 ? "" : css.slice(prelude, i);
      if (!text.startsWith("@") && text.includes(DESKTOP)) {
        if (text.includes("/*")) throw new Error(`Comment inside a selector: ${text}`);
        let end = i + 1;
        while (css[end] !== "}") {
          const after = skipOpaque(css, end);
          if (css[end] === "{") throw new Error(`Nested rule under: ${text}`);
          end = after === end ? end + 1 : after;
        }
        rules.push({ start: prelude, brace: i, end: end + 1, selectors: splitTop(text, ",") });
        i = end + 1;
        prelude = -1;
        continue;
      }
      prelude = -1;
    } else if (char === "}" || char === ";") prelude = -1;
    else if (prelude < 0 && !/\s/.test(char)) prelude = i;
    i += 1;
  }
  return rules;
}

export function shareSheet(css, warn = () => {}) {
  let out = "";
  let from = 0;
  let changed = 0;
  for (const rule of desktopRules(css)) {
    const parts = rule.selectors.map((selector) => shareSelector(selector, warn));
    const shared = parts.flatMap((part) => (part.shared ? [part.shared] : []));
    if (shared.length === 0) continue;
    const desktop = parts.flatMap((part) => (part.desktop ? [part.desktop] : []));
    const block = css.slice(rule.brace, rule.end);
    out += css.slice(from, rule.start) + `${shared.join(",\n")} ${block}`;
    if (desktop.length > 0) out += `\n${desktop.join(",\n")} ${block}`;
    from = rule.end;
    changed += 1;
  }
  return { css: out + css.slice(from), changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let pending = 0;
  for (const sheet of SHEETS) {
    const file = path.join(root, sheet);
    const before = await readFile(file, "utf8");
    const { css, changed } = shareSheet(before, (message) => console.warn(`${sheet}: ${message}`));
    pending += changed;
    console.log(
      `${sheet}: ${changed} rule${changed === 1 ? "" : "s"} ${check ? "to share" : "shared"}`,
    );
    if (check || changed === 0) continue;
    const options = await prettier.resolveConfig(file);
    await writeFile(file, await prettier.format(css, { ...options, filepath: file }));
  }
  if (check && pending > 0) process.exit(1);
}
