'use strict';
/* Trang Cài đặt: thông tin máy & engine, giao diện, cập nhật */

registerPage('settings', (() => {
  let unsub = [];
  const els = {};

  function render(root) {
    const page = h('div', { class: 'page', style: { maxWidth: '980px' } });
    page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Cài đặt'),
      h('div', { class: 'sub' }, 'Thông tin máy, giao diện và cập nhật.'))));

    els.machine = h('div', { class: 'card-body' });
    page.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('memory'), h('h2', {}, 'Máy & engine')), els.machine));

    const theme = segmented([{ value: 'light', label: 'Sáng' }, { value: 'dark', label: 'Tối' }, { value: 'system', label: 'Theo hệ thống' }],
      pref('theme', 'dark'), (v) => { setPref('theme', v); applyTheme(v); });
    page.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('palette'), h('h2', {}, 'Giao diện')),
      h('div', { class: 'card-body' }, field('Chế độ màu', h('div', { style: { maxWidth: '420px' } }, theme)))));

    els.lic = h('div', { class: 'card-body' });
    page.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('system_update'), h('h2', {}, 'Cập nhật & thông tin')), els.lic));
    drawInfo();

    root.append(page);
    drawMachine();
    unsub = [App.on('caps', drawMachine), App.on('connection', drawMachine)];
  }
  async function drawInfo() {
    if (!els.lic) return;
    const info = await window.fv.app();
    els.lic.innerHTML = '';
    els.lic.append(h('dl', { class: 'kv', style: { maxWidth: '560px' } },
      h('dt', {}, 'Phiên bản Max AI'), h('dd', {}, 'v' + info.version),
      h('dt', {}, 'Giấy phép'), h('dd', {}, 'Miễn phí · không giới hạn'),
      h('dt', {}, 'Mã máy (ẩn danh)'), h('dd', {}, h('code', {}, info.machine))),
      h('div', { class: 'row mt' },
        h('button', { class: 'btn btn-primary', onclick: () => checkUpdate() }, icon('system_update'), 'Kiểm tra cập nhật'),
        h('button', { class: 'btn btn-outline', onclick: () => navigate('engine') }, icon('memory'), 'Engine & mô hình'),
        h('button', { class: 'btn btn-text', onclick: openAbout }, icon('info'), 'Thông tin ứng dụng')),
      h('div', { class: 'help' }, 'Max AI tự kiểm tra bản mới khi mở và mỗi 6 giờ. Max AI Engine chạy mô hình MiniMax H3 / VDN-H3 ngay trên máy bạn; mô hình tải về khi cài, theo MiniMax H3 Community License.'));
  }
  function leave() { unsub.forEach((u) => u()); }


  function drawMachine() {
    const c = App.caps;
    els.machine.innerHTML = '';
    if (!c) { els.machine.append(h('div', { class: 'muted' }, App.connected ? 'Đang đọc…' : 'Bật engine để xem thông tin máy.')); return; }
    const d = c.device || {};
    const lim = c.limits || {};
    els.machine.append(h('dl', { class: 'kv', style: { maxWidth: '520px' } },
      h('dt', {}, 'Phiên bản engine'), h('dd', {}, c.freevideo_version || '—'),
      h('dt', {}, 'Engine sẵn sàng'), h('dd', {}, c.ready ? 'Có' : 'Chưa — ' + (c.problem || '')),
      h('dt', {}, 'Thiết bị'), h('dd', {}, (d.backend || '—').toUpperCase()),
      h('dt', {}, 'VRAM dùng tối đa'), h('dd', {}, d.vram_limit_gib ? d.vram_limit_gib + ' GB' : '—'),
      h('dt', {}, 'RAM dùng tối đa'), h('dd', {}, d.ram_limit_gib ? d.ram_limit_gib + ' GB' : '—'),
      h('dt', {}, 'Video dài nhất'), h('dd', {}, lim.seconds ? lim.seconds[1] + ' giây' : '—'),
      h('dt', {}, 'LoRA đã cài'), h('dd', {}, String((c.loras || []).length)),
      h('dt', {}, 'AI viết prompt'), h('dd', {}, c.features && c.features.enhance ? 'Sẵn sàng' : 'Chưa cài'),
      h('dt', {}, 'Hàng đợi'), h('dd', {}, c.queue ? c.queue.running + ' đang chạy, ' + c.queue.pending + ' đang chờ' : '—')));
  }






  return { render, leave };
})());

function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = document.querySelector('#theme-btn .ms');
  if (btn) btn.textContent = dark ? 'light_mode' : 'dark_mode';
  if (window.fv.theme) window.fv.theme(dark ? 'dark' : 'light');
}
