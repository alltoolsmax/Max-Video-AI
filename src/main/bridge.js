'use strict';
// Các thao tác mà giao diện được phép yêu cầu. Dùng chung cho Electron (main.js) và bộ chạy thử (dev/harness.js).

const fs = require('fs');
const path = require('path');
const { Connection, normalizeUrl } = require('./freevideo');
const { Device } = require('./device');
const { Engine, legalTexts } = require('./engine');
const { Updater } = require('./updater');
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
    this.quitApp = quit || (() => {});
    this.updater = new Updater({ device: this.device, quit, onProgress: (p) => this.emit('update:progress', p) });
    this.engine = new Engine({ settings: this.settings, save: () => this.save(), emit: (n, p) => this.onEngine(n, p) });
    this.ready = null;
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
      this.engine.adoptExisting();   // cài lại app → tự nhận thư mục engine & mô hình cũ
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

  // Đóng Max AI: tắt engine và dừng việc cài đang chạy (chạy lại sẽ tải tiếp).
  async shutdown() {
    try { this.engine.cancel(); } catch { /* bỏ qua */ }
    try { await this.engine.stop(); } catch { /* bỏ qua */ }
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
  // Max AI chỉ nói chuyện với ENGINE CỦA CHÍNH NÓ (thư mục cài trong mục Engine & mô hình), không dò phần mềm khác trên máy.
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
