import { resolveEnvironmentAlias } from "@kleio/core";

export const CODER_TELEGRAM_ENVIRONMENT = {
  botToken: {
    preferred: "KLEIO_CODER_TELEGRAM_BOT_TOKEN",
    legacy: "GG_TELEGRAM_BOT_TOKEN",
  },
  userId: {
    preferred: "KLEIO_CODER_TELEGRAM_USER_ID",
    legacy: "GG_TELEGRAM_USER_ID",
  },
} as const;

export interface CoderTelegramEnvironment {
  botToken?: string;
  userId?: string;
}

export function resolveCoderTelegramEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CoderTelegramEnvironment {
  const botToken = resolveEnvironmentAlias(
    environment,
    CODER_TELEGRAM_ENVIRONMENT.botToken.preferred,
    CODER_TELEGRAM_ENVIRONMENT.botToken.legacy,
  );
  const userId = resolveEnvironmentAlias(
    environment,
    CODER_TELEGRAM_ENVIRONMENT.userId.preferred,
    CODER_TELEGRAM_ENVIRONMENT.userId.legacy,
  );
  return {
    ...(botToken !== undefined ? { botToken } : {}),
    ...(userId !== undefined ? { userId } : {}),
  };
}
