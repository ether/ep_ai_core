'use strict';

const eejs = require('ep_etherpad-lite/node/eejs');
const settings = require('ep_etherpad-lite/node/utils/Settings');
const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core:admin');

exports.expressCreateServer = (hookName, {app}) => {
  logger.info('Registering /admin-plugins/ai routes');

  // Serve the admin settings page as self-contained HTML (no EJS dependency)
  app.get('/admin-plugins/ai', (req, res) => {
    const aiSettings = settings.ep_ai_core || {};
    const fs = require('fs');
    const path = require('path');
    let html;
    try {
      html = fs.readFileSync(
          require.resolve('ep_ai_core/templates/admin.html'), 'utf8');
    } catch {
      html = fs.readFileSync(
          path.join(__dirname, 'templates', 'admin.html'), 'utf8');
    }
    // Inject current settings as JSON
    html = html.replace('__SETTINGS_JSON__', JSON.stringify(aiSettings));
    res.type('html').send(html);
  });

  // API endpoint for saving settings
  app.post('/admin-plugins/ai/save', (req, res) => {
    try {
      const newSettings = req.body;
      // Update settings in memory
      settings.ep_ai_core = {
        ...settings.ep_ai_core,
        apiBaseUrl: newSettings.apiBaseUrl || settings.ep_ai_core?.apiBaseUrl,
        model: newSettings.model || settings.ep_ai_core?.model,
        maxTokens: parseInt(newSettings.maxTokens) || settings.ep_ai_core?.maxTokens,
        provider: newSettings.provider || settings.ep_ai_core?.provider,
        access: {
          defaultMode: newSettings.defaultMode || 'full',
          pads: settings.ep_ai_core?.access?.pads || {},
        },
        chat: {
          ...settings.ep_ai_core?.chat,
          trigger: newSettings.trigger || '@ai',
          authorName: newSettings.authorName || 'AI Assistant',
          authorColor: newSettings.authorColor || '#7c4dff',
        },
      };
      // Note: apiKey is not updated via the admin UI for security
      logger.info('AI settings updated via admin UI');
      res.json({success: true});
    } catch (err) {
      logger.error(`Failed to save AI settings: ${err.message}`);
      res.status(500).json({success: false, error: err.message});
    }
  });

  // API endpoint for testing the LLM connection
  app.post('/admin-plugins/ai/test', async (req, res) => {
    try {
      const aiSettings = settings.ep_ai_core || {};
      const llmClient = require('./llmClient');
      const client = llmClient.create({
        apiBaseUrl: aiSettings.apiBaseUrl,
        apiKey: aiSettings.apiKey,
        model: aiSettings.model,
        provider: aiSettings.provider,
      });
      const result = await client.complete([
        {role: 'user', content: 'Reply with exactly: "Connection successful"'},
      ], {maxTokens: 50});
      res.json({success: true, response: result.content, usage: result.usage});
    } catch (err) {
      res.json({success: false, error: err.message});
    }
  });
};
