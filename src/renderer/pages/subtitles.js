'use strict';
/* Trang Phụ đề: AI nghe lời thoại trong video → sửa câu chữ, thời gian → tải .srt hoặc xuất video có phụ đề. */

registerPage('subtitles', (() => {
  let state, els = {};

  function render(root) {
    state = { src: null, project: null, language: pref('subLang', 'auto'), cues: [], busy: false, exported: null };
    if (App.handoff && App.handoff.page === 'subtitles') { state.src = App.handoff.source; App.handoff = null; }
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Phụ đề'),
      h('div', { class: 'sub' }, 'AI nghe lời thoại trong video và tạo phụ đề có thời gian. Sửa lại câu chữ rồi tải file .srt hoặc xuất video có phụ đề.'))));
    const left = h('div'), right = h('div', { class: 'sticky-col' });
    page.append(h('div', { class: 'layout-2' }, left, right));
    els.source = h('div');
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('movie'), h('h2', {}, '1. Video')), h('div', { class: 'card-body' }, els.source)));
    els.cues = h('div');
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('subtitles'), h('h2', {}, '2. Phụ đề'),
      h('div', { class: 'grow' }), els.cueTools = h('div', { class: 'row' })), h('div', { class: 'card-body' }, els.cues)));

    els.note = h('div');
    els.listenBtn = h('button', { class: 'btn btn-primary btn-hero', onclick: listen }, icon('hearing'), 'Nghe & tạo phụ đề');
    els.progress = h('div');
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } }, h('div', { class: 'card-body' }, els.note,
      field('Ngôn ngữ nói trong video', langSelect(state.language, (v) => { state.language = v; setPref('subLang', v); })),
      els.listenBtn, els.progress)));
    els.out = h('div');
    right.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '3. Xuất')), h('div', { class: 'card-body' }, els.out)));
    root.append(page);
    drawSource(); drawCues(); drawOut(); update();
    App.on('connection', update);
  }

  function drawSource() {
    els.source.innerHTML = '';
    els.source.append(sourceCard(state.src, (src) => { state.src = src; state.project = null; state.cues = []; state.exported = null; drawSource(); drawCues(); drawOut(); update(); }));
  }

  function update() {
    if (!els.listenBtn) return;
    els.note.innerHTML = '';
    if (!App.connected) els.note.append(engineOffNotice());
    else els.note.append(packNotice('Cần gói "Phụ đề tự động" (nhận dạng giọng nói, tải 1 lần).'));
    els.listenBtn.disabled = !state.src || state.busy || !App.connected;
    els.listenBtn.lastChild.textContent = state.cues.length ? 'Nghe lại từ đầu' : 'Nghe & tạo phụ đề';
  }

  async function ensureProject() {
    if (!state.project) state.project = await projectFromSource(state.src, 'Phụ đề · ' + (state.src.name || ''));
    return state.project;
  }

  async function listen() {
    if (state.cues.length && !confirm('Nghe lại sẽ thay phụ đề hiện tại. Tiếp tục?')) return;
    state.busy = true; update();
    const line = jobProgressLine(); els.progress.innerHTML = ''; els.progress.append(line);
    try {
      line.set('Đang chuẩn bị video…');
      const project = await ensureProject();
      const r = await api('POST', '/projects/' + project.id + '/listen', { revision: project.revision, mode: 'transcribe', language: state.language });
      const job = await waitJob((r.job || r).id, (j) => line.update(j));
      const lines = (job.result && (job.result.lines || job.result.cues)) || [];
      state.cues = lines.map((l) => cueFrom(l)).filter((c) => c.text);
      if (!state.cues.length) toast('Không nghe thấy lời thoại nào', { sub: 'Video có thể không có tiếng nói, hoặc thử chọn đúng ngôn ngữ.' });
      else toast('Đã tạo ' + state.cues.length + ' dòng phụ đề', { kind: 'ok' });
      drawCues(); drawOut();
    } catch (e) { toastError(e, 'Không tạo được phụ đề'); }
    finally { state.busy = false; els.progress.innerHTML = ''; update(); drawOut(); }
  }

  // Dòng từ engine: start/end là frame (24 fps), kèm start_seconds/end_seconds
  function cueFrom(l) {
    let start, end;
    if (typeof l.start_seconds === 'number') { start = l.start_seconds; end = l.end_seconds; }
    else { start = (Number(l.start) || 0) / FPS; end = (Number(l.end) || 0) / FPS; }
    if (!(end > start)) end = start + 2;
    return { start, end, text: String(l.text || '').trim() };
  }

  function drawCues() {
    els.cues.innerHTML = ''; els.cueTools.innerHTML = '';
    if (!state.cues.length) {
      els.cues.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('subtitles'),
        h('div', { class: 'small-text' }, state.src ? 'Bấm "Nghe & tạo phụ đề", hoặc tự gõ từng dòng.' : 'Chọn video trước.'),
        state.src ? h('button', { class: 'btn btn-text mt', onclick: () => { state.cues.push({ start: 0, end: 2, text: '' }); drawCues(); drawOut(); } }, icon('add'), 'Tự thêm dòng') : null));
      return;
    }
    els.cueTools.append(h('span', { class: 'muted small-text' }, state.cues.length + ' dòng'));
    const rows = state.cues.map((c, i) => {
      const time = (key) => h('input', { class: 'input time', value: fmtClock(c[key]), onchange: (e) => {
        const v = parseClock(e.target.value); if (v === null) { e.target.value = fmtClock(c[key]); return; } c[key] = v; e.target.value = fmtClock(v); drawOut(); } });
      const text = h('textarea', { class: 'textarea cue', rows: 1, maxlength: 400, oninput: (e) => { c.text = e.target.value; } });
      text.value = c.text;
      return h('tr', {}, h('td', { class: 'muted' }, i + 1), h('td', {}, time('start'), h('div', {}, time('end'))), h('td', { style: { width: '100%' } }, text),
        h('td', {}, h('button', { class: 'icon-btn', title: 'Thêm dòng sau', onclick: () => { state.cues.splice(i + 1, 0, { start: c.end, end: c.end + 2, text: '' }); drawCues(); } }, icon('add')),
          h('button', { class: 'icon-btn', title: 'Xoá dòng', onclick: () => { state.cues.splice(i, 1); drawCues(); drawOut(); } }, icon('delete'))));
    });
    els.cues.append(h('div', { class: 'table-wrap cue-table' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['#', 'Thời gian', 'Nội dung', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))),
      h('div', { class: 'help' }, 'Mỗi dòng tối đa 2 hàng chữ. Thời gian dạng phút:giây (vd. 01:05.5). Các dòng không được chồng lên nhau.'));
  }

  function cleanCues() {
    const list = state.cues.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })).sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      if (list[i].end <= list[i].start) list[i].end = list[i].start + 1;
      if (list[i + 1] && list[i].end > list[i + 1].start) list[i].end = list[i + 1].start;
    }
    return list.filter((c) => c.end > c.start);
  }

  function drawOut() {
    els.out.innerHTML = '';
    const has = state.cues.some((c) => c.text.trim());
    els.out.append(
      h('button', { class: 'btn btn-outline', disabled: !has, onclick: () => downloadText(toSrt(cleanCues()), 'phu-de.srt') }, icon('download'), 'Tải file .srt'),
      h('button', { class: 'btn btn-primary mt', style: { width: '100%' }, disabled: !has || state.busy, onclick: exportVideo }, icon('movie'), 'Xuất video có phụ đề'),
      h('div', { class: 'help' }, 'Video mới được lưu vào Thư viện; video gốc giữ nguyên.'));
    if (state.exported) els.out.append(jobCard(state.exported));
  }

  async function exportVideo() {
    state.busy = true; update(); drawOut();
    const line = jobProgressLine(); els.progress.innerHTML = ''; els.progress.append(line);
    try {
      line.set('Đang ghép phụ đề vào video…');
      let project = await ensureProject();
      project = await readProject(project.id);
      const cues = cleanCues().map((c) => ({ start: Math.round(c.start * FPS), frames: Math.max(1, Math.round((c.end - c.start) * FPS)), text: c.text.slice(0, 400) }));
      const r = await api('POST', '/projects/' + project.id + '/operations', { revision: project.revision, operations: [{ op: 'subtitles', cues, replace: true }] });
      state.project = r.project || project;
      const job = await exportProject(state.project.id, (j) => line.update(j));
      state.exported = job;
      toast('Đã xuất video có phụ đề', { kind: 'ok', sub: 'Đã lưu vào Thư viện.' });
    } catch (e) { toastError(e, 'Không xuất được video'); }
    finally { state.busy = false; els.progress.innerHTML = ''; update(); drawOut(); }
  }

  return { render, leave() {} };
})());
