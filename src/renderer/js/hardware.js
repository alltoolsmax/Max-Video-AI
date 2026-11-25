'use strict';
/* Kiểm tra máy: card đồ hoạ, VRAM, RAM → chạy bản đầy đủ / chế độ nhẹ / không đủ. Hiện ở màn bản quyền (trước khi mua) và trang Engine. */

const HW = { info: null, loading: null };
const HW_TIER = {
  full: ['Chạy được bản đầy đủ', 'ok', 'verified', 'MiniMax H3 — video tới 15 giây, có âm thanh, đủ mọi chức năng.'],
  lite: ['Chạy được chế độ nhẹ', 'warn', 'speed', 'Wan 2.2 (5B) — video tới 5 giây, chưa có âm thanh; Tạo ảnh, Sửa ảnh, Lồng tiếng, Phụ đề, Autopilot cần bản đầy đủ.'],
  none: ['Máy không đủ để tạo video', 'err', 'block', 'Mô hình tạo video cần card NVIDIA từ 6 GB VRAM và 16 GB RAM (hoặc Mac chip Apple 16 GB).'],
  unknown: ['Chưa kiểm tra được máy', 'warn', 'help', 'Không đọc được thông tin card đồ hoạ.'],
};

function loadHardware(force) {
  if (HW.info && !force) return Promise.resolve(HW.info);
  if (!HW.loading || force) {
    HW.loading = window.fv.hardware().then((r) => { HW.info = r && r.ok ? r.data : { tier: 'unknown', reasons: [r && r.error ? r.error.message : ''] }; HW.loading = null; return HW.info; });
  }
  return HW.loading;
}

// Hộp kết quả kiểm tra máy. compact: 1 dòng gọn (màn bản quyền)
function hardwareBox({ compact = false } = {}) {
  const box = h('div', { class: 'hw-box' + (compact ? ' compact' : '') }, icon('progress_activity', 'spin small'), h('span', { class: 'muted' }, 'Đang kiểm tra máy của bạn…'));
  loadHardware().then((hw) => {
    const [title, tone, ic, desc] = HW_TIER[hw.tier] || HW_TIER.unknown;
    box.className = 'hw-box ' + tone + (compact ? ' compact' : '');
    box.innerHTML = '';
    const specs = [hw.gpu, hw.vram && hw.platform !== 'darwin' ? fmtBytes(hw.vram) + ' VRAM' : null, hw.ram_text ? hw.ram_text + ' RAM' : null].filter(Boolean).join(' · ');
    box.append(icon(ic, 'fill'), h('div', { class: 'hw-text' },
      h('b', {}, title), h('small', {}, specs || ''),
      compact ? null : h('div', { class: 'hw-desc' }, desc),
      ...(hw.reasons || []).filter(Boolean).slice(0, compact ? 1 : 3).map((r) => h('div', { class: 'hw-reason' }, r))));
  });
  return box;
}
