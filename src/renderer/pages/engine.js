'use strict';
/* Trang Engine & mô hình: tự cài engine FreeVideo + tải mô hình MiniMax H3 ngay trên máy (giống FreeVideo), bật/tắt engine. */

const ENGINE_PHASE = {
  idle: ['Chưa cài', 'bad'], planning: ['Đang kiểm tra máy', 'warn'], planned: ['Chưa cài', 'bad'], installing: ['Đang cài & tải mô hình', 'warn'],
  installed: ['Đã cài · đang tắt', 'warn'], starting: ['Đang khởi động', 'warn'], running: ['Đang chạy', 'ok'], stopping: ['Đang tắt', 'warn'],
  stopped: ['Đã cài · đang tắt', 'warn'], failed: ['Có lỗi', 'bad'], cancelled: ['Đã tạm dừng cài', 'warn'],
};
const gib = (b) => (b ? (b / 2 ** 30).toFixed(b >= 10 * 2 ** 30 ? 0 : 1) + ' GB' : '—');
const Eng = { st: null };

// Dịch các lỗi hay gặp của trình cài FreeVideo sang tiếng Việt (giữ nguyên câu gốc nếu không nhận ra).
function viEngineError(t) {
  if (!t) return t;
  return String(t)
    .replace(/Insufficient disk space: need ([\d.]+) GiB, available ([\d.]+) GiB, short ([\d.]+) GiB/g, 'Ổ đĩa không đủ chỗ: cần $1 GB, còn $2 GB, thiếu $3 GB — hãy chọn thư mục ở ổ khác')
    .replace(/GPU detection failed\./g, 'Không nhận được card đồ họa NVIDIA.')
    .replace(/Install NVIDIA driver (\d+)\+ and restart before setup\./g, 'Hãy cài driver NVIDIA bản $1 trở lên rồi khởi động lại máy.')
    .replace(/Check device access and the NVIDIA driver, then retry setup\./g, 'Kiểm tra driver NVIDIA rồi thử lại.');
}

function engineLabel(st) {
  if (!st) return ['Đang đọc…', ''];
  if (st.phase === 'idle' || st.phase === 'planned') return st.installed ? ['Đã cài · đang tắt', 'warn'] : ['Chưa cài', 'bad'];
  return ENGINE_PHASE[st.phase] || [st.phase, ''];
}

async function refreshEngine() {
  try { Eng.st = await window.fv.engine.status(); } catch { return; }
  App.emit('engine', Eng.st);
}

// Thẻ engine ở menu trái
function renderEngineCard() {
  const card = $('#engineCard');
  const st = Eng.st;
  if (!card || !st) return;
  const [label, tone] = engineLabel(st);
  card.innerHTML = '';
  const action = st.phase === 'running' ? h('button', { class: 'btn up', onclick: (e) => { e.stopPropagation(); engineStop(); } }, icon('stop_circle'), 'Tắt engine')
    : st.installed && !['starting', 'installing', 'stopping'].includes(st.phase) ? h('button', { class: 'btn btn-primary up', onclick: (e) => { e.stopPropagation(); engineStart(); } }, icon('play_arrow'), 'Bật engine')
      : !st.installed && st.phase !== 'installing' ? h('button', { class: 'btn btn-primary up', onclick: (e) => { e.stopPropagation(); navigate('engine'); } }, icon('download'), 'Cài engine') : null;
  card.append(...[
    h('div', { class: 'tier' }, icon('memory', 'fill'), 'Engine AI', h('span', { class: 'dot ' + tone, style: { marginLeft: 'auto' } })),
    h('small', {}, label + (st.machine && st.machine.gpu ? ' · ' + st.machine.gpu : '')),
    st.phase === 'installing' && st.progress ? progressBar(overallFraction(st.progress)) : null,
    action].filter(Boolean));
  card.onclick = () => navigate('engine');
}

function overallFraction(p) {
  if (!p) return null;
  const cur = p.current;
  if (cur && cur.total) return Math.min(1, cur.done / cur.total);
  if (p.phaseTotal) return Math.min(1, p.phaseDone / p.phaseTotal);
  if (p.total) return Math.min(1, p.done / p.total);
  return null;
}

async function engineStart() {
  toast('Đang bật engine AI…', { sub: 'Lần đầu có thể mất vài phút để chuẩn bị ComfyUI.' });
  const r = await window.fv.engine.start();
  if (r.ok) { toast('Engine AI đã chạy', { kind: 'ok' }); Poller.soon(500); }
  else toast('Không bật được engine', { kind: 'err', sub: r.error.message, timeout: 12000 });
  refreshEngine();
}
async function engineStop() {
  const r = await window.fv.engine.stop();
  if (!r.ok) toast(r.error.message, { kind: 'err' });
  refreshEngine();
}

registerPage('engine', (() => {
  let unsub = [];
  const els = {};
  const opts = { imageModel: false, reuseModels: null, agree: false };

  function render(root) {
    const page = h('div', { class: 'page', style: { maxWidth: '1100px' } });
    page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Engine & mô hình'),
      h('div', { class: 'sub' }, 'Max AI tự cài engine FreeVideo và tải mô hình MiniMax H3 về chạy ngay trên máy của bạn — miễn phí, không giới hạn.'))));
    els.status = h('div');
    els.wizard = h('div');
    page.append(els.status, els.wizard,
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('info'), h('h2', {}, 'Cấu hình cần có')),
        h('div', { class: 'card-body' }, h('div', { class: 'feature-list' },
          ['Windows 10/11 64-bit hoặc Linux, card NVIDIA RTX 30 trở lên', 'Tối thiểu 8 GB VRAM, 16 GB RAM (khuyên 12 GB+ / 32 GB)',
            'Driver NVIDIA 580 trở lên', 'Khoảng 70 GB ổ đĩa trống (thêm ~16 GB nếu tải mô hình ảnh)',
            'macOS: chip Apple M, 24 GB bộ nhớ (bản thử nghiệm)', 'Mạng ổn định lúc tải (~50 GB, tải tiếp được nếu đứt)'].map((t) => h('div', {}, icon('check_circle', 'fill'), t))),
          h('div', { class: 'help mt' }, 'Đã cài FreeVideo từ trước? Vào ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('settings'); } }, 'Cài đặt › Kết nối FreeVideo có sẵn'),
            ' để dùng lại, không cần tải lại mô hình.'))));
    root.append(page);
    draw();
    refreshEngine();
    unsub = [App.on('engine', draw)];
  }
  function leave() { unsub.forEach((u) => u()); }

  function draw() {
    const st = Eng.st;
    if (!els.status) return;
    els.status.innerHTML = '';
    els.wizard.innerHTML = '';
    if (!st) { els.status.append(h('div', { class: 'card' }, h('div', { class: 'card-body muted' }, 'Đang đọc trạng thái engine…'))); return; }
    const [label, tone] = engineLabel(st);
    const m = st.machine || {};
    els.status.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('memory'), h('h2', {}, 'Trạng thái engine'), h('div', { class: 'grow' }),
        h('span', { class: 'pill ' + (tone === 'ok' ? 'ok' : tone === 'bad' ? 'bad' : '') }, h('span', { class: 'dot ' + tone }), label)),
      h('div', { class: 'card-body' },
        h('dl', { class: 'kv', style: { maxWidth: '640px' } },
          h('dt', {}, 'Thư mục cài'), h('dd', {}, h('code', {}, st.root)),
          h('dt', {}, 'Ổ đĩa còn trống'), h('dd', {}, gib(st.freeBytes)),
          h('dt', {}, 'Phiên bản engine'), h('dd', {}, 'FreeVideo ' + (st.source ? st.source.tag : st.engineTag)),
          st.installed ? [h('dt', {}, 'Card đồ họa'), h('dd', {}, (m.gpu || '—') + (m.backend === 'mps' ? ' (Apple)' : ''))] : null,
          st.installed && m.format ? [h('dt', {}, 'Định dạng mô hình'), h('dd', {}, m.format)] : null,
          st.url ? [h('dt', {}, 'Địa chỉ engine'), h('dd', {}, h('code', {}, st.url))] : null),
        st.error && st.phase === 'failed' ? h('div', { class: 'notice err' }, icon('error'), h('div', { style: { whiteSpace: 'pre-wrap' } }, viEngineError(st.error))) : null,
        h('div', { class: 'row mt' },
          st.phase === 'running' ? h('button', { class: 'btn', onclick: engineStop }, icon('stop_circle'), 'Tắt engine') : null,
          st.installed && !['running', 'starting', 'installing', 'stopping'].includes(st.phase) ? h('button', { class: 'btn btn-primary', onclick: engineStart }, icon('play_arrow'), 'Bật engine') : null,
          st.installed ? switchToggle('Tự bật khi mở Max AI', 'Engine tự tắt khi bạn đóng Max AI.', st.autostart, async (v) => { Eng.st = await window.fv.engine.autostart(v); }) : null),
        st.phase === 'starting' && st.progress ? h('div', { class: 'notice info' }, icon('progress_activity', 'spin'), st.progress.label) : null)));

    if (st.phase === 'installing' || st.phase === 'planning') { els.wizard.append(progressCard(st)); return; }
    if (st.installed && st.phase !== 'failed' && st.phase !== 'cancelled') {
      els.wizard.append(h('details', { class: 'card' }, h('summary', { class: 'card-head' }, icon('build'), h('h2', {}, 'Sửa / cập nhật engine'),
        h('div', { class: 'grow' }), icon('expand_more', 'chev')),
        h('div', { class: 'card-body' }, h('div', { class: 'help', style: { marginTop: 0 } },
          'Chạy lại trình cài để sửa file lỗi, tải thêm mô hình ảnh hoặc cập nhật engine. File đã tải được giữ lại, chỉ tải phần còn thiếu.'),
          optionsBlock(), h('div', { class: 'row mt' }, h('button', { class: 'btn btn-outline', onclick: () => doInstall(true) }, icon('build'), 'Chạy lại trình cài')))));
      return;
    }
    els.wizard.append(wizard(st));
  }

  function optionsBlock() {
    return h('div', { class: 'mt' },
      switchToggle('Tải thêm mô hình tạo ảnh (MiniMax H3 Image, ~16 GB)', 'Dùng cho trang Tạo ảnh. Có thể tải sau.', opts.imageModel, (v) => { opts.imageModel = v; }),
      h('div', { class: 'row mt' }, h('span', { class: 'muted small-text' }, 'Dùng lại mô hình có sẵn trên máy:'),
        h('code', {}, opts.reuseModels || 'không'),
        h('button', { class: 'btn btn-text', onclick: async () => { opts.reuseModels = await window.fv.engine.pickModels(); draw(); } }, icon('folder_open'), 'Chọn thư mục…'),
        opts.reuseModels ? h('button', { class: 'btn btn-text', onclick: () => { opts.reuseModels = null; draw(); } }, 'Bỏ') : null));
  }

  function wizard(st) {
    const plan = st.plan;
    const step = (n, title, done, body) => h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'pill ' + (done ? 'ok' : '') }, done ? icon('check', 'small') : String(n)), h('h2', {}, title)),
      h('div', { class: 'card-body' }, body));
    const s1 = step(1, 'Chọn nơi cài engine & mô hình', st.rootChosen, [
      h('div', { class: 'row' }, h('code', { style: { flex: 1, padding: '8px 12px' } }, st.root),
        h('span', { class: 'pill ' + (st.freeBytes > 75 * 2 ** 30 ? 'ok' : 'bad') }, 'Trống ' + gib(st.freeBytes))),
      h('div', { class: 'help' }, 'Cần khoảng 70 GB. Nên chọn ổ SSD còn nhiều chỗ trống (ví dụ ổ D:).'),
      h('div', { class: 'row mt' },
        h('button', { class: 'btn btn-outline', onclick: async () => { const r = await window.fv.engine.pickRoot(); if (r) { Eng.st = r; draw(); } } }, icon('folder_open'), 'Đổi thư mục…'),
        st.rootChosen ? null : h('button', { class: 'btn btn-primary', onclick: async () => { Eng.st = await window.fv.engine.useDefault(); draw(); } }, icon('check'), 'Dùng thư mục này'))]);
    const planBody = [];
    if (!plan) {
      planBody.push(h('div', { class: 'help', style: { marginTop: 0 } }, 'Max AI tải trình cài của engine (vài MB) rồi kiểm tra card đồ họa, bộ nhớ, ổ đĩa và mạng. Chưa cài gì cả.'),
        h('div', { class: 'row mt' }, h('button', { class: 'btn btn-primary', disabled: !st.rootChosen, onclick: doPlan }, icon('troubleshoot'), 'Kiểm tra máy')));
    } else {
      const disk = plan.disks[0] || {};
      planBody.push(h('dl', { class: 'kv', style: { maxWidth: '640px' } },
        h('dt', {}, 'Card đồ họa'), h('dd', {}, plan.gpu || '—'),
        h('dt', {}, 'VRAM / RAM'), h('dd', {}, gib(plan.vram) + ' / ' + gib(plan.ram)),
        plan.driver ? [h('dt', {}, 'Driver NVIDIA'), h('dd', {}, plan.driver)] : null,
        h('dt', {}, 'Dung lượng tải về'), h('dd', {}, gib(plan.download)),
        h('dt', {}, 'Ổ đĩa cần / còn trống'), h('dd', {}, gib(disk.needed) + ' / ' + gib(disk.free)),
        plan.format ? [h('dt', {}, 'Định dạng mô hình'), h('dd', {}, plan.format)] : null));
      for (const e of plan.errors) planBody.push(h('div', { class: 'notice err' }, icon('error'), h('div', {}, viEngineError(e))));
      for (const w of plan.warnings) planBody.push(h('div', { class: 'notice warn' }, icon('warning'), h('div', {}, w)));
      if (!plan.errors.length) planBody.push(h('div', { class: 'notice ok' }, icon('check_circle'), 'Máy của bạn chạy được engine. Sẵn sàng cài.'));
      planBody.push(h('details', { class: 'mt' }, h('summary', { class: 'muted', style: { cursor: 'pointer' } }, 'Trình cài sẽ làm gì'),
        h('ol', { class: 'small-text muted' }, plan.steps.map((x) => h('li', {}, x)))),
        h('div', { class: 'row mt' }, h('button', { class: 'btn btn-text', onclick: doPlan }, icon('refresh'), 'Kiểm tra lại')));
    }
    const s2 = step(2, 'Kiểm tra máy', Boolean(plan && !plan.errors.length), planBody);
    const ok = plan && !plan.errors.length;
    const s3 = step(3, 'Cài engine & tải mô hình', false, [
      optionsBlock(),
      h('label', { class: 'switch mt' },
        h('input', { type: 'checkbox', checked: opts.agree, onchange: (e) => { opts.agree = e.target.checked; draw(); } }),
        h('span', { class: 'txt' }, h('b', {}, 'Tôi đồng ý giấy phép mô hình'),
          h('span', {}, 'MiniMax H3 Community License (có giới hạn lãnh thổ & mục đích sử dụng) · ',
            ((plan && plan.licenses) || []).slice(0, 2).map((u, i) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.fv.open(u); } }, i ? ' CUDA EULA' : 'Xem giấy phép'))))),
      st.phase === 'failed' || st.phase === 'cancelled' ? h('div', { class: 'notice info' }, icon('info'), 'Các file đã tải được giữ lại — bấm Cài tiếp để chạy tiếp từ chỗ dừng.') : null,
      h('div', { class: 'row mt' }, h('button', { class: 'btn btn-primary btn-hero', style: { maxWidth: '420px' }, disabled: !(ok && opts.agree), onclick: () => doInstall(false) },
        icon('download'), st.phase === 'failed' || st.phase === 'cancelled' ? 'Cài tiếp' : 'Cài engine & tải mô hình'))]);
    return h('div', {}, s1, s2, s3);
  }

  function progressCard(st) {
    const p = st.progress || {};
    const cur = p.current;
    const body = h('div', { class: 'card-body' });
    body.append(h('div', { class: 'row' }, icon('progress_activity', 'spin'), h('b', {}, p.phase || p.label || (st.phase === 'planning' ? 'Đang kiểm tra máy…' : 'Đang cài…')),
      p.phaseTotal ? h('span', { class: 'muted' }, `bước ${p.phaseDone}/${p.phaseTotal}`) : null));
    body.append(progressBar(p.phaseTotal ? p.phaseDone / p.phaseTotal : overallFraction(p)));
    if (cur) {
      const frac = cur.total ? cur.done / cur.total : null;
      body.append(h('div', { class: 'mt' }, h('div', { class: 'row tight' }, h('span', {}, cur.label), h('span', { class: 'muted small-text' }, cur.detail || ''),
        h('div', { class: 'grow' }), h('span', { class: 'muted small-text' }, cur.unit === 'bytes' || (cur.total > 2 ** 20)
          ? `${fmtBytes(cur.done)} / ${fmtBytes(cur.total)}` : cur.total ? `${cur.done}/${cur.total}` : '')), progressBar(frac)));
    }
    if (p.tasks && p.tasks.length) {
      body.append(h('div', { class: 'mt small-text' }, p.tasks.map((t) => h('div', { class: 'row tight', style: { padding: '3px 0' } },
        icon(t.state === 'done' ? 'check_circle' : 'radio_button_unchecked', t.state === 'done' ? 'fill' : ''), h('span', {}, t.label), h('span', { class: 'muted' }, t.detail || '')))));
    }
    body.append(h('details', { class: 'mt' }, h('summary', { class: 'muted', style: { cursor: 'pointer' } }, 'Nhật ký chi tiết'),
      h('div', { class: 'prompt-box', style: { fontFamily: 'Consolas, monospace', fontSize: '11.5px' } }, (st.log || []).join('\n') || '…')));
    body.append(h('div', { class: 'help' }, 'Có thể dùng máy bình thường trong lúc tải. Đóng Max AI sẽ tạm dừng — mở lại và bấm Cài tiếp để tải tiếp.'),
      h('div', { class: 'row mt' }, h('button', { class: 'btn btn-danger', onclick: async () => { await window.fv.engine.cancel(); refreshEngine(); } }, icon('pause_circle'), 'Tạm dừng')));
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('download'), h('h2', {}, st.phase === 'planning' ? 'Đang kiểm tra máy' : 'Đang cài engine & tải mô hình')), body);
  }

  async function doPlan() {
    const r = window.fv.engine.plan({ imageModel: opts.imageModel, reuseModels: opts.reuseModels });
    setTimeout(refreshEngine, 300);
    const res = await r;
    if (!res.ok) toast('Không kiểm tra được máy', { kind: 'err', sub: viEngineError(res.error.message), timeout: 12000 });
    refreshEngine();
  }

  async function doInstall(repair) {
    if (!repair && !opts.agree) return;
    const r = window.fv.engine.install({ imageModel: opts.imageModel, reuseModels: opts.reuseModels });
    setTimeout(refreshEngine, 300);
    const res = await r;
    if (res.ok) {
      toast('Đã cài xong engine & mô hình!', { kind: 'ok', sub: 'Đang bật engine…' });
      await engineStart();
    } else if (!/tạm dừng|cancel/i.test(res.error.message)) toast('Cài chưa xong', { kind: 'err', sub: res.error.message, timeout: 12000 });
    refreshEngine();
  }

  return { render, leave };
})());
