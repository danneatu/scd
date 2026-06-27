import { scoreText } from './sentiment.js';

// Common English words to ignore when computing keyword frequency.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'his', 'has', 'how', 'man', 'new', 'now',
  'old', 'see', 'two', 'way', 'who', 'did', 'its', 'let', 'put', 'say', 'she',
  'too', 'use', 'this', 'that', 'with', 'have', 'from', 'they', 'will', 'your',
  'what', 'when', 'were', 'been', 'them', 'then', 'than', 'some', 'just', 'into',
  'only', 'more', 'most', 'such', 'very', 'also', 'much', 'even', 'back', 'after',
  'app', 'apps', 'would', 'could', 'should', 'about', 'there', 'their', 'which',
  'because', 'really', 'still', 'every', 'while', 'thing', 'things', 'get', 'got',
  'dont', 'doesnt', 'cant', 'ive', 'im', 'its', 'was', 'has', 'had',
]);

/**
 * Builds a list of the most frequent meaningful words across all review text.
 */
function computeKeywords(reviews, limit = 30) {
  const counts = new Map();
  for (const r of reviews) {
    const text = `${r.title || ''} ${r.body || ''}`
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ');
    for (const word of text.split(/\s+/)) {
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Aggregates sentiment across all reviews, returning a label breakdown and a
 * mood score per star rating.
 */
function computeSentiment(reviews) {
  const breakdown = { positive: 0, neutral: 0, negative: 0 };
  let comparativeSum = 0;
  let scored = 0;

  for (const r of reviews) {
    const text = `${r.title || ''} ${r.body || ''}`.trim();
    if (!text) {
      breakdown.neutral += 1;
      continue;
    }
    const { label, comparative } = scoreText(text);
    breakdown[label] += 1;
    comparativeSum += comparative;
    scored += 1;
  }

  return {
    breakdown,
    averageComparative: scored ? Number((comparativeSum / scored).toFixed(2)) : 0,
  };
}

/**
 * Computes summary statistics over a list of normalized reviews.
 */
export function analyzeReviews(reviews) {
  const total = reviews.length;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  let ratedCount = 0;

  // Reviews grouped by YYYY-MM for a trend view.
  const byMonth = new Map();
  // Reviews grouped by YYYY-MM-DD for a day-by-day trend view.
  const byDay = new Map();
  const byTerritory = new Map();

  let oldest = null;
  let newest = null;

  for (const r of reviews) {
    if (typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5) {
      distribution[r.rating] += 1;
      ratingSum += r.rating;
      ratedCount += 1;
    }

    if (r.createdDate) {
      const date = new Date(r.createdDate);
      if (!Number.isNaN(date.getTime())) {
        const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        const bucket = byMonth.get(monthKey) ?? { month: monthKey, count: 0, ratingSum: 0, rated: 0 };
        bucket.count += 1;
        if (typeof r.rating === 'number') {
          bucket.ratingSum += r.rating;
          bucket.rated += 1;
        }
        byMonth.set(monthKey, bucket);

        const dayKey = `${monthKey}-${String(date.getUTCDate()).padStart(2, '0')}`;
        const dayBucket = byDay.get(dayKey) ?? {
          day: dayKey,
          count: 0,
          ratingSum: 0,
          rated: 0,
          distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        };
        dayBucket.count += 1;
        if (typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5) {
          dayBucket.ratingSum += r.rating;
          dayBucket.rated += 1;
          dayBucket.distribution[r.rating] += 1;
        }
        byDay.set(dayKey, dayBucket);

        if (!oldest || date < new Date(oldest)) oldest = r.createdDate;
        if (!newest || date > new Date(newest)) newest = r.createdDate;
      }
    }

    if (r.territory) {
      byTerritory.set(r.territory, (byTerritory.get(r.territory) ?? 0) + 1);
    }
  }

  const monthly = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      count: m.count,
      averageRating: m.rated ? Number((m.ratingSum / m.rated).toFixed(2)) : null,
    }));

  // Day-by-day trend, with a cumulative (running) average so you can see how the
  // overall rating evolved over time, not just each day's isolated average.
  let cumulativeSum = 0;
  let cumulativeRated = 0;
  const daily = [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => {
      cumulativeSum += d.ratingSum;
      cumulativeRated += d.rated;
      return {
        day: d.day,
        count: d.count,
        averageRating: d.rated ? Number((d.ratingSum / d.rated).toFixed(2)) : null,
        cumulativeAverage: cumulativeRated
          ? Number((cumulativeSum / cumulativeRated).toFixed(2))
          : null,
        distribution: d.distribution,
      };
    });

  const territories = [...byTerritory.entries()]
    .map(([territory, count]) => ({ territory, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    averageRating: ratedCount ? Number((ratingSum / ratedCount).toFixed(2)) : null,
    distribution,
    oldestReviewDate: oldest,
    newestReviewDate: newest,
    monthly,
    daily,
    territories,
    keywords: computeKeywords(reviews),
    sentiment: computeSentiment(reviews),
  };
}
