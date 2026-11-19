'use strict';

/**
 * Firefly Cove — local web server.
 *
 * Serves the browser experience and bridges it to the SmartSpectra SDK
 * session (server/spectra.js). The camera is owned by the SDK in THIS
 * process (the Node SDK's headless camera path); the browser never touches
 * the camera directly and only receives derived metrics over SSE.
 *
 * Everything is local: the server binds to 127.0.0.1 by default and stores
 * nothing.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { SpectraSession } = require('./spectra');

// --- tiny .env loader (no dependency) -------------------------------------
function loadDotEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* no .env file — environment variables alone are fine */
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

// --- configuration ---------------------------------------------------------
const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const PORT = Number(argValue('--port') || process.env.PORT || 4399);
const DEFAULT_SOURCE =
  argValue('--source') || process.env.SOURCE || 'camera';
const DEFAULT_VIDEO = argValue('--video') || process.env.VIDEO_PATH || '';
const API_KEY =
  process.env.SMARTSPECTRA_API_KEY || process.env.PHYSIOLOGY_API_KEY || '';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// --- SSE broadcast -----------------------------------------------------------
const clients = new Set();
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

const session = new SpectraSession(broadcast);

// --- helpers -----------------------------------------------------------------
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// --- server --------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(
      `data: ${JSON.stringify({
        type: 'hello',
        hasApiKey: Boolean(API_KEY),
        running: session.isRunning,
        cameras: safeCameras(),
      })}\n\n`
    );
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/cameras') {
    return sendJson(res, 200, { cameras: safeCameras() });
  }

  if (url.pathname === '/api/status') {
    return sendJson(res, 200, {
      running: session.isRunning,
      hasApiKey: Boolean(API_KEY),
      defaultSource: DEFAULT_SOURCE,
    });
  }

  if (url.pathname === '/api/start' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const source = body.source || DEFAULT_SOURCE;
    const videoPath = body.videoPath || DEFAULT_VIDEO;
    try {
      session.start({ apiKey: API_KEY, source, videoPath });
      return sendJson(res, 200, { ok: true, source });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        code: err.code ?? null,
        message: err.message,
      });
    }
  }

  if (url.pathname === '/api/stop' && req.method === 'POST') {
    await session.stop();
    return sendJson(res, 200, { ok: true });
  }

  // static files
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
});

function safeCameras() {
  try {
    return SpectraSession.availableCameras();
  } catch {
    return [];
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Firefly Cove is running at http://127.0.0.1:${PORT}`);
  console.log(
    API_KEY
      ? 'SmartSpectra API key: configured.'
      : 'SmartSpectra API key: NOT set — copy .env.example to .env and add your free key.'
  );
  const cameras = safeCameras();
  console.log(
    cameras.length
      ? `Cameras detected: ${cameras.map((c) => c.name || c.id).join(', ')}`
      : 'Cameras detected: none (camera mode needs a webcam; file mode works without one).'
  );
});

async function shutdown() {
  await session.stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
