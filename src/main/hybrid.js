'use strict';
// Chất lượng cao = bản đầy đủ (engine MiniMax H3: mọi chức năng) + Tạo video bằng LTX-2.3 (ComfyUI riêng).
// Một máy chủ trung gian (127.0.0.1) đứng trước 2 engine, nói cùng API /freevideo/agent/v1 với giao diện:
//   • việc "generate" mới (trang Tạo video)      → LTX-2.3
//   • mọi việc khác (ảnh, sửa ảnh, lồng tiếng, phụ đề, Autopilot, hoàn thiện / làm tiếp video H3…) → engine bản đầy đủ
//   • Hàng đợi, Thư viện: gộp kết quả 2 bên
// GPU dùng lần lượt: LTX chỉ chạy khi engine bản đầy đủ rảnh (và yêu cầu nó nhả VRAM trước); trong lúc LTX đang chạy,
// việc mới gửi cho engine bản đầy đủ được giữ lại (hiện "Trong hàng đợi") rồi gửi tiếp khi LTX xong và đã nhả VRAM.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const PREFIX = '/freevideo/agent/v1';
const ACTIVE = new Set(['waiting', 'queued', 'running', 'cancelling']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HybridEngine {
  constructor({ full, ltx, emit }) {
    this.full = full;          // Engine (MiniMax H3)
    this.ltx = ltx;            // LiteEngine profile 'pro' (LTX-2.3)
    this.emit = emit || (() => {});
    this.server = null;
    this.url = null;
    this.held = [];            // việc gửi cho engine bản đầy đủ đang được giữ lại: { id, spec, created_at, realId, error }
    this.alias = new Map();    // realId → id giữ chỗ
    this.ltx.gate = () => this.fullIdle();
    this.ltx.afterJob = () => this.releaseLtx();
  }

  // ---------- giao diện Engine (giống Engine / LiteEngine) ----------
  get cfg() { return this.full.cfg; }
  get root() { return this.full.root; }
  defaultRoot() { return this.full.defaultRoot(); }
  adoptExisting() { return this.full.adoptExisting(); }
  setRoot(dir) { this.full.setRoot(dir); return this.status(); }
  machine() { return this.full.machine() && this.ltx.machine() ? this.full.machine() : null; }
  setAutostart(v) { this.full.setAutostart(v); return this.status(); }
  async plan(o) { return this.full.plan(o); }
  async packs() { return this.full.packs(); }
  async packAction(id, action) { return this.full.packAction(id, action); }
  cancel() { const a = this.full.cancel(); const b = this.ltx.cancel(); return a || b; }

  status() {
    const f = this.full.status();
    const l = this.ltx.status();
    const running = f.phase === 'running' && l.phase === 'running' && Boolean(this.url);
    let phase = f.phase;
    if (f.phase === 'running' && !running) phase = l.phase === 'failed' ? 'failed' : l.phase === 'installing' ? 'installing' : 'starting';
    if (running) phase = 'running';
    const ltxInstalling = l.phase === 'installing';
    return {
      ...f, mode: 'pro', phase, installed: Boolean(f.installed && l.installed), url: running ? this.url : null,
      error: f.error || l.error || null, task: f.task || l.task,
      progress: ltxInstalling ? l.progress : f.progress, groups: ltxInstalling ? l.groups : f.groups,
      ltx: { installed: l.installed, phase: l.phase, error: l.error, groups: l.groups },
      engineTag: (f.engineTag || '') + ' + LTX-2.3', auto: this.autoState || f.auto || null,
      log: [...(f.log || []).slice(-30), ...(l.log || []).slice(-30)],
    };
  }

  async install(options = {}) {
    if (!this.full.machine()) await this.full.install(options);
    if (!this.ltx.machine()) await this.ltx.install();
    return this.status();
  }

  async start() {
    if (this.full.state.phase !== 'running') await this.full.start();
    if (this.ltx.state.phase !== 'running') await this.ltx.start();
    await this.openServer();
    this.emit('engine:open', { url: this.url, root: this.full.root, hybrid: true });
    this.emit('engine:status', this.status());
    return this.status();
  }

  async stop() {
    this.closeServer();
    try { await this.ltx.stop(); } catch { /* bỏ qua */ }
    try { await this.full.stop(); } catch { /* bỏ qua */ }
    return this.status();
  }

  auto() {
    if (this.autoTask) return this.status();
    this.autoState = { stage: 'checking', error: null, pack: null };
    const say = (patch) => { this.autoState = { ...this.autoState, ...patch }; this.emit('engine:status', this.status()); };
    this.autoTask = (async () => {
      try {
        if (!this.full.root) { this.full.adoptExisting(); if (!this.full.root) this.full.setRoot(this.full.defaultRoot()); }
        if (!this.full.machine()) { say({ stage: 'install' }); await this.full.install({}); }
        if (!this.ltx.machine()) { say({ stage: 'install' }); await this.ltx.install(); }
        if (!this.url) { say({ stage: 'start' }); await this.start(); }
        say({ stage: 'packs' });
        await this.full.autoPacks((pack) => say({ pack }));
        say({ stage: 'done', pack: null });
      } catch (e) { say({ stage: 'error', error: e.message }); } finally { this.autoTask = null; }
    })();
    return this.status();
  }

  // ---------- phối hợp GPU ----------
  fullToken() { try { return fs.readFileSync(path.join(this.full.root, 'agent', 'token'), 'ascii').trim(); } catch { return ''; } }
  ltxToken() { try { return fs.readFileSync(path.join(this.ltx.root, 'agent', 'token'), 'ascii').trim(); } catch { return ''; } }

  async fullJson(method, route, body) {
    const r = await fetch(this.full.url + PREFIX + route, { method, headers: { Authorization: 'Bearer ' + this.fullToken(), 'content-type': 'application/json', 'X-FreeVideo-Client': 'Max AI' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    return { status: r.status, ok: r.ok, data };
  }

  // Engine bản đầy đủ rảnh (không việc nào đang chạy / chờ, không việc giữ lại) → cho LTX chạy, nhả VRAM của nó trước
  async fullIdle() {
    if (!this.full.url) return false;
    if (this.held.some((h) => !h.realId)) return false;
    const r = await this.fullJson('GET', '/jobs?limit=50');
    if (!r.ok) return false;
    if ((r.data.jobs || []).some((j) => ACTIVE.has(j.status))) return false;
    await this.fullJson('POST', '/gpu/release', {}).catch(() => {});
    return true;
  }

  // LTX xong 1 việc → nhả VRAM của ComfyUI LTX, rồi gửi tiếp các việc đã giữ lại cho engine bản đầy đủ
  async releaseLtx() {
    if (this.ltx.hasWork() && this.held.every((h) => h.realId)) return;
    try { await fetch(this.ltx.comfyUrl + '/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }); } catch { /* bỏ qua */ }
    await this.flushHeld();
  }

  async flushHeld() {
    if (this.flushing || this.ltx.busy()) return;
    this.flushing = true;
    try {
      for (const h of this.held) {
        if (h.realId || h.error) continue;
        const r = await this.fullJson('POST', '/jobs', h.spec);
        const job = r.data && (r.data.job || (r.data.jobs || [])[0] || (r.data.id ? r.data : null));
        if (r.ok && job && job.id) { h.realId = job.id; this.alias.set(job.id, h.id); }
        else h.error = (r.data && r.data.error) || { code: 'error', message: 'Không gửi được việc cho engine' };
      }
      // Bớt các việc giữ chỗ cũ đã gửi xong
      if (this.held.length > 200) this.held = this.held.slice(-200);
    } finally { this.flushing = false; }
  }

  // ---------- máy chủ trung gian ----------
  async openServer() {
    if (this.server) return;
    const port = await freePort();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => send(res, 502, { error: { code: 'unreachable', message: e.message } })));
    await new Promise((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = 'http://127.0.0.1:' + port;
    this.pump = setInterval(() => { if (!this.ltx.busy()) this.flushHeld().catch(() => {}); }, 1500);
  }
  closeServer() {
    if (this.server) { try { this.server.close(); } catch { /* bỏ qua */ } this.server = null; }
    clearInterval(this.pump);
    this.url = null;
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/freevideo/library/delete-batch' && req.method === 'POST') return this.deleteBatch(req, res);
    if (!p.startsWith(PREFIX)) return this.forward(req, res, this.full.url, null);
    // Chỉ máy Max Video AI (giữ token của engine bản đầy đủ) mới được gọi
    if (req.headers.authorization !== 'Bearer ' + this.fullToken()) return send(res, 401, { error: { code: 'unauthorized', message: 'Token missing or incorrect' } });
    const route = p.slice(PREFIX.length);

    if (req.method === 'GET' && (route === '' || route === '/capabilities')) {
      const r = await this.fullJson('GET', route);
      const caps = r.data || {};
      const ltxCaps = this.ltx.caps();
      return send(res, r.status, { ...caps, pro: true, engine_mode: 'pro', engine_title: 'Chất lượng cao', ltx: true,
        limits: { ...(caps.limits || {}), seconds: ltxCaps.limits.seconds },
        quality: ltxCaps.quality, aspects: ltxCaps.aspects, loras: [], features: { ...(caps.features || {}), takes: false, ltx: true } });
    }
    if (req.method === 'GET' && route === '/jobs') return this.listJobs(u, res);
    let m = route.match(/^\/jobs\/([\w-]+)(\/cancel|\/resume|\/events)?$/);
    if (m) {
      const id = m[1];
      if (id.startsWith('x')) return this.forward(req, res, this.ltx.url, this.ltxToken());
      const held = this.held.find((h) => h.id === id);
      if (held) return this.heldJob(req, res, held, m[2] || '');
      return this.forward(req, res, this.full.url, null);
    }
    m = route.match(/^\/library\/(\d{4}-\d{2}-\d{2}\/[0-9a-f]{32})/);
    if (m && this.ltx.isLibraryItem(m[1])) return this.forward(req, res, this.ltx.url, this.ltxToken());
    if (req.method === 'GET' && route === '/library') return this.library(u, res);
    if (req.method === 'POST' && (route === '/jobs' || route === '/plan')) return this.routeJob(req, res, route);
    return this.forward(req, res, this.full.url, null);
  }

  // Việc tạo video mới → LTX; còn lại → engine bản đầy đủ (giữ lại nếu LTX đang dùng GPU)
  async routeJob(req, res, route) {
    const body = await readBody(req);
    const specs = Array.isArray(body.jobs) ? body.jobs : [body];
    const toLtx = (s) => (s.kind || 'generate') === 'generate' && !s.refine_from && !s.continue_from && !s.editor_project && !s.drama;
    if (specs.every(toLtx)) {
      for (const s of specs) await this.copyFirstFrame(s);
      return this.ltxJson(res, 'POST', route, Array.isArray(body.jobs) ? { jobs: specs } : specs[0]);
    }
    if (route === '/plan') return this.fullReply(res, 'POST', route, body);
    if (!this.ltx.busy()) {
      await this.releaseLtx().catch(() => {});
      return this.fullReply(res, 'POST', route, body);
    }
    // LTX đang chạy: giữ lại, trả về việc giữ chỗ "Trong hàng đợi"
    const made = specs.map((spec) => {
      const h = { id: 'h' + crypto.randomBytes(6).toString('hex'), spec, created_at: new Date().toISOString(), realId: null, error: null };
      this.held.push(h);
      return this.heldView(h);
    });
    return send(res, 201, made.length === 1 && !Array.isArray(body.jobs) ? { job: made[0], ...made[0] } : { jobs: made });
  }

  // Ảnh mở đầu đã tải lên engine bản đầy đủ → chép sang ComfyUI của LTX
  async copyFirstFrame(spec) {
    const first = spec.media && spec.media.first && spec.media.first.file;
    if (!first || String(first).startsWith('maxai/')) return;
    const r = await fetch(this.full.url + PREFIX + '/media/input/' + String(first).split('/').map(encodeURIComponent).join('/') + '/file',
      { headers: { Authorization: 'Bearer ' + this.fullToken() } });
    if (!r.ok) return;
    const ext = (path.extname(String(first)) || '.png').toLowerCase();
    const name = crypto.randomBytes(12).toString('hex') + ext;
    const dir = path.join(this.ltx.root, 'ComfyUI', 'input', 'maxai');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
    spec.media = { ...spec.media, first: { file: 'maxai/' + name } };
  }

  heldView(h) {
    return { id: h.id, kind: h.spec.kind || 'generate', status: h.error ? 'failed' : 'queued', client: 'Max AI', created_at: h.created_at, started_at: null, finished_at: null,
      label: h.spec.label, spec: h.spec, error: h.error || undefined,
      progress: h.error ? undefined : { phase: 'queued', label: 'Chờ Tạo video (LTX) xong', queue_position: 1 }, poll_after_ms: 1500 };
  }
  async heldJob(req, res, h, action) {
    if (h.realId) {
      const r = await this.fullJson(req.method, '/jobs/' + h.realId + action, req.method === 'POST' ? await readBody(req) : undefined);
      const fix = (v) => (v && v.id === h.realId ? { ...v, id: h.id } : v);
      const data = r.data && r.data.job ? { ...fix(r.data), job: fix(r.data.job) } : fix(r.data);
      return send(res, r.status, data);
    }
    if (action === '/cancel') {
      this.held = this.held.filter((x) => x !== h);
      return send(res, 200, { ...this.heldView(h), status: 'cancelled', progress: undefined });
    }
    const v = this.heldView(h);
    return send(res, 200, { ...v, job: v });
  }

  async listJobs(u, res) {
    const limit = Math.min(200, Number(u.searchParams.get('limit')) || 50);
    const [a, b] = await Promise.all([
      this.fullJson('GET', '/jobs' + u.search).catch(() => ({ data: { jobs: [] } })),
      this.ltxGet('/jobs' + u.search).catch(() => ({ jobs: [] })),
    ]);
    const fullJobs = (a.data.jobs || []).map((j) => (this.alias.has(j.id) ? { ...j, id: this.alias.get(j.id) } : j));
    const pending = this.held.filter((h) => !h.realId).map((h) => this.heldView(h));
    const all = [...pending, ...fullJobs, ...(b.jobs || [])].sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, limit);
    return send(res, 200, { jobs: all });
  }

  async library(u, res) {
    const limit = Math.min(200, Number(u.searchParams.get('limit')) || 24);
    const q = new URLSearchParams(u.search);
    // Mỗi bên lấy đủ trang rồi gộp theo thời gian; "before" của bên nào thì hỏi bên đó
    const before = q.get('before');
    const qa = new URLSearchParams(q); const qb = new URLSearchParams(q);
    if (before) { if (this.ltx.isLibraryItem(before)) qa.delete('before'); else qb.delete('before'); }
    const [a, b] = await Promise.all([
      this.fullJson('GET', '/library?' + qa).catch(() => ({ data: { items: [] } })),
      this.ltxGet('/library?' + qb).catch(() => ({ items: [] })),
    ]);
    const items = [...(a.data.items || []), ...(b.items || [])].sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    const page = items.slice(0, limit);
    const more = items.length > limit || Boolean(a.data.next) || Boolean(b.next);
    return send(res, 200, { items: page, next: more && page.length ? page[page.length - 1].id : null });
  }

  async deleteBatch(req, res) {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const mine = ids.filter((id) => this.ltx.isLibraryItem(id));
    const rest = ids.filter((id) => !mine.includes(id));
    const out = { deleted: [], skipped: [] };
    if (mine.length) {
      const r = await fetch(this.ltx.url + '/freevideo/library/delete-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: mine }) });
      const j = await r.json().catch(() => ({})); out.deleted.push(...(j.deleted || [])); out.skipped.push(...(j.skipped || []));
    }
    if (rest.length) {
      const r = await fetch(this.full.url + '/freevideo/library/delete-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: rest }) });
      const j = await r.json().catch(() => ({})); out.deleted.push(...(j.deleted || j.moved || [])); out.skipped.push(...(j.skipped || []));
    }
    send(res, 200, out);
  }

  async ltxGet(route) {
    const r = await fetch(this.ltx.url + PREFIX + route, { headers: { Authorization: 'Bearer ' + this.ltxToken() }, signal: AbortSignal.timeout(30000) });
    return r.json();
  }
  async ltxJson(res, method, route, body) {
    const r = await fetch(this.ltx.url + PREFIX + route, { method, headers: { Authorization: 'Bearer ' + this.ltxToken(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(text);
  }
  async fullReply(res, method, route, body) {
    const r = await this.fullJson(method, route, body);
    send(res, r.status, r.data);
  }

  // Chuyển nguyên yêu cầu (kể cả file tải lên, video có Range) sang engine đích
  async forward(req, res, base, token) {
    if (!base) return send(res, 503, { error: { code: 'unreachable', message: 'Engine chưa chạy.' } });
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    if (token) headers.authorization = 'Bearer ' + token;
    const init = { method: req.method, headers, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half'; }
    const r = await fetch(base + req.url, init);
    const out = {};
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
    res.writeHead(r.status, out);
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).pipe(res);
  }
}

function send(res, status, value) {
  if (res.headersSent) return;
  const body = Buffer.from(JSON.stringify(value === undefined ? {} : value));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { const raw = Buffer.concat(chunks).toString('utf8'); resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

module.exports = { HybridEngine };
