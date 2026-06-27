import { llmComplete, llmConfigured } from './llm.js';
import { analyzeReviews } from './reviewAgent.js';

/**
 * English + German stopwords (the reviews for this app are bilingual).
 */
const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'his', 'has', 'how', 'man', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'this',
  'that', 'with', 'have', 'from', 'they', 'will', 'your', 'what', 'when', 'were', 'been',
  'them', 'then', 'than', 'some', 'just', 'into', 'only', 'more', 'most', 'such', 'very',
  'also', 'much', 'even', 'back', 'after', 'app', 'apps', 'would', 'could', 'should',
  'about', 'there', 'their', 'which', 'because', 'really', 'still', 'every', 'while',
  'thing', 'things', 'get', 'got', 'dont', 'doesnt', 'cant', 'ive', 'app', 'one',
  // German
  'und', 'oder', 'aber', 'nicht', 'das', 'die', 'der', 'den', 'dem', 'des', 'ein',
  'eine', 'einen', 'einem', 'einer', 'ich', 'wir', 'ihr', 'sie', 'man', 'mit', 'auf',
  'für', 'von', 'zum', 'zur', 'auch', 'noch', 'nur', 'schon', 'wie', 'was', 'wenn',
  'sich', 'mir', 'mich', 'uns', 'euch', 'ist', 'sind', 'war', 'hat', 'habe', 'haben',
  'wird', 'werden', 'kann', 'mehr', 'sehr', 'immer', 'wieder', 'hier', 'dann', 'denn',
  'doch', 'mal', 'geht', 'gibt', 'beim', 'bei', 'aus', 'als', 'dass', 'weil', 'nach',
  'über', 'unter', 'durch', 'gegen', 'ohne', 'diese', 'dieser', 'dieses', 'app',
]);

function reviewText(r) {
  return `${r.title || ''} ${r.body || ''}`.trim();
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Builds keyword themes for a bucket of reviews: top unigrams + bigrams with a
 * representative example quote for each.
 */
function extractThemes(reviews, limit = 5) {
  const counts = new Map();
  const examplesByTerm = new Map();

  for (const r of reviews) {
    const text = reviewText(r);
    const tokens = tokenize(text);
    const seen = new Set();

    const terms = [...tokens];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      terms.push(`${tokens[i]} ${tokens[i + 1]}`);
    }

    for (const term of terms) {
      if (seen.has(term)) continue; // count each term once per review
      seen.add(term);
      counts.set(term, (counts.get(term) ?? 0) + 1);
      if (!examplesByTerm.has(term)) examplesByTerm.set(term, []);
      const list = examplesByTerm.get(term);
      if (list.length < 3 && text) list.push(text);
    }
  }

  // Prefer multi-word themes and de-duplicate overlapping single words.
  const ranked = [...counts.entries()]
    .filter(([term, c]) => c >= 2 || term.includes(' '))
    .sort((a, b) => {
      const aBigram = a[0].includes(' ') ? 1 : 0;
      const bBigram = b[0].includes(' ') ? 1 : 0;
      if (b[1] !== a[1]) return b[1] - a[1];
      return bBigram - aBigram;
    });

  const chosen = [];
  const usedWords = new Set();
  for (const [term, count] of ranked) {
    const words = term.split(' ');
    // Skip any term that reuses a word already represented by a chosen theme,
    // so themes stay distinct (avoids "login", "login probleme", "wochen login").
    if (words.some((w) => usedWords.has(w))) continue;
    words.forEach((w) => usedWords.add(w));
    const examples = (examplesByTerm.get(term) || [])
      .sort((a, b) => a.length - b.length)
      .slice(0, 2)
      .map((t) => (t.length > 180 ? `${t.slice(0, 177)}…` : t));
    chosen.push({ theme: term, frequency: count, examples });
    if (chosen.length >= limit) break;
  }

  return chosen;
}

function computeStats(reviews) {
  const rated = reviews.filter((r) => typeof r.rating === 'number');
  const avg = rated.length
    ? Number((rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2))
    : null;
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const r of reviews) {
    const label = r.sentimentLabel || 'neutral';
    sentiment[label] = (sentiment[label] ?? 0) + 1;
  }
  return { total: reviews.length, averageRating: avg, sentiment, withText: reviews.filter((r) => reviewText(r)).length };
}

/**
 * Heuristic report: split by rating/sentiment, cluster by keyword themes.
 */
function heuristicReport(month, reviews) {
  const stats = computeStats(reviews);
  const withText = reviews.filter((r) => reviewText(r));

  const negative = withText.filter((r) => (r.rating != null && r.rating <= 2) || r.sentimentLabel === 'negative');
  const positive = withText.filter((r) => (r.rating != null && r.rating >= 4) || r.sentimentLabel === 'positive');

  const painPoints = extractThemes(negative).map((t) => ({ ...t, type: 'pain' }));
  const praises = extractThemes(positive).map((t) => ({ ...t, type: 'praise' }));

  const summary =
    `In ${month}, ${stats.total} review(s) were collected ` +
    (stats.averageRating != null ? `with an average rating of ${stats.averageRating}★. ` : '. ') +
    `${negative.length} leaned negative and ${positive.length} leaned positive. ` +
    (painPoints.length ? `Top complaint themes: ${painPoints.map((p) => p.theme).join(', ')}. ` : '') +
    (praises.length ? `Most appreciated: ${praises.map((p) => p.theme).join(', ')}.` : '');

  return { month, source: 'heuristic', stats, summary, painPoints, praises };
}

/**
 * Builds the prompt payload for the LLM, sampling reviews to stay within budget.
 */
function buildLlmUserContent(month, reviews) {
  const withText = reviews.filter((r) => reviewText(r));
  // Cap to keep the request small; prioritize most recent.
  const sample = withText.slice(0, 150);
  const lines = sample.map((r, i) => {
    const date = r.createdDate ? r.createdDate.slice(0, 10) : '????';
    return `${i + 1}. [${r.rating ?? '?'}★ ${date} ${r.territory || ''}] ${reviewText(r).replace(/\s+/g, ' ')}`;
  });
  return (
    `App customer reviews for ${month} (${withText.length} written reviews, showing ${sample.length}):\n\n` +
    lines.join('\n')
  );
}

const LLM_SYSTEM = `You are a product analyst. You read App Store customer reviews (which may be in multiple languages, e.g. English and German) and summarize them for a product team.
Identify the most common, impactful PAIN POINTS (what annoys/frustrates users) and the strongest PRAISES (what users love).
Group similar feedback into themes. Translate non-English themes/quotes into concise English. Be specific and actionable.
Return ONLY a JSON object with this exact shape:
{
  "summary": "2-3 sentence executive summary",
  "painPoints": [{"theme": "short title", "description": "1 sentence", "frequency": <approx count>, "severity": "high|medium|low", "examples": ["short quote", "..."]}],
  "praises": [{"theme": "short title", "description": "1 sentence", "frequency": <approx count>, "examples": ["short quote", "..."]}],
  "suggestedActions": ["actionable item", "..."]
}
List at most 6 pain points and 6 praises, ordered by importance.`;

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/**
 * Generates a monthly insights report. Delegates to the skill-based review
 * agent (deterministic skills + optional LLM refinement). Kept here as the
 * stable entry point used by the API; the agent owns the analysis logic.
 *
 * @param {object} options
 * @param {string} options.month             "YYYY-MM".
 * @param {Array}  options.reviews           Reviews for that month (from the DB).
 * @param {Array}  [options.previousReviews] Previous month's reviews (for trends).
 */
export async function generateMonthlyReport({ month, reviews, previousReviews = [] }) {
  return analyzeReviews({ month, reviews, previousReviews });
}
