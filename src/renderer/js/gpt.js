'use strict';
/* ChatGPT và AI trên máy: ô nhập API key, hàng nút "AI sửa Prompt" / "Viết kịch bản" với thanh chọn AI. */

const GPT = (() => {
  let info = null;
  async function load() { info = await window.fv.gpt.info(); return info; }

  // Hộp nhập / đổi API key. Trả về true khi đã lưu key hợp lệ.
  function keyModal() {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', type: 'password', placeholder: 'sk-…', autocomplete: 'off', style: { flex: 1 } });
      const msg = h('div', { class: 'help' }, 'Lấy key tại platform.openai.com → API keys. Key chỉ lưu trên máy này (mã hoá), không gửi về máy chủ Max Video AI.');
      const save = h('button', { class: 'btn btn-primary', onclick: async () => {
        const key = input.value.trim();
        if (!key) { input.focus(); return; }
        save.disabled = true; msg.textContent = 'Đang kiểm tra key…'; msg.style.color = '';
        const r = await window.fv.gpt.test(key);
        if (!r.ok) { save.disabled = false; msg.textContent = r.error.message; msg.style.color = 'var(--err)'; return; }
        await window.fv.gpt.set(key);
        await load();
        closeModal(); toast('Đã kết nối ChatGPT', { kind: 'ok', sub: 'Model: ' + info.model });
        resolve(true);
      } }, icon('check'), 'Kiểm tra & lưu');
      openModal([modalHead('Kết nối ChatGPT', 'bolt'),
        field('API key của OpenAI', h('div', { class: 'row' }, input, save)), msg,
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { closeModal(); resolve(false); } }, 'Để sau'))]);
      setTimeout(() => input.focus(), 0);
    });
  }

  // Gọi ChatGPT; tự mở hộp nhập key nếu chưa có. btn (tuỳ chọn) hiện trạng thái đang chạy.
  async function run(task, input, btn) {
    if (!info) await load();
    if (!info.hasKey && !(await keyModal())) return null;
    let old = null;
    if (btn) { old = [...btn.childNodes]; btn.disabled = true; btn.innerHTML = ''; btn.append(icon('progress_activity', 'spin'), 'ChatGPT đang viết…'); }
    try {
      const r = await window.fv.gpt.run(task, input);
      if (!r.ok) {
        if (r.error.code === 'no_key' || r.error.code === 'gpt_401') { toastError(r.error); if (await keyModal()) return run(task, input, btn); return null; }
        throw r.error;
      }
      return r.data;
    } catch (e) { toastError(e, 'ChatGPT'); return null; }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = ''; btn.append(...old); } }
  }

  const button = (label, onClick, iconName = 'auto_awesome') => {
    const b = h('button', { class: 'btn btn-text gpt-btn', type: 'button', onclick: () => onClick(b) }, icon(iconName, 'small'), label);
    return b;
  };

  return { load, keyModal, run, button, get info() { return info; } };
})();

/* Mô hình viết prompt chạy trên máy (Prompt VLM của engine) — gọi thẳng, không đưa vào Hàng đợi; kết quả trả về khung prompt. */
const LocalAI = (() => {
  const oneLine = (t) => String(t || '').replace(/\s*\n+\s*/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ready = () => Boolean(App.connected);

  function parseJson(text) {
    if (text && typeof text === 'object') return text;
    const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch { /* thử lấy khối {...} */ }
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* bỏ qua */ } }
    throw new Error('AI trên máy trả lời không đúng định dạng — bấm lại hoặc chọn ChatGPT.');
  }

  const MSG = {
    busy: 'Engine đang bận',
    model_missing: 'Mô hình AI viết prompt chưa tải xong',
    out_of_memory: 'Không đủ bộ nhớ GPU/RAM để chạy AI trên máy — đóng bớt ứng dụng hoặc chọn ChatGPT.',
    invalid_output: 'AI trên máy viết chưa đạt — bấm lại để viết lần nữa.',
    invalid_prompt: 'Prompt quá dài hoặc đang trống.',
    expired: 'Kết quả đã hết hạn — bấm lại.',
    setup_required: 'Engine chưa cài xong.',
    lite_mode: 'Chế độ này chưa có AI viết prompt trên máy (cần bản đầy đủ) — chọn ChatGPT ở thanh chọn AI.',
  };
  const fail = (code) => Object.assign(new Error(MSG[code] || ('AI trên máy lỗi: ' + code)), { code });

  async function call(action, body) {
    const r = await window.fv.gpt.local(action, body);
    if (!r.ok) throw Object.assign(new Error(MSG[r.error.code] || r.error.message), { code: r.error.code });
    return r.data;
  }

  // Bắt đầu 1 lượt; nếu engine đang bận (đang tạo video/đang tải) thì chờ rồi thử lại — không xếp vào Hàng đợi.
  async function start(action, body, say) {
    let downloadAsked = false;
    for (let waited = 0; ; waited += 3) {
      try { return (await call(action, body)).job; }
      catch (e) {
        if (e.code === 'model_missing' && !downloadAsked) {
          downloadAsked = true;
          // Tải mô hình ngay (nếu chưa tải) rồi chạy tiếp
          try { await call('install', { accept_download: true }); } catch { /* đang tải ở nơi khác */ }
          continue;
        }
        if (e.code !== 'busy' && e.code !== 'model_missing') throw e;
        if (waited > 1800) throw fail(e.code);
        let line = e.code === 'busy' ? 'Chờ GPU rảnh…' : 'Đang tải mô hình AI…';
        if (e.code === 'model_missing' || e.code === 'busy') {
          const st = await window.fv.engine.status().catch(() => null);
          const g = st && (st.groups || []).find((x) => /vlm|prompt/i.test(x.id || ''));
          if (g && g.total) { line = 'Đang tải mô hình AI ' + Math.floor(100 * (g.got || 0) / g.total) + '%'; }
        }
        say(line);
        await sleep(3000);
      }
    }
  }

  async function poll(job, say) {
    for (;;) {
      const row = await call('status', { job });
      if (row.phase === 'complete') return row;
      if (row.phase === 'failed') throw fail(row.error || 'failed');
      if (row.phase === 'cancelled') throw fail('cancelled');
      if (row.phase === 'download') say('Đang tải mô hình AI ' + (row.total ? Math.floor(100 * (row.done || 0) / row.total) + '%' : '…'));
      else if (row.phase === 'waiting_gpu') say('Chờ GPU rảnh…');
      else if (row.phase === 'rewriting' || row.phase === 'answering') say('AI trên máy đang viết…');
      else say('Đang nạp mô hình AI…');
      await sleep(500);
    }
  }

  // Lượt cài đặt (model_missing → install) cũng chạy qua status: chờ nó xong rồi mới viết
  async function once(action, body, say) {
    for (let i = 0; i < 3; i++) {
      const job = await start(action, body, say);
      const row = await poll(job, say);
      if (row.text !== undefined || row.answers) return row;
    }
    throw fail('failed');
  }

  // task: video | image | lines | autopilot (cùng kết quả JSON như ChatGPT)
  async function run(task, input, btn) {
    if (!App.connected) { toast('AI trên máy chưa sẵn sàng', { kind: 'err', sub: 'Engine đang khởi động — đợi một chút hoặc chọn ChatGPT.' }); return null; }
    let old = null;
    const label = h('span', {}, 'AI trên máy đang viết…');
    if (btn) { old = [...btn.childNodes]; btn.disabled = true; btn.innerHTML = ''; btn.append(icon('progress_activity', 'spin'), label); }
    const say = (t) => { label.textContent = t; };
    try {
      if (task === 'video') {
        const out = [];
        const lines = input.lines || [];
        for (let i = 0; i < lines.length; i++) {
          const sayN = (t) => say(lines.length > 1 ? t + ' (' + (i + 1) + '/' + lines.length + ')' : t);
          const row = await once('rewrite', { text: lines[i].slice(0, 12000), seconds: Math.min(60, Math.max(1, Number(input.seconds) || 10)), media: [] }, sayN);
          out.push(oneLine(row.text) || lines[i]);
        }
        return { lines: out };
      }
      if (task === 'image') {
        const model = ['minimax-h3-image', 'qwen-image-2.1-turbo'].includes(input.model) ? input.model : 'minimax-h3-image';
        const row = await once('rewrite', { text: String(input.text || '').slice(0, 12000), target: 'image', image_model: model, aspect: 'adaptive', media: [] }, say);
        return { prompt: oneLine(row.text) };
      }
      const p = await window.fv.gpt.prompt(task, input);
      const row = await once('ask', { system: p.system.slice(0, 4000), questions: [{ text: p.user.slice(0, 8000) }], format: 'json', max_tokens: 1500 }, say);
      const answer = (row.answers || [])[0];
      if (answer && answer.error) throw fail(answer.error);
      return parseJson(answer && answer.text !== undefined ? answer.text : answer);
    } catch (e) { toastError(e, 'AI trên máy'); return null; }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = ''; btn.append(...old); } }
  }

  return { run, ready, oneLine };
})();

/* Hàng nút AI: [Chọn AI ▾] [AI sửa Prompt] [Viết kịch bản] — mặc định AI trên máy, chọn ChatGPT ở thanh sổ.
   actions: [{ label, icon, run(engine, btn) }] */
const AI_PICK_KEY = 'maxai.aiEngine';
function aiEngineNow() { try { return localStorage.getItem(AI_PICK_KEY) === 'gpt' ? GPT : LocalAI; } catch { return LocalAI; } }
function aiWriterRow(actions) {
  const pick = h('select', { class: 'ai-pick', title: 'Chọn AI dùng để sửa prompt / viết kịch bản',
    onchange: (e) => {
      try { localStorage.setItem(AI_PICK_KEY, e.target.value); } catch { /* bỏ qua */ }
      document.querySelectorAll('select.ai-pick').forEach((s) => { s.value = e.target.value; });
      row.dataset.engine = e.target.value;
    } },
  h('option', { value: 'local' }, 'AI trên máy (miễn phí)'), h('option', { value: 'gpt' }, 'ChatGPT'));
  pick.value = aiEngineNow() === GPT ? 'gpt' : 'local';
  const row = h('div', { class: 'ai-row', 'data-engine': pick.value },
    h('label', { class: 'ai-pick-wrap' }, icon('memory', 'small'), pick, icon('expand_more', 'small')),
    ...actions.map((a) => {
      const b = h('button', { class: 'ai-act', type: 'button', onclick: () => a.run(aiEngineNow(), b) }, icon(a.icon || 'auto_awesome', 'small'), a.label);
      return b;
    }));
  return row;
}
