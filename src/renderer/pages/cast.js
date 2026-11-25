'use strict';
/* Trang Nhân vật: thư viện thẻ nhân vật / bối cảnh / đạo cụ, dùng lại trong Tạo ảnh và Autopilot. */

const CAST_KINDS = { character: ['Nhân vật', 'person'], setting: ['Bối cảnh', 'landscape'], prop: ['Đạo cụ', 'category'] };
const CAST_LABELS = [['front', 'Chính diện'], ['three_quarter', 'Nghiêng 3/4'], ['side', 'Nghiêng'], ['back', 'Sau lưng'], ['face', 'Cận mặt'], ['other', 'Khác']];

// Đọc thư viện nhân vật (dùng chung cho các trang khác)
async function loadCast() {
  const r = await api('GET', '/cast?limit=200');
  return r.cards || r.items || [];
}
// Danh sách của engine chỉ có số ảnh (images: số) và 1 ảnh đại diện (thumbnail); thẻ đầy đủ (GET /cast/{id}) mới có mảng ảnh.
const castPicture = (card) => {
  if (card.thumbnail && card.thumbnail.url) return card.thumbnail.url;
  const list = Array.isArray(card.images) ? card.images : [];
  const img = list.find((i) => i.label === 'face') || list.find((i) => i.label === 'front') || list[0] || (Array.isArray(card.candidates) ? card.candidates[0] : null);
  return img && img.media ? img.media.url : null;
};
const castImageCount = (card) => (Array.isArray(card.images) ? card.images.length : Number(card.images) || 0);
async function castCard(id) { const r = await api('GET', '/cast/' + id); return r.card || r; }

registerPage('cast', (() => {
  let els = {}, cards = [], filter = 'all', timer = null;

  function render(root) {
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Kho ảnh tham chiếu'), h('div', { class: 'sub' }, 'Lưu ảnh tham chiếu cho nhân vật, bối cảnh, đạo cụ một lần — dùng lại để giữ đúng khuôn mặt, trang phục trong ảnh và phim Autopilot.')),
      h('button', { class: 'btn btn-primary', onclick: () => openEditor() }, icon('add_photo_alternate'), 'Thêm vào kho')));
    els.tabs = chipGroup([{ value: 'all', label: 'Tất cả' }, ...Object.entries(CAST_KINDS).map(([value, [label, ic]]) => ({ value, label, icon: ic }))],
      filter, (v) => { filter = v; draw(); });
    els.grid = h('div', { class: 'cast-grid' });
    els.note = h('div');
    page.append(els.note, h('div', { class: 'row', style: { marginBottom: '12px' } }, els.tabs), els.grid);
    root.append(page);
    refresh();
  }
  function leave() { clearTimeout(timer); }

  async function refresh() {
    clearTimeout(timer);
    els.note.innerHTML = '';
    if (!App.connected) { els.note.append(engineOffNotice()); els.grid.innerHTML = ''; timer = setTimeout(refresh, 4000); return; }
    try { cards = await loadCast(); } catch (e) { els.note.append(h('div', { class: 'notice err' }, icon('error'), errorText(e))); }
    draw();
    if (cards.some((c) => c.generating)) timer = setTimeout(refresh, 3000);
  }

  function draw() {
    els.grid.innerHTML = '';
    const list = cards.filter((c) => filter === 'all' || c.kind === filter);
    if (!list.length) {
      els.grid.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, icon('groups'), h('h3', {}, 'Chưa có thẻ nào'),
        h('div', {}, 'Thêm nhân vật bằng ảnh có sẵn, hoặc chỉ mô tả rồi để AI vẽ ảnh tham chiếu.'),
        h('button', { class: 'btn btn-primary mt', onclick: () => openEditor() }, icon('person_add'), 'Thêm nhân vật')));
      return;
    }
    for (const c of list) {
      const pic = castPicture(c);
      const [kindLabel, kindIcon] = CAST_KINDS[c.kind] || ['Ảnh', 'image'];
      els.grid.append(h('div', { class: 'cast-card' },
        h('div', { class: 'pic', onclick: () => openEditor(c) }, pic ? h('img', { src: mediaUrl(pic), alt: '' }) : icon(kindIcon, 'big'),
          c.generating ? h('div', { class: 'busy' }, icon('progress_activity', 'spin'), 'AI đang vẽ…') : null,
          h('span', { class: 'kind' }, kindLabel)),
        h('div', { class: 'meta' }, h('b', {}, c.name), h('div', { class: 'small-text muted clamp2' }, c.description || (castImageCount(c) + ' ảnh tham chiếu')),
          c.voice ? h('span', { class: 'pill', style: { marginTop: '6px' } }, icon('graphic_eq', 'small'), 'Có giọng') : null),
        h('div', { class: 'acts' },
          h('button', { class: 'btn btn-text', onclick: () => openEditor(c) }, icon('edit'), 'Sửa'),
          c.kind === 'character' ? h('button', { class: 'btn btn-text', onclick: () => { App.handoff = { page: 'image', state: { people: [c.id] } }; navigate('image'); } }, icon('image'), 'Tạo ảnh') : null,
          h('button', { class: 'btn btn-text', title: 'AI vẽ thêm ảnh tham chiếu từ mô tả', onclick: () => generate(c) }, icon('auto_awesome'), 'AI vẽ'))));
    }
  }

  async function generate(c, replace = false) {
    if (!c.description && !castImageCount(c)) { toast('Hãy thêm mô tả trước để AI biết vẽ gì', { kind: 'err' }); return; }
    try {
      await api('POST', '/cast/' + c.id + '/generate', { face: c.kind === 'character', replace, revision: c.revision });
      toast('AI đang vẽ ảnh tham chiếu cho ' + c.name, { kind: 'ok', sub: 'Chạy trên GPU, mất khoảng 1–3 phút.' });
      Poller.soon(); setTimeout(refresh, 800);
    } catch (e) { toastError(e, 'Không vẽ được'); }
  }

  async function openEditor(row) {
    let card = row;
    if (row && !Array.isArray(row.images)) {
      try { card = await castCard(row.id); } catch (e) { toastError(e, 'Không mở được thẻ'); return; }
    }
    const v = { kind: card ? card.kind : 'character', name: card ? card.name : '', description: card ? card.description || '' : '',
      images: card ? (card.images || []).map((i) => ({ file: i.media.file, url: i.media.url, kind: 'image', label: i.label || 'other', name: (CAST_LABELS.find(([v]) => v === i.label) || [0, 'Ảnh'])[1] })) : [],
      voice: card && card.voice && card.voice.media ? { file: card.voice.media.file, url: card.voice.media.url, kind: 'audio', name: 'Giọng mẫu' } : null };
    const slots = h('div', { class: 'slots' });
    const drawSlots = () => {
      slots.innerHTML = '';
      v.images.forEach((img, i) => {
        const label = h('select', { class: 'select mini', onclick: (e) => e.stopPropagation(), onchange: (e) => { img.label = e.target.value; } },
          CAST_LABELS.map(([val, l]) => h('option', { value: val, selected: val === img.label }, l)));
        slots.append(mediaSlot({ title: '', value: img, extra: () => label, onChange: (x) => { if (!x) { v.images.splice(i, 1); drawSlots(); } } }));
      });
      if (v.images.length < 6) slots.append(mediaSlot({ title: 'Thêm ảnh', onChange: (x) => { if (x) { v.images.push({ ...x, label: v.images.length ? 'other' : 'front' }); drawSlots(); } } }));
    };
    drawSlots();
    const name = h('input', { class: 'input', value: v.name, maxlength: 120, placeholder: 'Ví dụ: Lan, Ông Ba, Quán cà phê góc phố…', oninput: (e) => { v.name = e.target.value; } });
    const desc = h('textarea', { class: 'textarea', maxlength: 1000, placeholder: 'Ví dụ: Vietnamese woman, 25, long black hair, white áo dài, gentle smile.', oninput: (e) => { v.description = e.target.value; } });
    desc.value = v.description;
    const voice = mediaSlot({ title: 'Giọng mẫu', desc: 'File ghi âm 5–15 giây (không bắt buộc)', kinds: ['audio', 'video'], iconName: 'mic', value: v.voice, onChange: (x) => { v.voice = x; } });
    voice.style.maxWidth = '260px';
    const save = h('button', { class: 'btn btn-primary', onclick: async () => {
      if (!v.name.trim()) { toast('Hãy đặt tên', { kind: 'err' }); return; }
      save.disabled = true;
      const body = { kind: v.kind, name: v.name.trim(), description: v.description.trim() || null,
        images: v.images.map((i) => ({ media: { file: i.file }, label: i.label || 'other' })), voice: v.voice ? { media: { file: v.voice.file } } : null };
      try {
        let saved;
        if (card) saved = await api('PATCH', '/cast/' + card.id, { ...body, revision: card.revision });
        else saved = await api('POST', '/cast', body);
        saved = saved.card || saved;
        closeModal();
        toast(card ? 'Đã lưu ' + body.name : 'Đã thêm ' + body.name, { kind: 'ok' });
        if (!card && !body.images.length && body.description) generate(saved);
        refresh();
      } catch (e) { toastError(e, 'Không lưu được'); save.disabled = false; }
    } }, icon('save'), card ? 'Lưu' : 'Thêm');
    openModal([modalHead(card ? 'Sửa: ' + card.name : 'Thêm nhân vật / bối cảnh', 'person_add'),
      field('Loại', segmented(Object.entries(CAST_KINDS).map(([value, [label]]) => ({ value, label })), v.kind, (x) => { v.kind = x; })),
      field('Tên', name), field('Mô tả ngoại hình', desc, 'Tiếng Anh cho kết quả tốt nhất. Không có ảnh thì AI vẽ ảnh tham chiếu từ mô tả này.', true),
      field('Ảnh tham chiếu', slots, 'Tối đa 6 ảnh rõ mặt/rõ vật, nền đơn giản. Chọn góc chụp cho từng ảnh.', true),
      field('Giọng nói', voice, 'Dùng khi nhân vật nói trong phim Autopilot.', true),
      h('div', { class: 'foot' },
        card ? h('button', { class: 'btn btn-text btn-danger', style: { marginRight: 'auto' }, onclick: async () => {
          if (!confirm('Xoá thẻ "' + card.name + '"? Không hoàn tác được.')) return;
          try { await api('DELETE', '/cast/' + card.id); closeModal(); toast('Đã xoá ' + card.name); refresh(); } catch (e) { toastError(e, 'Không xoá được'); }
        } }, icon('delete'), 'Xoá') : null,
        h('button', { class: 'btn', onclick: closeModal }, 'Huỷ'), save)], { wide: true });
    setTimeout(() => name.focus(), 0);
  }

  return { render, leave };
})());
