'use strict';

const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core');

let pluginSettings = null;

const getSettings = () => pluginSettings;

exports.loadSettings = async (hookName, {settings}) => {
  pluginSettings = settings.ai || {};
  if (!pluginSettings.access) {
    pluginSettings.access = {defaultMode: 'full', pads: {}};
  }
  if (!pluginSettings.access.defaultMode) {
    pluginSettings.access.defaultMode = 'full';
  }
  logger.info('ep_ai_core settings loaded');
  logger.info(`Default access mode: ${pluginSettings.access.defaultMode}`);
};

exports.init_ep_ai_core = async (hookName, {logger: l}) => {
  logger.info('ep_ai_core initialized');
};

exports.getSettings = getSettings;

// Re-export modules for use by ep_ai_mcp and ep_ai_chat
exports.accessControl = require('./accessControl');
exports.llmClient = require('./llmClient');
exports.authorship = require('./authorship');
