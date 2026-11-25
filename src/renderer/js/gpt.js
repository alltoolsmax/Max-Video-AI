'use strict';
/* ChatGPT trong giao diện: ô nhập API key, nút "Viết lại bằng ChatGPT", "Viết kịch bản bằng ChatGPT". */

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

/* Mô hình viết prompt chạy trên máy (Prompt VLM của engine) — dùng song song với ChatGPT, miễn phí, không cần mạng. */
const LocalAI = (() => {
  const ready = () => Boolean(App.connected && App.caps && App.caps.features && App.caps.features.enhance);
  const oneLine = (t) => String(t || '').replace(/\s*\n+\s*/g, ' ').trim();

  function parseJson(text) {
    if (text && typeof text === 'object') return text;
    const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch { /* thử lấy khối {...} */ }
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* bỏ qua */ } }
    throw new Error('AI trên máy trả lời không đúng định dạng — thử lại hoặc dùng ChatGPT.');
  }

  // task: video | image | lines | autopilot (cùng kết quả JSON như ChatGPT)
  async function run(task, input, btn) {
    if (!ready()) {
      toast('AI viết prompt trên máy chưa sẵn sàng', { kind: 'err', sub: App.connected ? 'Mô hình đang được tải tự động — trong lúc chờ có thể dùng ChatGPT.' : 'Engine chưa chạy.' });
      return null;
    }
    let old = null;
    if (btn) { old = [...btn.childNodes]; btn.disabled = true; btn.innerHTML = ''; btn.append(icon('progress_activity', 'spin'), 'AI trên máy đang viết…'); }
    try {
      if (task === 'video') {
        // Bộ viết prompt chuyên cho MiniMax H3 của engine, mỗi dòng 1 lượt
        const jobs = [];
        for (const line of input.lines || []) {
          const r = await api('POST', '/jobs', { kind: 'enhance', text: line.slice(0, 12000), seconds: Number(input.seconds) || 10, label: 'Viết prompt: ' + labelFrom(line).slice(0, 90) });
          jobs.push(r.job || r);
        }
        const lines = [];
        for (const j of jobs) {
          const done = await waitJob(j.id);
          lines.push(oneLine((done.result && done.result.text) || ''));
        }
        return { lines: lines.filter(Boolean) };
      }
      const p = await window.fv.gpt.prompt(task, input);
      const r = await api('POST', '/jobs', { kind: 'vlm', system: p.system.slice(0, 4000), questions: p.user.slice(0, 8000), format: 'json', max_tokens: 1500,
        label: 'AI viết ' + ({ image: 'prompt ảnh', lines: 'kịch bản', autopilot: 'kịch bản Autopilot' }[task] || 'prompt') });
      const done = await waitJob((r.job || r).id);
      const answer = done.result && (done.result.answers || [])[0];
      return parseJson(answer && answer.text !== undefined ? answer.text : answer);
    } catch (e) { toastError(e, 'AI trên máy'); return null; }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = ''; btn.append(...old); } }
  }

  const button = (label, onClick, iconName = 'memory') => {
    const b = h('button', { class: 'btn btn-text local-ai-btn', type: 'button', title: 'Chạy bằng mô hình AI trên máy — miễn phí, không cần mạng', onclick: () => onClick(b) }, icon(iconName, 'small'), label);
    return b;
  };
  return { run, button, ready, oneLine };
})();

// Hàng nút viết prompt: AI trên máy | ChatGPT. actions: [{ label, icon, run(engine, btn) }]
function aiWriterRow(actions) {
  return h('div', { class: 'ai-row' },
    h('span', { class: 'ai-tag local' }, icon('memory', 'small'), 'AI trên máy'),
    ...actions.map((a) => LocalAI.button(a.label, (btn) => a.run(LocalAI, btn), a.icon)),
    h('span', { class: 'ai-sep' }),
    h('span', { class: 'gpt-pill', style: { marginLeft: 0 } }, icon('bolt', 'small'), 'ChatGPT'),
    ...actions.map((a) => GPT.button(a.label, (btn) => a.run(GPT, btn), a.icon)));
}
