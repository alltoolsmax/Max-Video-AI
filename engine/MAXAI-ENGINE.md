# Max AI Engine

Thư mục này là engine suy luận chạy ngay trong máy của Max AI (tạo video/ảnh MiniMax H3 · VDN-H3).
Max AI đóng gói sẵn engine trong bộ cài, tự cài môi trường và tải mô hình, không cần cài thêm phần mềm nào khác.

Nguồn gốc & giấy phép: mã nguồn engine lấy nguyên vẹn (không sửa) từ dự án mã nguồn mở FreeVideo
(https://github.com/FlashML-org/FreeVideo, bản v0.6.11, commit d2a0cbbdb15a3c216a4e7a5905bc0a2913796bfb),
phát hành theo Apache License 2.0 — xem LICENSE, NOTICE và THIRD_PARTY_NOTICES.md trong thư mục này (giữ nguyên theo yêu cầu của giấy phép).
Đã bỏ khỏi bản đóng gói: .git, .github, docs, README tiếng Trung, CONTRIBUTING, SECURITY, CITATION (tài liệu, không phải mã chạy).

Trọng số mô hình (MiniMax H3 / VDN-H3) KHÔNG nằm trong thư mục này: engine tải từ nguồn gốc khi cài đặt,
theo MiniMax H3 Community License (có giới hạn lãnh thổ và mục đích sử dụng).

Cập nhật engine: `node tools/sync-engine.js <tag>` (vd. v0.6.12) rồi build lại Max AI.
