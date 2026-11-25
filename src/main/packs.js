'use strict';
// Các mô hình của Max AI Engine (đầy đủ như engine gốc). Mô hình tạo video được tải khi cài engine;
// các mô hình còn lại tải riêng từng gói về máy khi người dùng bấm "Tải" (engine phải đang chạy).
// Mỗi gói được engine báo { ready, bytes còn thiếu, tiến độ } qua các địa chỉ cục bộ của nó.

const PACKS = [
  { id: 'video', name: 'Tạo video có âm thanh', model: 'MiniMax H3 · VDN-H3 (8 bước)', use: 'Tạo video, làm tiếp video, xem trước nhanh', core: true },
  { id: 'image-h3', name: 'Tạo ảnh chất lượng cao', model: 'MiniMax H3 Image', use: 'Trang Tạo ảnh, tới 16 MP (Windows/Linux)' },
  { id: 'image-qwen', name: 'Tạo ảnh nhanh', model: 'Qwen Image 2.1 Turbo', use: 'Trang Tạo ảnh, sửa và ghép ảnh' },
  { id: 'segment', name: 'Chọn vùng / tách nền', model: 'SAM 2', use: 'Chọn vùng khi sửa ảnh theo lớp (sắp có)' },
  { id: 'vlm', name: 'AI viết prompt', model: 'Prompt VLM', use: 'Viết lại prompt, viết kịch bản (AI trên máy), Autopilot tự chọn bản đẹp nhất' },
  { id: 'dubbing', name: 'Lồng tiếng giữ giọng gốc', model: 'CosyVoice 3', use: 'Trang Lồng tiếng' },
  { id: 'subtitle', name: 'Phụ đề tự động', model: 'Nhận dạng giọng nói (sherpa-onnx)', use: 'Trang Phụ đề, Lồng tiếng' },
  { id: 'music', name: 'Nhạc nền AI', model: 'Gói nhạc', use: 'Nhạc nền cho phim (sắp có)' },
];

const tokens = {};

async function get(url, route) {
  const res = await fetch(url + route, { signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: j };
}
async function post(url, route, body, headers = {}) {
  const res = await fetch(url + route, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(packError(j));
  return j;
}
function packError(j) {
  const code = (j && (j.error || j.reason)) || 'lỗi';
  return ({ consent_required: 'Cần đồng ý tải mô hình.', busy: 'Engine đang bận tạo video — thử lại sau khi xong.', unsupported: 'Máy này chưa hỗ trợ gói này.',
    not_published: 'Gói này chưa phát hành cho hệ điều hành của bạn.', reload: 'Engine vừa khởi động lại — bấm lại lần nữa.' })[code]
    || (j && (j.message_en || j.message)) || ('Không tải được (' + code + ')');
}

function row(base, { ready, bytes, busy, progress, error, available = true }) {
  return { ...base, ready: Boolean(ready), bytes: Number(bytes) || 0, busy: Boolean(busy), progress: progress || null, error: error || null, available };
}

async function packList({ url, installed, running }) {
  if (!running || !url) {
    return PACKS.map((p) => row(p, { ready: p.core ? installed : false, available: p.core }))
      .map((p) => (p.core ? p : { ...p, needsEngine: true }));
  }
  const out = [];
  const settle = async (fn, base) => { try { out.push(await fn()); } catch (e) { out.push(row(base, { error: e.message, available: false })); } };
  out.push(row(PACKS[0], { ready: installed }));
  // ảnh: H3 Image + Qwen + tách nền
  let image = null;
  try { const r = await get(url, '/freevideo/image-gen'); if (r.ok) { image = r.data; tokens.image = r.data.token; } } catch { /* engine chưa sẵn sàng */ }
  for (const [id, model] of [['image-h3', 'minimax-h3-image'], ['image-qwen', 'qwen-image-2.1-turbo']]) {
    const base = PACKS.find((p) => p.id === id);
    const m = image && (image.models || []).find((x) => x.id === model);
    if (!m) { out.push(row(base, { available: false, error: image ? 'Chưa hỗ trợ trên máy này' : 'Engine chưa trả lời' })); continue; }
    const inst = m.install || null;
    out.push(row(base, { ready: m.ready, bytes: m.bytes_needed || m.bytes_total, available: m.available !== false,
      busy: m.downloading || (inst && ['running', 'queued', 'paused_for_generation'].includes(inst.state)),
      progress: inst && inst.total ? { done: inst.done, total: inst.total } : null,
      error: inst && inst.state === 'failed' ? (inst.detail || inst.message_en || 'Tải lỗi') : null }));
  }
  {
    const base = PACKS.find((p) => p.id === 'segment');
    const seg = image && image.segment;
    const inst = seg && seg.install;
    out.push(row(base, { ready: seg && seg.ready, available: Boolean(seg), busy: inst && inst.state === 'running',
      progress: inst && inst.total ? { done: inst.done, total: inst.total } : null }));
  }
  await settle(async () => {
    const r = await get(url, '/freevideo/prompt-vlm'); tokens.vlm = r.data.token;
    return row(PACKS.find((p) => p.id === 'vlm'), { ready: r.data.ready, bytes: r.data.bytes, busy: r.data.busy });
  }, PACKS.find((p) => p.id === 'vlm'));
  await settle(async () => {
    const r = await get(url, '/freevideo/dubbing'); tokens.dubbing = r.data.token;
    return row(PACKS.find((p) => p.id === 'dubbing'), { ready: r.data.ready, bytes: r.data.bytes, busy: r.data.busy, available: r.ok });
  }, PACKS.find((p) => p.id === 'dubbing'));
  await settle(async () => {
    const r = await get(url, '/freevideo/editor/subtitle-pack');
    const inst = r.data.install || {};
    return row(PACKS.find((p) => p.id === 'subtitle'), { ready: r.data.ready, available: r.data.supported !== false && r.data.published !== false,
      busy: inst.state === 'running', progress: inst.total ? { done: inst.done, total: inst.total } : null });
  }, PACKS.find((p) => p.id === 'subtitle'));
  await settle(async () => {
    const r = await get(url, '/freevideo/editor/music-pack');
    return row(PACKS.find((p) => p.id === 'music'), { ready: r.data.ready, bytes: r.data.bytes, available: r.ok,
      busy: r.data.state === 'running' || r.data.installing, progress: r.data.total ? { done: r.data.done, total: r.data.total } : null });
  }, PACKS.find((p) => p.id === 'music'));
  return out;
}

async function packAction(url, id, action = 'install') {
  const install = action !== 'cancel';
  if (id === 'image-h3' || id === 'image-qwen' || id === 'segment') {
    if (!tokens.image) tokens.image = (await get(url, '/freevideo/image-gen')).data.token;
    const route = id === 'segment' ? (install ? 'segment-install' : 'segment-cancel') : (install ? 'pack-install' : 'pack-cancel');
    const body = id === 'segment' ? {} : { model: id === 'image-h3' ? 'minimax-h3-image' : 'qwen-image-2.1-turbo' };
    return post(url, '/freevideo/image-gen/' + route, body, { 'X-FreeVideo-Image': tokens.image });
  }
  if (id === 'vlm') {
    if (!tokens.vlm) tokens.vlm = (await get(url, '/freevideo/prompt-vlm')).data.token;
    return post(url, '/freevideo/prompt-vlm/' + (install ? 'install' : 'cancel'), install ? { accept_download: true } : {}, { 'X-FreeVideo-Prompt': tokens.vlm });
  }
  if (id === 'dubbing') {
    if (!tokens.dubbing) tokens.dubbing = (await get(url, '/freevideo/dubbing')).data.token;
    return post(url, '/freevideo/dubbing/' + (install ? 'install' : 'cancel'), install ? { accept_download: true } : {}, { 'X-FreeVideo-Dubbing': tokens.dubbing });
  }
  if (id === 'subtitle') return post(url, '/freevideo/editor/subtitle-pack', { action: install ? 'install' : 'cancel', ...(install ? { language: true } : {}) });
  if (id === 'music') return post(url, '/freevideo/editor/music-pack', { action: install ? 'install' : 'cancel' });
  throw new Error('Gói không tồn tại: ' + id);
}

module.exports = { PACKS, packList, packAction };
