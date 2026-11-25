'use strict';
// Chạy giao diện trong trình duyệt thường (không cần Electron) để thử nhanh: node dev/harness.js
// Dùng đúng src/main/bridge.js như app thật; hộp thoại chọn file được thay bằng file mẫu.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { Bridge } = require('../src/main/bridge');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.HARNESS_PORT || 5173);
const settingsPath = path.join(os.tmpdir(), 'maxai-harness/settings.json');
if (process.env.HARNESS_FRESH) fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true });
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

const clients = new Set();
const bridge = new Bridge({
  settingsPath,
  emit: (name, payload) => { for (const res of clients) res.write(`data: ${JSON.stringify({ name, payload })}\n\n`); },
  quit: () => console.log('[harness] app sẽ thoát để cài bản cập nhật'),
  dialogs: {
    openExternal: async (url) => console.log('[harness] mở liên kết:', url),
    pickFolder: async () => path.join(__dirname),
    pickFiles: async () => [path.join(__dirname, 'mock_data', 'samples', 'image.png')],
    saveFile: async (name) => path.join(os.tmpdir(), name),
  },
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/__bridge') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { channel, args } = JSON.parse(raw || '{}');
      const value = await bridge.handle(channel, args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(value ?? null));
    }
    if (url.pathname === '/__events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/__media/')) {
      const route = url.pathname.slice('/__media'.length) + url.search;
      const upstream = await bridge.connection.media(route, req.headers.range);
      const headers = {};
      upstream.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(upstream.status, headers);
      if (upstream.body) return Readable.fromWeb(upstream.body).pipe(res);
      return res.end();
    }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/src/renderer/index.html' }); return res.end(); }
    if (url.pathname === '/__shot') { res.end(); return; }
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (file.endsWith('index.html')) {
      body = body.toString().replace('<script src="js/core.js"></script>', '<script src="/dev/shim.js"></script>\n  <script src="js/core.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    console.error(error);
    res.writeHead(500); res.end(String(error));
  }
}).listen(PORT, '127.0.0.1', () => console.log('Harness: http://127.0.0.1:' + PORT + '/'));
