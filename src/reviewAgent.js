/**
 * Review-analysis agent.
 *
 * Instead of one opaque pass, the agent runs a small pipeline of focused
 * "skills" — each is a pure, testable step that turns reviews into structured
 * evidence:
 *
 *   1. classify   → tag every review with sentiment + topic categories
 *   2. cluster    → group complaints / praise into themes per category
 *   3. score      → rank pain points by severity (frequency × intensity × recency)
 *   4. trend      → compare each theme against the previous month
 *   5. quote      → pick the clearest representative quotes
 *   6. recommend  → derive actionable next steps from the top pain points
 *   7. refine     → (optional) an LLM polishes titles/descriptions, grounded in
 *                   the deterministic evidence above so it can't invent numbers
 *
 * The deterministic skills always run, so the analysis is meaningful even
 * without an LLM key. When `LLM_*` is configured, the refine skill upgrades the
 * wording and translation while keeping the computed frequencies/severities.
 */

import { llmComplete, llmConfigured } from './llm.js';

/* ----------------------------------------------------------------------------
 * Lexicons (English + German — the reviews are bilingual). Stems are chosen to
 * match inflections and German compounds via substring matching.
 * ------------------------------------------------------------------------- */

const PAIN_CATEGORIES = {
  stability: {
    label: 'Technical instability',
    stems: [
      'absturz', 'abstürz', 'stürzt ab', 'stürzt', 'crash', 'bug', 'fehler', 'error',
      'hängt', 'hängen', 'freeze', 'friert', 'funktioniert nicht', 'geht nicht',
      "doesn't work", 'does not work', 'not working', 'broken', 'kaputt', 'defekt',
    ],
    action:
      'Reproduce and fix the reported crashes/errors; add crash reporting and ship a stability-focused release.',
  },
  performance: {
    label: 'Slow performance',
    stems: [
      'langsam', 'lädt ewig', 'lädt nicht', 'lädt', 'laden', 'loading', 'slow', 'lag',
      'träge', 'dauert', 'ewig', 'performance', 'ruckelt', 'zäh',
    ],
    action: 'Profile the slowest screens, reduce load times, and add caching / async loading.',
  },
  login: {
    label: 'Login & access',
    stems: [
      'login', 'log in', 'anmeld', 'einlogg', 'einlogg', 'passwort', 'password', 'tan',
      'authentif', 'zugang', 'gesperrt', 'account', 'konto', 'zugriff', 'verifizier',
    ],
    action: 'Streamline the login/authentication flow and review recent auth, TAN, or account changes.',
  },
  usability: {
    label: 'Confusing usability',
    stems: [
      'umständlich', 'kompliziert', 'unübersichtlich', 'confusing', 'complicated',
      'hard to use', 'schwer zu', 'bedienung', 'unintuitiv', 'nicht intuitiv',
      'verwirrend', 'unklar', 'mühsam',
    ],
    action: 'Run a usability pass on the most-complained screens and simplify the confusing flows.',
  },
  connectivity: {
    label: 'Connectivity & server',
    stems: [
      'verbindung', 'connection', 'offline', 'server', 'netzwerk', 'no internet',
      'keine verbindung', 'timeout', 'zeitüberschreitung', 'nicht erreichbar', 'wartung',
    ],
    action: 'Improve offline handling and connection-error messaging; check server uptime and timeouts.',
  },
  pricing: {
    label: 'Pricing & fees',
    stems: [
      'teuer', 'expensive', 'gebühr', 'fees', 'kosten', 'preis', 'price', 'abo',
      'subscription', 'abzocke', 'zu teuer', 'abgezockt', 'bezahlen',
    ],
    action: 'Revisit pricing/fee communication and reinforce the value message in-app.',
  },
  update: {
    label: 'Update regressions',
    stems: [
      'nach dem update', 'seit dem update', 'nach update', 'neues update', 'new version',
      'neue version', 'letztes update', 'aktualisier', 'nach der aktualisierung',
    ],
    action: 'Review the latest release for regressions and consider a hotfix for issues it introduced.',
  },
  features: {
    label: 'Missing features',
    stems: [
      'fehlt', 'missing', 'vermisse', 'wäre schön', 'would be nice', 'feature fehlt',
      'funktion fehlt', 'könnte man', 'wünsche mir', 'wunsch', 'bräuchte', 'add option',
    ],
    action: 'Capture the most-requested features into the backlog and share the roadmap with users.',
  },
};

const PRAISE_CATEGORIES = {
  support: {
    label: 'Helpful support',
    stems: [
      'kundendienst', 'kundenservice', 'support', 'schnell geholfen', 'geholfen',
      'freundlich', 'customer service', 'helpful', 'hilfsbereit', 'kompetent',
    ],
  },
  usability_good: {
    label: 'Easy to use',
    stems: [
      'einfach', 'übersichtlich', 'intuitiv', 'easy', 'intuitive', 'simple',
      'benutzerfreundlich', 'user friendly', 'easy to use', 'klar strukturiert', 'selbsterklärend',
    ],
  },
  reliability_good: {
    label: 'Reliable',
    stems: [
      'zuverlässig', 'reliable', 'funktioniert einwandfrei', 'stabil', 'läuft super',
      'problemlos', 'flawless', 'works great', 'works well',
    ],
  },
  speed_good: {
    label: 'Fast & responsive',
    stems: ['schnell', 'fast', 'quick', 'responsive', 'flott'],
  },
  features_good: {
    label: 'Loved features',
    stems: [
      'praktisch', 'hilfreich', 'useful', 'great feature', 'toll', 'super app', 'klasse',
      'genial', 'liebe die', 'love', 'beste app', 'best app', 'empfehlenswert',
    ],
  },
};

/* ----------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------- */

function reviewText(r) {
  return `${r.title || ''} ${r.body || ''}`.trim();
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ');
}

function polarityOf(r) {
  if (typeof r.rating === 'number') {
    if (r.rating <= 2) return 'negative';
    if (r.rating >= 4) return 'positive';
    return 'neutral';
  }
  return r.sentimentLabel || 'neutral';
}

function matchCategories(text, lexicon) {
  const hay = normalize(text);
  const hits = [];
  for (const [id, def] of Object.entries(lexicon)) {
    if (def.stems.some((s) => hay.includes(s))) hits.push(id);
  }
  return hits;
}

/* ----------------------------------------------------------------------------
 * Skill 1 — classify: sentiment + topic categories for each review.
 * ------------------------------------------------------------------------- */

function classify(reviews) {
  return reviews
    .filter((r) => reviewText(r))
    .map((r) => {
      const polarity = polarityOf(r);
      const text = reviewText(r);
      return {
        ...r,
        text,
        polarity,
        painCategories: polarity === 'positive' ? [] : matchCategories(text, PAIN_CATEGORIES),
        praiseCategories: polarity === 'negative' ? [] : matchCategories(text, PRAISE_CATEGORIES),
      };
    });
}

/* ----------------------------------------------------------------------------
 * Skill 5 — quote: pick the clearest representative quotes for a bucket.
 * ------------------------------------------------------------------------- */

function pickQuotes(items, limit = 2) {
  return items
    .map((r) => r.text)
    .filter(Boolean)
    .sort((a, b) => a.length - b.length) // shorter quotes read cleaner
    .slice(0, limit)
    .map((t) => (t.length > 180 ? `${t.slice(0, 177)}…` : t));
}

/* ----------------------------------------------------------------------------
 * Skill 2/3/4 — cluster, score severity, and detect month-over-month trend.
 * ------------------------------------------------------------------------- */

function newestTime(items) {
  let max = 0;
  for (const r of items) {
    const t = Date.parse(r.createdDate || '');
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max || Date.now();
}

function clusterPain(classified, prevClassified) {
  const negatives = classified.filter((r) => r.polarity === 'negative');
  const totalNeg = negatives.length || 1;
  const anchor = newestTime(classified);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  // Previous-month frequency per category, for trend comparison.
  const prevFreq = new Map();
  for (const r of prevClassified.filter((r) => r.polarity === 'negative')) {
    for (const id of r.painCategories) prevFreq.set(id, (prevFreq.get(id) || 0) + 1);
  }

  const themes = [];
  for (const [id, def] of Object.entries(PAIN_CATEGORIES)) {
    const bucket = negatives.filter((r) => r.painCategories.includes(id));
    if (!bucket.length) continue;

    const frequency = bucket.length;
    const share = frequency / totalNeg;

    // Intensity: how harsh the ratings are (1★ hurts more than 2★). 0..1.
    const rated = bucket.filter((r) => typeof r.rating === 'number');
    const avgRating = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 2;
    const intensity = Math.min(Math.max((3 - avgRating) / 2, 0), 1);

    // Recency: share of this theme's reviews within 7 days of the newest review.
    const recent = bucket.filter((r) => anchor - Date.parse(r.createdDate || '') <= sevenDays).length;
    const recency = recent / frequency;

    const score = frequency * (1 + intensity) * (1 + recency * 0.5);

    let severity = 'low';
    if (share >= 0.3 || frequency >= 5) severity = 'high';
    else if (share >= 0.15 || frequency >= 3) severity = 'medium';

    const prev = prevFreq.get(id) || 0;
    let trend = 'flat';
    if (prev === 0 && frequency > 0) trend = 'new';
    else if (frequency >= prev + 2 || frequency >= prev * 1.5) trend = 'up';
    else if (frequency <= prev - 2 || frequency * 1.5 <= prev) trend = 'down';

    themes.push({
      type: 'pain',
      category: id,
      theme: def.label,
      description: describePain(def.label, frequency, severity, avgRating),
      frequency,
      share: Number(share.toFixed(2)),
      severity,
      trend,
      trendDelta: frequency - prev,
      score: Number(score.toFixed(2)),
      avgRating: Number(avgRating.toFixed(2)),
      action: def.action,
      examples: pickQuotes(bucket),
      quotes: pickQuotes(bucket, 6),
    });
  }

  return themes.sort((a, b) => b.score - a.score);
}

function clusterPraise(classified) {
  const positives = classified.filter((r) => r.polarity === 'positive');
  const total = positives.length || 1;
  const themes = [];
  for (const [id, def] of Object.entries(PRAISE_CATEGORIES)) {
    const bucket = positives.filter((r) => r.praiseCategories.includes(id));
    if (!bucket.length) continue;
    themes.push({
      type: 'praise',
      category: id,
      theme: def.label,
      description: `Mentioned positively in ${bucket.length} review(s) (${Math.round(
        (bucket.length / total) * 100
      )}% of positive feedback).`,
      frequency: bucket.length,
      share: Number((bucket.length / total).toFixed(2)),
      examples: pickQuotes(bucket),
      quotes: pickQuotes(bucket, 6),
    });
  }
  return themes.sort((a, b) => b.frequency - a.frequency);
}

function describePain(label, frequency, severity, avgRating) {
  const sev = severity === 'high' ? 'a major' : severity === 'medium' ? 'a notable' : 'a minor';
  return `${label} is ${sev} theme: ${frequency} complaint(s), averaging ${avgRating.toFixed(
    1
  )}★ where it appears.`;
}

/* ----------------------------------------------------------------------------
 * Skill 6 — recommend: actionable next steps from the top pain points.
 * ------------------------------------------------------------------------- */

function recommend(painThemes) {
  return painThemes.slice(0, 5).map((p) => p.action);
}

/* ----------------------------------------------------------------------------
 * Stats + summary
 * ------------------------------------------------------------------------- */

function computeStats(reviews) {
  const rated = reviews.filter((r) => typeof r.rating === 'number');
  const avg = rated.length
    ? Number((rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2))
    : null;
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const r of reviews) {
    const label = polarityOf(r);
    sentiment[label] = (sentiment[label] ?? 0) + 1;
  }
  return {
    total: reviews.length,
    averageRating: avg,
    sentiment,
    withText: reviews.filter((r) => reviewText(r)).length,
  };
}

function buildSummary(month, stats, painThemes, praiseThemes) {
  const parts = [];
  parts.push(
    `In ${month}, ${stats.total} review(s) were analyzed` +
      (stats.averageRating != null ? ` (avg ${stats.averageRating}★).` : '.')
  );
  parts.push(
    `${stats.sentiment.negative} leaned negative, ${stats.sentiment.positive} positive.`
  );
  const topPain = painThemes.filter((p) => p.severity !== 'low').slice(0, 3);
  if (topPain.length) {
    parts.push(
      `Biggest pain points: ${topPain
        .map((p) => `${p.theme} (${p.frequency}×${p.trend === 'up' ? ', rising' : p.trend === 'new' ? ', new' : ''})`)
        .join(', ')}.`
    );
  }
  if (praiseThemes.length) {
    parts.push(`Most appreciated: ${praiseThemes.slice(0, 2).map((p) => p.theme).join(', ')}.`);
  }
  return parts.join(' ');
}

/* ----------------------------------------------------------------------------
 * Skill 7 — refine (optional): an LLM rewrites titles/descriptions and writes a
 * sharper summary + actions, grounded in the deterministic evidence so it can't
 * fabricate counts. Frequencies/severities/trends from the skills are kept.
 * ------------------------------------------------------------------------- */

/** Resolves the desired output language from REPORT_LANGUAGE (default English). */
const LANGUAGE_NAMES = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
};

export function reportLanguage() {
  const raw = (process.env.REPORT_LANGUAGE || 'en').toLowerCase().trim();
  const code = raw.slice(0, 2);
  return { code, name: LANGUAGE_NAMES[code] || process.env.REPORT_LANGUAGE || 'English' };
}

function buildRefineSystem(languageName) {
  const isEnglish = /english/i.test(languageName);
  const translateLine = isEnglish
    ? `Translate any non-English quotes' meaning into ${languageName}.`
    : `Write ALL output in ${languageName}, even when the review evidence/quotes are in another language — translate their meaning into ${languageName}.`;
  // Few-shot style guide modeled on a human-written report. Descriptions are a
  // concrete, comma-separated list of the SPECIFIC symptoms users actually
  // reported — not a generic "this is a major theme" sentence.
  const styleExample = isEnglish
    ? `"App crashes, login fails, FaceID is forgotten, switching devices impossible"`
    : `"App stürzt ab, Login fehlschlägt, FaceID wird vergessen, Gerätewechsel unmöglich"`;
  return `You are a senior product analyst writing a monthly App Store review report. You receive PRE-COMPUTED evidence (theme, complaint count, severity, trend, and example quotes that may be in German or English).
Your job is ONLY to improve the wording — do NOT change any numbers, frequencies, or severities.
Write every "title", "description", "summary", and "suggestedActions" entry in ${languageName}. ${translateLine}

DESCRIPTION STYLE — this is important. For each pain point, the "description" must be a CONCRETE, comma-separated list of the SPECIFIC problems users actually reported in that theme's quotes — short noun/verb phrases, in the users' own framing, NOT a generic summary. Do not write "this is a major theme" or repeat the count. 
Example of the required style: ${styleExample}.
For praise, do the same with what users specifically liked.

For each pain point and praise also write a short "title" (max 5 words) naming the theme.
Then write a 2-3 sentence executive "summary" and up to 5 concrete, actionable "suggestedActions", all in ${languageName}.
Return ONLY a JSON object (keys stay in English, values in ${languageName}):
{"summary": "...", "pain": [{"category": "<id>", "title": "...", "description": "..."}], "praise": [{"category": "<id>", "title": "...", "description": "..."}], "suggestedActions": ["..."]}`;
}

function buildRefineUser(month, painThemes, praiseThemes) {
  const pain = painThemes.map((p) => ({
    category: p.category,
    label: p.theme,
    complaints: p.frequency,
    severity: p.severity,
    trend: p.trend,
    user_quotes: p.quotes || p.examples,
  }));
  const praise = praiseThemes.map((p) => ({
    category: p.category,
    label: p.theme,
    mentions: p.frequency,
    user_quotes: p.quotes || p.examples,
  }));
  return `Month: ${month}\n\nPAIN_POINTS:\n${JSON.stringify(pain, null, 2)}\n\nPRAISE:\n${JSON.stringify(
    praise,
    null,
    2
  )}`;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

async function refineWithLlm(month, painThemes, praiseThemes) {
  const { name: languageName } = reportLanguage();
  const content = await llmComplete({
    system: buildRefineSystem(languageName),
    user: buildRefineUser(month, painThemes, praiseThemes),
    json: true,
  });
  const parsed = safeParseJson(content);
  if (!parsed) return null;

  const byCat = (arr) => new Map((arr || []).map((x) => [x.category, x]));
  const painMap = byCat(parsed.pain);
  const praiseMap = byCat(parsed.praise);

  const pain = painThemes.map((p) => {
    const r = painMap.get(p.category);
    return r ? { ...p, theme: r.title || p.theme, description: r.description || p.description } : p;
  });
  const praise = praiseThemes.map((p) => {
    const r = praiseMap.get(p.category);
    return r ? { ...p, theme: r.title || p.theme, description: r.description || p.description } : p;
  });

  return {
    summary: parsed.summary || null,
    pain,
    praise,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : null,
  };
}

/* ----------------------------------------------------------------------------
 * Orchestrator
 * ------------------------------------------------------------------------- */

/**
 * Runs the full review-analysis pipeline.
 *
 * @param {object}  opts
 * @param {string}  opts.month            "YYYY-MM".
 * @param {Array}   opts.reviews          Reviews for the month.
 * @param {Array}   [opts.previousReviews] Previous month's reviews (for trends).
 * @param {boolean} [opts.useLlm]         Allow the LLM refine skill (default: auto).
 * @returns enriched report (backward compatible with the old shape).
 */
export async function analyzeReviews({ month, reviews, previousReviews = [], useLlm } = {}) {
  const stats = computeStats(reviews);
  const skillsRun = ['classify', 'cluster', 'score', 'trend', 'quote', 'recommend'];

  if (!reviews.length) {
    return {
      month,
      source: 'empty',
      stats,
      summary: `No reviews collected for ${month} yet.`,
      painPoints: [],
      praises: [],
      suggestedActions: [],
      categories: [],
      agent: { skills: skillsRun, llm: false },
    };
  }

  const classified = classify(reviews);
  const prevClassified = classify(previousReviews);

  let painThemes = clusterPain(classified, prevClassified);
  let praiseThemes = clusterPraise(classified);
  let summary = buildSummary(month, stats, painThemes, praiseThemes);
  let suggestedActions = recommend(painThemes);
  let source = 'agent';
  let llmUsed = false;
  let note;

  const wantLlm = useLlm ?? llmConfigured();
  if (wantLlm && (painThemes.length || praiseThemes.length)) {
    try {
      const refined = await refineWithLlm(month, painThemes, praiseThemes);
      if (refined) {
        painThemes = refined.pain;
        praiseThemes = refined.praise;
        if (refined.summary) summary = refined.summary;
        if (refined.suggestedActions) suggestedActions = refined.suggestedActions;
        source = 'agent+llm';
        llmUsed = true;
        skillsRun.push('refine');
      }
    } catch (err) {
      note = `LLM refine unavailable, used deterministic analysis (${err.message}).`;
    }
  }

  // Category breakdown for the UI (top pain categories by complaint count).
  const categories = painThemes.map((p) => ({
    category: p.category,
    label: p.theme,
    frequency: p.frequency,
    severity: p.severity,
    trend: p.trend,
  }));

  const report = {
    month,
    source,
    stats,
    summary,
    painPoints: painThemes.slice(0, 6).map(stripInternal),
    praises: praiseThemes.slice(0, 6).map(stripInternal),
    suggestedActions,
    categories,
    agent: { skills: skillsRun, llm: llmUsed, language: reportLanguage().code },
  };
  if (note) report.note = note;
  return report;
}

/** Removes internal-only fields (e.g. the extra LLM quote pool) from output. */
function stripInternal(theme) {
  const { quotes, score, ...rest } = theme;
  return rest;
}
