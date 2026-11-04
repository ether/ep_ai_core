'use strict';

import {strict as assert} from 'assert';
import http from 'http';

const llmClient = require('../../../../llmClient');
const log4js = require('ep_etherpad-lite/node_modules/log4js');

type Req = {method: string; url: string; body: any; headers: any};

let mockServer: http.Server;
let mockPort: number;
let requests: Req[] = [];
let lastRequest: Req | null = null;
let mockResponse: any = null;
// What GET /models returns, or a status code to fail with.
let modelsResponse: any = null;
let modelsStatus = 200;
// Model IDs the completion endpoint answers with 404, and the error shape.
let missingModels: Set<string> = new Set();
let notFoundBody: any = {type: 'error', error: {type: 'not_found_error', message: 'model: x'}};

const startMockServer = (): Promise<void> => new Promise((resolve) => {
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      const r: Req = {
        method: req.method || '',
        url: req.url || '',
        body: body ? JSON.parse(body) : null,
        headers: req.headers,
      };
      requests.push(r);
      res.setHeader('Content-Type', 'application/json');
      if (r.method === 'GET' && r.url.startsWith('/models')) {
        res.writeHead(modelsStatus);
        const payload = typeof modelsResponse === 'function' ? modelsResponse(r.url) : modelsResponse;
        res.end(JSON.stringify(modelsStatus === 200 ? payload : {error: {message: 'nope'}}));
        return;
      }
      lastRequest = r;
      if (r.body && missingModels.has(r.body.model)) {
        res.writeHead(404);
        res.end(JSON.stringify(notFoundBody));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(mockResponse));
    });
  });
  mockServer.listen(0, () => {
    const addr = mockServer.address();
    mockPort = typeof addr === 'object' && addr ? addr.port : 0;
    resolve();
  });
});

const stopMockServer = (): Promise<void> => new Promise((resolve) => {
  mockServer.close(() => resolve());
});

const completions = () => requests.filter((r) => r.method === 'POST');
const modelListCalls = () => requests.filter((r) => r.method === 'GET');

const anthropicModels = {
  data: [
    {type: 'model', id: 'claude-haiku-5-5', created_at: '2026-09-20T00:00:00Z'},
    {type: 'model', id: 'claude-opus-5-5', created_at: '2026-09-15T00:00:00Z'},
    {type: 'model', id: 'claude-sonnet-5-5', created_at: '2026-09-10T00:00:00Z'},
    {type: 'model', id: 'claude-sonnet-5', created_at: '2026-04-01T00:00:00Z'},
    {type: 'model', id: 'claude-opus-5', created_at: '2026-03-01T00:00:00Z'},
    {type: 'model', id: 'claude-sonnet-4-6', created_at: '2026-02-01T00:00:00Z'},
  ],
  has_more: false,
  first_id: 'claude-haiku-5-5',
  last_id: 'claude-sonnet-4-6',
};

const anthropicReply = {
  content: [{type: 'thinking', thinking: ''}, {type: 'text', text: 'Hello from Claude'}],
  stop_reason: 'end_turn',
  usage: {input_tokens: 10, output_tokens: 5},
};

// Capture warn/error output from every ep_ai_core logger. log4js hands out
// a new Logger per getLogger(), so patch the shared prototype.
const captureLogs = () => {
  const proto = Object.getPrototypeOf(log4js.getLogger('ep_ai_core:test'));
  const orig = {warn: proto.warn, error: proto.error};
  const logs = {warn: [] as string[], error: [] as string[]};
  proto.warn = function (msg: string, ...rest: any[]) {
    logs.warn.push(String(msg));
    return orig.warn.call(this, msg, ...rest);
  };
  proto.error = function (msg: string, ...rest: any[]) {
    logs.error.push(String(msg));
    return orig.error.call(this, msg, ...rest);
  };
  return {logs, restore: () => { proto.warn = orig.warn; proto.error = orig.error; }};
};

describe('ep_ai_core - llmClient', function () {
  let capture: ReturnType<typeof captureLogs>;

  before(async function () {
    await startMockServer();
  });

  after(async function () {
    await stopMockServer();
  });

  beforeEach(function () {
    llmClient.clearCache();
    requests = [];
    lastRequest = null;
    modelsResponse = null;
    modelsStatus = 200;
    missingModels = new Set();
    notFoundBody = {type: 'error', error: {type: 'not_found_error', message: 'model: x'}};
    mockResponse = {
      choices: [{message: {content: 'Hello from AI'}}],
      usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
    };
    capture = captureLogs();
  });

  afterEach(function () {
    capture.restore();
  });

  const anthropic = (model?: string) => llmClient.create({
    apiBaseUrl: `http://127.0.0.1:${mockPort}`,
    apiKey: 'sk-ant-test',
    model,
    provider: 'anthropic',
  });

  const openai = (model?: string) => llmClient.create({
    apiBaseUrl: `http://127.0.0.1:${mockPort}`,
    apiKey: 'test-key',
    model,
  });

  describe('complete', function () {
    it('sends messages to the API and returns the response content', async function () {
      const result = await openai('test-model-1').complete([
        {role: 'system', content: 'You are helpful'},
        {role: 'user', content: 'Hi'},
      ]);

      assert.equal(result.content, 'Hello from AI');
      assert.equal(lastRequest!.body.model, 'test-model-1');
      assert.equal(lastRequest!.body.messages.length, 2);
      assert.equal(lastRequest!.body.messages[0].role, 'system');
      assert.equal(lastRequest!.body.messages[1].role, 'user');
      assert.equal(modelListCalls().length, 0, 'exact IDs need no model list');
    });

    it('sends Authorization header with Bearer token', async function () {
      await llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'my-secret-key',
        model: 'test-model-1',
      }).complete([{role: 'user', content: 'test'}]);

      assert.equal(lastRequest!.headers.authorization, 'Bearer my-secret-key');
    });

    it('passes maxTokens when provided', async function () {
      await openai('test-model-1').complete([{role: 'user', content: 'test'}], {maxTokens: 500});
      assert.equal(lastRequest!.body.max_tokens, 500);
    });

    it('returns usage information', async function () {
      const result = await openai('test-model-1').complete([{role: 'user', content: 'test'}]);
      assert.deepEqual(result.usage, {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15});
    });
  });

  describe('anthropic provider', function () {
    it('sends x-api-key header and separates system messages', async function () {
      mockResponse = anthropicReply;
      const result = await anthropic('claude-sonnet-5-5').complete([
        {role: 'system', content: 'You are helpful'},
        {role: 'user', content: 'Hi'},
      ]);

      assert.equal(result.content, 'Hello from Claude');
      assert.equal(lastRequest!.url, '/messages');
      assert.equal(lastRequest!.headers['x-api-key'], 'sk-ant-test');
      assert.equal(lastRequest!.headers['anthropic-version'], '2023-06-01');
      assert.equal(lastRequest!.body.system, 'You are helpful');
      assert.equal(lastRequest!.body.messages.length, 1);
      assert.equal(lastRequest!.body.messages[0].role, 'user');
      assert.equal(lastRequest!.body.max_tokens, 16000);
      assert.equal('temperature' in lastRequest!.body, false);
    });

    it('normalizes usage to OpenAI format', async function () {
      mockResponse = {content: [{type: 'text', text: 'hi'}], usage: {input_tokens: 20, output_tokens: 10}};
      const result = await anthropic('claude-sonnet-5-5').complete([{role: 'user', content: 'test'}]);
      assert.deepEqual(result.usage, {prompt_tokens: 20, completion_tokens: 10, total_tokens: 30});
    });

    it('throws on a refusal instead of returning empty text', async function () {
      mockResponse = {content: [], stop_reason: 'refusal', stop_details: {category: 'cyber'},
        usage: {input_tokens: 1, output_tokens: 0}};
      await assert.rejects(
          () => anthropic('claude-sonnet-5-5').complete([{role: 'user', content: 'x'}]),
          /refusal: cyber/);
    });

    it('warns when the reply hits max_tokens', async function () {
      mockResponse = {content: [{type: 'thinking', thinking: ''}], stop_reason: 'max_tokens',
        usage: {input_tokens: 1, output_tokens: 50}};
      await anthropic('claude-sonnet-5-5').complete([{role: 'user', content: 'x'}], {maxTokens: 50});
      assert.ok(capture.logs.warn.some((m) => m.includes('max_tokens')));
    });
  });

  describe('model family keywords', function () {
    it('resolves "sonnet" to the newest Sonnet from GET /models', async function () {
      modelsResponse = anthropicModels;
      mockResponse = anthropicReply;
      await anthropic('sonnet').complete([{role: 'user', content: 'hi'}]);

      assert.equal(lastRequest!.body.model, 'claude-sonnet-5-5');
      const [list] = modelListCalls();
      assert.ok(list.url.startsWith('/models?'));
      assert.equal(list.headers['x-api-key'], 'sk-ant-test');
      assert.equal(list.headers['anthropic-version'], '2023-06-01');
    });

    it('resolves "opus" and "haiku" too', async function () {
      modelsResponse = anthropicModels;
      assert.equal(await anthropic('opus').resolveModel(), 'claude-opus-5-5');
      assert.equal(await anthropic('haiku').resolveModel(), 'claude-haiku-5-5');
    });

    it('defaults to the newest Sonnet when model is unset', async function () {
      modelsResponse = anthropicModels;
      assert.equal(await anthropic(undefined).resolveModel(), 'claude-sonnet-5-5');
      assert.ok(capture.logs.warn.some((m) => m.includes('not set')));
    });

    it('caches the model list across clients and requests', async function () {
      modelsResponse = anthropicModels;
      mockResponse = anthropicReply;
      await anthropic('sonnet').complete([{role: 'user', content: 'a'}]);
      await anthropic('sonnet').complete([{role: 'user', content: 'b'}]);
      await anthropic('opus').complete([{role: 'user', content: 'c'}]);
      assert.equal(modelListCalls().length, 1);
    });

    it('fetches the list again after the cache expires', async function () {
      modelsResponse = anthropicModels;
      const realNow = Date.now;
      try {
        await anthropic('sonnet').resolveModel();
        const later = realNow() + llmClient.MODEL_LIST_TTL_MS + 1000;
        Date.now = () => later;
        modelsResponse = {data: [{id: 'claude-sonnet-6', created_at: '2027-01-01T00:00:00Z'},
          ...anthropicModels.data], has_more: false};
        assert.equal(await anthropic('sonnet').resolveModel(), 'claude-sonnet-6');
        assert.equal(modelListCalls().length, 2);
      } finally {
        Date.now = realNow;
      }
    });

    it('follows Anthropic pagination', async function () {
      modelsResponse = (url: string) => (url.includes('after_id=claude-opus-5')
        ? {data: [{id: 'claude-sonnet-5-5', created_at: '2026-09-10T00:00:00Z'}], has_more: false}
        : {data: [{id: 'claude-opus-5', created_at: '2026-03-01T00:00:00Z'}],
          has_more: true, last_id: 'claude-opus-5'});
      assert.equal(await anthropic('sonnet').resolveModel(), 'claude-sonnet-5-5');
      assert.equal(modelListCalls().length, 2);
    });

    it('sends a digit-free keyword as-is when it cannot be resolved', async function () {
      modelsStatus = 500;
      await openai('deepseek-chat').complete([{role: 'user', content: 'x'}]);
      assert.equal(lastRequest!.body.model, 'deepseek-chat');
      assert.ok(capture.logs.warn.some((m) => m.includes('deepseek-chat')));
    });

    it('errors clearly when model is unset and the list is unavailable', async function () {
      modelsStatus = 500;
      await assert.rejects(() => anthropic(undefined).complete([{role: 'user', content: 'x'}]),
          /model is not set/);
    });
  });

  describe('retired model fallback', function () {
    it('warns once and retries with the newest model in the family on 404', async function () {
      modelsResponse = anthropicModels;
      mockResponse = anthropicReply;
      missingModels = new Set(['claude-sonnet-4-20250514']);
      const client = anthropic('claude-sonnet-4-20250514');

      const result = await client.complete([{role: 'user', content: 'hi'}]);
      assert.equal(result.content, 'Hello from Claude');
      assert.deepEqual(completions().map((r) => r.body.model),
          ['claude-sonnet-4-20250514', 'claude-sonnet-5-5']);

      // Later requests go straight to the replacement and don't warn again.
      await client.complete([{role: 'user', content: 'again'}]);
      assert.equal(completions()[2].body.model, 'claude-sonnet-5-5');
      const warns = capture.logs.warn.filter((m) => m.includes('claude-sonnet-4-20250514'));
      assert.equal(warns.length, 1);
      assert.ok(warns[0].includes('claude-sonnet-5-5'));
    });

    it('throws the original error when no model in the family exists', async function () {
      modelsResponse = {data: [{id: 'claude-opus-5-5', created_at: '2026-09-15T00:00:00Z'}]};
      missingModels = new Set(['claude-sonnet-4-20250514']);
      await assert.rejects(
          () => anthropic('claude-sonnet-4-20250514').complete([{role: 'user', content: 'hi'}]),
          /404/);
      assert.ok(capture.logs.error.some((m) => m.includes('claude-sonnet-4-20250514')));
    });

    it('handles OpenAI-style model_not_found', async function () {
      modelsResponse = {object: 'list', data: [
        {id: 'gpt-6-luna', created: 1780000000, owned_by: 'openai'},
        {id: 'gpt-6.1-sol', created: 1790000000, owned_by: 'openai'},
        {id: 'gpt-5.6-sol', created: 1770000000, owned_by: 'openai'},
        {id: 'gpt-realtime-sol', created: 1795000000, owned_by: 'openai'},
      ]};
      missingModels = new Set(['gpt-5.6-sol']);
      notFoundBody = {error: {message: 'The model `gpt-5.6-sol` does not exist',
        type: 'invalid_request_error', code: 'model_not_found'}};
      await openai('gpt-5.6-sol').complete([{role: 'user', content: 'hi'}]);
      assert.equal(lastRequest!.body.model, 'gpt-6.1-sol');
      assert.equal(modelListCalls()[0].headers.authorization, 'Bearer test-key');
    });
  });

  describe('OpenAI-compatible model lists', function () {
    it('picks by created time and skips non-chat models', async function () {
      modelsResponse = {data: [
        {id: 'gpt-6-astra', created: 1785000000},
        {id: 'gpt-6.1-sol', created: 1790000000},
        {id: 'gpt-realtime-sol', created: 1799000000},
        {id: 'text-embedding-4-sol', created: 1799000000},
      ]};
      assert.equal(await openai('gpt-sol').resolveModel(), 'gpt-6.1-sol');
    });

    it('falls back to version order when there is no created time (Gemini)', async function () {
      modelsResponse = {object: 'list', data: [
        {id: 'models/gemini-2.5-flash', object: 'model', owned_by: 'google'},
        {id: 'models/gemini-3.8-flash', object: 'model', owned_by: 'google'},
        {id: 'models/gemini-3.8-flash-lite', object: 'model', owned_by: 'google'},
        {id: 'models/gemini-3.6-flash', object: 'model', owned_by: 'google'},
        {id: 'models/gemini-3.8-pro', object: 'model', owned_by: 'google'},
      ]};
      assert.equal(await openai('gemini-flash').resolveModel(), 'gemini-3.8-flash');
    });
  });

  describe('error handling', function () {
    it('throws on non-200 response', async function () {
      const errorServer = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(429, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: {message: 'Rate limited'}}));
        });
      });
      await new Promise<void>((resolve) => { errorServer.listen(0, () => resolve()); });
      const addr = errorServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const client = llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        model: 'test-model-1',
      });

      await assert.rejects(
          () => client.complete([{role: 'user', content: 'test'}]),
          (err: Error) => {
            assert.ok(err.message.includes('429'));
            return true;
          },
      );

      await new Promise<void>((resolve) => errorServer.close(() => resolve()));
    });
  });

  describe('family matching', function () {
    it('derives family words from IDs', function () {
      assert.deepEqual(llmClient.familyTokens('claude-sonnet-4-20250514'), ['claude', 'sonnet']);
      assert.deepEqual(llmClient.familyTokens('models/gemini-2.5-flash'), ['gemini', 'flash']);
      assert.deepEqual(llmClient.familyTokens('grok-2-latest'), ['grok']);
    });

    it('treats digit-free settings as keywords', function () {
      assert.equal(llmClient.isFamilyKeyword('sonnet'), true);
      assert.equal(llmClient.isFamilyKeyword('claude-sonnet-5-5'), false);
      assert.equal(llmClient.isFamilyKeyword(''), false);
    });
  });
});
