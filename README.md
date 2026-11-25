# Max AI by Mr. Huỳnh

© 2026 Huỳnh Xuyên Sơn (Mr. Huỳnh) · Zalo 0979 007 367 · info@mrhuynh.net · mrhuynh.net

Ứng dụng desktop (Windows / macOS) **tạo video và ảnh AI ngay trên máy tính của khách**, dùng engine
[FreeVideo](https://github.com/FlashML-org/FreeVideo) (MiniMax H3 / VDN-H3, chạy từ 8 GB VRAM). Giao diện cùng tông với
GCloud Hub. Key bản quyền, đếm máy và cập nhật online dùng chung **trang quản trị** `active.mrhuynh.net/admin`, giống Video AI.

## Tính năng (giai đoạn 1)
| Trang | Mô tả |
|---|---|
| Tạo video | Viết mô tả kiểu đơn giản (hình ảnh / âm thanh / nhạc) hoặc prompt đầy đủ. Có nút **Viết lại bằng AI** và gợi ý mẫu. Chọn được: khung hình đầu/cuối, tham chiếu ảnh/video/giọng, tỉ lệ khung, thời lượng tới 60 giây, 4 mức chất lượng, nhiều bản, seed, xem trước nhanh, LoRA. Có **ước tính thời gian trên đúng máy của khách** và làm tiếp video có sẵn |
| Tạo ảnh | MiniMax H3 Image (tới 16 MP) / Qwen Image, sửa và ghép tối đa 4 ảnh, “Làm video từ ảnh này” |
| Hàng đợi | Tiến độ theo từng bước, huỷ, chạy lại, tải về, xem chi tiết |
| Thư viện | Mọi video đã tạo: xem nhanh, tìm theo prompt, dùng lại prompt, làm tiếp |
| Cài đặt | Tự tìm FreeVideo, thông tin GPU, giao diện tối/sáng, bản quyền, kiểm tra cập nhật |
| Sắp có | Dựng timeline · Sửa ảnh · Nhân vật · Autopilot · Lồng tiếng · Phụ đề |

## Bản quyền (giống Video AI)
- **Gói Miễn phí vĩnh viễn:** đủ chức năng, nhưng **mỗi lần chỉ chạy 1 tác vụ**, mỗi lần tạo 1 bản / 1 ảnh.
- **Gói Chuyên nghiệp:** chạy hàng loạt, tạo nhiều bản cùng lúc. Kích hoạt bằng key `MAX-XXXX-XXXX-XXXX-XXXX`.
- Giấy phép được ký Ed25519 và gắn với mã máy. Phần mềm kiểm tra lại mỗi 24 giờ; mất mạng vẫn dùng được tối đa 3 ngày; lùi đồng hồ sẽ bị phát hiện.
- Mỗi key dùng cho 1 máy. Khách tự chuyển máy được 1 lần mỗi 30 ngày, ngoài ra người bán bấm **Đổi máy** trong trang quản trị.
- **Mua ngay trong app:**
  - Quét VietQR + SePay → tự kích hoạt trong vài giây. Dùng chung tài khoản ngân hàng và webhook với Video AI / Voice AI.
  - Hoặc **Mua qua Zalo**: app tự chép tin nhắn gồm gói và mã máy.
- Bảng giá, link video hướng dẫn và bản phát hành đều sửa trong trang quản trị, **không cần build lại**.

## Trang quản trị (active.mrhuynh.net/admin › ⚡ Max AI)
Gồm các mục giống Video AI:
- Tổng quan: máy đang mở, máy hoạt động 24 giờ / 30 ngày, tổng máy, doanh thu.
- Máy đã cài.
- Danh sách key: khóa, cộng ngày, đổi máy, ghi chú.
- Tạo key.
- Bảng giá.
- Video hướng dẫn.
- Cập nhật phần mềm.
- Đơn hàng.
- Nhật ký.

Dữ liệu Max AI để riêng ở `active_private/maxai/data/maxai.sqlite`. Không đụng gì tới dữ liệu Video AI / Voice AI / GCloud Hub.

### Cài lên hosting (làm 1 lần)
1. Bấm đúp `chuan-bi-hosting.bat` (hoặc `node tools/prepare-hosting.js`). Kết quả nằm trong `hosting\upload\`:
   - Nếu chưa có con dấu, script tạo mới `hosting\.maxai_seed.hex` (**sao lưu, không gửi ai**).
   - Script ghi khóa công khai vào `src/main/license-config.json`.
2. cPanel › File Manager (bật *Show Hidden Files*):
   - `MaxAI-hosting-update.zip` → tải vào **thư mục gốc của active.mrhuynh.net** › Extract (ghi đè). File này thêm `maxai/` và `admin/maxai_api.php`, đồng thời cập nhật `admin/api.php`, `admin/index.html`, `webhook.php` (đã gộp sẵn Video AI + Voice AI + GCloud Hub + Max AI).
   - `MaxAI-private-update.zip` → tải vào thư mục **active_private/** › Extract (tạo `active_private/maxai/lib.php`).
   - `active_private/maxai/config.php` → **chỉ lần đầu**, tải vào `active_private/maxai/` (quyền 600).
   - Thư mục `active_private/maxai/` phải ghi được (755/775) để máy chủ tự tạo `data/` và `logs/`.
3. Kiểm tra:
   - Mở `https://active.mrhuynh.net/maxai/v1/plans` → phải thấy bảng giá.
   - Mở `https://active.mrhuynh.net/admin/` → phải có nút **⚡ Max AI**.
4. Đưa `src/main/license-config.json` lên GitHub. Bản build mới sẽ khóa key theo máy chủ này.

> `admin/api.php`, `admin/index.html` và `webhook.php` trong gói được gộp từ bản trong repo **video-ai-mac-build**. Nếu bạn đã sửa các
> file này trực tiếp trên hosting, hãy so sánh trước khi ghi đè. Thay đổi cho Max AI chỉ gồm:
> - `api.php`: thêm khối `if (str_starts_with($a, 'm_')) require 'maxai_api.php'` và cờ `maxai` trong `info`.
> - `index.html`: thêm nút ⚡ Max AI, hàm `MX()` tự thêm tiền tố `m_`, và trang `m_release`.
> - `webhook.php`: thêm khối kiểm tra mã đơn của Max AI, đặt trước Video AI.

## Phát hành bản mới cho khách
1. Tăng `version` trong `package.json` (vd. 1.0.0 → 1.0.1) rồi đưa lên GitHub. GitHub Actions tự build Windows + macOS, mất khoảng 15–25 phút.
2. Vào trang quản trị › ⚡ Max AI › **Cập nhật phần mềm**:
   - Chọn *Bản Windows GitHub đã build*, ghi “Có gì mới”, bấm **🚀 Phát hành**.
   - Có thể tick “Bắt buộc mọi người” hoặc điền “Bắt buộc với bản thấp hơn”.
3. Phần mềm của khách:
   - Tự hỏi máy chủ khi mở và mỗi 6 giờ.
   - Khi có bản mới, tự tải về, kiểm tra SHA-256, cài im lặng rồi mở lại.
   - Máy Mac tự nhận bản mới ngay khi GitHub build xong.

Link cố định cho khách cài lần đầu:
- Windows: `https://github.com/alltoolsmax/Max-Video-AI/releases/latest/download/max_ai_mrhuynh_win.zip`
- macOS: `https://github.com/alltoolsmax/Max-Video-AI/releases/latest/download/max_ai_mrhuynh_mac.zip` (bên trong có bộ cài chip Apple M và Intel)

## Khách dùng như thế nào
1. Cài **FreeVideo** (https://github.com/FlashML-org/FreeVideo/releases). Cần GPU NVIDIA RTX 30 trở lên, 8 GB VRAM và 16 GB RAM, hoặc Mac chip Apple (bản preview). Mở FreeVideo một lần để nó tải model.
2. Cài và mở **Max AI**. App tự tìm FreeVideo (thư mục `%LOCALAPPDATA%\FreeVideo`, `~/Library/Application Support/FreeVideo` …). Nếu không tìm thấy thì vào Cài đặt › *Chọn thư mục…*.
3. Mở FreeVideo trước, rồi dùng Max AI.

## Chạy / build từ mã nguồn
- Chạy thử: cài Node.js 20+, bấm đúp `run-dev.bat` (hoặc `npm install && npm start`).
- Build bộ cài Windows: `build-windows.bat` → `dist\MaxAI-Setup-x.y.z.exe`.
- Thử giao diện khi không có GPU: `python dev/mock_server.py` (giả lập FreeVideo) rồi `FREEVIDEO_HOME=dev/mock_root npm start`.
- Thử với máy chủ bản quyền riêng: đặt biến `MAXAI_LICENSE_URL=http://…/maxai`.

## Cấu trúc
```
src/main/       main.js (cửa sổ) · freevideo.js (API FreeVideo, token) · license.js (bản quyền Ed25519, mã máy, đếm máy)
                updater.js (cập nhật online) · bridge.js (các lệnh giao diện được phép gọi) · license-config.json (khóa công khai)
src/renderer/   index.html · styles.css (tông GCloud Hub) · js/ (lõi, thành phần, bản quyền) · pages/ (từng trang)
hosting/        máy chủ PHP: active.mrhuynh.net/maxai, admin/maxai_api.php (+ api.php, index.html, webhook.php đã gộp),
                active_private/maxai/lib.php (namespace MaxAI, sao từ Video AI)
tools/          prepare-hosting.js (con dấu + gói hosting) · make-downloads.js (gói phát hành, GitHub Actions gọi)
.github/        workflows/build.yml (build Windows + macOS, đưa lên Releases)
```

## Giấy phép bên thứ ba
- Engine FreeVideo: Apache License 2.0. Max AI chỉ gọi API cục bộ `/freevideo/agent/v1`, không chứa và không sửa mã của FreeVideo.
- Trọng số model MiniMax H3 / VDN-H3: MiniMax H3 Community License, có giới hạn về lãnh thổ và mục đích sử dụng. Khách tự tải qua FreeVideo.
- Material Symbols (Apache-2.0), Roboto (OFL-1.1).
