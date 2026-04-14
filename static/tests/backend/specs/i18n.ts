'use strict';

import {strict as assert} from 'assert';

const i18n = require('../../../../i18n');

describe('ep_ai_core - i18n', function () {
  describe('t', function () {
    it('returns English string for known key', function () {
      const result = i18n.t('ep_ai_core.access_denied');
      assert.ok(result !== 'ep_ai_core.access_denied', 'Should return translated string, not the key');
      assert.ok(result.length > 0);
    });

    it('returns the key itself for unknown key', function () {
      const result = i18n.t('ep_ai_core.nonexistent_key');
      assert.equal(result, 'ep_ai_core.nonexistent_key');
    });

    it('loads ep_ai_core locale strings', function () {
      const locale = i18n.loadLocale('ep_ai_core');
      assert.ok(Object.keys(locale).length > 0, 'Should have locale entries');
      assert.ok(locale['ep_ai_core.access_denied']);
    });
  });
});
