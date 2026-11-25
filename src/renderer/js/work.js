'use strict';
/* Công cụ dùng chung cho Sửa ảnh, Nhân vật, Autopilot, Lồng tiếng, Phụ đề. */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chờ 1 job xong (gọi onProgress mỗi lần đọc). Trả về job cuối cùng; ném lỗi nếu job lỗi/huỷ.
async function waitJob(id, onProgress, { every = 1500, stop } = {}) {
  for (;;) {
    if (stop && stop()) throw new Error('Đã dừng');
    const job = await api('GET', '/jobs/' + id);
    if (onProgress) onProgress(job);
    if (job.status === 'succeeded') return job;
    if (!ACTIVE.has(job.status)) {
      const err = job.error || {};
      throw new ApiError({ code: err.code || job.status, message: errorText(err) || ('Việc bị ' + (STATUS[job.status] || [job.status])[0].toLowerCase()), next: err.next }, 0);
    }
    await sleep(every);
  }
}

// Dòng tiến độ của 1 việc (cập nhật tại chỗ)
function jobProgressLine() {
  const label = h('div', { class: 'small-text muted' }, 'Đang gửi…');
  const bar = progressBar(null);
  const box = h('div', { class: 'job-progress' }, bar, label);
  box.update = (job) => {
    const p = progressInfo(job);
    bar.replaceWith(box.bar = progressBar(p.fraction));
    label.textContent = p.label;
  };
  box.bar = bar;
  box.set = (text, fraction = null) => { const nb = progressBar(fraction); box.bar.replaceWith(nb); box.bar = nb; label.textContent = text; };
  return box;
}

/* ---------- Chọn video nguồn: từ Thư viện hoặc file trên máy ---------- */
// onPick({ source: 'work:…' | 'import:…', name, preview, thumbnail, seconds })
function pickVideoSource(onPick, { title = 'Chọn video' } = {}) {
  const grid = h('div', { class: 'pick-grid' }, h('div', { class: 'muted' }, 'Đang đọc thư viện…'));
  const status = h('div');
  const fromFile = h('button', { class: 'btn btn-primary', onclick: async () => {
    const files = await window.fv.pickFiles(['video'], false);
    if (!files || !files[0]) return;
    const f = files[0];
    status.innerHTML = '';
    const line = jobProgressLine(); line.set('Đang đưa video vào engine… ' + fmtBytes(f.size));
    status.append(line);
    fromFile.disabled = true;
    try {
      const reply = await window.fv.importMedia(f.path);
      if (!reply.ok) throw new ApiError(reply.error || {}, reply.status);
      let item = reply.data.import || reply.data.item || reply.data;
      const id = item.id;
      for (let i = 0; i < 1200 && item.state !== 'ready'; i++) {
        if (item.state === 'failed') throw new ApiError({ message: 'Engine không đọc được video này' + (item.reason ? ': ' + item.reason : '') }, 0);
        line.set('Engine đang chuẩn bị video…', typeof item.fraction === 'number' ? item.fraction : null);
        await sleep(1000);
        const list = await api('GET', '/imports');
        item = (list.items || []).find((x) => x.id === id) || item;
      }
      closeModal();
      onPick({ source: item.source || ('import:' + id), name: f.name, preview: item.preview, thumbnail: item.thumbnail,
        seconds: item.frames && item.fps ? item.frames / item.fps : null });
    } catch (e) { status.innerHTML = ''; toastError(e, 'Không đưa được video vào'); }
    finally { fromFile.disabled = false; }
  } }, icon('upload_file'), 'Chọn file trên máy…');
  openModal([modalHead(title, 'video_library'),
    h('div', { class: 'row', style: { marginBottom: '10px' } }, fromFile, h('span', { class: 'muted small-text' }, 'hoặc chọn video đã tạo:')),
    status, grid], { wide: true });
  api('GET', '/library?limit=40').then((data) => {
    grid.innerHTML = '';
    const items = data.items || [];
    if (!items.length) grid.append(h('div', { class: 'muted' }, 'Thư viện trống.'));
    for (const item of items) {
      grid.append(h('button', { class: 'pick-tile', onclick: () => {
        closeModal();
        onPick({ source: 'work:' + item.id, name: firstSentence(item.prompt) || item.id, preview: item.video && item.video.url,
          thumbnail: item.thumbnail, seconds: item.seconds });
      } }, h('img', { src: mediaUrl(item.thumbnail), alt: '', loading: 'lazy' }),
        h('span', { class: 'cap' }, firstSentence(item.prompt) || item.id),
        item.seconds ? h('span', { class: 'dur' }, Number(item.seconds).toFixed(1) + 's') : null));
    }
  }).catch((e) => { grid.innerHTML = ''; grid.append(h('div', { class: 'notice err' }, icon('error'), errorText(e))); });
}

// Thẻ hiện video nguồn đã chọn
function sourceCard(src, onChange) {
  if (!src) {
    return h('button', { class: 'slot', style: { width: '100%', minHeight: '160px' }, onclick: () => pickVideoSource(onChange) },
      icon('video_library'), h('span', { class: 't' }, 'Chọn video'), h('span', { class: 'd' }, 'Từ Thư viện hoặc file trên máy'));
  }
  return h('div', { class: 'source-card' },
    src.preview ? h('video', { src: mediaUrl(src.preview), controls: true, preload: 'metadata' })
      : src.thumbnail ? h('img', { src: mediaUrl(src.thumbnail), alt: '' }) : null,
    h('div', { class: 'row', style: { marginTop: '8px' } }, icon('movie', 'small'), h('b', { class: 'grow ellipsis' }, src.name || src.source),
      h('button', { class: 'btn btn-text', onclick: () => pickVideoSource(onChange) }, icon('swap_horiz'), 'Đổi video')));
}

/* ---------- Dự án dựng ẩn (để phụ đề / lồng tiếng chạy trên 1 video) ---------- */
async function projectFromSource(src, name) {
  const created = await api('POST', '/projects', { project: { name: (name || 'Max Video AI').slice(0, 80) } });
  let project = created.project || created;
  const done = await api('POST', '/projects/' + project.id + '/operations', { revision: project.revision, operations: [{ op: 'insert', source: src.source, at: 0 }] });
  project = done.project || project;
  return project;
}
async function readProject(id) {
  const r = await api('GET', '/projects/' + id);
  return r.project || r;
}
function projectClip(project, kind) {
  for (const track of project.tracks || []) {
    if ((kind === 'audio' && (track.kind === 'audio' || /^a/.test(track.id))) || (kind === 'video' && (track.kind === 'video' || /^v/.test(track.id)))) {
      if (track.clips && track.clips.length) return track.clips[0];
    }
  }
  return null;
}
// Xuất dự án ra MP4 (lưu vào Thư viện). Trả về job.
async function exportProject(id, onProgress) {
  const project = await readProject(id);
  const r = await api('POST', '/projects/' + id + '/export', { revision: project.revision });
  const job = r.job || (r.jobs && r.jobs[0]);
  return waitJob(job.id, onProgress);
}

/* ---------- Thời gian ---------- */
const FPS = 24;
function fmtClock(sec, srt) {
  sec = Math.max(0, Number(sec) || 0);
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60, ss = Math.floor(sec) % 60, ms = Math.round((sec - Math.floor(sec)) * 1000) % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return srt ? `${p(hh)}:${p(mm)}:${p(ss)},${p(ms, 3)}` : (hh ? p(hh) + ':' : '') + `${p(mm)}:${p(ss)}.${String(Math.floor(ms / 100))}`;
}
function parseClock(text) {
  const parts = String(text).trim().replace(',', '.').split(':').map(Number);
  if (parts.some((n) => !isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${fmtClock(c.start, true)} --> ${fmtClock(c.end, true)}\n${c.text.trim()}\n`).join('\n');
}

// Tải 1 đoạn văn bản xuống máy (srt…)
function downloadText(text, name) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Cảnh báo khi thiếu gói mô hình cần cho trang
// Mô hình giờ được tải tự động khi mở app → không hiện khung nhắc "Cần gói…" nữa.
function packNotice() { return document.createDocumentFragment(); }
function packNoticeOld(text) {
  return h('div', { class: 'notice info', style: { marginTop: 0 } }, icon('deployed_code'),
    h('div', {}, text, ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('engine'); } }, 'Mở Engine & mô hình')));
}
function engineOffNotice() {
  return h('div', { class: 'notice err', style: { marginTop: 0 } }, icon('link_off'),
    h('div', {}, 'Engine chưa chạy. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate('engine'); } }, 'Mở Engine & mô hình')));
}

const LANGS = [['auto', 'Tự nhận diện'], ['vi', 'Tiếng Việt'], ['en', 'Tiếng Anh'], ['zh', 'Tiếng Trung'], ['ja', 'Tiếng Nhật'], ['ko', 'Tiếng Hàn'],
  ['fr', 'Tiếng Pháp'], ['de', 'Tiếng Đức'], ['es', 'Tiếng Tây Ban Nha'], ['ru', 'Tiếng Nga'], ['th', 'Tiếng Thái'], ['id', 'Tiếng Indonesia']];
function langSelect(value, onChange) {
  const s = h('select', { class: 'select', onchange: () => onChange(s.value) }, LANGS.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return s;
}
