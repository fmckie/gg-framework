// An app connection's state, from Composio's status word. Its own file so the
// desktop's Overview can count apps without loading the Apps page.

export type ConnectionState = "connected" | "pending" | "expired" | "failed" | "other";

export function connectionState(status: string): ConnectionState {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "connected";
    case "INITIATED":
    case "INITIALIZING":
      return "pending";
    case "EXPIRED":
      return "expired";
    case "FAILED":
      return "failed";
    default:
      return "other";
  }
}
