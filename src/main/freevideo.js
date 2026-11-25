'use strict';
// Kết nối tới FreeVideo agent API (/freevideo/agent/v1) — chạy trong main process, không phụ thuộc Electron.
// Token chỉ nằm ở đây; giao diện (renderer) không bao giờ thấy token.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PREFIX = '/freevideo/agent/v1';
const CLIENT_NAME = 'Max AI';
const DEFAULT_URL = 'http://127.0.0.1:8188';
const SKIP_DIRS = new Set(['node_modules', '.git', 'models', 'venv', '.venv', 'output', 'input', 'temp',
  'user', '__pycache__', 'web', 'site-packages', 'Lib', 'lib', 'python_embeded', '.cache']);

class Connection {
  constructor(settings = {}) {
    this.url = normalizeUrl(settings.url || DEFAULT_URL);
    this.root = settings.root || null;      // thư mục cài đặt FreeVideo (chứa agent/token)
    this.manualToken = settings.token || null;
  }

  // Token: ưu tiên token nhập tay, sau đó <root>/agent/token. Đọc lại mỗi lần vì FreeVideo có thể tạo lại token.
  token() {
    if (this.manualToken) return this.manualToken.trim();
    if (!this.root) return null;
    try { return fs.readFileSync(path.join(this.root, 'agent', 'token'), 'ascii').trim() || null; } catch { return null; }
  }

  // endpoint.json do FreeVideo ghi lúc khởi động: cho biết đúng cổng ComfyUI đang chạy.
  endpointUrl() {
    if (!this.root) return null;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(this.root, 'agent', 'endpoint.json'), 'utf8'));
      return value && typeof value.url === 'string' ? normalizeUrl(value.url) : null;
    } catch { return null; }
  }

  baseUrl() { return this.url; }

  headers(extra = {}) {
    const token = this.token();
    const headers = { 'X-FreeVideo-Client': CLIENT_NAME, ...extra };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  // Gọi một route của agent API; luôn trả {ok, status, data} — không ném lỗi ra renderer.
  async request(method, route, body, { timeoutMs = 60000 } = {}) {
    if (!isSafeRoute(route)) return fail(0, 'invalid_request', 'Đường dẫn API không hợp lệ.');
    if (!this.token()) return fail(0, 'no_token', 'Chưa tìm thấy token của FreeVideo. Hãy chọn thư mục cài đặt FreeVideo trong Cài đặt.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init = { method, headers: this.headers(), signal: controller.signal, redirect: 'error' };
      if (body !== undefined && body !== null && method !== 'GET') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(this.url + PREFIX + route, init);
      return await readReply(response);
    } catch (error) {
      if (error.name === 'AbortError') return fail(0, 'timeout', 'FreeVideo không trả lời kịp.');
      return fail(0, 'unreachable', 'Không kết nối được tới FreeVideo tại ' + this.url + '. Hãy mở FreeVideo/ComfyUI trước.');
    } finally {
      clearTimeout(timer);
    }
  }

  // Tải một file trên máy lên /media (multipart, đọc dần từ đĩa nên file lớn vẫn ổn).
  async upload(filePath) {
    if (!this.token()) return fail(0, 'no_token', 'Chưa có token của FreeVideo.');
    let stat;
    try { stat = await fsp.stat(filePath); } catch { return fail(0, 'invalid_media', 'Không đọc được file này.'); }
    if (!stat.isFile() || stat.size === 0) return fail(0, 'invalid_media', 'File rỗng hoặc không hợp lệ.');
    if (stat.size > 2 * 1024 ** 3) return fail(413, 'too_large', 'File lớn hơn 2 GB.');
    const suffix = path.extname(filePath).toLowerCase();
    if (!/^\.[a-z0-9]+$/.test(suffix)) return fail(0, 'invalid_media', 'Phần mở rộng của file không hợp lệ.');
    const form = new FormData();
    // Giống client chính thức: chỉ gửi đuôi file, không gửi tên/đường dẫn thật.
    form.append('file', await fs.openAsBlob(filePath), 'media' + suffix);
    try {
      const response = await fetch(this.url + PREFIX + '/media', {
        method: 'POST', headers: this.headers(), body: form, redirect: 'error', signal: AbortSignal.timeout(600000) });
      const reply = await readReply(response);
      if (reply.ok && reply.data) reply.data.original_name = path.basename(filePath);
      return reply;
    } catch {
      return fail(0, 'unreachable', 'Không tải được file lên FreeVideo.');
    }
  }

  // Chuyển tiếp yêu cầu media (video/ảnh/thumbnail) có kèm token; giữ header Range để tua video.
  async media(route, rangeHeader) {
    if (!route.startsWith(PREFIX + '/') || !isSafeRoute(route.slice(PREFIX.length))) {
      return new Response('Not found', { status: 404 });
    }
    const headers = this.headers(rangeHeader ? { Range: rangeHeader } : {});
    try {
      const upstream = await fetch(this.url + route, { headers, redirect: 'error' });
      const out = new Headers();
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
        const value = upstream.headers.get(key);
        if (value) out.set(key, value);
      }
      out.set('Cache-Control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch {
      return new Response('Unreachable', { status: 502 });
    }
  }

  // Lưu một file media về máy.
  async download(route, target) {
    const response = await this.media(route);
    if (!response.ok || !response.body) return fail(response.status, 'download_failed', 'Không tải được file.');
    const { Readable } = require('stream');
    const { pipeline } = require('stream/promises');
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));
    return { ok: true, status: 200, data: { path: target } };
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return DEFAULT_URL;
    return url.origin;
  } catch { return DEFAULT_URL; }
}

function isSafeRoute(route) {
  return typeof route === 'string' && (route === '' || route.startsWith('/')) && !route.startsWith('//')
    && !route.includes('\\') && !/(^|\/)\.\.(\/|$|\?)/.test(route);
}

async function readReply(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (response.ok) return { ok: true, status: response.status, data };
  const problem = (data && data.error) || {};
  return {
    ok: false, status: response.status,
    error: { code: problem.code || 'http_' + response.status, message: problem.message || text.slice(0, 300) || response.statusText,
      next: problem.next, details: problem.details },
  };
}

function fail(status, code, message) {
  return { ok: false, status, error: { code, message } };
}

// Các nơi FreeVideo thường được cài; trả về những thư mục có agent/token.
function candidateRoots() {
  const home = os.homedir();
  const list = [];
  if (process.env.FREEVIDEO_HOME) list.push(process.env.FREEVIDEO_HOME);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    list.push(path.join(local, 'FreeVideo'), path.join(home, 'FreeVideo'), 'C:\\FreeVideo', 'D:\\FreeVideo');
  } else if (process.platform === 'darwin') {
    list.push(path.join(home, 'Library', 'Application Support', 'FreeVideo'), path.join(home, 'FreeVideo'),
      path.join(home, 'ComfyUI', 'custom_nodes', 'FreeVideo'));
  } else {
    list.push(path.join(home, '.local', 'share', 'freevideo'), path.join(home, 'FreeVideo'),
      path.join(home, 'ComfyUI', 'custom_nodes', 'FreeVideo'));
  }
  return list;
}

// Tìm thư mục chứa agent/token bên trong `start` (đi sâu tối đa `depth` cấp, bỏ qua thư mục nặng).
async function findTokenRoots(start, depth = 4, found = new Set()) {
  try {
    await fsp.access(path.join(start, 'agent', 'token'));
    found.add(path.resolve(start));
  } catch { /* không có ở đây */ }
  if (depth <= 0 || found.size >= 8) return found;
  let entries = [];
  try { entries = await fsp.readdir(start, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') && entry.name !== '.freevideo') continue;
    await findTokenRoots(path.join(start, entry.name), depth - 1, found);
  }
  return found;
}

async function detectRoots() {
  const found = new Set();
  for (const root of candidateRoots()) await findTokenRoots(root, 4, found);
  return [...found];
}

module.exports = { Connection, detectRoots, findTokenRoots, normalizeUrl, isSafeRoute, PREFIX, DEFAULT_URL };
