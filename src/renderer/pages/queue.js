'use strict';
/* Trang Hàng đợi: mọi việc engine đang làm */

registerPage('queue', (() => {
  let unsub = [];
  let filter = 'all';
  let kind = 'all';
  const els = {};
  const selected = new Set();
  let shown = [];
  let lastId = null;   // dòng bấm gần nhất (để Shift + bấm chọn cả đoạn)

  // Việc đã xoá khỏi Hàng đợi (lưu trên máy). Video / ảnh đã tạo vẫn nằm trong Thư viện.
  const HIDE_KEY = 'maxai.queueHidden';
  let hidden = new Set();
  try { hidden = new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch { hidden = new Set(); }
  const saveHidden = () => { try { localStorage.setItem(HIDE_KEY, JSON.stringify([...hidden].slice(-5000))); } catch { /* bỏ qua */ } };
  const RESUMABLE = new Set(['failed', 'interrupted', 'cancelled']);

  const FILTERS = [
    { value: 'all', label: 'Tất cả' }, { value: 'active', label: 'Đang chạy / chờ' },
    { value: 'succeeded', label: 'Hoàn tất' }, { value: 'problem', label: 'Lỗi / huỷ' },
  ];

  function render(root) {
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Hàng đợi'), h('div', { class: 'sub' }, 'GPU chạy lần lượt từng việc, việc nào xong sẽ có thông báo.')),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-outline', onclick: clearFinished, title: 'Xoá khỏi danh sách mọi việc đã hoàn tất, lỗi hoặc đã huỷ' }, icon('delete_sweep'), 'Xoá việc đã xong'),
      h('button', { class: 'btn btn-outline', onclick: () => Poller.soon(0) }, icon('refresh'), 'Làm mới')));
    const kinds = h('select', { class: 'select', style: { width: '160px' }, onchange: (e) => { kind = e.target.value; draw(App.jobs); } },
      h('option', { value: 'all' }, 'Mọi loại'), h('option', { value: 'generate' }, 'Video'), h('option', { value: 'image' }, 'Ảnh'), h('option', { value: 'other' }, 'Khác'));
    els.body = h('tbody');
    els.empty = h('div');
    els.selbar = h('div', { class: 'selbar q-selbar hidden' });
    els.all = h('input', { type: 'checkbox', class: 'q-check', title: 'Chọn tất cả', onclick: (e) => { e.stopPropagation(); if (e.target.checked) shown.forEach((j) => selected.add(j.id)); else selected.clear(); draw(App.jobs); } });
    page.append(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, chipGroup(FILTERS, filter, (v) => { filter = v; selected.clear(); draw(App.jobs); }), h('div', { style: { flex: 1 } }), kinds),
      els.selbar,
      h('div', { class: 'table-wrap q-wrap' }, h('table', { class: 'data q-table' },
        h('colgroup', {}, ['cb', 'thumb', 'status', 'kind', 'content', 'progress', 'created', 'elapsed', 'acts'].map((c) => h('col', { class: 'c-' + c }))),
        h('thead', {}, h('tr', {}, h('th', { class: 'q-cb' }, els.all), ...[['', 'thumb'], ['Trạng thái'], ['Loại', 'kind'], ['Nội dung'], ['Tiến độ'], ['Tạo lúc'], ['Đã chạy'], ['']].map(([t, c]) => h('th', { class: c ? 'col-' + c : '' }, t)))),
        els.body)), els.empty));
    page.append(h('div', { class: 'help', style: { marginTop: '8px' } }, 'Mẹo: bấm chuột phải vào một dòng để Chạy / Dừng / Xoá. Giữ Ctrl hoặc Shift khi bấm ô chọn để chọn nhiều. Xoá khỏi hàng đợi không xoá video, ảnh đã lưu trong Thư viện.'));
    root.append(page);
    draw(App.jobs);
    unsub = [App.on('jobs', draw)];
    Poller.soon(0);
  }
  function leave() { unsub.forEach((u) => u()); closeMenu(); }

  function matches(job) {
    if (hidden.has(job.id)) return false;
    if (filter === 'active' && !ACTIVE.has(job.status)) return false;
    if (filter === 'succeeded' && job.status !== 'succeeded') return false;
    if (filter === 'problem' && !['failed', 'cancelled', 'interrupted'].includes(job.status)) return false;
    if (kind === 'other') return !['generate', 'image'].includes(job.kind);
    return kind === 'all' || job.kind === kind;
  }

  function elapsed(job) {
    if (!job.started_at) return '—';
    const end = job.finished_at ? new Date(job.finished_at) : new Date();
    return fmtDuration((end - new Date(job.started_at)) / 1000);
  }

  function draw(jobs) {
    const rows = (jobs || []).filter(matches);
    shown = rows;
    for (const id of [...selected]) if (!rows.some((j) => j.id === id)) selected.delete(id);
    els.body.innerHTML = '';
    els.empty.innerHTML = '';
    drawSelbar();
    if (!rows.length) {
      els.empty.append(h('div', { class: 'empty' }, icon('inbox'), h('h3', {}, App.connected ? 'Không có job nào' : 'Engine chưa chạy'),
        h('div', {}, App.connected ? 'Tạo video hoặc ảnh để bắt đầu.' : errorText(App.connectionError))));
      return;
    }
    const lastClicked = rows.findIndex((j) => j.id === lastId);
    rows.forEach((job, index) => {
      const p = progressInfo(job);
      const video = jobVideo(job);
      const images = jobImages(job);
      let thumb = h('div', { class: 'thumb' });
      if (job.status === 'succeeded' && video && job.result.library_id) thumb = h('img', { class: 'thumb', src: mediaUrl('/freevideo/agent/v1/library/' + job.result.library_id + '/thumbnail'), alt: '' });
      else if (images[0]) thumb = h('img', { class: 'thumb', src: mediaUrl(images[0].url), alt: '' });
      const actions = h('div', { class: 'row tight', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } });
      const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
      if (ACTIVE.has(job.status)) actions.append(h('button', { class: 'icon-btn', title: 'Dừng tác vụ', onclick: stop(() => cancelJob(job.id)) }, icon('stop_circle')));
      if (RESUMABLE.has(job.status)) actions.append(h('button', { class: 'icon-btn', title: 'Chạy lại', onclick: stop(() => resumeJob(job.id)) }, icon('restart_alt')));
      if (video && video.url) actions.append(h('button', { class: 'icon-btn', title: 'Tải về', onclick: stop(() => saveMedia(video.url, 'video-' + job.id + '.mp4')) }, icon('download')));
      if (images[0]) actions.append(h('button', { class: 'icon-btn', title: 'Tải về', onclick: stop(() => saveMedia(images[0].url, 'image-' + job.id + '.png')) }, icon('download')));
      actions.append(h('button', { class: 'icon-btn q-del', title: 'Xoá khỏi hàng đợi', onclick: stop(() => removeJobs([job.id])) }, icon('delete')));
      const check = h('input', { type: 'checkbox', class: 'q-check', checked: selected.has(job.id),
        onclick: (e) => {
          e.stopPropagation();
          if (e.shiftKey && lastClicked >= 0) {
            const [a, b] = [Math.min(lastClicked, index), Math.max(lastClicked, index)];
            for (let i = a; i <= b; i++) selected.add(rows[i].id);
          } else if (e.target.checked) selected.add(job.id); else selected.delete(job.id);
          lastId = job.id;
          draw(App.jobs);
        } });
      const tr = h('tr', { class: selected.has(job.id) ? 'q-sel' : '', style: { cursor: 'pointer' },
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey) { if (selected.has(job.id)) selected.delete(job.id); else selected.add(job.id); lastId = job.id; draw(App.jobs); return; }
          if (e.shiftKey && lastClicked >= 0) { const [a, b] = [Math.min(lastClicked, index), Math.max(lastClicked, index)]; for (let i = a; i <= b; i++) selected.add(rows[i].id); draw(App.jobs); return; }
          showJob(job.id);
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          if (!selected.has(job.id)) { selected.clear(); selected.add(job.id); draw(App.jobs); }
          openMenu(e.clientX, e.clientY, job);
        } },
        h('td', { class: 'q-cb' }, check),
        h('td', { class: 'col-thumb' }, thumb),
        h('td', {}, statusBadge(job.status)),
        h('td', { class: 'col-kind' }, KINDS[job.kind] || job.kind),
        h('td', { class: 'prompt-cell', title: jobTitle(job) }, jobTitle(job), job.client && job.client !== 'Max AI' ? h('div', { class: 'small-text muted' }, 'từ ' + job.client) : null),
        h('td', {}, ACTIVE.has(job.status) ? h('div', { class: 'mini-progress' }, h('div', { class: 'lbl', title: p.label }, p.label), progressBar(p.fraction))
          : job.error ? h('span', { class: 'small-text', style: { color: 'var(--red)' } }, errorText(job.error)) : '—'),
        h('td', { style: { whiteSpace: 'nowrap' }, title: fmtTime(job.created_at) }, shortTime(job.created_at)),
        h('td', { style: { whiteSpace: 'nowrap' } }, elapsed(job)),
        h('td', {}, actions));
      els.body.append(tr);
    });
    els.all.checked = rows.length > 0 && rows.every((j) => selected.has(j.id));
    els.all.indeterminate = selected.size > 0 && !els.all.checked;
  }

  // Hôm nay → 21:47; ngày khác → 24/11 21:47
  function shortTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }

  const pick = (ids) => (App.jobs || []).filter((j) => ids.includes(j.id));

  function drawSelbar() {
    const bar = els.selbar;
    bar.innerHTML = '';
    bar.classList.toggle('hidden', !selected.size);
    if (!selected.size) return;
    const jobs = pick([...selected]);
    const nActive = jobs.filter((j) => ACTIVE.has(j.status)).length;
    const nResume = jobs.filter((j) => RESUMABLE.has(j.status)).length;
    bar.append(icon('check_box'), h('b', {}, 'Đã chọn ' + selected.size),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-outline', disabled: !nResume, onclick: () => runJobs([...selected]) }, icon('play_arrow'), 'Chạy tác vụ' + (nResume ? ' (' + nResume + ')' : '')),
      h('button', { class: 'btn btn-outline', disabled: !nActive, onclick: () => stopJobs([...selected]) }, icon('stop_circle'), 'Dừng tác vụ' + (nActive ? ' (' + nActive + ')' : '')),
      h('button', { class: 'btn btn-danger-soft', onclick: () => removeJobs([...selected]) }, icon('delete'), 'Xoá'),
      h('button', { class: 'btn btn-text', onclick: () => { selected.clear(); draw(App.jobs); } }, 'Bỏ chọn'));
  }

  /* ---------- Thao tác ---------- */
  async function runJobs(ids) {
    const jobs = pick(ids).filter((j) => RESUMABLE.has(j.status));
    if (!jobs.length) { toast('Chỉ chạy lại được việc bị lỗi, gián đoạn hoặc đã dừng', { kind: 'err' }); return; }
    let ok = 0; let lastErr = null;
    for (const j of jobs) { try { await api('POST', '/jobs/' + j.id + '/resume', {}); ok++; } catch (e) { lastErr = e; } }
    if (ok) toast('Đã cho chạy lại ' + ok + ' tác vụ', { kind: 'ok' });
    if (lastErr) toastError(lastErr, (jobs.length - ok) + ' tác vụ không chạy lại được');
    Poller.soon(0);
  }
  async function stopJobs(ids) {
    const jobs = pick(ids).filter((j) => ACTIVE.has(j.status) && j.status !== 'cancelling');
    if (!jobs.length) { toast('Không có tác vụ nào đang chạy hoặc đang chờ', { kind: 'err' }); return; }
    let ok = 0; let lastErr = null;
    for (const j of jobs) { try { await api('POST', '/jobs/' + j.id + '/cancel', {}); ok++; } catch (e) { lastErr = e; } }
    if (ok) toast('Đã dừng ' + ok + ' tác vụ', { kind: 'ok' });
    if (lastErr) toastError(lastErr, 'Có tác vụ không dừng được');
    Poller.soon(0);
  }
  async function removeJobs(ids) {
    const jobs = pick(ids);
    if (!jobs.length) return;
    const running = jobs.filter((j) => ACTIVE.has(j.status));
    const msg = jobs.length === 1 ? 'Xoá tác vụ này khỏi hàng đợi?' : 'Xoá ' + jobs.length + ' tác vụ khỏi hàng đợi?';
    if (!(await confirmBox(msg, running.length ? running.length + ' tác vụ đang chạy / chờ sẽ bị dừng trước khi xoá. ' : '') )) return;
    for (const j of running) { try { await api('POST', '/jobs/' + j.id + '/cancel', {}); } catch { /* vẫn xoá khỏi danh sách */ } }
    for (const j of jobs) { hidden.add(j.id); selected.delete(j.id); }
    saveHidden();
    toast('Đã xoá ' + jobs.length + ' tác vụ khỏi hàng đợi', { kind: 'ok', sub: 'Video, ảnh đã tạo vẫn nằm trong Thư viện.' });
    draw(App.jobs); Poller.soon(0);
  }
  function clearFinished() {
    const done = (App.jobs || []).filter((j) => !hidden.has(j.id) && !ACTIVE.has(j.status));
    if (!done.length) { toast('Không có việc nào đã xong để xoá'); return; }
    removeJobs(done.map((j) => j.id));
  }
  function confirmBox(title, extra) {
    return new Promise((resolve) => {
      const done = (v) => { closeModal(); resolve(v); };
      openModal([modalHead(title, 'delete'),
        h('div', { class: 'help', style: { margin: 0 } }, (extra || '') + 'Video, ảnh đã tạo vẫn nằm trong Thư viện.'),
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Huỷ'),
          h('button', { class: 'btn btn-danger', onclick: () => done(true) }, icon('delete'), 'Xoá'))]);
    });
  }

  /* ---------- Menu chuột phải ---------- */
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } document.removeEventListener('mousedown', outside, true); }
  function outside(e) { if (menu && !menu.contains(e.target)) closeMenu(); }
  function openMenu(x, y, job) {
    closeMenu();
    const ids = [...selected];
    const many = ids.length > 1;
    const jobs = pick(ids);
    const nActive = jobs.filter((j) => ACTIVE.has(j.status) && j.status !== 'cancelling').length;
    const nResume = jobs.filter((j) => RESUMABLE.has(j.status)).length;
    const video = jobVideo(job); const images = jobImages(job);
    const item = (ic, label, fn, { disabled = false, danger = false } = {}) => h('button', { class: 'ctx-item' + (danger ? ' danger' : ''), disabled,
      onclick: () => { closeMenu(); fn(); } }, icon(ic, 'small'), h('span', {}, label));
    const sep = () => h('div', { class: 'ctx-sep' });
    const list = [];
    if (!many) list.push(item('open_in_new', 'Xem chi tiết', () => showJob(job.id)), sep());
    list.push(item('play_arrow', many ? 'Chạy tác vụ (' + nResume + ')' : 'Chạy tác vụ', () => runJobs(ids), { disabled: !nResume }));
    list.push(item('stop_circle', many ? 'Dừng tác vụ (' + nActive + ')' : 'Dừng tác vụ', () => stopJobs(ids), { disabled: !nActive }));
    if (!many) {
      const prompt = job.spec && typeof job.spec.prompt === 'string';
      if (job.kind === 'generate' && prompt) list.push(item('replay', 'Dùng lại prompt', async () => { const d = await jobDetail(job.id, true); App.handoff = { page: 'video', spec: d.spec }; navigate('video'); }));
      if (video && video.url) list.push(item('download', 'Tải video về', () => saveMedia(video.url, 'video-' + job.id + '.mp4')));
      if (images[0]) list.push(item('download', 'Tải ảnh về', () => saveMedia(images[0].url, 'image-' + job.id + '.png')));
      if (job.status === 'succeeded' && (video || images[0])) list.push(item('video_library', 'Mở Thư viện', () => navigate('library')));
    }
    list.push(sep(), item('select_all', 'Chọn tất cả', () => { shown.forEach((j) => selected.add(j.id)); draw(App.jobs); }));
    list.push(sep(), item('delete', many ? 'Xoá ' + ids.length + ' tác vụ' : 'Xoá', () => removeJobs(ids), { danger: true }));
    menu = h('div', { class: 'ctx-menu' }, list);
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }

  async function showJob(id) {
    let job;
    try { job = await jobDetail(id, true); } catch (e) { toastError(e); return; }
    const spec = job.spec || {};
    const video = jobVideo(job);
    const images = jobImages(job);
    const body = h('div');
    if (video && video.url) body.append(h('video', { src: mediaUrl(video.url), controls: true, autoplay: true }));
    for (const img of images) body.append(h('img', { class: 'big', src: mediaUrl(img.url), alt: '' }));
    if (job.error) body.append(h('div', { class: 'notice err' }, icon('error'), h('div', {}, errorText(job.error), job.error.next ? h('div', { class: 'small-text' }, job.error.next) : null)));
    const r = job.result || {};
    body.append(h('dl', { class: 'kv mt' },
      h('dt', {}, 'Trạng thái'), h('dd', {}, statusBadge(job.status)),
      h('dt', {}, 'Mã job'), h('dd', {}, job.id),
      h('dt', {}, 'Tạo lúc'), h('dd', {}, fmtTime(job.created_at)),
      h('dt', {}, 'Thời gian chạy'), h('dd', {}, elapsed(job)),
      r.width ? [h('dt', {}, 'Kích thước'), h('dd', {}, r.width + ' × ' + r.height + (r.seconds ? ' · ' + Number(r.seconds).toFixed(1) + ' giây' : ''))] : null,
      spec.quality ? [h('dt', {}, 'Chất lượng'), h('dd', {}, (QUALITY_TEXT[spec.quality] || [spec.quality])[0])] : null,
      (r.seed ?? spec.seed) !== undefined && (r.seed ?? spec.seed) !== null ? [h('dt', {}, 'Seed'), h('dd', {}, String(r.seed ?? spec.seed))] : null,
      job.client ? [h('dt', {}, 'Gửi từ'), h('dd', {}, job.client)] : null));
    if (typeof spec.prompt === 'string') body.append(h('div', { class: 'label mt' }, 'Prompt'), h('div', { class: 'prompt-box' }, spec.prompt));
    const actions = [];
    if (job.kind === 'generate' && typeof spec.prompt === 'string') {
      actions.push(h('button', { class: 'btn btn-outline', onclick: () => { closeDrawer(); App.handoff = { page: 'video', spec }; navigate('video'); } }, icon('replay'), 'Dùng lại'));
    }
    if (video && video.url) actions.push(h('button', { class: 'btn btn-primary', onclick: () => saveMedia(video.url, 'video-' + job.id + '.mp4') }, icon('download'), 'Tải về'));
    if (images[0]) actions.push(h('button', { class: 'btn btn-primary', onclick: () => saveMedia(images[0].url, 'image-' + job.id + '.png') }, icon('download'), 'Tải về'));
    openDrawer(KINDS[job.kind] || job.kind, body, actions);
  }

  return { render, leave, showJob };
})());
