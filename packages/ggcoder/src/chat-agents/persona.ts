import { createHash } from "node:crypto";
import type { AgentSession } from "../core/agent-session.js";
import { GENERAL_CHAT_AGENT_ID } from "./general.js";
import { createChatAgentSession, type ChatAgentOptions } from "./shared.js";

/**
 * A host-supplied helper persona for a chat session. Never persisted by the
 * engine: the host re-sends it on every create/resume.
 */
export interface ChatPersona {
  name: string;
  instructions: string;
}

export const PERSONA_NAME_MAX = 40;
export const PERSONA_INSTRUCTIONS_MAX = 8000;

/** Short form of General's conversational rules, shared by every persona. */
const PERSONA_CONVERSATIONAL_RULES = `Match the user's tone and requested depth. You may use the available tools when they materially improve the answer; the configured workspace root is your file-access boundary. Ask before any destructive or irreversible action. Do not claim persistent memory unless the provided context actually contains it. Lead with the answer, then add only the detail that helps.`;

/**
 * Validate an untrusted `persona` value. Returns the trimmed persona, or an
 * error string describing why it was rejected.
 */
export function parseChatPersona(value: unknown): ChatPersona | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "persona must be an object" };
  }
  const { name, instructions } = value as { name?: unknown; instructions?: unknown };
  if (typeof name !== "string" || typeof instructions !== "string") {
    return { error: "persona.name and persona.instructions must be strings" };
  }
  const trimmedName = name.trim();
  const trimmedInstructions = instructions.trim();
  if (trimmedName.length < 1 || trimmedName.length > PERSONA_NAME_MAX) {
    return { error: `persona.name must be 1–${PERSONA_NAME_MAX} characters` };
  }
  if (trimmedInstructions.length < 1 || trimmedInstructions.length > PERSONA_INSTRUCTIONS_MAX) {
    return { error: `persona.instructions must be 1–${PERSONA_INSTRUCTIONS_MAX} characters` };
  }
  return { name: trimmedName, instructions: trimmedInstructions };
}

export function buildPersonaRolePrompt(persona: ChatPersona): string {
  return `You are ${persona.name}, one of the user's helpers in Kleio.\n\n${persona.instructions}\n\n${PERSONA_CONVERSATIONAL_RULES}`;
}

/** Cache prefix keyed by the stable role prompt, so each persona gets its own cache slot. */
export function personaPromptCacheKeyPrefix(rolePrompt: string): string {
  return `ggchat:persona:${createHash("sha256").update(rolePrompt).digest("hex").slice(0, 12)}`;
}

/**
 * A persona chat session: the persona's role prompt on General's transcript
 * namespace (so `sessionPath` resume works unchanged), keeping memory + Jiwa
 * curation but never the agent-handoff tool.
 */
export function createPersonaChatAgent(
  persona: ChatPersona,
  options: ChatAgentOptions,
): AgentSession {
  const rolePrompt = buildPersonaRolePrompt(persona);
  return createChatAgentSession(
    GENERAL_CHAT_AGENT_ID,
    rolePrompt,
    {
      ...options,
      additionalTools: (options.additionalTools ?? []).filter(
        (tool) => tool.name !== "delegate_to_agent",
      ),
    },
    { promptCacheKeyPrefix: personaPromptCacheKeyPrefix(rolePrompt) },
  );
}
