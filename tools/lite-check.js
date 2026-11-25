'use strict';
// CI: gửi workflow chế độ nhẹ cho ComfyUI thật (bản cố định) để kiểm tra tên node & tham số hợp lệ.
// Dùng: node tools/lite-check.js http://127.0.0.1:8188
const { workflow } = require('../src/main/lite');
const url = process.argv[2] || 'http://127.0.0.1:8188';
(async () => {
  let bad = 0;
  for (const image of [null, 'maxai/start.png']) {
    const g = workflow({ prompt: 'a red fox running in snow', width: 832, height: 480, frames: 121, steps: 12, seed: 1, run: 'ci', image, fp8: true });
    const r = await fetch(url + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: g, client_id: 'ci' }) });
    const j = await r.json();
    console.log(image ? 'có ảnh mở đầu' : 'chỉ prompt', r.status, JSON.stringify(j).slice(0, 1500));
    if (!r.ok || !j.prompt_id) bad++;
  }
  const info = await (await fetch(url + '/object_info')).json();
  for (const n of ['UNETLoader', 'CLIPLoader', 'VAELoader', 'ModelSamplingSD3', 'Wan22ImageToVideoLatent', 'KSampler', 'VAEDecode', 'CreateVideo', 'SaveVideo', 'ImageFromBatch', 'SaveImage', 'LoadImage']) {
    if (!info[n]) { console.log('THIẾU node', n); bad++; }
  }
  console.log('UNETLoader weight_dtype:', JSON.stringify(info.UNETLoader.input.required.weight_dtype[0]));
  console.log('SaveVideo inputs:', JSON.stringify(info.SaveVideo.input));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
