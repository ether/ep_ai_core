'use strict';

const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core:llm');

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
    max_tokens: maxTokens || 4096,
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

  if (!response.ok) {
    const text = await response.text();
    let errorMsg;
    try {
      const errorJson = JSON.parse(text);
      errorMsg = errorJson.error?.message || text;
    } catch {
      errorMsg = text;
    }
    throw new Error(`LLM API error ${response.status}: ${errorMsg}`);
  }

  const data = await response.json();
  // Anthropic returns content as array of blocks
  const content = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
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

  if (!response.ok) {
    const text = await response.text();
    let errorMsg;
    try {
      const errorJson = JSON.parse(text);
      errorMsg = errorJson.error?.message || text;
    } catch {
      errorMsg = text;
    }
    throw new Error(`LLM API error ${response.status}: ${errorMsg}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  return {content, usage};
};

/**
 * Create an LLM client. Supports both OpenAI-compatible and Anthropic APIs.
 *
 * @param {object} config
 * @param {string} config.apiBaseUrl - e.g. "https://api.anthropic.com/v1" or "http://localhost:11434/v1"
 * @param {string} config.apiKey
 * @param {string} config.model - e.g. "claude-sonnet-4-20250514" or "gpt-4o"
 * @param {number} [config.maxTokens]
 * @param {string} [config.provider] - "anthropic" or "openai" (auto-detected from URL if omitted)
 * @returns {{complete: function}}
 */
const create = (config) => {
  const {apiBaseUrl, apiKey, model, maxTokens: defaultMaxTokens} = config;
  const baseUrl = apiBaseUrl.replace(/\/+$/, '');
  const provider = detectProvider(config);

  const complete = async (messages, options = {}) => {
    const maxTokens = options.maxTokens || defaultMaxTokens;
    logger.debug(`LLM request: ${messages.length} messages, model=${model}, provider=${provider}`);

    const result = provider === 'anthropic'
      ? await completeAnthropic(baseUrl, apiKey, model, messages, maxTokens)
      : await completeOpenAI(baseUrl, apiKey, model, messages, maxTokens);

    logger.debug(`LLM response: ${result.content.length} chars, tokens=${result.usage.total_tokens || '?'}`);
    return result;
  };

  return {complete};
};

exports.create = create;
