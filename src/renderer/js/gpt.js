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
