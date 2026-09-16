const crypto = require('node:crypto');

function contentSecurityPolicy({nonce,allowInlineScripts=false}={}){
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self'${nonce?` 'nonce-${nonce}'`:allowInlineScripts?" 'unsafe-inline'":''}`,
    "style-src 'self' 'unsafe-inline' https://miaoda.feishu.cn https://cdn.jsdelivr.net",
    "font-src 'self' data: https://miaoda.feishu.cn https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${process.env.CSP_CONNECT_SRC || ''}`.trim(),
  ];
  if (process.env.NODE_ENV === 'production') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function securityHeaders(req, res, next) {
  const requestId = /^[a-zA-Z0-9._-]{8,100}$/.test(req.get('X-Request-Id') || '')
    ? req.get('X-Request-Id') : crypto.randomUUID();
  req.requestId = requestId;
  res.set({
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': contentSecurityPolicy({allowInlineScripts:true}),
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function createWriteLimit({ windowMs = 15 * 60 * 1000, limit = 30 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 10000) for (const [key, item] of buckets) if (item.until <= now) buckets.delete(key);
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let item = buckets.get(key);
    if (!item || item.until <= now) item = { count: 0, until: now + windowMs };
    item.count += 1; buckets.set(key, item);
    if (item.count > limit) {
      res.set('Retry-After', String(Math.ceil((item.until - now) / 1000)));
      return res.status(429).json({ code: 429, message: '提交过于频繁，请稍后再试' });
    }
    next();
  };
}

module.exports = { securityHeaders, createWriteLimit, contentSecurityPolicy };
