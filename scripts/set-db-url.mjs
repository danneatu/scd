// Interactive, safe DATABASE_URL setup for Supabase.
//
// - Prompts for the DB password with HIDDEN input (never echoed, never stored
//   in shell history).
// - URL-encodes the password automatically (so special characters can't break
//   the connection string).
// - Lets you pick the Supabase "Session pooler" (recommended — works on GitHub
//   Actions / IPv4) or the direct connection.
// - Tests the connection before doing anything else.
// - On success, optionally stores it as the GitHub Actions secret and/or writes
//   it to your local .env.
//
// Usage:
//   node scripts/set-db-url.mjs
//
// The assembled URL is never printed in full; the password is never shown.

import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';

const PROJECT_REF = 'nggoooczksibktwskwel';
const GH_REPO = 'danneatu/scd';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

// Hidden prompt (no echo) for secrets.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      const s = char + '';
      if (s === '\n' || s === '\r' || s === '\u0004') {
        process.stdin.removeListener('data', onData);
      } else {
        // Re-write the prompt to mask everything typed.
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (value) => { rl.close(); process.stdout.write('\n'); resolve(value); });
  });
}

async function main() {
  console.log('\nSupabase DATABASE_URL setup\n---------------------------');
  console.log('Tip: get the exact host/port/user from Supabase →');
  console.log('     Project Settings → Database → Connection string.\n');

  const mode = (await ask('Connection type — [p]ooler (recommended) or [d]irect? [p]: ')) || 'p';

  let user, host, port;
  if (mode.toLowerCase().startsWith('d')) {
    user = 'postgres';
    host = `db.${PROJECT_REF}.supabase.co`;
    port = '5432';
    console.log(`\nUsing DIRECT: user=${user} host=${host} port=${port}`);
    console.log('NOTE: direct connections may not work on GitHub Actions (IPv6-only).');
  } else {
    // Session pooler. Paste the EXACT host from the dashboard's Connect modal
    // (e.g. aws-0-eu-central-1.pooler.supabase.com or aws-1-...). This avoids
    // guessing the aws-0/aws-1 cluster prefix.
    host = await ask('Pooler host (copy from Supabase → Connect → Session pooler): ');
    if (!host) throw new Error('Pooler host is required.');
    host = host.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    user = `postgres.${PROJECT_REF}`;
    port = (await ask('Pooler port [6543]: ')) || '6543';
    console.log(`\nUsing POOLER: user=${user} host=${host} port=${port}`);
  }

  const password = await askHidden('Database password (hidden): ');
  if (!password) throw new Error('Password is required.');

  const encoded = encodeURIComponent(password);
  const url = `postgresql://${user}:${encoded}@${host}:${port}/postgres`;
  console.log(`\nAssembled URL host: ${host}:${port}  (password hidden, ${password.length} chars)`);

  // Test the connection.
  console.log('Testing connection…');
  const { Pool } = pg;
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    const r = await pool.query('select 1 as ok');
    console.log('CONNECTION OK:', r.rows[0]);
  } catch (err) {
    console.error('CONNECTION FAILED:', err.message);
    console.error('Nothing was stored. Fix the details above and re-run.');
    await pool.end().catch(() => {});
    process.exit(1);
  }
  await pool.end().catch(() => {});

  // Offer to store it.
  const setSecret = (await ask('\nStore as GitHub Actions secret DATABASE_URL? [Y/n]: ')) || 'y';
  if (setSecret.toLowerCase().startsWith('y')) {
    const res = spawnSync('gh', ['secret', 'set', 'DATABASE_URL', '--repo', GH_REPO], {
      input: url, encoding: 'utf8',
    });
    if (res.status === 0) console.log('✓ GitHub secret DATABASE_URL set.');
    else console.error('gh secret set failed:', res.stderr || res.error?.message);
  }

  const setEnv = (await ask('Also write DATABASE_URL to local .env (for npm run migrate:pg)? [y/N]: ')) || 'n';
  if (setEnv.toLowerCase().startsWith('y')) {
    let env = '';
    try { env = fs.readFileSync('.env', 'utf8'); } catch {}
    env = env.replace(/^DATABASE_URL=.*$/m, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    env += `\nDATABASE_URL=${url}\n`;
    fs.writeFileSync('.env', env);
    fs.chmodSync('.env', 0o600);
    console.log('✓ Wrote DATABASE_URL to .env (chmod 600).');
  }

  console.log('\nDone.');
}

main().catch((err) => { console.error('\nError:', err.message); process.exit(1); });
