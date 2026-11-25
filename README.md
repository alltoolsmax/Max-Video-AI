# Max Video AI by Mr. Huỳnh

© 2026 Huỳnh Xuyên Sơn (Mr. Huỳnh) · Zalo 0979 007 367 · info@mrhuynh.net · mrhuynh.net

Ứng dụng desktop **miễn phí** tạo video và ảnh AI **ngay trên máy tính của bạn**. Không cần key, không có gói trả phí.
App chạy độc lập: bộ cài chứa sẵn **Max AI Engine**. Không cần cài phần mềm nào khác. Mô hình AI **không** nằm trong bộ cài, app tải mô hình về máy khi bạn bấm Cài / Tải, rồi chạy hoàn toàn trên máy (MiniMax H3 / VDN-H3, chạy được từ 8 GB VRAM).
Giao diện cùng tông với GCloud Hub. Đếm máy, cập nhật online và video hướng dẫn dùng chung trang quản trị `active.mrhuynh.net/admin`.


## Mới ở 1.4
- Tên **Max Video AI**, logo mới, màn hình chào có hiệu ứng.
- Mở app là **tự động**: lần đầu tự cài engine và tự tải mọi mô hình (có thanh tiến độ), các lần sau engine tự bật — người dùng không cần thao tác gì.
- **ChatGPT** (API key của người dùng, lưu mã hoá trên máy): viết lại prompt, viết kịch bản (Tạo video nhiều dòng, Autopilot).
- Tạo video: 1 khung prompt, mỗi dòng 1 video; nút **Tạo bản xem trước**; bỏ mục Nâng cao.
- Tạo ảnh: ô Ảnh bắt đầu → Ảnh kết thúc, mục Ảnh tham chiếu; menu "Kho ảnh tham chiếu".
- Thư viện: chọn nhiều, xoá từng video, xoá các mục đã chọn, xoá toàn bộ.

## Tính năng
| Trang | Mô tả |
|---|---|
| Engine & mô hình | Chọn ổ cài, **kiểm tra máy** (GPU, VRAM, RAM, ổ đĩa, dung lượng tải), **tự cài engine và tải mô hình** với tiến độ chi tiết. Tạm dừng được; lần sau chạy lại thì tải tiếp. Engine tự bật khi mở app và tự tắt khi đóng app. Có tuỳ chọn tải thêm mô hình ảnh và dùng lại mô hình có sẵn |
| Tạo video | Viết mô tả kiểu đơn giản (hình ảnh / âm thanh / nhạc) hoặc prompt đầy đủ, có **Viết lại bằng AI**. Chọn được khung hình đầu/cuối, tham chiếu, tỉ lệ, thời lượng tới 60 giây, 4 mức chất lượng, nhiều bản, seed, xem trước, LoRA. Có **ước tính thời gian trên đúng máy của bạn** và làm tiếp video |
| Tạo ảnh | MiniMax H3 Image (tới 16 MP) / Qwen Image, sửa và ghép ảnh, “Làm video từ ảnh này” |
| Hàng đợi · Thư viện | Tiến độ theo từng bước, huỷ, chạy lại, tải về; xem lại mọi video đã tạo |
| Mô hình AI trên máy | Danh sách đầy đủ mô hình của engine, tải riêng từng gói: tạo video (MiniMax H3 · VDN-H3), tạo ảnh chất lượng cao (MiniMax H3 Image), tạo ảnh nhanh (Qwen Image 2.1 Turbo), chọn vùng (SAM 2), AI viết prompt (Prompt VLM), lồng tiếng (CosyVoice 3), phụ đề (nhận dạng giọng nói), nhạc nền. Có tiến độ, dừng / tải tiếp |
| Cài đặt | Giao diện tối/sáng, thông tin máy, kiểm tra cập nhật |
| Sửa ảnh | Sửa bằng AI theo mô tả (H3 Image / Qwen), hoặc chỉnh nhanh: xoay, lật, cắt khung, màu sắc & ánh sáng, thêm chữ, xoá chữ cháy |
| Nhân vật | Thẻ nhân vật / bối cảnh / đạo cụ với ảnh tham chiếu, giọng mẫu; AI vẽ ảnh tham chiếu từ mô tả; dùng trong Tạo ảnh và Autopilot |
| Autopilot | Viết kịch bản nhiều cảnh (nhân vật, lời thoại, góc máy) → AI tự quay nhiều bản mỗi cảnh, tự chọn bản đẹp nhất, tự ghép phim |
| Lồng tiếng | AI nghe từng câu thoại → sửa/dịch câu → AI nói lại bằng chính giọng gốc, đúng chỗ → xuất video |
| Phụ đề | AI nghe và tạo phụ đề có thời gian → sửa → tải .srt hoặc xuất video có phụ đề |
| Sắp có | Dựng timeline |

## Engine chạy trong máy như thế nào
1. Bộ cài mang sẵn mã nguồn Max AI Engine (thư mục `engine/`, khoảng 70 MB, không có mô hình). Lần đầu, app chép engine vào thư mục cài người dùng chọn, ví dụ `D:\MaxAI-Engine\engine`. Mọi dữ liệu của engine nằm gọn trong thư mục đó.
2. **Kiểm tra máy** chạy trình cài của engine ở chế độ chỉ đọc (`setup --plan --json`): GPU, VRAM, RAM, ổ đĩa, dung lượng cần tải.
3. **Cài** chạy `setup --yes --accept-model-license`: tạo Python riêng và môi trường CUDA, **tải mô hình tạo video về máy** (~50 GB), chọn int8/FP8 hợp với card. Dừng được, lần sau tải tiếp.
4. **Bật engine**: chạy ngầm ở `127.0.0.1`. Giao diện gọi engine qua API cục bộ.
5. Các mô hình còn lại (ảnh, prompt, lồng tiếng, phụ đề, nhạc) tải riêng ở thẻ **Mô hình AI trên máy** khi engine đang chạy.

Cập nhật engine cho bản phát hành sau: `node tools/sync-engine.js <tag>` rồi build lại.

Cấu hình cần có:
- Windows 10/11 64-bit hoặc Linux, card NVIDIA RTX 30 trở lên, tối thiểu 8 GB VRAM và 16 GB RAM, driver 580 trở lên.
- Khoảng 70 GB ổ trống.
- macOS chip Apple M: bản thử nghiệm.

## Trang quản trị (active.mrhuynh.net/admin › ⚡ Max Video AI)
Có các mục:
- **Tổng quan**: máy đang mở, máy hoạt động 24 giờ / 30 ngày, tổng máy, phiên bản đang dùng.
- **Máy đã cài.**
- **Video hướng dẫn**: dán link YouTube cho từng trang; app hiện nút “Xem hướng dẫn”.
- **Cập nhật phần mềm.**
- **Nhật ký.**

Dữ liệu để riêng ở `active_private/maxai/`, không đụng tới Video AI, Voice AI hay GCloud Hub.

### Cài lên hosting (1 file zip)
1. Bấm đúp `chuan-bi-hosting.bat` (hoặc chạy `node tools/prepare-hosting.js`). Kết quả: `hosting\upload\MaxAI-hosting.zip`.
2. Vào cPanel › File Manager › **thư mục chính** (thấy 2 thư mục `active.mrhuynh.net` và `active_private`) › Upload › **Extract**.
   - Tự thêm: `maxai/`, `admin/maxai_api.php`, `active_private/maxai/`.
   - Tự đè `admin/api.php`, `admin/index.html` bằng bản đã gộp sẵn Video AI + Voice AI + GCloud Hub + Max Video AI. Hai file này lấy từ repo `video-ai-mac-build`; mục Max Video AI chỉ thêm vào, không xoá gì.
3. Kiểm tra:
   - Mở `https://active.mrhuynh.net/maxai/v1/app/version` → phải trả về `{"ok":true,…}`.
   - Trang quản trị phải có nút **⚡ Max Video AI**.
4. Lần sau chỉ cập nhật mã: Extract `MaxAI-hosting-update.zip` (không có `config.php`).

## Phát hành bản mới cho khách
1. Tăng `version` trong `package.json` rồi đưa lên GitHub. GitHub Actions tự build Windows + macOS, mất khoảng 10–25 phút.
2. Vào trang quản trị › ⚡ Max Video AI › **Cập nhật phần mềm** › chọn *Bản Windows GitHub đã build*, ghi “Có gì mới”, bấm **🚀 Phát hành**.
3. App của khách:
   - Tự kiểm tra khi mở và mỗi 6 giờ.
   - Tự tải bản mới, kiểm tra SHA-256, cài rồi mở lại.
   - Máy Mac nhận bản mới ngay khi GitHub build xong.

Link cố định cho khách cài lần đầu:
- Windows: `https://github.com/alltoolsmax/Max-Video-AI/releases/latest/download/max_ai_mrhuynh_win.zip`
- macOS: `https://github.com/alltoolsmax/Max-Video-AI/releases/latest/download/max_ai_mrhuynh_mac.zip`

## Chạy / build từ mã nguồn
- Chạy thử: cài Node.js 20+, bấm đúp `run-dev.bat` (hoặc `npm install && npm start`).
- Build bộ cài Windows: `build-windows.bat` → `dist\MaxAI-Setup-x.y.z.exe`.
- Thử giao diện khi không có GPU (thư mục `dev/`):
  - `python dev/mock_server.py`: giả lập engine.
  - `dev/fake_setup.py`, `dev/fake_host.py`: giả lập trình cài và việc bật engine.
  - Bật các biến `MAXAI_FAKE_SETUP`, `MAXAI_FAKE_HOST`, `MAXAI_ENGINE_SOURCE` (xem `src/main/engine.js`).

## Cấu trúc
```
src/main/       main.js (cửa sổ) · engine.js (cài/bật engine trong máy) · packs.js (gói mô hình) · freevideo.js (API engine, token)
                device.js (đếm máy, video hướng dẫn) · updater.js (cập nhật online) · bridge.js · server-config.json
engine/         Max AI Engine (mã nguồn mở Apache-2.0, đóng vào bộ cài, không có mô hình)
src/renderer/   index.html · styles.css (tông GCloud Hub) · js/ · pages/ (engine, video, image, queue, library, settings, soon)
hosting/        máy chủ PHP: maxai/ (API), admin/maxai_api.php (+ api.php, index.html đã gộp), active_private/maxai/lib.php
tools/          sync-engine.js (cập nhật engine) · prepare-hosting.js (gói zip hosting) · make-downloads.js (gói phát hành, GitHub Actions gọi)
```

## Giấy phép bên thứ ba
- Max AI Engine dựa trên mã nguồn mở FlashML-org/FreeVideo (Apache License 2.0), giữ nguyên LICENSE / NOTICE trong `engine/`.
- Mô hình MiniMax H3 / VDN-H3: MiniMax H3 Community License, có giới hạn lãnh thổ và mục đích sử dụng. Người dùng phải đồng ý trước khi tải.
- Material Symbols (Apache-2.0), Roboto (OFL-1.1).
