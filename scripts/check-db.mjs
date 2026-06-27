// Safe DATABASE_URL diagnostic. Reads DATABASE_URL from the environment, prints
// ONLY non-sensitive parts (host, port, db, username, whether a password is
// present), then attempts a real connection. The password is never printed.
//
// Usage:
//   DATABASE_URL='postgresql://...' node scripts/check-db.mjs
// or put DATABASE_URL in .env and run:
//   node -r dotenv/config scripts/check-db.mjs   (or: node scripts/check-db.mjs with the import below)

import 'dotenv/config';
import pg from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

console.log('Length:', raw.length, 'chars');

// Try to parse it the way a URL parser would.
let parsed;
try {
  parsed = new URL(raw);
  console.log('Parsed OK:');
  console.log('  protocol :', parsed.protocol);
  console.log('  username :', parsed.username || '(none)');
  console.log('  password :', parsed.password ? `<${parsed.password.length} chars>` : '(none)');
  console.log('  host     :', parsed.hostname);
  console.log('  port     :', parsed.port || '(default)');
  console.log('  database :', parsed.pathname.replace(/^\//, '') || '(none)');
} catch (err) {
  console.error('URL PARSE FAILED:', err.message);
}

// Flag common mistakes without revealing the secret.
const problems = [];
if (raw.includes('[YOUR-PASSWORD]') || raw.includes('[') || raw.includes(']')) {
  problems.push('Contains "[" or "]" — likely the [YOUR-PASSWORD] placeholder was not replaced, or the password has unencoded brackets.');
}
if (parsed && parsed.hostname && !parsed.hostname.includes('.')) {
  problems.push(`Host "${parsed.hostname}" has no dot — the URL is malformed (password probably contains an unencoded special character like @ : / # ?).`);
}
if (problems.length) {
  console.log('\nPotential problems:');
  for (const p of problems) console.log('  • ' + p);
}

// Attempt a real connection.
console.log('\nConnecting…');
const { Pool } = pg;
const pool = new Pool({
  connectionString: raw,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
try {
  const r = await pool.query('select 1 as ok');
  console.log('CONNECTION OK:', r.rows[0]);
} catch (err) {
  console.error('CONNECTION FAILED:', err.message);
} finally {
  await pool.end().catch(() => {});
}
