'use strict';
/* Các thành phần giao diện dùng lại. */

function chipGroup(options, value, onChange, { multi = false } = {}) {
  const wrap = h('div', { class: 'chips' });
  const set = (v) => {
    value = v;
    wrap.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.value === String(v)));
  };
  for (const opt of options) {
    const chip = h('button', { class: 'chip', type: 'button', 'data-value': String(opt.value), title: opt.title || '' },
      opt.ratio ? ratioIcon(opt.ratio) : null, opt.icon ? icon(opt.icon, 'small') : null, opt.label);
    chip.addEventListener('click', () => { set(opt.value); onChange(opt.value); });
    wrap.append(chip);
  }
  set(value);
  wrap.setValue = set;
  return wrap;
}
function ratioIcon(ratio) {
  const [w, hgt] = ratio.split(':').map(Number);
  const scale = 14 / Math.max(w, hgt);
  return h('span', { class: 'ratio', style: { width: Math.max(5, w * scale) + 'px', height: Math.max(5, hgt * scale) + 'px' } });
}

function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented' });
  const set = (v) => { value = v; wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === v)); };
  for (const opt of options) {
    wrap.append(h('button', { type: 'button', 'data-value': opt.value, title: opt.title || '', onclick: () => { set(opt.value); onChange(opt.value); } },
      h('span', { class: 't' }, opt.label), opt.desc ? h('span', { class: 'd' }, opt.desc) : null));
  }
  set(value);
  wrap.setValue = set;
  return wrap;
}

function slider({ min, max, step = 1, value, onChange, suffix = '' }) {
  const range = h('input', { type: 'range', min, max, step, value });
  const num = h('input', { class: 'input num', type: 'number', min, max, step, value });
  const sync = (v, from) => {
    v = Math.min(max, Math.max(min, Number(v) || min));
    if (from !== range) range.value = v;
    if (from !== num) num.value = v;
    onChange(v);
  };
  range.addEventListener('input', () => sync(range.value, range));
  num.addEventListener('change', () => sync(num.value, num));
  const row = h('div', { class: 'slider-row' }, range, num, suffix ? h('span', { class: 'muted' }, suffix) : null);
  row.setValue = (v) => { range.value = v; num.value = v; };
  row.setMax = (m) => { max = m; range.max = m; num.max = m; if (Number(range.value) > m) sync(m); };
  return row;
}

function switchToggle(title, desc, checked, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked));
  const label = h('label', { class: 'switch' }, input, h('span', { class: 'txt' }, h('b', {}, title), desc ? h('span', {}, desc) : null));
  label.input = input;
  return label;
}

function field(label, control, help, optional) {
  return h('div', { class: 'field' },
    label ? h('div', { class: 'label' }, label, optional ? h('span', { class: 'opt' }, '(không bắt buộc)') : null) : null,
    control, help ? h('div', { class: 'help' }, help) : null);
}

/* Ô chọn file: bấm để chọn hoặc kéo-thả; tự đưa vào engine. value = { file, url, kind, name } */
function mediaSlot({ title, desc, kinds = ['image'], value = null, onChange, iconName = 'add_photo_alternate', extra }) {
  const slot = h('div', { class: 'slot', tabindex: 0, role: 'button' });
  let current = value;
  const render = (busy) => {
    slot.innerHTML = '';
    slot.classList.toggle('filled', Boolean(current));
    if (current) {
      const src = mediaUrl(current.url);
      if (current.kind === 'video') slot.append(h('video', { src, muted: true, loop: true, onmouseenter: (e) => e.target.play(), onmouseleave: (e) => e.target.pause() }));
      else if (current.kind === 'audio') slot.append(h('div', { style: { color: '#fff', display: 'grid', placeItems: 'center', height: '100%' } }, icon('graphic_eq', 'big')));
      else slot.append(h('img', { src, alt: '' }));
      slot.append(h('span', { class: 'slot-name' }, current.name || current.file));
      if (extra) slot.append(extra(current));
      slot.append(h('button', { class: 'slot-x', title: 'Bỏ', onclick: (e) => { e.stopPropagation(); current = null; render(); onChange(null); } }, icon('close', 'small')));
    } else {
      slot.append(icon(iconName), h('span', { class: 't' }, title), h('span', { class: 'd' }, desc || 'Bấm để chọn hoặc kéo thả'));
    }
    if (busy) slot.append(h('div', { class: 'busy' }, busy));
  };
  const accept = async (picked) => {
    if (!picked) return;
    if (!kinds.includes(picked.kind)) { toast('Ô này nhận: ' + kinds.join(', '), { kind: 'err' }); return; }
    render('Đang tải lên… ' + fmtBytes(picked.size));
    const reply = await window.fv.upload(picked.path);
    if (!reply.ok) { render(); toastError(reply.error, 'Tải lên thất bại'); return; }
    current = { file: reply.data.file, url: reply.data.url, kind: reply.data.kind || picked.kind, name: picked.name, info: reply.data };
    render();
    onChange(current);
  };
  slot.addEventListener('click', async () => {
    if (current) return;
    const files = await window.fv.pickFiles(kinds, false);
    if (files && files[0]) accept(files[0]);
  });
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('drag'));
  slot.addEventListener('drop', async (e) => {
    e.preventDefault(); slot.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) accept(await window.fv.dropped(file));
  });
  slot.setValue = (v) => { current = v; render(); };
  render();
  return slot;
}

/* Thẻ kết quả của 1 job (video hoặc ảnh), tự cập nhật khi job thay đổi. */
function jobCard(job, { onReuse, onContinue, onUseImage } = {}) {
  const card = h('div', { class: 'job', 'data-id': job.id });
  let lastKey = '';
  card.update = (j) => {
    const p = progressInfo(j);
    const key = j.status + '|' + p.label + '|' + p.fraction + '|' + (j.result ? 1 : 0);
    if (key === lastKey) return;
    const keepVideo = lastKey.startsWith('succeeded') && j.status === 'succeeded';
    lastKey = key;
    if (keepVideo) return;
    card.innerHTML = '';
    card.append(h('div', { class: 'job-top' }, statusBadge(j.status), h('div', { class: 'job-title', title: jobTitle(j) }, jobTitle(j))));
    if (ACTIVE.has(j.status)) {
      card.append(progressBar(p.fraction), h('div', { class: 'job-meta' }, h('span', {}, p.label)),
        h('div', { class: 'job-actions' }, h('button', { class: 'btn btn-text btn-danger', onclick: () => cancelJob(j.id) }, icon('stop_circle'), 'Huỷ')));
      if (j.notice) card.append(h('div', { class: 'job-meta' }, j.notice));
    } else if (j.status === 'succeeded') {
      const video = jobVideo(j);
      const images = jobImages(j);
      if (video && video.url) {
        card.append(h('video', { src: mediaUrl(video.url), controls: true, preload: 'metadata' }));
        card.append(h('div', { class: 'job-actions' },
          h('button', { class: 'btn btn-text', onclick: () => saveMedia(video.url, 'video-' + j.id + '.mp4') }, icon('download'), 'Tải về'),
          onReuse ? h('button', { class: 'btn btn-text', onclick: () => onReuse(j) }, icon('replay'), 'Dùng lại cài đặt') : null,
          onContinue ? h('button', { class: 'btn btn-text', onclick: () => onContinue(j) }, icon('fast_forward'), 'Làm tiếp') : null,
          j.result && j.result.preview ? h('button', { class: 'btn btn-text', onclick: () => refineJob(j) }, icon('high_quality'), 'Hoàn thiện bản đầy đủ') : null));
      }
      for (const img of images) {
        card.append(h('img', { class: 'result', src: mediaUrl(img.url), alt: '' }));
        card.append(h('div', { class: 'job-actions' },
          h('button', { class: 'btn btn-text', onclick: () => saveMedia(img.url, 'image-' + j.id + '.png') }, icon('download'), 'Tải về'),
          onUseImage ? h('button', { class: 'btn btn-text', onclick: () => onUseImage(j, img) }, icon('movie'), 'Làm video từ ảnh này') : null,
          onReuse ? h('button', { class: 'btn btn-text', onclick: () => onReuse(j) }, icon('replay'), 'Dùng lại') : null));
      }
    } else {
      const err = j.error || {};
      card.append(h('div', { class: 'notice err' }, icon('error'), h('div', {}, errorText(err), err.next && !ERROR_VI[err.code] && err.code !== 'invalid_request' ? h('div', { class: 'small-text' }, brandText(err.next)) : null)));
      if (j.status === 'interrupted' || j.status === 'failed') {
        card.append(h('div', { class: 'job-actions' }, h('button', { class: 'btn btn-text', onclick: () => resumeJob(j.id) }, icon('restart_alt'), 'Chạy lại')));
      }
    }
  };
  card.update(job);
  return card;
}

async function cancelJob(id) {
  try { await api('POST', '/jobs/' + id + '/cancel', {}); toast('Đã gửi lệnh huỷ'); Poller.soon(); }
  catch (e) { toastError(e, 'Không huỷ được'); }
}
async function resumeJob(id) {
  try { await api('POST', '/jobs/' + id + '/resume', {}); toast('Đã cho chạy lại'); Poller.soon(); }
  catch (e) { toastError(e, 'Không chạy lại được'); }
}
async function refineJob(job) {
  try {
    await api('POST', '/jobs', { kind: 'generate', refine_from: job.id, label: 'Hoàn thiện: ' + jobTitle(job).slice(0, 100) });
    toast('Đang hoàn thiện bản đầy đủ', { kind: 'ok' }); Poller.soon();
  } catch (e) { toastError(e, 'Không hoàn thiện được'); }
}

/* Danh sách LoRA: chọn tên + độ mạnh. value = [{name, strength}] */
function loraEditor(available, value, onChange) {
  const wrap = h('div');
  const list = value.slice();
  const render = () => {
    wrap.innerHTML = '';
    if (!available.length) {
      wrap.append(h('div', { class: 'help' }, 'Chưa có LoRA nào trong thư mục models/loras của ComfyUI.'));
      return;
    }
    list.forEach((row, i) => {
      const select = h('select', { class: 'select', onchange: () => { row.name = select.value; onChange(list); } },
        available.map((n) => h('option', { value: n, selected: n === row.name }, n)));
      const strength = slider({ min: -2, max: 2, step: 0.05, value: row.strength, onChange: (v) => { row.strength = v; onChange(list); } });
      strength.querySelector('input[type=number]').style.width = '72px';
      wrap.append(h('div', { class: 'lora-row' }, select, strength,
        h('button', { class: 'icon-btn', title: 'Bỏ LoRA', onclick: () => { list.splice(i, 1); render(); onChange(list); } }, icon('delete'))));
    });
    wrap.append(h('button', { class: 'btn btn-text', type: 'button', onclick: () => { list.push({ name: available[0], strength: 1 }); render(); onChange(list); } },
      icon('add'), 'Thêm LoRA'));
  };
  render();
  return wrap;
}
