'use strict';

import {strict as assert} from 'assert';

const common = require('ep_etherpad-lite/tests/backend/common');
const {generateJWTToken} = common;

let agent: any;

describe('ep_ai_core - admin security', function () {
  before(async function () {
    agent = await common.init();
  });

  describe('authentication required', function () {
    it('GET /admin-plugins/ai redirects without auth', async function () {
      const res = await agent.get('/admin-plugins/ai');
      // Should redirect to /admin/ or return 401
      assert.ok(
          res.status === 302 || res.status === 401,
          `Expected redirect or 401, got ${res.status}`,
      );
    });

    it('POST /admin-plugins/ai/save returns 401 without auth', async function () {
      await agent.post('/admin-plugins/ai/save')
          .set('Content-Type', 'application/json')
          .send({provider: 'openai'})
          .expect(401);
    });

    it('POST /admin-plugins/ai/test returns 401 without auth', async function () {
      await agent.post('/admin-plugins/ai/test')
          .set('Content-Type', 'application/json')
          .expect(401);
    });
  });

  describe('input validation', function () {
    it('rejects invalid provider values', async function () {
      await agent.post('/admin-plugins/ai/save')
          .set('Authorization', await generateJWTToken())
          .set('Content-Type', 'application/json')
          .send({provider: 'malicious_value'})
          .expect(200)
          .expect((res: any) => {
            assert.ok(res.body.success);
            // The invalid provider should be ignored
            const settings = require('ep_etherpad-lite/node/utils/Settings');
            assert.notEqual(settings.ep_ai_core?.provider, 'malicious_value');
          });
    });

    it('rejects non-http apiBaseUrl (SSRF protection)', async function () {
      await agent.post('/admin-plugins/ai/save')
          .set('Authorization', await generateJWTToken())
          .set('Content-Type', 'application/json')
          .send({apiBaseUrl: 'file:///etc/passwd'})
          .expect(200);

      const settings = require('ep_etherpad-lite/node/utils/Settings');
      assert.notEqual(settings.ep_ai_core?.apiBaseUrl, 'file:///etc/passwd');
    });

    it('rejects invalid color values', async function () {
      await agent.post('/admin-plugins/ai/save')
          .set('Authorization', await generateJWTToken())
          .set('Content-Type', 'application/json')
          .send({authorColor: 'not-a-color'})
          .expect(200);

      const settings = require('ep_etherpad-lite/node/utils/Settings');
      assert.notEqual(settings.ep_ai_core?.chat?.authorColor, 'not-a-color');
    });

    it('truncates excessively long model names', async function () {
      const longModel = 'a'.repeat(200);
      await agent.post('/admin-plugins/ai/save')
          .set('Authorization', await generateJWTToken())
          .set('Content-Type', 'application/json')
          .send({model: longModel})
          .expect(200);

      const settings = require('ep_etherpad-lite/node/utils/Settings');
      assert.ok(
          (settings.ep_ai_core?.model || '').length <= 100,
          'Model name should be truncated to 100 chars',
      );
    });
  });

  describe('API key not leaked', function () {
    it('GET /admin-plugins/ai does not expose apiKey in HTML', async function () {
      // Set a fake API key in settings
      const settings = require('ep_etherpad-lite/node/utils/Settings');
      const original = settings.ep_ai_core;
      settings.ep_ai_core = {...settings.ep_ai_core, apiKey: 'sk-secret-test-key-12345'};

      const res = await agent.get('/admin-plugins/ai')
          .set('Authorization', await generateJWTToken());

      // The response body should NOT contain the API key
      if (res.status === 200) {
        assert.ok(
            !res.text.includes('sk-secret-test-key-12345'),
            'API key should not appear in admin page HTML',
        );
      }

      settings.ep_ai_core = original;
    });
  });
});
