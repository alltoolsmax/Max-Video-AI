'use strict';
/* Màn hình chào mừng: logo + tên app có hiệu ứng. Lần đầu (đang cài engine, tải mô hình) có thêm thanh tiến độ mảnh. */

const Splash = (() => {
  const el = () => document.getElementById('splash');
  const t0 = Date.now();
  const MIN_MS = 3600;                    // đủ để hiệu ứng chạy hết
  let shown = true;

  function init() {
    const name = document.getElementById('spName');
    [...'Max Video AI'].forEach((c, i) => {
      const s = document.createElement('span');
      s.textContent = c === ' ' ? ' ' : c;
      s.style.animationDelay = (1.9 + i * 0.06) + 's';
      name.append(s);
    });
    const stars = document.getElementById('spStars');
    for (let i = 0; i < 40; i++) {
      const e = document.createElement('i');
      e.style.left = Math.random() * 100 + '%'; e.style.top = Math.random() * 100 + '%';
      e.style.animationDelay = (Math.random() * 3) + 's';
      stars.append(e);
    }
  }

  // Thanh tiến độ (chỉ dùng lần đầu, khi phải tải mô hình)
  function progress(text, fraction, actions) {
    const box = document.getElementById('spStatus');
    box.classList.remove('hidden');
    const bar = document.getElementById('spBar');
    bar.parentElement.classList.toggle('indef', fraction == null);
    if (fraction != null) bar.style.width = Math.max(2, Math.min(100, fraction * 100)) + '%';
    document.getElementById('spText').textContent = text || '';
    const acts = document.getElementById('spActs');
    acts.innerHTML = '';
    for (const a of actions || []) acts.append(h('button', { class: 'btn ' + (a.primary ? 'btn-primary' : ''), onclick: a.run }, a.label));
  }
  function plain() { document.getElementById('spStatus').classList.add('hidden'); }

  async function hide() {
    if (!shown) return;
    const wait = MIN_MS - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    shown = false;
    el().classList.add('out');
  }
  function show() { shown = true; el().classList.remove('out'); }
  async function minDelay() { const wait = MIN_MS - (Date.now() - t0); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); }

  return { init, progress, plain, hide, show, minDelay, get shown() { return shown; } };
})();
Splash.init();
