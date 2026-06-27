// app-store-connect-token (proxy pattern)
//
// Securely proxies READ-ONLY App Store Connect API calls.
//
// The App Store Connect JWT is signed in-memory on the server, used to make a
// single allow-listed read request to Apple, and is NEVER returned to the
// browser. The client only ever receives the resulting data.
//
// Secrets (set via `supabase secrets set ...`):
//   ASC_PRIVATE_KEY     the .p8 contents (single line, literal \n line breaks)
//   ASC_ISSUER_ID       App Store Connect issuer id (account-wide)
//   ASC_KEY_ID          key id matching the private key
//   ALLOWED_ORIGINS     comma-separated allow-list for CORS (optional)
//   ASC_DEFAULT_APP_ID  fallback app id when the request omits one (optional)

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ASC_AUDIENCE = "appstoreconnect-v1";
const ASC_BASE_URL = "https://api.appstoreconnect.apple.com";
const TOKEN_TTL_SECONDS = 15 * 60;

// Allow-list of read-only resources the browser is permitted to request.
// This is the SSRF guard: only these exact paths can ever be reached.
const RESOURCES: Record<
  string,
  (appId: string, params: URLSearchParams) => string
> = {
  customerReviews: (appId, params) => {
    const limit = clampInt(params.get("limit"), 50, 1, 200);
    const sort = params.get("sort") === "createdDate"
      ? "createdDate"
      : "-createdDate";
    return `/v1/apps/${appId}/customerReviews?limit=${limit}&sort=${sort}`;
  },
  appInfo: (appId) => `/v1/apps/${appId}`,
};

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function sanitizeAppId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return /^\d{3,15}$/.test(value) ? value : null;
}

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der;
}

async function importSigningKey(p8Pem: string): Promise<CryptoKey> {
  const der = pemToDer(p8Pem);
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// Signs an ES256 App Store Connect JWT and returns ONLY the token string.
// The token is consumed immediately by the server-side fetch below.
async function createAscToken(): Promise<string> {
  const privateKey = Deno.env.get("ASC_PRIVATE_KEY");
  const issuerId = Deno.env.get("ASC_ISSUER_ID");
  const keyId = Deno.env.get("ASC_KEY_ID");

  if (!privateKey || !issuerId || !keyId) {
    throw new Error(
      "Missing ASC_PRIVATE_KEY, ASC_ISSUER_ID, or ASC_KEY_ID secrets.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    aud: ASC_AUDIENCE,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${
    base64url(JSON.stringify(payload))
  }`;

  const key = await importSigningKey(privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(signature)}`;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, origin, 405);
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const resourceName = String(body.resource ?? "customerReviews");
    const builder = RESOURCES[resourceName];
    if (!builder) {
      return jsonResponse(
        {
          error: `Unknown resource "${resourceName}". Allowed: ${
            Object.keys(RESOURCES).join(", ")
          }.`,
        },
        origin,
        400,
      );
    }

    const appId = sanitizeAppId(body.appId ?? Deno.env.get("ASC_DEFAULT_APP_ID"));
    if (!appId) {
      return jsonResponse(
        { error: "Missing or invalid appId (expected 3-15 digits)." },
        origin,
        400,
      );
    }

    const params = new URLSearchParams(
      (body.params as Record<string, string>) ?? {},
    );
    const ascPath = builder(appId, params);

    // Sign the token in-memory and use it server-side only.
    const token = await createAscToken();

    const ascRes = await fetch(`${ASC_BASE_URL}${ascPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const data = await ascRes.json().catch(() => ({}));

    if (!ascRes.ok) {
      const detail = Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors.map((e: { detail?: string; title?: string }) =>
          e.detail ?? e.title
        ).join("; ")
        : `App Store Connect request failed (${ascRes.status}).`;
      return jsonResponse({ error: detail }, origin, ascRes.status);
    }

    // Return ONLY the data. The token never leaves the server.
    return jsonResponse(data, origin);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unexpected error." },
      origin,
      500,
    );
  }
});
