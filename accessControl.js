'use strict';

const {minimatch} = require('minimatch');

const getAccessMode = (padId, aiSettings) => {
  const access = aiSettings.access;
  if (!access) return 'full';
  const pads = access.pads || {};
  for (const [pattern, mode] of Object.entries(pads)) {
    if (minimatch(padId, pattern)) {
      return mode;
    }
  }
  return access.defaultMode || 'full';
};

const canRead = (padId, aiSettings) => {
  const mode = getAccessMode(padId, aiSettings);
  return mode === 'full' || mode === 'readOnly';
};

const canWrite = (padId, aiSettings) => {
  const mode = getAccessMode(padId, aiSettings);
  return mode === 'full';
};

exports.getAccessMode = getAccessMode;
exports.canRead = canRead;
exports.canWrite = canWrite;
