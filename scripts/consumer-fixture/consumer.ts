import { SessionManager, AgentSession, type SessionInfo } from "@kleio/coder";
import {
  SessionManager as LegacySessionManager,
  type SessionInfo as LegacySessionInfo,
} from "@kenkaiiii/ggcoder";
import { getModel, getDefaultModel } from "@kleio/coder/models";
import { getModelsForProvider } from "@kenkaiiii/ggcoder/models";
import { AuthStorage, type OAuthCredentials } from "@kleio/coder/auth";
import { AuthStorage as LegacyAuthStorage } from "@kenkaiiii/ggcoder/auth";
import { KLEIO_PRODUCT_PROFILE, resolveEnvironmentAlias } from "@kleio/core";
import type { Message } from "@kleio/ai";
import * as agent from "@kleio/agent";
import * as manager from "@kleio/manager";

const firstPrompt = (session: SessionInfo): string | undefined => session.firstPrompt;
const legacyPrompt = (session: LegacySessionInfo): string | undefined => session.firstPrompt;
const displayName: "Kleio Coder" = KLEIO_PRODUCT_PROFILE.coder.displayName;
const environment: string | undefined = resolveEnvironmentAlias({}, "PREFERRED", "LEGACY");
const message: Message = { role: "user", content: "External public consumer" };
const credentials = (value: OAuthCredentials): OAuthCredentials => value;
void [
  SessionManager,
  LegacySessionManager,
  AgentSession,
  AuthStorage,
  LegacyAuthStorage,
  firstPrompt,
  legacyPrompt,
  displayName,
  environment,
  message,
  credentials,
  getModel,
  getDefaultModel,
  getModelsForProvider,
  agent,
  manager,
];
