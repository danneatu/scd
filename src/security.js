import fs from 'node:fs';
import path from 'node:path';

/**
 * Refuses to start (or warns) when secret files are readable by anyone other
 * than their owner. Apple `.p8` keys and the `.env` (which holds API keys)
 * must be owner-only (chmod 600). Loose permissions let any other local user
 * or process read your credentials — the most common silent leak.
 *
 * Set ALLOW_INSECURE_KEY_PERMS=1 to downgrade the hard stop to a warning
 * (useful on systems where you can't change file ownership/permissions).
 */

/** Secret files to audit: the .env plus any configured/loose private keys. */
function secretFiles(rootDir) {
  const files = new Set();

  // The .env itself (holds ASC/Sales/LLM keys in plaintext).
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) files.add(envPath);

  // Configured private-key paths (resolved relative to the project root).
  for (const envVar of ['ASC_PRIVATE_KEY_PATH', 'SALES_PRIVATE_KEY_PATH', 'ASC_ANALYTICS_PRIVATE_KEY_PATH']) {
    const p = process.env[envVar];
    if (p && p.trim()) {
      const resolved = path.isAbsolute(p) ? p : path.join(rootDir, p);
      if (fs.existsSync(resolved)) files.add(resolved);
    }
  }

  // Any stray .p8 keys sitting in the project root.
  try {
    for (const name of fs.readdirSync(rootDir)) {
      if (name.endsWith('.p8')) files.add(path.join(rootDir, name));
    }
  } catch {
    /* ignore unreadable root */
  }

  return [...files];
}

/** Human-readable reason describing which permission bits are too open. */
function permissionReason(mode) {
  const reasons = [];
  if (mode & 0o040) reasons.push('group can read');
  if (mode & 0o020) reasons.push('group can write');
  if (mode & 0o004) reasons.push('others can read');
  if (mode & 0o002) reasons.push('others can write');
  return reasons.join(', ');
}

/**
 * Audits secret-file permissions. Returns the list of offenders (empty when
 * everything is owner-only). Windows is skipped (POSIX mode bits don't apply).
 *
 * @param {object} [options]
 * @param {string} [options.rootDir] Project root (defaults to cwd).
 * @returns {{ file: string, mode: string, reason: string }[]}
 */
export function auditSecretPermissions({ rootDir = process.cwd() } = {}) {
  if (process.platform === 'win32') return [];

  const offenders = [];
  for (const file of secretFiles(rootDir)) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    // Any access for group/other (read/write/execute) means it's not 600/400.
    if (stat.mode & 0o077) {
      offenders.push({
        file: path.relative(rootDir, file) || file,
        mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
        reason: permissionReason(stat.mode) || 'accessible by group/other',
      });
    }
  }
  return offenders;
}

/**
 * Enforces owner-only permissions on secret files at startup. By default this
 * refuses to boot when any secret is group/world-accessible, printing the
 * specific reason and the exact fix. Set ALLOW_INSECURE_KEY_PERMS=1 to turn the
 * hard stop into a non-fatal warning.
 *
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {() => void} [options.exit] Override for the process exit (testing).
 */
export function enforceSecretPermissions({ rootDir = process.cwd(), exit } = {}) {
  const offenders = auditSecretPermissions({ rootDir });
  if (offenders.length === 0) return;

  const allowInsecure = process.env.ALLOW_INSECURE_KEY_PERMS === '1';
  const label = allowInsecure ? 'WARNING' : 'REFUSING TO START';

  console.error(`\n  🔒 ${label}: insecure permissions on secret file(s).`);
  console.error('  These hold your API keys and must be readable only by you (chmod 600):\n');
  for (const o of offenders) {
    console.error(`    • ${o.file}  (mode ${o.mode} — ${o.reason})`);
  }
  const fixList = offenders.map((o) => `"${o.file}"`).join(' ');
  console.error(`\n  Reason: other users or processes on this machine could read your credentials.`);
  console.error(`  Fix:    chmod 600 ${fixList}`);

  if (allowInsecure) {
    console.error('  (Continuing anyway because ALLOW_INSECURE_KEY_PERMS=1.)\n');
    return;
  }
  console.error('  Then start again. (To bypass, set ALLOW_INSECURE_KEY_PERMS=1 — not recommended.)\n');
  (exit || process.exit)(1);
}
