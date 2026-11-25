'use strict';
/* Trang Tạo ảnh */

const IMAGE_ASPECTS = [['1:1', 'Vuông 1:1'], ['16:9', 'Ngang 16:9'], ['9:16', 'Dọc 9:16'], ['4:3', '4:3'], ['3:4', '3:4']];
const IMAGE_IDEAS = [
  { label: 'Chân dung điện ảnh', prompt: 'Cinematic portrait of an elderly Vietnamese fisherman at dawn, weathered face, soft golden side light, shallow depth of field, 85mm photo, highly detailed.' },
  { label: 'Poster sản phẩm', prompt: 'Minimal product poster: a glass bottle of iced coffee with condensation on a sandstone pedestal, warm beige background, soft shadows, premium advertising photo.' },
  { label: 'Phong cảnh fantasy', prompt: 'A floating island with waterfalls pouring into clouds, ancient pagoda on top, sunrise light, epic fantasy concept art, wide shot.' },
  { label: 'Nhân vật hoạt hình', prompt: '3D stylized character sheet of a cheerful young girl in a yellow raincoat with a corgi, front view, clean white background, soft studio lighting.' },
];

registerPage('image', (() => {
  let unsub = [];
  let state;
  const els = {};
  const cards = new Map();

  function render(root) {
    state = {
      prompt: '', aspect: pref('imageAspect', '1:1'), tier: pref('imageTier', 'standard'), model: pref('imageModel', ''),
      count: 1, seedRandom: true, seed: 0, images: [], people: [],
    };
    if (App.handoff && App.handoff.page === 'image') { Object.assign(state, App.handoff.state || {}); App.handoff = null; }

    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Tạo ảnh'), h('div', { class: 'sub' }, 'Tạo ảnh từ mô tả, hoặc sửa/kết hợp ảnh có sẵn. Ảnh tạo ra có thể dùng làm khung hình đầu cho video.'))));
    const left = h('div');
    const right = h('div', { class: 'sticky-col' });
    page.append(h('div', { class: 'layout-2' }, left, right));

    const prompt = h('textarea', { class: 'textarea big', placeholder: 'Ví dụ: A cozy coffee shop in Da Lat on a rainy morning, warm light, film photo…',
      oninput: (e) => { state.prompt = e.target.value; counter.textContent = e.target.value.length + ' / 2000'; update(); } });
    prompt.value = state.prompt;
    const counter = h('div', { class: 'counter' }, state.prompt.length + ' / 2000');
    const ideas = h('div', { class: 'chips' }, IMAGE_IDEAS.map((idea) => h('button', { class: 'chip suggest', type: 'button',
      onclick: () => { state.prompt = idea.prompt; prompt.value = idea.prompt; counter.textContent = idea.prompt.length + ' / 2000'; update(); } }, icon('lightbulb', 'small'), idea.label)));
    left.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Mô tả ảnh')),
      h('div', { class: 'card-body' }, field(null, h('div', {}, prompt, counter), 'Viết tiếng Anh cho kết quả tốt nhất. Chữ muốn hiện trong ảnh đặt trong ngoặc kép.'),
        field('Gợi ý nhanh', ideas))));

    els.inputs = h('div', { class: 'slots' });
    renderInputs();
    left.append(h('details', { class: 'card', open: state.images.length > 0 },
      h('summary', { class: 'card-head' }, icon('photo_library'), h('h2', {}, 'Ảnh đầu vào'), h('span', { class: 'hint' }, 'để sửa hoặc kết hợp — không bắt buộc'),
        h('div', { class: 'grow' }), icon('expand_more', 'chev')),
      h('div', { class: 'card-body' }, field(null, els.inputs, 'Tối đa 4 ảnh. Trong prompt gọi chúng là "image 1", "image 2"… Ví dụ: "Put the person in image 1 into the scene of image 2".'))));

    els.people = h('div');
    left.append(h('details', { class: 'card', open: state.people.length > 0 },
      h('summary', { class: 'card-head' }, icon('groups'), h('h2', {}, 'Nhân vật trong ảnh'), h('span', { class: 'hint' }, 'giữ đúng khuôn mặt từ thẻ Nhân vật — không bắt buộc'),
        h('div', { class: 'grow' }), icon('expand_more', 'chev')),
      h('div', { class: 'card-body' }, els.people)));
    drawPeople();

    const modelSelect = h('select', { class: 'select', onchange: (e) => { state.model = e.target.value; setPref('imageModel', state.model); update(); } },
      h('option', { value: '' }, 'Tự động (model đã cài)'),
      h('option', { value: 'minimax-h3-image' }, 'MiniMax H3 Image — chất lượng cao, tới 16 MP'),
      h('option', { value: 'qwen-image-2.1-turbo' }, 'Qwen Image 2.1 Turbo — nhanh (chỉ dùng phi thương mại)'));
    modelSelect.value = state.model;
    els.tier = segmented([{ value: 'standard', label: 'Tiêu chuẩn', desc: '~4 MP' }, { value: 'high', label: 'Cao', desc: '~16 MP, lâu hơn' }],
      state.tier, (v) => { state.tier = v; setPref('imageTier', v); });
    const seedInput = h('input', { class: 'input num', type: 'number', value: state.seed, disabled: state.seedRandom, onchange: (e) => { state.seed = e.target.value; } });
    left.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('tune'), h('h2', {}, 'Cài đặt')),
      h('div', { class: 'card-body' },
        field('Khung hình', chipGroup(IMAGE_ASPECTS.map(([value, label]) => ({ value, label, ratio: value })), state.aspect, (v) => { state.aspect = v; setPref('imageAspect', v); })),
        field('Model', modelSelect),
        els.tierField = field('Độ phân giải (H3 Image)', els.tier),
        field('Số ảnh', chipGroup([1, 2, 3, 4].map((n) => ({ value: n, label: n + ' ảnh' })), state.count, (v) => { state.count = v; update(); })),
        field('Seed', h('div', { class: 'row' }, switchToggle('Ngẫu nhiên', null, state.seedRandom, (v) => { state.seedRandom = v; seedInput.disabled = v; }), seedInput)))));

    els.btn = h('button', { class: 'btn btn-primary btn-hero', onclick: submit }, icon('image'), 'Tạo ảnh', h('span', { class: 'kbd' }, 'Ctrl ↵'));
    els.note = h('div');
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } }, h('div', { class: 'card-body' }, els.note, h('div', { class: 'mt' }, els.btn), aiLabelNote())));
    els.results = h('div');
    right.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Ảnh gần đây')), h('div', { class: 'card-body' }, els.results)));

    root.append(page);
    update();
    showRecent(App.jobs);
    unsub = [App.on('jobs', showRecent), App.on('connection', update)];
    document.addEventListener('keydown', onKey);
    setTimeout(() => prompt.focus(), 0);
  }

  function leave() { unsub.forEach((u) => u()); document.removeEventListener('keydown', onKey); cards.clear(); }
  function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }

  function renderInputs() {
    els.inputs.innerHTML = '';
    state.images.forEach((img, i) => els.inputs.append(mediaSlot({ title: '', value: img,
      extra: () => h('span', { class: 'slot-kind' }, 'image ' + (i + 1)),
      onChange: (v) => { if (!v) { state.images.splice(i, 1); renderInputs(); update(); } } })));
    if (state.images.length < 4) {
      els.inputs.append(mediaSlot({ title: 'Thêm ảnh', iconName: 'add_photo_alternate', onChange: (v) => { if (v) { state.images.push(v); renderInputs(); update(); } } }));
    }
  }

  async function drawPeople() {
    els.people.innerHTML = '';
    let list = [];
    try { list = App.connected ? (await loadCast()).filter((c) => c.kind === 'character') : []; } catch { list = []; }
    if (!list.length) {
      els.people.append(h('div', { class: 'help' }, 'Chưa có nhân vật. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('cast'); } }, 'Tạo thẻ nhân vật'), ' rồi chọn ở đây (tối đa 3 người).'));
      return;
    }
    els.people.append(h('div', { class: 'cast-pick' }, list.map((c) => {
      const on = state.people.includes(c.id);
      return h('button', { class: 'cast-chip' + (on ? ' on' : ''), type: 'button', onclick: () => {
        if (on) state.people = state.people.filter((x) => x !== c.id);
        else if (state.people.length < 3) state.people.push(c.id); else { toast('Tối đa 3 nhân vật', { kind: 'err' }); return; }
        drawPeople(); update();
      } }, castPicture(c) ? h('img', { src: mediaUrl(castPicture(c)), alt: '' }) : icon('person'), h('span', {}, c.name));
    })), h('div', { class: 'help' }, 'Trong mô tả hãy nói ai đang làm gì, ở đâu. Không dùng cùng lúc với "Ảnh đầu vào".'));
  }

  function update() {
    if (!els.btn) return;
    els.tierField.classList.toggle('hidden', state.model === 'qwen-image-2.1-turbo');
    els.btn.disabled = !state.prompt.trim() || !App.connected;
    els.note.innerHTML = '';
    if (!App.connected) els.note.append(h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('link_off'), 'Engine chưa chạy.'));
    else els.note.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('info'),
      h('div', {}, state.images.length ? 'Sửa/kết hợp ' + state.images.length + ' ảnh theo mô tả.' : 'Tạo ' + state.count + ' ảnh mới từ mô tả.',
        h('div', { class: 'small-text' }, 'Ảnh chạy sau video nếu GPU đang bận.'))));
  }

  function buildSpec(seedOffset) {
    const spec = { kind: 'image', prompt: state.prompt.trim(), aspect: state.aspect, label: labelFrom(state.prompt) };
    if (state.model) spec.model = state.model;
    if (state.model !== 'qwen-image-2.1-turbo') spec.tier = state.tier;
    if (!state.seedRandom) spec.seed = (Number(state.seed) || 0) + seedOffset;
    if (state.images.length) { spec.images = state.images.map((i) => i.file); delete spec.aspect; delete spec.tier; }
    else if (state.people.length) spec.people = state.people.map((id) => ({ cast: id }));
    return spec;
  }

  async function submit() {
    if (!state.prompt.trim()) { toast('Hãy nhập mô tả ảnh', { kind: 'err' }); return; }
    els.btn.disabled = true;
    try {
      const specs = Array.from({ length: state.count }, (_, i) => buildSpec(i));
      const reply = specs.length > 1 ? await api('POST', '/jobs', { jobs: specs }) : await api('POST', '/jobs', specs[0]);
      const jobs = reply.jobs || [reply.job];
      toast('Đã gửi ' + jobs.length + ' ảnh vào hàng đợi', { kind: 'ok' });
      jobs.slice().reverse().forEach((j) => addCard(j, true));
      Poller.soon(500);
    } catch (error) {
      toastError(error, 'Không gửi được');
    } finally { update(); }
  }

  function addCard(job, prepend) {
    if (cards.has(job.id)) { cards.get(job.id).update(job); return; }
    const card = jobCard(job, { onUseImage: useForVideo, onReuse: reuse });
    cards.set(job.id, card);
    const empty = els.results.querySelector('.empty');
    if (empty) empty.remove();
    if (prepend) els.results.prepend(card); else els.results.append(card);
  }
  function showRecent(jobs) {
    for (const job of (jobs || []).filter((j) => j.kind === 'image').slice(0, 8)) addCard(job, false);
    for (const job of jobs || []) if (cards.has(job.id)) cards.get(job.id).update(job);
    if (!cards.size && !els.results.querySelector('.empty')) {
      els.results.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('image'), h('div', { class: 'small-text' }, 'Ảnh bạn tạo sẽ hiện ở đây')));
    }
  }
  function useForVideo(job, img) {
    App.handoff = { page: 'video', first: { file: img.file, url: img.url, kind: 'image', name: 'Ảnh ' + job.id } };
    navigate('video');
  }
  async function reuse(job) {
    try {
      const spec = (await jobDetail(job.id)).spec || {};
      App.handoff = { page: 'image', state: { prompt: spec.prompt || '', aspect: spec.aspect || '1:1', model: spec.model || '', tier: spec.tier || 'standard',
        ...(spec.seed !== undefined && spec.seed !== null ? { seedRandom: false, seed: spec.seed } : {}) } };
      navigate('image');
    } catch (e) { toastError(e); }
  }

  return { render, leave };
})());
