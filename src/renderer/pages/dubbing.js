'use strict';
/* Trang Lồng tiếng: AI nghe lời thoại → bạn sửa/dịch từng câu → AI nói lại bằng chính giọng gốc → xuất video. */

registerPage('dubbing', (() => {
  let state, els = {};

  function render(root) {
    state = { src: null, project: null, language: pref('dubLang', 'auto'), separate: true, lines: [], recognition: null, room: {}, busy: false, exported: null };
    if (App.handoff && App.handoff.page === 'dubbing') { state.src = App.handoff.source; App.handoff = null; }
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Lồng tiếng'),
      h('div', { class: 'sub' }, 'Đổi lời thoại trong video mà vẫn giữ giọng của từng người: AI nghe từng câu, bạn sửa hoặc dịch, AI nói lại đúng chỗ.'))));
    const left = h('div'), right = h('div', { class: 'sticky-col' });
    page.append(h('div', { class: 'layout-2' }, left, right));
    els.source = h('div');
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('movie'), h('h2', {}, '1. Video')), h('div', { class: 'card-body' }, els.source)));
    els.lines = h('div'); els.lineTools = h('div', { class: 'row' });
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('record_voice_over'), h('h2', {}, '2. Lời thoại'), h('div', { class: 'grow' }), els.lineTools),
      h('div', { class: 'card-body' }, els.lines)));

    els.note = h('div');
    els.listenBtn = h('button', { class: 'btn btn-outline', style: { width: '100%' }, onclick: listen }, icon('hearing'), 'Nghe lời thoại');
    els.dubBtn = h('button', { class: 'btn btn-primary btn-hero', onclick: dub }, icon('record_voice_over'), 'Lồng tiếng & xuất video');
    els.progress = h('div');
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } }, h('div', { class: 'card-body' }, els.note,
      field('Ngôn ngữ nói trong video', langSelect(state.language, (v) => { state.language = v; setPref('dubLang', v); })),
      switchToggle('Tách giọng khỏi nhạc nền', 'Nghe rõ hơn khi video có nhạc; giữ nguyên nhạc và tiếng động', state.separate, (v) => { state.separate = v; }),
      h('div', { class: 'mt' }, els.listenBtn), h('div', { class: 'mt' }, els.dubBtn), els.progress, aiLabelNote())));
    els.out = h('div');
    right.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Kết quả')), h('div', { class: 'card-body' }, els.out)));
    root.append(page);
    drawSource(); drawLines(); drawOut(); update();
    App.on('connection', update);
  }

  function drawSource() {
    els.source.innerHTML = '';
    els.source.append(sourceCard(state.src, (src) => { Object.assign(state, { src, project: null, lines: [], recognition: null, room: {}, exported: null }); drawSource(); drawLines(); drawOut(); update(); }));
  }

  const changed = () => state.lines.filter((l) => l.text.trim() !== l.original_text.trim());

  function update() {
    if (!els.dubBtn) return;
    els.note.innerHTML = '';
    if (!App.connected) els.note.append(engineOffNotice());
    else els.note.append(packNotice('Cần gói "Lồng tiếng giữ giọng gốc" và "Phụ đề tự động" (tải 1 lần).'));
    els.listenBtn.disabled = !state.src || state.busy || !App.connected;
    els.dubBtn.disabled = !state.recognition || !changed().length || state.busy || !App.connected;
  }

  async function ensureProject() {
    if (!state.project) state.project = await projectFromSource(state.src, 'Lồng tiếng · ' + (state.src.name || ''));
    return state.project;
  }
  function selection(project) {
    const clip = projectClip(project, 'audio');
    if (!clip) throw new ApiError({ message: 'Video này không có tiếng.' }, 0);
    return { clip_id: clip.id };
  }

  async function listen() {
    state.busy = true; update();
    const line = jobProgressLine(); els.progress.innerHTML = ''; els.progress.append(line);
    try {
      line.set('Đang chuẩn bị video…');
      let project = await ensureProject();
      project = await readProject(project.id);
      const r = await api('POST', '/projects/' + project.id + '/voice/lines',
        { revision: project.revision, selection: selection(project), language: state.language, separate_first: state.separate });
      const job = await waitJob((r.job || r).id, (j) => line.update(j));
      const res = job.result || {};
      state.recognition = res.recognition || null;
      state.lines = (res.lines || []).map((l) => ({ id: l.id, start: l.start, end: l.end, speaker: l.speaker, rate: l.rate, original_text: l.text, text: l.text }));
      state.room = {};
      if (!state.lines.length) toast('Không nghe thấy lời thoại nào', { sub: 'Thử chọn đúng ngôn ngữ hoặc bật tách giọng.' });
      else toast('Đã nghe ' + state.lines.length + ' câu thoại', { kind: 'ok', sub: 'Sửa hoặc dịch câu nào thì AI nói lại câu đó.' });
      drawLines();
    } catch (e) { toastError(e, 'Không nghe được lời thoại'); }
    finally { state.busy = false; els.progress.innerHTML = ''; update(); }
  }

  function drawLines() {
    els.lines.innerHTML = ''; els.lineTools.innerHTML = '';
    if (!state.lines.length) {
      els.lines.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('record_voice_over'),
        h('div', { class: 'small-text' }, state.src ? 'Bấm "Nghe lời thoại" để AI chép lại từng câu.' : 'Chọn video trước.')));
      return;
    }
    els.lineTools.append(h('span', { class: 'muted small-text' }, changed().length + '/' + state.lines.length + ' câu đã sửa'),
      h('button', { class: 'btn btn-text', onclick: estimate }, icon('timer'), 'Kiểm tra độ dài'));
    const rows = state.lines.map((l) => {
      const room = state.room[l.id];
      const text = h('textarea', { class: 'textarea cue', rows: 2, maxlength: 2000, oninput: (e) => { l.text = e.target.value; delete state.room[l.id]; update(); mark(); } });
      text.value = l.text;
      const flag = h('div', { class: 'small-text' });
      const mark = () => {
        const isChanged = l.text.trim() !== l.original_text.trim();
        tr.classList.toggle('row-busy', isChanged);
        flag.textContent = room && room.over ? '⚠ Dài hơn chỗ trống ~' + room.over.toFixed(1) + ' giây — nên rút gọn' : '';
        flag.style.color = 'var(--warn)';
      };
      const tr = h('tr', {}, h('td', {}, h('span', { class: 'pill' }, 'Người ' + (l.speaker || 1)), h('div', { class: 'small-text muted', style: { marginTop: '4px' } }, fmtClock(l.start) + ' – ' + fmtClock(l.end))),
        h('td', { style: { width: '38%' } }, h('div', { class: 'small-text' }, l.original_text)),
        h('td', { style: { width: '50%' } }, text, flag),
        h('td', {}, h('button', { class: 'icon-btn', title: 'Trả về câu gốc', onclick: () => { l.text = l.original_text; text.value = l.text; update(); mark(); } }, icon('undo'))));
      mark();
      return tr;
    });
    els.lines.append(h('div', { class: 'table-wrap cue-table' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Ai nói', 'Câu gốc', 'Câu mới (sửa hoặc dịch)', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))),
      h('div', { class: 'help' }, 'Câu mới nên dài gần bằng câu gốc để khớp khẩu hình. Câu không sửa giữ nguyên tiếng gốc.'));
  }

  async function estimate() {
    try {
      const project = await readProject(state.project.id);
      const r = await api('POST', '/projects/' + project.id + '/voice/estimate', {
        revision: project.revision, lines: state.lines.map(({ id, text, original_text, rate, start, end }) => ({ id, text, original_text, rate, start, end })) });
      state.room = {};
      for (const row of r.lines || []) {
        if (Number(row.overrun) > 0) state.room[row.id] = { over: Number(row.overrun) };
      }
      const over = Object.keys(state.room).length;
      toast(over ? over + ' câu có thể dài quá chỗ trống' : 'Độ dài các câu đều vừa', { kind: over ? 'info' : 'ok', sub: r.seconds ? 'Tổng thời lượng các câu mới ~' + fmtDuration(r.seconds) + '.' : undefined });
      drawLines();
    } catch (e) { toastError(e, 'Không ước tính được'); }
  }

  async function dub() {
    state.busy = true; update();
    const line = jobProgressLine(); els.progress.innerHTML = ''; els.progress.append(line);
    try {
      line.set('Đang gửi lời thoại mới…');
      let project = await readProject(state.project.id);
      const r = await api('POST', '/projects/' + project.id + '/voice/replace', {
        revision: project.revision, selection: selection(project), language: state.language, recognition: state.recognition,
        lines: state.lines.map(({ id, start, end, text, original_text, rate }) => ({ id, start, end, text: text.trim() || original_text, original_text, ...(rate ? { rate } : {}) })) });
      const job = await waitJob((r.job || r).id, (j) => line.update(j));
      const res = job.result || {};
      if (res.reason === 'too_long') throw new ApiError({ message: 'Có câu mới dài quá chỗ trống trong video.', next: 'Bấm "Kiểm tra độ dài" rồi rút gọn các câu được đánh dấu.' }, 0);
      if (res.failed) toast(res.failed + ' câu chưa lồng được', { sub: 'Các câu còn lại đã xong.' });
      line.set('Đang xuất video…');
      const out = await exportProject(state.project.id, (j) => line.update(j));
      state.exported = out;
      toast('Đã lồng tiếng xong', { kind: 'ok', sub: 'Video mới đã lưu vào Thư viện.' });
      drawOut();
    } catch (e) { toastError(e, 'Không lồng tiếng được'); }
    finally { state.busy = false; els.progress.innerHTML = ''; update(); }
  }

  function drawOut() {
    els.out.innerHTML = '';
    if (state.exported) els.out.append(jobCard(state.exported));
    else els.out.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('movie'), h('div', { class: 'small-text' }, 'Video đã lồng tiếng sẽ hiện ở đây')));
  }

  return { render, leave() {} };
})());
