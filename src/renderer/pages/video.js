'use strict';
/* Trang Tạo video */

const QUALITY_TEXT = {
  light: ['Nhanh', 'Light · thử ý tưởng'], medium: ['Cân bằng', 'Medium'],
  high: ['Cao', 'High · chi tiết hơn'], max: ['Tối đa', 'Max · lâu nhất'],
};
const VIDEO_ASPECTS = [
  ['16:9', 'Ngang 16:9'], ['9:16', 'Dọc 9:16'], ['1:1', 'Vuông 1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['21:9', 'Điện ảnh 21:9'],
];
const VIDEO_IDEAS = [
  { label: 'Phố đêm mưa', visual: 'Live-action, cinematic. A slow tracking shot follows a young woman with a red umbrella walking through a neon-lit Saigon alley at night after rain; reflections shimmer on the wet pavement and steam rises from a street food stall.', sound: 'Light rain dripping from awnings, distant motorbikes, sizzling food, soft footsteps on wet ground.', music: 'Mellow lo-fi piano with a soft beat, slow tempo.' },
  { label: 'Sản phẩm xoay 360°', visual: 'Studio product shot, photorealistic. A matte black wireless headphone rotates slowly on a glossy turntable against a soft gradient background; a rim light sweeps across its curves. Static camera, shallow depth of field.', sound: 'Quiet studio room tone, a faint mechanical hum of the turntable.', music: 'Minimal electronic pulse, clean and modern.' },
  { label: 'Drone ruộng bậc thang', visual: 'Aerial drone shot, golden hour. The camera glides forward over terraced rice fields in Mu Cang Chai, then rises slowly to reveal misty mountains and a small village with smoke from wooden houses.', sound: 'Wind over the fields, distant birds, a faint rooster call.', music: 'Warm orchestral strings with a gentle flute melody, building slowly.' },
  { label: 'Hoạt hình dễ thương', visual: '3D animated, Pixar-like style. A small round orange cat in a tiny astronaut suit floats inside a cozy spaceship, reaches for a floating fish-shaped cookie and giggles; soft colorful lighting, slow push in.', sound: 'Soft spaceship hum, playful floating whooshes, a small happy giggle.', music: 'Playful glockenspiel and pizzicato strings, light and bouncy.' },
];

registerPage('video', (() => {
  let unsub = [];
  let state;
  const els = {};
  let planTimer = null;
  let planSeq = 0;
  const cards = new Map();

  function defaults() {
    return {
      mode: pref('videoMode', 'simple'), visual: '', sound: '', music: '', raw: '',
      aspect: pref('videoAspect', '16:9'), seconds: pref('videoSeconds', 10), quality: pref('videoQuality', 'light'),
      takes: 1, seedRandom: true, seed: 0, preview: false,
      first: null, last: null, references: [], loras: [], continueFrom: null, firstFrameReference: false,
    };
  }

  function composedPrompt() {
    if (state.mode === 'raw') return state.raw.trim();
    if (!state.visual.trim()) return '';
    return [
      'integrated_multimodal_description: ' + state.visual.trim(),
      'overall_soundscape: ' + (state.sound.trim() || 'N/A'),
      'non_diegetic_music: ' + (state.music.trim() || 'N/A'),
    ].join('\n\n');
  }

  function buildSpec() {
    const spec = { kind: 'generate', prompt: composedPrompt(), aspect: state.aspect, seconds: Number(state.seconds), quality: state.quality };
    spec.label = labelFrom(state.mode === 'raw' ? state.raw : state.visual) || undefined;
    if (!state.seedRandom) spec.seed = Number(state.seed) || 0;
    if (state.preview) spec.preview = true;
    if (state.takes > 1) spec.takes = state.takes;
    const media = {};
    if (state.first) media.first = { file: state.first.file };
    if (state.last) media.last = { file: state.last.file };
    if (state.references.length) media.references = state.references.map((r) => ({ file: r.file }));
    if (Object.keys(media).length) spec.media = media;
    if (state.loras.length) spec.loras = state.loras.map((l) => ({ name: l.name, strength: Number(l.strength) }));
    if (state.continueFrom) {
      spec.continue_from = state.continueFrom.value;
      if (state.firstFrameReference) spec.first_frame_reference = true;
    }
    return spec;
  }

  /* ---------- Bố cục ---------- */
  function render(root, params) {
    state = defaults();
    if (App.handoff && App.handoff.page === 'video') { applyHandoff(App.handoff); App.handoff = null; }
    const caps = App.caps || {};
    const maxSeconds = (caps.limits && caps.limits.seconds && caps.limits.seconds[1]) || 20;

    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Tạo video'), h('div', { class: 'sub' }, 'Mô tả cảnh bạn muốn, chọn khung hình và bấm Tạo. Video có cả âm thanh.')),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-text', onclick: resetForm }, icon('restart_alt'), 'Làm mới')));

    const left = h('div');
    const right = h('div', { class: 'sticky-col' });
    page.append(h('div', { class: 'layout-2' }, left, right));

    /* Prompt */
    els.continueBanner = h('div');
    els.promptBody = h('div', { class: 'card-body' });
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: 'tab', 'data-mode': 'simple', onclick: () => setMode('simple') }, 'Đơn giản'),
      h('button', { class: 'tab', 'data-mode': 'raw', onclick: () => setMode('raw') }, 'Prompt đầy đủ'));
    els.tabs = tabs;
    els.enhanceBtn = h('button', { class: 'btn btn-outline', onclick: enhancePrompt, title: 'Dùng AI chạy trên máy viết lại thành prompt chi tiết' },
      icon('auto_awesome'), 'Viết lại bằng AI');
    left.append(els.continueBanner, h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Mô tả video'), h('div', { class: 'grow' }), els.enhanceBtn),
      tabs, els.promptBody));
    renderPromptBody();

    /* Khung hình & tham chiếu */
    const slots = h('div', { class: 'slots' });
    els.firstSlot = mediaSlot({ title: 'Khung hình đầu', desc: 'Video bắt đầu từ ảnh này', value: state.first, iconName: 'first_page', onChange: (v) => { state.first = v; schedulePlan(); } });
    els.lastSlot = mediaSlot({ title: 'Khung hình cuối', desc: 'Video kết thúc ở ảnh này', value: state.last, iconName: 'last_page', onChange: (v) => { state.last = v; schedulePlan(); } });
    slots.append(els.firstSlot, els.lastSlot);
    els.refs = h('div', { class: 'slots mt' });
    renderRefs();
    left.append(h('details', { class: 'card', open: Boolean(state.first || state.last || state.references.length) },
      h('summary', { class: 'card-head' }, icon('photo_library'), h('h2', {}, 'Ảnh & tham chiếu'),
        h('span', { class: 'hint' }, 'không bắt buộc'), h('div', { class: 'grow' }), icon('expand_more', 'chev')),
      h('div', { class: 'card-body' },
        field('Khung hình', slots, 'Đặt ảnh đầu và/hoặc cuối để kiểm soát chính xác bố cục. Có thể tạo ảnh ở trang Tạo ảnh rồi dùng ở đây.'),
        field('Tham chiếu (ảnh, video, âm thanh)', els.refs, 'Dùng để giữ nhân vật, phong cách hoặc giọng nói. Tính năng thử nghiệm — prompt nên viết ở chế độ đầy đủ hoặc bấm "Viết lại bằng AI".'))));

    /* Cài đặt */
    els.duration = slider({ min: 2, max: maxSeconds, step: 1, value: Math.min(state.seconds, maxSeconds), suffix: 'giây', onChange: (v) => { state.seconds = v; setPref('videoSeconds', v); schedulePlan(); } });
    const durationPresets = chipGroup([5, 10, 15, 20].filter((s) => s <= maxSeconds).map((s) => ({ value: s, label: s + ' giây' })), null,
      (v) => { state.seconds = v; els.duration.setValue(v); setPref('videoSeconds', v); schedulePlan(); });
    els.quality = segmented(Object.keys(caps.quality || QUALITY_TEXT).map((q) => ({ value: q, label: (QUALITY_TEXT[q] || [q])[0], desc: (QUALITY_TEXT[q] || [])[1] })),
      state.quality, (v) => { state.quality = v; setPref('videoQuality', v); schedulePlan(); });
    els.aspect = chipGroup(VIDEO_ASPECTS.map(([value, label]) => ({ value, label, ratio: value })), state.aspect,
      (v) => { state.aspect = v; setPref('videoAspect', v); schedulePlan(); });
    left.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('tune'), h('h2', {}, 'Cài đặt')),
      h('div', { class: 'card-body' },
        field('Khung hình', els.aspect),
        field('Thời lượng', h('div', {}, els.duration, h('div', { class: 'mt' }, durationPresets)),
          'Video dài hơn 15 giây sẽ được tạo thành nhiều phần rồi tự ghép lại (thử nghiệm).'),
        field('Chất lượng', els.quality, 'Mức cao hơn đẹp hơn nhưng lâu hơn. Nên thử ý tưởng ở mức Nhanh trước.'))));

    /* Nâng cao */
    const seedInput = h('input', { class: 'input num', type: 'number', min: 0, value: state.seed, disabled: state.seedRandom, onchange: (e) => { state.seed = e.target.value; schedulePlan(); } });
    const takes = chipGroup([1, 2, 3, 4].map((n) => ({ value: n, label: n + ' bản' })), state.takes, (v) => { state.takes = v; schedulePlan(); });
    els.previewSwitch = switchToggle('Xem trước nhanh', 'Tạo bản nửa độ phân giải trước; bản nào ưng mới "Hoàn thiện" (chỉ với mức chất lượng có 2 lượt).',
      state.preview, (v) => { state.preview = v; schedulePlan(); });
    els.loras = h('div');
    renderLoras();
    left.append(h('details', { class: 'card' },
      h('summary', { class: 'card-head' }, icon('science'), h('h2', {}, 'Nâng cao'), h('div', { class: 'grow' }), icon('expand_more', 'chev')),
      h('div', { class: 'card-body' },
        field('Số bản tạo cùng lúc', takes, 'Mỗi bản dùng seed khác nhau để bạn chọn bản đẹp nhất.'),
        field('Seed', h('div', { class: 'row' },
          switchToggle('Ngẫu nhiên', null, state.seedRandom, (v) => { state.seedRandom = v; seedInput.disabled = v; schedulePlan(); }), seedInput),
          'Giữ cùng seed + cùng prompt để tạo lại đúng kết quả.'),
        field(null, els.previewSwitch),
        field('LoRA', els.loras, 'Thêm phong cách/nhân vật từ LoRA cộng đồng cho MiniMax H3.'))));

    /* Cột phải: tóm tắt + nút tạo + kết quả */
    els.summary = h('div', { class: 'card-body' });
    els.generateBtn = h('button', { class: 'btn btn-primary btn-hero', onclick: submit }, icon('movie'), 'Tạo video', h('span', { class: 'kbd' }, 'Ctrl ↵'));
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } },
      h('div', { class: 'card-head' }, h('h2', {}, 'Tóm tắt')), els.summary,
      h('div', { class: 'card-foot', style: { display: 'block' } }, els.generateBtn)));
    els.results = h('div');
    right.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Kết quả gần đây'), h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-text', onclick: () => navigate('library') }, 'Thư viện')), h('div', { class: 'card-body' }, els.results)));

    root.append(page);
    renderContinue();
    updateEnhance();
    renderSummary();
    showRecent(App.jobs);
    schedulePlan(10);

    unsub = [
      App.on('jobs', showRecent),
      App.on('caps', () => { updateEnhance(); renderLoras(); if (App.caps.limits) els.duration.setMax(App.caps.limits.seconds[1]); schedulePlan(); }),
      App.on('connection', () => schedulePlan()),
    ];
    document.addEventListener('keydown', onKey);
  }

  function leave() {
    unsub.forEach((u) => u());
    document.removeEventListener('keydown', onKey);
    clearTimeout(planTimer);
    cards.clear();
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    if (mode === 'raw' && !state.raw.trim()) state.raw = composedPrompt();
    state.mode = mode;
    setPref('videoMode', mode);
    renderPromptBody();
    schedulePlan();
  }

  function renderPromptBody() {
    els.tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.mode === state.mode));
    const body = els.promptBody;
    body.innerHTML = '';
    if (state.mode === 'simple') {
      const visual = h('textarea', { class: 'textarea big', placeholder: 'Ví dụ: A slow tracking shot follows a girl in áo dài walking through Hoi An at night, lanterns glowing…', oninput: (e) => { state.visual = e.target.value; counter.textContent = e.target.value.length + ' ký tự'; schedulePlan(); } });
      visual.value = state.visual;
      const counter = h('div', { class: 'counter' }, state.visual.length + ' ký tự');
      const sound = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Tiếng mưa, tiếng xe máy xa xa, tiếng bước chân… (để trống = im lặng)', oninput: (e) => { state.sound = e.target.value; schedulePlan(); } });
      sound.value = state.sound;
      const music = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Piano nhẹ, nhịp chậm… (để trống = không nhạc)', oninput: (e) => { state.music = e.target.value; schedulePlan(); } });
      music.value = state.music;
      const ideas = h('div', { class: 'chips' }, VIDEO_IDEAS.map((idea) => h('button', { class: 'chip suggest', type: 'button', onclick: () => {
        Object.assign(state, { visual: idea.visual, sound: idea.sound, music: idea.music }); renderPromptBody(); schedulePlan();
      } }, icon('lightbulb', 'small'), idea.label)));
      body.append(
        field('Hình ảnh & chuyển động', h('div', {}, visual, counter),
          'Mô tả chủ thể, hành động, góc máy và ánh sáng. Viết tiếng Anh cho kết quả tốt nhất; lời thoại có thể để tiếng Việt trong ngoặc kép.'),
        h('div', { class: 'grid-2' }, field('Âm thanh', sound, null, true), field('Nhạc nền', music, null, true)),
        field('Gợi ý nhanh', ideas));
      setTimeout(() => visual.focus(), 0);
    } else {
      const raw = h('textarea', { class: 'textarea mono', spellcheck: false, oninput: (e) => { state.raw = e.target.value; schedulePlan(); },
        placeholder: 'integrated_multimodal_description: [Shot 1] …\n\noverall_soundscape: …\n\nnon_diegetic_music: …' });
      raw.value = state.raw;
      body.append(field(null, raw, h('span', {}, 'Định dạng prompt của MiniMax H3: mỗi phần một dòng "tên: nội dung", cách nhau 1 dòng trống. Có thể chia cảnh bằng [Shot 1], [Shot 2] At 00:03.000 …')));
    }
  }

  function renderRefs() {
    els.refs.innerHTML = '';
    state.references.forEach((ref, i) => {
      els.refs.append(mediaSlot({ title: '', kinds: ['image', 'video', 'audio'], value: ref, onChange: (v) => { if (!v) { state.references.splice(i, 1); renderRefs(); schedulePlan(); } } }));
    });
    if (state.references.length < 8) {
      els.refs.append(mediaSlot({ title: 'Thêm tham chiếu', desc: 'Ảnh, video hoặc âm thanh', kinds: ['image', 'video', 'audio'], iconName: 'add',
        onChange: (v) => { if (v) { state.references.push(v); renderRefs(); schedulePlan(); } } }));
    }
  }

  function renderLoras() {
    if (!els.loras) return;
    els.loras.innerHTML = '';
    els.loras.append(loraEditor((App.caps && App.caps.loras) || [], state.loras, (list) => { state.loras = list; schedulePlan(); }));
  }

  function renderContinue() {
    els.continueBanner.innerHTML = '';
    if (!state.continueFrom) return;
    els.continueBanner.append(h('div', { class: 'card' }, h('div', { class: 'card-body' },
      h('div', { class: 'row' }, icon('fast_forward'), h('div', { style: { flex: 1 } }, h('b', {}, 'Làm tiếp video: '), state.continueFrom.title),
        h('button', { class: 'btn btn-text', onclick: () => { state.continueFrom = null; renderContinue(); schedulePlan(); } }, 'Bỏ')),
      h('div', { class: 'mt' }, switchToggle('Giữ sát khung hình đầu', 'Giảm trôi bố cục khi nối nhiều phần.', state.firstFrameReference, (v) => { state.firstFrameReference = v; schedulePlan(); })),
      h('div', { class: 'help' }, 'Mô tả đoạn tiếp theo; thời lượng là độ dài phần thêm vào.'))));
  }

  function updateEnhance() {
    const ready = Boolean(App.caps && App.caps.features && App.caps.features.enhance);
    els.enhanceBtn.disabled = !App.connected || !ready;
    els.enhanceBtn.title = ready ? 'Dùng AI chạy trên máy viết lại ý tưởng thành prompt chi tiết'
      : 'AI viết prompt chưa có — tải gói "AI viết prompt" ở mục Engine & mô hình';
  }

  /* ---------- Ước tính (POST /plan) ---------- */
  function schedulePlan(delay = 600) {
    clearTimeout(planTimer);
    planTimer = setTimeout(runPlan, delay);
  }
  let lastPlan = null, lastPlanError = null;
  async function runPlan() {
    const spec = buildSpec();
    const seq = ++planSeq;
    if (!spec.prompt || !App.connected) { lastPlan = null; lastPlanError = null; renderSummary(); return; }
    delete spec.takes;
    try {
      const plan = await api('POST', '/plan', spec);
      if (seq !== planSeq) return;
      lastPlan = plan; lastPlanError = null;
    } catch (error) {
      if (seq !== planSeq) return;
      lastPlan = null; lastPlanError = error;
    }
    renderSummary();
  }

  function renderSummary() {
    const box = els.summary;
    box.innerHTML = '';
    const prompt = composedPrompt();
    if (!App.connected) {
      box.append(h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('link_off'), h('div', {}, 'Engine chưa chạy. ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('engine'); } }, 'Mở Engine & mô hình'))));
    }
    if (lastPlan && lastPlan.estimate && lastPlan.estimate.seconds) {
      const total = lastPlan.estimate.seconds * (state.takes || 1);
      box.append(h('div', { class: 'estimate' }, icon('timer'),
        h('div', {}, h('div', { class: 'big' }, '~' + fmtDuration(total)), h('div', { class: 'small' }, 'thời gian ước tính trên máy này' + (state.takes > 1 ? ' (' + state.takes + ' bản)' : '')))));
    }
    const g = lastPlan && lastPlan.geometry;
    const s = lastPlan && lastPlan.sampling;
    const chain = lastPlan && lastPlan.chain_plan;
    box.append(h('dl', { class: 'kv' },
      h('dt', {}, 'Độ phân giải'), h('dd', {}, g ? g.width + ' × ' + g.height : state.aspect),
      h('dt', {}, 'Thời lượng'), h('dd', {}, g ? g.seconds.toFixed(1) + ' giây · ' + g.frames + ' khung' : state.seconds + ' giây'),
      h('dt', {}, 'Chất lượng'), h('dd', {}, (QUALITY_TEXT[state.quality] || [state.quality])[0] + (s ? ' · ' + s.total_steps + ' bước' + (s.two_pass ? ' (2 lượt)' : '') : '')),
      chain && chain.blocks > 1 ? [h('dt', {}, 'Số phần'), h('dd', {}, chain.blocks + ' phần, tự ghép')] : null,
      state.takes > 1 ? [h('dt', {}, 'Số bản'), h('dd', {}, state.takes)] : null,
      state.loras.length ? [h('dt', {}, 'LoRA'), h('dd', {}, state.loras.length)] : null));
    for (const w of (lastPlan && lastPlan.warnings) || []) box.append(h('div', { class: 'notice warn' }, icon('warning'), h('div', {}, w)));
    if (lastPlanError && prompt) {
      box.append(h('div', { class: 'notice err' }, icon('error'), h('div', {}, errorText(lastPlanError),
        lastPlanError.next ? h('div', { class: 'small-text' }, lastPlanError.next) : null)));
    }
    if (!prompt) box.append(h('div', { class: 'notice info' }, icon('edit'), h('div', {}, 'Nhập mô tả video để bắt đầu.')));
    els.generateBtn.disabled = !prompt || !App.connected;
  }

  /* ---------- Gửi job ---------- */
  async function submit() {
    const spec = buildSpec();
    if (!spec.prompt) { toast('Hãy nhập mô tả video', { kind: 'err' }); return; }
    els.generateBtn.disabled = true;
    try {
      const reply = await api('POST', '/jobs', spec);
      const jobs = reply.jobs || [reply.job];
      toast(jobs.length > 1 ? 'Đã gửi ' + jobs.length + ' video vào hàng đợi' : 'Đã gửi video vào hàng đợi', { kind: 'ok',
        action: { label: 'Xem hàng đợi', run: () => navigate('queue') } });
      for (const w of reply.warnings || []) toast(w);
      for (const job of jobs.slice().reverse()) addCard(job, true);
      Poller.soon(500);
    } catch (error) {
      toastError(error, 'Không gửi được');
    } finally {
      els.generateBtn.disabled = false;
    }
  }

  async function enhancePrompt() {
    const text = state.mode === 'raw' ? state.raw : [state.visual, state.sound && 'Sound: ' + state.sound, state.music && 'Music: ' + state.music].filter(Boolean).join('\n');
    if (!text.trim()) { toast('Hãy viết vài ý tưởng trước, AI sẽ viết lại chi tiết', { kind: 'err' }); return; }
    const btn = els.enhanceBtn;
    btn.disabled = true;
    btn.innerHTML = '';
    btn.append(icon('progress_activity', 'spin'), 'AI đang viết…');
    try {
      const body = { kind: 'enhance', text, seconds: Number(state.seconds), label: 'Viết prompt: ' + labelFrom(text).slice(0, 90) };
      const media = {};
      if (state.first) media.first = { file: state.first.file };
      if (state.last) media.last = { file: state.last.file };
      if (state.references.length && !state.first && !state.last) media.references = state.references.map((r) => ({ file: r.file }));
      if (Object.keys(media).length) body.media = media;
      const reply = await api('POST', '/jobs', body);
      let job = reply.job;
      while (ACTIVE.has(job.status)) {
        await new Promise((r) => setTimeout(r, 1000));
        job = await api('GET', '/jobs/' + job.id + '?wait=10');
      }
      if (job.status !== 'succeeded' || !job.result || !job.result.text) throw new ApiError(job.error || { message: 'AI không trả về prompt' });
      state.raw = job.result.text;
      state.mode = 'raw';
      renderPromptBody();
      schedulePlan();
      toast('Đã viết lại prompt — bạn có thể sửa thêm trước khi tạo', { kind: 'ok' });
    } catch (error) {
      toastError(error, 'Không viết lại được');
    } finally {
      btn.innerHTML = '';
      btn.append(icon('auto_awesome'), 'Viết lại bằng AI');
      updateEnhance();
    }
  }

  /* ---------- Kết quả ---------- */
  function addCard(job, prepend) {
    if (cards.has(job.id)) { cards.get(job.id).update(job); return; }
    const card = jobCard(job, { onReuse: reuse, onContinue: continueFrom });
    cards.set(job.id, card);
    const empty = els.results.querySelector('.empty');
    if (empty) empty.remove();
    if (prepend) els.results.prepend(card); else els.results.append(card);
  }
  function showRecent(jobs) {
    const mine = (jobs || []).filter((j) => j.kind === 'generate').slice(0, 6);
    for (const job of mine) addCard(job, false);
    for (const job of jobs || []) if (cards.has(job.id)) cards.get(job.id).update(job);
    if (!cards.size && !els.results.querySelector('.empty')) {
      els.results.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('movie'), h('div', { class: 'small-text' }, 'Video bạn tạo sẽ hiện ở đây')));
    }
  }

  async function reuse(job) {
    try {
      const full = await jobDetail(job.id);
      applySpec(full.spec || {});
      navigate('video');
    } catch (e) { toastError(e); }
  }
  function continueFrom(job) {
    App.handoff = { page: 'video', continueFrom: { value: { from_job: job.id }, title: jobTitle(job) } };
    navigate('video');
  }

  function applySpec(spec) {
    App.handoff = { page: 'video', spec };
  }
  function applyHandoff(handoff) {
    const spec = handoff.spec;
    if (spec) {
      if (typeof spec.prompt === 'string') { state.raw = spec.prompt; state.mode = 'raw'; }
      if (spec.seconds) state.seconds = Math.round(spec.seconds);
      if (spec.quality) state.quality = spec.quality;
      if (spec.aspect) state.aspect = spec.aspect;
      if (spec.seed !== undefined && spec.seed !== null) { state.seedRandom = false; state.seed = spec.seed; }
      if (Array.isArray(spec.loras)) state.loras = spec.loras.map((l) => (typeof l === 'string' ? { name: l, strength: 1 } : { name: l.name, strength: l.strength ?? 1 }));
    }
    if (handoff.prompt) { state.raw = handoff.prompt; state.mode = 'raw'; }
    if (handoff.first) state.first = handoff.first;
    if (handoff.continueFrom) state.continueFrom = handoff.continueFrom;
  }

  function resetForm() {
    App.handoff = null;
    navigate('video');
  }

  return { render, leave, applySpec };
})());
