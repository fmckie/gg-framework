import { describe, expect, it } from "vitest";
import { tapDestination, type ChatTarget, type TapLookups } from "./notification-tap";

const chat: ChatTarget = {
  cwd: "/Users/me/kleio-projects",
  sessionPath: "/Users/me/.gg/sessions/a.jsonl",
  mode: "chat",
  chatAgent: "general",
};

function lookups(over: Partial<TapLookups> = {}): TapLookups {
  return {
    groupExists: async () => true,
    agentWithSession: async () => null,
    chatForSession: async () => null,
    ...over,
  };
}

describe("tapDestination", () => {
  it("opens a group chat when the notification is about a group", async () => {
    const where = await tapDestination({ sessionId: null, groupId: "g_1" }, lookups());

    expect(where).toEqual({ kind: "group", groupId: "g_1" });
  });

  it("just opens the app when the group was deleted", async () => {
    const where = await tapDestination(
      { sessionId: null, groupId: "g_gone" },
      lookups({ groupExists: async (id) => id !== "g_gone" }),
    );

    expect(where).toEqual({ kind: "none" });
  });

  it("still opens the group when the group list cannot be loaded", async () => {
    const where = await tapDestination(
      { sessionId: null, groupId: "g_1" },
      lookups({
        groupExists: async () => {
          throw new Error("offline");
        },
      }),
    );

    expect(where).toEqual({ kind: "group", groupId: "g_1" });
  });

  it("opens the agent whose session finished, as the Agents page shows it", async () => {
    const where = await tapDestination(
      { sessionId: "s1", groupId: null },
      lookups({ agentWithSession: async (id) => (id === "s1" ? "b_7" : null) }),
    );

    expect(where).toEqual({ kind: "agent", agentId: "b_7" });
  });

  it("reopens a chat or project whose reply finished", async () => {
    const where = await tapDestination(
      { sessionId: "s2", groupId: null },
      lookups({ chatForSession: async (id) => (id === "s2" ? chat : null) }),
    );

    expect(where).toEqual({ kind: "chat", chat });
  });

  it("prefers the agent: its chat lives on the Agents page", async () => {
    const where = await tapDestination(
      { sessionId: "s3", groupId: null },
      lookups({ agentWithSession: async () => "b_1", chatForSession: async () => chat }),
    );

    expect(where).toEqual({ kind: "agent", agentId: "b_1" });
  });

  it("just opens the app when nothing can be found any more", async () => {
    const where = await tapDestination({ sessionId: "gone", groupId: null }, lookups());

    expect(where).toEqual({ kind: "none" });
  });

  it("still opens the chat when the agent list cannot be loaded", async () => {
    const where = await tapDestination(
      { sessionId: "s4", groupId: null },
      lookups({
        agentWithSession: async () => {
          throw new Error("offline");
        },
        chatForSession: async () => chat,
      }),
    );

    expect(where).toEqual({ kind: "chat", chat });
  });
});
