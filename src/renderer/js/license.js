'use strict';
/* Bản quyền (gói Miễn phí / Chuyên nghiệp), mua key qua VietQR, cập nhật online, thông tin ứng dụng — giống Video AI & GCloud Hub. */

const APP_INFO = {
  name: 'Max AI', author: 'Mr. Huỳnh', owner: 'Huỳnh Xuyên Sơn', year: 2026,
  slogan: 'Tạo video & ảnh AI ngay trên máy tính của bạn — không giới hạn, không phí theo lượt',
  explore: 'https://mrhuynh.net/tools',
  contact: [
    { label: 'Zalo', color: '#0068FF', text: 'Z', href: 'https://zalo.me/0979007367' },
    { label: 'Email', color: '#EA580C', icon: 'mail', href: 'mailto:info@mrhuynh.net' },
    { label: 'Website', color: '#10B981', icon: 'language', href: 'https://mrhuynh.net' },
    { label: 'Facebook', color: '#1877F2', text: 'f', href: 'https://facebook.com/mr.huynhxuyenson' },
  ],
  highlights: [
    { icon: 'movie', text: 'Tạo video có âm thanh từ mô tả — chạy MiniMax H3 ngay trên card đồ họa của bạn' },
    { icon: 'image', text: 'Tạo ảnh tới 16 MP, rồi biến ảnh thành video chỉ với một cú nhấp' },
    { icon: 'auto_awesome', text: 'Viết lại bằng AI — biến ý tưởng ngắn thành prompt điện ảnh chi tiết' },
    { icon: 'timer', text: 'Biết trước thời gian tạo trên đúng máy của bạn trước khi bấm Tạo' },
    { icon: 'fast_forward', text: 'Làm tiếp video có sẵn, tạo video dài tới 60 giây' },
    { icon: 'shield', text: 'Mọi thứ chạy trên máy bạn — không tải ảnh, video lên dịch vụ nào' },
  ],
};

const Lic = { view: null, plans: null, guides: {} };
const isPro = () => !Lic.view || Lic.view.tier === 'pro';
const fmtVnd = (n) => (Number(n) || 0).toLocaleString('vi-VN') + 'đ';

async function loadLicense() {
  try { Lic.view = await window.fv.license.get(); } catch (e) { console.warn(e); }
  renderPlanCard();
  App.emit('license', Lic.view);
  window.fv.license.guides().then((r) => { if (r && r.ok) Lic.guides = r.data || {}; }).catch(() => {});
}

function renderPlanCard() {
  const card = $('#planCard');
  const v = Lic.view;
  if (!card || !v) return;
  card.className = 'plan-card' + (v.tier === 'pro' ? ' pro' : '');
  card.innerHTML = '';
  card.append(...[
    h('div', { class: 'tier' }, icon(v.tier === 'pro' ? 'workspace_premium' : 'bolt', 'fill'), v.tier === 'pro' ? 'Chuyên nghiệp' : 'Miễn phí',
      h('span', { class: 'tag' }, v.tier === 'pro' ? 'PRO' : 'FREE')),
    h('small', {}, v.tier === 'pro' ? v.label + (v.offline ? ' · đang ngoại tuyến' : '') : 'Mỗi lần 1 tác vụ. Nâng cấp để tạo hàng loạt.'),
    v.tier === 'pro' ? null : h('button', { class: 'btn btn-primary up', onclick: (e) => { e.stopPropagation(); openLicense(); } }, icon('rocket_launch'), 'Nâng cấp PRO')].filter(Boolean));
  card.onclick = () => openLicense();
}

/* ---------- Giới hạn gói Miễn phí: mỗi lần 1 tác vụ, 1 bản / 1 ảnh mỗi lần tạo ---------- */
function freeBusy() {
  if (isPro()) return false;
  return (App.jobs || []).some((j) => ACTIVE.has(j.status) && (j.client === 'Max AI' || !j.client));
}
function requirePro(reason) {
  openLicense(reason);
  return false;
}
// Gọi trước khi gửi job: trả về true nếu được phép.
function allowSubmit({ count = 1 } = {}) {
  if (isPro()) return true;
  if (count > 1) return requirePro('Gói Miễn phí tạo 1 bản mỗi lần. Nâng cấp Chuyên nghiệp để tạo nhiều bản cùng lúc.');
  if (freeBusy()) return requirePro('Gói Miễn phí chạy mỗi lần 1 tác vụ — đợi tác vụ đang chạy xong, hoặc nâng cấp Chuyên nghiệp để xếp hàng loạt.');
  return true;
}
const proLock = () => (isPro() ? null : h('span', { class: 'pro-lock', title: 'Cần gói Chuyên nghiệp' }, icon('lock', 'small'), 'PRO'));

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
  clearInterval(Lic.poll);
}
const modalHead = (title, iconName, closable = true) => h('h3', {}, icon(iconName), title,
  closable ? h('button', { class: 'icon-btn x', title: 'Đóng', onclick: closeModal }, icon('close')) : null);

/* ---------- Bản quyền & mua key ---------- */
async function openLicense(reason) {
  const v = Lic.view || {};
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const box = openModal([modalHead('Bản quyền Max AI', 'workspace_premium'), body], { wide: true });
  const keyInput = h('input', { class: 'input mono', placeholder: 'MAX-XXXX-XXXX-XXXX-XXXX', style: { fontFamily: 'Consolas, monospace', letterSpacing: '.5px' },
    onkeydown: (e) => { if (e.key === 'Enter') activate(); } });
  const actBtn = h('button', { class: 'btn btn-primary', onclick: activate }, icon('key'), 'Kích hoạt');
  async function activate() {
    const key = keyInput.value.trim();
    if (!key) { keyInput.focus(); return; }
    actBtn.disabled = true;
    const r = await window.fv.license.activate(key);
    actBtn.disabled = false;
    if (!r.ok) { toast(r.error.message, { kind: 'err' }); return; }
    Lic.view = r.data;
    renderPlanCard(); App.emit('license', Lic.view);
    toast(r.data.renewed ? `Đã gia hạn thêm ${r.data.added_days} ngày` : 'Kích hoạt thành công!', { kind: 'ok', sub: r.data.label });
    openLicense();
  }

  if (reason) body.append(h('div', { class: 'notice warn', style: { marginTop: 0 } }, icon('lock'), h('div', {}, reason)));
  body.append(h('div', { class: 'lic-status' + (v.tier === 'pro' ? ' pro' : '') },
    h('span', { class: 'big-tag' }, v.tier === 'pro' ? 'PRO' : 'FREE'),
    h('div', { style: { flex: 1 } }, h('b', {}, v.label || 'Gói Miễn phí'),
      h('small', {}, v.key ? 'Key: ' + v.key : (v.reason && v.reason !== 'none' ? v.message : 'Miễn phí vĩnh viễn · mỗi lần 1 tác vụ'))),
    h('div', { style: { textAlign: 'right' } }, h('small', {}, 'Mã máy'), h('div', { class: 'row tight', style: { justifyContent: 'flex-end' } },
      h('code', {}, (v.machine || '').slice(0, 16) + '…'),
      h('button', { class: 'icon-btn', title: 'Chép mã máy', onclick: () => copyText(v.machine, 'Đã chép mã máy') }, icon('content_copy', 'small'))))));
  if (v.enabled === false) body.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('code'), 'Bản phát triển: chưa gắn máy chủ bản quyền nên mở khóa đủ tính năng.'));

  body.append(h('div', {}, h('div', { class: 'label' }, v.tier === 'pro' ? 'Gia hạn / nhập key khác (ngày được cộng dồn)' : 'Đã có key? Nhập vào đây'),
    h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, keyInput), actBtn)));

  body.append(h('div', { class: 'feature-list' },
    ['Chạy hàng loạt, xếp nhiều tác vụ cùng lúc', 'Tạo 2–4 bản mỗi lần để chọn bản đẹp nhất', 'Tạo nhiều ảnh cùng lúc',
      'Nhận mọi bản cập nhật & tính năng mới', 'Dùng 1 key cho 1 máy, tự chuyển máy 30 ngày/lần', 'Hỗ trợ trực tiếp qua Zalo'].map((t) => h('div', {}, icon('check_circle', 'fill'), t))));

  const plansBox = h('div', {}, h('span', { class: 'muted' }, icon('progress_activity', 'spin'), ' Đang tải bảng giá…'));
  body.append(h('div', {}, h('div', { class: 'label' }, 'Mua gói Chuyên nghiệp'), plansBox));
  const r = await window.fv.license.plans();
  const data = (r && r.ok && r.data) || { plans: [] };
  Lic.plans = data;
  plansBox.innerHTML = '';
  if (!data.plans || !data.plans.length) {
    plansBox.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('wifi_off'), 'Chưa tải được bảng giá. Liên hệ Zalo 0979 007 367 để mua key.'));
    return;
  }
  let sel = (data.plans.find((p) => p.badge) || data.plans[0]).code;
  const grid = h('div', { class: 'plans' });
  const draw = () => {
    grid.innerHTML = '';
    for (const p of data.plans) {
      const perMonth = p.days >= 30 ? Math.round(p.price / (p.days / 30)) : 0;
      grid.append(h('button', { class: 'plan' + (p.code === sel ? ' sel' : ''), onclick: () => { sel = p.code; draw(); } },
        p.badge ? h('span', { class: 'ribbon' }, p.badge) : null, h('b', {}, p.name), h('span', { class: 'price' }, fmtVnd(p.price)),
        h('span', { class: 'per' }, p.days === 0 ? 'Vĩnh viễn' : perMonth ? '≈ ' + fmtVnd(perMonth) + ' / tháng' : p.days + ' ngày')));
    }
  };
  draw();
  const contact = data.contact || {};
  plansBox.append(grid, h('div', { class: 'row mt', style: { justifyContent: 'flex-end' } },
    h('button', { class: 'btn btn-outline', onclick: () => buyViaZalo(data.plans.find((p) => p.code === sel), contact) }, icon('chat'), 'Mua qua Zalo'),
    data.payment ? h('button', { class: 'btn btn-primary', onclick: () => buyQR(sel) }, icon('qr_code_2'), 'Mua ngay – quét QR') : null));
  return box;
}

function buyViaZalo(plan, contact) {
  const v = Lic.view || {};
  const msg = `Mua Max AI – gói ${plan ? plan.name + ' (' + fmtVnd(plan.price) + ')' : ''}\nMã máy: ${v.machine}`;
  copyText(msg, 'Đã chép tin nhắn — dán vào Zalo rồi gửi');
  window.fv.open(contact.zalo || 'https://zalo.me/0979007367');
}

async function buyQR(plan) {
  const r = await window.fv.license.order(plan);
  if (!r.ok) { toast(r.error.message, { kind: 'err' }); return; }
  const o = r.data;
  const status = h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('progress_activity', 'spin'), h('div', {}, 'Đang chờ chuyển khoản… phần mềm tự kích hoạt khi nhận được tiền.'));
  openModal([modalHead('Thanh toán gói ' + o.plan, 'qr_code_2'),
    h('div', { class: 'qr-box' }, o.qr_url ? h('img', { src: o.qr_url, alt: 'VietQR' }) : null,
      h('dl', { class: 'kv' },
        h('dt', {}, 'Ngân hàng'), h('dd', {}, o.bank.id),
        h('dt', {}, 'Số tài khoản'), h('dd', {}, o.bank.account, ' ', h('button', { class: 'icon-btn', style: { display: 'inline-grid', width: '24px', height: '24px' }, onclick: () => copyText(o.bank.account) }, icon('content_copy', 'small'))),
        h('dt', {}, 'Chủ tài khoản'), h('dd', {}, o.bank.name),
        h('dt', {}, 'Số tiền'), h('dd', {}, h('b', { style: { fontSize: '18px' } }, fmtVnd(o.amount))),
        h('dt', {}, 'Nội dung CK'), h('dd', {}, h('b', { style: { fontSize: '16px', letterSpacing: '1px' } }, o.content), ' ', h('button', { class: 'icon-btn', style: { display: 'inline-grid', width: '24px', height: '24px' }, onclick: () => copyText(o.content) }, icon('content_copy', 'small'))),
        h('dt', {}, 'Hết hạn sau'), h('dd', {}, Math.round(o.expires_in / 60) + ' phút'))),
    h('div', { class: 'help', style: { marginTop: 0 } }, 'Quét mã bằng app ngân hàng bất kỳ. Giữ đúng nội dung chuyển khoản để hệ thống nhận diện tự động.'),
    status,
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => openLicense() }, icon('arrow_back'), 'Chọn gói khác'))]);
  clearInterval(Lic.poll);
  Lic.poll = setInterval(async () => {
    const s = await window.fv.license.orderStatus(o.code);
    if (!s.ok) return;
    if (s.data.status === 'paid' && s.data.key) {
      clearInterval(Lic.poll);
      status.className = 'notice ok'; status.innerHTML = '';
      status.append(icon('check_circle'), h('div', {}, 'Đã nhận tiền! Đang kích hoạt…'));
      const a = await window.fv.license.activate(s.data.key);
      if (a.ok) {
        Lic.view = a.data; renderPlanCard(); App.emit('license', Lic.view);
        toast('Đã lên gói Chuyên nghiệp!', { kind: 'ok', sub: 'Key: ' + s.data.key });
        openLicense();
      } else toast(a.error.message, { kind: 'err', sub: 'Key của bạn: ' + s.data.key });
    } else if (s.data.status === 'review') {
      clearInterval(Lic.poll);
      status.className = 'notice warn'; status.innerHTML = '';
      status.append(icon('warning'), h('div', {}, 'Số tiền chưa đủ. Người bán sẽ kiểm tra và xử lý — liên hệ Zalo 0979 007 367.'));
    } else if (s.data.status === 'expired') {
      clearInterval(Lic.poll);
      status.className = 'notice err'; status.innerHTML = '';
      status.append(icon('timer_off'), h('div', {}, 'Đơn đã hết hạn. Hãy tạo đơn mới.'));
    }
  }, 3000);
}

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
  openModal([
    h('button', { class: 'icon-btn x', style: { position: 'absolute', right: '14px', top: '14px' }, onclick: closeModal }, icon('close')),
    h('div', { class: 'about-head' }, h('img', { src: '../../assets/icon.png', alt: '' }),
      h('h2', {}, 'Max AI ', h('span', { class: 'muted', style: { fontSize: '15px' } }, 'by Mr. Huỳnh')),
      h('span', { class: 'ver' }, 'Phiên bản ' + info.version), h('p', {}, APP_INFO.slogan)),
    h('div', { class: 'contact-row' }, APP_INFO.contact.map((c) => h('a', { onclick: () => window.fv.open(c.href) },
      h('i', { style: { background: c.color } }, c.icon ? icon(c.icon, 'small') : c.text), c.label))),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Bản quyền'), h('dd', {}, (Lic.view && Lic.view.label) || '—'),
      h('dt', {}, 'Mã máy'), h('dd', {}, h('code', {}, info.machine)),
      h('dt', {}, 'Engine'), h('dd', {}, 'FreeVideo (Apache-2.0) · MiniMax H3 / VDN-H3')),
    h('div', { class: 'help', style: { textAlign: 'center' } }, `© ${APP_INFO.year} ${APP_INFO.owner} (${APP_INFO.author}). Trọng số model theo MiniMax H3 Community License.`),
    h('div', { class: 'foot', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', onclick: () => { closeModal(); openLicense(); } }, icon('workspace_premium'), 'Bản quyền'),
      h('button', { class: 'btn btn-primary', onclick: () => { closeModal(); checkUpdate(); } }, icon('system_update'), 'Kiểm tra cập nhật'))]);
}

/* ---------- Video hướng dẫn theo trang (link do trang quản trị đặt) ---------- */
function openGuide() {
  const route = (App.currentRoute || 'video').split('/')[0];
  const url = Lic.guides[route] || Lic.guides.video;
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
