'use strict';

const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core');

let pluginSettings = null;

const normalizeSettings = (raw) => {
  const result = raw || {};
  if (!result.access) result.access = {defaultMode: 'full', pads: {}};
  if (!result.access.defaultMode) result.access.defaultMode = 'full';
  return result;
};

// ep_ai_mcp and ep_ai_chat can end up with a different copy of this module
// than the one Etherpad ran loadSettings on (e.g. a pnpm workspace install
// next to a plugin_packages one), so fall back to Etherpad's own settings
// rather than returning null and crashing every access check.
const getSettings = () => {
  if (pluginSettings) return pluginSettings;
  const epSettings = require('ep_etherpad-lite/node/utils/Settings');
  pluginSettings = normalizeSettings((epSettings.default || epSettings).ep_ai_core);
  return pluginSettings;
};

exports.loadSettings = async (hookName, {settings}) => {
  // Etherpad only passes known settings — plugins use ep_<name> keys
  pluginSettings = normalizeSettings(settings.ep_ai_core);
  logger.info('ep_ai_core settings loaded');
  logger.info(`Default access mode: ${pluginSettings.access.defaultMode}`);
  logger.info(`API base URL: ${pluginSettings.apiBaseUrl || '(not configured)'}`);
  // Resolve a family keyword ("sonnet") to a model ID now, so the result is
  // logged at startup and cached. Don't hold up startup on the network.
  if (pluginSettings.apiBaseUrl && pluginSettings.apiKey) {
    exports.llmClient.create(pluginSettings).resolveModel()
        .then((id) => logger.info(`LLM model: ${id}`))
        .catch((err) => logger.warn(`Could not resolve LLM model: ${err.message}`));
  }
};

exports.init_ep_ai_core = async (hookName, {logger: l}) => {
  logger.info('ep_ai_core initialized');
};

exports.getSettings = getSettings;

// Re-export modules for use by ep_ai_mcp and ep_ai_chat
exports.accessControl = require('./accessControl');
exports.llmClient = require('./llmClient');
exports.authorship = require('./authorship');
exports.i18n = require('./i18n');
