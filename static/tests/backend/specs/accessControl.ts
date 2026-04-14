'use strict';

import {strict as assert} from 'assert';

const accessControl = require('../../../../accessControl');

describe('ep_ai_core - accessControl', function () {
  describe('getAccessMode', function () {
    it('returns defaultMode when no patterns match', function () {
      const settings = {
        access: {
          defaultMode: 'full',
          pads: {
            'secret-*': 'none',
          },
        },
      };
      assert.equal(accessControl.getAccessMode('my-pad', settings), 'full');
    });

    it('returns none for pads matching a none pattern', function () {
      const settings = {
        access: {
          defaultMode: 'full',
          pads: {
            'secret-*': 'none',
          },
        },
      };
      assert.equal(accessControl.getAccessMode('secret-plans', settings), 'none');
    });

    it('returns readOnly for pads matching a readOnly pattern', function () {
      const settings = {
        access: {
          defaultMode: 'full',
          pads: {
            'public-*': 'readOnly',
          },
        },
      };
      assert.equal(accessControl.getAccessMode('public-docs', settings), 'readOnly');
    });

    it('uses first matching pattern', function () {
      const settings = {
        access: {
          defaultMode: 'full',
          pads: {
            'secret-public-*': 'none',
            'secret-*': 'readOnly',
          },
        },
      };
      assert.equal(accessControl.getAccessMode('secret-public-thing', settings), 'none');
    });

    it('returns full as default when no settings provided', function () {
      assert.equal(accessControl.getAccessMode('any-pad', {}), 'full');
    });

    it('returns full as default when access section is missing', function () {
      const settings = {};
      assert.equal(accessControl.getAccessMode('any-pad', settings), 'full');
    });
  });

  describe('canRead', function () {
    it('returns true for full mode', function () {
      const settings = {access: {defaultMode: 'full', pads: {}}};
      assert.equal(accessControl.canRead('pad', settings), true);
    });

    it('returns true for readOnly mode', function () {
      const settings = {access: {defaultMode: 'readOnly', pads: {}}};
      assert.equal(accessControl.canRead('pad', settings), true);
    });

    it('returns false for none mode', function () {
      const settings = {access: {defaultMode: 'none', pads: {}}};
      assert.equal(accessControl.canRead('pad', settings), false);
    });
  });

  describe('canWrite', function () {
    it('returns true for full mode', function () {
      const settings = {access: {defaultMode: 'full', pads: {}}};
      assert.equal(accessControl.canWrite('pad', settings), true);
    });

    it('returns false for readOnly mode', function () {
      const settings = {access: {defaultMode: 'readOnly', pads: {}}};
      assert.equal(accessControl.canWrite('pad', settings), false);
    });

    it('returns false for none mode', function () {
      const settings = {access: {defaultMode: 'none', pads: {}}};
      assert.equal(accessControl.canWrite('pad', settings), false);
    });
  });
});
