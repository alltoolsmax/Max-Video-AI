'use strict';
/* Trang Cài đặt: kết nối FreeVideo, thông tin máy, giao diện */

registerPage('settings', (() => {
  let unsub = [];
  const els = {};

  function render(root) {
    const page = h('div', { class: 'page', style: { maxWidth: '980px' } });
    page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Cài đặt'),
      h('div', { class: 'sub' }, 'Kết nối engine, giao diện và cập nhật.'))));

    els.status = h('div');
    els.url = h('input', { class: 'input', value: App.config.url, placeholder: 'http://127.0.0.1:8188' });
    els.root = h('div', { class: 'prompt-box', style: { padding: '8px 12px', maxHeight: 'none' } }, App.config.root || 'Chưa chọn');
    els.token = h('input', { class: 'input', type: 'password', placeholder: App.config.manualToken ? '•••••• (đã lưu token nhập tay)' : 'Để trống để đọc token từ thư mục cài đặt' });

    page.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('link'), h('h2', {}, 'Kết nối FreeVideo có sẵn (nâng cao)'), h('div', { class: 'grow' }), els.status),
      h('div', { class: 'card-body' },
        h('div', { class: 'notice info', style: { marginTop: 0, marginBottom: '18px' } }, icon('help'), h('div', {},
          'Bình thường Max AI tự cài và tự nối engine (mục Engine & mô hình). Chỉ cần mục này nếu bạn đã cài FreeVideo riêng và muốn dùng lại. Token được đọc từ ',
          h('code', {}, '<thư mục cài đặt>/agent/token'), ' và không rời khỏi máy bạn.')),
        field('Thư mục cài đặt FreeVideo', h('div', {}, els.root, h('div', { class: 'row mt' },
          h('button', { class: 'btn btn-outline', onclick: pickRoot }, icon('folder_open'), 'Chọn thư mục…'),
          h('button', { class: 'btn btn-text', onclick: detect }, icon('travel_explore'), 'Tự dò tìm'))),
          'Thư mục chứa FreeVideo (ví dụ %LOCALAPPDATA%\\FreeVideo, hoặc ComfyUI\\custom_nodes\\FreeVideo). App sẽ tự tìm thư mục con chứa agent/token.'),
        field('Địa chỉ máy chủ', h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, els.url),
          h('button', { class: 'btn btn-text', onclick: () => saveUrl('') }, 'Tự theo FreeVideo')),
          App.config.urlPinned ? 'Đang dùng địa chỉ bạn tự đặt.' : 'Tự lấy từ agent/endpoint.json mỗi lần FreeVideo khởi động (mặc định cổng 8188).'),
        h('details', {}, h('summary', { class: 'muted', style: { cursor: 'pointer', marginBottom: '10px' } }, 'Nhập token thủ công (khi FreeVideo chạy ở máy khác trong mạng LAN)'),
          field(null, els.token, 'Lấy nội dung file agent/token trên máy chạy FreeVideo. Máy đó cần bật "Truy cập mạng LAN" trong FreeVideo.'))),
      h('div', { class: 'card-foot' },
        h('button', { class: 'btn btn-text', onclick: test }, icon('network_check'), 'Kiểm tra'),
        h('button', { class: 'btn btn-primary', onclick: saveAll }, 'Lưu & kết nối'))));

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
    drawStatus();
    drawMachine();
    unsub = [App.on('connection', drawStatus), App.on('caps', drawMachine)];
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
      h('div', { class: 'help' }, 'Max AI tự kiểm tra bản mới khi mở và mỗi 6 giờ. Engine FreeVideo (Apache-2.0) chạy MiniMax H3 / VDN-H3 trên máy bạn; trọng số model theo MiniMax H3 Community License.'));
  }
  function leave() { unsub.forEach((u) => u()); }

  function drawStatus() {
    els.status.innerHTML = '';
    els.status.append(App.connected ? h('span', { class: 'pill ok' }, icon('check_circle', 'small'), 'Đã kết nối')
      : h('span', { class: 'pill bad' }, icon('error', 'small'), 'Chưa kết nối'));
    els.root.textContent = App.config.root || 'Chưa chọn';
    if (!App.connected && App.connectionError) {
      els.status.title = errorText(App.connectionError);
    }
  }

  function drawMachine() {
    const c = App.caps;
    els.machine.innerHTML = '';
    if (!c) { els.machine.append(h('div', { class: 'muted' }, App.connected ? 'Đang đọc…' : 'Kết nối để xem thông tin máy.')); return; }
    const d = c.device || {};
    const lim = c.limits || {};
    els.machine.append(h('dl', { class: 'kv', style: { maxWidth: '520px' } },
      h('dt', {}, 'Phiên bản FreeVideo'), h('dd', {}, c.freevideo_version || '—'),
      h('dt', {}, 'Engine sẵn sàng'), h('dd', {}, c.ready ? 'Có' : 'Chưa — ' + (c.problem || '')),
      h('dt', {}, 'Thiết bị'), h('dd', {}, (d.backend || '—').toUpperCase()),
      h('dt', {}, 'VRAM dùng tối đa'), h('dd', {}, d.vram_limit_gib ? d.vram_limit_gib + ' GB' : '—'),
      h('dt', {}, 'RAM dùng tối đa'), h('dd', {}, d.ram_limit_gib ? d.ram_limit_gib + ' GB' : '—'),
      h('dt', {}, 'Video dài nhất'), h('dd', {}, lim.seconds ? lim.seconds[1] + ' giây' : '—'),
      h('dt', {}, 'LoRA đã cài'), h('dd', {}, String((c.loras || []).length)),
      h('dt', {}, 'AI viết prompt'), h('dd', {}, c.features && c.features.enhance ? 'Sẵn sàng' : 'Chưa cài'),
      h('dt', {}, 'Hàng đợi'), h('dd', {}, c.queue ? c.queue.running + ' đang chạy, ' + c.queue.pending + ' đang chờ' : '—')));
  }

  async function pickRoot() {
    const r = await window.fv.config.pickRoot();
    if (!r) return;
    if (!r.found) { toast('Không thấy agent/token trong thư mục này', { kind: 'err', sub: 'Hãy chọn đúng thư mục FreeVideo và chạy FreeVideo ít nhất một lần.' }); return; }
    App.config = r.config;
    toast('Đã chọn thư mục FreeVideo', { kind: 'ok', sub: r.root });
    navigate('settings');
    Poller.soon(0);
  }

  async function detect() {
    const roots = await window.fv.config.detect();
    if (!roots.length) { toast('Không tự tìm thấy FreeVideo', { kind: 'err', sub: 'Hãy bấm "Chọn thư mục…" và chỉ tới nơi bạn cài FreeVideo.' }); return; }
    App.config = await window.fv.config.set({ root: roots[0] });
    toast('Tìm thấy FreeVideo', { kind: 'ok', sub: roots[0] });
    navigate('settings');
    Poller.soon(0);
  }

  async function saveUrl(url) {
    App.config = await window.fv.config.set({ url });
    if (!url) { App.config = await window.fv.config.get(); }
    els.url.value = App.config.url;
    Poller.soon(0);
    navigate('settings');
  }

  async function saveAll() {
    const values = {};
    if (els.url.value.trim() && els.url.value.trim() !== App.config.url) values.url = els.url.value.trim();
    if (els.token.value.trim()) values.token = els.token.value.trim();
    App.config = await window.fv.config.set(values);
    toast('Đã lưu');
    await test();
  }

  async function test() {
    try {
      const caps = await api('GET', '');
      App.caps = caps;
      setConnected(true);
      App.emit('caps', caps);
      toast('Kết nối thành công', { kind: 'ok', sub: 'FreeVideo ' + (caps.freevideo_version || '') });
    } catch (error) {
      setConnected(false, error);
      toastError(error, 'Kết nối thất bại');
    }
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
