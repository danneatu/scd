import { createWorker } from 'tesseract.js';

/**
 * Local OCR for App Store Connect "Ratings" screenshots.
 *
 * Apple exposes no per-star breakdown via any API, so the only way to capture
 * the 5★…1★ segmentation automatically is to read it off a screenshot of the
 * App Store Connect ratings popover. This runs fully locally (Tesseract / WASM)
 * — the image never leaves the machine. Results are always confirmed by the
 * user in the form before being saved, so OCR only needs to get close.
 */

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng').then(async (worker) => {
      // PSM 6 = assume a single uniform block of text. The ASC ratings popover
      // is a small two-column block (stars | counts); the default automatic
      // segmentation tends to split the columns and mis-order or drop cells,
      // and can misread the star glyphs as digits. A single-block read keeps
      // each row together and far cleaner.
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
      } catch {
        /* older tesseract.js — ignore and use defaults */
      }
      return worker;
    });
  }
  return workerPromise;
}

/** Decodes a data URL or raw base64 string into a Buffer. */
function toBuffer(image) {
  if (Buffer.isBuffer(image)) return image;
  const str = String(image || '');
  const comma = str.indexOf(',');
  const b64 = str.startsWith('data:') && comma >= 0 ? str.slice(comma + 1) : str;
  return Buffer.from(b64, 'base64');
}

/**
 * Extracts integer tokens (handling thousands separators) in reading order.
 * "21,215" -> 21215, "1.243" -> 1243.
 */
function extractNumbers(text) {
  const out = [];
  const re = /\d[\d.,]*\d|\d/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[0].replace(/[.,\s]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * Parses OCR text from an ASC ratings popover into a star distribution.
 *
 * The popover reads top-to-bottom as:  total "Ratings", then 5★,4★,3★,2★,1★.
 * Returns { distribution:{1..5}, totalRatings, averageRating, confident }.
 */
export function parseRatingsText(text) {
  const nums = extractNumbers(text);
  const result = {
    distribution: null,
    totalRatings: null,
    averageRating: null,
    confident: false,
    detectedNumbers: nums,
  };
  if (nums.length < 5) return result;

  let total = null;
  let five = null;

  const sum5 = (arr) => arr.reduce((s, n) => s + n, 0);
  const tolOf = (v) => Math.max(2, Math.round(v * 0.01));

  // Best case: a number immediately followed by five numbers that sum to it.
  // Scanning every position (not just the first number) means stray OCR noise
  // before the total — a misread star glyph, the "?" help icon, the word
  // "Ratings" — can't shift the star rows out of alignment.
  for (let i = 0; i + 5 < nums.length; i += 1) {
    const head = nums[i];
    const next5 = nums.slice(i + 1, i + 6);
    if (Math.abs(head - sum5(next5)) <= tolOf(head)) {
      total = head;
      five = next5;
      result.confident = true;
      break;
    }
  }

  // Next: any five consecutive numbers whose sum matches another detected
  // number elsewhere (handles a total that trails the rows).
  if (!five) {
    for (let i = 0; i + 5 <= nums.length; i += 1) {
      const window = nums.slice(i, i + 5);
      const s = sum5(window);
      const hasTotal = nums.some((n, j) => (j < i || j >= i + 5) && Math.abs(n - s) <= tolOf(s));
      if (hasTotal) {
        five = window;
        total = s;
        result.confident = true;
        break;
      }
    }
  }

  // Exactly five numbers: treat them as 5★…1★ and derive the total.
  // Can't cross-check against a stated total, so leave confidence low.
  if (!five && nums.length === 5) {
    five = nums.slice(0, 5);
    total = sum5(five);
    result.confident = false;
  }

  // Fallback: assume the largest value is the total, take the five numbers
  // that follow it (in reading order) as 5★…1★.
  if (!five && nums.length >= 6) {
    const maxIdx = nums.indexOf(Math.max(...nums));
    const rest = nums.slice(0, maxIdx).concat(nums.slice(maxIdx + 1));
    five = rest.slice(0, 5);
    total = nums[maxIdx];
  }

  if (!five || five.length < 5) return result;

  const distribution = { 5: five[0], 4: five[1], 3: five[2], 2: five[3], 1: five[4] };
  let weighted = 0;
  let count = 0;
  for (let star = 1; star <= 5; star += 1) {
    weighted += star * distribution[star];
    count += distribution[star];
  }
  result.distribution = distribution;
  result.totalRatings = total ?? count;
  result.averageRating = count > 0 ? Number((weighted / count).toFixed(2)) : null;
  return result;
}

/**
 * Runs OCR on an image (data URL / base64 / Buffer) and parses the star
 * breakdown. Returns the parsed result plus the raw recognized text.
 */
export async function ocrRatingsImage(image) {
  const buffer = toBuffer(image);
  if (!buffer.length) {
    const err = new Error('Empty or invalid image.');
    err.status = 400;
    throw err;
  }
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  const text = data?.text || '';
  const parsed = parseRatingsText(text);
  return { ...parsed, rawText: text.trim() };
}
