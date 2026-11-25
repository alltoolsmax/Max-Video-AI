'use strict';
/* Trang Hàng đợi: mọi việc engine đang làm */

registerPage('queue', (() => {
  let unsub = [];
  let filter = 'all';
  let kind = 'all';
  const els = {};

  const FILTERS = [
    { value: 'all', label: 'Tất cả' }, { value: 'active', label: 'Đang chạy / chờ' },
    { value: 'succeeded', label: 'Hoàn tất' }, { value: 'problem', label: 'Lỗi / huỷ' },
  ];

  function render(root) {
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Hàng đợi'), h('div', { class: 'sub' }, 'GPU chạy lần lượt từng việc, việc nào xong sẽ có thông báo.')),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-outline', onclick: () => Poller.soon(0) }, icon('refresh'), 'Làm mới')));
    const kinds = h('select', { class: 'select', style: { width: '160px' }, onchange: (e) => { kind = e.target.value; draw(App.jobs); } },
      h('option', { value: 'all' }, 'Mọi loại'), h('option', { value: 'generate' }, 'Video'), h('option', { value: 'image' }, 'Ảnh'), h('option', { value: 'other' }, 'Khác'));
    els.body = h('tbody');
    els.empty = h('div');
    page.append(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, chipGroup(FILTERS, filter, (v) => { filter = v; draw(App.jobs); }), h('div', { style: { flex: 1 } }), kinds),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['', 'Trạng thái', 'Loại', 'Nội dung', 'Tiến độ', 'Tạo lúc', 'Thời gian chạy', ''].map((t) => h('th', {}, t)))),
        els.body)), els.empty));
    root.append(page);
    draw(App.jobs);
    unsub = [App.on('jobs', draw)];
    Poller.soon(0);
  }
  function leave() { unsub.forEach((u) => u()); }

  function matches(job) {
    if (filter === 'active' && !ACTIVE.has(job.status)) return false;
    if (filter === 'succeeded' && job.status !== 'succeeded') return false;
    if (filter === 'problem' && !['failed', 'cancelled', 'interrupted'].includes(job.status)) return false;
    if (kind === 'other') return !['generate', 'image'].includes(job.kind);
    return kind === 'all' || job.kind === kind;
  }

  function elapsed(job) {
    if (!job.started_at) return '—';
    const end = job.finished_at ? new Date(job.finished_at) : new Date();
    return fmtDuration((end - new Date(job.started_at)) / 1000);
  }

  function draw(jobs) {
    const rows = (jobs || []).filter(matches);
    els.body.innerHTML = '';
    els.empty.innerHTML = '';
    if (!rows.length) {
      els.empty.append(h('div', { class: 'empty' }, icon('inbox'), h('h3', {}, App.connected ? 'Không có job nào' : 'Engine chưa chạy'),
        h('div', {}, App.connected ? 'Tạo video hoặc ảnh để bắt đầu.' : errorText(App.connectionError))));
      return;
    }
    for (const job of rows) {
      const p = progressInfo(job);
      const video = jobVideo(job);
      const images = jobImages(job);
      let thumb = h('div', { class: 'thumb' });
      if (job.status === 'succeeded' && video && job.result.library_id) thumb = h('img', { class: 'thumb', src: mediaUrl('/freevideo/agent/v1/library/' + job.result.library_id + '/thumbnail'), alt: '' });
      else if (images[0]) thumb = h('img', { class: 'thumb', src: mediaUrl(images[0].url), alt: '' });
      const actions = h('div', { class: 'row tight', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } });
      if (ACTIVE.has(job.status)) actions.append(h('button', { class: 'icon-btn', title: 'Huỷ', onclick: (e) => { e.stopPropagation(); cancelJob(job.id); } }, icon('stop_circle')));
      if (['failed', 'interrupted'].includes(job.status)) actions.append(h('button', { class: 'icon-btn', title: 'Chạy lại', onclick: (e) => { e.stopPropagation(); resumeJob(job.id); } }, icon('restart_alt')));
      if (video && video.url) actions.append(h('button', { class: 'icon-btn', title: 'Tải về', onclick: (e) => { e.stopPropagation(); saveMedia(video.url, 'video-' + job.id + '.mp4'); } }, icon('download')));
      if (images[0]) actions.append(h('button', { class: 'icon-btn', title: 'Tải về', onclick: (e) => { e.stopPropagation(); saveMedia(images[0].url, 'image-' + job.id + '.png'); } }, icon('download')));
      els.body.append(h('tr', { style: { cursor: 'pointer' }, onclick: () => showJob(job.id) },
        h('td', {}, thumb),
        h('td', {}, statusBadge(job.status)),
        h('td', {}, KINDS[job.kind] || job.kind),
        h('td', { class: 'prompt-cell', title: jobTitle(job) }, jobTitle(job), job.client && job.client !== 'Max AI' ? h('div', { class: 'small-text muted' }, 'từ ' + job.client) : null),
        h('td', {}, ACTIVE.has(job.status) ? h('div', { class: 'mini-progress' }, h('div', { class: 'lbl', title: p.label }, p.label), progressBar(p.fraction))
          : job.error ? h('span', { class: 'small-text', style: { color: 'var(--red)' } }, errorText(job.error)) : '—'),
        h('td', { style: { whiteSpace: 'nowrap' } }, fmtTime(job.created_at)),
        h('td', { style: { whiteSpace: 'nowrap' } }, elapsed(job)),
        h('td', {}, actions)));
    }
  }

  async function showJob(id) {
    let job;
    try { job = await jobDetail(id, true); } catch (e) { toastError(e); return; }
    const spec = job.spec || {};
    const video = jobVideo(job);
    const images = jobImages(job);
    const body = h('div');
    if (video && video.url) body.append(h('video', { src: mediaUrl(video.url), controls: true, autoplay: true }));
    for (const img of images) body.append(h('img', { class: 'big', src: mediaUrl(img.url), alt: '' }));
    if (job.error) body.append(h('div', { class: 'notice err' }, icon('error'), h('div', {}, errorText(job.error), job.error.next ? h('div', { class: 'small-text' }, job.error.next) : null)));
    const r = job.result || {};
    body.append(h('dl', { class: 'kv mt' },
      h('dt', {}, 'Trạng thái'), h('dd', {}, statusBadge(job.status)),
      h('dt', {}, 'Mã job'), h('dd', {}, job.id),
      h('dt', {}, 'Tạo lúc'), h('dd', {}, fmtTime(job.created_at)),
      h('dt', {}, 'Thời gian chạy'), h('dd', {}, elapsed(job)),
      r.width ? [h('dt', {}, 'Kích thước'), h('dd', {}, r.width + ' × ' + r.height + (r.seconds ? ' · ' + Number(r.seconds).toFixed(1) + ' giây' : ''))] : null,
      spec.quality ? [h('dt', {}, 'Chất lượng'), h('dd', {}, (QUALITY_TEXT[spec.quality] || [spec.quality])[0])] : null,
      (r.seed ?? spec.seed) !== undefined && (r.seed ?? spec.seed) !== null ? [h('dt', {}, 'Seed'), h('dd', {}, String(r.seed ?? spec.seed))] : null,
      job.client ? [h('dt', {}, 'Gửi từ'), h('dd', {}, job.client)] : null));
    if (typeof spec.prompt === 'string') body.append(h('div', { class: 'label mt' }, 'Prompt'), h('div', { class: 'prompt-box' }, spec.prompt));
    const actions = [];
    if (job.kind === 'generate' && typeof spec.prompt === 'string') {
      actions.push(h('button', { class: 'btn btn-outline', onclick: () => { closeDrawer(); App.handoff = { page: 'video', spec }; navigate('video'); } }, icon('replay'), 'Dùng lại'));
    }
    if (video && video.url) actions.push(h('button', { class: 'btn btn-primary', onclick: () => saveMedia(video.url, 'video-' + job.id + '.mp4') }, icon('download'), 'Tải về'));
    if (images[0]) actions.push(h('button', { class: 'btn btn-primary', onclick: () => saveMedia(images[0].url, 'image-' + job.id + '.png') }, icon('download'), 'Tải về'));
    openDrawer(KINDS[job.kind] || job.kind, body, actions);
  }

  return { render, leave, showJob };
})());
