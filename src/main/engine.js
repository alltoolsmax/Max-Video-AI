'use strict';
// Max AI Engine — engine AI chạy NGAY TRÊN MÁY của người dùng, đóng gói sẵn trong bộ cài Max Video AI (thư mục engine/, chỉ là mã,
// KHÔNG có mô hình). Sau khi người dùng mở Max Video AI và bấm Cài, engine mới tải môi trường + mô hình về máy rồi chạy local.
//
//  Bước 1  chép mã engine (đi kèm bộ cài) vào <thư mục cài>/engine
//  Bước 2  kiểm tra máy: `setup --plan --json`  (GPU, VRAM, RAM, ổ đĩa, dung lượng tải)
//  Bước 3  cài: `setup --yes --accept-model-license` (tải tiếp được nếu đứt mạng; file đã tải được giữ lại)
//  Bước 4  bật engine: engine_host.py (chạy bằng Python của engine) cài ComfyUI nếu thiếu rồi mở ở 127.0.0.1
//  Mô hình thêm (ảnh, tách nền, AI viết prompt, lồng tiếng, phụ đề, nhạc): tải riêng từng gói khi engine đang chạy.
// Giao diện nói chuyện với engine qua API cục bộ /freevideo/agent/v1 (token trong <thư mục cài>/agent/token).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ENGINE = {
  uvVersion: '0.9.0',
  python: '3.12.3',
};
// Mã engine đi kèm bộ cài: resources/engine (bản đóng gói) hoặc engine/ ở gốc mã nguồn (lúc phát triển).
function bundledEngine() {
  const candidates = [process.env.MAXAI_ENGINE_SOURCE, process.resourcesPath && path.join(process.resourcesPath, 'engine'),
    path.join(__dirname, '..', '..', 'engine')].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, 'freevideo_engine'))) || null;
}
function bundledInfo() {
  const dir = bundledEngine();
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'maxai-engine.json'), 'utf8')); } catch { return { tag: '?' }; }
}
// Chữ hiện cho người dùng: gọi đúng tên Max AI Engine.
const brand = (t) => String(t).replace(/FreeVideo/g, 'Max AI Engine');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const MAX_LOG = 400;
const { packList, packAction } = require('./packs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Engine {
  constructor({ settings, save, emit }) {
    this.settings = settings;          // tham chiếu tới settings của Bridge (settings.engine = { root, autostart })
    this.saveSettings = save;
    this.emit = emit || (() => {});
    this.task = null;                  // { kind, child, cancelled }
    this.host = null;                  // tiến trình engine_host đang chạy ComfyUI
    this.state = { phase: 'idle' };
    this.progress = null;
    this.log = [];
    this.lastPlan = null;
    this.url = null;
  }

  get cfg() { return (this.settings.engine ||= {}); }
  get root() { return this.cfg.root || null; }
  get src() { return this.root ? path.join(this.root, 'engine') : null; }

  defaultRoot() {
    // Ổ có nhiều chỗ trống nhất trên Windows (mô hình ~60 GB), còn lại thư mục người dùng.
    if (IS_WIN) {
      let best = { dir: path.join(process.env.LOCALAPPDATA || os.homedir(), 'MaxAI-Engine'), free: freeBytes(process.env.SystemDrive || 'C:\\') };
      for (const d of 'DEFGH') {
        const drive = d + ':\\';
        if (!fs.existsSync(drive)) continue;
        const free = freeBytes(drive);
        if (free > best.free) best = { dir: path.join(drive, 'MaxAI-Engine'), free };
      }
      return best.dir;
    }
    return path.join(os.homedir(), IS_MAC ? 'Library/Application Support/MaxAI-Engine' : 'MaxAI-Engine');
  }

  // Tìm thư mục engine đã cài từ trước (vd. gỡ app rồi cài lại, mất settings) để dùng lại — không tải lại mô hình.
  findExisting() {
    const dirs = [];
    if (IS_WIN) {
      dirs.push(path.join(process.env.LOCALAPPDATA || os.homedir(), 'MaxAI-Engine'));
      for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') dirs.push(d + ':\\MaxAI-Engine');
    } else dirs.push(path.join(os.homedir(), IS_MAC ? 'Library/Application Support/MaxAI-Engine' : 'MaxAI-Engine'));
    let best = null;
    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const ready = fs.existsSync(path.join(dir, 'machine.json'));
        const models = fs.existsSync(path.join(dir, 'models'));
        const score = (ready ? 2 : 0) + (models ? 1 : 0);
        if (score && (!best || score > best.score)) best = { dir, score };
      } catch { /* ổ không đọc được */ }
    }
    return best ? best.dir : null;
  }

  // Gọi khi mở app: chưa có thư mục engine trong settings mà máy đã có bản cài cũ → dùng lại.
  adoptExisting() {
    if (this.cfg.root) return false;
    const dir = this.findExisting();
    if (!dir) return false;
    this.cfg.root = dir;
    this.saveSettings();
    return true;
  }

  setRoot(dir) {
    this.cfg.root = path.resolve(dir);
    this.saveSettings();
    return this.status();
  }

  sourceInfo() {
    try { return JSON.parse(fs.readFileSync(path.join(this.src, '.maxai-engine.json'), 'utf8')); } catch { return null; }
  }

  machine() {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(this.root, 'machine.json'), 'utf8'));
      return m && m.ready ? m : null;
    } catch { return null; }
  }

  status() {
    const root = this.root || this.defaultRoot();
    const machine = this.root ? this.machine() : null;
    const src = this.root ? this.sourceInfo() : null;
    let disk = null;
    try { disk = freeBytes(existingParent(root)); } catch { /* bỏ qua */ }
    return {
      supported: IS_WIN || IS_MAC || process.platform === 'linux',
      platform: process.platform, root, rootChosen: Boolean(this.root), freeBytes: disk,
      engineTag: bundledInfo().tag, source: src, sourceReady: Boolean(src && fs.existsSync(path.join(this.src, 'freevideo_engine'))),
      installed: Boolean(machine),
      machine: machine ? { gpu: machine.gpu_name || (machine.hardware && machine.hardware.gpu_name) || '', backend: machine.device_backend || 'cuda',
        vram_gib: machine.vram_gib, ram_gib: machine.ram_gib, format: machine.prepared_format || '' } : null,
      phase: this.state.phase, error: this.state.error || null, task: this.task ? this.task.kind : null,
      auto: this.autoState || null, progress: this.progress, groups: this.groups || null, downloading: this.task ? this.downloading || null : null, url: this.url, autostart: this.cfg.autostart !== false,
      log: this.log.slice(-60), plan: this.lastPlan,
    };
  }

  setPhase(phase, extra = {}) {
    this.state = { phase, ...extra };
    this.emit('engine:status', this.status());
  }

  addLog(line) {
    const text = brand(String(line).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd());
    if (!text) return;
    this.log.push(text);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  // ---------------- Bước 1: chép mã engine đi kèm bộ cài (vài chục MB, không có mô hình)
  async ensureSource() {
    if (!this.root) throw new Error('Chưa chọn thư mục cài engine');
    const bundled = bundledEngine();
    const want = bundledInfo();
    const info = this.sourceInfo();
    if (info && info.commit === want.commit && fs.existsSync(path.join(this.src, 'freevideo_engine'))) return info;
    if (!bundled) throw new Error('Bộ cài Max Video AI thiếu thư mục engine. Hãy cài lại Max Video AI.');
    if (this.host) await this.stop();
    this.progress = { label: 'Đang chuẩn bị Max AI Engine' };
    this.emit('engine:status', this.status());
    fs.mkdirSync(this.root, { recursive: true });
    const staging = path.join(this.root, '.maxai', 'engine-new');
    fs.rmSync(staging, { recursive: true, force: true });
    await fs.promises.cp(bundled, staging, { recursive: true });
    // Giữ nguyên ĐƯỜNG DẪN thư mục (engine nhớ đường dẫn mã của nó): thay nội dung bên trong.
    if (fs.existsSync(this.src)) {
      for (const name of fs.readdirSync(this.src)) fs.rmSync(path.join(this.src, name), { recursive: true, force: true });
    } else fs.mkdirSync(this.src, { recursive: true });
    for (const name of fs.readdirSync(staging)) fs.renameSync(path.join(staging, name), path.join(this.src, name));
    fs.rmSync(staging, { recursive: true, force: true });
    const stamp = { ...want, at: Date.now() };
    fs.writeFileSync(path.join(this.src, '.maxai-engine.json'), JSON.stringify(stamp));
    if (!IS_WIN) for (const f of ['freevideo', 'setup.sh', 'test.sh']) { try { fs.chmodSync(path.join(this.src, f), 0o755); } catch { /* bỏ qua */ } }
    this.progress = null;
    return stamp;
  }

  // Lệnh "freevideo setup ..." theo hệ điều hành (giống trình khởi chạy chính thức của FreeVideo).
  async setupCommand(args) {
    const env = { ...this.isolatedEnv(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1', FREEVIDEO_UI_EVENTS: '1' };
    for (const k of ['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV']) delete env[k];
    if (process.env.MAXAI_FAKE_SETUP) return { cmd: 'python3', args: [process.env.MAXAI_FAKE_SETUP, '--root', this.root, ...args], env };   // kiểm thử giao diện
    if (IS_WIN) {
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return { cmd: ps, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.src, 'freevideo.ps1'), '--root', this.root, 'setup', ...args], env };
    }
    if (IS_MAC) {
      const py = await this.macPython();
      env.PYTHONPATH = this.src;
      return { cmd: py, args: ['-B', '-X', 'utf8', path.join(this.src, 'freevideo_engine', 'installed_entry.py'), 'freevideo_engine.bootstrap', '--root', this.root, ...args], env };
    }
    return { cmd: 'bash', args: [path.join(this.src, 'freevideo'), '--root', this.root, 'setup', ...args, ...(args.includes('--plan') ? [] : ['--no-launch'])], env };
  }

  // Mọi thứ của engine nằm trong thư mục cài của Max Video AI — không dùng chung gì với phần mềm khác trên máy.
  isolatedEnv() {
    const env = { ...process.env, FREEVIDEO_HOME: this.root, FREEVIDEO_LAUNCHER_HOME: path.join(this.root, '.launcher'),
      FREEVIDEO_BOOTSTRAP_ROOT: path.join(this.root, '.bootstrap') };
    for (const k of ['FREEVIDEO_URL', 'FREEVIDEO_PYTHON']) delete env[k];
    return env;
  }

  // macOS: Python riêng qua uv (giống bản FreeVideo cho Mac tự chuẩn bị) — không cần Python của hệ thống.
  async macPython() {
    const base = path.join(this.root, '.maxai');
    const uv = path.join(base, 'uv', 'uv');
    if (!fs.existsSync(uv)) {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
      const file = path.join(base, 'uv.tar.gz');
      fs.mkdirSync(path.join(base, 'uv'), { recursive: true });
      await download(`https://github.com/astral-sh/uv/releases/download/${ENGINE.uvVersion}/uv-${arch}-apple-darwin.tar.gz`, file);
      await run('tar', ['-xzf', file, '-C', path.join(base, 'uv'), '--strip-components=1']);
      fs.rmSync(file, { force: true });
    }
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(base, 'python') };
    await run(uv, ['python', 'install', ENGINE.python], { env });
    const out = await run(uv, ['python', 'find', ENGINE.python], { env });
    return out.trim().split('\n').pop();
  }

  // ---------------- Bước 2: kiểm tra máy (chỉ đọc, không cài gì)
  async plan(options = {}) {
    if (this.task) throw new Error('Engine đang bận: ' + this.task.kind);
    this.task = { kind: 'plan' };
    this.log = [];
    this.setPhase('planning');
    try {
      await this.ensureSource();
      this.progress = { label: 'Đang kiểm tra máy tính', done: 0, total: 0 };
      this.emit('engine:status', this.status());
      const fixture = process.env.MAXAI_HW_FIXTURE ? ['--hardware-json', process.env.MAXAI_HW_FIXTURE] : [];   // kiểm thử không GPU
      const c = await this.setupCommand(['--plan', '--json', ...fixture, ...this.installArgs(options)]);
      const out = await run(c.cmd, c.args, { env: c.env, cwd: this.root, onLine: (l) => this.addLog(l), allowFail: true });
      const json = extractJson(out);
      if (!json) throw new Error(lastLines(this.log) || 'Không đọc được kết quả kiểm tra máy');
      this.lastPlan = summarizePlan(json);
      this.progress = null;
      this.setPhase(this.machine() ? 'installed' : 'planned');
      return this.lastPlan;
    } catch (e) {
      this.progress = null;
      this.setPhase('failed', { error: e.message });
      throw e;
    } finally { this.task = null; }
  }

  installArgs(o) {
    // File tải dở mà nguồn không cho tải tiếp (vd. Xet của HuggingFace) → cho phép tải lại file đó từ đầu,
    // thay vì dừng hẳn và bắt người dùng làm gì thêm.
    const a = ['--allow-model-restart'];
    if (o.imageModel) a.push('--image-model');
    if (o.reuseModels) a.push('--reuse-models', o.reuseModels);
    if (o.allQualities === false) a.push('--no-sampling-caches');
    return a;
  }

  // ---------------- Bước 3: cài engine + tải mô hình (có tiến độ, huỷ được, chạy lại thì tải tiếp)
  async install(options = {}) {
    if (this.task) throw new Error('Engine đang bận: ' + this.task.kind);
    if (this.host) await this.stop();
    this.task = { kind: 'install', cancelled: false };
    this.log = [];
    this.tasks = {};
    this.setPhase('installing');
    try {
      await this.ensureSource();
      const c = await this.setupCommand(['--yes', '--accept-model-license', '--plain', ...this.installArgs(options)]);
      const code = await run(c.cmd, c.args, { env: c.env, cwd: this.root, task: this.task, allowFail: true, codeOnly: true,
        onLine: (line) => this.onSetupLine(line) });
      if (this.task.cancelled) { this.progress = null; this.setPhase('cancelled'); return this.status(); }
      if (code !== 0 || !this.machine()) {
        const failure = this.failure || lastLines(this.log);
        throw new Error(failure || `Cài đặt dừng (mã ${code}). Bấm "Cài tiếp" để chạy lại — file đã tải được giữ lại.`);
      }
      this.progress = null;
      this.groups = null;
      cleanRetained(path.join(this.root, 'models'));
      this.setPhase('installed');
      return this.status();
    } catch (e) {
      this.progress = null;
      this.setPhase('failed', { error: e.message });
      throw e;
    } finally { this.task = null; this.failure = null; }
  }

  onSetupLine(line) {
    let ev = null;
    if (line.startsWith('{')) { try { ev = JSON.parse(line); } catch { ev = null; } }
    if (!ev) { this.addLog(line); return; }
    if (ev.event === 'freevideo_ui') {
      const k = ev.kind;
      if (k === 'phase') this.progress = { ...(this.progress || {}), phase: ev.label, phaseDone: ev.done, phaseTotal: ev.total };
      else if (k === 'task' || k === 'progress') {
        this.tasks[ev.key] = { label: ev.label, detail: ev.detail || '', done: ev.done, total: ev.total, state: ev.state || 'running' };
        this.progress = { ...(this.progress || {}), current: this.tasks[ev.key], tasks: Object.values(this.tasks).slice(-8) };
      } else if (k === 'task_end') {
        if (this.tasks[ev.key]) this.tasks[ev.key].state = 'done';
        this.progress = { ...(this.progress || {}), tasks: Object.values(this.tasks).slice(-8) };
      } else if (k === 'failure') { this.failure = brand(ev.error); this.addLog('Lỗi: ' + ev.error); }
      else if (k === 'models') this.progress = { ...(this.progress || {}), models: ev.groups };
    } else if (ev.event === 'model_groups' && Array.isArray(ev.groups)) {
      // Trạng thái từng nhóm mô hình (video, văn bản, giải mã, bộ đệm…) — giữ lại cả khi cài dừng giữa chừng.
      this.groups = ev.groups.map((g) => ({ id: g.id, state: g.state, total: g.total_bytes, ready: g.ready_bytes,
        need: g.download_bytes, got: g.downloaded_bytes, speed: g.bytes_per_second, files: g.files, readyFiles: g.ready_files }));
    } else if (ev.event === 'download_model') {
      this.downloading = { file: String(ev.file || '').split(/[\\/]/).pop(), name: ev.name, bytes: ev.bytes };
    } else if (ev.event === 'local_model_progress') {
      this.progress = { ...(this.progress || {}), current: { label: 'Mô hình: ' + (ev.name || ev.file || ''), detail: ev.phase, done: ev.done_bytes, total: ev.total_bytes, unit: 'bytes' } };
    }
    const now = Date.now();
    if (!this.lastEmit || now - this.lastEmit > 400) { this.lastEmit = now; this.emit('engine:status', this.status()); }
  }

  cancel() {
    const t = this.task;
    if (!t || !t.child) return false;
    t.cancelled = true;
    killTree(t.child);
    return true;
  }

  // ---------------- Bước 4: bật / tắt engine (ComfyUI ngầm, chỉ nghe 127.0.0.1)
  async start() {
    if (this.host) return this.status();
    const machine = this.machine();
    if (!machine) throw new Error('Engine chưa được cài. Vào mục Engine & mô hình để cài.');
    if (this.task) throw new Error('Engine đang bận: ' + this.task.kind);
    const script = path.join(this.root, '.maxai', 'engine_host.py');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, HOST_PY);
    const env = { ...this.isolatedEnv(), PYTHONPATH: this.src, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' };
    for (const k of ['PYTHONHOME', 'VIRTUAL_ENV']) delete env[k];
    this.log = [];
    this.setPhase('starting');
    const hostScript = process.env.MAXAI_FAKE_HOST || script;   // kiểm thử giao diện
    const child = spawn(machine.python, ['-B', '-X', 'utf8', hostScript, '--root', this.root, '--port', String(this.cfg.port || 0)],
      { cwd: this.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.host = child;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return; settled = true;
        if (err) reject(err); else resolve(this.status());
      };
      lines(child.stdout, (line) => {
        let ev = null;
        if (line.startsWith('{')) { try { ev = JSON.parse(line); } catch { ev = null; } }
        if (!ev || ev.event !== 'maxai_engine') { this.addLog(line); return; }
        if (ev.kind === 'stage') { this.progress = { label: ev.label }; this.emit('engine:status', this.status()); }
        else if (ev.kind === 'log') this.addLog(ev.text);
        else if (ev.kind === 'open') {
          this.url = ev.url; this.progress = null;
          this.cfg.port = Number(new URL(ev.url).port) || this.cfg.port; this.saveSettings();
          this.setPhase('running');
          this.emit('engine:open', { url: ev.url, root: this.root });
          done();
        } else if (ev.kind === 'failed') { this.state.error = brand(ev.error); this.addLog('Lỗi: ' + ev.error); }
      });
      lines(child.stderr, (line) => this.addLog(line));
      child.on('exit', (code) => {
        this.host = null; this.url = null; this.progress = null;
        const wanted = this.stopping; this.stopping = false;
        if (wanted) this.setPhase('stopped');
        else this.setPhase('failed', { error: this.state.error || lastLines(this.log) || `Engine dừng bất ngờ (mã ${code})` });
        done(new Error(this.state.error || 'Engine không khởi động được'));
      });
      child.on('error', (e) => { this.host = null; this.setPhase('failed', { error: e.message }); done(e); });
    });
  }

  async stop() {
    const child = this.host;
    if (!child) return this.status();
    this.stopping = true;
    this.setPhase('stopping');
    try { child.stdin.end(); } catch { /* đã đóng */ }       // engine_host tự tắt ComfyUI khi Max Video AI đóng ống nối
    await new Promise((r) => { const t = setTimeout(() => { killTree(child); r(); }, 15000); child.once('exit', () => { clearTimeout(t); r(); }); });
    return this.status();
  }

  setAutostart(v) { this.cfg.autostart = Boolean(v); this.saveSettings(); return this.status(); }

  // ---------------- Tự động: mở app là tự cài engine (lần đầu), tự bật engine, tự tải mọi mô hình còn thiếu.
  // Chạy ngầm trong tiến trình chính; giao diện chỉ theo dõi qua engine:status (status().auto).
  auto() {
    if (this.autoTask) return this.status();
    this.autoState = { stage: 'checking', error: null, pack: null };
    const say = (patch) => { this.autoState = { ...this.autoState, ...patch }; this.emit('engine:status', this.status()); };
    this.autoTask = (async () => {
      try {
        if (!this.root) { this.adoptExisting(); if (!this.root) this.setRoot(this.defaultRoot()); }
        if (!this.machine()) {
          say({ stage: 'install' });
          await this.install({});
        }
        if (this.state.phase !== 'running') {
          say({ stage: 'start' });
          if (this.task) await this.waitIdle();
          if (this.state.phase !== 'running') await this.start();
        }
        say({ stage: 'packs' });
        await this.autoPacks((pack) => say({ pack }));
        say({ stage: 'done', pack: null });
      } catch (e) {
        say({ stage: 'error', error: e.message });
      } finally { this.autoTask = null; }
    })();
    return this.status();
  }

  async waitIdle() { while (this.task) await new Promise((r) => setTimeout(r, 1000)); }

  // Tải lần lượt từng gói mô hình còn thiếu (ảnh, phụ đề, AI viết prompt, lồng tiếng…). Gói máy không hỗ trợ thì bỏ qua.
  async autoPacks(onPack) {
    const ORDER = ['vlm', 'image-qwen', 'subtitle', 'dubbing', 'image-h3', 'segment', 'music'];
    const tried = new Set();
    for (let round = 0; round < 400; round++) {
      if (this.state.phase !== 'running') return;          // người dùng tắt engine → dừng, lần mở sau tải tiếp
      let list;
      try { list = await this.packs(); } catch { await sleep(5000); continue; }
      const busy = list.find((p) => p.busy && !p.core);
      if (busy) { onPack({ id: busy.id, name: busy.name, progress: busy.progress }); await sleep(4000); continue; }
      const next = ORDER.map((id) => list.find((p) => p.id === id))
        .find((p) => p && !p.ready && p.available && !tried.has(p.id));
      if (!next) return;
      tried.add(next.id);
      onPack({ id: next.id, name: next.name, progress: null });
      try { await packAction(this.url, next.id, 'install'); } catch (e) { this.addLog('Không tải được ' + next.name + ': ' + e.message); }
      await sleep(3000);
    }
  }

  // ---------------- Mô hình thêm (tải riêng từng gói, khi engine đang chạy)
  async packs() {
    return packList({ url: this.url, installed: Boolean(this.machine()), running: this.state.phase === 'running' });
  }
  async packAction(id, action) {
    if (!this.url || this.state.phase !== 'running') throw new Error('Hãy bật engine trước khi tải mô hình.');
    if (id === 'video' || id === 'image-h3-setup') {
      return this.install({ imageModel: id === 'image-h3-setup' });
    }
    return packAction(this.url, id, action);
  }
}

// ------------------------------------------------------------------ engine_host.py (chạy bằng Python của engine)
const HOST_PY = String.raw`# Max Video AI · bật Max AI Engine (ComfyUI chạy ngầm ở 127.0.0.1) cho giao diện Max Video AI (tạo tự động, đừng sửa).
# Chạy được trên Windows/macOS/Linux và tự tắt khi Max Video AI đóng.
import argparse, json, sys, threading, time
from pathlib import Path

def say(kind, **value):
    print(json.dumps(dict(event='maxai_engine', kind=kind, **value), ensure_ascii=False), flush=True)

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--port', type=int, default=0)
args = parser.parse_args()
stop = threading.Event()

def watch():
    try:
        sys.stdin.read()          # Max Video AI đóng ống nối (thoát / bấm Tắt engine) → dừng
    except Exception:
        pass
    stop.set()

threading.Thread(target=watch, daemon=True).start()
controller = None
try:
    from freevideo_engine import comfy_service as cs
    from freevideo_engine.comfy_launcher_runtime import Controller, deploy
    log = lambda *parts: say('log', text=' '.join(str(p) for p in parts))
    root = Path(args.root).resolve()
    machine = cs.ready_machine(root)
    if machine is None:
        say('failed', error='Engine chưa cài xong. Hãy chạy Cài tiếp trong Max Video AI.')
        sys.exit(2)
    source = cs.source_root()
    record = cs.installed(root)
    port = args.port or (cs.port_of(record['url']) if record else cs.first_free_port())
    say('stage', label='Đang chuẩn bị ComfyUI (lần đầu có thể mất vài phút)')
    if record is None or Path(record['source']).resolve() != source or not Path(record['python']).is_file():
        record = cs.install(root, source, machine, port, out=log)
    else:
        cs.add_node_packages(root, source, machine, record['root'], log)
        deploy(record['root'], source, root)
    controller = Controller(Path(record['source']))
    if not controller.restore({'installation': dict(record, url='http://127.0.0.1:%d' % port)}):
        say('failed', error='Cài đặt engine chưa hoàn tất. Hãy chạy Cài tiếp trong Max Video AI.')
        sys.exit(3)
    say('stage', label='Đang khởi động engine AI')
    controller._connect()
    state = controller.state
    if state.get('status') != 'open':
        say('failed', error=state.get('error') or 'ComfyUI không mở được', log=str(controller.server_log or ''))
        sys.exit(4)
    url = (state.get('url') or controller.server_url or '').split('/?')[0]
    say('open', url=url, owned=controller.owns_server(), log=str(controller.server_log or ''))
    while not stop.wait(1):
        if controller.server is not None and controller.server.poll() is not None:
            say('failed', error='ComfyUI đã dừng', log=str(controller.server_log or ''))
            break
except SystemExit:
    raise
except BaseException as error:
    say('failed', error=str(error) or type(error).__name__)
    sys.exit(1)
finally:
    if controller is not None:
        try:
            controller.close()
        except Exception:
            pass
    say('stopped')
`;

// ------------------------------------------------------------------ tiện ích
function freeBytes(dir) { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); }
function existingParent(p) { let d = path.resolve(p); while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d); return d; }
function lastLines(log, n = 4) { return log.filter((l) => !l.startsWith('{')).slice(-n).join('\n'); }

function lines(stream, cb) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.search(/\r?\n|\r/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' && buf[i + 1] === '\n' ? 2 : 1)); cb(l); }
  });
  stream.on('end', () => { if (buf) cb(buf); });
}

// Chạy lệnh; trả stdout (hoặc mã thoát khi codeOnly). onLine nhận từng dòng stdout+stderr.
function run(cmd, args, { env, cwd, onLine, task, allowFail = false, codeOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: env || process.env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN });
    if (task) task.child = child;
    let out = '';
    lines(child.stdout, (l) => { out += l + '\n'; if (onLine) onLine(l); });
    lines(child.stderr, (l) => { if (onLine) onLine(l); });
    child.on('error', (e) => reject(new Error(`Không chạy được ${path.basename(cmd)}: ${e.message}`)));
    child.on('close', (code) => {
      if (codeOnly) return resolve(code);
      if (code !== 0 && !allowFail) return reject(new Error(`${path.basename(cmd)} lỗi (mã ${code})`));
      resolve(out);
    });
  });
}

function killTree(child) {
  try {
    if (IS_WIN) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
    else process.kill(-child.pid, 'SIGTERM');
  } catch { try { child.kill(); } catch { /* đã thoát */ } }
}

async function download(url, file, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Tải ${url} lỗi ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  let got = 0, last = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (onProgress && Date.now() - last > 300) { last = Date.now(); onProgress(got, total); }
  }
  await new Promise((r) => out.end(r));
}

function extractJson(text) {
  const i = text.indexOf('{\n');
  const j = text.lastIndexOf('\n}');
  if (i < 0 || j < 0) return null;
  try { return JSON.parse(text.slice(i, j + 2)); } catch { return null; }
}

// Rút gọn kết quả "setup --plan --json" của FreeVideo cho màn hình kiểm tra máy.
function summarizePlan(p) {
  const inv = p.inventory || {};
  const hw = inv.hardware || {};
  const res = p.installation_resources || {};
  return {
    gpu: hw.gpu_name || (inv.selected_gpu || {}).name || (p.device_backend === 'mps' ? 'Apple Silicon' : ''),
    vram: hw.vram_total || res.gpu_capacity_bytes || 0, ram: hw.ram_total || res.ram_capacity_bytes || 0,
    driver: hw.driver_version || '', format: p.prepared_format || '',
    download: (p.model_download_bytes || 0) + (p.package_download_bytes || 0),
    disks: (p.disks || []).map((d) => ({ path: (d.paths || [])[0], needed: d.needed_bytes, free: d.free_bytes })),
    steps: (p.steps || []).map(brand), licenses: p.licenses || [], errors: (p.errors || []).map(brand), warnings: (p.warnings || []).map(brand),
    engineVersion: p.engine_version || '', root: p.root,
  };
}

// Dọn các mảnh tải dở cũ mà trình cài giữ lại khi phải tải lại từ đầu (*.restart-approved-<số>), chỉ sau khi cài xong.
function cleanRetained(dir, depth = 0) {
  if (depth > 6) return;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) cleanRetained(p, depth + 1);
    else if (/\.restart-approved-\d+$/.test(d.name)) { try { fs.rmSync(p, { force: true }); } catch {} }
  }
}

// Văn bản giấy phép mô hình đi kèm engine (đưa cho người dùng đọc trong app).
function legalTexts() {
  const dir = bundledEngine();
  const read = (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; } };
  return {
    minimax: read('freevideo_engine/licenses/MiniMax-H3-Community-License-Agreement.txt'),
    notice: read('NOTICE'),
    thirdParty: read('THIRD_PARTY_NOTICES.md'),
    apache: read('LICENSE'),
  };
}

module.exports = { Engine, ENGINE, summarizePlan, legalTexts };
