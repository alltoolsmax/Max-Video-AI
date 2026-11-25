'use strict';
/* Trang Thư viện: video đã tạo */

registerPage('library', (() => {
  const els = {};
  let next = null;
  let query = '';
  let loading = false;
  const selected = new Set();   // id các video đang chọn
  let items = [];

  function render(root, params) {
    query = (params && params.query) || '';
    next = null;
    const page = h('div', { class: 'page' });
    els.search = h('input', { class: 'input', style: { width: '320px' }, placeholder: 'Lọc theo nội dung prompt…', value: query,
      onkeydown: (e) => { if (e.key === 'Enter') { query = els.search.value.trim(); reload(); } } });
    page.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Thư viện'), h('div', { class: 'sub' }, 'Tất cả video đã tạo, lưu ngay trên máy này.')),
      h('div', { class: 'grow' }), els.search,
      h('button', { class: 'btn btn-outline', onclick: () => { query = els.search.value.trim(); reload(); } }, icon('search'), 'Tìm'),
      h('button', { class: 'btn', onclick: selectAll }, icon('checklist'), 'Chọn tất cả'),
      h('button', { class: 'btn btn-danger', onclick: deleteAll }, icon('delete_sweep'), 'Xoá toàn bộ')));
    els.selbar = h('div');
    page.append(els.selbar);
    els.grid = h('div', { class: 'gallery' });
    els.more = h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px' } });
    page.append(els.grid, els.more);
    root.append(page);
    reload();
  }

  async function reload() {
    els.grid.innerHTML = '';
    next = null; items = []; selected.clear(); drawSelbar();
    await loadMore();
  }

  async function loadMore() {
    if (loading) return;
    loading = true;
    els.more.innerHTML = '';
    els.more.append(h('span', { class: 'muted' }, icon('progress_activity', 'spin'), ' Đang tải…'));
    try {
      const params = new URLSearchParams({ limit: '24' });
      if (next) params.set('before', next);
      if (query) params.set('query', query);
      const data = await api('GET', '/library?' + params);
      for (const item of data.items || []) { items.push(item); els.grid.append(tile(item)); }
      next = data.next || null;
      els.more.innerHTML = '';
      if (next) els.more.append(h('button', { class: 'btn btn-outline', onclick: loadMore }, 'Tải thêm'));
      if (!els.grid.children.length) {
        els.more.append(h('div', { class: 'empty' }, icon('video_library'), h('h3', {}, query ? 'Không có video khớp "' + query + '"' : 'Thư viện trống'),
          h('div', {}, 'Video bạn tạo sẽ được lưu ở đây.')));
      }
    } catch (error) {
      els.more.innerHTML = '';
      els.more.append(h('div', { class: 'empty' }, icon('link_off'), h('h3', {}, 'Không tải được thư viện'), h('div', {}, errorText(error)),
        h('button', { class: 'btn btn-outline mt', onclick: reload }, 'Thử lại')));
    } finally { loading = false; }
  }

  function tile(item) {
    const thumb = h('img', { src: mediaUrl(item.thumbnail), alt: '', loading: 'lazy' });
    let video = null;
    const media = h('div', { class: 'media' }, thumb,
      item.seconds ? h('span', { class: 'dur' }, Number(item.seconds).toFixed(1) + 's') : null,
      item.preview ? h('span', { class: 'tag' }, 'Bản xem trước') : null);
    media.addEventListener('mouseenter', () => {
      if (!item.video || !item.video.url) return;
      video = h('video', { src: mediaUrl(item.video.url), muted: true, autoplay: true, loop: true, playsinline: true });
      media.append(video);
    });
    media.addEventListener('mouseleave', () => { if (video) { video.remove(); video = null; } });
    const check = h('button', { class: 'tile-check', title: 'Chọn', onclick: (e) => { e.stopPropagation(); toggle(item.id, el); } }, icon('check', 'small'));
    const del = h('button', { class: 'tile-del', title: 'Xoá video này', onclick: (e) => { e.stopPropagation(); remove([item.id], 'Xoá video này?'); } }, icon('delete', 'small'));
    media.append(check, del);
    const el = h('div', { class: 'tile' + (selected.has(item.id) ? ' sel' : ''), 'data-id': item.id, onclick: () => (selected.size ? toggle(item.id, el) : open(item)) }, media,
      h('div', { class: 'info' }, h('div', { class: 'p' }, firstSentence(item.prompt) || 'Không có prompt'),
        h('div', { class: 'm' }, fmtTime(item.created_at), item.width ? ' · ' + item.width + '×' + item.height : '')));
    return el;
  }

  /* ---------- Chọn nhiều & xoá ---------- */
  function toggle(id, el) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    if (el) el.classList.toggle('sel', selected.has(id));
    drawSelbar();
  }
  function selectAll() {
    const all = items.length && items.every((i) => selected.has(i.id));
    selected.clear();
    if (!all) items.forEach((i) => selected.add(i.id));
    els.grid.querySelectorAll('.tile').forEach((t) => t.classList.toggle('sel', selected.has(t.dataset.id)));
    drawSelbar();
  }
  function drawSelbar() {
    if (!els.selbar) return;
    els.selbar.innerHTML = '';
    if (!selected.size) return;
    els.selbar.append(h('div', { class: 'selbar' }, icon('check_circle'), h('b', {}, 'Đã chọn ' + selected.size), h('div', { class: 'grow' }),
      h('button', { class: 'btn btn-text btn-danger', onclick: () => remove([...selected], 'Xoá ' + selected.size + ' video đã chọn?') }, icon('delete'), 'Xoá ' + selected.size + ' mục đã chọn'),
      h('button', { class: 'btn btn-text', onclick: () => { selected.clear(); els.grid.querySelectorAll('.tile.sel').forEach((t) => t.classList.remove('sel')); drawSelbar(); } }, 'Bỏ chọn')));
  }
  async function remove(ids, question) {
    if (!ids.length || !confirm(question + '\nVideo sẽ bị xoá khỏi máy, không khôi phục được.')) return;
    const r = await window.fv.deleteLibrary(ids);
    if (!r.ok) { toastError(r.error, 'Không xoá được'); return; }
    const { deleted, skipped } = r.data;
    toast('Đã xoá ' + deleted + ' video', { kind: 'ok', sub: skipped.length ? skipped.length + ' video đang được dùng (dự án dựng, phim Autopilot) nên giữ lại.' : undefined });
    reload();
  }
  async function deleteAll() {
    if (!confirm('Xoá TOÀN BỘ video trong Thư viện?\nKhông khôi phục được.')) return;
    const ids = [];
    let before = null;
    try {
      for (let i = 0; i < 200; i++) {
        const params = new URLSearchParams({ limit: '100' });
        if (before) params.set('before', before);
        const data = await api('GET', '/library?' + params);
        ids.push(...(data.items || []).map((x) => x.id));
        before = data.next || null;
        if (!before) break;
      }
    } catch (e) { toastError(e, 'Không đọc được thư viện'); return; }
    if (!ids.length) { toast('Thư viện đang trống'); return; }
    const r = await window.fv.deleteLibrary(ids);
    if (!r.ok) { toastError(r.error, 'Không xoá được'); return; }
    toast('Đã xoá ' + r.data.deleted + ' video', { kind: 'ok', sub: r.data.skipped.length ? r.data.skipped.length + ' video đang được dùng nên giữ lại.' : undefined });
    reload();
  }

  async function open(item) {
    const body = h('div', {}, h('video', { src: mediaUrl(item.video && item.video.url), controls: true, autoplay: true }));
    const meta = h('div');
    body.append(meta);
    const actions = [
      h('button', { class: 'btn btn-outline', onclick: () => { closeDrawer(); App.handoff = { page: 'video', continueFrom: { value: { library: item.id }, title: firstSentence(item.prompt) || item.id } }; navigate('video'); } }, icon('fast_forward'), 'Làm tiếp'),
      h('button', { class: 'btn btn-outline', onclick: () => { closeDrawer(); App.handoff = { page: 'video', prompt: detail ? detail.prompt : item.prompt }; navigate('video'); } }, icon('replay'), 'Dùng lại prompt'),
      h('button', { class: 'btn btn-primary', onclick: () => saveMedia(item.video.url, 'video-' + item.id.replace('/', '-') + '.mp4') }, icon('download'), 'Tải về'),
    ];
    let detail = null;
    openDrawer('Chi tiết video', body, actions);
    try {
      detail = await api('GET', '/library/' + item.id);
      const g = detail.geometry || {};
      meta.append(h('dl', { class: 'kv mt' },
        h('dt', {}, 'Tạo lúc'), h('dd', {}, fmtTime(item.created_at)),
        g.width ? [h('dt', {}, 'Kích thước'), h('dd', {}, g.width + ' × ' + g.height)] : null,
        g.seconds ? [h('dt', {}, 'Thời lượng'), h('dd', {}, Number(g.seconds).toFixed(1) + ' giây · ' + g.frames + ' khung · ' + g.fps + ' fps')] : null,
        detail.seed !== null && detail.seed !== undefined ? [h('dt', {}, 'Seed'), h('dd', {}, String(detail.seed))] : null,
        detail.sample_seconds ? [h('dt', {}, 'Thời gian tạo'), h('dd', {}, fmtDuration(detail.sample_seconds))] : null,
        detail.preview ? [h('dt', {}, 'Loại'), h('dd', {}, 'Bản xem trước')] : null));
      if (detail.prompt) meta.append(h('div', { class: 'label mt' }, 'Prompt'), h('div', { class: 'prompt-box' }, detail.prompt));
    } catch (error) {
      meta.append(h('div', { class: 'notice err' }, icon('error'), errorText(error)));
    }
  }

  return { render };
})());
