import fs from "node:fs/promises";
import path from "node:path";
import { getAppPaths } from "@kleio/coder";

export interface LinkedProject {
  name: string;
  cwd: string;
}

export interface LinksFile {
  projects: LinkedProject[];
}

export function getLinksPath(): string {
  return path.join(getAppPaths().agentDir, "boss", "links.json");
}

export async function loadLinks(): Promise<LinksFile> {
  try {
    const content = await fs.readFile(getLinksPath(), "utf-8");
    const parsed = JSON.parse(content) as Partial<LinksFile>;
    return { projects: parsed.projects ?? [] };
  } catch {
    return { projects: [] };
  }
}

export async function saveLinks(links: LinksFile): Promise<void> {
  const p = getLinksPath();
  await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  await fs.writeFile(p, JSON.stringify(links, null, 2), "utf-8");
}
