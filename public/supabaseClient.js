// Browser-side Supabase client + helper to call the App Store Connect Edge
// Function. No build step required — this imports the SDK straight from a CDN.
//
// NOTE: SUPABASE_URL and the *anon* key are PUBLIC by design (the anon key is a
// restricted, RLS-gated client token). Never put the service_role key or any
// App Store Connect .p8 / Issuer / Key ID here — those stay server-side in the
// Edge Function's secrets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Fetches a READ-ONLY App Store Connect resource via the Edge Function proxy.
 *
 * The Edge Function signs the App Store Connect JWT in-memory, calls Apple
 * server-side, and returns ONLY the resulting data — the token never reaches
 * the browser. supabase-js attaches the anon key (or the signed-in user's
 * session) as the bearer token and handles CORS for you.
 *
 * @param {"customerReviews"|"appInfo"} [resource="customerReviews"]
 *   The allow-listed resource to read.
 * @param {object} [options]
 * @param {string} [options.appId] App Store Connect app id (digits only).
 *   Defaults to the Edge Function's ASC_DEFAULT_APP_ID secret when omitted.
 * @param {Record<string,string>} [options.params] Extra query params, e.g.
 *   `{ limit: "50", sort: "-createdDate" }` for customerReviews.
 * @returns {Promise<object>} The App Store Connect JSON payload.
 */
export async function fetchAscResource(
  resource = "customerReviews",
  { appId, params } = {},
) {
  const { data, error } = await supabase.functions.invoke(
    "app-store-connect-token",
    { method: "POST", body: { resource, appId, params } },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// Example usage:
//
//   import { fetchAscResource } from "./supabaseClient.js";
//   try {
//     const reviews = await fetchAscResource("customerReviews", {
//       params: { limit: "50", sort: "-createdDate" },
//     });
//     console.log("Got", reviews.data?.length, "reviews");
//   } catch (err) {
//     console.error("Failed to load reviews:", err.message);
//   }
