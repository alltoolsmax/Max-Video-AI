'use strict';
// Kiểm tra nhanh máy khách (không cài gì, vài giây): card đồ hoạ, VRAM, RAM → máy chạy được mức nào.
//   full : bản đầy đủ MiniMax H3 (FreeVideo) — NVIDIA RTX 30 trở lên (compute 8.0+) ≥ 8 GB VRAM + ≥ 16 GB RAM, hoặc Mac chip Apple ≥ 16 GB
//   lite : chế độ nhẹ Wan 2.2 5B (ComfyUI) — NVIDIA ≥ 6 GB VRAM (GTX 16xx, RTX 20xx…) + ≥ 16 GB RAM
//   none : không đủ để tạo video trên máy này
const os = require('os');
const { execFile } = require('child_process');

const GiB = 1024 ** 3;

function exec(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

function nvidiaSmiPath() {
  if (process.platform !== 'win32') return 'nvidia-smi';
  const sys = process.env.SystemRoot || 'C:\\Windows';
  return require('fs').existsSync(sys + '\\System32\\nvidia-smi.exe') ? sys + '\\System32\\nvidia-smi.exe' : 'nvidia-smi';
}

// Danh sách card NVIDIA: [{ name, vram (byte), cap: [major, minor] | null, driver }]
async function nvidiaGpus() {
  const smi = nvidiaSmiPath();
  let out = await exec(smi, ['--query-gpu=name,memory.total,compute_cap,driver_version', '--format=csv,noheader,nounits']);
  let withCap = true;
  if (!out.trim()) {   // driver cũ chưa có compute_cap
    out = await exec(smi, ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']);
    withCap = false;
  }
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split(',').map((x) => x.trim());
    const cap = withCap && /^\d+\.\d+$/.test(p[2]) ? p[2].split('.').map(Number) : null;
    return { name: p[0], vram: Math.round(Number(p[1]) || 0) * 1024 * 1024, cap: cap || guessCap(p[0]), driver: withCap ? p[3] : p[2] };
  }).filter((g) => g.name);
}

// Đoán compute capability theo tên khi driver không trả về
function guessCap(name) {
  const n = String(name).toUpperCase();
  if (/RTX\s*50|BLACKWELL|B200|RTX PRO 6000/.test(n)) return [12, 0];
  if (/RTX\s*40|ADA|L40|L4\b/.test(n)) return [8, 9];
  if (/RTX\s*30|A\d{3,4}\b|A40|A10\b|A100/.test(n)) return [8, 6];
  if (/RTX\s*20|GTX\s*16|TITAN RTX|T4\b|QUADRO RTX/.test(n)) return [7, 5];
  if (/GTX\s*10|TITAN X|P\d{2,4}\b/.test(n)) return [6, 1];
  return null;
}

// Card không phải NVIDIA (Windows): để báo cho khách biết máy đang có card gì
async function otherGpusWindows() {
  const out = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }']);
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const fmt = (b) => (b / GiB >= 10 ? Math.round(b / GiB) : Math.round(b / GiB * 10) / 10) + ' GB';

async function check() {
  const ram = os.totalmem();
  const result = { platform: process.platform, arch: process.arch, ram, ram_text: fmt(ram), gpus: [], gpu: '', vram: 0, cap: null, tier: 'none', reasons: [] };

  if (process.platform === 'darwin') {
    // Mac chạy bản x64 trên chip Apple (Rosetta) vẫn là chip Apple
    const arm = process.arch === 'arm64' || (await exec('sysctl', ['-n', 'hw.optional.arm64'])).trim() === '1';
    const chip = (await exec('sysctl', ['-n', 'machdep.cpu.brand_string'])).trim();
    result.gpu = arm ? (chip || 'Apple Silicon') : (chip || 'Intel');
    result.vram = arm ? ram : 0;
    if (!arm) {
      result.reasons.push('Mac chip Intel không chạy được mô hình tạo video (cần Mac chip Apple M1 trở lên).');
    } else if (ram < 15 * GiB) {
      result.reasons.push('Mac cần ít nhất 16 GB bộ nhớ để tạo video (máy này ' + fmt(ram) + ').');
    } else {
      result.tier = 'full';
      if (ram < 23 * GiB) result.reasons.push('Máy 16 GB chạy được nhưng chậm; 24 GB trở lên sẽ nhanh hơn.');
    }
    return result;
  }

  const gpus = process.platform === 'win32' || process.platform === 'linux' ? await nvidiaGpus() : [];
  result.gpus = gpus;
  const best = gpus.slice().sort((a, b) => b.vram - a.vram)[0];
  if (!best) {
    const others = process.platform === 'win32' ? await otherGpusWindows() : [];
    result.gpu = others.join(', ') || 'Không có card đồ hoạ rời';
    if (others.some((n) => /nvidia/i.test(n))) {
      // Có card NVIDIA nhưng không đọc được (driver cũ / thiếu nvidia-smi): không chặn, để trình cài tự kiểm tra
      result.tier = 'unknown';
      result.reasons.push('Có card NVIDIA nhưng chưa đọc được dung lượng VRAM — hãy cập nhật driver NVIDIA bản mới.');
      return result;
    }
    result.reasons.push(others.length
      ? 'Không thấy card NVIDIA (máy có: ' + others.join(', ') + '). Mô hình tạo video cần card NVIDIA từ 6 GB VRAM trở lên.'
      : 'Không thấy card NVIDIA. Mô hình tạo video cần card NVIDIA từ 6 GB VRAM trở lên.');
    return result;
  }
  result.gpu = best.name; result.vram = best.vram; result.cap = best.cap; result.driver = best.driver;
  const vram = best.vram; const cap = best.cap ? best.cap[0] + best.cap[1] / 10 : 0;
  const ramOk = ram >= 15 * GiB;
  if (cap >= 8 && vram >= 7.5 * GiB && ramOk) {
    result.tier = 'full';
  } else if (vram >= 5.5 * GiB && ramOk && (cap === 0 || cap >= 6)) {
    result.tier = 'lite';
    if (cap > 0 && cap < 8) result.reasons.push(best.name + ' chưa hỗ trợ bản đầy đủ MiniMax H3 (cần RTX 30 trở lên) — dùng chế độ nhẹ.');
    else if (vram < 7.5 * GiB) result.reasons.push(best.name + ' có ' + fmt(vram) + ' VRAM, bản đầy đủ cần 8 GB — dùng chế độ nhẹ.');
    if (ram < 23 * GiB) result.reasons.push('Nên có 24–32 GB RAM để chế độ nhẹ chạy mượt (máy này ' + fmt(ram) + ').');
  } else {
    if (!ramOk) result.reasons.push('Cần ít nhất 16 GB RAM (máy này ' + fmt(ram) + ').');
    if (vram < 5.5 * GiB) result.reasons.push(best.name + ' chỉ có ' + fmt(vram) + ' VRAM, cần ít nhất 6 GB.');
    if (cap > 0 && cap < 6) result.reasons.push(best.name + ' quá cũ cho mô hình tạo video.');
  }
  return result;
}

// Thử bằng dữ liệu giả: MAXAI_HW_CHECK='{"tier":"lite",...}'
async function checkCached() {
  if (process.env.MAXAI_HW_CHECK) { try { return { ram_text: '', gpus: [], reasons: [], ...JSON.parse(process.env.MAXAI_HW_CHECK) }; } catch { /* bỏ qua */ } }
  if (!checkCached.value) checkCached.value = check().catch((e) => ({ tier: 'unknown', reasons: [String(e.message || e)], gpu: '', ram_text: fmt(os.totalmem()) }));
  return checkCached.value;
}

module.exports = { check: checkCached, fmt, GiB };
