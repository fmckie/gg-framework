import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginGemini, refreshGeminiToken } from "./gemini.js";

const PREFERRED_CLIENT_ID_ENV = "KLEIO_CODER_GEMINI_OAUTH_CLIENT_ID";
const LEGACY_CLIENT_ID_ENV = "GGCODER_GEMINI_OAUTH_CLIENT_ID";
const PREFERRED_CLIENT_SECRET_ENV = "KLEIO_CODER_GEMINI_OAUTH_CLIENT_SECRET";
const LEGACY_CLIENT_SECRET_ENV = "GGCODER_GEMINI_OAUTH_CLIENT_SECRET";

const originalFetch = globalThis.fetch;
const originalCodeAssistEndpoint = process.env.CODE_ASSIST_ENDPOINT;
const originalCodeAssistApiVersion = process.env.CODE_ASSIST_API_VERSION;
const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
const originalGoogleCloudProjectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const originalPreferredGeminiClientId = process.env[PREFERRED_CLIENT_ID_ENV];
const originalLegacyGeminiClientId = process.env.GGCODER_GEMINI_OAUTH_CLIENT_ID;
const originalPreferredGeminiClientSecret = process.env[PREFERRED_CLIENT_SECRET_ENV];
const originalLegacyGeminiClientSecret = process.env.GGCODER_GEMINI_OAUTH_CLIENT_SECRET;

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3_600,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function completeLoopbackLogin(authUrl: string): void {
  const loginUrl = new URL(authUrl);
  if (loginUrl.hostname !== "accounts.google.com") return;
  const redirectUri = loginUrl.searchParams.get("redirect_uri");
  const state = loginUrl.searchParams.get("state");
  if (!redirectUri || !state) return;
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", "oauth-code");
  callbackUrl.searchParams.set("state", state);

  const req = http.get(callbackUrl, (res) => {
    res.resume();
  });
  req.on("error", () => undefined);
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function getRefreshRequestBody(): Promise<URLSearchParams> {
  const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse());
  globalThis.fetch = fetchMock;

  await refreshGeminiToken("refresh-token");

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(init.body).toBeInstanceOf(URLSearchParams);
  return init.body as URLSearchParams;
}

describe("Gemini OAuth", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    delete process.env[PREFERRED_CLIENT_ID_ENV];
    delete process.env[LEGACY_CLIENT_ID_ENV];
    delete process.env[PREFERRED_CLIENT_SECRET_ENV];
    delete process.env[LEGACY_CLIENT_SECRET_ENV];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCodeAssistEndpoint === undefined) {
      delete process.env.CODE_ASSIST_ENDPOINT;
    } else {
      process.env.CODE_ASSIST_ENDPOINT = originalCodeAssistEndpoint;
    }
    if (originalCodeAssistApiVersion === undefined) {
      delete process.env.CODE_ASSIST_API_VERSION;
    } else {
      process.env.CODE_ASSIST_API_VERSION = originalCodeAssistApiVersion;
    }
    if (originalGoogleCloudProject === undefined) {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    } else {
      process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
    }
    if (originalGoogleCloudProjectId === undefined) {
      delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    } else {
      process.env.GOOGLE_CLOUD_PROJECT_ID = originalGoogleCloudProjectId;
    }
    restoreEnvironmentVariable(PREFERRED_CLIENT_ID_ENV, originalPreferredGeminiClientId);
    restoreEnvironmentVariable(LEGACY_CLIENT_ID_ENV, originalLegacyGeminiClientId);
    restoreEnvironmentVariable(PREFERRED_CLIENT_SECRET_ENV, originalPreferredGeminiClientSecret);
    restoreEnvironmentVariable(LEGACY_CLIENT_SECRET_ENV, originalLegacyGeminiClientSecret);
    vi.restoreAllMocks();
  });

  it("prefers Kleio OAuth client variables over legacy aliases", async () => {
    process.env[PREFERRED_CLIENT_ID_ENV] = "preferred-client-id";
    process.env[PREFERRED_CLIENT_SECRET_ENV] = "preferred-client-secret";
    process.env[LEGACY_CLIENT_ID_ENV] = "legacy-client-id";
    process.env[LEGACY_CLIENT_SECRET_ENV] = "legacy-client-secret";

    const body = await getRefreshRequestBody();

    expect(body.get("client_id")).toBe("preferred-client-id");
    expect(body.get("client_secret")).toBe("preferred-client-secret");
  });

  it("supports legacy-only OAuth client variables", async () => {
    process.env[LEGACY_CLIENT_ID_ENV] = "legacy-client-id";
    process.env[LEGACY_CLIENT_SECRET_ENV] = "legacy-client-secret";

    const body = await getRefreshRequestBody();

    expect(body.get("client_id")).toBe("legacy-client-id");
    expect(body.get("client_secret")).toBe("legacy-client-secret");
  });

  it("treats empty preferred OAuth client variables as set", async () => {
    process.env[PREFERRED_CLIENT_ID_ENV] = "";
    process.env[PREFERRED_CLIENT_SECRET_ENV] = "";
    process.env[LEGACY_CLIENT_ID_ENV] = "legacy-client-id";
    process.env[LEGACY_CLIENT_SECRET_ENV] = "legacy-client-secret";

    const body = await getRefreshRequestBody();

    expect(body.get("client_id")).not.toBe("legacy-client-id");
    expect(body.get("client_id")).not.toBe("");
    expect(body.get("client_secret")).not.toBe("legacy-client-secret");
    expect(body.get("client_secret")).not.toBe("");
  });

  it("opens validation URLs and retries Code Assist setup", async () => {
    process.env.CODE_ASSIST_ENDPOINT = "https://code-assist.example.test";
    process.env.CODE_ASSIST_API_VERSION = "v2test";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ineligibleTiers: [
              {
                reasonCode: "VALIDATION_REQUIRED",
                reasonMessage: "verify account",
                validationUrl: "https://validation.example.test",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            currentTier: { id: "standard-tier" },
            cloudaicompanionProject: "validated-project",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    globalThis.fetch = fetchMock;
    const openedUrls: string[] = [];

    const creds = await loginGemini({
      onOpenUrl: (url) => {
        openedUrls.push(url);
        completeLoopbackLogin(url);
      },
      onPromptCode: async (message) => {
        if (message.includes("validation")) return "";
        throw new Error(`Unexpected Gemini prompt: ${message}`);
      },
      onStatus: vi.fn(),
    });

    expect(creds.projectId).toBe("validated-project");
    expect(openedUrls).toContain("https://validation.example.test");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://code-assist.example.test/v2test:loadCodeAssist",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://code-assist.example.test/v2test:loadCodeAssist",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses free-tier onboarding metadata without a project", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            allowedTiers: [{ id: "free-tier", isDefault: true }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            done: true,
            response: { cloudaicompanionProject: { id: "managed-project" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    globalThis.fetch = fetchMock;
    const openedUrls: string[] = [];

    const creds = await loginGemini({
      onOpenUrl: (url) => {
        openedUrls.push(url);
        completeLoopbackLogin(url);
      },
      onPromptCode: async (message) => {
        throw new Error(`Unexpected Gemini prompt: ${message}`);
      },
      onStatus: vi.fn(),
    });

    expect(creds.projectId).toBe("managed-project");
    const [, onboardInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(onboardInit.body as string)).toEqual({
      tierId: "free-tier",
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    });
  });
});
