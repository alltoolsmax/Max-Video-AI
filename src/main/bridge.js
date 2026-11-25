'use strict';
// Các thao tác mà giao diện được phép yêu cầu. Dùng chung cho Electron (main.js) và bộ chạy thử (dev/harness.js).

const fs = require('fs');
const path = require('path');
const { Connection, detectRoots, findTokenRoots, normalizeUrl } = require('./freevideo');
const { License } = require('./license');
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
    this.license = new License(path.dirname(settingsPath));
    this.updater = new Updater({ license: this.license, quit, onProgress: (p) => this.emit('update:progress', p) });
    this.ready = null;
  }

  // Bản quyền lúc mở + đếm máy mỗi 30 phút + kiểm tra lại bản quyền mỗi 3 giờ + cập nhật mỗi 6 giờ.
  start() {
    if (this.ready) return this.ready;
    this.ready = this.license.startup().catch(() => this.license.local()).then(() => {
      this.license.ping();
      setInterval(() => this.license.ping(), 30 * 60 * 1000).unref?.();
      setInterval(async () => {
        const before = this.license.view().tier;
        try { await this.license.refresh(); } catch { /* giữ trạng thái cũ */ }
        if (this.license.view().tier !== before) this.emit('license:changed', this.license.view());
      }, 3 * 3600 * 1000).unref?.();
      const autoCheck = async () => {
        try { const r = await this.updater.check(); if (r.available) this.emit('update:available', r); } catch { /* thử lại lần sau */ }
      };
      setInterval(autoCheck, 6 * 3600 * 1000).unref?.();
    });
    return this.ready;
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
  async autoConfigure() {
    if (!this.settings.root && !this.settings.token) {
      const roots = await detectRoots();
      if (roots.length) {
        this.settings.root = roots[0];
        const endpoint = new Connection({ root: roots[0] }).endpointUrl();
        if (endpoint && !this.settings.url) this.settings.url = endpoint;
        this.save();
      }
    } else if (this.settings.root && this.settings.followEndpoint !== false) {
      // FreeVideo ghi lại cổng mỗi lần khởi động; đi theo nó nếu người dùng không tự đặt URL.
      const endpoint = this.connection.endpointUrl();
      if (endpoint && endpoint !== this.connection.url && !this.settings.urlPinned) {
        this.settings.url = endpoint;
        this.save();
      }
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
      case 'config:detect':
        return detectRoots();
      case 'config:pickRoot': {
        const folder = await this.dialogs.pickFolder();
        if (!folder) return null;
        const roots = [...await findTokenRoots(folder, 4)];
        if (!roots.length) return { folder, found: false };
        this.settings.root = roots[0];
        const endpoint = new Connection({ root: roots[0] }).endpointUrl();
        if (endpoint && !this.settings.urlPinned) this.settings.url = endpoint;
        this.save();
        return { folder, found: true, root: roots[0], config: this.config() };
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
      case 'media:save': {
        const target = await this.dialogs.saveFile(args.name || 'max-ai-output');
        if (!target) return { ok: false, cancelled: true };
        return this.connection.download(String(args.route || ''), target);
      }
      // ---------- bản quyền, mua key, cập nhật (máy chủ active.mrhuynh.net/maxai)
      case 'app:info':
        return { name: PKG.productName, version: PKG.version, machine: this.license.machine, platform: process.platform };
      case 'license:get':
        await this.start();
        return this.license.view();
      case 'license:refresh':
        return wrap(async () => { await this.license.refresh(); return this.license.view(); });
      case 'license:activate':
        return wrap(async () => { const r = await this.license.activate(String(args.key || '')); this.emit('license:changed', this.license.view());
          return { ...this.license.view(), renewed: r.renewed, added_days: r.added_days }; });
      case 'license:plans':
        return wrap(() => this.license.plans());
      case 'license:guides':
        return wrap(() => this.license.guides());
      case 'license:order':
        return wrap(() => this.license.order(String(args.plan || '')));
      case 'license:orderStatus':
        return wrap(() => this.license.orderStatus(String(args.code || '')));
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
