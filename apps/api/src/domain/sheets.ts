import type { Env } from "../env";
import { toBase64Url } from "./token";
import {
  dataRowRange,
  headerRow,
  layoutRange,
  metadataCellRange,
  metadataRow,
  quoteSheetTab,
} from "./sheet-projection";

/**
 * Google Sheets client for Workers (ADR-005).
 *
 * - Auth uses a service-account JWT signed with `crypto.subtle` (RS256) and
 *   exchanged for an access token. No Node library, no private key in the SPA.
 * - The access token is cached per isolate until ~5 minutes before expiry.
 * - Every remote call is behind `SheetsGateway`, so tests use a fake and never
 *   touch the network (AGENTS.md).
 *
 * Error objects carry only a status and a Google reason code; messages returned
 * to users/logs never include spreadsheet contents or participant data.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_SAFETY_MS = 5 * 60_000;

export class SheetsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetsConfigError";
  }
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface GoogleCredentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export interface SheetTarget {
  spreadsheetId: string;
  sheetTab: string;
}

export interface SheetWriteRow {
  rowIndex: number;
  values: string[];
}

export interface SheetsGateway {
  /** Verifies the spreadsheet/tab and proves write access with one metadata cell. */
  test(target: SheetTarget, marker: string): Promise<{ spreadsheetTitle: string }>;
  /** Writes row 1 metadata and row 2 header; idempotent. */
  ensureLayout(target: SheetTarget, eventId: string): Promise<void>;
  /** Upserts deterministic rows; at most 500 per call. */
  writeRows(target: SheetTarget, rows: SheetWriteRow[]): Promise<void>;
}

export function parseGoogleCredentials(env: Env): GoogleCredentials | null {
  const raw = (env.GOOGLE_SA_KEY ?? "").trim();
  if (raw === "") return null;

  let clientEmail = (env.GOOGLE_SA_EMAIL ?? "").trim();
  let privateKey = raw;
  let tokenUri = TOKEN_URL;

  if (raw.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SheetsConfigError("GOOGLE_SA_KEY bukan JSON yang valid");
    }

    const value = parsed as {
      client_email?: unknown;
      private_key?: unknown;
      token_uri?: unknown;
    };

    if (typeof value.client_email === "string") clientEmail = value.client_email.trim();
    if (typeof value.private_key === "string") privateKey = value.private_key;
    if (typeof value.token_uri === "string" && value.token_uri.trim() !== "") {
      tokenUri = value.token_uri.trim();
    }
  }

  // Secrets are often stored with literal `\n` sequences.
  privateKey = privateKey.replace(/\\n/g, "\n").trim();

  if (clientEmail === "" || !clientEmail.includes("@")) {
    throw new SheetsConfigError("Email service account Google belum diatur");
  }

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new SheetsConfigError("Private key service account Google tidak valid");
  }

  return { clientEmail, privateKey, tokenUri };
}

export function serviceAccountEmail(env: Env): string | null {
  try {
    return parseGoogleCredentials(env)?.clientEmail ?? null;
  } catch {
    return null;
  }
}

function base64UrlJson(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export async function buildServiceAccountJwt(
  credentials: GoogleCredentials,
  nowSeconds: number,
): Promise<string> {
  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: credentials.clientEmail,
    scope: SCOPE,
    aud: credentials.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(credentials.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;

async function accessToken(
  credentials: GoogleCredentials,
  now: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (
    cachedToken &&
    cachedToken.email === credentials.clientEmail &&
    cachedToken.expiresAt - TOKEN_SAFETY_MS > now
  ) {
    return cachedToken.token;
  }

  const assertion = await buildServiceAccountJwt(credentials, Math.floor(now / 1000));
  const response = await fetchImpl(credentials.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const body = (await safeJson(response)) as {
      error?: string | { message?: string };
    } | null;
    const reason =
      typeof body?.error === "string"
        ? body.error
        : typeof body?.error === "object" && body.error !== null
          ? undefined
          : undefined;

    throw new GoogleApiError(response.status, reason, "Google token exchange failed");
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!body.access_token) {
    throw new GoogleApiError(502, "invalid_token_response", "Google token response invalid");
  }

  cachedToken = {
    email: credentials.clientEmail,
    token: body.access_token,
    expiresAt: now + Math.max(60, body.expires_in ?? 3600) * 1000,
  };

  return body.access_token;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
}

function googleError(response: Response, body: unknown): GoogleApiError {
  const parsed = body as GoogleErrorBody | null;
  const reason = parsed?.error?.errors?.[0]?.reason ?? parsed?.error?.status;

  return new GoogleApiError(
    response.status,
    reason,
    "Google Sheets request failed",
  );
}

async function googleFetch<T>(
  url: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) throw googleError(response, await safeJson(response));

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class GoogleSheetsGateway implements SheetsGateway {
  constructor(
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private async token(): Promise<string> {
    const credentials = parseGoogleCredentials(this.env);
    if (!credentials) {
      throw new SheetsConfigError("GOOGLE_SA_KEY belum diatur");
    }

    return accessToken(credentials, this.clock(), this.fetchImpl);
  }

  async test(target: SheetTarget, marker: string): Promise<{ spreadsheetTitle: string }> {
    const token = await this.token();
    const spreadsheet = await googleFetch<{
      properties?: { title?: string };
      sheets?: Array<{ properties?: { title?: string } }>;
    }>(
      `${SHEETS_API}/${encodeURIComponent(target.spreadsheetId)}?fields=properties.title,sheets.properties.title`,
      token,
      { method: "GET" },
      this.fetchImpl,
    );

    const tabs = (spreadsheet.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => typeof title === "string");

    if (!tabs.includes(target.sheetTab)) {
      throw new GoogleApiError(404, "tab_not_found", "Sheet tab not found");
    }

    await googleFetch(
      `${SHEETS_API}/${encodeURIComponent(target.spreadsheetId)}/values/${encodeURIComponent(
        metadataCellRange(target.sheetTab),
      )}?valueInputOption=RAW`,
      token,
      { method: "PUT", body: JSON.stringify({ values: [[marker]] }) },
      this.fetchImpl,
    );

    return { spreadsheetTitle: spreadsheet.properties?.title ?? "" };
  }

  async ensureLayout(target: SheetTarget, eventId: string): Promise<void> {
    const token = await this.token();

    await googleFetch(
      `${SHEETS_API}/${encodeURIComponent(target.spreadsheetId)}/values/${encodeURIComponent(
        layoutRange(target.sheetTab),
      )}?valueInputOption=RAW`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({ values: [metadataRow(eventId), headerRow()] }),
      },
      this.fetchImpl,
    );
  }

  async writeRows(target: SheetTarget, rows: SheetWriteRow[]): Promise<void> {
    if (rows.length === 0) return;
    if (rows.length > 500) {
      throw new Error("Sheet write exceeds the 500-row chunk limit");
    }

    const token = await this.token();

    await googleFetch(
      `${SHEETS_API}/${encodeURIComponent(target.spreadsheetId)}/values:batchUpdate`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: rows.map((row) => ({
            range: dataRowRange(target.sheetTab, row.rowIndex),
            values: [row.values],
          })),
        }),
      },
      this.fetchImpl,
    );
  }
}

/** Exposed so sync status can show the tab the worker will write to. */
export function quotedTab(tab: string): string {
  return quoteSheetTab(tab);
}
