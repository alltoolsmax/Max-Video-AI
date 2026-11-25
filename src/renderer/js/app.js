'use strict';
/* Khởi động giao diện Max AI */

(async function start() {
  App.config = await window.fv.config.get();
  applyTheme(pref('theme', 'dark'));
  if (pref('navCollapsed', false)) document.body.classList.add('nav-collapsed');

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-route]');
    if (target) { e.preventDefault(); navigate(target.dataset.route); }
  });
  $('#nav-toggle').addEventListener('click', () => setPref('navCollapsed', document.body.classList.toggle('nav-collapsed')));
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    setPref('theme', dark ? 'dark' : 'light');
    applyTheme(dark ? 'dark' : 'light');
  });
  $('#queue-btn').addEventListener('click', () => navigate('queue'));
  $('#conn-chip').addEventListener('click', () => navigate('engine'));
  $('#drawer-scrim').addEventListener('click', closeDrawer);
  $('#aboutBtn').addEventListener('click', openAbout);
  $('#authorBtn').addEventListener('click', openAbout);
  $('#guideBtn').addEventListener('click', openGuide);
  $('#exploreBtn').addEventListener('click', () => window.fv.open(APP_INFO.explore));
  $('#updatePill').addEventListener('click', () => checkUpdate());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); if ($('#modal .modal .x')) closeModal(); }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Trạng thái engine
  App.on('connection', ({ ok, error }) => {
    const dot = $('#conn-chip .dot');
    const text = $('#conn-chip .conn-text');
    dot.className = 'dot ' + (ok ? (App.caps && App.caps.ready === false ? 'warn' : 'ok') : 'bad');
    if (!ok) {
      const st = Eng.st;
      text.textContent = st && st.phase === 'starting' ? 'Engine đang khởi động…' : st && st.phase === 'installing' ? 'Đang cài engine…'
        : st && st.installed ? 'Engine đang tắt' : 'Chưa cài engine';
      return;
    }
    const c = App.caps;
    text.textContent = c ? 'Engine sẵn sàng' + (c.device && c.device.vram_limit_gib ? ' · ' + c.device.vram_limit_gib + ' GB VRAM' : '') : 'Engine sẵn sàng';
  });
  App.on('caps', () => App.emit('connection', { ok: App.connected }));

  App.on('jobs', (jobs) => {
    const n = jobs.filter((j) => ACTIVE.has(j.status)).length;
    $('#queue-badge').textContent = n;
    $('#queue-badge').classList.toggle('hidden', !n);
    $('#nav-queue-count').textContent = n;
    $('#nav-queue-count').classList.toggle('hidden', !n);
  });

  App.on('job-done', (job) => {
    const name = KINDS[job.kind] || 'Job';
    if (job.status === 'succeeded') {
      toast(name + ' đã xong', { kind: 'ok', sub: jobTitle(job), action: { label: 'Xem', run: () => { navigate('queue'); App.pages.queue.showJob(job.id); } } });
      if (document.hidden && 'Notification' in window) { try { new Notification('Max AI', { body: name + ' đã xong: ' + jobTitle(job) }); } catch { /* bỏ qua */ } }
    } else if (job.status === 'failed') {
      toast(name + ' bị lỗi', { kind: 'err', sub: errorText(job.error) });
    }
  });

  // Engine AI trong máy + cập nhật (máy chủ active.mrhuynh.net/maxai)
  App.on('engine', renderEngineCard);
  window.fv.on('engine:status', (st) => {
    const was = Eng.st && Eng.st.phase;
    Eng.st = st; App.emit('engine', st);
    if (st.phase === 'running' && was !== 'running') window.fv.config.get().then((c) => { App.config = c; Poller.soon(200); });
  });
  window.fv.on('update:available', (r) => { $('#updatePill').classList.remove('hidden'); if (r.mandatory) checkUpdate({ info: r }); });

  startTicker();
  await refreshEngine();
  // Lần đầu (chưa cài engine) → mở trang cài engine.
  navigate(App.config.hasToken || (Eng.st && Eng.st.installed) ? 'video' : 'engine');
  Poller.start();
  loadGuides();
  setInterval(() => { if (Eng.st && ['installing', 'planning', 'starting'].includes(Eng.st.phase)) refreshEngine(); }, 1500);
  // Kiểm tra bản mới khi mở (mỗi 6 giờ main process tự kiểm tra lại và báo về)
  setTimeout(async () => {
    const r = await window.fv.update.check();
    if (r && r.ok && r.data.available) { $('#updatePill').classList.remove('hidden'); if (r.data.mandatory) checkUpdate({ info: r.data }); }
  }, 2500);
})();
