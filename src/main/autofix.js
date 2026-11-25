'use strict';
// Tự chẩn đoán & tự sửa khi trình cài engine dừng ở một bước kiểm tra (máy khách không cần làm gì).
// Đọc log của bước lỗi (setup-runs/.../NN-<bước>.log), nhận diện nguyên nhân thường gặp trên Windows:
//   vcredist  : thiếu / hỏng Microsoft Visual C++ Runtime → PyTorch không nạp được DLL (WinError 126/1114, c10.dll…)
//   env       : môi trường Python của engine hỏng (tải dở, file bị phần mềm diệt virus xoá/khoá) → xoá để trình cài dựng lại
//   driver    : driver NVIDIA quá cũ → không tự sửa được, báo rõ cho khách cách cập nhật
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const VC_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';

function readStepLog(failure, root) {
  let file = (String(failure).match(/(?:Retained step log|Log chi tiết):\s*(.+?\.log)/) || [])[1];
  if (!file && root) {
    // Không có đường dẫn: lấy file log mới nhất của lần cài gần nhất
    try {
      const runs = path.join(root, 'setup-runs');
      const last = fs.readdirSync(runs).sort().pop();
      const dir = path.join(runs, last);
      file = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).map((f) => path.join(dir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    } catch { /* không có */ }
  }
  let text = '';
  try { text = fs.readFileSync(file.trim(), 'utf8'); } catch { /* không đọc được */ }
  return { file, text: text.slice(-60000) };
}

function diagnose(failure, root, log = []) {
  const f = String(failure || '');
  const step = (f.match(/Failed step: (\S+)/) || f.match(/Bước "([^"]+)"/) || [])[1] || '';
  const { file, text } = readStepLog(f, root);
  const all = f + '\n' + text + '\n' + log.slice(-80).join('\n');
  const envs = envFor(step);

  if (/CUDA driver version is insufficient|NVIDIA driver on your system is too old|found no NVIDIA driver|driver.{0,40}(too old|older than)|Install NVIDIA driver \d+/i.test(all)) {
    return { kind: 'driver', step, file, fixes: [],
      message: 'Driver card NVIDIA trên máy quá cũ. Hãy cập nhật driver NVIDIA mới nhất (bản 580 trở lên) tại nvidia.com/drivers hoặc ứng dụng NVIDIA App, khởi động lại máy rồi mở lại Max Video AI — phần đã tải được giữ lại.' };
  }
  if (/No space left|not enough space|Insufficient disk space|WinError 112/i.test(all)) {
    return { kind: 'disk', step, file, fixes: [], message: 'Ổ đĩa đầy. Hãy giải phóng thêm dung lượng (hoặc chọn thư mục cài ở ổ khác trong Engine & mô hình) rồi bấm Cài tiếp.' };
  }
  if (/DLL load failed|WinError (126|127|1114|193)|specified (module|procedure) could not be found|c10(_cuda)?\.dll|fbgemm\.dll|torch_(cpu|cuda|python)\.dll|cudnn\w*\.dll|vcruntime|msvcp140/i.test(all)) {
    return { kind: 'dll', step, file, fixes: IS_WIN ? ['vcredist', ...envs] : envs,
      message: 'Thư viện PyTorch không nạp được trên máy này (thiếu Microsoft Visual C++ Runtime hoặc bị phần mềm diệt virus chặn). Max Video AI đã thử tự sửa nhưng chưa được — hãy thêm thư mục cài engine vào danh sách loại trừ của phần mềm diệt virus rồi bấm Cài tiếp.' };
  }
  if (/Access is denied|PermissionError|WinError 5\b|WinError 32\b|being used by another process/i.test(all)) {
    return { kind: 'locked', step, file, fixes: envs,
      message: 'File của engine đang bị khoá (thường do phần mềm diệt virus). Hãy thêm thư mục cài engine vào danh sách loại trừ của phần mềm diệt virus, rồi bấm Cài tiếp.' };
  }
  if (/check|runtime|import|ModuleNotFoundError|ImportError|No module named|SyntaxError|BadZipFile|RECORD|corrupt|hash mismatch/i.test(step + '\n' + all)) {
    return { kind: 'env', step, file, fixes: envs,
      message: 'Môi trường Python của engine bị hỏng và tự dựng lại chưa được. Hãy bấm Cài tiếp; nếu vẫn lỗi, gửi file log cho hỗ trợ (Zalo 0979 007 367): ' + (file || '') };
  }
  return { kind: 'unknown', step, file, fixes: [], message: '' };
}

// Bước nào thuộc môi trường nào: encoder-* → môi trường bộ đọc prompt; còn lại → môi trường engine chính
function envFor(step) {
  if (/encoder/i.test(step)) return ['env:encoder'];
  if (/windows-runtime|runtime|vdn|torch/i.test(step)) return ['env:engine'];
  return ['env:encoder'];
}

async function apply(fix, { root, say, log, task }) {
  if (fix === 'vcredist') return installVcRedist({ root, say, log, task });
  if (fix.startsWith('env:')) return resetEnvironment(fix.slice(4), { root, say, log });
  return false;
}

// Xoá môi trường Python hỏng để trình cài dựng lại sạch (gói đã tải nằm trong bộ đệm nên dựng lại nhanh; mô hình không bị ảnh hưởng)
function resetEnvironment(role, { root, say, log }) {
  const envs = path.join(root, 'envs');
  let names = [];
  try { names = fs.readdirSync(envs); } catch { return false; }
  // Bố cục "dual": encoder + engine; "unified": 1 môi trường dùng chung
  const pick = role === 'encoder' ? names.filter((n) => /encoder/i.test(n)) : names.filter((n) => !/encoder|frontend/i.test(n));
  const targets = pick.length ? pick : names.filter((n) => /unified/i.test(n));
  if (!targets.length) return false;
  say('Đang tự sửa: dựng lại môi trường Python của engine');
  for (const n of targets) {
    const dir = path.join(envs, n);
    const trash = path.join(root, '.maxai', 'trash-' + n + '-' + Date.now());
    try {
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(dir, trash);              // đổi tên trước (nhanh, kể cả khi vài file đang bị khoá)
      fs.rm(trash, { recursive: true, force: true }, () => {});
      log('Đã gỡ môi trường ' + n + ' để cài lại');
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); log('Đã xoá môi trường ' + n); } catch (e2) { log('Không xoá được ' + n + ': ' + e2.message); }
    }
  }
  return true;
}

function vcRedistPresent() {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  return ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].every((f) => fs.existsSync(path.join(sys, f)));
}

// Cài Microsoft Visual C++ Redistributable (x64) — Windows hỏi quyền quản trị 1 lần (khách bấm "Có")
async function installVcRedist({ root, say, log, task }) {
  if (!IS_WIN) return false;
  say('Đang tự sửa: cài Microsoft Visual C++ Runtime (nếu Windows hỏi quyền, hãy bấm "Có")');
  const file = path.join(root || os.tmpdir(), '.maxai', 'vc_redist.x64.exe');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const res = await fetch(VC_URL, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } catch (e) { log('Không tải được VC++ Runtime: ' + e.message); return false; }
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmd = `$p = Start-Process -FilePath '${file.replace(/'/g, "''")}' -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const code = await new Promise((resolve) => {
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, stdio: 'ignore' });
    if (task) task.child = child;
    child.on('close', resolve);
    child.on('error', () => resolve(-1));
  });
  // 0 = xong, 3010 = xong (cần khởi động lại), 1638 = đã có bản mới hơn
  const ok = [0, 3010, 1638].includes(code);
  log(ok ? 'Đã cài Visual C++ Runtime (mã ' + code + ')' : 'Cài Visual C++ Runtime không thành công (mã ' + code + ', có thể đã bấm "Không")');
  try { fs.rmSync(file, { force: true }); } catch { /* bỏ qua */ }
  return ok || vcRedistPresent();
}

module.exports = { diagnose, apply, vcRedistPresent };
