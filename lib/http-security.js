const path = require('path');

const BASE_CSP_DIRECTIVES = Object.freeze([
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "form-action 'self'",
  "script-src 'self' https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js",
  "script-src-elem 'self' https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js",
  // Existing page modules still render event-handler attributes. Keep this
  // exception scoped to attributes; inline <script> blocks remain prohibited.
  "script-src-attr 'unsafe-inline'",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
]);

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'usb=()',
].join(', ');

function contentSecurityPolicy({ production = false } = {}) {
  return [
    ...BASE_CSP_DIRECTIVES,
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function securityHeaders({ production = false } = {}) {
  const csp = contentSecurityPolicy({ production });
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-XSS-Protection', '0');
    if (production) {
      // Do not assert control over unrelated subdomains of a self-hosted domain.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  };
}

function preventSensitiveCaching(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
}

function setStaticCacheHeaders(res, filePath) {
  if (path.extname(filePath).toLowerCase() === '.html') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return;
  }
  // Public filenames are not content-hashed, so clients must revalidate them
  // after upgrades rather than retaining a stale application bundle.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
}

module.exports = {
  contentSecurityPolicy,
  preventSensitiveCaching,
  securityHeaders,
  setStaticCacheHeaders,
};
