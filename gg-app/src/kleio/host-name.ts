/**
 * The Kleio host as people know it: "mac-mini-1.taila6c237.ts.net" becomes
 * "mac-mini-1". An IP address stays whole, since its first part means nothing
 * on its own.
 */
export function shortHost(host: string): string {
  const name = host.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name) || name.includes(":")) return name;
  return name.split(".")[0] || name;
}
