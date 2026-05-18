import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const distDir = path.join(__dirname, 'dist');

// Local security mode: this server is dependency-free, binds to 127.0.0.1 by default,
// uses the normal Windows user account, and does not require admin rights, Docker, WSL,
// registry changes, Windows services, or a local npm install when the prebuilt dist folder exists.

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
    'X-Content-Type-Options': 'nosniff',
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
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (url.pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ status: 'ok', mode: 'local-only' }), 'application/json; charset=utf-8');
  }

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    return send(
      res,
      500,
      'The prebuilt app was not found. Expected dist/index.html in the application folder.'
    );
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

  if (!absolutePath.startsWith(distDir)) {
    return send(res, 403, 'Forbidden');
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return sendFile(res, absolutePath);
  }

  // Single-page app fallback.
  return sendFile(res, path.join(distDir, 'index.html'));
});

server.on('error', (err) => {
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
