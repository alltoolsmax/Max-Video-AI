'use strict';
// electron-builder afterPack: ký ad-hoc app Mac (chưa có chứng chỉ Apple Developer).
// Không ký thì macOS 13+ giữ app lại ngay lúc nạp (_dyld_start) — app "chạy" mà không bao giờ hiện cửa sổ.
// Ký ad-hoc → macOS hiện hộp thoại bình thường và có nút "Vẫn mở" trong Cài đặt › Quyền riêng tư & Bảo mật.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  const run = (args) => execFileSync('codesign', args, { stdio: 'inherit' });
  // Ký từ trong ra ngoài: framework, helper, rồi cả app
  run(['--force', '--deep', '--sign', '-', '--timestamp=none', app]);
  run(['--verify', '--deep', '--strict', '--verbose=2', app]);
  console.log('  • đã ký ad-hoc ' + app);
};
