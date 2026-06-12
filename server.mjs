import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requestedPort = Number(process.env.PORT || 3000);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 3000;
const HOST = '127.0.0.1';
const distDir = path.join(__dirname, 'dist');

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
};

// This is only a static-file server for the built React app. It deliberately binds
// to localhost by default and does not store, upload, or process label data server-side.

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    ...securityHeaders,
    'Cache-Control': statusCode === 200 ? 'no-cache' : 'no-store'
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      return send(res, 404, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      ...securityHeaders,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// DNS rebinding protection: a malicious website can point its own domain at
// 127.0.0.1 and drive requests to local servers from the victim's browser. Such
// requests carry the attacker's domain in the Host header, so only loopback
// hostnames are accepted.
function isAllowedHost(hostHeader) {
  const host = String(hostHeader || '')
    .toLowerCase()
    .replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed');
  }

  if (!isAllowedHost(req.headers.host)) {
    return send(res, 403, 'Forbidden: this local-only server accepts loopback hostnames only.');
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (url.pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ status: 'ok', mode: 'local-only' }), 'application/json; charset=utf-8');
  }

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    return send(res, 500, 'The prebuilt app was not found. Expected dist/index.html in the application folder.');
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  if (requestedPath === '/') requestedPath = '/index.html';

  const normalized = path.normalize(requestedPath).replace(/^([/\\])+/, '');
  const absolutePath = path.join(distDir, normalized);
  const relativePath = path.relative(distDir, absolutePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return send(res, 403, 'Forbidden');
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return sendFile(res, absolutePath);
  }

  // React owns client-side routing, so unknown static paths fall back to the app shell.
  return sendFile(res, path.join(distDir, 'index.html'));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the other app or set a different PORT.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`eParcel Auditor Local running at http://${HOST}:${PORT}`);
  console.log('Close this window to stop the local server.');
});
