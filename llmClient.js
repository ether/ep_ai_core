'use strict';

const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core:llm');

const create = (config) => {
  const {apiBaseUrl, apiKey, model, maxTokens: defaultMaxTokens} = config;
  const baseUrl = apiBaseUrl.replace(/\/+$/, '');

  const complete = async (messages, options = {}) => {
    const url = `${baseUrl}/chat/completions`;
    const maxTokens = options.maxTokens || defaultMaxTokens;

    const body = {
      model,
      messages,
    };
    if (maxTokens) body.max_tokens = maxTokens;

    logger.debug(`LLM request: ${messages.length} messages, model=${model}`);

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

    logger.debug(`LLM response: ${content.length} chars, tokens=${usage.total_tokens || '?'}`);

    return {content, usage};
  };

  return {complete};
};

exports.create = create;
