'use strict';
/* Khởi động giao diện Max Video AI */

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
    const auto = Eng.st && Eng.st.auto;
    if (auto && auto.stage === 'packs' && auto.pack) {
      const pr = auto.pack.progress;
      text.textContent = 'Đang tải mô hình: ' + auto.pack.name + (pr && pr.total ? ' ' + Math.floor(pr.done / pr.total * 100) + '%' : '…');
      return;
    }
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
      if (document.hidden && 'Notification' in window) { try { new Notification('Max Video AI', { body: name + ' đã xong: ' + jobTitle(job) }); } catch { /* bỏ qua */ } }
    } else if (job.status === 'failed') {
      toast(name + ' bị lỗi', { kind: 'err', sub: errorText(job.error) });
    }
  });

  // Engine AI trong máy + cập nhật (máy chủ active.mrhuynh.net/maxai)
  App.on('engine', renderEngineCard);
  App.on('engine', (st) => { if (!App.connected) App.emit('connection', { ok: false }); else App.emit('connection', { ok: true }); });
  window.fv.on('engine:status', (st) => {
    const was = Eng.st && Eng.st.phase;
    Eng.st = st; App.emit('engine', st);
    if (st.phase === 'running' && was !== 'running') window.fv.config.get().then((c) => { App.config = c; Poller.soon(200); });
  });
  window.fv.on('update:available', (r) => { $('#updatePill').classList.remove('hidden'); if (r.mandatory) checkUpdate({ info: r }); });

  startTicker();
  $('#poweredBtn').onclick = () => openTerms();
  // Màn hình chào → (lần đầu) điều khoản → tự cài engine, tự bật, tự tải mô hình. Người dùng không cần làm gì.
  if ((App.config.prefs || {}).termsAccepted !== TERMS_VERSION) {
    await Splash.minDelay(); Splash.hide();
    await ensureTermsAccepted();
    Splash.show();
  }
  await refreshEngine();
  navigate('video');
  // Bản quyền: chưa kích hoạt → màn hình mua/nhập key (engine & mô hình vẫn chuẩn bị ngầm để mua xong dùng ngay)
  await loadLicense();
  window.fv.on('license:changed', (v) => {
    const was = Lic.view && Lic.view.ok;
    Lic.view = v; renderLicenseChip(); App.emit('license', v);
    if (was && v && !v.ok && v.enabled) openLicense({ required: true, reason: v.message });
  });
  if (!licensed() && Lic.view && Lic.view.enabled) {
    window.fv.engine.auto();
    await Splash.minDelay(); Splash.hide();
    await ensureLicensed();
    Splash.show();
  }
  autoEngine();
  Poller.start();
  loadGuides();
  setInterval(() => { if (Eng.st && ['installing', 'planning', 'starting'].includes(Eng.st.phase)) refreshEngine(); }, 1500);
  // Kiểm tra bản mới khi mở (mỗi 6 giờ main process tự kiểm tra lại và báo về)
  setTimeout(async () => {
    const r = await window.fv.update.check();
    if (r && r.ok && r.data.available) { $('#updatePill').classList.remove('hidden'); if (r.data.mandatory) checkUpdate({ info: r.data }); }
  }, 2500);
})();

// Tự cài / tự bật engine; màn hình chào giữ tới khi engine sẵn sàng. Lần đầu có thanh tiến độ tải mô hình.
function autoEngine() {
  const firstRun = !(Eng.st && Eng.st.installed);
  const started = Date.now();
  let done = false;
  const finish = () => { if (done) return; done = true; Splash.hide(); };
  const intoApp = { label: 'Vào app', run: () => { finish(); } };
  const onState = (st) => {
    if (done || !st) return;
    const auto = st.auto || {};
    if (st.phase === 'running') { finish(); return; }
    if (auto.stage === 'unsupported') {
      Splash.progress('Máy này không đủ cấu hình để tạo video. ' + (auto.error || ''), 0, [intoApp,
        { label: 'Xem chi tiết', run: () => { finish(); navigate('engine'); } }]);
      return;
    }
    if (auto.stage === 'error' || st.phase === 'failed') {
      Splash.progress(viEngineError(auto.error || st.error || 'Engine không khởi động được'), 0, [
        { label: 'Thử lại', primary: true, run: () => { Splash.progress('Đang thử lại…', null); window.fv.engine.auto(); } },
        { label: 'Mở Engine & mô hình', run: () => { finish(); navigate('engine'); } }]);
      return;
    }
    if (st.phase === 'installing' || auto.stage === 'install') {
      const g = st.groups || [];
      const total = g.reduce((n, x) => n + (x.total || 0), 0), ready = g.reduce((n, x) => n + (x.ready || 0), 0);
      const speed = g.reduce((n, x) => n + (x.speed || 0), 0);
      let frac = total ? ready / total : null, text = 'Lần đầu: đang chuẩn bị engine…';
      if (total) {
        const left = speed ? (total - ready) / speed : 0;
        text = `Lần đầu: đang tải mô hình… ${Math.floor(frac * 100)}% · ${fmtBytes(ready)} / ${fmtBytes(total)}` + (left ? ' · còn ~' + fmtDuration(left) : '');
      } else if (st.progress && st.progress.current) {
        const c = st.progress.current;
        text = 'Lần đầu: ' + (c.label || 'đang cài') + (c.total ? ' · ' + Math.floor((c.done / c.total) * 100) + '%' : '');
        frac = c.total ? c.done / c.total : null;
      }
      Splash.progress(text, frac, [{ label: 'Chạy ngầm', run: () => finish() }]);
      return;
    }
    if (st.phase === 'starting' || auto.stage === 'start' || st.phase === 'planning') {
      if (firstRun || Date.now() - started > 6000) Splash.progress('Đang khởi động engine…', null, Date.now() - started > 20000 ? [intoApp] : []);
    }
  };
  App.on('engine', onState);
  window.fv.engine.auto().then((st) => { if (st) { Eng.st = st; onState(st); } });
  setInterval(() => { if (!done) refreshEngine(); }, 2000);
}
