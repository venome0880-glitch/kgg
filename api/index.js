const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[extension] || 'application/octet-stream';

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', ['.html', '.css', '.js'].includes(extension) ? 'no-store' : 'public, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
}

async function proxyToBot(req, res, pathname) {
  const baseUrl = process.env.DASHBOARD_API_BASE_URL || process.env.BOT_DASHBOARD_URL || process.env.DASHBOARD_PUBLIC_URL;
  if (!baseUrl) {
    return sendJson(res, 503, {
      error: 'Dashboard proxy is not configured. Set DASHBOARD_API_BASE_URL or BOT_DASHBOARD_URL on the Vercel project.',
    });
  }

  const requestUrl = new URL(pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), baseUrl.replace(/\/+$/, ''));
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const upstream = await fetch(requestUrl, {
    method: req.method,
    headers,
    body: body && body.length ? body : undefined,
  });

  const responseBody = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (['content-encoding', 'transfer-encoding'].includes(key)) return;
    res.setHeader(key, value);
  });
  res.end(responseBody);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://neonweb.local');
  const pathname = url.pathname;

  if (pathname.startsWith('/api/') || pathname === '/login' || pathname === '/logout' || pathname.startsWith('/auth/')) {
    return proxyToBot(req, res, pathname);
  }

  if (pathname.startsWith('/assets/')) {
    const assetPath = path.join(PUBLIC_DIR, pathname.replace(/^\/assets\//, ''));
    if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
      return sendFile(res, assetPath);
    }

    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendFile(res, INDEX_FILE);
  }

  const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath);
  }

  return sendFile(res, INDEX_FILE);
};
