// Which memories Settings may quote outside Brain (the desktop's Overview and
// Kleio pages), newest first. Open Brain still shows everything.

import type { Memory } from "../agent";

/** Never quoted on a Settings page. */
const PRIVATE_CATEGORIES: readonly Memory["category"][] = ["health", "relationship"];

export function quotableMemories(memories: readonly Memory[]): Memory[] {
  return memories
    .filter((m) => !PRIVATE_CATEGORIES.includes(m.category))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}
