import fs from 'node:fs';
import zlib from 'node:zlib';
import jwt from 'jsonwebtoken';

const ASC_AUDIENCE = 'appstoreconnect-v1';
const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com';

/**
 * Loads the Sales-role private key (inline env var or .p8 file path).
 */
function loadSalesKey() {
  const inline = process.env.SALES_PRIVATE_KEY;
  if (inline && inline.trim()) {
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }
  const keyPath = process.env.SALES_PRIVATE_KEY_PATH;
  if (!keyPath) {
    throw new Error('Missing SALES_PRIVATE_KEY or SALES_PRIVATE_KEY_PATH in your .env file.');
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Sales private key file not found at "${keyPath}".`);
  }
  return fs.readFileSync(keyPath, 'utf8');
}

/**
 * True when the sales-report credentials look configured.
 */
export function salesConfigured() {
  return Boolean(
    (process.env.ASC_ISSUER_ID || process.env.SALES_ISSUER_ID) &&
      process.env.SALES_KEY_ID &&
      (process.env.SALES_PRIVATE_KEY || process.env.SALES_PRIVATE_KEY_PATH) &&
      process.env.SALES_VENDOR_NUMBER
  );
}

/**
 * Signs a short-lived ES256 JWT using the Sales-role key.
 */
function generateSalesToken() {
  // The Issuer ID is account-wide, so reuse ASC_ISSUER_ID unless overridden.
  const issuerId = process.env.SALES_ISSUER_ID || process.env.ASC_ISSUER_ID;
  const keyId = process.env.SALES_KEY_ID;
  if (!issuerId) throw new Error('Missing ASC_ISSUER_ID / SALES_ISSUER_ID.');
  if (!keyId) throw new Error('Missing SALES_KEY_ID.');

  const privateKey = loadSalesKey();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: issuerId, iat: now, exp: now + 60 * 15, aud: ASC_AUDIENCE },
    privateKey,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId, typ: 'JWT' } }
  );
}

/**
 * Fetches a sales report and returns its decompressed TSV text, or null when
 * Apple reports there is no data for that date (HTTP 404 with a "no data" code).
 *
 * @param {object} options
 * @param {string} options.frequency   DAILY | WEEKLY | MONTHLY | YEARLY
 * @param {string} options.reportDate  YYYY-MM-DD | YYYY-MM | YYYY (per frequency)
 * @param {string} [options.reportType]    Default "SALES".
 * @param {string} [options.reportSubType] Default "SUMMARY".
 */
export async function fetchSalesReportTsv({
  frequency,
  reportDate,
  reportType = 'SALES',
  reportSubType = 'SUMMARY',
}) {
  const vendorNumber = process.env.SALES_VENDOR_NUMBER;
  if (!vendorNumber) throw new Error('Missing SALES_VENDOR_NUMBER in your .env file.');

  const params = new URLSearchParams();
  params.set('filter[frequency]', frequency);
  params.set('filter[reportType]', reportType);
  params.set('filter[reportSubType]', reportSubType);
  params.set('filter[vendorNumber]', vendorNumber);
  params.set('filter[reportDate]', reportDate);
  params.set('filter[version]', process.env.SALES_REPORT_VERSION || '1_0');

  const token = generateSalesToken();
  const res = await fetch(`${ASC_BASE_URL}/v1/salesReports?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
  });

  if (res.status === 404) {
    // No data for this date — normal for days before launch or not-yet-generated.
    return null;
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.errors?.map((e) => `${e.title}: ${e.detail}`).join('; ') || '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    const err = new Error(
      `Sales report error ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`
    );
    err.status = res.status;
    throw err;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // Body is gzip-compressed TSV.
  try {
    return zlib.gunzipSync(buf).toString('utf8');
  } catch {
    // Some responses may already be plain text.
    return buf.toString('utf8');
  }
}

/**
 * Parses a sales-report TSV into an array of row objects keyed by header.
 */
export function parseSalesTsv(tsv) {
  if (!tsv) return [];
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t');
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}
