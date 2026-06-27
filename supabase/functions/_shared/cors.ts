// Shared CORS helper for Edge Functions.
//
// Browsers send a preflight `OPTIONS` request before cross-origin POSTs and will
// block the real request unless the server echoes the right CORS headers. Set
// ALLOWED_ORIGINS (comma-separated) as a function secret to lock this down to
// your real site(s); defaults to "*" for easy local development.

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowAll = ALLOWED.includes("*");
  const allowOrigin = allowAll
    ? "*"
    : origin && ALLOWED.includes(origin)
      ? origin
      : (ALLOWED[0] ?? "");

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

/** Builds a JSON Response with CORS headers applied. */
export function jsonResponse(
  body: unknown,
  origin: string | null,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
