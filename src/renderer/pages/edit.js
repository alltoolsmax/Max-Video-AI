'use strict';
/* Trang Sửa ảnh: sửa bằng AI theo mô tả, hoặc chỉnh nhanh (cắt, xoay, lật, màu sắc, chữ, xoá chữ cháy). */

const EDIT_IDEAS = [
  ['Đổi nền', 'Replace the background with a clean white studio backdrop, keep the subject unchanged.'],
  ['Đổi trang phục', 'Change the outfit of the person in image 1 to a red áo dài, keep the face and pose.'],
  ['Thêm ánh hoàng hôn', 'Make it golden hour sunset light, warm tones, long soft shadows.'],
  ['Xoá vật thể', 'Remove the object in the foreground and fill the area naturally.'],
  ['Phong cách hoạt hình', 'Turn the photo into a 3D animated movie style, keep the composition.'],
];
const ADJUST = [['exposure', 'Độ sáng', -100, 100], ['contrast', 'Tương phản', -100, 100], ['saturation', 'Bão hoà', -100, 100],
  ['vibrance', 'Rực màu', -100, 100], ['temperature', 'Nhiệt màu', -100, 100], ['highlights', 'Vùng sáng', -100, 100],
  ['shadows', 'Vùng tối', -100, 100], ['sharpen', 'Làm nét', 0, 100], ['blur', 'Làm mờ', 0, 100], ['vignette', 'Viền tối', -100, 100]];

registerPage('edit', (() => {
  let state, els = {};

  function render(root) {
    state = { source: null, mode: 'ai', prompt: '', model: pref('imageModel', ''), ops: freshOps(), busy: false, history: [] };
    if (App.handoff && App.handoff.page === 'edit') { state.source = App.handoff.image; App.handoff = null; }
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Sửa ảnh'),
      h('div', { class: 'sub' }, 'Sửa ảnh bằng AI theo mô tả, hoặc chỉnh nhanh: cắt, xoay, màu sắc, thêm chữ, xoá chữ cháy trên ảnh.'))));
    const left = h('div'), right = h('div', { class: 'sticky-col' });
    page.append(h('div', { class: 'layout-2' }, left, right));

    els.sourceBox = h('div');
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('image'), h('h2', {}, 'Ảnh cần sửa')), h('div', { class: 'card-body' }, els.sourceBox)));
    els.modeTabs = segmented([{ value: 'ai', label: 'Sửa bằng AI', desc: 'mô tả điều muốn đổi' }, { value: 'quick', label: 'Chỉnh nhanh', desc: 'cắt, xoay, màu, chữ' }],
      state.mode, (v) => { state.mode = v; drawTools(); update(); });
    els.tools = h('div');
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('auto_fix_high'), h('h2', {}, 'Cách sửa')),
      h('div', { class: 'card-body' }, els.modeTabs, h('div', { class: 'mt' }, els.tools))));

    els.note = h('div');
    els.btn = h('button', { class: 'btn btn-primary btn-hero', onclick: submit }, icon('auto_fix_high'), 'Sửa ảnh');
    els.progress = h('div');
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } }, h('div', { class: 'card-body' }, els.note, h('div', { class: 'mt' }, els.btn), els.progress, aiLabelNote())));
    els.result = h('div');
    right.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Kết quả')), h('div', { class: 'card-body' }, els.result)));
    root.append(page);
    drawSource(); drawTools(); drawResult(); update();
    window.fv.engine.packs().then((r) => {
      const list = r.ok ? r.data : [];
      const ready = (id) => Boolean((list.find((x) => x.id === id) || {}).ready);
      state.noImageModel = r.ok && !ready('image-h3') && !ready('image-qwen');
      update();
    }).catch(() => {});
    App.on('connection', update);
  }

  function freshOps() { return { rotate: 0, flipH: false, flipV: false, ratio: '', adjust: {}, text: '', textPos: 'bottom', textSize: 6, textColor: '#ffffff', removeText: false }; }

  function drawSource() {
    els.sourceBox.innerHTML = '';
    els.sourceBox.append(mediaSlot({ title: 'Chọn ảnh', desc: 'Bấm để chọn hoặc kéo thả ảnh vào đây', value: state.source,
      onChange: (v) => { state.source = v; update(); } }));
    els.sourceBox.firstChild.style.minHeight = '220px';
    const recent = (App.jobs || []).filter((j) => j.kind === 'image' && j.status === 'succeeded').flatMap((j) => jobImages(j)).slice(0, 8);
    if (recent.length) {
      els.sourceBox.append(h('div', { class: 'label mt' }, 'Hoặc chọn ảnh vừa tạo'),
        h('div', { class: 'thumb-row' }, recent.map((img) => h('img', { src: mediaUrl(img.url), alt: '', title: 'Dùng ảnh này',
          onclick: () => { state.source = { file: img.file, url: img.url, kind: 'image', name: 'Ảnh đã tạo' }; drawSource(); update(); } }))));
    }
  }

  function drawTools() {
    els.tools.innerHTML = '';
    if (state.mode === 'ai') {
      const prompt = h('textarea', { class: 'textarea big', placeholder: 'Ví dụ: Change the background to a beach at sunset, keep the person unchanged.',
        oninput: (e) => { state.prompt = e.target.value; update(); } });
      prompt.value = state.prompt;
      const model = h('select', { class: 'select', onchange: (e) => { state.model = e.target.value; } },
        h('option', { value: '' }, 'Tự động (model đã cài)'),
        h('option', { value: 'minimax-h3-image' }, 'MiniMax H3 Image — chất lượng cao'),
        h('option', { value: 'qwen-image-2.1-turbo' }, 'Qwen Image 2.1 Turbo — nhanh (chỉ dùng phi thương mại)'));
      model.value = state.model;
      els.tools.append(field('Muốn đổi gì?', prompt, 'Viết tiếng Anh cho kết quả tốt nhất. Ảnh đang sửa được gọi là "image 1".'),
        field('Gợi ý nhanh', h('div', { class: 'chips' }, EDIT_IDEAS.map(([l, p]) => h('button', { class: 'chip suggest', type: 'button',
          onclick: () => { state.prompt = p; prompt.value = p; update(); } }, icon('lightbulb', 'small'), l)))),
        field('Model', model, 'Cần đã tải một mô hình tạo ảnh ở mục Engine & mô hình.'));
      return;
    }
    const o = state.ops;
    const sliders = ADJUST.map(([key, label, min, max]) => field(label, slider({ min, max, value: o.adjust[key] || 0, onChange: (v) => { o.adjust[key] = v; } })));
    const text = h('input', { class: 'input', placeholder: 'Chữ muốn thêm lên ảnh (để trống nếu không cần)', value: o.text, oninput: (e) => { o.text = e.target.value; update(); } });
    els.tools.append(
      field('Xoay & lật', h('div', { class: 'chips' },
        chipGroup([0, 90, 180, 270].map((d) => ({ value: d, label: d ? 'Xoay ' + d + '°' : 'Không xoay' })), o.rotate, (v) => { o.rotate = v; update(); }),
        switchToggle('Lật ngang', null, o.flipH, (v) => { o.flipH = v; update(); }), switchToggle('Lật dọc', null, o.flipV, (v) => { o.flipV = v; update(); }))),
      field('Cắt theo khung', chipGroup([['', 'Giữ nguyên'], ['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4']]
        .map(([value, label]) => ({ value, label, ratio: value || null })), o.ratio, (v) => { o.ratio = v; update(); })),
      h('details', { class: 'sub-details', open: true }, h('summary', {}, 'Màu sắc & ánh sáng'), h('div', { class: 'grid-2' }, sliders)),
      field('Thêm chữ', h('div', {}, text, h('div', { class: 'row mt' },
        chipGroup([['top', 'Trên'], ['center', 'Giữa'], ['bottom', 'Dưới']].map(([value, label]) => ({ value, label })), o.textPos, (v) => { o.textPos = v; }),
        h('input', { type: 'color', value: o.textColor, title: 'Màu chữ', onchange: (e) => { o.textColor = e.target.value; } }),
        h('span', { class: 'muted small-text' }, 'Cỡ (% cạnh ảnh)'), slider({ min: 2, max: 20, value: o.textSize, onChange: (v) => { o.textSize = v; } })))),
      switchToggle('Xoá chữ cháy trên ảnh', 'Tự tìm và xoá phụ đề, chữ in sẵn ở phần dưới ảnh', o.removeText, (v) => { o.removeText = v; update(); }),
      h('div', { class: 'row mt' }, h('button', { class: 'btn btn-text', onclick: () => { state.ops = freshOps(); drawTools(); update(); } }, icon('restart_alt'), 'Đặt lại')));
  }

  function recipe() {
    const o = state.ops, ops = [];
    if (o.removeText) ops.push({ op: 'remove_text' });
    if (o.rotate) ops.push({ op: 'rotate', degrees: o.rotate });
    if (o.flipH) ops.push({ op: 'flip', axis: 'horizontal' });
    if (o.flipV) ops.push({ op: 'flip', axis: 'vertical' });
    if (o.ratio) ops.push({ op: 'crop', ratio: o.ratio });
    const adj = Object.fromEntries(Object.entries(o.adjust).filter(([, v]) => Number(v)));
    if (Object.keys(adj).length) ops.push({ op: 'adjust', ...adj });
    if (o.text.trim()) {
      // Cỡ chữ & lề tính theo pixel từ cạnh ngắn của ảnh (nếu biết kích thước)
      const info = (state.source && state.source.info) || {};
      const short = info.width && info.height ? Math.min(info.width, info.height) : null;
      const t = { op: 'text', text: o.text.trim(), anchor: o.textPos, color: o.textColor, weight: 700, shadow: true, align: 'center' };
      if (short) { t.size = Math.max(6, Math.round(short * o.textSize / 100)); t.margin = Math.round(short * 0.05); } else t.margin = 32;
      ops.push(t);
    }
    return ops;
  }

  function update() {
    if (!els.btn) return;
    els.note.innerHTML = '';
    let ok = Boolean(state.source) && !state.busy && App.connected;
    if (!App.connected) els.note.append(engineOffNotice());
    else if (!state.source) els.note.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('info'), 'Chọn ảnh cần sửa.'));
    else if (state.mode === 'ai') {
      ok = ok && Boolean(state.prompt.trim()) && !state.noImageModel;
      if (state.noImageModel) els.note.append(packNotice('Sửa bằng AI cần một mô hình tạo ảnh (tải 1 lần). "Chỉnh nhanh" thì không cần.'));
      else els.note.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('auto_awesome'), 'AI vẽ lại ảnh theo mô tả, chạy trên card đồ họa của bạn.'));
    } else {
      const n = recipe().length;
      ok = ok && n > 0;
      els.note.append(h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('tune'), n ? n + ' thao tác sẽ được áp dụng — xong trong vài giây.' : 'Chọn ít nhất một thao tác.'));
    }
    els.btn.disabled = !ok;
  }

  async function submit() {
    state.busy = true; update();
    const line = jobProgressLine(); els.progress.innerHTML = ''; els.progress.append(line);
    try {
      let out;
      if (state.mode === 'ai') {
        const spec = { kind: 'image', prompt: state.prompt.trim(), images: [state.source.file], label: 'Sửa ảnh: ' + labelFrom(state.prompt) };
        if (state.model) spec.model = state.model;
        const r = await api('POST', '/jobs', spec);
        const job = await waitJob((r.job || r).id, (j) => line.update(j));
        out = jobImages(job)[0];
      } else {
        line.set('Đang áp dụng…');
        const r = await api('POST', '/media/edit', { source: { file: state.source.file }, recipe: { operations: recipe() } });
        out = r.view || (r.url ? r : { file: r.file, url: '/freevideo/agent/v1/media/input/' + encodeURI(r.file) + '/file' });
        if (!out.file) out.file = r.file;
      }
      if (!out) throw new Error('Không nhận được ảnh kết quả');
      state.history.unshift({ file: out.file, url: out.url, from: state.mode === 'ai' ? 'AI: ' + labelFrom(state.prompt) : 'Chỉnh nhanh' });
      drawResult();
      toast('Đã sửa xong ảnh', { kind: 'ok' });
    } catch (e) { toastError(e, 'Không sửa được ảnh'); }
    finally { state.busy = false; els.progress.innerHTML = ''; update(); }
  }

  function drawResult() {
    els.result.innerHTML = '';
    if (!state.history.length) {
      els.result.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('auto_fix_high'), h('div', { class: 'small-text' }, 'Ảnh đã sửa sẽ hiện ở đây')));
      return;
    }
    for (const [i, img] of state.history.slice(0, 6).entries()) {
      els.result.append(h('div', { class: 'job' },
        h('div', { class: 'job-top' }, h('span', { class: 'status succeeded' }, icon('check_circle', 'fill'), i === 0 ? 'Mới nhất' : 'Bản ' + (state.history.length - i)), h('div', { class: 'job-title' }, img.from)),
        h('img', { class: 'result', src: mediaUrl(img.url), alt: '' }),
        h('div', { class: 'job-actions' },
          h('button', { class: 'btn btn-text', onclick: () => { state.source = { file: img.file, url: img.url, kind: 'image', name: 'Ảnh đã sửa' }; drawSource(); update(); toast('Sửa tiếp trên ảnh này'); } }, icon('edit'), 'Sửa tiếp'),
          h('button', { class: 'btn btn-text', onclick: () => saveMedia(img.url, 'anh-da-sua.png') }, icon('download'), 'Tải về'),
          h('button', { class: 'btn btn-text', onclick: () => { App.handoff = { page: 'video', first: { file: img.file, url: img.url, kind: 'image', name: 'Ảnh đã sửa' } }; navigate('video'); } }, icon('movie'), 'Làm video'))));
    }
  }

  return { render, leave() {} };
})());
