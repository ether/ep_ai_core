'use strict';

const fs = require('fs');
const path = require('path');

// Cache loaded locales
const localeCache = {};

/**
 * Load locale strings for a plugin.
 * @param {string} pluginName - e.g. 'ep_ai_core'
 * @param {string} [lang='en'] - Language code
 * @returns {object} Key-value map of locale strings
 */
const loadLocale = (pluginName, lang = 'en') => {
  const cacheKey = `${pluginName}:${lang}`;
  if (localeCache[cacheKey]) return localeCache[cacheKey];

  try {
    // Try to find the locale file in the plugin's directory
    const localePath = require.resolve(`${pluginName}/locales/${lang}.json`);
    const data = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    localeCache[cacheKey] = data;
    return data;
  } catch {
    // Fallback to empty object
    return {};
  }
};

/**
 * Get a localized string.
 * @param {string} key - e.g. 'ep_ai_chat.no_access'
 * @param {string} [lang='en']
 * @returns {string} The localized string, or the key itself if not found
 */
const t = (key, lang = 'en') => {
  // Extract plugin name from key (e.g. 'ep_ai_chat' from 'ep_ai_chat.no_access')
  const pluginName = key.split('.').slice(0, -1).join('.');
  // Handle keys like ep_ai_core.xxx and ep_ai_chat.xxx
  const locale = loadLocale(pluginName, lang);
  return locale[key] || key;
};

exports.loadLocale = loadLocale;
exports.t = t;
