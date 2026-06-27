import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const ASC_AUDIENCE = 'appstoreconnect-v1';
const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com';

/**
 * Reads the App Store Connect API private key, either from an inline
 * environment variable or from a file path.
 */
function loadPrivateKey() {
  const inline = process.env.ASC_PRIVATE_KEY;
  if (inline && inline.trim()) {
    // Support keys pasted with literal "\n" sequences in the .env file.
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }

  const keyPath = process.env.ASC_PRIVATE_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      'Missing private key. Set ASC_PRIVATE_KEY or ASC_PRIVATE_KEY_PATH in your .env file.'
    );
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key file not found at "${keyPath}".`);
  }
  return fs.readFileSync(keyPath, 'utf8');
}

/**
 * Generates a short-lived ES256 JSON Web Token for the App Store Connect API.
 * Tokens are valid for up to 20 minutes; we use a slightly shorter window.
 */
export function generateToken() {
  const issuerId = process.env.ASC_ISSUER_ID;
  const keyId = process.env.ASC_KEY_ID;

  if (!issuerId) throw new Error('Missing ASC_ISSUER_ID in your .env file.');
  if (!keyId) throw new Error('Missing ASC_KEY_ID in your .env file.');

  const privateKey = loadPrivateKey();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: issuerId,
      iat: now,
      exp: now + 60 * 15, // 15 minutes
      aud: ASC_AUDIENCE,
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: keyId, typ: 'JWT' },
    }
  );
}

/**
 * Performs an authenticated GET request against the App Store Connect API.
 * @param {string} pathOrUrl A path like "/v1/apps/123/customerReviews" or a full URL.
 */
async function ascRequest(pathOrUrl) {
  const token = generateToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ASC_BASE_URL}${pathOrUrl}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.errors?.map((e) => `${e.title}: ${e.detail}`).join('; ') || '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    const error = new Error(
      `App Store Connect API error ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`
    );
    error.status = res.status;
    throw error;
  }

  return res.json();
}

/**
 * Normalizes a raw customerReviews resource into a flat object.
 */
function normalizeReview(resource, responsesById) {
  const a = resource.attributes ?? {};
  // Resolve the developer response (if any) from the page's `included` block.
  const respId = resource.relationships?.response?.data?.id ?? null;
  const resp = respId && responsesById ? responsesById.get(respId) : null;
  const respAttr = resp?.attributes ?? null;
  return {
    id: resource.id,
    rating: a.rating ?? null,
    title: a.title ?? '',
    body: a.body ?? '',
    reviewerNickname: a.reviewerNickname ?? '',
    createdDate: a.createdDate ?? null,
    territory: a.territory ?? null,
    responded: respAttr ? 1 : 0,
    responseBody: respAttr?.responseBody ?? null,
    responseDate: respAttr?.lastModifiedDate ?? null,
    responseState: respAttr?.state ?? null,
  };
}

/**
 * Builds a lookup of customerReviewResponses (by id) from a page's `included`
 * array, so each review can resolve its developer response.
 */
function indexResponses(page) {
  const map = new Map();
  for (const item of page.included ?? []) {
    if (item.type === 'customerReviewResponses') map.set(item.id, item);
  }
  return map;
}

/**
 * Fetches customer reviews for an app, paginating until `maxReviews` is reached
 * or there are no more pages.
 *
 * @param {object} options
 * @param {string} options.appId          Numeric Apple ID of the app.
 * @param {number} [options.maxReviews]   Max number of reviews to retrieve.
 * @param {string} [options.territory]    Optional ISO territory filter (e.g. "USA").
 * @param {string} [options.sort]         Sort order (default "-createdDate").
 */
export async function fetchCustomerReviews({
  appId,
  maxReviews = 1000,
  territory,
  sort = '-createdDate',
} = {}) {
  if (!appId) throw new Error('appId is required.');

  const params = new URLSearchParams();
  params.set('sort', sort);
  params.set('limit', '200'); // API max page size for customerReviews.
  params.set('include', 'response'); // pull developer responses (answered or not).
  if (territory) params.set('filter[territory]', territory);

  let nextUrl = `/v1/apps/${appId}/customerReviews?${params.toString()}`;
  const reviews = [];

  while (nextUrl && reviews.length < maxReviews) {
    const page = await ascRequest(nextUrl);
    const responsesById = indexResponses(page);
    for (const resource of page.data ?? []) {
      reviews.push(normalizeReview(resource, responsesById));
      if (reviews.length >= maxReviews) break;
    }
    nextUrl = page.links?.next ?? null;
  }

  return reviews.slice(0, maxReviews);
}

/**
 * Fetches reviews newest-first and stops as soon as it encounters a review
 * created strictly before `sinceDate`. Ideal for incremental daily syncs and
 * "last 30 days" pulls without over-fetching.
 *
 * @param {object} options
 * @param {string} options.appId          Numeric Apple ID of the app.
 * @param {Date|string} options.sinceDate Cut-off; reviews older than this stop pagination.
 * @param {number} [options.maxReviews]   Safety cap on total reviews fetched.
 */
export async function fetchReviewsSince({ appId, sinceDate, maxReviews = 5000 } = {}) {
  if (!appId) throw new Error('appId is required.');
  const cutoff = new Date(sinceDate).getTime();
  if (Number.isNaN(cutoff)) throw new Error('sinceDate is invalid.');

  const params = new URLSearchParams();
  params.set('sort', '-createdDate');
  params.set('limit', '200');
  params.set('include', 'response'); // pull developer responses (answered or not).

  let nextUrl = `/v1/apps/${appId}/customerReviews?${params.toString()}`;
  const reviews = [];
  let reachedCutoff = false;

  while (nextUrl && reviews.length < maxReviews && !reachedCutoff) {
    const page = await ascRequest(nextUrl);
    const responsesById = indexResponses(page);
    for (const resource of page.data ?? []) {
      const review = normalizeReview(resource, responsesById);
      const created = review.createdDate ? new Date(review.createdDate).getTime() : NaN;
      if (!Number.isNaN(created) && created < cutoff) {
        reachedCutoff = true;
        break;
      }
      reviews.push(review);
      if (reviews.length >= maxReviews) break;
    }
    nextUrl = page.links?.next ?? null;
  }

  return reviews;
}
