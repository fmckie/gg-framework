import { describe, expect, it } from "vitest";
import { getSafeToolEnv } from "./safe-env.js";

describe("getSafeToolEnv", () => {
  it("exports preferred and legacy Coder child markers", () => {
    const environment = getSafeToolEnv({ PATH: "/tools" });

    expect(environment).toMatchObject({
      PATH: "/tools",
      TERM: "dumb",
      KLEIO_CODER: "true",
      GG_CODER: "true",
    });
  });

  it("does not let inherited values override either marker", () => {
    const environment = getSafeToolEnv({
      KLEIO_CODER: "false",
      GG_CODER: "false",
      GGCODER_GEMINI_OAUTH_CLIENT_SECRET: "do-not-leak",
    });

    expect(environment.KLEIO_CODER).toBe("true");
    expect(environment.GG_CODER).toBe("true");
    expect(environment.GGCODER_GEMINI_OAUTH_CLIENT_SECRET).toBeUndefined();
  });
});
