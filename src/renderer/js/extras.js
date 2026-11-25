'use strict';
/* Cập nhật online, video hướng dẫn, thông tin ứng dụng, hộp thoại — giống GCloud Hub. Max Video AI miễn phí, không cần key. */

const APP_INFO = {
  name: 'Max Video AI', author: 'Mr. Huỳnh', owner: 'Huỳnh Xuyên Sơn', year: 2026,
  slogan: 'Tạo video & ảnh AI ngay trên máy tính của bạn — miễn phí, không giới hạn, không gửi dữ liệu đi đâu',
  explore: 'https://mrhuynh.net/tools',
  contact: [
    { label: 'Zalo', color: '#0068FF', text: 'Z', href: 'https://zalo.me/0979007367' },
    { label: 'Email', color: '#EA580C', icon: 'mail', href: 'mailto:info@mrhuynh.net' },
    { label: 'Website', color: '#10B981', icon: 'language', href: 'https://mrhuynh.net' },
    { label: 'Facebook', color: '#1877F2', text: 'f', href: 'https://facebook.com/mr.huynhxuyenson' },
  ],
  highlights: [
    { icon: 'movie', text: 'Tạo video có âm thanh từ mô tả — chạy MiniMax H3 ngay trên card đồ họa của bạn' },
    { icon: 'download', text: 'Tự tải mô hình và cài engine chỉ với một nút bấm — không cần cài thêm gì' },
    { icon: 'image', text: 'Tạo ảnh tới 16 MP, rồi biến ảnh thành video chỉ với một cú nhấp' },
    { icon: 'auto_awesome', text: 'AI sửa Prompt — biến ý tưởng ngắn thành prompt điện ảnh chi tiết, chạy ngay trên máy' },
    { icon: 'timer', text: 'Biết trước thời gian tạo trên đúng máy của bạn trước khi bấm Tạo' },
    { icon: 'fast_forward', text: 'Làm tiếp video có sẵn, tạo video dài tới 60 giây' },
    { icon: 'shield', text: 'Mọi thứ chạy trên máy bạn — không tải ảnh, video lên dịch vụ nào' },
  ],
};

const Extra = { guides: {} };
async function loadGuides() {
  try { const r = await window.fv.guides(); if (r && r.ok) Extra.guides = r.data || {}; } catch { /* bỏ qua */ }
}

/* ---------- Modal chung ---------- */
function openModal(content, { wide = false, locked = false } = {}) {
  const bg = $('#modal');
  bg.innerHTML = '';
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') }, content);
  bg.append(box);
  bg.classList.add('open');
  bg.onclick = (e) => { if (e.target === bg && !locked) closeModal(); };
  return box;
}
function closeModal() {
  const bg = $('#modal');
  bg.classList.remove('open');
  bg.innerHTML = '';
  if (typeof Lic !== 'undefined') clearInterval(Lic.poll);
}
const modalHead = (title, iconName, closable = true) => h('h3', {}, icon(iconName), title,
  closable ? h('button', { class: 'icon-btn x', title: 'Đóng', onclick: closeModal }, icon('close')) : null);

function copyText(text, msg) {
  navigator.clipboard.writeText(String(text || '')).then(() => toast(msg || 'Đã chép', { kind: 'ok' }), () => toast('Không chép được', { kind: 'err' }));
}

/* ---------- Cập nhật online ---------- */
async function checkUpdate({ silent = false, info = null } = {}) {
  let r = info;
  if (!r) {
    const res = await window.fv.update.check();
    if (!res.ok) { if (!silent) toast(res.error.message, { kind: 'err' }); return; }
    r = res.data;
  }
  if (!r.available) { if (!silent) toast(`Bạn đang dùng phiên bản mới nhất (v${r.current})`, { kind: 'ok' }); return; }
  $('#updatePill').classList.remove('hidden');
  const bar = h('div', { class: 'update-bar hidden' }, progressBar(0), h('span', { class: 'small-text muted' }, ''));
  const go = h('button', { class: 'btn btn-primary' }, icon('download'), 'Cập nhật ngay');
  const later = r.mandatory ? null : h('button', { class: 'btn', onclick: closeModal }, 'Để sau');
  openModal([modalHead('Có phiên bản mới', 'system_update', !r.mandatory),
    h('div', { class: 'row' }, h('span', { class: 'pill' }, 'v' + r.current), icon('arrow_forward'), h('span', { class: 'pill ok' }, 'v' + r.latest),
      r.date ? h('span', { class: 'muted small-text' }, 'phát hành ' + r.date) : null, r.mandatory ? h('span', { class: 'pill bad' }, 'Bắt buộc') : null),
    h('div', { class: 'prompt-box' }, r.notes || 'Cải thiện hiệu năng và sửa lỗi.'),
    r.canInstall ? null : h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('info'), 'Trên hệ điều hành này hãy tải bộ cài mới ở trang Releases.'),
    bar, h('div', { class: 'foot' }, later, r.canInstall ? go : null)], { locked: r.mandatory });
  const off = window.fv.on('update:progress', (p) => {
    const pct = p.total ? Math.round((p.got / p.total) * 100) : 0;
    bar.querySelector('.progress > div').style.width = pct + '%';
    bar.querySelector('span').textContent = `${fmtBytes(p.got)}${p.total ? ' / ' + fmtBytes(p.total) + ` (${pct}%)` : ''}`;
  });
  go.onclick = async () => {
    go.disabled = true; go.innerHTML = ''; go.append(icon('progress_activity', 'spin'), 'Đang tải…');
    bar.classList.remove('hidden'); if (later) later.classList.add('hidden');
    const d = await window.fv.update.download();
    if (!d.ok) {
      toast(d.error.message, { kind: 'err' });
      go.disabled = false; go.innerHTML = ''; go.append(icon('refresh'), 'Thử lại'); if (later) later.classList.remove('hidden');
      return;
    }
    go.innerHTML = ''; go.append(icon('progress_activity', 'spin'), 'Đang cài và khởi động lại…');
    off();
    const i = await window.fv.update.install();
    if (!i.ok) toast(i.error.message, { kind: 'err' });
  };
}

/* ---------- Thông tin ứng dụng ---------- */
async function openAbout() {
  const info = await window.fv.app();
  const lv = (typeof Lic !== 'undefined' && Lic.view) || null;
  const box = openModal([
    h('div', { class: 'about-top' },
      h('img', { src: '../../assets/icon.png', alt: '' }),
      h('div', { class: 'about-name' }, h('h2', {}, 'Max Video AI ', h('span', { class: 'muted' }, 'by Mr. Huỳnh')),
        h('div', {}, h('span', { class: 'ver' }, 'Phiên bản ' + info.version), h('span', { class: 'slogan' }, APP_INFO.slogan))),
      h('button', { class: 'icon-btn', title: 'Đóng', onclick: closeModal }, icon('close'))),
    h('div', { class: 'contact-row' }, APP_INFO.contact.map((c) => h('a', { onclick: () => window.fv.open(c.href) },
      h('i', { style: { background: c.color } }, c.icon ? icon(c.icon, 'small') : c.text), c.label))),
    h('dl', { class: 'kv about-kv' },
      h('dt', {}, 'Bản quyền'), h('dd', {}, (lv && lv.ok ? lv.label : 'Chưa kích hoạt')),
      h('dt', {}, 'Mã máy'), h('dd', {}, h('code', {}, info.machine), ' ', h('button', { class: 'icon-btn', title: 'Chép mã máy', onclick: () => copyText(info.machine, 'Đã chép mã máy') }, icon('content_copy', 'small'))),
      h('dt', {}, 'Engine'), h('dd', {}, 'Max AI Engine · MiniMax H3 / VDN-H3')),
    h('div', { class: 'about-acts' },
      h('button', { class: 'btn', onclick: () => openLicense() }, icon('workspace_premium'), 'Bản quyền'),
      h('button', { class: 'btn', onclick: () => openTerms() }, icon('gavel'), 'Giấy phép & điều khoản'),
      h('button', { class: 'btn', onclick: () => { closeModal(); navigate('engine'); } }, icon('memory'), 'Engine & mô hình'),
      h('button', { class: 'btn btn-primary', onclick: () => { closeModal(); checkUpdate(); } }, icon('system_update'), 'Kiểm tra cập nhật')),
    h('div', { class: 'help', style: { textAlign: 'center', margin: 0 } }, `© ${APP_INFO.year} ${APP_INFO.owner} (${APP_INFO.author}). Powered by MiniMax H3 — mô hình dùng theo giấy phép của từng nhà phát hành.`)], { wide: true });
  box.classList.add('about-modal');
}

/* ---------- Video hướng dẫn theo trang (link do trang quản trị đặt) ---------- */
function openGuide() {
  const route = (App.currentRoute || 'video').split('/')[0];
  const url = Extra.guides[route] || Extra.guides.video;
  if (url) window.fv.open(url);
  else toast('Chưa có video hướng dẫn cho mục này', { sub: 'Mr. Huỳnh sẽ sớm cập nhật.' });
}

/* ---------- Dòng giới thiệu chạy trên thanh tiêu đề ---------- */
function startTicker() {
  let i = 0;
  const show = () => {
    const el = $('#ticker');
    const it = APP_INFO.highlights[i++ % APP_INFO.highlights.length];
    el.innerHTML = '';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    el.append(icon(it.icon), h('span', {}, it.text));
  };
  show();
  setInterval(show, 6000);
}
