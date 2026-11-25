'use strict';
// ChatGPT (OpenAI API) cho Max Video AI: viết lại prompt, viết kịch bản, sửa/dịch prompt.
// API key người dùng tự nhập, chỉ lưu trên máy này (mã hoá bằng safeStorage của hệ điều hành khi có), không gửi về máy chủ của app.

let safeStorage = null;
try { const e = require('electron'); if (e && e.safeStorage) safeStorage = e.safeStorage; } catch { /* chạy ngoài Electron (kiểm thử) */ }
const canEncrypt = () => Boolean(safeStorage && safeStorage.isEncryptionAvailable());

const API = process.env.MAXAI_GPT_API || 'https://api.openai.com/v1';   // MAXAI_GPT_API: chỉ để kiểm thử
const DEFAULT_MODEL = 'gpt-4o-mini';

const SYSTEM = {
  video: `You write prompts for MiniMax H3, a text-to-video model that makes cinematic clips with synchronized sound.
Rewrite each input idea into ONE detailed English prompt: subject and appearance, action over time, setting, lighting, camera movement, mood and sound.
Keep any dialogue in double quotes in its ORIGINAL language and say who speaks. Keep names of people and places.
Return JSON {"lines": [...]} with exactly one prompt per input line, same order, no numbering, each prompt on one line (no line breaks), under 900 characters.`,
  image: `You write prompts for a text-to-image model. Rewrite the idea into ONE detailed English image prompt: subject, composition, setting, lighting, lens/style, colors.
Text that must appear in the image goes in double quotes. Keep names. Return JSON {"prompt": "..."} on one line, under 900 characters.`,
  lines: `You are a film director writing a short video as separate shots for MiniMax H3 (text-to-video with sound).
Write the requested number of shots telling the story. Each shot is ONE self-contained English prompt (the model sees one shot at a time),
so re-describe each character's look briefly every time they appear. Include action, setting, lighting, camera and sound. Dialogue in double quotes keeps
the user's language (Vietnamese if the user wrote Vietnamese). Return JSON {"lines": [...]} — one prompt per shot, each on one line, under 900 characters.`,
  autopilot: `You are a film director writing a screenplay for an AI film tool that shoots each scene separately and joins them.
Return JSON {"title": short title, "style": short English visual style, "shots": [{"action": English description of what happens and where (1-3 sentences),
"seconds": 5-15, "camera": short English camera note, "cast": [character names in this shot], "lines": [{"who": character name, "line": dialogue}]}]}.
Use ONLY the character names given (if none are given, invent at most 3 and use them consistently). Dialogue stays in the user's language
(Vietnamese if the user wrote Vietnamese). Write exactly the requested number of shots.`,
};

class Gpt {
  constructor({ settings, save }) { this.settings = settings; this.save = save; }
  get cfg() { return (this.settings.gpt ||= {}); }

  key() {
    const c = this.cfg;
    if (c.keyEnc && canEncrypt()) {
      try { return safeStorage.decryptString(Buffer.from(c.keyEnc, 'base64')); } catch { return null; }
    }
    return c.keyPlain || null;
  }
  info() {
    const k = this.key();
    return { hasKey: Boolean(k), masked: k ? k.slice(0, 7) + '••••••••' + k.slice(-4) : '', model: this.cfg.model || DEFAULT_MODEL, models: this.cfg.models || [] };
  }
  setKey(key, model) {
    const c = this.cfg;
    if (key !== undefined) {
      delete c.keyEnc; delete c.keyPlain;
      const k = String(key || '').trim();
      if (k) {
        if (canEncrypt()) c.keyEnc = safeStorage.encryptString(k).toString('base64');
        else c.keyPlain = k;
      }
    }
    if (model) c.model = String(model);
    this.save();
    return this.info();
  }

  async request(route, body, key = this.key()) {
    if (!key) { const e = new Error('Chưa nhập API key ChatGPT. Vào Cài đặt → ChatGPT.'); e.code = 'no_key'; throw e; }
    let res;
    try {
      res = await fetch(API + route, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(120000),
        headers: { authorization: 'Bearer ' + key, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error('Không kết nối được ChatGPT (kiểm tra mạng): ' + e.message); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || ('HTTP ' + res.status);
      const vi = res.status === 401 ? 'API key không đúng hoặc đã bị thu hồi.'
        : res.status === 429 ? (/quota|billing/i.test(msg) ? 'Tài khoản OpenAI hết hạn mức/chưa nạp tiền.' : 'ChatGPT đang quá tải — thử lại sau ít giây.')
        : res.status === 404 ? 'Model này không dùng được với key của bạn — chọn model khác ở Cài đặt.' : 'ChatGPT báo lỗi: ' + msg;
      const e = new Error(vi); e.code = 'gpt_' + res.status; throw e;
    }
    return data;
  }

  // Kiểm tra key + lấy danh sách model chat dùng được
  async test(key) {
    const k = String(key || '').trim() || this.key();
    const data = await this.request('/models', null, k);
    const models = (data.data || []).map((m) => m.id)
      .filter((id) => /^(gpt-|chatgpt-|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|instruct|embedding)/.test(id)).sort();
    this.cfg.models = models;
    if (!this.cfg.model || !models.includes(this.cfg.model)) this.cfg.model = models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (models[0] || DEFAULT_MODEL);
    this.save();
    return { ok: true, models, model: this.cfg.model };
  }

  // task: video | image | lines | autopilot. input: văn bản người dùng (+ tuỳ chọn)
  async run(task, input = {}) {
    const system = SYSTEM[task];
    if (!system) throw new Error('Không rõ việc cần ChatGPT làm.');
    let user;
    if (task === 'video') user = 'Input lines:\n' + (input.lines || []).map((l, i) => `${i + 1}. ${l}`).join('\n') + (input.seconds ? `\nEach clip is about ${input.seconds} seconds.` : '');
    else if (task === 'image') user = String(input.text || '');
    else if (task === 'lines') user = `Story idea: ${input.idea}\nNumber of shots: ${input.count}\nEach shot about ${input.seconds || 10} seconds.`;
    else user = `Story idea: ${input.idea}\nNumber of shots: ${input.count}\nCharacters: ${(input.characters || []).join(', ') || '(none given)'}`;
    const data = await this.request('/chat/completions', {
      model: this.cfg.model || DEFAULT_MODEL, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('ChatGPT trả lời không đúng định dạng — thử lại.'); }
    return json;
  }
}

module.exports = { Gpt };
