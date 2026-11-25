'use strict';
// Engine ComfyUI dùng cho 2 chế độ (cùng 1 bản ComfyUI + PyTorch trong <thư mục cài>/lite):
//   lite — Chế độ nhẹ: Wan 2.2 TI2V 5B, cho card NVIDIA yếu (GTX 16xx, RTX 20xx, 6–8 GB VRAM)
//   pro  — Chất lượng cao: LTX-2.3 22B (video + âm thanh, tới 4K), cho máy mạnh (≥ 24 GB VRAM)
// Chế độ nhẹ — cho máy card NVIDIA yếu (GTX 16xx, RTX 20xx, 6–8 GB VRAM) không chạy được bản đầy đủ MiniMax H3.
// Chạy mô hình Wan 2.2 TI2V-5B (Apache-2.0) bằng ComfyUI ngay trên máy khách:
//   <thư mục cài>/lite/  uv, python, venv, ComfyUI (bản cố định), models (~18 GB), library (video đã tạo)
// Một máy chủ nhỏ trong Max Video AI (127.0.0.1) nói cùng "ngôn ngữ" /freevideo/agent/v1 với giao diện (jobs, library, media…),
// nên trang Tạo video, Hàng đợi, Thư viện dùng chung với bản đầy đủ.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const PREFIX = '/freevideo/agent/v1';
const UV_VERSION = '0.9.0';
const PYTHON = '3.12';
// Cùng bản ComfyUI mà bản đầy đủ đang dùng (engine/freevideo_engine/dependencies.json)
const COMFY = { commit: '421a1c245c682c04d4325ba365f40c834c66f5b0', zip: 'https://github.com/comfy-org/ComfyUI/archive/421a1c245c682c04d4325ba365f40c834c66f5b0.zip' };
// PyTorch: cu128 cho card compute 7.5+ (gồm RTX 50), cu126 cho card cũ hơn (GTX 10xx)
const TORCH_PKGS = ['torch==2.8.0', 'torchvision==0.23.0', 'torchaudio==2.8.0'];
const torchIndex = (hw) => 'https://download.pytorch.org/whl/' + (hw && hw.cap && (hw.cap[0] + hw.cap[1] / 10) < 7.5 ? 'cu126' : 'cu128');
const HF = 'https://huggingface.co/Comfy-Org/';
const MODELS = [
  { id: 'video', name: 'Mô hình video Wan 2.2 (5B)', dir: 'diffusion_models', file: 'wan2.2_ti2v_5B_fp16.safetensors',
    url: HF + 'Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors', size: 10.0e9 },
  { id: 'text', name: 'Bộ đọc prompt UMT5', dir: 'text_encoders', file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    url: HF + 'Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors', size: 6.74e9 },
  { id: 'vae', name: 'Bộ giải mã video Wan 2.2', dir: 'vae', file: 'wan2.2_vae.safetensors',
    url: HF + 'Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors', size: 1.41e9 },
];
const LTX_MODELS = [
  { id: 'video', name: 'Mô hình video + âm thanh LTX-2.3 (22B, fp8)', dir: 'checkpoints', file: 'ltx-2.3-22b-dev-fp8.safetensors',
    url: 'https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-dev-fp8.safetensors', size: 29.1e9 },
  { id: 'text', name: 'Bộ đọc prompt Gemma 3 12B (fp8)', dir: 'text_encoders', file: 'gemma_3_12B_it_fp8_scaled.safetensors',
    url: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp8_scaled.safetensors', size: 13.2e9 },
  { id: 'distilled', name: 'LoRA chạy nhanh (distilled 1.1)', dir: 'loras', file: 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors',
    url: 'https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors', size: 2.74e9 },
  { id: 'upscaler', name: 'Bộ phóng to ×2', dir: 'latent_upscale_models', file: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
    url: 'https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors', size: 1.0e9 },
];
const LTX_NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly, blurry, low quality, distorted, watermark, text';
// Khung hình LTX (bội số 64 để tầng 1 = nửa kích thước vẫn chia hết 32)
const LTX_SIZES = {
  light: { '16:9': [768, 448], '9:16': [448, 768], '1:1': [576, 576], '4:3': [704, 512], '3:4': [512, 704], '21:9': [960, 384] },
  medium: { '16:9': [1280, 704], '9:16': [704, 1280], '1:1': [960, 960], '4:3': [1152, 832], '3:4': [832, 1152], '21:9': [1536, 640] },
  high: { '16:9': [1920, 1088], '9:16': [1088, 1920], '1:1': [1408, 1408], '4:3': [1664, 1216], '3:4': [1216, 1664], '21:9': [2304, 960] },
  max: { '16:9': [3840, 2176], '9:16': [2176, 3840], '1:1': [2816, 2816], '4:3': [3328, 2496], '3:4': [2496, 3328], '21:9': [4608, 1920] },
};
const LTX_FPS = 25;

const PROFILES = {
  lite: { id: 'lite', title: 'Chế độ nhẹ', tag: 'lite · Wan 2.2 5B', format: 'Wan 2.2 5B', models: () => MODELS, maxSeconds: 5, fps: 24,
    sampler: ['3'], decoder: ['8'], loaders: ['37', '38'], downloadLabel: 'Đang tải mô hình Wan 2.2 (~18 GB)' },
  pro: { id: 'pro', title: 'Chất lượng cao', tag: 'pro · LTX-2.3 22B', format: 'LTX-2.3 22B', models: () => LTX_MODELS, maxSeconds: 10, fps: LTX_FPS,
    sampler: ['215', '219'], decoder: ['251'], loaders: ['236', '243'], downloadLabel: 'Đang tải mô hình LTX-2.3 (~46 GB)' },
};

const NEGATIVE = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';
// Khung hình theo chất lượng (Wan 2.2 5B: cạnh chia hết cho 32, số khung = 4n + 1, 24 khung/giây, tối đa 121 khung ≈ 5 giây)
const SIZES = {
  light: { '16:9': [832, 480], '9:16': [480, 832], '1:1': [640, 640], '4:3': [736, 544], '3:4': [544, 736], '21:9': [960, 416] },
  medium: { '16:9': [960, 544], '9:16': [544, 960], '1:1': [736, 736], '4:3': [864, 640], '3:4': [640, 864], '21:9': [1120, 480] },
  high: { '16:9': [1280, 704], '9:16': [704, 1280], '1:1': [960, 960], '4:3': [1088, 832], '3:4': [832, 1088], '21:9': [1472, 640] },
};
SIZES.max = SIZES.high;
const STEPS = { light: 12, medium: 20, high: 25, max: 30 };
const MAX_SECONDS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

class LiteEngine {
  constructor({ settings, save, emit, hardware, profile = 'lite' }) {
    this.profile = PROFILES[profile] || PROFILES.lite;
    this.settings = settings;
    this.saveSettings = save;
    this.emit = emit || (() => {});
    this.hardware = hardware || (async () => ({}));
    this.task = null;
    this.state = { phase: 'idle' };
    this.progress = null;
    this.groups = null;
    this.log = [];
    this.comfy = null;          // tiến trình ComfyUI
    this.comfyUrl = null;
    this.server = null;         // máy chủ /freevideo/agent/v1 cho giao diện
    this.url = null;
    this.jobs = new Map();      // id → job
    this.order = [];            // mới nhất trước
  }

  get cfg() { return (this.settings.engine ||= {}); }
  get base() { return this.cfg.root || null; }
  get root() { return this.base ? path.join(this.base, 'lite') : null; }
  defaultRoot() {
    if (IS_WIN) return path.join(process.env.LOCALAPPDATA || os.homedir(), 'MaxAI-Engine');
    return path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support/MaxAI-Engine' : 'MaxAI-Engine');
  }
  adoptExisting() { return false; }
  setRoot(dir) { this.cfg.root = path.resolve(dir); this.saveSettings(); return this.status(); }
  p(...parts) { return path.join(this.root, ...parts); }

  machine() {
    if (!this.root) return null;
    try { const m = JSON.parse(fs.readFileSync(this.p(this.profile.id + '.json'), 'utf8')); return m && m.ready ? m : null; } catch { return null; }
  }

  status() {
    const machine = this.machine();
    return {
      mode: this.profile.id, supported: IS_WIN || process.platform === 'linux', platform: process.platform,
      root: this.base || this.defaultRoot(), rootChosen: Boolean(this.base), installed: Boolean(machine),
      machine: machine ? { gpu: machine.gpu || '', backend: 'cuda', vram_gib: machine.vram_gib, ram_gib: machine.ram_gib, format: this.profile.format } : null,
      phase: this.state.phase, error: this.state.error || null, task: this.task ? this.task.kind : null,
      auto: this.autoState || null, progress: this.progress, groups: this.groups, url: this.url, autostart: this.cfg.autostart !== false,
      log: this.log.slice(-60), engineTag: this.profile.tag,
    };
  }
  setPhase(phase, extra = {}) { this.state = { phase, ...extra }; this.emit('engine:status', this.status()); }
  addLog(line) {
    const t = String(line).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd();
    if (!t) return;
    this.log.push(t);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }
  say(label, current) { this.progress = { label, current: current || null }; this.tick(); }
  tick() { const n = Date.now(); if (!this.lastEmit || n - this.lastEmit > 400) { this.lastEmit = n; this.emit('engine:status', this.status()); } }

  async plan() { return { gpu: '', steps: [this.profile.title + ': ComfyUI + ' + this.profile.format], download: this.profile.models().reduce((n, m) => n + m.size, 0) + 3.5e9, errors: [], warnings: [] }; }

  // ---------------- Cài: uv → Python → ComfyUI → PyTorch → mô hình (chạy lại thì làm tiếp phần còn thiếu)
  async install() {
    if (this.task) throw new Error('Engine đang bận: ' + this.task.kind);
    if (!this.base) this.setRoot(this.defaultRoot());
    if (this.comfy) await this.stop();
    this.task = { kind: 'install', cancelled: false };
    this.log = [];
    this.setPhase('installing');
    try {
      fs.mkdirSync(this.root, { recursive: true });
      const hw = await this.hardware();
      if (process.env.MAXAI_LITE_FAKE_INSTALL) {   // kiểm thử giao diện: giả lập cài + tải mô hình
        const total = this.profile.models().reduce((n, m) => n + m.size, 0);
        for (let i = 0; i <= 10; i++) {
          if (this.task.cancelled) throw new Error('Đã dừng');
          this.groups = [{ id: 'lite', state: 'downloading', total, ready: total * i / 10, speed: 50e6 }];
          this.progress = { label: this.profile.downloadLabel }; this.tick();
          await sleep(400);
        }
        fs.writeFileSync(this.p(this.profile.id + '.json'), JSON.stringify({ ready: true, at: now(), gpu: hw.gpu || '', vram_gib: 6, ram_gib: 16 }));
        this.progress = null; this.groups = null; this.setPhase('installed');
        return this.status();
      }
      const uv = await this.ensureUv();
      const env = this.env();
      this.say('Đang cài Python');
      await this.run(uv, ['python', 'install', PYTHON], { env });
      const venv = this.p('venv');
      if (!fs.existsSync(this.python())) {
        this.say('Đang tạo môi trường riêng');
        await this.run(uv, ['venv', '--python', PYTHON, venv], { env });
      }
      const comfyDir = await this.ensureComfy();
      if (!fs.existsSync(this.p('.deps-ok'))) {
        this.say('Đang cài PyTorch (CUDA) — khoảng 2,5 GB', null);
        await this.run(uv, ['pip', 'install', '--python', this.python(), ...TORCH_PKGS, '--index-url', torchIndex(hw)], { env, onLine: (l) => this.depLine(l) });
        this.say('Đang cài thư viện của ComfyUI');
        await this.run(uv, ['pip', 'install', '--python', this.python(), '-r', path.join(comfyDir, 'requirements.txt')], { env, onLine: (l) => this.depLine(l) });
        fs.writeFileSync(this.p('.deps-ok'), now());
      }
      await this.downloadModels(comfyDir);
      fs.writeFileSync(this.p(this.profile.id + '.json'), JSON.stringify({ ready: true, at: now(), comfy: COMFY.commit, gpu: hw.gpu || '',
        vram_gib: hw.vram ? Math.round(hw.vram / 1024 ** 3) : null, ram_gib: hw.ram ? Math.round(hw.ram / 1024 ** 3) : null }));
      this.progress = null; this.groups = null;
      this.setPhase('installed');
      return this.status();
    } catch (e) {
      this.progress = null;
      if (this.task && this.task.cancelled) { this.setPhase('cancelled'); return this.status(); }
      this.setPhase('failed', { error: e.message });
      throw e;
    } finally { this.task = null; }
  }

  depLine(line) {
    this.addLog(line);
    const m = String(line).match(/(Downloading|Downloaded|Installed|Prepared|Resolved)\s+(.{0,60})/);
    if (m) this.progress = { ...(this.progress || {}), current: { label: m[1] + ' ' + m[2] } };
    this.tick();
  }

  env() {
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: this.p('python'), UV_CACHE_DIR: this.p('.uv-cache'), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' };
    for (const k of ['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete env[k];
    return env;
  }
  python() { return IS_WIN ? this.p('venv', 'Scripts', 'python.exe') : this.p('venv', 'bin', 'python'); }

  async ensureUv() {
    const dir = this.p('uv');
    const exe = path.join(dir, IS_WIN ? 'uv.exe' : 'uv');
    if (fs.existsSync(exe)) return exe;
    fs.mkdirSync(dir, { recursive: true });
    const name = IS_WIN ? 'uv-x86_64-pc-windows-msvc.zip' : 'uv-x86_64-unknown-linux-gnu.tar.gz';
    const file = path.join(dir, name);
    this.say('Đang tải bộ cài Python (uv)');
    await this.fetchFile(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}`, file, 'uv');
    if (IS_WIN) await this.run('tar', ['-xf', file, '-C', dir]);
    else await this.run('tar', ['-xzf', file, '-C', dir, '--strip-components=1']);
    fs.rmSync(file, { force: true });
    if (!fs.existsSync(exe)) throw new Error('Không giải nén được uv');
    return exe;
  }

  async ensureComfy() {
    const dir = this.p('ComfyUI');
    const stamp = path.join(dir, '.maxai-commit');
    if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === COMFY.commit) return dir;
    const zip = this.p('comfyui.zip');
    this.say('Đang tải ComfyUI');
    await this.fetchFile(COMFY.zip, zip, 'ComfyUI');
    const tmp = this.p('comfy-new');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await this.run('tar', ['-xf', zip, '-C', tmp]);
    const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((d) => fs.existsSync(path.join(d, 'main.py')));
    if (!inner) throw new Error('Gói ComfyUI tải về bị lỗi');
    // Giữ lại mô hình / video đã có khi cập nhật ComfyUI
    if (fs.existsSync(dir)) {
      for (const keep of ['models', 'output', 'input']) {
        const from = path.join(dir, keep);
        if (fs.existsSync(from)) { fs.rmSync(path.join(inner, keep), { recursive: true, force: true }); fs.renameSync(from, path.join(inner, keep)); }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.renameSync(inner, dir);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    fs.writeFileSync(stamp, COMFY.commit);
    return dir;
  }

  async downloadModels(comfyDir) {
    const MODELS = this.profile.models();
    const total = MODELS.reduce((n, m) => n + m.size, 0);
    const state = MODELS.map((m) => {
      const target = path.join(comfyDir, 'models', m.dir, m.file);
      let have = 0;
      try { have = fs.statSync(target).size; } catch { try { have = fs.statSync(target + '.part').size; } catch { have = 0; } }
      return { m, target, have: fs.existsSync(target) ? m.size : have, done: fs.existsSync(target) };
    });
    const publish = (speed) => {
      this.groups = [{ id: 'lite', state: 'downloading', total, ready: state.reduce((n, s) => n + Math.min(s.have, s.m.size), 0), speed }];
      this.progress = { label: this.profile.downloadLabel, current: null };
      this.tick();
    };
    publish(0);
    for (const s of state) {
      if (s.done) continue;
      fs.mkdirSync(path.dirname(s.target), { recursive: true });
      let lastT = Date.now(), lastB = s.have, speed = 0;
      await this.fetchFile(s.m.url, s.target, s.m.name, (got) => {
        s.have = got;
        const t = Date.now();
        if (t - lastT > 1000) { speed = (got - lastB) / ((t - lastT) / 1000); lastT = t; lastB = got; }
        publish(speed);
      }, true);
      s.done = true; s.have = s.m.size;
    }
    this.groups = [{ id: 'lite', state: 'ready', total, ready: total, speed: 0 }];
  }

  // Tải file; resume=true: tải tiếp phần .part còn dở (HTTP Range)
  async fetchFile(url, target, label, onProgress, resume = false) {
    const part = target + '.part';
    for (let attempt = 0; attempt < 6; attempt++) {
      if (this.task && this.task.cancelled) throw new Error('Đã dừng');
      let start = 0;
      if (resume) { try { start = fs.statSync(part).size; } catch { start = 0; } } else fs.rmSync(part, { force: true });
      const controller = new AbortController();
      if (this.task) this.task.abort = () => controller.abort();
      try {
        const res = await fetch(url, { redirect: 'follow', headers: start ? { Range: 'bytes=' + start + '-' } : {}, signal: controller.signal });
        if (res.status === 416) { fs.renameSync(part, target); return; }
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        if (start && res.status !== 206) start = 0;
        const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
        let got = start;
        const reader = res.body.getReader();
        let last = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          if (onProgress && Date.now() - last > 300) { last = Date.now(); onProgress(got); }
          else if (!onProgress && Date.now() - last > 500) { last = Date.now(); this.progress = { ...(this.progress || {}), current: { label: 'Tải ' + label, done: got, total: Number(res.headers.get('content-length')) + start || 0, unit: 'bytes' } }; this.tick(); }
        }
        await new Promise((r) => out.end(r));
        fs.renameSync(part, target);
        if (onProgress) onProgress(got);
        return;
      } catch (e) {
        if (this.task && this.task.cancelled) throw new Error('Đã dừng');
        this.addLog('Tải ' + label + ' lỗi (' + e.message + '), thử lại…');
        if (attempt === 5) throw new Error('Không tải được ' + label + ': ' + e.message + '. Kiểm tra mạng rồi bấm Cài tiếp — phần đã tải được giữ lại.');
        await sleep(3000 * (attempt + 1));
      }
    }
  }

  run(cmd, args, { env, onLine } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { env: env || process.env, cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      if (this.task) this.task.child = child;
      let tail = [];
      const take = (stream) => {
        let buf = '';
        stream.on('data', (d) => {
          buf += d.toString();
          const parts = buf.split(/\r?\n|\r/); buf = parts.pop();
          for (const l of parts) { tail.push(l); if (tail.length > 30) tail.shift(); if (onLine) onLine(l); else this.addLog(l); }
        });
      };
      take(child.stdout); take(child.stderr);
      child.on('error', (e) => reject(new Error('Không chạy được ' + path.basename(cmd) + ': ' + e.message)));
      child.on('close', (code) => {
        if (this.task && this.task.cancelled) return reject(new Error('Đã dừng'));
        if (code !== 0) return reject(new Error(path.basename(cmd) + ' lỗi (mã ' + code + '):\n' + tail.slice(-8).join('\n')));
        resolve();
      });
    });
  }

  cancel() {
    const t = this.task;
    if (!t) return false;
    t.cancelled = true;
    if (t.abort) try { t.abort(); } catch { /* bỏ qua */ }
    if (t.child) killTree(t.child);
    return true;
  }

  // ---------------- Bật: ComfyUI (127.0.0.1) + máy chủ agent cho giao diện
  async start() {
    if (this.comfy && this.url) return this.status();
    const m = this.machine();
    if (!m) throw new Error('Chế độ nhẹ chưa được cài.');
    if (this.task) throw new Error('Engine đang bận: ' + this.task.kind);
    this.log = [];
    this.setPhase('starting');
    this.say('Đang khởi động ComfyUI');
    const port = await freePort();
    const hw = await this.hardware();
    const args = ['-s', path.join(this.p('ComfyUI'), 'main.py'), '--listen', '127.0.0.1', '--port', String(port), '--disable-auto-launch', '--preview-method', 'none'];
    if (!hw.vram || hw.vram < 7.5 * 1024 ** 3) args.push('--lowvram');
    const fake = process.env.MAXAI_LITE_FAKE_COMFY;   // kiểm thử giao diện: ComfyUI giả lập
    if (fake) { args.splice(0, 2, fake); fs.mkdirSync(this.p('ComfyUI', 'input'), { recursive: true }); }
    const child = spawn(fake ? 'python3' : this.python(), args, { cwd: this.p('ComfyUI'), env: this.env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.comfy = child;
    const onData = (d) => String(d).split(/\r?\n/).forEach((l) => this.addLog(l));
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', (code) => {
      const wanted = this.stopping; this.stopping = false;
      this.comfy = null; this.comfyUrl = null;
      this.closeServer();
      if (wanted) this.setPhase('stopped');
      else this.setPhase('failed', { error: 'ComfyUI dừng bất ngờ (mã ' + code + ')\n' + this.log.slice(-6).join('\n') });
    });
    const url = 'http://127.0.0.1:' + port;
    for (let i = 0; i < 300; i++) {
      if (!this.comfy) throw new Error(this.state.error || 'ComfyUI không mở được');
      try { const r = await fetch(url + '/system_stats', { signal: AbortSignal.timeout(2000) }); if (r.ok) break; } catch { /* chưa lên */ }
      await sleep(1000);
      if (i === 299) { this.stop(); throw new Error('ComfyUI khởi động quá lâu'); }
    }
    this.comfyUrl = url;
    await this.openServer();
    this.listen();
    this.progress = null;
    this.setPhase('running');
    this.emit('engine:open', { url: this.url, root: this.root });
    return this.status();
  }

  async stop() {
    const child = this.comfy;
    this.closeServer();
    if (!child) { this.setPhase('stopped'); return this.status(); }
    this.stopping = true;
    this.setPhase('stopping');
    killTree(child);
    await new Promise((r) => { const t = setTimeout(r, 10000); child.once('exit', () => { clearTimeout(t); r(); }); });
    return this.status();
  }

  setAutostart(v) { this.cfg.autostart = Boolean(v); this.saveSettings(); return this.status(); }
  async packs() { return []; }
  async packAction() { throw new Error(this.profile.title + ' không có gói mô hình thêm.'); }

  auto() {
    if (this.autoTask) return this.status();
    this.autoState = { stage: 'checking', error: null, pack: null };
    const say = (patch) => { this.autoState = { ...this.autoState, ...patch }; this.emit('engine:status', this.status()); };
    this.autoTask = (async () => {
      try {
        if (!this.base) this.setRoot(this.defaultRoot());
        if (!this.machine()) { say({ stage: 'install' }); await this.install(); }
        if (this.state.phase !== 'running') { say({ stage: 'start' }); await this.start(); }
        say({ stage: 'done' });
      } catch (e) { say({ stage: 'error', error: e.message }); } finally { this.autoTask = null; }
    })();
    return this.status();
  }

  // ---------------- Máy chủ /freevideo/agent/v1 (giống engine đầy đủ, phần dùng cho Tạo video / Hàng đợi / Thư viện)
  async openServer() {
    fs.mkdirSync(this.p('agent'), { recursive: true });
    const tokenFile = this.p('agent', 'token');
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString('base64url'));
    this.token = fs.readFileSync(tokenFile, 'ascii').trim();
    this.loadJobs();
    const port = await freePort();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => send(res, 500, { error: { code: 'internal_error', message: e.message } })));
    await new Promise((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = 'http://127.0.0.1:' + port;
    fs.writeFileSync(this.p('agent', 'endpoint.json'), JSON.stringify({ url: this.url, api: PREFIX }));
    if (!this.pump) this.pump = setInterval(() => this.poll().catch(() => {}), 1000);
  }
  closeServer() {
    if (this.server) { try { this.server.close(); } catch { /* bỏ qua */ } this.server = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* bỏ qua */ } this.ws = null; }
    this.url = null;
  }

  caps() {
    const running = [...this.jobs.values()].filter((j) => j.status === 'running').length;
    const pending = [...this.jobs.values()].filter((j) => j.status === 'queued').length;
    const pro = this.profile.id === 'pro';
    const sizes = pro ? LTX_SIZES : SIZES;
    const steps = (q) => (pro ? 11 : STEPS[q]);
    return { api_version: 1, freevideo_version: this.profile.id, lite: !pro, pro, video_only: true, engine_mode: this.profile.id, engine_title: this.profile.title,
      ready: true, problem: null, continuation: false,
      features: { plan: true, enhance: false, takes: false, lite: !pro, audio: pro },
      device: { backend: 'cuda' }, limits: { width: [256, 4608, 32], height: [256, 4608, 32], seconds: [1, this.profile.maxSeconds], fps: this.profile.fps, takes: 1 },
      quality: Object.fromEntries(['light', 'medium', 'high', 'max'].map((q) => [q, { two_pass: pro, base_steps: steps(q) }])),
      aspects: Object.keys(sizes.light), loras: [], vlm: { ready: false }, queue: { running, pending, agent_active: running + pending } };
  }

  geometry(spec) {
    const pro = this.profile.id === 'pro';
    const table = pro ? LTX_SIZES : SIZES;
    const quality = table[spec.quality] ? spec.quality : 'medium';
    const [width, height] = table[quality][spec.aspect] || table[quality]['16:9'];
    const max = this.profile.maxSeconds, fps = this.profile.fps;
    const seconds = Math.min(max, Math.max(1, Number(spec.seconds) || max));
    // Wan: 4n + 1 khung (≤ 121); LTX: 8n + 1 khung
    const frames = pro ? Math.round(seconds * fps / 8) * 8 + 1 : Math.min(121, Math.round(seconds * fps / 4) * 4 + 1);
    return { width, height, frames, seconds: frames / fps, fps, steps: pro ? 11 : STEPS[quality], quality };
  }

  planOf(spec) {
    if (typeof spec.prompt !== 'string' || !cleanPrompt(spec.prompt)) return [422, { error: { code: 'invalid_request', message: 'prompt is required', next: 'Hãy viết prompt.' } }];
    const g = this.geometry(spec);
    const t = this.profile.title, max = this.profile.maxSeconds;
    const warnings = [];
    if (Number(spec.seconds) > max) warnings.push(t + ' tạo tối đa ' + max + ' giây mỗi video — video sẽ được cắt còn ' + max + ' giây.');
    if (spec.media && (spec.media.last || (spec.media.references || []).length)) warnings.push(t + ' chỉ dùng ảnh mở đầu; ảnh kết thúc và tham chiếu được bỏ qua.');
    let estimate;
    if (this.profile.id === 'pro') {
      const px = g.width * g.height / (1280 * 704);
      estimate = Math.round(60 + g.frames * px * 1.1);
      if (g.quality === 'max') warnings.push('4K cần card 32 GB VRAM trở lên và rất lâu — nếu báo hết bộ nhớ, chọn chất lượng Cao (1080p).');
    } else {
      const px = g.width * g.height / (832 * 480);
      estimate = Math.round(40 + g.frames * g.steps * px * 0.35);
    }
    return [200, { spec, warnings, geometry: { width: g.width, height: g.height, frames: g.frames, seconds: g.seconds, fps: g.fps },
      sampling: { two_pass: this.profile.id === 'pro', total_steps: g.steps }, chain_plan: { blocks: 1 }, estimate: { status: 'ready', seconds: estimate } }];
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/freevideo/library/delete-batch') return this.deleteBatch(req, res);
    if (u.pathname === '/freevideo/prompt-vlm' || u.pathname.startsWith('/freevideo/prompt-vlm/')) return send(res, 400, { error: 'lite_mode' });
    if (!u.pathname.startsWith(PREFIX)) return send(res, 404, {});
    if (req.headers.authorization !== 'Bearer ' + this.token) return send(res, 401, { error: { code: 'unauthorized', message: 'Token missing or incorrect' } });
    const route = u.pathname.slice(PREFIX.length);
    const q = Object.fromEntries(u.searchParams);
    if (req.method === 'GET') {
      if (route === '' || route === '/capabilities') return send(res, 200, this.caps());
      if (route === '/jobs') {
        const rows = this.order.map((id) => this.jobs.get(id)).filter(Boolean).filter((j) => !q.kind || j.kind === q.kind);
        return send(res, 200, { jobs: rows.slice(0, Math.min(200, Number(q.limit) || 50)).map((j) => this.view(j, false)) });
      }
      let m = route.match(/^\/jobs\/([\w-]+)$/);
      if (m) { const j = this.jobs.get(m[1]); return j ? send(res, 200, { ...this.view(j), job: this.view(j) }) : send(res, 404, { error: { code: 'not_found', message: 'No such job' } }); }
      if (route === '/library') return send(res, 200, this.library(q));
      m = route.match(/^\/library\/(\d{4}-\d{2}-\d{2})\/([0-9a-f]{32})(\/file|\/thumbnail)?$/);
      if (m) {
        const dir = this.p('library', m[1], m[2]);
        const meta = readJson(path.join(dir, 'meta.json'));
        if (!meta) return send(res, 404, { error: { code: 'not_found', message: 'Library item does not exist' } });
        if (m[3] === '/file') return sendFile(req, res, path.join(dir, 'video.mp4'), 'video/mp4');
        if (m[3] === '/thumbnail') return fs.existsSync(path.join(dir, 'thumb.png')) ? sendFile(req, res, path.join(dir, 'thumb.png'), 'image/png') : send(res, 404, {});
        return send(res, 200, { ...this.libView(meta), geometry: { width: meta.width, height: meta.height, frames: meta.frames, seconds: meta.seconds, fps: 24 } });
      }
      m = route.match(/^\/media\/input\/(.+)\/file$/);
      if (m) {
        const name = path.basename(decodeURIComponent(m[1]));
        const file = this.p('ComfyUI', 'input', 'maxai', name);
        const ext = path.extname(name).toLowerCase();
        return fs.existsSync(file) ? sendFile(req, res, file, { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] || 'application/octet-stream') : send(res, 404, {});
      }
      if (route === '/cast' || route === '/imports' || route === '/queue') return send(res, 200, { items: [], cast: [] });
      return send(res, 404, { error: { code: 'lite_unsupported', message: 'Chức năng này không có ở ' + this.profile.title.toLowerCase() + '.' } });
    }
    if (req.method === 'POST') {
      if (route === '/media') return this.upload(req, res);
      const body = await readBody(req);
      if (route === '/plan') { const [s, v] = this.planOf(body || {}); return send(res, s, v); }
      if (route === '/jobs') {
        const specs = Array.isArray(body.jobs) ? body.jobs : [body];
        const made = [];
        for (const spec of specs) {
          if ((spec.kind || 'generate') !== 'generate' || spec.refine_from || spec.continue_from) {
            return send(res, 422, { error: { code: 'lite_unsupported', message: this.profile.title + ' chỉ tạo video mới từ prompt (và ảnh mở đầu).' } });
          }
          const [s, v] = this.planOf(spec);
          if (s !== 200) return send(res, s, v);
          made.push(this.newJob(spec));
        }
        this.poll().catch(() => {});
        const views = made.map((j) => this.view(j));
        return send(res, 201, made.length === 1 ? { job: views[0], ...views[0] } : { jobs: views });
      }
      let m = route.match(/^\/jobs\/([\w-]+)\/(cancel|resume)$/);
      if (m) {
        const j = this.jobs.get(m[1]);
        if (!j) return send(res, 404, { error: { code: 'not_found', message: 'No such job' } });
        if (m[2] === 'cancel') await this.cancelJob(j);
        else if (['failed', 'cancelled', 'interrupted'].includes(j.status)) { Object.assign(j, { status: 'queued', error: null, started_at: null, finished_at: null, prompt_id: null, progress: null }); this.saveJobs(); this.poll().catch(() => {}); }
        else return send(res, 409, { error: { code: 'not_resumable', message: 'Only failed, interrupted or cancelled jobs can resume.' } });
        return send(res, 200, this.view(j));
      }
      return send(res, 404, { error: { code: 'lite_unsupported', message: 'Chức năng này không có ở chế độ nhẹ.' } });
    }
    return send(res, 405, {});
  }

  async upload(req, res) {
    const type = req.headers['content-type'] || '';
    const raw = await readRaw(req, 60 * 1024 * 1024);
    const boundary = (type.match(/boundary=(.+)$/) || [])[1];
    if (!boundary) return send(res, 400, { error: { code: 'invalid_media', message: 'Thiếu file' } });
    const parts = raw.toString('latin1').split('--' + boundary);
    const part = parts.find((p) => /name="file"/.test(p));
    if (!part) return send(res, 400, { error: { code: 'invalid_media', message: 'Thiếu file' } });
    const name = (part.match(/filename="([^"]*)"/) || [])[1] || 'media.png';
    const ext = path.extname(name).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return send(res, 415, { error: { code: 'unsupported_media', message: this.profile.title + ' chỉ nhận ảnh (PNG, JPG, WEBP).' } });
    const start = part.indexOf('\r\n\r\n') + 4;
    const data = Buffer.from(part.slice(start, part.length - 2), 'latin1');
    const file = crypto.randomBytes(12).toString('hex') + ext;
    const dir = this.p('ComfyUI', 'input', 'maxai');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), data);
    const rel = 'maxai/' + file;
    return send(res, 201, { file: rel, kind: 'image', url: PREFIX + '/media/input/' + file + '/file', thumbnail: PREFIX + '/media/input/' + file + '/file' });
  }

  newJob(spec) {
    const id = (this.profile.id === 'pro' ? 'x' : 'j') + crypto.randomBytes(6).toString('hex');
    const job = { id, kind: 'generate', status: 'queued', spec, client: 'Max AI', created_at: now(), started_at: null, finished_at: null, result: null, error: null };
    this.jobs.set(id, job);
    this.order.unshift(id);
    if (this.order.length > 500) for (const old of this.order.splice(500)) this.jobs.delete(old);
    this.saveJobs();
    return job;
  }

  view(j, detail = true) {
    const v = { id: j.id, kind: j.kind, status: j.status, client: j.client, created_at: j.created_at, started_at: j.started_at, finished_at: j.finished_at,
      label: j.spec.label, poll_after_ms: ['queued', 'running', 'cancelling'].includes(j.status) ? 1000 : null };
    if (j.status === 'queued') {
      const ahead = this.order.map((id) => this.jobs.get(id)).filter((x) => x && ['queued', 'running'].includes(x.status) && x.created_at < j.created_at).length;
      v.progress = { phase: 'queued', label: 'Waiting in the queue', queue_position: ahead + 1 };
    } else if (j.status === 'running' || j.status === 'cancelling') {
      v.progress = j.progress || { phase: 'loading', fraction: 0.02 };
    } else if (j.status === 'succeeded') v.progress = { phase: 'complete', fraction: 1 };
    if (j.result) v.result = j.result;
    if (j.error) v.error = j.error;
    if (detail) v.spec = j.spec;
    return v;
  }

  // Đưa việc kế tiếp sang ComfyUI và theo dõi việc đang chạy
  async poll() {
    if (!this.comfyUrl || this.polling) return;
    this.polling = true;
    try {
      const running = this.order.map((id) => this.jobs.get(id)).find((j) => j && (j.status === 'running' || j.status === 'cancelling'));
      if (running) return await this.check(running);
      const next = [...this.order].reverse().map((id) => this.jobs.get(id)).find((j) => j && j.status === 'queued');
      // gate: chế độ Chất lượng cao chạy cùng engine bản đầy đủ — chỉ dùng GPU khi engine kia rảnh
      if (next && (!this.gate || await this.gate().catch(() => false))) await this.submit(next);
    } finally { this.polling = false; }
  }

  async submit(job) {
    const g = this.geometry(job.spec);
    const run = crypto.randomBytes(16).toString('hex');
    const seed = Number.isFinite(Number(job.spec.seed)) && job.spec.seed !== undefined ? Number(job.spec.seed) : crypto.randomInt(0, 2 ** 31);
    const first = job.spec.media && job.spec.media.first && job.spec.media.first.file;
    const image = first ? String(first).replace(/^.*?maxai\//, 'maxai/') : null;
    const graph = this.profile.id === 'pro'
      ? ltxWorkflow({ prompt: cleanPrompt(job.spec.prompt), width: g.width, height: g.height, frames: g.frames, fps: g.fps, seed, run, image })
      : workflow({ prompt: cleanPrompt(job.spec.prompt), width: g.width, height: g.height, frames: g.frames, steps: g.steps, seed, run, image, fp8: await this.lowVram() });
    try {
      const r = await fetch(this.comfyUrl + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'maxai' }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.prompt_id) {
        const detail = data.error ? (data.error.message || '') + ' ' + JSON.stringify(data.node_errors || {}).slice(0, 300) : 'HTTP ' + r.status;
        throw new Error(detail);
      }
      Object.assign(job, { status: 'running', started_at: now(), prompt_id: data.prompt_id, run, seed, geometry: g, progress: { phase: 'loading', fraction: 0.02 } });
    } catch (e) {
      Object.assign(job, { status: 'failed', finished_at: now(), error: { code: 'comfy_error', message: 'Không gửi được việc cho ComfyUI: ' + e.message } });
    }
    this.saveJobs();
  }

  busy() { return [...this.jobs.values()].some((j) => j.status === 'running' || j.status === 'cancelling'); }
  hasWork() { return [...this.jobs.values()].some((j) => ['queued', 'running', 'cancelling'].includes(j.status)); }
  isLibraryItem(id) { const m = String(id).match(/^(\d{4}-\d{2}-\d{2})\/([0-9a-f]{32})$/); return Boolean(m && this.root && fs.existsSync(this.p('library', m[1], m[2], 'meta.json'))); }

  async lowVram() { const hw = await this.hardware(); return !hw.vram || hw.vram < 11.5 * 1024 ** 3; }

  // Việc vừa kết thúc → báo ra ngoài (vd. giải phóng VRAM cho engine bản đầy đủ)
  finished(job) {
    if (this.afterJob) Promise.resolve().then(() => this.afterJob(job)).catch(() => {});
  }

  async check(job) {
    const r = await fetch(this.comfyUrl + '/history/' + job.prompt_id).then((x) => x.json()).catch(() => null);
    const h = r && r[job.prompt_id];
    if (!h) {
      if (job.status === 'cancelling') {
        const q = await fetch(this.comfyUrl + '/queue').then((x) => x.json()).catch(() => null);
        const inQueue = q && [...(q.queue_running || []), ...(q.queue_pending || [])].some((row) => row[1] === job.prompt_id);
        if (!inQueue) { Object.assign(job, { status: 'cancelled', finished_at: now(), error: { code: 'cancelled', message: 'Cancelled by the user' } }); this.saveJobs(); this.finished(job); }
      }
      return;
    }
    const st = h.status || {};
    if (st.status_str === 'error' || (st.completed === false && st.status_str !== 'success')) {
      const msg = (st.messages || []).find((m) => m[0] === 'execution_error');
      const text = msg ? String(msg[1].exception_message || '').trim() : 'ComfyUI báo lỗi';
      const oom = /out of memory|CUDA error: out of memory|allocation/i.test(text);
      if (job.status === 'cancelling' || (st.messages || []).some((m) => m[0] === 'execution_interrupted')) {
        Object.assign(job, { status: 'cancelled', finished_at: now(), error: { code: 'cancelled', message: 'Cancelled by the user' } });
      } else {
        Object.assign(job, { status: 'failed', finished_at: now(), error: oom
          ? { code: 'out_of_memory', message: 'Card đồ hoạ không đủ bộ nhớ.', next: 'Chọn chất lượng Nhanh hoặc giảm thời lượng rồi chạy lại.' }
          : { code: 'comfy_error', message: text.slice(0, 400) } });
      }
      this.saveJobs();
      this.finished(job);
      return;
    }
    if (!st.completed) return;
    // Tìm file video và ảnh đại diện trong kết quả
    let video = null, thumb = null;
    for (const out of Object.values(h.outputs || {})) {
      for (const f of [...(out.images || []), ...(out.videos || []), ...(out.gifs || [])]) {
        if (!f || !f.filename) continue;
        const file = path.join(this.p('ComfyUI', f.type === 'temp' ? 'temp' : 'output'), f.subfolder || '', f.filename);
        if (/\.(mp4|webm|mov)$/i.test(f.filename)) video = file;
        else if (/\.png$/i.test(f.filename)) thumb = file;
      }
    }
    if (!video || !fs.existsSync(video)) {
      Object.assign(job, { status: 'failed', finished_at: now(), error: { code: 'no_output', message: 'ComfyUI chạy xong nhưng không thấy file video.' } });
      this.saveJobs();
      this.finished(job);
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const dir = this.p('library', day, job.run);
    fs.mkdirSync(dir, { recursive: true });
    moveFile(video, path.join(dir, 'video.mp4'));
    if (thumb && fs.existsSync(thumb)) moveFile(thumb, path.join(dir, 'thumb.png'));
    const g = job.geometry || this.geometry(job.spec);
    const meta = { id: day + '/' + job.run, created_at: now(), prompt: job.spec.prompt, width: g.width, height: g.height, frames: g.frames, seconds: g.seconds, seed: job.seed, job: job.id };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    job.result = { video: { file: 'lite/' + meta.id + '/video.mp4', url: PREFIX + '/library/' + meta.id + '/file' }, library_id: meta.id,
      width: g.width, height: g.height, frames: g.frames, seconds: g.seconds, seed: job.seed, preview: false };
    Object.assign(job, { status: 'succeeded', finished_at: now(), progress: null });
    this.saveJobs();
    this.finished(job);
  }

  async cancelJob(job) {
    if (job.status === 'queued') { Object.assign(job, { status: 'cancelled', finished_at: now(), error: { code: 'cancelled', message: 'Cancelled by the user' } }); this.saveJobs(); return; }
    if (job.status !== 'running') return;
    job.status = 'cancelling';
    try {
      await fetch(this.comfyUrl + '/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [job.prompt_id] }) });
      await fetch(this.comfyUrl + '/interrupt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: job.prompt_id }) });
    } catch { /* bỏ qua */ }
    this.saveJobs();
  }

  // Tiến độ từng bước qua WebSocket của ComfyUI
  listen() {
    if (typeof WebSocket === 'undefined' || !this.comfyUrl) return;
    try {
      const ws = new WebSocket(this.comfyUrl.replace('http', 'ws') + '/ws?clientId=maxai');
      this.ws = ws;
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        let m; try { m = JSON.parse(e.data); } catch { return; }
        const d = m.data || {};
        const job = [...this.jobs.values()].find((j) => j.prompt_id && j.prompt_id === d.prompt_id && j.status === 'running');
        if (!job) return;
        const P = this.profile;
        if (m.type === 'progress' && d.max) {
          const f = d.value / d.max;
          const node = String(job.node);
          const si = P.sampler.indexOf(node);
          if (si >= 0) {
            // nhiều tầng lấy mẫu (LTX: tầng 1 nửa kích thước 8 bước, tầng 2 đủ kích thước 3 bước)
            const share = 0.8 / P.sampler.length;
            job.progress = { phase: 'sampling', fraction: 0.1 + si * share + f * share, step: { done: d.value, total: d.max }, pass: P.sampler.length > 1 ? si + 1 : undefined };
          } else if (P.decoder.includes(node)) job.progress = { phase: 'decoding', fraction: 0.9 + f * 0.09 };
          else job.progress = { phase: 'loading', fraction: 0.05 };
        } else if (m.type === 'executing') {
          job.node = d.node;
          if (P.decoder.includes(String(d.node))) job.progress = { phase: 'decoding', fraction: 0.92 };
          else if (P.loaders.includes(String(d.node))) job.progress = { phase: 'loading', fraction: 0.04 };
        }
      };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; if (this.comfyUrl) setTimeout(() => this.listen(), 3000); } };
      ws.onerror = () => {};
    } catch { /* không có WebSocket: chỉ thiếu số bước */ }
  }

  library(q) {
    const items = [];
    const base = this.p('library');
    let days = [];
    try { days = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); } catch { /* chưa có */ }
    for (const d of days) {
      for (const run of fs.readdirSync(path.join(base, d))) {
        const meta = readJson(path.join(base, d, run, 'meta.json'));
        if (meta && fs.existsSync(path.join(base, d, run, 'video.mp4'))) items.push(meta);
      }
    }
    items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    let list = items;
    if (q.query) list = list.filter((i) => String(i.prompt).toLowerCase().includes(String(q.query).toLowerCase()));
    let start = 0;
    if (q.before) start = Math.max(0, list.findIndex((i) => i.id === q.before) + 1);
    const limit = Math.min(200, Number(q.limit) || 24);
    const page = list.slice(start, start + limit);
    return { items: page.map((i) => this.libView(i)), next: start + limit < list.length && page.length ? page[page.length - 1].id : null };
  }
  libView(i) {
    return { id: i.id, created_at: i.created_at, video: { file: 'lite/' + i.id + '/video.mp4', url: PREFIX + '/library/' + i.id + '/file' }, width: i.width, height: i.height,
      seconds: i.seconds, preview: false, prompt: String(i.prompt || '').slice(0, 600), seed: i.seed, job: i.job || null, thumbnail: PREFIX + '/library/' + i.id + '/thumbnail' };
  }

  async deleteBatch(req, res) {
    const body = await readBody(req);
    const deleted = [], skipped = [];
    for (const id of Array.isArray(body.ids) ? body.ids : []) {
      const m = String(id).match(/^(\d{4}-\d{2}-\d{2})\/([0-9a-f]{32})$/);
      if (!m) { skipped.push(id); continue; }
      const dir = this.p('library', m[1], m[2]);
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); deleted.push(id); } else skipped.push(id);
    }
    send(res, 200, { deleted, skipped });
  }

  loadJobs() {
    const saved = readJson(this.p('jobs.json'));
    if (!saved || this.jobs.size) return;
    for (const j of saved.jobs || []) {
      if (j.status === 'running' || j.status === 'cancelling') Object.assign(j, { status: 'interrupted', error: { code: 'interrupted', message: 'Engine đã tắt khi đang tạo.', next: 'Bấm Chạy lại.' } });
      this.jobs.set(j.id, j);
      this.order.push(j.id);
    }
  }
  saveJobs() {
    if (!this.root) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { fs.writeFileSync(this.p('jobs.json'), JSON.stringify({ jobs: this.order.slice(0, 300).map((id) => this.jobs.get(id)).filter(Boolean) })); } catch { /* bỏ qua */ }
    }, 300);
  }
}

// Workflow ComfyUI (định dạng API) — theo mẫu chính thức "Wan 2.2 5B TI2V" của ComfyUI, thêm ảnh đại diện
function workflow({ prompt, width, height, frames, steps, seed, run, image, fp8 }) {
  const g = {
    37: { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_ti2v_5B_fp16.safetensors', weight_dtype: fp8 ? 'fp8_e4m3fn' : 'default' } },
    38: { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    39: { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
    48: { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['37', 0] } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['38', 0] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE, clip: ['38', 0] } },
    55: { class_type: 'Wan22ImageToVideoLatent', inputs: { width, height, length: frames, batch_size: 1, vae: ['39', 0] } },
    3: { class_type: 'KSampler', inputs: { seed, steps, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1,
      model: ['48', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['55', 0] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['39', 0] } },
    57: { class_type: 'CreateVideo', inputs: { images: ['8', 0], fps: 24 } },
    58: { class_type: 'SaveVideo', inputs: { video: ['57', 0], filename_prefix: 'maxai/' + run, format: 'auto', codec: 'auto' } },
    60: { class_type: 'ImageFromBatch', inputs: { image: ['8', 0], batch_index: 0, length: 1 } },
    61: { class_type: 'SaveImage', inputs: { images: ['60', 0], filename_prefix: 'maxai/' + run + '_thumb' } },
  };
  if (image) {
    g[56] = { class_type: 'LoadImage', inputs: { image } };
    g[55].inputs.start_image = ['56', 0];
  }
  return g;
}

// Workflow LTX-2.3 (định dạng API) — theo mẫu chính thức "LTX-2.3 T2V / I2V" của ComfyUI:
// tầng 1 ở nửa kích thước (8 bước, LoRA distilled), phóng to ×2 trong không gian ẩn, tầng 2 đủ kích thước (3 bước), âm thanh tạo cùng lượt
function ltxWorkflow({ prompt, width, height, frames, fps, seed, run, image }) {
  const ckpt = 'ltx-2.3-22b-dev-fp8.safetensors';
  const bypass = !image;
  const g = {
    236: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    243: { class_type: 'LTXAVTextEncoderLoader', inputs: { text_encoder: 'gemma_3_12B_it_fp8_scaled.safetensors', ckpt_name: ckpt, device: 'default' } },
    221: { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: ckpt } },
    232: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['236', 0], lora_name: 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors', strength_model: 0.5 } },
    233: { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors' } },
    240: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['243', 0] } },
    247: { class_type: 'CLIPTextEncode', inputs: { text: LTX_NEGATIVE, clip: ['243', 0] } },
    239: { class_type: 'LTXVConditioning', inputs: { positive: ['240', 0], negative: ['247', 0], frame_rate: fps } },
    235: { class_type: 'ResizeImagesByLongerEdge', inputs: { images: image ? ['238', 0] : ['325', 0], longer_edge: 1536 } },
    248: { class_type: 'LTXVPreprocess', inputs: { image: ['235', 0], img_compression: 18 } },
    228: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    249: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['236', 2], image: ['248', 0], latent: ['228', 0], strength: 0.7, bypass } },
    214: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['221', 0] } },
    222: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['249', 0], audio_latent: ['214', 0] } },
    237: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    231: { class_type: 'CFGGuider', inputs: { model: ['232', 0], positive: ['239', 0], negative: ['239', 1], cfg: 1 } },
    209: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    252: { class_type: 'ManualSigmas', inputs: { sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' } },
    215: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['237', 0], guider: ['231', 0], sampler: ['209', 0], sigmas: ['252', 0], latent_image: ['222', 0] } },
    217: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['215', 0] } },
    253: { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['217', 0], upscale_model: ['233', 0], vae: ['236', 2] } },
    230: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['236', 2], image: ['248', 0], latent: ['253', 0], strength: 1, bypass } },
    229: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['230', 0], audio_latent: ['217', 1] } },
    212: { class_type: 'LTXVCropGuides', inputs: { positive: ['239', 0], negative: ['239', 1], latent: ['217', 0] } },
    213: { class_type: 'CFGGuider', inputs: { model: ['232', 0], positive: ['212', 0], negative: ['212', 1], cfg: 1 } },
    216: { class_type: 'RandomNoise', inputs: { noise_seed: (seed + 1) % 2 ** 31 } },
    246: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    211: { class_type: 'ManualSigmas', inputs: { sigmas: '0.85, 0.7250, 0.4219, 0.0' } },
    219: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['216', 0], guider: ['213', 0], sampler: ['246', 0], sigmas: ['211', 0], latent_image: ['229', 0] } },
    218: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['219', 0] } },
    251: { class_type: 'VAEDecodeTiled', inputs: { samples: ['218', 0], vae: ['236', 2], tile_size: 768, overlap: 64, temporal_size: 4096, temporal_overlap: 4 } },
    220: { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['218', 1], audio_vae: ['221', 0] } },
    242: { class_type: 'CreateVideo', inputs: { images: ['251', 0], audio: ['220', 0], fps } },
    75: { class_type: 'SaveVideo', inputs: { video: ['242', 0], filename_prefix: 'maxai/' + run, format: 'auto', codec: 'auto' } },
    60: { class_type: 'ImageFromBatch', inputs: { image: ['251', 0], batch_index: 0, length: 1 } },
    61: { class_type: 'SaveImage', inputs: { images: ['60', 0], filename_prefix: 'maxai/' + run + '_thumb' } },
  };
  if (image) {
    g[56] = { class_type: 'LoadImage', inputs: { image } };
    g[238] = { class_type: 'ResizeImageMaskNode', inputs: { input: ['56', 0], resize_type: 'scale dimensions', 'resize_type.width': width, 'resize_type.height': height, 'resize_type.crop': 'center', scale_method: 'lanczos' } };
  } else {
    g[325] = { class_type: 'EmptyImage', inputs: { width, height, batch_size: 1, color: 0 } };
  }
  return g;
}

// Prompt H3 ("integrated_multimodal_description: …") → câu mô tả thường cho Wan
function cleanPrompt(text) {
  return String(text || '')
    .replace(/^\s*(integrated_multimodal_description|overall_soundscape|non_diegetic_music|dialogue|speech)\s*:\s*/gim, '')
    .replace(/\[Shot \d+\]\s*/g, '')
    .replace(/^\s*N\/A\s*$/gim, '')
    .replace(/\s*\n+\s*/g, ' ').trim().slice(0, 4000);
}

function send(res, status, value) {
  if (res.headersSent) return;
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}
function sendFile(req, res, file, type) {
  let size;
  try { size = fs.statSync(file).size; } catch { return send(res, 404, {}); }
  let start = 0, end = size - 1, status = 200;
  const m = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) { start = Number(m[1] || 0); end = m[2] ? Math.min(size - 1, Number(m[2])) : size - 1; status = 206; }
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1 };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  fs.createReadStream(file, { start, end }).pipe(res);
}
function readRaw(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req) { const raw = await readRaw(req); try { return raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { return {}; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function moveFile(from, to) { try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); fs.rmSync(from, { force: true }); } }
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function killTree(child) {
  try {
    if (IS_WIN) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
    else child.kill('SIGTERM');
  } catch { /* đã thoát */ }
}

module.exports = { LiteEngine, workflow, ltxWorkflow, cleanPrompt, MODELS, LTX_MODELS, COMFY, PROFILES };
