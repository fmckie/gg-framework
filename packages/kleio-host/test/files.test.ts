import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contentDisposition,
  fileContentType,
  MAX_FILE_BYTES,
  resolveAgentFile,
  resolveWorkspaceDir,
} from "../src/files.js";

let dir: string;
let root: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kleio-files-"));
  root = join(dir, "blobs", "b_0123abcd");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(dir, "secret.txt"), "outside");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const kind = async (raw: string, r = root, max?: number): Promise<string> => {
  const res = await resolveAgentFile(r, raw, max);
  return res.ok ? "ok" : res.error.kind;
};

describe("resolveAgentFile", () => {
  it("resolves a file in the folder", async () => {
    writeFileSync(join(root, "report.pdf"), "%PDF-1.7");
    const r = await resolveAgentFile(root, "report.pdf");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("report.pdf");
    expect(r.value.size).toBe(8);
    expect(r.value.path).toBe(join(realpathSync.native(root), "report.pdf"));
    expect(r.value.mtimeMs).toBeGreaterThan(0);
    expect(MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("resolves a nested file", async () => {
    mkdirSync(join(root, "reports", "2026"), { recursive: true });
    writeFileSync(join(root, "reports", "2026", "q3.md"), "# Q3");
    const r = await resolveAgentFile(root, "reports/2026/q3.md");
    expect(r.ok && r.value.name).toBe("q3.md");
    expect(r.ok && r.value.path).toBe(join(realpathSync.native(root), "reports", "2026", "q3.md"));
  });

  it("decodes each segment: spaces and unicode", async () => {
    const name = "Morning Report – café ☕ (draft).pdf";
    writeFileSync(join(root, name), "x");
    const r = await resolveAgentFile(root, encodeURIComponent(name));
    expect(r.ok && r.value.name).toBe(name);
    expect(r.ok && r.value.size).toBe(1);
  });

  it("refuses traversal, hidden names, smuggled separators and bad escapes", async () => {
    mkdirSync(join(root, ".venv"));
    writeFileSync(join(root, ".venv", "x"), "hidden");
    writeFileSync(join(root, ".env"), "TOKEN=1");
    writeFileSync(join(root, "a"), "a");
    for (const raw of [
      "..",
      "../secret.txt",
      "a/../../secret.txt",
      ".",
      "./a",
      "%2e%2e",
      "%2E%2e/secret.txt",
      "%2e",
      ".venv/x",
      ".env",
      "%2eenv",
      "a%2F..%2F..%2Fsecret.txt",
      "..%2Fsecret.txt",
      "..%5Csecret.txt",
      "a%5Cb",
      "%E0%A4%A",
      "%",
      "a%00",
      "a%0A",
      "a%7F",
      "",
      "a/",
      "/a",
      "a//b",
      Array(17).fill("d").join("/"),
      "a".repeat(1025),
    ])
      expect(await kind(raw), raw).toBe("bad_path");
  });

  it("allows up to 16 segments and 1024 encoded characters", async () => {
    expect(await kind(Array(16).fill("d").join("/"))).toBe("not_found");
    expect(await kind("a".repeat(1024))).not.toBe("bad_path");
  });

  it.skipIf(process.platform === "win32")("never follows a symlink out of the folder", async () => {
    symlinkSync(join(dir, "secret.txt"), join(root, "link.txt"));
    symlinkSync(dir, join(root, "up"));
    mkdirSync(join(dir, "blobs", "b_0123abce"));
    writeFileSync(join(dir, "blobs", "b_0123abce", "theirs.txt"), "sibling");
    symlinkSync(join(dir, "blobs", "b_0123abce"), join(root, "sib"));
    symlinkSync(root, join(root, "self"));
    expect(await kind("link.txt")).toBe("not_found");
    expect(await kind("up/secret.txt")).toBe("not_found");
    expect(await kind("sib/theirs.txt")).toBe("not_found");
    expect(await kind("self")).toBe("not_found");
    // A link that stays inside is fine.
    writeFileSync(join(root, "real.txt"), "inside");
    symlinkSync(join(root, "real.txt"), join(root, "alias.txt"));
    const r = await resolveAgentFile(root, "alias.txt");
    expect(r.ok && r.value.path).toBe(join(realpathSync.native(root), "real.txt"));
  });

  it("is not_found for a directory, a missing file or a missing folder", async () => {
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "a.txt"), "a");
    expect(await kind("reports")).toBe("not_found");
    expect(await kind("missing.pdf")).toBe("not_found");
    expect(await kind("a.txt/b")).toBe("not_found");
    expect(await kind("a.pdf", join(dir, "blobs", "b_ffffffff"))).toBe("not_found");
  });

  it("is too_large past maxBytes", async () => {
    writeFileSync(join(root, "big.bin"), Buffer.alloc(11));
    writeFileSync(join(root, "fits.bin"), Buffer.alloc(10));
    expect(await kind("big.bin", root, 10)).toBe("too_large");
    expect(await kind("fits.bin", root, 10)).toBe("ok");
  });
});

describe("resolveWorkspaceDir", () => {
  let projects: string;
  let extra: string;
  beforeEach(() => {
    projects = join(dir, "projects");
    extra = join(dir, "extra");
    mkdirSync(join(projects, "app", "sub"), { recursive: true });
    mkdirSync(join(projects, ".secret", "app"), { recursive: true });
    mkdirSync(join(dir, "projects-evil", "app"), { recursive: true });
    mkdirSync(join(extra, "tool"), { recursive: true });
  });
  const roots = (): string[] => [projects, extra, join(dir, "missing-root")];
  const ws = async (cwd: string): Promise<string> => {
    const r = await resolveWorkspaceDir(roots(), cwd);
    return r.ok ? "ok" : r.error.kind;
  };

  it("accepts a root itself and a project inside one", async () => {
    const real = realpathSync.native(projects);
    const self = await resolveWorkspaceDir(roots(), projects);
    expect(self.ok && self.value).toEqual({ dir: real, root: real });
    const nested = await resolveWorkspaceDir(roots(), join(projects, "app", "sub"));
    expect(nested.ok && nested.value).toEqual({ dir: join(real, "app", "sub"), root: real });
    const other = await resolveWorkspaceDir(roots(), join(extra, "tool"));
    expect(other.ok && other.value.root).toBe(realpathSync.native(extra));
    // A trailing slash or a dot segment that stays inside is the same folder.
    expect(await ws(`${join(projects, "app")}/`)).toBe("ok");
  });

  it("refuses folders outside the roots, including a sibling with the same prefix", async () => {
    expect(await ws(dir)).toBe("not_found");
    expect(await ws(join(dir, "projects-evil"))).toBe("not_found");
    expect(await ws(join(dir, "projects-evil", "app"))).toBe("not_found");
    expect(await ws(join(projects, ".."))).toBe("not_found");
    expect(await ws(join(projects, "nope"))).toBe("not_found");
    expect(await ws(tmpdir())).toBe("not_found");
    expect((await resolveWorkspaceDir([], projects)).ok).toBe(false);
  });

  it("refuses a hidden folder between the root and the cwd", async () => {
    expect(await ws(join(projects, ".secret"))).toBe("not_found");
    expect(await ws(join(projects, ".secret", "app"))).toBe("not_found");
  });

  it("refuses relative, control-character, over-long cwds and files", async () => {
    writeFileSync(join(projects, "app", "f.txt"), "x");
    for (const cwd of [
      "",
      "projects/app",
      "./app",
      `${projects}\u0000/app`,
      `${projects}/a\nb`,
      `/${"a".repeat(1024)}`,
      join(projects, "app", "f.txt"),
    ])
      expect(await ws(cwd), JSON.stringify(cwd)).toBe("not_found");
  });

  it.skipIf(process.platform === "win32")(
    "follows a symlinked cwd to where it really is",
    async () => {
      symlinkSync(dir, join(projects, "out"));
      symlinkSync(join(projects, ".secret", "app"), join(projects, "peek"));
      symlinkSync(join(projects, "app"), join(extra, "alias"));
      expect(await ws(join(projects, "out"))).toBe("not_found");
      expect(await ws(join(projects, "out", "projects-evil"))).toBe("not_found");
      expect(await ws(join(projects, "peek"))).toBe("not_found");
      const alias = await resolveWorkspaceDir(roots(), join(extra, "alias"));
      expect(alias.ok && alias.value.dir).toBe(join(realpathSync.native(projects), "app"));
    },
  );
});

describe("fileContentType", () => {
  it("maps known extensions and downloads everything else", () => {
    const table: [string, string][] = [
      ["r.pdf", "application/pdf"],
      ["R.PDF", "application/pdf"],
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.JPEG", "image/jpeg"],
      ["a.gif", "image/gif"],
      ["a.webp", "image/webp"],
      ["a.txt", "text/plain; charset=utf-8"],
      ["a.md", "text/markdown; charset=utf-8"],
      ["a.csv", "text/csv; charset=utf-8"],
      ["a.json", "application/json"],
      ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["a.html", "application/octet-stream"],
      ["a.htm", "application/octet-stream"],
      ["a.svg", "application/octet-stream"],
      ["a.js", "application/octet-stream"],
      ["a.pdf.html", "application/octet-stream"],
      ["noext", "application/octet-stream"],
      ["a.constructor", "application/octet-stream"],
    ];
    for (const [name, type] of table) expect(fileContentType(name), name).toBe(type);
  });

  it("builds an RFC 5987 attachment disposition", () => {
    expect(contentDisposition("Morning-AI-Research-2026-10-01.pdf")).toBe(
      "attachment; filename*=UTF-8''Morning-AI-Research-2026-10-01.pdf",
    );
    expect(contentDisposition("a b'(c)*.pdf")).toBe(
      "attachment; filename*=UTF-8''a%20b%27%28c%29%2A.pdf",
    );
  });
});
