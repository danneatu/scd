/**
 * Lightweight, dependency-free sentiment analysis for short review text.
 *
 * Uses a compact AFINN-style lexicon (words scored from -5 to +5) plus simple
 * negation handling. This is heuristic, not ML — good enough to summarize the
 * overall mood of a batch of App Store reviews without external services.
 */

// A curated subset of AFINN-style sentiment weights, tuned for app reviews.
const LEXICON = {
  // Strong positive
  amazing: 4, awesome: 4, excellent: 4, fantastic: 4, perfect: 4, love: 3, loved: 3,
  loves: 3, brilliant: 4, outstanding: 4, superb: 4, wonderful: 4, incredible: 4,
  // Positive
  good: 2, great: 3, nice: 2, helpful: 2, useful: 2, easy: 2, smooth: 2, fast: 2,
  clean: 1, intuitive: 2, reliable: 2, beautiful: 2, like: 1, likes: 1, liked: 1,
  best: 3, happy: 3, glad: 2, recommend: 2, recommended: 2, impressed: 2, enjoy: 2,
  enjoyed: 2, enjoys: 2, works: 1, working: 1, solid: 2, convenient: 2, simple: 1,
  polished: 2, stable: 2, responsive: 2, delightful: 3, pleasant: 2, gem: 3,
  // Negative
  bad: -2, poor: -2, slow: -2, buggy: -3, bug: -2, bugs: -2, broken: -3, crash: -3,
  crashes: -3, crashing: -3, crashed: -3, freeze: -2, freezes: -2, frozen: -2,
  glitch: -2, glitchy: -2, laggy: -2, lag: -2, annoying: -2, confusing: -2,
  difficult: -2, hard: -1, disappointed: -3, disappointing: -3, useless: -3,
  waste: -3, terrible: -4, horrible: -4, awful: -4, worst: -4, hate: -3, hated: -3,
  dislike: -2, fail: -2, fails: -2, failed: -2, failure: -3, error: -2, errors: -2,
  unusable: -3, frustrating: -3, frustrated: -3, garbage: -3, junk: -3, scam: -4,
  expensive: -1, overpriced: -2, ads: -1, spam: -2, unreliable: -2, stuck: -2,
  missing: -1, problem: -2, problems: -2, issue: -1, issues: -1, nightmare: -3,
};

// Negators flip the sentiment of the following scored word.
const NEGATORS = new Set(['not', 'no', 'never', 'cant', 'cannot', 'dont', 'doesnt', 'wont', 'isnt', 'without', 'hardly', 'barely']);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/n['’]t\b/g, ' not') // don't -> do not
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Scores a single piece of text. Returns a comparative score normalized by the
 * number of scored tokens, plus a label.
 */
export function scoreText(text) {
  const tokens = tokenize(text);
  let score = 0;
  let hits = 0;
  let negate = false;

  for (const token of tokens) {
    if (NEGATORS.has(token)) {
      negate = true;
      continue;
    }
    const weight = LEXICON[token];
    if (weight != null) {
      score += negate ? -weight : weight;
      hits += 1;
    }
    negate = false;
  }

  const comparative = hits ? score / hits : 0;
  let label = 'neutral';
  if (score > 0) label = 'positive';
  else if (score < 0) label = 'negative';

  return { score, comparative: Number(comparative.toFixed(2)), label, hits };
}
