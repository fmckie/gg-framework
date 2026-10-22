/**
 * The Brain stores' expected refusals, as their own classes so a caller can
 * tell them apart without reading the words: the Brain window's routes answer
 * 404 for a missing entry and 409 for a full store. The messages stay the
 * stores' own, so the chat tools' results read as before.
 */

/** The entry to update isn't in the store (deleted, or a stale id). */
export class BrainEntryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainEntryNotFoundError";
  }
}

/**
 * The store is at its hard limit and the new entry would be dropped at once:
 * every other entry is protected (Identity), or all of them matter more.
 */
export class BrainFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainFullError";
  }
}
