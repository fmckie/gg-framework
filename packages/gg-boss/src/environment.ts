import { resolveEnvironmentAlias } from "@kleio/core";

export const MANAGER_TELEGRAM_ENVIRONMENT = {
  botToken: {
    preferred: "KLEIO_MANAGER_TELEGRAM_BOT_TOKEN",
    legacy: "GG_BOSS_TELEGRAM_BOT_TOKEN",
  },
  userId: {
    preferred: "KLEIO_MANAGER_TELEGRAM_USER_ID",
    legacy: "GG_BOSS_TELEGRAM_USER_ID",
  },
} as const;

export interface ManagerTelegramEnvironment {
  botToken?: string;
  userId?: string;
}

export function resolveManagerTelegramEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ManagerTelegramEnvironment {
  const botToken = resolveEnvironmentAlias(
    environment,
    MANAGER_TELEGRAM_ENVIRONMENT.botToken.preferred,
    MANAGER_TELEGRAM_ENVIRONMENT.botToken.legacy,
  );
  const userId = resolveEnvironmentAlias(
    environment,
    MANAGER_TELEGRAM_ENVIRONMENT.userId.preferred,
    MANAGER_TELEGRAM_ENVIRONMENT.userId.legacy,
  );
  return {
    ...(botToken !== undefined ? { botToken } : {}),
    ...(userId !== undefined ? { userId } : {}),
  };
}
