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
    // Ảnh đầu vào = 2 ô: [0] ảnh bắt đầu, [1] ảnh kết thúc (giống tạo video từ ảnh)
    state.images = [state.images[0] || null, state.images[1] || null];

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
        aiWriterRow([{ label: 'Viết lại', icon: 'auto_awesome', run: async (engine, btn) => {
          if (!state.prompt.trim()) { toast('Hãy viết vài ý tưởng trước', { kind: 'err' }); return; }
          const r = await engine.run('image', { text: state.prompt }, btn);
          if (!r || !r.prompt) return;
          state.prompt = LocalAI.oneLine(r.prompt).slice(0, 2000); prompt.value = state.prompt; counter.textContent = state.prompt.length + ' / 2000'; update();
          toast((engine === GPT ? 'ChatGPT' : 'AI trên máy') + ' đã viết lại mô tả', { kind: 'ok' });
        } }]),
        field('Gợi ý nhanh', ideas))));

    els.inputs = h('div', { class: 'small-slots' });
    renderInputs();
    left.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('compare'), h('h2', {}, 'Ảnh đầu vào'), h('span', { class: 'hint' }, 'giống tạo video từ ảnh — không bắt buộc')),
      h('div', { class: 'card-body' }, field(null, els.inputs, 'Ảnh bắt đầu là "image 1", ảnh kết thúc là "image 2" trong mô tả. Ví dụ: "Make image 1 look like the style of image 2".'))));

    els.people = h('div');
    left.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('photo_library'), h('h2', {}, 'Ảnh tham chiếu'), h('span', { class: 'hint' }, 'giữ đúng khuôn mặt, trang phục — tối đa 3')),
      h('div', { class: 'card-body' }, els.people)));
    drawPeople();
    loadPeople();
    readImagePacks();

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
    unsub = [App.on('jobs', showRecent), App.on('connection', () => { update(); if (App.connected && (!castList || castErr || !castList.length)) loadPeople(); })];
    document.addEventListener('keydown', onKey);
    setTimeout(() => prompt.focus(), 0);
  }

  function leave() { unsub.forEach((u) => u()); document.removeEventListener('keydown', onKey); cards.clear(); }
  function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }

  function renderInputs() {
    els.inputs.innerHTML = '';
    const slot = (i, title, desc, ic) => mediaSlot({ title, desc, iconName: ic, value: state.images[i],
      extra: () => h('span', { class: 'slot-kind' }, i ? 'kết thúc' : 'bắt đầu'),
      onChange: (v) => { state.images[i] = v || null; update(); } });
    els.inputs.append(slot(0, 'Ảnh bắt đầu', 'Ảnh gốc', 'first_page'), h('span', { class: 'ms arrow' }, 'arrow_forward'), slot(1, 'Ảnh kết thúc', 'Ảnh đích', 'last_page'));
  }

  // Gói mô hình ảnh đã tải: { h3, qwen }
  async function readImagePacks() {
    try {
      const r = await window.fv.engine.packs();
      const list = r.ok ? r.data : [];
      const ready = (id) => Boolean((list.find((x) => x.id === id) || {}).ready);
      state.packs = { h3: ready('image-h3'), qwen: ready('image-qwen'), known: r.ok };
    } catch { state.packs = { h3: false, qwen: false, known: false }; }
    update();
  }

  // Người trong ảnh: thẻ Nhân vật (cast) hoặc ảnh người tải lên trực tiếp. Tối đa 3.
  // state.people = [{ cast, name, pic } | { image, url, name }]
  let castList = null, castErr = null;
  async function loadPeople() {
    castErr = null;
    if (!App.connected) { castList = []; drawPeople(); return; }
    try {
      const all = await Promise.race([loadCast(), new Promise((_, no) => setTimeout(() => no(new Error('Engine không trả lời')), 15000))]);
      castList = all.filter((c) => c.kind === 'character');
    } catch (e) { castList = []; castErr = errorText(e); }
    // Thẻ được chọn từ trang Nhân vật (chỉ có id) → điền tên, ảnh
    state.people = state.people.map((p) => {
      if (typeof p !== 'string') return p;
      const c = castList.find((x) => x.id === p);
      return c ? { cast: c.id, name: c.name, pic: castPicture(c) } : null;
    }).filter(Boolean);
    drawPeople(); update();
  }

  function drawPeople() {
    els.people.innerHTML = '';
    const full = state.people.length >= 3;
    const hasFront = (c) => castImageCount(c) > 0;   // engine tự kiểm tra ảnh chính diện khi gửi
    // 1) Người đã chọn + ô thêm ảnh người
    const picked = h('div', { class: 'small-slots ref' });
    state.people.forEach((p, i) => {
      if (p.image) {
        picked.append(mediaSlot({ title: '', value: { file: p.image, url: p.url, kind: 'image', name: p.name },
          extra: () => h('span', { class: 'slot-kind' }, 'người ' + (i + 1)),
          onChange: (v) => { if (!v) { state.people.splice(i, 1); drawPeople(); update(); } } }));
      } else {
        picked.append(h('div', { class: 'slot filled' }, p.pic ? h('img', { src: mediaUrl(p.pic), alt: '' }) : icon('person'),
          h('span', { class: 'slot-name' }, p.name), h('span', { class: 'slot-kind' }, 'người ' + (i + 1)),
          h('button', { class: 'slot-x', title: 'Bỏ', onclick: () => { state.people.splice(i, 1); drawPeople(); update(); } }, icon('close', 'small'))));
      }
    });
    if (!full) {
      picked.append(mediaSlot({ title: 'Thêm ảnh người', desc: 'Ảnh rõ mặt, toàn thân càng tốt', iconName: 'person_add',
        onChange: (v) => { if (v) { state.people.push({ image: v.file, url: v.url, name: (v.name || 'Người ' + (state.people.length + 1)).replace(/\.[a-z0-9]+$/i, '').slice(0, 40) }); drawPeople(); update(); } } }));
    }
    els.people.append(field(null, picked));
    // 2) Chọn từ thẻ Nhân vật
    if (castList === null) els.people.append(h('div', { class: 'help' }, 'Đang đọc Kho ảnh tham chiếu…'));
    else if (castErr) els.people.append(h('div', { class: 'help', style: { color: 'var(--err)' } }, 'Không đọc được Kho ảnh tham chiếu: ' + castErr, ' ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); castList = null; drawPeople(); loadPeople(); } }, 'Thử lại')));
    else if (castList.length) {
      els.people.append(h('div', { class: 'label' }, 'Hoặc chọn từ Kho ảnh tham chiếu'), h('div', { class: 'cast-pick' }, castList.map((c) => {
        const on = state.people.some((p) => p.cast === c.id);
        if (!hasFront(c)) {
          return h('button', { class: 'cast-chip', type: 'button', style: { opacity: .55 }, title: 'Thẻ này chưa có ảnh chính diện',
            onclick: () => toast('Thẻ "' + c.name + '" chưa có ảnh', { kind: 'err', sub: 'Vào Kho ảnh tham chiếu → bấm "AI vẽ" hoặc thêm ảnh, đặt góc "Chính diện".',
              action: { label: 'Mở Nhân vật', run: () => navigate('cast') } }) },
            castPicture(c) ? h('img', { src: mediaUrl(castPicture(c)), alt: '' }) : icon('person'), h('span', {}, c.name + ' · chưa có ảnh'));
        }
        return h('button', { class: 'cast-chip' + (on ? ' on' : ''), type: 'button', onclick: () => {
          if (on) state.people = state.people.filter((p) => p.cast !== c.id);
          else if (state.people.length < 3) state.people.push({ cast: c.id, name: c.name, pic: castPicture(c) });
          else { toast('Tối đa 3 người', { kind: 'err' }); return; }
          drawPeople(); update();
        } }, castPicture(c) ? h('img', { src: mediaUrl(castPicture(c)), alt: '' }) : icon('person'), h('span', {}, c.name));
      })));
    } else {
      els.people.append(h('div', { class: 'help' }, 'Muốn giữ mặt nhân vật qua nhiều ảnh, video? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('cast'); } }, 'Thêm vào Kho ảnh tham chiếu'), '.'));
    }
    els.people.append(h('div', { class: 'help' }, 'Tối đa 3 người. Trong mô tả hãy nói ai đang làm gì, ở đâu (gọi theo tên). Dùng gói "Tạo ảnh nhanh" (Qwen). Không dùng cùng lúc với "Ảnh đầu vào".'));
  }

  function update() {
    if (!els.btn) return;
    els.tierField.classList.toggle('hidden', state.model === 'qwen-image-2.1-turbo');
    const pk = state.packs || {};
    const noModel = pk.known && !pk.h3 && !pk.qwen;
    const peopleNeedQwen = state.people.length && !state.images.some(Boolean) && pk.known && !pk.qwen;
    els.btn.disabled = !state.prompt.trim() || !App.connected || noModel || peopleNeedQwen;
    els.note.innerHTML = '';
    const goEngine = h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('engine'); } }, 'Mở Engine & mô hình');
    if (!App.connected) els.note.append(h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('link_off'), 'Engine chưa chạy.'));
    else if (noModel) els.note.append(h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('deployed_code'),
      h('div', {}, 'Mô hình tạo ảnh đang được tải tự động (chỉ lần đầu). Xem tiến độ ở góc trên bên phải — xong là tạo được ngay.')));
    else if (peopleNeedQwen) els.note.append(h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('groups'),
      h('div', {}, 'Ảnh tham chiếu cần mô hình "Tạo ảnh nhanh" (Qwen) — đang được tải tự động, xong là dùng được ngay.')));
    else els.note.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('info'),
      h('div', {}, state.images.some(Boolean) ? 'Tạo ảnh từ ' + state.images.filter(Boolean).length + ' ảnh đầu vào theo mô tả.' : 'Tạo ' + state.count + ' ảnh mới từ mô tả.',
        h('div', { class: 'small-text' }, 'Ảnh chạy sau video nếu GPU đang bận.'))));
  }

  function buildSpec(seedOffset) {
    const spec = { kind: 'image', prompt: state.prompt.trim(), aspect: state.aspect, label: labelFrom(state.prompt) };
    if (state.model) spec.model = state.model;
    if (state.model !== 'qwen-image-2.1-turbo') spec.tier = state.tier;
    if (!state.seedRandom) spec.seed = (Number(state.seed) || 0) + seedOffset;
    if (state.images.some(Boolean)) { spec.images = state.images.filter(Boolean).map((i) => i.file); delete spec.aspect; delete spec.tier; }
    else if (state.people.length) {
      // Ghép nhân vật chỉ chạy với Qwen Image; khung hình theo kích thước bội số 32, tối đa 2048.
      spec.people = state.people.map((p) => (p.cast ? { cast: p.cast } : { image: p.image, name: p.name }));
      spec.model = 'qwen-image-2.1-turbo';
      delete spec.tier;
    }
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
