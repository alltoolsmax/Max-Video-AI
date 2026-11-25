'use strict';
/* Các tính năng của giai đoạn sau */

const SOON = {
  timeline: ['view_timeline', 'Dựng timeline', 'Ghép nhiều clip trên timeline, cắt, chuyển cảnh, thêm nhạc và xuất video. FreeVideo đã có API cho dự án dựng (projects).'],
  'image-edit': ['auto_fix_high', 'Sửa ảnh', 'Chỉnh sửa ảnh theo lớp: xoá vật thể, thay nền, vẽ lại một vùng.'],
  cast: ['groups', 'Nhân vật', 'Thẻ nhân vật và bối cảnh để giữ người/cảnh giống nhau qua nhiều video.'],
  autopilot: ['smart_toy', 'Autopilot', 'Trò chuyện với AI để lên kịch bản và tự tạo phim ngắn nhiều cảnh.'],
  dubbing: ['record_voice_over', 'Lồng tiếng', 'Đọc lại lời thoại bằng giọng gốc, đổi câu thoại trong video.'],
  subtitles: ['subtitles', 'Phụ đề', 'Tự nghe và tạo phụ đề có thời gian, chỉnh sửa và xuất kèm video.'],
};

registerPage('soon', {
  render(root, params) {
    const [name, title, text] = SOON[params.sub] || ['construction', 'Sắp có', ''];
    root.append(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', {}, title), h('span', { class: 'soon-tag' }, 'Giai đoạn sau')),
      h('div', { class: 'card' }, h('div', { class: 'empty' }, icon(name), h('h3', {}, title + ' đang được phát triển'),
        h('div', { style: { maxWidth: '520px', margin: '0 auto' } }, text),
        h('div', { class: 'row mt', style: { justifyContent: 'center' } },
          h('button', { class: 'btn btn-primary', onclick: () => navigate('video') }, icon('videocam'), 'Tạo video'),
          h('button', { class: 'btn btn-outline', onclick: () => navigate('image') }, icon('image'), 'Tạo ảnh'))))));
  },
});
