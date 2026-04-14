'use strict';

import {strict as assert} from 'assert';

const common = require('ep_etherpad-lite/tests/backend/common');
const {generateJWTToken} = common;

let agent: any;

describe('ep_ai_core - admin UI', function () {
  before(async function () {
    agent = await common.init();
  });

  describe('GET /admin-plugins/ai', function () {
    it('returns the admin page', async function () {
      await agent.get('/admin-plugins/ai')
          .set('Authorization', await generateJWTToken())
          .expect(200)
          .expect((res: any) => {
            assert.ok(
                res.text.includes('AI Integration Settings') ||
                res.text.includes('ai-settings'),
            );
          });
    });
  });

  describe('POST /admin-plugins/ai/save', function () {
    it('saves settings and returns success', async function () {
      await agent.post('/admin-plugins/ai/save')
          .set('Authorization', await generateJWTToken())
          .set('Content-Type', 'application/json')
          .send({
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            apiBaseUrl: 'https://api.anthropic.com/v1',
            maxTokens: '4096',
            defaultMode: 'full',
            trigger: '@ai',
            authorName: 'Test AI',
            authorColor: '#ff0000',
          })
          .expect(200)
          .expect((res: any) => {
            assert.ok(res.body.success);
          });
    });
  });

  describe('POST /admin-plugins/ai/test', function () {
    it('returns connection result', async function () {
      // This will likely fail (no real API key in test) but should return a structured response
      const res = await agent.post('/admin-plugins/ai/test')
          .set('Authorization', await generateJWTToken())
          .set('Content-Type', 'application/json')
          .expect(200);

      assert.ok('success' in res.body, 'Should have success field');
    });
  });
});
