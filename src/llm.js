/**
 * Minimal multi-provider LLM client using `fetch` only (no SDK dependencies).
 *
 * Supports several FREE providers so you can get richer summaries without
 * paying. Most are OpenAI-compatible and share one code path; Google Gemini
 * has a native path; Ollama runs fully local and needs no key.
 *
 *   Provider     Cost            Get a key
 *   ----------   -------------   --------------------------------------------
 *   groq         Free            https://console.groq.com/keys        (fast!)
 *   google       Free tier       https://aistudio.google.com/apikey
 *   openrouter   Free models     https://openrouter.ai/keys  (use a :free model)
 *   mistral      Free tier       https://console.mistral.ai/api-keys
 *   cerebras     Free            https://cloud.cerebras.ai
 *   ollama       Free (local)    install https://ollama.com, no key needed
 *   openai       Paid            https://platform.openai.com/api-keys
 *   anthropic    Paid            https://console.anthropic.com
 *
 * Configure via .env:
 *   LLM_PROVIDER=groq
 *   LLM_API_KEY=gsk_...
 *   LLM_MODEL=llama-3.3-70b-versatile   # optional (sensible default per provider)
 *   LLM_BASE_URL=...                    # optional override for any OpenAI-compatible host
 */

/**
 * OpenAI-compatible providers: base URL + default model. Adding a new
 * OpenAI-compatible host is just one entry here.
 */
const OPENAI_COMPATIBLE = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', free: false },
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', free: true },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    free: true,
  },
  mistral: { baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', free: true },
  cerebras: { baseURL: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', free: true },
  together: {
    baseURL: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    free: true,
  },
  ollama: { baseURL: 'http://localhost:11434/v1', model: 'llama3.1', free: true, noKey: true },
};

const NATIVE = {
  anthropic: { model: 'claude-3-5-sonnet-latest', free: false },
  google: { model: 'gemini-2.0-flash', free: true },
  gemini: { model: 'gemini-2.0-flash', free: true }, // alias for "google"
};

function providerId() {
  return (process.env.LLM_PROVIDER || '').toLowerCase().trim();
}

function providerSpec(provider) {
  if (OPENAI_COMPATIBLE[provider]) return { kind: 'openai', ...OPENAI_COMPATIBLE[provider] };
  if (provider === 'anthropic') return { kind: 'anthropic', ...NATIVE.anthropic };
  if (provider === 'google' || provider === 'gemini') return { kind: 'google', ...NATIVE.google };
  return null;
}

function defaultModel(provider = providerId()) {
  return providerSpec(provider)?.model ?? null;
}

/** True when a usable provider is configured (Ollama needs no API key). */
export function llmConfigured() {
  const provider = providerId();
  const spec = providerSpec(provider);
  if (!spec) return false;
  if (spec.noKey) return true;
  return Boolean(process.env.LLM_API_KEY);
}

export function llmInfo() {
  const provider = providerId();
  const spec = providerSpec(provider);
  return {
    configured: llmConfigured(),
    provider: provider || null,
    model: process.env.LLM_MODEL || defaultModel(provider),
    free: spec?.free ?? null,
  };
}

/**
 * Sends a chat-style request and returns the raw text content.
 * @param {object} options
 * @param {string} options.system  System / instruction prompt.
 * @param {string} options.user    User content.
 * @param {boolean} [options.json] Request a JSON object response when supported.
 */
export async function llmComplete({ system, user, json = false }) {
  const provider = providerId();
  const spec = providerSpec(provider);
  if (!spec) {
    throw new Error(
      `Unknown LLM_PROVIDER "${provider}". Use one of: ${[
        ...Object.keys(OPENAI_COMPATIBLE),
        'anthropic',
        'google',
      ].join(', ')}.`
    );
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!spec.noKey && !apiKey) {
    throw new Error(`LLM not configured (set LLM_API_KEY for provider "${provider}").`);
  }
  const model = process.env.LLM_MODEL || spec.model;

  if (spec.kind === 'openai') {
    const baseURL = process.env.LLM_BASE_URL || spec.baseURL;
    return openaiCompatibleComplete({ baseURL, apiKey, model, system, user, json, provider });
  }
  if (spec.kind === 'anthropic') {
    return anthropicComplete({ apiKey, model, system, user, json });
  }
  if (spec.kind === 'google') {
    return googleComplete({ apiKey, model, system, user, json });
  }
  throw new Error(`Unsupported provider kind for "${provider}".`);
}

/** Shared path for any OpenAI-compatible Chat Completions API. */
async function openaiCompatibleComplete({ baseURL, apiKey, model, system, user, json, provider }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // OpenRouter asks for these (optional, but recommended).
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost';
    headers['X-Title'] = 'App Ratings Analyzer';
  }

  const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`${provider} error ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function anthropicComplete({ apiKey, model, system, user, json }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.2,
      system: json ? `${system}\n\nRespond with a single valid JSON object and nothing else.` : system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  return data.content?.map((c) => c.text).join('') ?? '';
}

/** Native Google Gemini (generativelanguage) API — generous free tier. */
async function googleComplete({ apiKey, model, system, user, json }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Gemini error ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}
