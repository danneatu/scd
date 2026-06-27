import { getState, setState, getWrittenReviewsSince, getRecentWrittenReviews, getLatestReviewDate } from './db.js';
import { reportLanguage } from './reviewAgent.js';

/**
 * Email notifications for new written reviews.
 *
 * Two delivery backends are supported (pick whichever is easier to configure):
 *
 *   1) Resend HTTP API (no extra dependency, just an API key):
 *        NOTIFY_TO=you@example.com
 *        RESEND_API_KEY=re_...
 *        NOTIFY_FROM="App Reviews <onboarding@resend.dev>"   (optional)
 *
 *   2) SMTP via nodemailer (Gmail, Fastmail, your own server, ...):
 *        NOTIFY_TO=you@example.com
 *        SMTP_HOST=smtp.gmail.com
 *        SMTP_PORT=465
 *        SMTP_USER=you@gmail.com
 *        SMTP_PASS=your-app-password
 *        NOTIFY_FROM="App Reviews <you@gmail.com>"            (optional)
 *
 * If neither is configured, notifications are silently disabled.
 */

const NOTIFY_TO = () => (process.env.NOTIFY_TO || '').trim();
const NOTIFY_FROM = () =>
  (process.env.NOTIFY_FROM || process.env.SMTP_USER || 'App Reviews <notifications@localhost>').trim();

/** Which backend (if any) is configured. */
export function notifyTransport() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return null;
}

/** True when a recipient and a delivery backend are both configured. */
export function notifyConfigured() {
  return Boolean(NOTIFY_TO() && notifyTransport());
}

/** Status object for /api/config (never exposes secrets). */
export function notifyInfo() {
  const transport = notifyTransport();
  const to = NOTIFY_TO();
  return {
    configured: Boolean(to && transport),
    transport: transport || null,
    // Mask the recipient for display, e.g. "j***@example.com".
    to: to ? maskEmail(to) : null,
  };
}

function maskEmail(addr) {
  const [user, domain] = String(addr).split('@');
  if (!domain) return addr;
  const head = user.slice(0, 1);
  return `${head}***@${domain}`;
}

const I18N = {
  en: {
    subjectOne: (app) => `New App Store review for ${app}`,
    subjectMany: (n, app) => `${n} new App Store reviews for ${app}`,
    heading: 'New written review',
    headingMany: (n) => `${n} new written reviews`,
    intro: 'Here is what came in since the last check:',
    by: 'by',
    noBody: '(no text)',
    footer: 'You receive this because email notifications are enabled in App Ratings Analyzer.',
    testSubject: (app) => `Test email — App Ratings Analyzer (${app})`,
    testHeading: 'Test notification',
    testBody: 'If you can read this, email notifications are working. Below is a preview using your most recent written reviews (none were marked as “sent”).',
  },
  de: {
    subjectOne: (app) => `Neue App-Store-Rezension für ${app}`,
    subjectMany: (n, app) => `${n} neue App-Store-Rezensionen für ${app}`,
    heading: 'Neue schriftliche Rezension',
    headingMany: (n) => `${n} neue schriftliche Rezensionen`,
    intro: 'Das ist seit der letzten Prüfung eingegangen:',
    by: 'von',
    noBody: '(kein Text)',
    footer: 'Du erhältst diese E-Mail, weil im App Ratings Analyzer E-Mail-Benachrichtigungen aktiviert sind.',
    testSubject: (app) => `Test-E-Mail — App Ratings Analyzer (${app})`,
    testHeading: 'Test-Benachrichtigung',
    testBody: 'Wenn du das lesen kannst, funktionieren die E-Mail-Benachrichtigungen. Unten siehst du eine Vorschau mit deinen neuesten schriftlichen Rezensionen (keine wurde als „gesendet“ markiert).',
  },
};

function strings() {
  const { code } = reportLanguage();
  return I18N[code] || I18N.en;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stars(rating) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function formatDate(iso, locale) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function reviewCardHtml(r, locale, t) {
  const color = (Number(r.rating) || 0) <= 2 ? '#d6453d' : (Number(r.rating) || 0) >= 4 ? '#2f9e57' : '#c9920a';
  const title = r.title ? `<div style="font-weight:600;color:#1a1a1a;margin:0 0 4px">${escapeHtml(r.title)}</div>` : '';
  const body = r.body ? escapeHtml(r.body) : `<em style="color:#888">${t.noBody}</em>`;
  const meta = [r.reviewerNickname ? `${t.by} ${escapeHtml(r.reviewerNickname)}` : '', r.territory || '', formatDate(r.createdDate, locale)]
    .filter(Boolean)
    .join(' · ');
  return `
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 12px;background:#ffffff">
      <div style="font-size:18px;letter-spacing:2px;color:${color};margin:0 0 6px">${stars(r.rating)}</div>
      ${title}
      <div style="color:#333;line-height:1.5;font-size:14px;white-space:pre-wrap">${body}</div>
      <div style="color:#888;font-size:12px;margin-top:8px">${escapeHtml(meta)}</div>
    </div>`;
}

function emailHtml({ heading, intro, reviews, appId, locale, t }) {
  const cards = reviews.map((r) => reviewCardHtml(r, locale, t)).join('');
  return `
  <div style="background:#f3f4f6;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;padding:0 16px">
      <div style="background:#4f8cff;color:#fff;border-radius:12px 12px 0 0;padding:18px 20px">
        <div style="font-size:18px;font-weight:700">${escapeHtml(heading)}</div>
        <div style="opacity:.9;font-size:13px;margin-top:2px">App ${escapeHtml(appId)}</div>
      </div>
      <div style="background:#fff;border-radius:0 0 12px 12px;padding:18px 20px;border:1px solid #e5e7eb;border-top:none">
        <p style="color:#444;font-size:14px;margin:0 0 14px">${escapeHtml(intro)}</p>
        ${cards}
        <p style="color:#9aa0a6;font-size:11px;margin:18px 0 0">${escapeHtml(t.footer)}</p>
      </div>
    </div>
  </div>`;
}

function emailText({ heading, intro, reviews, t, locale }) {
  const lines = [heading, '', intro, ''];
  for (const r of reviews) {
    lines.push(`${stars(r.rating)}  (${r.rating || '?'}/5)`);
    if (r.title) lines.push(r.title);
    lines.push(r.body || t.noBody);
    const meta = [r.reviewerNickname ? `${t.by} ${r.reviewerNickname}` : '', r.territory || '', formatDate(r.createdDate, locale)]
      .filter(Boolean)
      .join(' · ');
    if (meta) lines.push(meta);
    lines.push('');
  }
  lines.push(t.footer);
  return lines.join('\n');
}

/* ---------- delivery backends ---------- */

async function sendViaResend({ to, from, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  return { id: data.id || null };
}

async function sendViaSmtp({ to, from, subject, html, text }) {
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('SMTP backend requires the "nodemailer" package. Run: npm install nodemailer');
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS on 465, STARTTLS otherwise
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({ from, to, subject, html, text });
  return { id: info.messageId || null };
}

async function deliver({ subject, html, text }) {
  const transport = notifyTransport();
  const to = NOTIFY_TO();
  const from = NOTIFY_FROM();
  if (!transport) throw new Error('No email backend configured (set RESEND_API_KEY or SMTP_* in .env).');
  if (!to) throw new Error('No recipient configured (set NOTIFY_TO in .env).');
  if (transport === 'resend') return sendViaResend({ to, from, subject, html, text });
  return sendViaSmtp({ to, from, subject, html, text });
}

/* ---------- public API ---------- */

const markerKey = (appId) => `notify:lastReviewDate:${appId}`;

/**
 * Sends an email if new written reviews have arrived since the last run.
 *
 * On the very first run (no marker yet) it does NOT email the existing backlog —
 * it just records the current latest review date so future new reviews trigger mail.
 *
 * @returns {Promise<{sent:boolean, count?:number, reason?:string, id?:string}>}
 */
export async function checkAndNotify({ appId }) {
  if (!notifyConfigured()) return { sent: false, reason: 'not_configured' };

  const key = markerKey(appId);
  const marker = await getState(key);

  if (!marker) {
    // First run: baseline to "now" so we don't blast the whole history.
    const latest = (await getLatestReviewDate(appId)) || new Date(0).toISOString();
    await setState(key, latest);
    return { sent: false, reason: 'initialized' };
  }

  const reviews = await getWrittenReviewsSince(appId, marker, 50);
  if (!reviews.length) return { sent: false, reason: 'no_new' };

  const t = strings();
  const { code: locale } = reportLanguage();
  const heading = reviews.length === 1 ? t.heading : t.headingMany(reviews.length);
  const subject = reviews.length === 1 ? t.subjectOne(appId) : t.subjectMany(reviews.length, appId);
  const html = emailHtml({ heading, intro: t.intro, reviews, appId, locale, t });
  const text = emailText({ heading, intro: t.intro, reviews, t, locale });

  const result = await deliver({ subject, html, text });

  // Advance the marker to the newest review we just notified about.
  const newest = reviews[0]?.createdDate;
  if (newest) await setState(key, newest);

  return { sent: true, count: reviews.length, id: result.id };
}

/**
 * Sends a test email using the most recent written reviews as a preview.
 * Does NOT change the notification marker.
 */
export async function sendTestEmail({ appId }) {
  if (!notifyConfigured()) {
    const err = new Error('Email notifications are not configured. Set NOTIFY_TO and a backend (RESEND_API_KEY or SMTP_*).');
    err.status = 409;
    throw err;
  }
  const t = strings();
  const { code: locale } = reportLanguage();
  const sample = await getRecentWrittenReviews(appId, 3);
  const reviews = sample.length
    ? sample
    : [
        {
          rating: 5,
          title: 'Sample review',
          body: 'This is a sample review used only for the test email.',
          reviewerNickname: 'Tester',
          territory: null,
          createdDate: new Date().toISOString(),
        },
      ];
  const subject = t.testSubject(appId);
  const html = emailHtml({ heading: t.testHeading, intro: t.testBody, reviews, appId, locale, t });
  const text = emailText({ heading: t.testHeading, intro: t.testBody, reviews, t, locale });
  const result = await deliver({ subject, html, text });
  return { sent: true, count: reviews.length, id: result.id, transport: notifyTransport(), to: maskEmail(NOTIFY_TO()) };
}
