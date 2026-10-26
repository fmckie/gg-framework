// The KLEIO_PUBLIC_URL check (cli.ts's `publicBase`), on its own so tests can
// import it: cli.ts runs its command when imported.

/**
 * KLEIO_PUBLIC_URL as the app will pair with it (`typed_base_in` in
 * gg-app/src-tauri/src/kleio/commands.rs), without its trailing slash, or why
 * not: https with a host and an optional port, and nothing else. Or exactly
 * `http://127.0.0.1:<port>`, a host on this Mac, which only the app's debug
 * builds pair with (gg-app/scripts/dev-host.mjs). Unset or empty is undefined:
 * a host reached over the link only.
 */
export function checkedPublicUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  const base = raw.replace(/\/$/, "");
  if (/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(base) && Number(base.split(":")[2]) <= 65535) {
    return base;
  }
  const refuse = (why: string): never => {
    throw new Error(
      `KLEIO_PUBLIC_URL ${why}, such as https://mini.your-tailnet.ts.net:8443, not ${JSON.stringify(raw)}`,
    );
  };
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return refuse("must be an https address");
  }
  if (url.protocol !== "https:") return refuse("must be an https address");
  if (url.username !== "" || url.password !== "")
    return refuse("can't hold a username or password");
  if (!/^https:\/\/[^/?#]+$/.test(base)) return refuse("is just the host's address and port");
  if (url.hostname === "") return refuse("must name a host");
  return base;
}
