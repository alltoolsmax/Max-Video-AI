'use strict';
// Các thao tác mà giao diện được phép yêu cầu. Dùng chung cho Electron (main.js) và bộ chạy thử (dev/harness.js).

const fs = require('fs');
const path = require('path');
const { Connection, normalizeUrl } = require('./freevideo');
const { Device } = require('./device');
const { Engine, legalTexts } = require('./engine');
const { LiteEngine } = require('./lite');
const hardware = require('./hardware');
const { Updater } = require('./updater');
const { Gpt, SYSTEM: AI_SYSTEM, userText: aiUserText } = require('./gpt');
const { License } = require('./license');
const PKG = require('../../package.json');

const MEDIA_EXT = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  audio: ['wav', 'flac', 'm4a', 'mp3', 'ogg'],
};

class Bridge {
  constructor({ settingsPath, dialogs, emit, quit }) {
    this.settingsPath = settingsPath;
    this.dialogs = dialogs; // { pickFolder(), pickFiles(filters, multi), saveFile(name), openExternal(url) }
    this.emit = emit || (() => {});
    this.settings = this.load();
    this.connection = new Connection(this.settings);
    this.allowedFiles = new Set(); // chỉ upload những file người dùng đã chọn qua hộp thoại
    this.device = new Device(path.dirname(settingsPath));
    this.license = new License(path.dirname(settingsPath));
    this.license.local();
    this.device.tier = () => (this.license.view().ok ? 'pro' : 'free');
    this.quitApp = quit || (() => {});
    this.updater = new Updater({ device: this.device, quit, onProgress: (p) => this.emit('update:progress', p) });
    this.fullEngine = new Engine({ settings: this.settings, save: () => this.save(), emit: (n, p) => this.onEngine(n, p) });
    // Chế độ nhẹ (Wan 2.2 5B qua ComfyUI) cho máy card NVIDIA yếu — chọn tự động theo kết quả kiểm tra máy
    this.liteEngine = new LiteEngine({ settings: this.settings, save: () => this.save(), emit: (n, p) => this.onEngine(n, p), hardware: () => hardware.check() });
    this.gpt = new Gpt({ settings: this.settings, save: () => this.save() });
    this.ready = null;
  }

  get mode() { return (this.settings.engine && this.settings.engine.mode) || 'full'; }
  get engine() { return this.mode === 'lite' ? this.liteEngine : this.fullEngine; }

  // Chọn chế độ theo máy (lần đầu): đủ mạnh → bản đầy đủ, card yếu → chế độ nhẹ, không đủ → không tự cài gì
  async chooseMode() {
    const cfg = (this.settings.engine ||= {});
    if (cfg.mode) return cfg.mode;
    const hw = await hardware.check();
    // Máy đã cài bản đầy đủ từ trước thì giữ nguyên
    if (this.fullEngine.root && this.fullEngine.machine()) cfg.mode = 'full';
    else if (hw.tier === 'lite') cfg.mode = 'lite';
    else if (hw.tier === 'full' || hw.tier === 'unknown') cfg.mode = 'full';
    else return 'none';
    this.save();
    return cfg.mode;
  }

  async setMode(mode) {
    if (!['full', 'lite'].includes(mode)) throw new Error('Chế độ không hợp lệ');
    if (mode === this.mode && this.settings.engine && this.settings.engine.mode) return this.engine.status();
    const old = this.engine;
    try { old.cancel(); } catch { /* bỏ qua */ }
    try { await old.stop(); } catch { /* bỏ qua */ }
    (this.settings.engine ||= {}).mode = mode;
    this.save();
    this.emit('engine:status', this.engine.status());
    return this.engine.status();
  }

  // Khi engine trong máy mở xong: trỏ kết nối tới đúng engine đó (token ở <thư mục cài>/agent/token).
  onEngine(name, payload) {
    if (name === 'engine:open') {
      this.settings.root = payload.root;
      this.settings.url = payload.url;
      this.settings.urlPinned = false;
      delete this.settings.token;
      this.save();
    }
    this.emit(name === 'engine:open' ? 'engine:status' : name, name === 'engine:open' ? this.engine.status() : payload);
  }

  // Đếm máy (lúc mở + mỗi 30 phút), kiểm tra cập nhật mỗi 6 giờ, tự bật engine nếu đã cài.
  start() {
    if (this.ready) return this.ready;
    this.ready = Promise.resolve().then(() => {
      this.fullEngine.adoptExisting();   // cài lại app → tự nhận thư mục engine & mô hình cũ
      // Bản quyền: kiểm tra lúc mở + mỗi 6 giờ (máy chủ cho dùng offline tối đa 3 ngày)
      const lic = async () => { try { await this.license.startup(); } catch { /* giữ trạng thái cũ */ } this.emit('license:changed', this.license.view()); };
      lic();
      setInterval(lic, 6 * 3600 * 1000).unref?.();
      this.device.ping();
      setInterval(() => this.device.ping(), 30 * 60 * 1000).unref?.();
      const autoCheck = async () => {
        try { const r = await this.updater.check(); if (r.available) this.emit('update:available', r); } catch { /* thử lại lần sau */ }
      };
      setInterval(autoCheck, 6 * 3600 * 1000).unref?.();
      if (this.engine.root && this.engine.machine() && this.engine.cfg.autostart !== false) {
        this.engine.start().catch(() => { /* lỗi hiện ở trang Engine */ });
      }
    });
    return this.ready;
  }

  // Đóng Max Video AI: tắt engine và dừng việc cài đang chạy (chạy lại sẽ tải tiếp).
  async shutdown() {
    for (const e of [this.fullEngine, this.liteEngine]) {
      try { e.cancel(); } catch { /* bỏ qua */ }
      try { await e.stop(); } catch { /* bỏ qua */ }
    }
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')); } catch { return {}; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    this.connection = new Connection(this.settings);
  }

  // Lần đầu chạy: tự dò thư mục cài đặt và cổng.
  // Max Video AI chỉ nói chuyện với ENGINE CỦA CHÍNH NÓ (thư mục cài trong mục Engine & mô hình), không dò phần mềm khác trên máy.
  async autoConfigure() {
    this.engine.adoptExisting();
    const root = this.engine.root;
    if (root && this.settings.root !== root) {
      this.settings.root = root;
      delete this.settings.token;
      this.save();
    }
  }

  config() {
    return {
      url: this.connection.url,
      root: this.settings.root || null,
      hasToken: Boolean(this.connection.token()),
      manualToken: Boolean(this.settings.token),
      urlPinned: Boolean(this.settings.urlPinned),
      prefs: this.settings.prefs || {},
    };
  }

  // Mô hình viết prompt của engine: gọi thẳng /freevideo/prompt-vlm (token riêng), không qua Hàng đợi
  async pvlm(args = {}) {
    const url = this.engine.url;
    if (!url) throw Object.assign(new Error('Engine chưa chạy.'), { code: 'engine_off' });
    const action = String(args.action || 'info');
    if (!['info', 'rewrite', 'ask', 'status', 'cancel', 'install'].includes(action)) throw new Error('invalid_request');
    if (!['info', 'status', 'cancel'].includes(action) && !this.license.view().ok) {
      throw Object.assign(new Error('Cần kích hoạt bản quyền để dùng chức năng này.'), { code: 'no_license' });
    }
    const info = async () => {
      const res = await fetch(url + '/freevideo/prompt-vlm', { signal: AbortSignal.timeout(30000) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(j.error || 'setup_required'), { code: j.error || 'setup_required' });
      this.pvlmToken = j.token;
      return j;
    };
    if (action === 'info') { const j = await info(); delete j.token; return j; }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.pvlmToken) await info();
      const res = await fetch(url + '/freevideo/prompt-vlm/' + action, { method: 'POST',
        headers: { 'content-type': 'application/json', 'X-FreeVideo-Prompt': this.pvlmToken },
        body: JSON.stringify(args.body || {}), signal: AbortSignal.timeout(30000) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 403 && j.error === 'reload' && attempt === 0) { this.pvlmToken = null; continue; }
      if (!res.ok) throw Object.assign(new Error(j.error || ('HTTP ' + res.status)), { code: j.error || 'error' });
      return j;
    }
    throw new Error('reload');
  }

  async handle(channel, args = {}) {
    switch (channel) {
      case 'config:get':
        await this.start();
        await this.autoConfigure();
        return this.config();
      case 'config:set': {
        if ('url' in args) {
          this.settings.url = args.url ? normalizeUrl(args.url) : undefined;
          this.settings.urlPinned = Boolean(args.url);
        }
        if ('root' in args) this.settings.root = args.root || undefined;
        if ('token' in args) this.settings.token = args.token ? String(args.token).trim() : undefined;
        if ('prefs' in args && args.prefs && typeof args.prefs === 'object') {
          this.settings.prefs = { ...(this.settings.prefs || {}), ...args.prefs };
        }
        this.save();
        return this.config();
      }
      case 'api':
        // Chưa có bản quyền: chỉ được xem (GET) và ước tính (/plan), không được tạo
        if (!this.license.view().ok && String(args.method || 'GET').toUpperCase() !== 'GET' && !/^\/(plan)(\?|$)/.test(String(args.route || ''))) {
          return { ok: false, status: 402, error: { code: 'no_license', message: 'Cần kích hoạt bản quyền để dùng chức năng này.' } };
        }
        return this.connection.request(String(args.method || 'GET').toUpperCase(), String(args.route || ''), args.body);
      case 'files:pick': {
        const kinds = Array.isArray(args.kinds) && args.kinds.length ? args.kinds : ['image'];
        const extensions = kinds.flatMap((kind) => MEDIA_EXT[kind] || []);
        const picked = await this.dialogs.pickFiles([{ name: 'Media', extensions }], Boolean(args.multiple));
        return (picked || []).map((file) => {
          this.allowedFiles.add(file);
          const ext = path.extname(file).slice(1).toLowerCase();
          const kind = Object.keys(MEDIA_EXT).find((k) => MEDIA_EXT[k].includes(ext)) || 'image';
          let size = 0;
          try { size = fs.statSync(file).size; } catch { /* bỏ qua */ }
          return { path: file, name: path.basename(file), kind, size };
        });
      }
      case 'files:dropped': {
        // File được kéo-thả vào cửa sổ (preload lấy đường dẫn thật qua webUtils).
        const file = String(args.path || '');
        const ext = path.extname(file).slice(1).toLowerCase();
        const kind = Object.keys(MEDIA_EXT).find((k) => MEDIA_EXT[k].includes(ext));
        if (!file || !kind || !fs.existsSync(file)) return null;
        this.allowedFiles.add(file);
        return { path: file, name: path.basename(file), kind, size: fs.statSync(file).size };
      }
      case 'files:upload':
        if (!this.allowedFiles.has(args.path)) {
          return { ok: false, status: 0, error: { code: 'not_picked', message: 'Hãy chọn file qua hộp thoại trước.' } };
        }
        return this.connection.upload(args.path);
      case 'files:import':   // video/âm thanh đưa vào dự án dựng (phụ đề, lồng tiếng)
        if (!this.allowedFiles.has(args.path)) {
          return { ok: false, status: 0, error: { code: 'not_picked', message: 'Hãy chọn file qua hộp thoại trước.' } };
        }
        return this.connection.upload(args.path, '/imports');
      case 'media:save': {
        const target = await this.dialogs.saveFile(args.name || 'max-ai-output');
        if (!target) return { ok: false, cancelled: true };
        return this.connection.download(String(args.route || ''), target);
      }
      // ---------- bản quyền, mua key, cập nhật (máy chủ active.mrhuynh.net/maxai)
      case 'app:info':
        return { name: PKG.productName, version: PKG.version, machine: this.device.machine, platform: process.platform };
      case 'legal:texts':
        return legalTexts();
      case 'app:quit':
        return this.quitApp();
      case 'guides':
        return wrap(() => this.device.guides());
      // ---------- engine AI trong máy (giống FreeVideo)
      case 'engine:status':
        return this.engine.status();
      case 'engine:pickRoot': {
        const folder = await this.dialogs.pickFolder('Chọn thư mục cài engine & mô hình (cần khoảng 70 GB trống)');
        if (!folder) return null;
        const dir = /maxai-engine$/i.test(folder) ? folder : path.join(folder, 'MaxAI-Engine');
        return this.engine.setRoot(dir);
      }
      case 'engine:useDefault':
        return this.engine.setRoot(this.engine.defaultRoot());
      case 'engine:plan':
        return wrap(() => this.engine.plan(args || {}));
      case 'engine:install':
        return wrap(() => this.engine.install(args || {}));
      case 'engine:cancel':
        return this.engine.cancel();
      case 'engine:start':
        return wrap(() => this.engine.start());
      case 'engine:stop':
        return wrap(() => this.engine.stop());
      case 'library:delete':   // xoá video trong Thư viện (engine giữ 10 giây để hoàn tác rồi xoá hẳn)
        return wrap(async () => {
          const url = this.engine.url;
          if (!url) throw new Error('Engine chưa chạy.');
          const ids = (Array.isArray(args.ids) ? args.ids : []).filter((x) => typeof x === 'string' && /^[\w.-]+\/[\w.-]+$/.test(x));
          if (!ids.length) throw new Error('Chưa chọn video nào.');
          const out = { deleted: 0, skipped: [] };
          for (let i = 0; i < ids.length; i += 500) {
            const res = await fetch(url + '/freevideo/library/delete-batch', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ids: ids.slice(i, i + 500) }), signal: AbortSignal.timeout(60000) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.reason ? 'Không xoá được: ' + j.reason : 'Không xoá được (HTTP ' + res.status + ')');
            out.deleted += (j.deleted || j.moved || []).length || 0;
            out.skipped.push(...(j.skipped || []));
          }
          return out;
        });
      case 'pvlm':   // gọi thẳng mô hình viết prompt của engine (không đi qua Hàng đợi)
        return wrap(() => this.pvlm(args).catch((e) => {
          if (e instanceof TypeError || e.name === 'TimeoutError') throw Object.assign(new Error('Không kết nối được engine — thử lại sau giây lát.'), { code: 'engine_off' });
          throw e;
        }));
      case 'ai:prompt':   // lời nhắn cho mô hình viết prompt trên máy — dùng chung hướng dẫn với ChatGPT
        return { system: AI_SYSTEM[args.task] || '', user: aiUserText(args.task, args.input || {}) };
      case 'gpt:info':
        return this.gpt.info();
      case 'gpt:set':
        return this.gpt.setKey(args.key, args.model);
      case 'gpt:test':
        return wrap(() => this.gpt.test(args && args.key));
      case 'license:get':
        return this.license.view();
      case 'license:refresh':
        return wrap(async () => { await this.license.refresh(); return this.license.view(); });
      case 'license:activate':
        return wrap(async () => { const r = await this.license.activate(String(args.key || '')); this.emit('license:changed', this.license.view()); return { ...this.license.view(), renewed: r.renewed, added_days: r.added_days }; });
      case 'license:plans':
        return wrap(() => this.license.plans());
      case 'license:order':
        return wrap(() => this.license.order(String(args.plan || '')));
      case 'license:orderStatus':
        return wrap(() => this.license.orderStatus(String(args.code || '')));
      case 'gpt:run':
        if (!this.license.view().ok) return { ok: false, error: { code: 'no_license', message: 'Cần kích hoạt bản quyền để dùng chức năng này.' } };
        return wrap(() => this.gpt.run(String(args.task || ''), args.input || {}));
      case 'engine:auto': {
        const mode = await this.chooseMode();
        if (mode === 'none') {
          const hw = await hardware.check();
          return { ...this.engine.status(), unsupported: true, hardware: hw,
            auto: { stage: 'unsupported', error: (hw.reasons || []).join(' ') || 'Máy này không đủ cấu hình để tạo video.' } };
        }
        return this.engine.auto();
      }
      case 'hw:check':
        return wrap(async () => ({ ...(await hardware.check()), mode: this.mode, modeChosen: Boolean(this.settings.engine && this.settings.engine.mode) }));
      case 'engine:mode':
        return wrap(() => this.setMode(String(args.mode || '')));
      case 'engine:packs':
        return wrap(() => this.engine.packs());
      case 'engine:pack':
        return wrap(() => this.engine.packAction(String(args.id || ''), args.action === 'cancel' ? 'cancel' : 'install'));
      case 'engine:autostart':
        return this.engine.setAutostart(args.value);
      case 'engine:pickModels': {
        const folder = await this.dialogs.pickFolder('Chọn thư mục mô hình có sẵn để dùng lại (không bắt buộc)');
        return folder || null;
      }
      case 'update:check':
        return wrap(() => this.updater.check());
      case 'update:download':
        return wrap(() => this.updater.download());
      case 'update:install':
        return wrap(() => this.updater.install());
      case 'shell:open': {
        const url = String(args.url || '');
        if (/^(https:\/\/|mailto:)/i.test(url) && this.dialogs.openExternal) await this.dialogs.openExternal(url);
        return true;
      }
      default:
        throw new Error('Unknown channel ' + channel);
    }
  }
}

// Lỗi của bản quyền / cập nhật → {ok:false, error:{code,message}} để giao diện hiện thông báo dễ hiểu.
async function wrap(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: { code: e.code || 'error', message: e.message || String(e) } }; }
}

module.exports = { Bridge, MEDIA_EXT };
