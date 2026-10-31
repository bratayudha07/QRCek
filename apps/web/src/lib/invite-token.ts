/**
 * Reads the invite token from the URL fragment.
 *
 * The invite link is `/aktivasi#t=<token>`. The fragment is used on purpose: a
 * fragment is never sent to the server, so the token stays out of access logs,
 * proxy logs, and `Referer` headers. It also never reaches the Worker as a
 * query parameter that could be cached.
 *
 * Pure and defensive: an empty or malformed fragment yields `null`, and the
 * page shows "token tidak ditemukan" instead of posting an empty token.
 */
export function readInviteToken(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment === "") return null;

  const token = new URLSearchParams(fragment).get("t")?.trim() ?? "";

  // Same bounds as the zod schema on the Worker (16..512).
  if (token.length < 16 || token.length > 512) return null;

  return token;
}
