'use strict';

const settings = require('ep_etherpad-lite/node/utils/Settings');
const log4js = require('ep_etherpad-lite/node_modules/log4js');
const logger = log4js.getLogger('ep_ai_core:admin');

/**
 * Middleware to require admin authentication for AI settings routes.
 * Reuses Etherpad's existing auth — checks for is_admin on the session.
 */
const requireAdmin = (req, res, next) => {
  // Check session-based auth (Etherpad's webaccess sets this)
  const session = req.session;
  const user = session?.user;
  if (user && user.is_admin) return next();

  // Check JWT/OAuth admin claim
  const authHeader = req.headers.authorization || '';
  if (authHeader) {
    try {
      const jose = require('ep_etherpad-lite/node_modules/jose');
      const {publicKeyExported} = require('ep_etherpad-lite/node/security/OAuth2Provider');
      if (publicKeyExported) {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        // Synchronous decode to check admin claim (verification done by webaccess)
        const {jwtVerify} = jose;
        jwtVerify(token, publicKeyExported, {algorithms: ['RS256']})
            .then((result) => {
              if (result.payload.admin || result.payload.is_admin) return next();
              res.status(403).json({error: 'Admin access required'});
            })
            .catch(() => {
              res.status(401).json({error: 'Invalid token'});
            });
        return; // async handling
      }
    } catch { /* fall through */ }
  }

  // No valid auth — redirect to admin login
  if (req.method === 'GET') {
    return res.redirect('/admin/');
  }
  res.status(401).json({error: 'Admin authentication required'});
};

/**
 * Sanitize settings for client display — strip sensitive fields.
 */
const sanitizeSettingsForClient = (aiSettings) => {
  const safe = {...aiSettings};
  // Never send the API key to the client
  delete safe.apiKey;
  return safe;
};

/**
 * Escape a JSON string for safe embedding in HTML <script> tags.
 * Prevents XSS via </script> injection.
 */
const safeJsonForHtml = (obj) => {
  return JSON.stringify(obj)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
};

/**
 * Validate and sanitize settings input.
 */
const validateSettings = (input) => {
  const allowed = {
    provider: ['anthropic', 'openai'],
    defaultMode: ['full', 'readOnly', 'none'],
  };

  const cleaned = {};
  if (input.apiBaseUrl && typeof input.apiBaseUrl === 'string') {
    // SSRF protection: only allow http(s) URLs
    const url = input.apiBaseUrl.trim();
    if (/^https?:\/\//i.test(url)) {
      cleaned.apiBaseUrl = url;
    }
  }
  if (input.model && typeof input.model === 'string') {
    cleaned.model = input.model.trim().substring(0, 100);
  }
  if (input.maxTokens) {
    const n = parseInt(input.maxTokens);
    if (n > 0 && n <= 100000) cleaned.maxTokens = n;
  }
  if (input.provider && allowed.provider.includes(input.provider)) {
    cleaned.provider = input.provider;
  }
  if (input.defaultMode && allowed.defaultMode.includes(input.defaultMode)) {
    cleaned.defaultMode = input.defaultMode;
  }
  if (input.trigger && typeof input.trigger === 'string') {
    cleaned.trigger = input.trigger.trim().substring(0, 20);
  }
  if (input.authorName && typeof input.authorName === 'string') {
    cleaned.authorName = input.authorName.trim().substring(0, 50);
  }
  if (input.authorColor && /^#[0-9a-f]{6}$/i.test(input.authorColor)) {
    cleaned.authorColor = input.authorColor;
  }
  return cleaned;
};

exports.expressCreateServer = (hookName, {app}) => {
  logger.info('Registering /admin-plugins/ai routes');

  app.get('/admin-plugins/ai', requireAdmin, (req, res) => {
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
    // Inject sanitized settings (no API key) with XSS-safe encoding
    html = html.replace('__SETTINGS_JSON__',
        safeJsonForHtml(sanitizeSettingsForClient(aiSettings)));
    res.type('html').send(html);
  });

  app.post('/admin-plugins/ai/save', requireAdmin, (req, res) => {
    try {
      const validated = validateSettings(req.body || {});
      settings.ep_ai_core = {
        ...settings.ep_ai_core,
        ...(validated.apiBaseUrl && {apiBaseUrl: validated.apiBaseUrl}),
        ...(validated.model && {model: validated.model}),
        ...(validated.maxTokens && {maxTokens: validated.maxTokens}),
        ...(validated.provider && {provider: validated.provider}),
        access: {
          defaultMode: validated.defaultMode || settings.ep_ai_core?.access?.defaultMode || 'full',
          pads: settings.ep_ai_core?.access?.pads || {},
        },
        chat: {
          ...settings.ep_ai_core?.chat,
          ...(validated.trigger && {trigger: validated.trigger}),
          ...(validated.authorName && {authorName: validated.authorName}),
          ...(validated.authorColor && {authorColor: validated.authorColor}),
        },
      };
      logger.info('AI settings updated via admin UI');
      res.json({success: true});
    } catch (err) {
      logger.error(`Failed to save AI settings: ${err.message}`);
      res.status(500).json({success: false, error: 'Internal error'});
    }
  });

  app.post('/admin-plugins/ai/test', requireAdmin, async (req, res) => {
    try {
      const aiSettings = settings.ep_ai_core || {};
      if (!aiSettings.apiBaseUrl || !aiSettings.apiKey) {
        return res.json({success: false, error: 'API base URL and key must be configured in settings.json'});
      }
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
