'use strict';

const log4js = require('ep_etherpad-lite/node_modules/log4js');
const Changeset = require('ep_etherpad-lite/static/js/Changeset');
const {attribsFromString} = require('ep_etherpad-lite/static/js/attributes');

const logger = log4js.getLogger('ep_ai_core:authorship');

const getAuthorFromAttribs = (attribs, pool) => {
  for (const [key, value] of attribsFromString(attribs, pool)) {
    if (key === 'author' && value) return value;
  }
  return null;
};

const getCurrentAttribution = (pad) => {
  const atext = pad.atext;
  const pool = pad.pool;
  const text = atext.text;

  // Build a per-character author map
  const charAuthors = [];
  for (const op of Changeset.deserializeOps(atext.attribs)) {
    const authorId = getAuthorFromAttribs(op.attribs, pool);
    for (let i = 0; i < op.chars; i++) {
      charAuthors.push(authorId);
    }
  }

  // Split into paragraphs by newline
  const paragraphs = [];
  const lines = text.split('\n');
  let offset = 0;

  for (const line of lines) {
    if (line.length === 0) {
      offset += 1;
      continue;
    }

    const authorCounts = {};
    for (let i = 0; i < line.length; i++) {
      const author = charAuthors[offset + i] || '';
      if (!authorCounts[author]) authorCounts[author] = 0;
      authorCounts[author]++;
    }

    const totalChars = line.length;
    const authors = Object.entries(authorCounts).map(([authorId, charCount]) => ({
      authorId,
      charCount,
      percentage: Math.round((charCount / totalChars) * 100 * 100) / 100,
    }));

    authors.sort((a, b) => b.charCount - a.charCount);

    paragraphs.push({text: line, authors});
    offset += line.length + 1;
  }

  return {paragraphs};
};

const getPadContributors = (pad) => {
  const atext = pad.atext;
  const pool = pad.pool;
  const text = atext.text;

  const contentLength = text.length > 0 ? text.length - 1 : 0;
  const authorCounts = {};
  let charIndex = 0;

  for (const op of Changeset.deserializeOps(atext.attribs)) {
    const authorId = getAuthorFromAttribs(op.attribs, pool);
    const charsToCount = Math.min(op.chars, contentLength - charIndex);
    if (charsToCount <= 0) break;
    if (!authorCounts[authorId || '']) authorCounts[authorId || ''] = 0;
    authorCounts[authorId || ''] += charsToCount;
    charIndex += op.chars;
  }

  const totalChars = Object.values(authorCounts).reduce((sum, c) => sum + c, 0);
  const contributors = Object.entries(authorCounts)
      .filter(([authorId]) => authorId !== '')
      .map(([authorId, charCount]) => ({
        authorId,
        charCount,
        percentage: totalChars > 0
          ? Math.round((charCount / totalChars) * 100 * 100) / 100
          : 0,
      }));

  contributors.sort((a, b) => b.charCount - a.charCount);
  return {contributors};
};

const getRevisionProvenance = async (pad, searchText) => {
  const currentText = pad.atext.text;
  const startPos = currentText.indexOf(searchText);

  if (startPos === -1) {
    return {found: false, history: []};
  }

  const endPos = startPos + searchText.length;
  const head = pad.getHeadRevisionNumber();
  const history = [];

  for (let rev = head; rev >= 0; rev--) {
    try {
      const changeset = await pad.getRevisionChangeset(rev);
      const author = await pad.getRevisionAuthor(rev);
      const timestamp = await pad.getRevisionDate(rev);

      const unpacked = Changeset.unpack(changeset);
      let pos = 0;
      let touchesRange = false;

      for (const op of Changeset.deserializeOps(unpacked.ops)) {
        if (op.opcode === '=') {
          pos += op.chars;
        } else if (op.opcode === '-') {
          const deleteEnd = pos + op.chars;
          if (pos < endPos && deleteEnd > startPos) {
            touchesRange = true;
          }
        } else if (op.opcode === '+') {
          if (pos >= startPos && pos <= endPos) {
            touchesRange = true;
          }
          pos += op.chars;
        }
      }

      if (touchesRange) {
        history.push({
          revision: rev,
          authorId: author || '',
          timestamp,
          type: rev === 0 ? 'created' : 'edited',
        });
      }
    } catch (err) {
      logger.warn(`Error reading revision ${rev}: ${err.message}`);
      break;
    }
  }

  history.reverse();
  return {found: true, history};
};

const getPadActivity = async (pad, since) => {
  const head = pad.getHeadRevisionNumber();
  const activity = [];

  for (let rev = head; rev >= 0; rev--) {
    try {
      const timestamp = await pad.getRevisionDate(rev);
      if (since && timestamp < since) break;

      const authorId = await pad.getRevisionAuthor(rev);
      const changeset = await pad.getRevisionChangeset(rev);
      const unpacked = Changeset.unpack(changeset);
      const changeSize = Math.abs(unpacked.newLen - unpacked.oldLen);

      if (authorId) {
        activity.push({revision: rev, authorId, timestamp, changeSize});
      }
    } catch (err) {
      logger.warn(`Error reading revision ${rev}: ${err.message}`);
      break;
    }
  }

  activity.reverse();
  return {activity};
};

exports.getCurrentAttribution = getCurrentAttribution;
exports.getPadContributors = getPadContributors;
exports.getRevisionProvenance = getRevisionProvenance;
exports.getPadActivity = getPadActivity;
