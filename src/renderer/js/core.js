'use strict';
/* Lõi giao diện: tạo phần tử, gọi API, thông báo, điều hướng, theo dõi hàng đợi. */
const App = {
  config: null,      // { url, root, hasToken, prefs }
  caps: null,        // GET /freevideo/agent/v1 — khả năng của máy
  jobs: [],          // danh sách job gần nhất
  pages: {},
  current: null,
  handoff: null,     // dữ liệu chuyển giữa các trang (vd. "dùng lại prompt")
  listeners: {},
  connected: false,
};

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const icon = (name, cls = '') => h('span', { class: 'ms ' + cls }, name);
const $ = (sel, root = document) => root.querySelector(sel);

App.on = (event, fn) => { (App.listeners[event] ||= new Set()).add(fn); return () => App.listeners[event].delete(fn); };
App.emit = (event, data) => { for (const fn of App.listeners[event] || []) { try { fn(data); } catch (e) { console.error(e); } } };

class ApiError extends Error {
  constructor(error, status) { super(error.message || 'Lỗi'); Object.assign(this, error); this.status = status; }
}

// Gọi API; ném ApiError khi lỗi.
async function api(method, route, body) {
  const reply = await window.fv.api(method, route, body);
  if (!reply.ok) throw new ApiError(reply.error || {}, reply.status);
  return reply.data;
}

const ERROR_VI = {
  unreachable: 'Engine chưa chạy. Vào mục Engine & mô hình và bấm Bật engine.',
  no_token: 'Engine chưa cài. Vào mục Engine & mô hình để cài.',
  unauthorized: 'Engine vừa khởi động lại — thử lại sau vài giây.',
  not_ready: 'Engine chưa sẵn sàng (đang cài hoặc thiếu mô hình).',
  pack_missing: 'Chưa tải mô hình tạo ảnh. Vào Engine & mô hình → bấm Tải ở "Tạo ảnh nhanh" hoặc "Tạo ảnh chất lượng cao".',
  model_unavailable: 'Máy này không chạy được mô hình ảnh đã chọn (H3 Image trên Mac). Hãy chọn Qwen Image hoặc "Tự động".',
  no_memory: 'Không đủ bộ nhớ GPU/RAM cho ảnh này. Thử khung hình nhỏ hơn, độ phân giải Tiêu chuẩn, hoặc tắt bớt ứng dụng khác.',
  small_memory: 'Máy không đủ bộ nhớ để tạo ảnh.',
  invalid_dimensions: 'Kích thước ảnh không hợp lệ (256–2048 px).',
  invalid_prompt: 'Mô tả ảnh phải có chữ và tối đa 2000 ký tự.',
  too_many_images: 'Tối đa 4 ảnh đầu vào.',
  busy_video: 'Đang tạo video — ảnh sẽ chạy khi video xong.',
  busy: 'Đang tạo ảnh khác — ảnh này sẽ chạy tiếp theo.',
  disk_full: 'Ổ đĩa đầy. Hãy giải phóng dung lượng rồi thử lại.',
  generation_failed: 'Tạo ảnh không thành công. Thử lại hoặc đổi mô tả.',
  worker_exit: 'Bộ tạo ảnh bị dừng giữa chừng. Bấm Chạy lại.',
  out_of_memory: 'Card đồ họa hết bộ nhớ. Giảm chất lượng hoặc thời lượng rồi chạy lại.',
  no_speech_model: 'Chưa tải mô hình nhận dạng giọng nói cho ngôn ngữ này. Vào Engine & mô hình → tải "Phụ đề tự động".',
  cancelled: 'Đã huỷ.',
};
// Câu gốc của engine có thể nhắc tên dự án nguồn — luôn gọi là Max AI Engine.
const brandText = (t) => String(t || '').replace(/FreeVideo/g, 'Max AI Engine');
function errorText(error) {
  const code = error && error.code;
  if (code && ERROR_VI[code]) return ERROR_VI[code];
  const detail = JSON.stringify((error && error.details) || '') + ' ' + ((error && error.message) || '');
  if (/front picture/i.test(detail)) return 'Thẻ nhân vật chưa có ảnh chính diện. Vào trang Nhân vật → bấm "AI vẽ", hoặc thêm ảnh và chọn góc "Chính diện".';
  if (code === 'invalid_request' && /picture/i.test((error && error.message) || '')) {
    return 'Yêu cầu tạo ảnh không hợp lệ. Nếu có chọn nhân vật: cần gói "Tạo ảnh nhanh" (Qwen Image) và thẻ nhân vật phải có ảnh chính diện.';
  }
  return brandText((error && error.message) || String(error));
}

function toast(message, { kind = 'info', sub, action, timeout = 5000 } = {}) {
  const icons = { info: 'info', ok: 'check_circle', err: 'error' };
  const node = h('div', { class: 'toast ' + kind }, icon(icons[kind] || 'info'),
    h('div', {}, h('div', {}, message), sub ? h('div', { class: 'sub' }, sub) : null),
    action ? h('button', { class: 'act', onclick: () => { action.run(); node.remove(); } }, action.label) : null);
  $('#toasts').append(node);
  setTimeout(() => node.remove(), action ? timeout * 2 : timeout);
}
function toastError(error, prefix) {
  toast((prefix ? prefix + ': ' : '') + errorText(error), { kind: 'err', sub: error && error.next && !ERROR_VI[error.code] ? brandText(error.next) : undefined, timeout: 9000 });
}

/* ---------- Định dạng ---------- */
function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return '—';
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return seconds + ' giây';
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (m < 60) return m + ' phút' + (s ? ' ' + s + ' giây' : '');
  return Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút';
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return (same ? 'Hôm nay ' : d.toLocaleDateString('vi-VN') + ' ') + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
}
const STATUS = {
  waiting: ['Đang chờ', 'schedule'], queued: ['Trong hàng đợi', 'hourglass_top'], running: ['Đang chạy', 'progress_activity'],
  cancelling: ['Đang huỷ', 'progress_activity'], succeeded: ['Hoàn tất', 'check_circle'], failed: ['Lỗi', 'error'],
  cancelled: ['Đã huỷ', 'cancel'], interrupted: ['Bị gián đoạn', 'warning'],
};
const ACTIVE = new Set(['waiting', 'queued', 'running', 'cancelling']);
const PHASES = {
  queued: 'Đang xếp hàng', starting: 'Đang khởi động', loading: 'Đang nạp model', encoding: 'Đang mã hoá prompt',
  sampling: 'Đang tạo', refining: 'Đang làm nét', decoding: 'Đang giải mã', saving: 'Đang lưu', joining: 'Đang ghép các phần',
  upscaling: 'Đang phóng to', complete: 'Hoàn tất', interrupted: 'Bị gián đoạn', running: 'Đang chạy', cancelling: 'Đang huỷ',
};
const KINDS = { generate: 'Video', image: 'Ảnh', enhance: 'Viết prompt', assemble: 'Ghép video', vlm: 'Hỏi AI', export: 'Xuất video', listen: 'Phụ đề', voice_lines: 'Nghe lời thoại', voice: 'Lồng tiếng', voice_say: 'Lồng tiếng', image_edit: 'Sửa ảnh', music: 'Nhạc nền', stems: 'Tách âm', finish_sound: 'Hoàn thiện âm thanh' };

function statusBadge(status) {
  const [text, name] = STATUS[status] || [status, 'help'];
  return h('span', { class: 'status ' + status }, icon(name, (status === 'running' || status === 'cancelling') ? 'spin' : 'fill'), text);
}
function progressInfo(job) {
  const p = job.progress || {};
  let fraction = typeof p.fraction === 'number' ? p.fraction : null;
  if (fraction === null && p.step && p.step.total) fraction = p.step.done / p.step.total;
  const parts = [];
  parts.push(PHASES[p.phase] || p.label || (STATUS[job.status] || [job.status])[0]);
  if (p.block && p.block.total > 1) parts.push('phần ' + p.block.index + '/' + p.block.total);
  if (p.step && p.step.total) parts.push('bước ' + p.step.done + '/' + p.step.total);
  if (p.queue_position) parts.push('vị trí ' + p.queue_position);
  if (typeof p.remaining_seconds === 'number') parts.push('còn ~' + fmtDuration(p.remaining_seconds));
  return { fraction, label: parts.join(' · ') };
}
function progressBar(fraction) {
  const bar = h('div', { class: 'progress' + (fraction === null ? ' indeterminate' : '') }, h('div'));
  if (fraction !== null) bar.firstChild.style.width = Math.round(Math.min(1, Math.max(0, fraction)) * 100) + '%';
  return bar;
}
function jobTitle(job) {
  const spec = job.spec || {};
  const prompt = typeof spec.prompt === 'string' ? spec.prompt : '';
  return job.label || firstSentence(prompt) || (KINDS[job.kind] || job.kind) + ' ' + job.id;
}
function firstSentence(text) {
  if (!text) return '';
  const clean = text.replace(/^[a-z_]+:\s*/m, '').replace(/\[Shot \d+\]\s*/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > 140 ? clean.slice(0, 140) + '…' : clean;
}

/* ---------- Media ---------- */
const mediaUrl = (route) => window.fv.mediaUrl(route);
function jobVideo(job) { return job && job.result && job.result.video ? job.result.video : null; }
function jobImages(job) {
  const r = job && job.result;
  if (!r) return [];
  if (Array.isArray(r)) return r.filter((x) => x && x.url);
  if (Array.isArray(r.images)) return r.images.filter((x) => x && x.url);
  return r.url ? [r] : [];
}
async function saveMedia(route, name) {
  const reply = await window.fv.save(route, name);
  if (reply && reply.ok) toast('Đã lưu file', { kind: 'ok', sub: reply.data.path });
  else if (reply && !reply.cancelled) toastError(reply.error || {}, 'Không lưu được');
}

/* ---------- Điều hướng ---------- */
function registerPage(name, page) { App.pages[name] = page; }
function navigate(route, params) {
  const [name, sub] = route.split('/');
  const page = App.pages[name];
  if (!page) return;
  if (App.current && App.current.leave) { try { App.current.leave(); } catch (e) { console.error(e); } }
  const content = $('#content');
  content.innerHTML = '';
  content.scrollTop = 0;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === route));
  App.current = page;
  App.currentRoute = route;
  const title = { video: 'Tạo video', image: 'Tạo ảnh', queue: 'Hàng đợi', library: 'Thư viện', settings: 'Cài đặt', engine: 'Engine & mô hình', soon: 'Sắp có', edit: 'Sửa ảnh', cast: 'Nhân vật', autopilot: 'Autopilot', dubbing: 'Lồng tiếng', subtitles: 'Phụ đề' }[name];
  if ($('#pageTitle')) $('#pageTitle').textContent = title || '';
  page.render(content, Object.assign({ sub }, params || {}));
}

/* ---------- Drawer ---------- */
function openDrawer(title, body, actions) {
  const drawer = $('#drawer');
  drawer.innerHTML = '';
  drawer.append(
    h('div', { class: 'drawer-head' }, h('h2', {}, title), ...(actions || []),
      h('button', { class: 'icon-btn', title: 'Đóng (Esc)', onclick: closeDrawer }, icon('close'))),
    h('div', { class: 'drawer-body' }, body));
  drawer.classList.add('open');
  $('#drawer-scrim').classList.remove('hidden');
}
function closeDrawer() {
  const drawer = $('#drawer');
  drawer.querySelectorAll('video').forEach((v) => v.pause());
  drawer.classList.remove('open');
  $('#drawer-scrim').classList.add('hidden');
}

/* ---------- Cài đặt người dùng ---------- */
function pref(key, fallback) {
  const prefs = (App.config && App.config.prefs) || {};
  return key in prefs ? prefs[key] : fallback;
}
async function setPref(key, value) {
  App.config.prefs = { ...(App.config.prefs || {}), [key]: value };
  try { App.config = await window.fv.config.set({ prefs: { [key]: value } }); } catch (e) { console.error(e); }
}

/* ---------- Theo dõi hàng đợi ---------- */
const Poller = {
  timer: null, busy: false, known: new Map(),
  start() { this.tick(); },
  soon(ms = 300) { clearTimeout(this.timer); this.timer = setTimeout(() => this.tick(), ms); },
  async tick() {
    clearTimeout(this.timer);
    if (this.busy) return;
    this.busy = true;
    let active = false;
    try {
      const data = await api('GET', '/jobs?limit=60');
      const jobs = data.jobs || [];
      App.jobs = jobs;
      active = jobs.some((j) => ACTIVE.has(j.status));
      for (const job of jobs) {
        const before = this.known.get(job.id);
        if (before && ACTIVE.has(before) && !ACTIVE.has(job.status)) App.emit('job-done', job);
        this.known.set(job.id, job.status);
      }
      App.emit('jobs', jobs);
      setConnected(true);
    } catch (error) {
      setConnected(false, error);
    } finally {
      this.busy = false;
      this.timer = setTimeout(() => this.tick(), active ? 1500 : (App.connected ? 6000 : 4000));
    }
  },
};

function setConnected(ok, error) {
  const changed = ok !== App.connected;
  App.connected = ok;
  App.connectionError = ok ? null : error;
  App.emit('connection', { ok, error });
  if (changed && ok) refreshCaps();
}
async function refreshCaps() {
  try {
    App.caps = await api('GET', '');
    App.emit('caps', App.caps);
  } catch (error) {
    console.warn('capabilities', error);
  }
}

// Lấy chi tiết 1 job (có spec, prompt đầy đủ).
const jobDetails = new Map();
async function jobDetail(id, fresh) {
  if (!fresh && jobDetails.has(id)) return jobDetails.get(id);
  const job = await api('GET', '/jobs/' + id);
  if (!ACTIVE.has(job.status)) jobDetails.set(id, job);
  return job;
}
function labelFrom(text) {
  const t = firstSentence(text || '');
  return t.length > 110 ? t.slice(0, 110) + '…' : t;
}
