'use strict';

import {strict as assert} from 'assert';

const common = require('ep_etherpad-lite/tests/backend/common');
const epSettings = require('ep_etherpad-lite/node/utils/Settings');
const settings = epSettings.default || epSettings;

describe('ep_ai_core - settings', function () {
  before(async function () { await common.init(); });

  it('a copy of the module that missed loadSettings still reads the settings', function () {
    const indexPath = require.resolve('../../../../index');
    const loaded = require.cache[indexPath];
    delete require.cache[indexPath];
    const backup = settings.ep_ai_core;
    try {
      settings.ep_ai_core = {access: {defaultMode: 'readOnly', pads: {'secret-*': 'none'}}};
      const fresh = require('../../../../index');
      const s = fresh.getSettings();
      assert.equal(s.access.defaultMode, 'readOnly');
      assert.equal(fresh.accessControl.canRead('secret-plans', s), false);
    } finally {
      settings.ep_ai_core = backup;
      require.cache[indexPath] = loaded;
    }
  });
});
