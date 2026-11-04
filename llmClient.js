'use strict';

const crypto = require('crypto');
const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core:llm');

// How long a provider's model list is trusted before it is fetched again.
const MODEL_LIST_TTL_MS = 24 * 60 * 60 * 1000;

// Used when `model` is not set and the provider is Anthropic.
const DEFAULT_ANTHROPIC_FAMILY = 'sonnet';

// Default output ceiling for Anthropic. Current Claude models think by
// default and thinking tokens count toward max_tokens, so 4096 can run out
// before the reply is written.
const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000;

// Tokens that never narrow a family: "-latest" aliases.
const IGNORED_TOKENS = new Set(['latest', 'models']);

// Models in /models lists that can't do chat. Skipped unless the family
// keyword asks for them by name.
const NON_CHAT_TOKENS = new Set([
  'embedding',
  'embed',
  'tts',
  'whisper',
  'audio',
  'realtime',
  'transcribe',
  'image',
  'dall',
  'moderation',
  'davinci',
  'babbage',
]);

/**
 * Detect provider from config.
 * @param {object} config
 * @returns {'anthropic'|'openai'}
 */
const detectProvider = (config) => {
  if (config.provider) return config.provider;
  if (config.apiBaseUrl && config.apiBaseUrl.includes('anthropic.com')) return 'anthropic';
  return 'openai';
};

/**
 * Split a model ID into lowercase tokens, e.g.
 * "claude-sonnet-4-20250514" -> ["claude", "sonnet", "4", "20250514"].
 * Gemini's "models/" prefix is dropped.
 */
const tokenize = (id) => String(id || '')
    .toLowerCase()
    .replace(/^models\//, '')
    .split(/[-/:_\s]+/)
    .filter(Boolean);

const isVersionToken = (t) => /^\d/.test(t);

/**
 * The words that name a model's family: everything that isn't a version,
 * date or "latest". "claude-sonnet-4-20250514" -> ["claude", "sonnet"],
 * "gemini-2.5-flash" -> ["gemini", "flash"], "sonnet" -> ["sonnet"].
 */
const familyTokens = (id) => tokenize(id)
    .filter((t) => !isVersionToken(t) && !IGNORED_TOKENS.has(t));

/**
 * A family keyword is a model setting with no digits in it ("sonnet",
 * "opus", "gpt-sol", "gemini-flash"). Anything with a digit is treated as an
 * exact model ID and sent as-is.
 */
const isFamilyKeyword = (model) => typeof model === 'string' && model.trim() !== '' &&
    !/\d/.test(model);

const versionTuple = (id) => {
  const nums = [];
  for (const t of tokenize(id)) {
    if (!isVersionToken(t)) continue;
    // Skip dates (20250514) so a dated snapshot doesn't beat a newer version.
    if (/^\d{8}$/.test(t)) continue;
    for (const part of t.split('.')) {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n)) nums.push(n);
    }
  }
  return nums;
};

const compareTuplesDesc = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return y - x;
  }
  return 0;
};

/**
 * Pick the newest model whose ID contains every family token.
 * Ranking: fewest extra family words first (so "gpt" prefers "gpt-6" over
 * "gpt-6-mini"), then newest by creation time, then highest version number,
 * then the provider's own list order.
 *
 * @param {Array<{id: string, created: number|null}>} models
 * @param {string[]} wanted - family tokens
 * @param {string} [exclude] - an ID to skip (the one that just 404'd)
 * @returns {string|null}
 */
const pickNewest = (models, wanted, exclude) => {
  const wantedSet = new Set(wanted);
  const candidates = [];
  models.forEach((m, index) => {
    if (!m.id || m.id === exclude) return;
    const fam = familyTokens(m.id);
    const famSet = new Set(fam);
    if (!wanted.every((t) => famSet.has(t))) return;
    if (fam.some((t) => NON_CHAT_TOKENS.has(t) && !wantedSet.has(t))) return;
    const extras = fam.filter((t) => !wantedSet.has(t)).length;
    candidates.push({id: m.id, created: m.created, extras, index});
  });
  candidates.sort((a, b) => {
    if (a.extras !== b.extras) return a.extras - b.extras;
    if (a.created != null && b.created != null && a.created !== b.created) {
      return b.created - a.created;
    }
    const v = compareTuplesDesc(versionTuple(a.id), versionTuple(b.id));
    if (v !== 0) return v;
    return a.index - b.index;
  });
  return candidates.length ? candidates[0].id : null;
};

const parseErrorBody = (text) => {
  try {
    const json = JSON.parse(text);
    return {
      message: json.error?.message || text,
      code: json.error?.code || json.error?.type || null,
    };
  } catch {
    return {message: text, code: null};
  }
};

const apiError = async (response) => {
  const text = await response.text();
  const {message, code} = parseErrorBody(text);
  const err = new Error(`LLM API error ${response.status}: ${message}`);
  err.status = response.status;
  err.code = code;
  return err;
};

const isModelNotFound = (err) => err && (err.status === 404 || err.code === 'model_not_found');

// ---------------------------------------------------------------------------
// Model list (GET /models), cached per endpoint + key.

const modelListCache = new Map(); // cacheKey -> {at, models} or {promise}

const cacheKeyFor = (provider, baseUrl, apiKey) => {
  const keyHash = crypto.createHash('sha256').update(String(apiKey || '')).digest('hex');
  return `${provider}|${baseUrl}|${keyHash.slice(0, 16)}`;
};

const fetchAnthropicModels = async (baseUrl, apiKey) => {
  const models = [];
  let afterId = null;
  // The Models API pages its results; follow it until has_more is false.
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({limit: '1000'});
    if (afterId) qs.set('after_id', afterId);
    const response = await fetch(`${baseUrl}/models?${qs}`, {
      headers: {'x-api-key': apiKey, 'anthropic-version': '2023-06-01'},
    });
    if (!response.ok) throw await apiError(response);
    const data = await response.json();
    for (const m of data.data || []) {
      const created = m.created_at ? Date.parse(m.created_at) : NaN;
      models.push({id: m.id, created: Number.isNaN(created) ? null : created});
    }
    if (!data.has_more || !data.last_id) break;
    afterId = data.last_id;
  }
  return models;
};

const fetchOpenAIModels = async (baseUrl, apiKey) => {
  const response = await fetch(`${baseUrl}/models`, {
    headers: {Authorization: `Bearer ${apiKey}`},
  });
  if (!response.ok) throw await apiError(response);
  const data = await response.json();
  const list = Array.isArray(data) ? data : (data.data || data.models || []);
  return list.map((m) => ({
    id: String(m.id || m.name || '').replace(/^models\//, ''),
    created: typeof m.created === 'number' ? m.created * 1000 : null,
  }));
};

/**
 * Fetch (or reuse) the provider's model list.
 * @param {{provider: string, baseUrl: string, apiKey: string}} target
 * @param {{refresh?: boolean}} [opts]
 */
const listModels = async ({provider, baseUrl, apiKey}, opts = {}) => {
  const key = cacheKeyFor(provider, baseUrl, apiKey);
  const cached = modelListCache.get(key);
  if (cached && !opts.refresh) {
    if (cached.promise) return cached.promise;
    if (Date.now() - cached.at < MODEL_LIST_TTL_MS) return cached.models;
  }
  const promise = (provider === 'anthropic'
    ? fetchAnthropicModels(baseUrl, apiKey)
    : fetchOpenAIModels(baseUrl, apiKey));
  modelListCache.set(key, {promise});
  try {
    const models = await promise;
    modelListCache.set(key, {at: Date.now(), models});
    logger.debug(`Fetched ${models.length} models from ${baseUrl}`);
    return models;
  } catch (err) {
    modelListCache.delete(key);
    throw err;
  }
};

// configured model -> resolved ID, per endpoint. Lets a 404 fallback stick
// so we don't hit the dead ID on every request.
const resolvedCache = new Map(); // `${cacheKey}|${model}` -> {at, id}
const warnedOnce = new Set();

const warnOnce = (key, msg) => {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  logger.warn(msg);
};

/**
 * Turn the configured `model` into a concrete model ID.
 * - exact IDs (anything with a digit) are returned unchanged;
 * - family keywords ("sonnet") resolve to the newest matching ID;
 * - an unset model resolves to "sonnet" on Anthropic, or the newest chat
 *   model the endpoint lists elsewhere.
 */
const resolveModel = async (target, model) => {
  const configured = typeof model === 'string' ? model.trim() : '';
  const ckey = `${cacheKeyFor(target.provider, target.baseUrl, target.apiKey)}|${configured}`;
  // Also holds the substitute for an exact ID that 404'd earlier.
  const hit = resolvedCache.get(ckey);
  if (hit && Date.now() - hit.at < MODEL_LIST_TTL_MS) return hit.id;
  if (configured && !isFamilyKeyword(configured)) return configured;

  let family = configured;
  if (!family) {
    if (target.provider === 'anthropic') {
      family = DEFAULT_ANTHROPIC_FAMILY;
      warnOnce(`unset|${target.baseUrl}`,
          `ep_ai_core.model is not set; using the newest "${family}" model. ` +
          'Set "model" in settings.json to choose one.');
    } else {
      warnOnce(`unset|${target.baseUrl}`,
          'ep_ai_core.model is not set; using the newest model listed by ' +
          `${target.baseUrl}/models. Set "model" in settings.json to choose one.`);
    }
  }

  // Some real IDs have no digits ("deepseek-chat", "mistral-large-latest").
  // If the keyword can't be resolved, send it as configured rather than fail.
  const useAsConfigured = (why) => {
    if (!configured) {
      throw new Error(`ep_ai_core.model is not set and ${why}. ` +
          'Set ep_ai_core.model in settings.json.');
    }
    warnOnce(`unresolved|${ckey}`,
        `Could not resolve model "${configured}" as a family keyword (${why}); ` +
        'sending it as an exact model ID.');
    resolvedCache.set(ckey, {at: Date.now(), id: configured});
    return configured;
  };

  let models;
  try {
    models = await listModels(target);
  } catch (err) {
    return useAsConfigured(`listing ${target.baseUrl}/models failed: ${err.message}`);
  }
  // A keyword that happens to be a real ID (e.g. "mistral-large-latest") wins.
  const exact = family && models.find((m) => m.id === family);
  const id = exact ? exact.id : pickNewest(models, familyTokens(family));
  if (!id) return useAsConfigured(`no match at ${target.baseUrl}/models`);
  if (!resolvedCache.has(ckey) || resolvedCache.get(ckey).id !== id) {
    logger.info(`Model "${family || '(unset)'}" resolved to "${id}"`);
  }
  resolvedCache.set(ckey, {at: Date.now(), id});
  return id;
};

/**
 * After a 404 on `failedId`, find the newest model in the same family.
 * Refreshes the model list, since the cached one may predate the retirement.
 */
const fallbackModel = async (target, failedId) => {
  const fam = familyTokens(failedId);
  if (!fam.length) return null;
  const models = await listModels(target, {refresh: true});
  return pickNewest(models, fam, failedId);
};

// ---------------------------------------------------------------------------
// Completion requests.

/**
 * Send a request to the Anthropic Messages API.
 */
const completeAnthropic = async (baseUrl, apiKey, model, messages, maxTokens) => {
  const url = `${baseUrl}/messages`;

  // Anthropic separates system prompt from messages
  let system;
  const userMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      system = system ? `${system}\n\n${msg.content}` : msg.content;
    } else {
      userMessages.push({role: msg.role, content: msg.content});
    }
  }

  const body = {
    model,
    max_tokens: maxTokens || DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages: userMessages,
  };
  if (system) body.system = system;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw await apiError(response);

  const data = await response.json();
  if (data.stop_reason === 'refusal') {
    const category = data.stop_details?.category;
    throw new Error(`LLM declined the request (refusal${category ? `: ${category}` : ''})`);
  }
  // Anthropic returns content as array of blocks; newer models may put
  // thinking blocks first, so read by type, not position.
  const content = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  if (data.stop_reason === 'max_tokens') {
    logger.warn(`LLM response hit max_tokens (${body.max_tokens})` +
        `${content ? '' : ' before writing any text'}; raise ep_ai_core.maxTokens`);
  }
  const usage = data.usage
    ? {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      }
    : {};

  return {content, usage};
};

/**
 * Send a request to an OpenAI-compatible chat completions API.
 */
const completeOpenAI = async (baseUrl, apiKey, model, messages, maxTokens) => {
  const url = `${baseUrl}/chat/completions`;

  const body = {model, messages};
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw await apiError(response);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  return {content, usage};
};

/**
 * Create an LLM client. Supports both OpenAI-compatible and Anthropic APIs.
 *
 * @param {object} config
 * @param {string} config.apiBaseUrl - e.g. "https://api.anthropic.com/v1" or
 *   "http://localhost:11434/v1"
 * @param {string} config.apiKey
 * @param {string} [config.model] - a family keyword such as "sonnet", "opus"
 *   or "haiku" (resolved to the newest matching ID through GET /models), or
 *   an exact ID such as "claude-sonnet-5-5". If an exact ID returns 404 the
 *   client logs a warning and retries with the newest model in its family.
 * @param {number} [config.maxTokens]
 * @param {string} [config.provider] - "anthropic" or "openai" (auto-detected from URL if omitted)
 * @returns {{complete: function, resolveModel: function}}
 */
const create = (config) => {
  const {apiBaseUrl, apiKey, model, maxTokens: defaultMaxTokens} = config;
  const baseUrl = apiBaseUrl.replace(/\/+$/, '');
  const provider = detectProvider(config);
  const target = {provider, baseUrl, apiKey};
  const send = provider === 'anthropic' ? completeAnthropic : completeOpenAI;

  const complete = async (messages, options = {}) => {
    const maxTokens = options.maxTokens || defaultMaxTokens;
    const modelId = await resolveModel(target, model);
    logger.debug(`LLM request: ${messages.length} messages, model=${modelId}, ` +
        `provider=${provider}`);

    let result;
    try {
      result = await send(baseUrl, apiKey, modelId, messages, maxTokens);
    } catch (err) {
      if (!isModelNotFound(err)) throw err;
      let replacement = null;
      try {
        replacement = await fallbackModel(target, modelId);
      } catch (listErr) {
        logger.warn(`Model "${modelId}" was not found and listing models failed: ` +
            `${listErr.message}`);
      }
      if (!replacement) {
        logger.error(`Model "${modelId}" was not found and no model in the same family ` +
            'is available. Update ep_ai_core.model in settings.json.');
        throw err;
      }
      warnOnce(`404|${baseUrl}|${modelId}`,
          `Model "${modelId}" was not found (${err.status || err.code}); using ` +
          `"${replacement}" instead. Update ep_ai_core.model in settings.json, ` +
          'or use a family keyword such as "sonnet".');
      // Remember the substitution so later requests skip the dead ID.
      const configured = typeof model === 'string' ? model.trim() : '';
      const ckey = `${cacheKeyFor(provider, baseUrl, apiKey)}|${configured}`;
      resolvedCache.set(ckey, {at: Date.now(), id: replacement});
      result = await send(baseUrl, apiKey, replacement, messages, maxTokens);
    }

    logger.debug(`LLM response: ${result.content.length} chars, ` +
        `tokens=${result.usage.total_tokens || '?'}`);
    return result;
  };

  return {complete, resolveModel: () => resolveModel(target, model)};
};

/** Drop cached model lists and resolutions (for tests). */
const clearCache = () => {
  modelListCache.clear();
  resolvedCache.clear();
  warnedOnce.clear();
};

exports.create = create;
exports.clearCache = clearCache;
exports.pickNewest = pickNewest;
exports.familyTokens = familyTokens;
exports.isFamilyKeyword = isFamilyKeyword;
exports.MODEL_LIST_TTL_MS = MODEL_LIST_TTL_MS;
