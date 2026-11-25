'use strict';
/* Trang Engine & mô hình: cài Max AI Engine, tải mô hình về máy, bật/tắt engine, quản lý từng gói mô hình. */

const ENGINE_PHASE = {
  idle: ['Chưa cài', 'bad'], planning: ['Đang kiểm tra máy', 'warn'], planned: ['Chưa cài', 'bad'], installing: ['Đang cài & tải mô hình', 'warn'],
  installed: ['Đã cài · đang tắt', 'warn'], starting: ['Đang khởi động', 'warn'], running: ['Đang chạy', 'ok'], stopping: ['Đang tắt', 'warn'],
  stopped: ['Đã cài · đang tắt', 'warn'], failed: ['Có lỗi', 'bad'], cancelled: ['Đã tạm dừng cài', 'warn'],
};
const gib = (b) => (b ? (b / 2 ** 30).toFixed(b >= 10 * 2 ** 30 ? 0 : 1) + ' GB' : '—');
const Eng = { st: null };

// Dịch các lỗi hay gặp của trình cài engine sang tiếng Việt (giữ nguyên câu gốc nếu không nhận ra).
function viEngineError(t) {
  if (!t) return t;
  t = String(t);
  const paused = t.match(/Model download paused: (\S+) \(/);
  if (paused) return `Tải mô hình ${paused[1]} bị gián đoạn (mạng chập chờn hoặc app bị tắt giữa chừng). Bấm "Cài tiếp" để tải tiếp — phần đã tải được giữ lại.`;
  // Bỏ phần "Full step output" (rất dài, toàn JSON); log đầy đủ vẫn nằm ở đường dẫn "Retained step log".
  t = t.replace(/\n?\s*Full step output:[\s\S]*$/, '').replace(/Retained step log: /, 'Log chi tiết: ').replace(/RuntimeError: Failed step: (\S+) \(exit code (\d+)\)/, 'Bước "$1" bị lỗi (mã $2).');
  return t
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
      h('div', { class: 'sub' }, 'Max Video AI tự cài engine và tải mô hình AI về chạy ngay trên máy của bạn — miễn phí, không giới hạn, không gửi dữ liệu đi đâu.'))));
    els.status = h('div');
    els.wizard = h('div');
    els.packs = h('div');
    els.mode = h('div');
    page.append(els.mode, els.status, els.wizard, els.packs,
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('info'), h('h2', {}, 'Cấu hình cần có')),
        h('div', { class: 'card-body' }, h('div', { class: 'feature-list' },
          ['Windows 10/11 64-bit hoặc Linux, card NVIDIA RTX 30 trở lên', 'Tối thiểu 8 GB VRAM, 16 GB RAM (khuyên 12 GB+ / 32 GB)',
            'Driver NVIDIA 580 trở lên', 'Khoảng 70 GB ổ đĩa trống (thêm ~16 GB nếu tải mô hình ảnh)',
            'macOS: chip Apple M, 24 GB bộ nhớ (bản thử nghiệm)', 'Chế độ nhẹ: card NVIDIA 6 GB (GTX 16xx, RTX 20xx…), 16 GB RAM, ~25 GB ổ đĩa', 'Mạng ổn định lúc tải (~50 GB, tải tiếp được nếu đứt)'].map((t) => h('div', {}, icon('check_circle', 'fill'), t))),
          h('div', { class: 'help mt' }, 'Bộ cài Max Video AI chỉ chứa ứng dụng và engine. Mô hình AI được tải về máy của bạn khi bấm Cài / Tải, rồi chạy hoàn toàn trên máy.'))));
    root.append(page);
    drawMode();
    draw();
    refreshEngine();
    loadPacks();
    unsub = [App.on('engine', (st) => { draw(); drawPacks(); if (st && st.phase !== lastPhase) { lastPhase = st.phase; loadPacks(); } })];
    packTimer = setInterval(() => { if (packs && packs.some((p) => p.busy)) loadPacks(); }, 3000);
  }
  function leave() { unsub.forEach((u) => u()); clearInterval(packTimer); }

  /* ---------- Máy của bạn & chế độ chạy ---------- */
  async function drawMode() {
    const hw = await loadHardware(true);
    if (!els.mode) return;
    els.mode.innerHTML = '';
    const mode = hw.mode || 'full';
    const opt = (id, ic, title, desc, ok) => h('div', { class: 'mode-opt' + (mode === id ? ' on' : '') },
      h('b', {}, icon(ic, 'fill'), title, mode === id ? h('span', { class: 'pill ok', style: { marginLeft: 'auto' } }, 'Đang dùng') : null),
      h('small', {}, desc),
      mode === id ? null : h('button', { class: 'btn ' + (ok ? 'btn-primary' : 'btn-outline'), style: { alignSelf: 'flex-start' }, onclick: () => switchMode(id, ok) },
        icon('swap_horiz'), 'Chuyển sang ' + title.toLowerCase()));
    els.mode.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('computer'), h('h2', {}, 'Máy của bạn'), h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-text', onclick: () => drawMode() }, icon('refresh'), 'Kiểm tra lại')),
      h('div', { class: 'card-body' }, hardwareBox(),
        h('div', { class: 'mode-pick' },
          opt('full', 'workspace_premium', 'Bản đầy đủ', 'MiniMax H3: video tới 15 giây có âm thanh, Tạo ảnh, Sửa ảnh, Lồng tiếng, Phụ đề, Autopilot. Cần RTX 30 trở lên (8 GB VRAM) hoặc Mac chip Apple. Tải ~50 GB.', hw.tier === 'full'),
          opt('lite', 'speed', 'Chế độ nhẹ', 'Wan 2.2 5B (ComfyUI): video tới 5 giây, chưa có âm thanh, chỉ Tạo video. Cho card NVIDIA 6 GB trở lên (GTX 16xx, RTX 20xx…). Tải ~18 GB.', hw.tier === 'lite')))));
  }
  async function switchMode(id, ok) {
    const name = id === 'lite' ? 'chế độ nhẹ' : 'bản đầy đủ';
    if (!ok && !window.confirm('Máy của bạn không được khuyên dùng ' + name + '. Vẫn chuyển?')) return;
    const r = await window.fv.engine.mode(id);
    if (!r.ok) { toast(r.error.message, { kind: 'err' }); return; }
    toast('Đã chuyển sang ' + name, { kind: 'ok', sub: r.data.installed ? 'Đang bật engine…' : 'Đang cài — mô hình tải ngầm, có thể tiếp tục dùng app.' });
    App.caps = null;
    await window.fv.engine.auto();
    refreshEngine(); drawMode();
  }

  /* ---------- Danh sách mô hình (đầy đủ như engine): tải riêng từng gói ---------- */
  let packs = null, packTimer = null, lastPhase = null, packErr = null;
  async function loadPacks() {
    const r = await window.fv.engine.packs();
    if (r.ok) { packs = r.data; packErr = null; } else packErr = r.error.message;
    drawPacks();
  }
  // Các phần của mô hình tạo video mà trình cài tải (theo nhóm do engine báo về)
  const GROUP_NAMES = {
    video: ['Mô hình video', 'VDN-H3 (MiniMax H3)'],
    text: ['Mô hình hiểu prompt', 'Qwen3-VL 32B (MiniMax H3)'],
    decoder: ['Bộ giải mã hình & tiếng', 'H3 decoder'],
    sampling: ['Bộ đệm chất lượng', 'sampling caches'],
    image: ['Mô hình tạo ảnh', 'MiniMax H3 Image'],
  };
  const pct = (a, b) => (b ? Math.min(100, Math.floor((a / b) * 100)) : 0);
  const speed = (bps) => (bps ? ' · ' + fmtBytes(bps) + '/s' : '');
  const pill = (tone, ic, text) => h('span', { class: 'pill' + (tone ? ' ' + tone : '') }, ic ? icon(ic, 'small') : null, text);
  const bar = (label, frac) => h('div', { class: 'mini-progress' }, h('div', { class: 'lbl' }, label), progressBar(frac));

  // Trạng thái 1 nhóm: đã xong / đang tải / đang kiểm tra / chờ tải
  function groupState(g, active) {
    if (g.state === 'ready' || (g.total && g.ready >= g.total)) return ['done', pill('ok', 'check_circle', 'Đã xong')];
    if (g.state === 'downloading') return ['busy', bar(`Đang tải · ${fmtBytes(g.got || 0)} / ${fmtBytes(g.need || 0)}${speed(g.speed)}`, g.need ? (g.got || 0) / g.need : null)];
    if (g.state === 'verifying') return ['busy', bar(`Đang kiểm tra · ${g.readyFiles || 0}/${g.files || 0} file`, g.files ? (g.readyFiles || 0) / g.files : null)];
    if (!active) return ['wait', pill('warn', 'pause_circle', `Tải dở · ${pct(g.ready, g.total)}%`)];
    return ['wait', pill('', 'schedule', 'Chờ tải' + (g.need ? ' · ' + gib(g.need) : ''))];
  }

  function drawPacks() {
    if (!els.packs) return;
    els.packs.innerHTML = '';
    const st = Eng.st || {};
    if (st.mode === 'lite') {
      const g = (st.groups || [])[0];
      const state = st.installed ? pill('ok', 'check_circle', 'Đã tải')
        : st.phase === 'installing' && g ? bar(`Đang tải · ${fmtBytes(g.ready)} / ${fmtBytes(g.total)} (${pct(g.ready, g.total)}%)${speed(g.speed)}`, g.total ? g.ready / g.total : null)
          : pill('', 'schedule', 'Chưa tải');
      const rows = [['Mô hình video', 'Wan 2.2 TI2V 5B · 10 GB', 'Tạo video từ prompt / ảnh mở đầu'], ['Bộ đọc prompt', 'UMT5-XXL fp8 · 6,7 GB', 'Hiểu prompt'],
        ['Bộ giải mã video', 'Wan 2.2 VAE · 1,4 GB', 'Giải mã khung hình'], ['ComfyUI + PyTorch', '~3,5 GB', 'Chạy mô hình trên card NVIDIA']]
        .map(([n, m, u]) => h('tr', {}, h('td', {}, h('b', {}, n), h('div', { class: 'small-text muted' }, m)), h('td', { class: 'small-text muted' }, u), h('td', {}, state), h('td')));
      els.packs.append(h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('deployed_code'), h('h2', {}, 'Mô hình chế độ nhẹ')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data packs-table' }, h('thead', {}, h('tr', {}, ['Mô hình', 'Dùng cho', 'Trạng thái', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))),
        h('div', { class: 'card-body help', style: { marginTop: 0 } }, 'Wan 2.2 của Alibaba (giấy phép Apache-2.0, dùng thương mại được), chạy bằng ComfyUI ngay trên máy bạn.')));
      return;
    }
    const running = st.phase === 'running';
    const installing = st.phase === 'installing';
    const groups = st.groups || [];
    const count = { done: 0, busy: 0, wait: 0, none: 0 };
    const rows = [];
    for (const p of (packs || [])) {
      let state, action = null, kind = 'none', subRows = [];
      if (p.core && !p.ready && groups.length) {
        // Mô hình tạo video đang (hoặc đã từng) tải trong lúc cài: chia nhỏ từng phần
        const total = groups.reduce((n, g) => n + (g.total || 0), 0), ready = groups.reduce((n, g) => n + (g.ready || 0), 0);
        const states = groups.map((g) => groupState(g, installing));
        kind = installing ? 'busy' : 'wait';
        state = installing ? bar(`Đang tải · đã có ${fmtBytes(ready)} / ${fmtBytes(total)} (${pct(ready, total)}%)`, total ? ready / total : null)
          : pill('warn', 'pause_circle', `Tải dở · ${pct(ready, total)}%`);
        action = installing ? null : h('button', { class: 'btn btn-text', onclick: () => document.querySelector('#content').scrollTo(0, 0) }, icon('arrow_upward'), 'Cài tiếp ở trên');
        subRows = groups.map((g, i) => {
          const [nm, md] = GROUP_NAMES[g.id] || [g.id, ''];
          const cur = st.downloading && g.state === 'downloading' ? st.downloading.file : '';
          return h('tr', { class: 'sub-row' }, h('td', {}, h('span', { class: 'tree' }, '└'), nm, h('div', { class: 'small-text muted' }, md)),
            h('td', { class: 'small-text muted' }, cur || (g.total ? fmtBytes(g.total) : '')), h('td', {}, states[i][1]), h('td'));
        });
      } else if (p.ready) { kind = 'done'; state = pill('ok', 'check_circle', 'Đã tải'); }
      else if (p.busy) {
        kind = 'busy';
        const pr = p.progress;
        state = bar('Đang tải' + (pr && pr.total ? ` · ${fmtBytes(pr.done)} / ${fmtBytes(pr.total)} (${pct(pr.done, pr.total)}%)` : '…'), pr && pr.total ? pr.done / pr.total : null);
        action = p.core ? null : h('button', { class: 'btn btn-text btn-danger', onclick: () => packDo(p, 'cancel') }, icon('pause_circle'), 'Dừng');
      } else if (p.core) {
        if (installing) { kind = 'busy'; state = bar('Đang chuẩn bị tải…', null); }
        else {
          state = pill('bad', null, st.phase === 'failed' || st.phase === 'cancelled' ? 'Chưa tải xong' : 'Chưa tải');
          action = h('button', { class: 'btn btn-text', onclick: () => document.querySelector('#content').scrollTo(0, 0) }, icon('arrow_upward'), 'Cài ở trên');
        }
      } else if (installing || !st.installed) { kind = 'wait'; state = pill('', 'schedule', 'Chờ — tải sau khi cài xong engine'); }
      else if (!running) {
        kind = 'wait'; state = pill('', 'schedule', 'Chưa tải · cần bật engine');
        action = st.phase === 'starting' ? null : h('button', { class: 'btn btn-text', onclick: engineStart }, icon('play_circle'), 'Bật engine');
      } else if (!p.available) state = pill('', null, p.error || 'Chưa hỗ trợ trên máy này');
      else {
        state = pill('', 'download', p.bytes ? 'Chưa tải · ' + gib(p.bytes) : 'Chưa tải');
        action = h('button', { class: 'btn btn-primary', onclick: () => packDo(p, 'install') }, icon('download'), 'Tải');
      }
      count[kind]++;
      const tag = p.id === 'image-qwen' ? h('span', { class: 'pill warn', style: { marginLeft: '6px', fontSize: '11px' }, title: 'Qwen Research License: chỉ dùng phi thương mại' }, 'Phi thương mại') : null;
      rows.push(h('tr', { class: kind === 'busy' ? 'row-busy' : '' }, h('td', {}, h('b', {}, p.name), tag, h('div', { class: 'small-text muted' }, p.model)),
        h('td', { class: 'small-text muted' }, p.use), h('td', {}, state, p.error && !p.ready && p.available && running ? h('div', { class: 'small-text', style: { color: 'var(--err)' } }, viEngineError(p.error)) : null),
        h('td', { style: { textAlign: 'right' } }, action)), ...subRows);
    }
    const summary = h('div', { class: 'row', style: { gap: '6px' } },
      pill('ok', 'check_circle', `${count.done} đã tải`), count.busy ? pill('info', 'downloading', `${count.busy} đang tải`) : null,
      pill('', 'schedule', `${count.wait + count.none} chưa tải`));
    const body = h('div', { class: 'table-wrap' }, h('table', { class: 'data packs-table' },
      h('thead', {}, h('tr', {}, ['Mô hình', 'Dùng cho', 'Trạng thái', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows)));
    els.packs.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('deployed_code'), h('h2', {}, 'Mô hình AI trên máy'), packs ? summary : null,
        h('div', { class: 'grow' }), h('button', { class: 'btn btn-text', onclick: loadPacks }, icon('refresh'), 'Làm mới')),
      packErr ? h('div', { class: 'card-body' }, h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('error'), packErr)) : null,
      packs ? body : h('div', { class: 'card-body muted' }, 'Đang đọc…'),
      h('div', { class: 'card-body help', style: { marginTop: 0 } }, 'Mô hình tạo video tải khi cài engine (từng phần hiện ngay bên dưới khi đang tải). Các mô hình khác tải sau, khi engine đang chạy, bấm Tải gói nào thì tải gói đó. Mô hình theo giấy phép của từng nhà phát hành — xem ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openTerms(); } }, 'Giấy phép & điều khoản'), '.')));
  }
  async function packDo(p, action) {
    const r = await window.fv.engine.pack(p.id, action);
    if (!r.ok) toast(r.error.message, { kind: 'err' });
    else if (action === 'install') toast('Bắt đầu tải ' + p.name, { kind: 'ok', sub: 'Có thể tiếp tục dùng Max Video AI trong lúc tải.' });
    setTimeout(loadPacks, 800);
  }

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
          h('dt', {}, 'Phiên bản engine'), h('dd', {}, 'Max AI Engine ' + (st.source ? st.source.tag : st.engineTag)),
          st.installed ? [h('dt', {}, 'Card đồ họa'), h('dd', {}, (m.gpu || '—') + (m.backend === 'mps' ? ' (Apple)' : ''))] : null,
          st.installed && m.format ? [h('dt', {}, 'Định dạng mô hình'), h('dd', {}, m.format)] : null,
          st.url ? [h('dt', {}, 'Địa chỉ engine'), h('dd', {}, h('code', {}, st.url))] : null),
        st.error && st.phase === 'failed' ? h('div', { class: 'notice err' }, icon('error'), h('div', { style: { whiteSpace: 'pre-wrap' } }, viEngineError(st.error))) : null,
        h('div', { class: 'row mt' },
          st.phase === 'running' ? h('button', { class: 'btn', onclick: engineStop }, icon('stop_circle'), 'Tắt engine') : null,
          st.installed && !['running', 'starting', 'installing', 'stopping'].includes(st.phase) ? h('button', { class: 'btn btn-primary', onclick: engineStart }, icon('play_arrow'), 'Bật engine') : null,
          st.installed ? switchToggle('Tự bật khi mở Max Video AI', 'Engine tự tắt khi bạn đóng Max Video AI.', st.autostart, async (v) => { Eng.st = await window.fv.engine.autostart(v); }) : null),
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
      planBody.push(h('div', { class: 'help', style: { marginTop: 0 } }, 'Max Video AI tải trình cài của engine (vài MB) rồi kiểm tra card đồ họa, bộ nhớ, ổ đĩa và mạng. Chưa cài gì cả.'),
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
    body.append(h('div', { class: 'help' }, 'Có thể dùng máy bình thường trong lúc tải. Đóng Max Video AI sẽ tạm dừng — mở lại và bấm Cài tiếp để tải tiếp.'),
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
