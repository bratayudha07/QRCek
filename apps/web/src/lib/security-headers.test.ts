import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SECURITY_HEADERS } from "@absensi/shared";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for the two delivery paths.
 *
 * The API applies `SECURITY_HEADERS` in code, but static assets are served by
 * Cloudflare before the Worker runs and only read `public/_headers`. Keeping a
 * hand-written copy is unavoidable; letting it rot is not.
 */

const HEADERS_FILE = fileURLToPath(new URL("../../public/_headers", import.meta.url));

/** Parses the first `/*` block, the only one this project uses. */
function parseHeadersFile(source: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let inBlock = false;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      inBlock = line.trim() === "/*";
      continue;
    }

    if (!inBlock) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }

  return headers;
}

describe("public/_headers", () => {
  const staticHeaders = parseHeadersFile(readFileSync(HEADERS_FILE, "utf8"));

  it("applies every header the Worker applies", () => {
    expect(staticHeaders).toEqual({ ...SECURITY_HEADERS });
  });

  it("keeps the camera available to the scanner on this origin", () => {
    expect(staticHeaders["permissions-policy"]).toContain("camera=(self)");
  });

  it("allows only same-origin scripts", () => {
    const csp = staticHeaders["content-security-policy"] ?? "";

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});
