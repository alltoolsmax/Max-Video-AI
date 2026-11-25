'use strict';
/* Bản quyền Max Video AI: 2 gói TRẢI NGHIỆM (1 tháng) / VĨNH VIỄN (mua 1 lần). Mua bằng QR (VietQR + SePay) → tự kích hoạt khi nhận tiền.
   Chưa kích hoạt thì app hiện màn hình bản quyền (không đóng được); engine & mô hình vẫn chuẩn bị ngầm để mua xong dùng ngay. */

const Lic = { view: null, plans: null, poll: null };
const fmtVnd = (n) => (Number(n) || 0).toLocaleString('vi-VN') + 'đ';
const licensed = () => Boolean(Lic.view && Lic.view.ok);

async function loadLicense() {
  try { Lic.view = await window.fv.license.get(); } catch (e) { console.warn(e); }
  renderLicenseChip();
  App.emit('license', Lic.view);
  return Lic.view;
}

// Dòng bản quyền 1 hàng ở menu trái
function renderLicenseChip() {
  const el = $('#licChip');
  const v = Lic.view;
  if (!el || !v) return;
  el.innerHTML = '';
  el.className = 'lic-chip' + (v.ok ? (v.lifetime ? ' life' : ' trial') : ' none');
  el.append(icon(v.ok ? 'workspace_premium' : 'key', 'small'),
    h('span', {}, v.ok ? (v.lifetime ? 'VĨNH VIỄN' : (v.plan_name || 'TRẢI NGHIỆM') + ' · còn ' + v.days_left + ' ngày') : 'Kích hoạt bản quyền'));
  el.onclick = () => openLicense();
}

// Gọi khi mở app (sau điều khoản): chưa có bản quyền → hiện màn hình kích hoạt, đợi tới khi kích hoạt xong.
function ensureLicensed() {
  if (licensed() || (Lic.view && !Lic.view.enabled)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = App.on('license', (v) => { if (v && v.ok) { off(); closeModal(); resolve(true); } });
    openLicense({ required: true });
  });
}

/* ---------- Màn hình bản quyền ---------- */
async function openLicense({ required = false, reason = '' } = {}) {
  const v = Lic.view || {};
  required = required || !v.ok;
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  openModal([modalHead(v.ok ? 'Bản quyền Max Video AI' : 'Kích hoạt Max Video AI', 'workspace_premium', !required), body], { wide: true, locked: required });

  const keyInput = h('input', { class: 'input mono', placeholder: 'Nhập key, ví dụ MAX-XXXX-XXXX-XXXX-XXXX', style: { fontFamily: 'Consolas, monospace', letterSpacing: '.5px' },
    onkeydown: (e) => { if (e.key === 'Enter') activate(); } });
  const actBtn = h('button', { class: 'btn btn-primary', onclick: activate }, icon('key'), 'Kích hoạt');
  async function activate(keyArg) {
    const key = (typeof keyArg === 'string' ? keyArg : keyInput.value).trim();
    if (!key) { keyInput.focus(); return; }
    actBtn.disabled = true;
    const r = await window.fv.license.activate(key);
    actBtn.disabled = false;
    if (!r.ok) { toast(r.error.message, { kind: 'err' }); return; }
    Lic.view = r.data; renderLicenseChip();
    toast(r.data.renewed ? (r.data.lifetime ? 'Đã nâng lên VĨNH VIỄN' : `Đã gia hạn thêm ${r.data.added_days} ngày`) : 'Kích hoạt thành công!', { kind: 'ok', sub: r.data.label });
    App.emit('license', Lic.view);
    if (!required) openLicense();
  }
  Lic.activate = activate;

  if (reason || (v.message && !v.ok && v.reason !== 'none')) {
    body.append(h('div', { class: 'notice warn', style: { marginTop: 0 } }, icon('lock'), h('div', {}, reason || v.message)));
  }
  if (v.ok) {
    body.append(h('div', { class: 'lic-status pro' },
      h('span', { class: 'big-tag' }, v.lifetime ? 'VĨNH VIỄN' : 'TRẢI NGHIỆM'),
      h('div', { style: { flex: 1 } }, h('b', {}, v.label), h('small', {}, (v.key ? 'Key: ' + v.key : '') + (v.offline ? ' · đang ngoại tuyến' : ''))),
      machineBox(v)));
  } else {
    body.append(h('div', { class: 'lic-hero' }, h('img', { src: '../../assets/icon.png', alt: '' }),
      h('div', {}, h('b', {}, 'Chọn gói để bắt đầu'), h('small', {}, 'Thanh toán bằng QR ngân hàng — phần mềm tự kích hoạt ngay khi nhận tiền. Trong lúc chờ, engine & mô hình AI vẫn được chuẩn bị ngầm.')),
      machineBox(v)));
  }

  // Bảng giá
  const plansBox = h('div', {}, h('span', { class: 'muted' }, icon('progress_activity', 'spin'), ' Đang tải bảng giá…'));
  if (!v.lifetime) body.append(plansBox);
  body.append(h('div', {}, h('div', { class: 'label' }, v.ok ? 'Gia hạn / nâng cấp bằng key khác' : 'Đã có key? Nhập vào đây'),
    h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, keyInput), actBtn)));
  body.append(h('div', { class: 'feature-list' },
    ['Tạo video, ảnh không giới hạn — chạy trên máy bạn', 'Sửa ảnh, Kho ảnh tham chiếu, Autopilot', 'Lồng tiếng giữ giọng gốc, Phụ đề tự động',
      'Nhận mọi bản cập nhật & tính năng mới', '1 key cho 1 máy, tự chuyển máy 30 ngày/lần', 'Hỗ trợ trực tiếp qua Zalo 0979 007 367'].map((t) => h('div', {}, icon('check_circle', 'fill'), t))));
  if (required) {
    body.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn btn-text', onclick: async () => { const r = await window.fv.license.refresh(); if (r.ok) { Lic.view = r.data; renderLicenseChip(); App.emit('license', Lic.view); if (!r.data.ok) toast(r.data.message || 'Chưa có bản quyền', { kind: 'err' }); } else toast(r.error.message, { kind: 'err' }); } }, icon('refresh'), 'Kiểm tra lại'),
      h('button', { class: 'btn btn-text', onclick: () => window.fv.quit() }, icon('logout'), 'Thoát')));
  }
  if (v.lifetime) return;

  const r = await window.fv.license.plans();
  const data = (r && r.ok && r.data) || { plans: [] };
  Lic.plans = data;
  plansBox.innerHTML = '';
  if (!data.plans || !data.plans.length) {
    plansBox.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('wifi_off'), 'Chưa tải được bảng giá (kiểm tra mạng). Liên hệ Zalo 0979 007 367 để mua key.'));
    return;
  }
  const grid = h('div', { class: 'plans two' });
  const contact = data.contact || {};
  for (const p of data.plans) {
    const life = Number(p.days) === 0;
    grid.append(h('div', { class: 'plan big' + (life ? ' sel' : '') },
      p.badge ? h('span', { class: 'ribbon' }, p.badge) : null,
      h('b', {}, p.name), h('span', { class: 'price' }, fmtVnd(p.price)),
      h('span', { class: 'per' }, life ? 'Mua 1 lần · dùng vĩnh viễn' : 'Dùng ' + p.days + ' ngày'),
      h('div', { class: 'acts' },
        data.payment ? h('button', { class: 'btn btn-primary', onclick: () => buyQR(p) }, icon('qr_code_2'), 'Mua ngay') : null,
        h('button', { class: 'btn btn-text', onclick: () => buyViaZalo(p, contact) }, icon('chat'), 'Mua qua Zalo'))));
  }
  plansBox.append(h('div', { class: 'label' }, v.ok ? 'Mua thêm / nâng cấp' : 'Chọn gói'), grid);
}

function machineBox(v) {
  return h('div', { style: { textAlign: 'right' } }, h('small', { class: 'muted' }, 'Mã máy'), h('div', { class: 'row tight', style: { justifyContent: 'flex-end' } },
    h('code', {}, (v.machine || '').slice(0, 16) + '…'),
    h('button', { class: 'icon-btn', title: 'Chép mã máy', onclick: () => copyText(v.machine, 'Đã chép mã máy') }, icon('content_copy', 'small'))));
}

function buyViaZalo(plan, contact) {
  const v = Lic.view || {};
  copyText(`Mua Max Video AI – gói ${plan.name} (${fmtVnd(plan.price)})\nMã máy: ${v.machine}`, 'Đã chép tin nhắn — dán vào Zalo rồi gửi');
  window.fv.open(contact.zalo || 'https://zalo.me/0979007367');
}

async function buyQR(plan) {
  const required = !licensed();
  const r = await window.fv.license.order(plan.code);
  if (!r.ok) { toast(r.error.message, { kind: 'err' }); return; }
  const o = r.data;
  const status = h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('progress_activity', 'spin'), h('div', {}, 'Đang chờ chuyển khoản… phần mềm tự kích hoạt ngay khi nhận được tiền.'));
  openModal([modalHead('Thanh toán gói ' + plan.name, 'qr_code_2', !required),
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
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { clearInterval(Lic.poll); openLicense({ required }); } }, icon('arrow_back'), 'Chọn gói khác'))], { wide: true, locked: required });
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
        Lic.view = a.data; renderLicenseChip();
        toast('Kích hoạt thành công — ' + a.data.label, { kind: 'ok', sub: 'Key: ' + s.data.key + ' (đã lưu trong máy)' });
        App.emit('license', Lic.view);
        if (!required) openLicense();
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
