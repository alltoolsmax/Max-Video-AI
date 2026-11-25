'use strict';
/* Điều khoản sử dụng (bắt buộc đồng ý lần đầu) và trang Giấy phép.
   Đáp ứng MiniMax H3 Community License: đưa văn bản giấy phép cho người dùng, ràng buộc các giới hạn sử dụng
   (Mục V + Phụ lục A), báo giới hạn lãnh thổ, hiển thị "MiniMax H3", nhắc ghi nhãn nội dung do AI tạo. */

const TERMS_VERSION = '2026-11-25';

const EXCLUDED = 'Liên minh châu Âu (EU), Vương quốc Anh, Hàn Quốc và Hoa Kỳ';

// Phụ lục A — Chính sách sử dụng được chấp nhận của MiniMax H3 (tóm tắt tiếng Việt, bản gốc tiếng Anh là bản có hiệu lực).
const AUP = [
  'Dùng ở ngoài khu vực được cấp phép (tức là ở ' + EXCLUDED + ').',
  'Vi phạm pháp luật, hoặc xâm phạm quyền sở hữu trí tuệ, quyền riêng tư, quyền nhân thân của người khác.',
  'Gây hại cho bản thân hoặc người khác, hoặc dùng nội dung tạo ra để gây hại.',
  'Lách hoặc vô hiệu hoá các cơ chế an toàn của mô hình.',
  'Bất kỳ nội dung nào khai thác hoặc gây hại cho trẻ vị thành niên.',
  'Tạo/phát tán thông tin sai sự thật để gây hại hoặc tác động tới bầu cử.',
  'Tạo tương tác giả: đánh giá giả, bình luận ảo, tài khoản ảo…',
  'Bôi nhọ, xúc phạm, quấy rối người khác.',
  'Tạo mã độc hoặc nội dung nhằm phá hoại hệ thống máy tính.',
  'Tạo/phát tán thông tin cá nhân của người khác nhằm gây hại.',
  'Đăng nội dung ở nơi công khai mà không ghi rõ là nội dung do AI tạo.',
  'Giả mạo người khác khi chưa được họ đồng ý hoặc không có quyền hợp pháp (deepfake).',
  'Ra quyết định tự động rủi ro cao trong lĩnh vực trọng yếu (pháp luật, y tế, di trú, tài chính, việc làm…).',
  'Vi phạm chuẩn mực xã hội, đạo đức của quốc gia, vùng lãnh thổ khác.',
  'Cổ suý, kích động, lên kế hoạch cho khủng bố hoặc bạo lực cực đoan.',
  'Phân biệt đối xử hoặc gây hại cho cá nhân, nhóm người dựa trên đặc điểm được bảo vệ.',
  'Lợi dụng điểm yếu của nhóm người dễ bị tổn thương (tuổi tác, thể chất, tâm lý…) để thao túng hành vi.',
  'Mục đích quân sự.',
  'Hành nghề chuyên môn không có giấy phép (tài chính, pháp lý, y tế…).',
  'Dùng mô hình hoặc nội dung tạo ra để huấn luyện/cải thiện mô hình AI khác.',
];

const MODEL_LICENSES = [
  ['MiniMax H3 · VDN-H3 (tạo video), MiniMax H3 Image', 'MiniMax H3 Community License', 'Không dùng ở ' + EXCLUDED + '. Có các giới hạn sử dụng ở trên.'],
  ['Qwen Image 2.1 Turbo (tạo ảnh nhanh)', 'Qwen Research License', 'Chỉ dùng phi thương mại (nghiên cứu, thử nghiệm, cá nhân). Muốn dùng thương mại phải xin phép Alibaba.'],
  ['Prompt VLM (Qwen3-VL), SAM 2, CosyVoice 3, ACE-Step (nhạc), sherpa-onnx (phụ đề)', 'Apache-2.0 / MIT', 'Dùng thương mại được, giữ thông báo bản quyền.'],
  ['Max AI Engine (mã nguồn mở, dựa trên FlashML-org/FreeVideo)', 'Apache-2.0', 'Giữ nguyên LICENSE / NOTICE đi kèm.'],
];

function legalSections() {
  return [
    h('h4', {}, '1. Bản quyền ứng dụng'),
    h('p', {}, `Max AI (giao diện, hệ thống cập nhật, tên và biểu tượng) © ${APP_INFO.year} ${APP_INFO.owner} (${APP_INFO.author}). Ứng dụng được chia sẻ miễn phí để sử dụng; không được bán lại, sửa đổi hay phát hành lại dưới tên khác khi chưa có đồng ý của tác giả. `
      + 'Engine và các mô hình AI thuộc bản quyền của chủ sở hữu tương ứng, dùng theo giấy phép của họ (mục 4).'),
    h('h4', {}, '2. Khu vực được phép sử dụng'),
    h('div', { class: 'notice err', style: { margin: '6px 0' } }, icon('public_off'),
      h('div', {}, 'Mô hình MiniMax H3 ', h('b', {}, 'không được phép sử dụng'), ' tại ' + EXCLUDED + '. Không dùng, không phát hành nội dung tạo ra tại các khu vực này.')),
    h('h4', {}, '3. Bạn cam kết KHÔNG dùng Max AI và nội dung tạo ra để:'),
    h('ol', { class: 'legal-list' }, AUP.map((t) => h('li', {}, t))),
    h('div', { class: 'notice info', style: { margin: '6px 0' } }, icon('label'),
      h('div', {}, h('b', {}, 'Ghi nhãn nội dung AI: '), 'khi đăng video, ảnh lên mạng xã hội hay bất kỳ nơi công khai nào, bạn phải ghi rõ ràng là nội dung do AI tạo (ví dụ "Video tạo bằng AI").')),
    h('h4', {}, '4. Giấy phép mô hình'),
    h('table', { class: 'data legal-table' }, h('thead', {}, h('tr', {}, ['Thành phần', 'Giấy phép', 'Lưu ý'].map((t) => h('th', {}, t)))),
      h('tbody', {}, MODEL_LICENSES.map(([a, b, c]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', { class: 'small-text' }, c))))),
    h('p', { class: 'small-text muted' }, 'Mô hình được tải trực tiếp từ nguồn phát hành chính thức về máy của bạn, không nằm trong bộ cài Max AI. '
      + 'Bản tiếng Việt ở đây là tóm tắt; văn bản giấy phép gốc (tiếng Anh) là bản có hiệu lực — bấm "Đọc toàn văn giấy phép".'),
    h('h4', {}, '5. Miễn trừ trách nhiệm'),
    h('p', {}, 'Ứng dụng và mô hình được cung cấp "nguyên trạng", không kèm bảo đảm. Bạn tự chịu trách nhiệm về nội dung mình tạo ra và cách sử dụng nội dung đó. '
      + 'Vi phạm các điều khoản trên thì quyền sử dụng mô hình chấm dứt; bạn phải ngừng sử dụng và xoá mô hình khỏi máy.'),
  ];
}

// Hiện văn bản gốc trong một hộp cuộn.
async function openLicenseText(which = 'minimax') {
  const t = await window.fv.legal();
  const titles = { minimax: 'MiniMax H3 Community License Agreement', thirdParty: 'Thông báo bên thứ ba (engine)', apache: 'Apache License 2.0 (Max AI Engine)' };
  const back = Legal.back;
  openModal([modalHead(titles[which], 'gavel', !back),
    h('pre', { class: 'legal-text' }, (which === 'apache' ? (t.notice + '\n\n' + t.apache) : t[which]) || 'Không đọc được văn bản giấy phép trong bộ cài.'),
    h('div', { class: 'foot' }, h('button', { class: 'btn btn-primary', onclick: () => (back ? back() : closeModal()) }, icon('arrow_back'), back ? 'Quay lại' : 'Đóng'))],
    { wide: true, locked: !!back });
}

const Legal = { back: null };

// Màn hình điều khoản. required = lần đầu mở app: phải đồng ý mới dùng được, không đồng ý thì thoát.
function openTerms({ required = false } = {}) {
  return new Promise((resolve) => {
    const show = () => {
      Legal.back = required ? show : null;
      let ok18 = false, okTerms = false;
      const accept = h('button', { class: 'btn btn-primary', disabled: true, onclick: async () => {
        await window.fv.config.set({ prefs: { termsAccepted: TERMS_VERSION } });
        App.config.prefs = { ...(App.config.prefs || {}), termsAccepted: TERMS_VERSION };
        Legal.back = null; closeModal(); resolve(true);
      } }, icon('check'), 'Tôi đồng ý');
      const sync = () => { accept.disabled = !(ok18 && okTerms); };
      const check = (label, set) => h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', onchange: (e) => { set(e.target.checked); sync(); } }), h('span', {}, label));
      const links = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
        h('button', { class: 'btn btn-text', onclick: () => openLicenseText('minimax') }, icon('description'), 'Đọc toàn văn giấy phép MiniMax H3'),
        h('button', { class: 'btn btn-text', onclick: () => openLicenseText('thirdParty') }, icon('list_alt'), 'Thông báo bên thứ ba'),
        h('button', { class: 'btn btn-text', onclick: () => openLicenseText('apache') }, icon('code'), 'Giấy phép engine'));
      openModal([
        modalHead(required ? 'Điều khoản sử dụng Max AI' : 'Giấy phép & điều khoản', 'gavel', !required),
        h('div', { class: 'legal-body' }, legalSections()),
        links,
        required ? h('div', { class: 'legal-checks' },
          check(`Tôi không ở ${EXCLUDED} và sẽ không dùng Max AI hay nội dung tạo ra tại các khu vực này.`, (v) => { ok18 = v; }),
          check('Tôi đã đọc và đồng ý các điều khoản trên, giấy phép MiniMax H3 Community License và giấy phép của từng mô hình.', (v) => { okTerms = v; })) : null,
        h('div', { class: 'foot' }, required
          ? [h('button', { class: 'btn', onclick: () => window.fv.quit() }, icon('logout'), 'Không đồng ý & thoát'), accept]
          : h('button', { class: 'btn btn-primary', onclick: () => { closeModal(); resolve(true); } }, 'Đóng')),
      ], { wide: true, locked: required });
    };
    show();
  });
}

async function ensureTermsAccepted() {
  const prefs = (App.config && App.config.prefs) || {};
  if (prefs.termsAccepted === TERMS_VERSION) return;
  await openTerms({ required: true });
}

// Dòng nhắc ghi nhãn AI (đặt dưới nút Tạo)
const aiLabelNote = () => h('div', { class: 'help', style: { marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'flex-start' } },
  icon('label', 'small'), h('span', {}, 'Khi đăng công khai, hãy ghi rõ nội dung do AI tạo. ',
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); openTerms(); } }, 'Điều khoản')));
