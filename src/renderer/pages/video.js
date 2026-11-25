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
      text: '',   // mỗi dòng = 1 video
      aspect: pref('videoAspect', '16:9'), seconds: pref('videoSeconds', 10), quality: pref('videoQuality', 'light'),
      takes: 1, seedRandom: true, seed: 0, preview: false,
      first: null, last: null, references: [], loras: [], continueFrom: null, firstFrameReference: false,
    };
  }

  // Mỗi dòng không trống là 1 prompt = 1 video
  const promptLines = () => state.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  function composedPrompt() { return promptLines()[0] || ''; }

  // Prompt đầy đủ của MiniMax H3 bị gộp thành 1 dòng → tách lại các phần (âm thanh, nhạc) như định dạng gốc
  const h3Format = (line) => line.replace(/\s+(overall_soundscape|non_diegetic_music|integrated_multimodal_description):/g, '\n\n$1:').trim();

  function buildSpec(prompt = composedPrompt()) {
    prompt = h3Format(prompt);
    const spec = { kind: 'generate', prompt, aspect: state.aspect, seconds: Number(state.seconds), quality: state.quality };
    spec.label = labelFrom(prompt) || undefined;
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

    /* Prompt: 1 khung, mỗi dòng 1 video */
    els.continueBanner = h('div');
    els.promptBody = h('div', { class: 'card-body' });
    els.lineCount = h('span', { class: 'pill' });
    left.append(els.continueBanner, h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('edit_note'), h('h2', {}, 'Prompt'), h('span', { class: 'hint' }, 'mỗi dòng = 1 video'), h('div', { class: 'grow' }), els.lineCount),
      els.promptBody));
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

    /* Cột phải: tóm tắt + nút tạo + kết quả */
    els.summary = h('div', { class: 'card-body' });
    els.generateBtn = h('button', { class: 'btn btn-primary btn-hero', onclick: () => submit(false) }, icon('movie'), els.genLabel = h('span', {}, 'Tạo video'), h('span', { class: 'kbd' }, 'Ctrl ↵'));
    els.previewBtn = h('button', { class: 'btn btn-outline', style: { width: '100%', padding: '12px' }, onclick: () => submit(true) }, icon('preview'), 'Tạo bản xem trước');
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } },
      h('div', { class: 'card-head' }, h('h2', {}, 'Tóm tắt')), els.summary,
      h('div', { class: 'card-foot', style: { display: 'block' } }, els.previewBtn,
        h('div', { class: 'help', style: { margin: '4px 0 10px' } }, 'Bản nhanh, nửa độ phân giải — ưng rồi bấm "Hoàn thiện" ở kết quả để ra bản đẹp.'),
        els.generateBtn, aiLabelNote())));
    els.results = h('div');
    right.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Kết quả gần đây'), h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-text', onclick: () => navigate('library') }, 'Thư viện')), h('div', { class: 'card-body' }, els.results)));

    root.append(page);
    renderContinue();
    renderSummary();
    showRecent(App.jobs);
    schedulePlan(10);

    unsub = [
      App.on('jobs', showRecent),
      App.on('caps', () => { if (App.caps.limits) els.duration.setMax(App.caps.limits.seconds[1]); schedulePlan(); }),
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(false); }
  }

  function renderPromptBody() {
    const body = els.promptBody;
    body.innerHTML = '';
    const ta = h('textarea', { class: 'textarea big prompt-lines', spellcheck: false,
      placeholder: 'Mỗi dòng là 1 video. Ví dụ:\nA young woman in a white áo dài walks through Hoi An at sunset, lanterns glowing, slow dolly shot.\nClose-up of iced coffee dripping into a glass, morning light, cinematic.',
      oninput: (e) => { state.text = e.target.value; countLines(); schedulePlan(); } });
    ta.value = state.text;
    els.promptArea = ta;
    const ideas = h('div', { class: 'chips' }, VIDEO_IDEAS.map((idea) => h('button', { class: 'chip suggest', type: 'button', onclick: () => {
      const line = [idea.visual, 'Sound: ' + idea.sound, 'Music: ' + idea.music].join(' ');
      state.text = state.text.trim() ? state.text.replace(/\s*$/, '') + '\n' + line : line;
      ta.value = state.text; countLines(); schedulePlan();
    } }, icon('lightbulb', 'small'), idea.label)));
    body.append(field(null, ta, 'Viết tiếng Anh cho kết quả tốt nhất; lời thoại có thể để tiếng Việt trong ngoặc kép. Dán nhiều dòng để tạo hàng loạt.'),
      aiWriterRow([{ label: 'Viết lại', icon: 'auto_awesome', run: rewriteWith }, { label: 'Viết kịch bản', icon: 'movie_edit', run: (engine) => scriptWith(engine) }]),
      field('Gợi ý nhanh', ideas));
    countLines();
    setTimeout(() => ta.focus(), 0);
  }
  function countLines() {
    const n = promptLines().length;
    els.lineCount.textContent = n + ' video';
    els.lineCount.style.visibility = n ? 'visible' : 'hidden';
    if (els.genLabel) els.genLabel.textContent = n > 1 ? 'Tạo ' + n + ' video' : 'Tạo video';
  }

  const who = (engine) => (engine === GPT ? 'ChatGPT' : 'AI trên máy');
  async function rewriteWith(engine, btn) {
    const lines = promptLines();
    if (!lines.length) { toast('Hãy viết vài ý tưởng trước (mỗi dòng 1 video), AI sẽ viết lại chi tiết', { kind: 'err' }); return; }
    const r = await engine.run('video', { lines, seconds: Number(state.seconds) }, btn);
    if (!r || !Array.isArray(r.lines)) return;
    state.text = r.lines.map((l) => String(l).replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
    renderPromptBody(); schedulePlan();
    toast(who(engine) + ' đã viết lại ' + r.lines.length + ' prompt — sửa thêm nếu muốn rồi bấm Tạo', { kind: 'ok' });
  }
  function scriptWith(engine) {
    const idea = h('textarea', { class: 'textarea', rows: 4, placeholder: 'Ví dụ: Một cô gái bán cà phê ở Hội An gặp lại người bạn cũ dưới mưa, kết thúc ấm áp.' });
    const count = slider({ min: 1, max: 20, value: 4, suffix: 'cảnh', onChange: () => {} });
    const go = h('button', { class: 'btn btn-primary', onclick: async () => {
      if (!idea.value.trim()) { idea.focus(); return; }
      const n = Number(count.querySelector('input[type=range]').value);
      const r = await engine.run('lines', { idea: idea.value.trim(), count: n, seconds: Number(state.seconds) }, go);
      if (!r || !Array.isArray(r.lines)) return;
      closeModal();
      state.text = r.lines.map((l) => String(l).replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
      renderPromptBody(); schedulePlan();
      toast(who(engine) + ' đã viết ' + r.lines.length + ' cảnh — mỗi dòng 1 video', { kind: 'ok' });
    } }, icon('movie_edit'), 'Viết kịch bản');
    openModal([modalHead('Viết kịch bản bằng ' + who(engine), engine === GPT ? 'bolt' : 'memory'), field('Ý tưởng câu chuyện', idea, 'Viết tiếng Việt cũng được. Lời thoại sẽ giữ tiếng Việt.'),
      field('Số cảnh (mỗi cảnh 1 video)', count), h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Huỷ'), go)]);
    setTimeout(() => idea.focus(), 0);
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


  function renderContinue() {
    els.continueBanner.innerHTML = '';
    if (!state.continueFrom) return;
    els.continueBanner.append(h('div', { class: 'card' }, h('div', { class: 'card-body' },
      h('div', { class: 'row' }, icon('fast_forward'), h('div', { style: { flex: 1 } }, h('b', {}, 'Làm tiếp video: '), state.continueFrom.title),
        h('button', { class: 'btn btn-text', onclick: () => { state.continueFrom = null; renderContinue(); schedulePlan(); } }, 'Bỏ')),
      h('div', { class: 'mt' }, switchToggle('Giữ sát khung hình đầu', 'Giảm trôi bố cục khi nối nhiều phần.', state.firstFrameReference, (v) => { state.firstFrameReference = v; schedulePlan(); })),
      h('div', { class: 'help' }, 'Mô tả đoạn tiếp theo; thời lượng là độ dài phần thêm vào.'))));
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
    const n = promptLines().length;
    if (n > 1) box.append(h('div', { class: 'notice info' }, icon('playlist_play'), h('div', {}, n + ' video sẽ được tạo lần lượt' + (lastPlan && lastPlan.estimate && lastPlan.estimate.seconds ? ' · tổng ~' + fmtDuration(lastPlan.estimate.seconds * n) : '') + '.')));
    if (!prompt) box.append(h('div', { class: 'notice info' }, icon('edit'), h('div', {}, 'Nhập prompt để bắt đầu — mỗi dòng 1 video.')));
    els.generateBtn.disabled = !prompt || !App.connected;
    els.previewBtn.disabled = !prompt || !App.connected;
  }

  /* ---------- Gửi job ---------- */
  async function submit(preview) {
    const lines = promptLines();
    if (!lines.length) { toast('Hãy nhập prompt (mỗi dòng 1 video)', { kind: 'err' }); return; }
    els.generateBtn.disabled = true; els.previewBtn.disabled = true;
    let sent = 0;
    try {
      for (const line of lines) {
        const spec = buildSpec(line);
        if (preview) {
          spec.preview = true;
          if (spec.quality === 'light') spec.quality = 'medium';   // bản xem trước cần chất lượng 2 lượt; "Hoàn thiện" ra bản Cân bằng
        }
        const reply = await api('POST', '/jobs', spec);
        const jobs = reply.jobs || [reply.job];
        for (const w of reply.warnings || []) toast(w);
        for (const job of jobs.slice().reverse()) addCard(job, true);
        sent += jobs.length;
      }
      toast((preview ? 'Đã gửi ' + sent + ' bản xem trước' : sent > 1 ? 'Đã gửi ' + sent + ' video' : 'Đã gửi video') + ' vào hàng đợi', { kind: 'ok',
        action: { label: 'Xem hàng đợi', run: () => navigate('queue') } });
      Poller.soon(500);
    } catch (error) {
      toastError(error, sent ? 'Đã gửi ' + sent + ' video, dòng tiếp theo bị lỗi' : 'Không gửi được');
    } finally {
      renderSummary();
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
      if (typeof spec.prompt === 'string') state.text = spec.prompt.replace(/\s*\n+\s*/g, ' ').trim();
      if (spec.seconds) state.seconds = Math.round(spec.seconds);
      if (spec.quality) state.quality = spec.quality;
      if (spec.aspect) state.aspect = spec.aspect;
      if (spec.seed !== undefined && spec.seed !== null) { state.seedRandom = false; state.seed = spec.seed; }   // Dùng lại = đúng seed cũ
    }
    if (handoff.prompt) state.text = String(handoff.prompt).replace(/\s*\n+\s*/g, ' ').trim();
    if (handoff.first) state.first = handoff.first;
    if (handoff.continueFrom) state.continueFrom = handoff.continueFrom;
  }

  function resetForm() {
    App.handoff = null;
    navigate('video');
  }

  return { render, leave, applySpec };
})());
