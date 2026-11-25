'use strict';
/* Trang Autopilot: viết kịch bản nhiều cảnh → AI tự quay từng cảnh (nhiều bản), tự chọn bản đẹp nhất, tự ghép thành phim. */

const LIB = '/freevideo/agent/v1/library/';
const SHOT_STATE = { waiting: 'Chờ', queued: 'Chờ', running: 'Đang quay', review: 'Đang chọn bản', chosen: 'Đã chọn', done: 'Xong', failed: 'Lỗi', cancelled: 'Đã huỷ' };
const FILM_STATE = { planned: 'Đã lên kế hoạch', running: 'Đang quay', active: 'Đang quay', joining: 'Đang ghép phim', finished: 'Hoàn tất', succeeded: 'Hoàn tất', failed: 'Lỗi', cancelled: 'Đã huỷ', paused: 'Tạm dừng' };

registerPage('autopilot', (() => {
  let els = {}, film = null, cast = [], timer = null, view = 'list', openId = null;

  function blankFilm() {
    return { title: '', style: '', aspect: pref('apAspect', '16:9'), takes: 2, characters: [], shots: [blankShot()] };
  }
  function blankShot() { return { action: '', seconds: 10, cast: [], lines: [], camera: '', continue: false }; }

  function render(root, params) {
    film = film || blankFilm();
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Autopilot'), h('div', { class: 'sub' }, 'Viết kịch bản từng cảnh — AI tự quay nhiều bản cho mỗi cảnh, tự chọn bản đẹp nhất rồi ghép thành phim hoàn chỉnh.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn' + (view === 'list' ? ' btn-primary' : ''), onclick: () => { view = 'list'; openId = null; draw(); } }, icon('video_library'), 'Phim của tôi'),
        h('button', { class: 'btn' + (view === 'new' ? ' btn-primary' : ''), onclick: () => { view = 'new'; draw(); } }, icon('add'), 'Phim mới'))));
    els.body = h('div');
    page.append(els.body);
    root.append(page);
    els.page = page;
    loadCast().then((c) => { cast = c.filter((x) => x.kind === 'character'); if (view === 'new') draw(); }).catch(() => {});
    draw();
  }
  function leave() { clearTimeout(timer); }

  function draw() {
    clearTimeout(timer);
    els.body.innerHTML = '';
    els.page.querySelectorAll('.page-head .btn').forEach((b, i) => b.classList.toggle('btn-primary', (i === 0) === (view !== 'new')));
    if (!App.connected) { els.body.append(engineOffNotice()); timer = setTimeout(draw, 4000); return; }
    if (view === 'new') drawForm();
    else if (openId) drawFilm(openId);
    else drawList();
  }

  /* ---------------- Danh sách phim ---------------- */
  async function drawList() {
    const box = h('div', { class: 'card' }, h('div', { class: 'card-body muted' }, 'Đang đọc…'));
    els.body.append(box);
    try {
      const r = await api('GET', '/drama?limit=50');
      const items = Array.isArray(r) ? r : (r.items || r.dramas || r.films || []);
      box.innerHTML = '';
      if (!items.length) {
        box.append(h('div', { class: 'empty' }, icon('smart_toy'), h('h3', {}, 'Chưa có phim nào'),
          h('div', {}, 'Viết vài cảnh, AI sẽ quay và dựng thành phim cho bạn.'),
          h('button', { class: 'btn btn-primary mt', onclick: () => { view = 'new'; draw(); } }, icon('add'), 'Làm phim đầu tiên')));
        return;
      }
      box.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Phim', 'Trạng thái', 'Cập nhật', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, items.map((f) => h('tr', { style: { cursor: 'pointer' }, onclick: () => { openId = f.id; draw(); } },
          h('td', {}, h('b', {}, f.title || f.id), h('div', { class: 'small-text muted' }, (f.shots ? (f.shots.length || f.shots) + ' cảnh' : ''))),
          h('td', {}, h('span', { class: 'pill' + (/finish|succeed/.test(f.status) ? ' ok' : /fail/.test(f.status) ? ' bad' : '') }, FILM_STATE[f.status] || f.status)),
          h('td', { class: 'small-text muted' }, fmtTime(f.updated_at)),
          h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn btn-text' }, icon('open_in_new'), 'Xem'))))))));
    } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'card-body' }, h('div', { class: 'notice err' }, icon('error'), errorText(e)))); }
  }

  /* ---------------- Viết kịch bản ---------------- */
  function drawForm() {
    const f = film;
    const left = h('div'), right = h('div', { class: 'sticky-col' });
    els.body.append(h('div', { class: 'layout-2' }, left, right));
    const title = h('input', { class: 'input', value: f.title, placeholder: 'Ví dụ: Chuyến xe cuối ngày', maxlength: 120, oninput: (e) => { f.title = e.target.value; } });
    const style = h('input', { class: 'input', value: f.style, placeholder: 'Ví dụ: cinematic, warm film look, 35mm', oninput: (e) => { f.style = e.target.value; } });
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('movie_edit'), h('h2', {}, 'Phim')),
      h('div', { class: 'card-body' }, field('Tên phim', title), field('Phong cách hình ảnh', style, 'Tiếng Anh, áp dụng cho mọi cảnh.', true),
        field('Khung hình', chipGroup([['16:9', 'Ngang 16:9'], ['9:16', 'Dọc 9:16'], ['1:1', 'Vuông 1:1']].map(([value, label]) => ({ value, label, ratio: value })),
          f.aspect, (v) => { f.aspect = v; setPref('apAspect', v); })))));

    // Nhân vật
    const chars = h('div');
    const drawChars = () => {
      chars.innerHTML = '';
      chars.append(h('div', { class: 'cast-pick' }, cast.map((c) => {
        const on = f.characters.some((x) => x.card === c.id);
        return h('button', { class: 'cast-chip' + (on ? ' on' : ''), type: 'button', onclick: () => {
          if (on) f.characters = f.characters.filter((x) => x.card !== c.id); else f.characters.push({ key: c.name.slice(0, 40), card: c.id });
          drawChars(); drawShots();
        } }, castPicture(c) ? h('img', { src: mediaUrl(castPicture(c)), alt: '' }) : icon('person'), h('span', {}, c.name));
      }), h('button', { class: 'cast-chip', type: 'button', onclick: () => {
        const name = h('input', { class: 'input', maxlength: 40, placeholder: 'Ví dụ: Minh' });
        const look = h('input', { class: 'input', placeholder: 'Ví dụ: young man, short hair, blue jacket' });
        openModal([modalHead('Nhân vật không có thẻ', 'person'), field('Tên', name), field('Ngoại hình (tiếng Anh)', look),
          h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Huỷ'), h('button', { class: 'btn btn-primary', onclick: () => {
            if (!name.value.trim()) return;
            f.characters.push({ key: name.value.trim(), look: look.value.trim() }); closeModal(); drawChars(); drawShots();
          } }, icon('add'), 'Thêm'))]);
        setTimeout(() => name.focus(), 0);
      } }, icon('add'), h('span', {}, 'Nhân vật không có thẻ'))));
      const loose = f.characters.filter((x) => !x.card);
      if (loose.length) chars.append(h('div', { class: 'help' }, 'Không có thẻ: ' + loose.map((x) => x.key).join(', ')));
      if (!cast.length) chars.append(h('div', { class: 'help' }, 'Mẹo: tạo thẻ ở trang ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('cast'); } }, 'Nhân vật'), ' để AI giữ đúng mặt và giọng qua mọi cảnh.'));
    };
    drawChars();
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('groups'), h('h2', {}, 'Nhân vật trong phim')), h('div', { class: 'card-body' }, chars)));

    // Các cảnh
    const shotsBox = h('div');
    const drawShots = () => {
      shotsBox.innerHTML = '';
      f.shots.forEach((s, i) => {
        const action = h('textarea', { class: 'textarea', placeholder: 'Chuyện gì xảy ra trong cảnh này? Ví dụ: Lan walks into the rainy bus stop and sees Minh waiting alone.',
          oninput: (e) => { s.action = e.target.value; } });
        action.value = s.action;
        const lines = h('div');
        const drawLines = () => {
          lines.innerHTML = '';
          s.lines.forEach((l, j) => {
            const who = h('select', { class: 'select mini', onchange: (e) => { l.who = e.target.value; } }, f.characters.map((c) => h('option', { value: c.key, selected: c.key === l.who }, c.key)));
            if (!l.who && f.characters[0]) l.who = f.characters[0].key;
            lines.append(h('div', { class: 'line-row' }, who,
              h('input', { class: 'input', value: l.line, placeholder: 'Câu thoại (giữ nguyên ngôn ngữ muốn nói, ví dụ tiếng Việt)', oninput: (e) => { l.line = e.target.value; } }),
              h('button', { class: 'icon-btn', onclick: () => { s.lines.splice(j, 1); drawLines(); } }, icon('close'))));
          });
          lines.append(h('button', { class: 'btn btn-text', disabled: !f.characters.length, title: f.characters.length ? '' : 'Thêm nhân vật trước', onclick: () => { s.lines.push({ who: f.characters[0] && f.characters[0].key, line: '' }); drawLines(); } }, icon('chat'), 'Thêm câu thoại'));
        };
        drawLines();
        const castChips = f.characters.length ? h('div', { class: 'chips' }, f.characters.map((c) => {
          const on = s.cast.includes(c.key);
          return h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', onclick: (e) => {
            if (on) s.cast = s.cast.filter((x) => x !== c.key); else s.cast.push(c.key); e.currentTarget.classList.toggle('on');
          } }, c.key);
        })) : h('div', { class: 'help' }, 'Chưa chọn nhân vật cho phim.');
        const camera = h('input', { class: 'input', value: s.camera, placeholder: 'Ví dụ: slow push-in, handheld close-up', oninput: (e) => { s.camera = e.target.value; } });
        shotsBox.append(h('div', { class: 'shot-card' },
          h('div', { class: 'shot-head' }, h('b', {}, 'Cảnh ' + (i + 1)),
            h('div', { class: 'grow' }),
            i > 0 ? switchToggle('Nối tiếp cảnh trước', null, s.continue, (v) => { s.continue = v; }) : null,
            h('button', { class: 'icon-btn', title: 'Lên', disabled: i === 0, onclick: () => { f.shots.splice(i - 1, 0, f.shots.splice(i, 1)[0]); drawShots(); } }, icon('arrow_upward')),
            h('button', { class: 'icon-btn', title: 'Xoá cảnh', disabled: f.shots.length === 1, onclick: () => { f.shots.splice(i, 1); drawShots(); } }, icon('delete'))),
          field(null, action),
          h('div', { class: 'grid-2' },
            field('Thời lượng', slider({ min: 4, max: 15, value: s.seconds, suffix: 'giây', onChange: (v) => { s.seconds = v; } })),
            field('Góc máy', camera, null, true)),
          field('Ai xuất hiện', castChips),
          field('Lời thoại', lines, null, true)));
      });
      shotsBox.append(h('button', { class: 'btn btn-outline', style: { width: '100%' }, disabled: f.shots.length >= 40, onclick: () => { f.shots.push(blankShot()); drawShots(); } }, icon('add'), 'Thêm cảnh'));
    };
    drawShots();
    left.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('view_carousel'), h('h2', {}, 'Các cảnh'), h('span', { class: 'hint' }, 'mỗi cảnh 4–15 giây, có thể cắt nhiều góc bên trong')),
      h('div', { class: 'card-body' }, shotsBox)));

    // Cột phải: số bản, ước tính, bắt đầu
    const planBox = h('div');
    const start = h('button', { class: 'btn btn-primary btn-hero', onclick: () => go(true) }, icon('smart_toy'), 'Bắt đầu Autopilot');
    right.append(h('div', { class: 'card', style: { marginBottom: 0 } }, h('div', { class: 'card-body' },
      packNotice('AI tự chọn bản đẹp nhất cần gói "AI viết prompt" (Prompt VLM).'),
      field('Số bản quay mỗi cảnh', chipGroup([1, 2, 3, 4].map((n) => ({ value: n, label: n + ' bản' })), f.takes, (v) => { f.takes = v; }),
        'Nhiều bản → AI có nhiều lựa chọn hơn, nhưng lâu hơn tương ứng.'),
      h('button', { class: 'btn btn-outline', style: { width: '100%' }, onclick: () => go(false) }, icon('fact_check'), 'Kiểm tra & ước tính thời gian'),
      planBox, h('div', { class: 'mt' }, start), aiLabelNote(),
      h('button', { class: 'btn btn-text mt', onclick: () => { if (confirm('Xoá kịch bản đang viết?')) { film = blankFilm(); draw(); } } }, icon('restart_alt'), 'Viết lại từ đầu'))));
    els.planBox = planBox; els.start = start;
  }

  function screenplay() {
    const f = film;
    const characters = {};
    for (const c of f.characters) characters[c.key] = c.card ? { card: c.card } : { look: c.look || '' };
    const shots = f.shots.map((s, i) => {
      const shot = { id: 'shot-' + (i + 1), seconds: Number(s.seconds) || 10, action: s.action.trim() };
      if (s.camera.trim()) shot.camera = s.camera.trim();
      if (s.cast.length) shot.cast = s.cast.slice();
      const lines = s.lines.filter((l) => l.who && l.line.trim()).map((l) => ({ who: l.who, line: l.line.trim() }));
      if (lines.length) shot.lines = lines;
      if (i > 0 && s.continue) shot.continue = true;
      return shot;
    });
    const play = { title: f.title.trim() || 'Phim Max AI', aspect: f.aspect, characters, shots };
    if (f.style.trim()) play.style = f.style.trim();
    return play;
  }

  async function go(startIt) {
    const f = film;
    const empty = f.shots.findIndex((s) => !s.action.trim());
    if (empty >= 0) { toast('Cảnh ' + (empty + 1) + ' chưa có nội dung', { kind: 'err' }); return; }
    const body = { screenplay: screenplay(), takes_per_shot: f.takes, director: 'builtin' };
    els.planBox.innerHTML = '';
    els.start.disabled = true;
    try {
      const plan = await api('POST', '/drama/plan', body);
      const secs = plan.estimate && plan.estimate.seconds;
      const total = (plan.preview && plan.preview.total) || f.shots.length * f.takes;
      els.planBox.append(h('div', { class: 'notice info' }, icon('schedule'),
        h('div', {}, h('b', {}, total + ' lần quay'), secs ? ' · ước tính ~' + fmtDuration(secs) + ' trên máy này' : '',
          h('div', { class: 'small-text' }, 'Kịch bản hợp lệ. Có thể tắt Max AI ở màn hình khác trong lúc quay, nhưng đừng tắt engine.'))));
      if (!startIt) return;
      const r = await api('POST', '/drama', body);
      const made = r.drama || r;
      toast('Autopilot đã bắt đầu quay', { kind: 'ok', sub: 'Theo dõi từng cảnh ở đây.' });
      film = blankFilm(); view = 'list'; openId = made.id; draw();
    } catch (e) {
      const rows = (e.details || []).slice(0, 6).map((d) => h('li', {}, (d.path || '').replace('/screenplay', '') + ': ' + (d.message || '')));
      els.planBox.append(h('div', { class: 'notice err' }, icon('error'), h('div', {}, errorText(e), rows.length ? h('ul', { class: 'small-text' }, rows) : null)));
    } finally { if (els.start) els.start.disabled = false; }
  }

  /* ---------------- Theo dõi 1 phim ---------------- */
  async function drawFilm(id) {
    const box = h('div');
    els.body.append(box);
    const refresh = async () => {
      let d;
      try { d = await api('GET', '/drama/' + id); d = d.drama || d; }
      catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'notice err' }, icon('error'), errorText(e))); return; }
      box.innerHTML = '';
      const out = (d.outputs || [])[d.outputs ? d.outputs.length - 1 : 0];
      const busy = !out && !/fail|cancel/.test(d.status);
      const takes = (d.shots || []).flatMap((s) => s.takes || []);
      const doneTakes = takes.filter((t) => t.state === 'succeeded').length;
      box.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('smart_toy'), h('h2', {}, d.title || (d.screenplay && d.screenplay.title) || id),
        h('span', { class: 'pill' + (out ? ' ok' : /fail/.test(d.status) ? ' bad' : ' info') }, FILM_STATE[d.status] || d.status),
        h('div', { class: 'grow' }),
        busy ? h('button', { class: 'btn btn-text btn-danger', onclick: async () => {
          if (!confirm('Huỷ các lần quay chưa xong? Bản đã quay vẫn giữ lại.')) return;
          try { await api('POST', '/drama/' + id + '/cancel', {}); toast('Đã huỷ'); refresh(); } catch (e) { toastError(e); }
        } }, icon('stop_circle'), 'Huỷ') : null),
        h('div', { class: 'card-body' },
          busy ? h('div', {}, progressBar(takes.length ? doneTakes / takes.length : null),
            h('div', { class: 'small-text muted', style: { marginTop: '6px' } }, doneTakes + '/' + takes.length + ' lần quay xong · AI tự chọn bản đẹp nhất của từng cảnh rồi ghép phim')) : null,
          out && out.library_id ? h('div', {}, h('video', { class: 'film-out', src: mediaUrl(LIB + out.library_id + '/file'), controls: true }),
            h('div', { class: 'job-actions' }, h('button', { class: 'btn btn-primary', onclick: () => saveMedia(LIB + out.library_id + '/file', (d.title || 'phim') + '.mp4') }, icon('download'), 'Tải phim về'),
              h('button', { class: 'btn btn-text', onclick: () => { App.handoff = { page: 'subtitles', source: { source: 'work:' + out.library_id, name: d.title, preview: LIB + out.library_id + '/file' } }; navigate('subtitles'); } }, icon('subtitles'), 'Thêm phụ đề'),
              h('button', { class: 'btn btn-text', onclick: () => { App.handoff = { page: 'dubbing', source: { source: 'work:' + out.library_id, name: d.title, preview: LIB + out.library_id + '/file' } }; navigate('dubbing'); } }, icon('record_voice_over'), 'Lồng tiếng'))) : null)));
      for (const s of d.shots || []) {
        box.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('b', {}, 'Cảnh ' + (s.index || '')),
          h('span', { class: 'small-text muted clamp1', style: { maxWidth: '60%' } }, shotText(d, s)),
          h('div', { class: 'grow' }), h('span', { class: 'pill' + (s.chosen ? ' ok' : '') }, s.chosen ? 'Đã chọn bản ' + s.chosen : (SHOT_STATE[s.state] || s.state))),
          h('div', { class: 'card-body take-row' }, (s.takes || []).map((t) => h('div', { class: 'take' + (s.chosen === t.take ? ' chosen' : '') },
            t.library_id ? h('img', { src: mediaUrl(LIB + t.library_id + '/thumbnail'), alt: '', onclick: () => openDrawer('Cảnh ' + s.index + ' · bản ' + t.take, h('video', { src: mediaUrl(LIB + t.library_id + '/file'), controls: true, autoplay: true })) })
              : h('div', { class: 'ph' }, ACTIVE.has(t.state) ? icon('progress_activity', 'spin') : icon(t.state === 'failed' ? 'error' : 'schedule')),
            h('div', { class: 'small-text' }, 'Bản ' + t.take + (s.chosen === t.take ? ' ★' : ''), h('span', { class: 'muted' }, ' · ' + ((STATUS[t.state] || [t.state])[0]))))))));
      }
      const notes = (d.decisions || []).slice(-6).reverse();
      if (notes.length) box.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('psychology'), h('h2', {}, 'AI đạo diễn ghi chú')),
        h('div', { class: 'card-body' }, notes.map((n) => h('div', { class: 'small-text', style: { marginBottom: '6px' } }, h('b', {}, ({ choose: 'Chọn bản', reshoot: 'Quay lại', finish: 'Ghép phim', finished: 'Hoàn tất', error: 'Dừng' }[n.action || n.kind] || n.action || n.kind || '') + ': '), n.reason || n.note || '')))));
      if (busy && openId === id && view === 'list') timer = setTimeout(refresh, 4000);
    };
    els.body.prepend(h('button', { class: 'btn btn-text', onclick: () => { openId = null; draw(); } }, icon('arrow_back'), 'Tất cả phim'));
    refresh();
  }
  function shotText(d, s) {
    const play = d.screenplay || {};
    const src = (play.shots || [])[(s.index || 1) - 1] || {};
    return src.action || src.idea || src.prompt || '';
  }

  return { render, leave };
})());
