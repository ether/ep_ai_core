'use strict';

import {strict as assert} from 'assert';
import http from 'http';

const llmClient = require('../../../../llmClient');

let mockServer: http.Server;
let mockPort: number;
let lastRequest: {body: any; headers: any} | null = null;
let mockResponse: any = null;

const startMockServer = (): Promise<void> => {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        lastRequest = {body: JSON.parse(body), headers: req.headers};
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(mockResponse));
      });
    });
    mockServer.listen(0, () => {
      const addr = mockServer.address();
      mockPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
};

const stopMockServer = (): Promise<void> => {
  return new Promise((resolve) => {
    mockServer.close(() => resolve());
  });
};

describe('ep_ai_core - llmClient', function () {
  before(async function () {
    await startMockServer();
  });

  after(async function () {
    await stopMockServer();
  });

  beforeEach(function () {
    lastRequest = null;
    mockResponse = {
      choices: [{message: {content: 'Hello from AI'}}],
      usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
    };
  });

  describe('complete', function () {
    it('sends messages to the API and returns the response content', async function () {
      const client = llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'test-key',
        model: 'test-model',
      });

      const result = await client.complete([
        {role: 'system', content: 'You are helpful'},
        {role: 'user', content: 'Hi'},
      ]);

      assert.equal(result.content, 'Hello from AI');
      assert.equal(lastRequest!.body.model, 'test-model');
      assert.equal(lastRequest!.body.messages.length, 2);
      assert.equal(lastRequest!.body.messages[0].role, 'system');
      assert.equal(lastRequest!.body.messages[1].role, 'user');
    });

    it('sends Authorization header with Bearer token', async function () {
      const client = llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'my-secret-key',
        model: 'test-model',
      });

      await client.complete([{role: 'user', content: 'test'}]);

      assert.equal(lastRequest!.headers.authorization, 'Bearer my-secret-key');
    });

    it('passes maxTokens when provided', async function () {
      const client = llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'test-key',
        model: 'test-model',
      });

      await client.complete(
          [{role: 'user', content: 'test'}],
          {maxTokens: 500},
      );

      assert.equal(lastRequest!.body.max_tokens, 500);
    });

    it('returns usage information', async function () {
      const client = llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'test-key',
        model: 'test-model',
      });

      const result = await client.complete([{role: 'user', content: 'test'}]);

      assert.deepEqual(result.usage, {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });
  });

  describe('error handling', function () {
    it('throws on non-200 response', async function () {
      const errorServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(429, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: {message: 'Rate limited'}}));
        });
      });

      await new Promise<void>((resolve) => {
        errorServer.listen(0, () => resolve());
      });
      const addr = errorServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const client = llmClient.create({
        apiBaseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        model: 'test-model',
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
});
