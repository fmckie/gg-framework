import { describe, expect, it } from "vitest";
import { checkedPublicUrl } from "../src/public-url.js";

describe("KLEIO_PUBLIC_URL (checkedPublicUrl)", () => {
  it.each<[string, string]>([
    ["https://mini.tailnet.ts.net:8443", "https://mini.tailnet.ts.net:8443"],
    ["https://mini.tailnet.ts.net:8443/", "https://mini.tailnet.ts.net:8443"],
    ["https://kleio.example.com", "https://kleio.example.com"],
    ["https://kleio.home.arpa:443/", "https://kleio.home.arpa:443"],
    // The dev host (gg-app/scripts/dev-host.mjs), which the app's debug builds take.
    ["http://127.0.0.1:52714", "http://127.0.0.1:52714"],
    ["http://127.0.0.1:52714/", "http://127.0.0.1:52714"],
  ])("takes %s, as the app pairs with it", (raw, base) => {
    expect(checkedPublicUrl(raw)).toBe(base);
  });

  it("is nothing when unset or empty: a host reached over the link only", () => {
    expect(checkedPublicUrl(undefined)).toBeUndefined();
    expect(checkedPublicUrl("")).toBeUndefined();
  });

  it.each<[string, string]>([
    ["http://mini.tailnet.ts.net:8443", "must be an https address"],
    ["http://localhost:52714", "must be an https address"],
    ["http://127.0.0.1:0", "must be an https address"],
    ["http://127.0.0.1:70000", "must be an https address"],
    ["ftp://mini.example.com", "must be an https address"],
    ["mini.example.com:8443", "must be an https address"],
    ["not a url", "must be an https address"],
    ["https://user:pass@mini.example.com", "can't hold a username or password"],
    ["https://mini.example.com/kleio", "is just the host's address and port"],
    ["https://mini.example.com:8443/kleio/", "is just the host's address and port"],
    ["https://mini.example.com?x=1", "is just the host's address and port"],
    ["https://mini.example.com#x", "is just the host's address and port"],
  ])("refuses %s, saying it %s, so the host doesn't start", (raw, why) => {
    expect(() => checkedPublicUrl(raw)).toThrow(
      `KLEIO_PUBLIC_URL ${why}, such as https://mini.your-tailnet.ts.net:8443, not ${JSON.stringify(raw)}`,
    );
  });
});
