'use strict';

import {strict as assert} from 'assert';

const common = require('ep_etherpad-lite/tests/backend/common');
const {generateJWTToken} = common;
const randomString = require('ep_etherpad-lite/static/js/pad_utils').randomString;
const padManager = require('ep_etherpad-lite/node/db/PadManager');

const authorship = require('../../../../authorship');

let agent: any;
const apiVersion = 1;

describe('ep_ai_core - authorship', function () {
  before(async function () {
    agent = await common.init();
  });

  describe('getCurrentAttribution', function () {
    it('returns author attribution for each paragraph', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}&text=Hello world`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const result = authorship.getCurrentAttribution(pad);

      assert.ok(Array.isArray(result.paragraphs));
      assert.ok(result.paragraphs.length > 0);
      assert.ok(result.paragraphs[0].text !== undefined);
      assert.ok(Array.isArray(result.paragraphs[0].authors));
    });

    it('correctly attributes text to authors from the attribute pool', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const pool = pad.pool;
      const authorNum = pool.putAttrib(['author', 'a.testAuthor1']);

      pad.atext = {
        text: 'Hello\n',
        attribs: `*${authorNum.toString(36)}+5|1+1`,
      };

      const result = authorship.getCurrentAttribution(pad);

      assert.equal(result.paragraphs.length, 1);
      assert.equal(result.paragraphs[0].text, 'Hello');
      assert.ok(result.paragraphs[0].authors.some(
          (a: any) => a.authorId === 'a.testAuthor1',
      ));
    });

    it('handles multiple authors in a single paragraph', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const pool = pad.pool;
      const author1Num = pool.putAttrib(['author', 'a.alice']);
      const author2Num = pool.putAttrib(['author', 'a.bob']);

      pad.atext = {
        text: 'HelloWorld\n',
        attribs: `*${author1Num.toString(36)}+5*${author2Num.toString(36)}+5|1+1`,
      };

      const result = authorship.getCurrentAttribution(pad);

      assert.equal(result.paragraphs.length, 1);
      const authors = result.paragraphs[0].authors;
      const alice = authors.find((a: any) => a.authorId === 'a.alice');
      const bob = authors.find((a: any) => a.authorId === 'a.bob');
      assert.ok(alice, 'Alice should be listed');
      assert.ok(bob, 'Bob should be listed');
      assert.equal(alice.charCount, 5);
      assert.equal(bob.charCount, 5);
    });

    it('handles multiple paragraphs', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const pool = pad.pool;
      const authorNum = pool.putAttrib(['author', 'a.writer']);

      pad.atext = {
        text: 'Line one\nLine two\n',
        attribs: `*${authorNum.toString(36)}|1+9|1+9`,
      };

      const result = authorship.getCurrentAttribution(pad);

      assert.equal(result.paragraphs.length, 2);
      assert.equal(result.paragraphs[0].text, 'Line one');
      assert.equal(result.paragraphs[1].text, 'Line two');
    });

    it('returns empty result for empty pad', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const result = authorship.getCurrentAttribution(pad);

      assert.ok(Array.isArray(result.paragraphs));
    });
  });

  describe('getRevisionProvenance', function () {
    it('returns provenance info for text found in the pad', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}&text=Hello world`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const result = await authorship.getRevisionProvenance(pad, 'Hello world');

      assert.ok(result, 'Should return provenance');
      assert.ok(result.found, 'Text should be found');
      assert.ok(Array.isArray(result.history), 'Should have history array');
    });

    it('returns found=false for text not in the pad', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}&text=Hello`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const result = await authorship.getRevisionProvenance(pad, 'Nonexistent text');

      assert.equal(result.found, false);
    });
  });

  describe('getPadContributors', function () {
    it('returns contributor stats from current pad state', async function () {
      const padId = `test-${randomString(10)}`;
      await agent.get(`/api/${apiVersion}/createPad?padID=${padId}`)
          .set('Authorization', await generateJWTToken());

      const pad = await padManager.getPad(padId);
      const pool = pad.pool;
      const a1 = pool.putAttrib(['author', 'a.contrib1']);
      const a2 = pool.putAttrib(['author', 'a.contrib2']);

      // 10 chars by contrib1, 5 chars by contrib2
      pad.atext = {
        text: 'AAAAAAAAAA' + 'BBBBB' + '\n',
        attribs: `*${a1.toString(36)}+a*${a2.toString(36)}+5|1+1`,
      };

      const result = authorship.getPadContributors(pad);

      assert.ok(Array.isArray(result.contributors));
      const c1 = result.contributors.find((c: any) => c.authorId === 'a.contrib1');
      const c2 = result.contributors.find((c: any) => c.authorId === 'a.contrib2');
      assert.ok(c1);
      assert.ok(c2);
      assert.equal(c1.charCount, 10);
      assert.equal(c2.charCount, 5);
      assert.ok(c1.percentage > c2.percentage);
    });
  });
});
