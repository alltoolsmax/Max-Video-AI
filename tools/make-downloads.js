// Gói phát hành Max AI (giống GCloud Hub / Video AI).
//
// Windows (GitHub Actions tự gọi):  node tools/make-downloads.js
//   → dist/downloads-upload.zip – tải lên mrhuynh.net/downloads/ rồi Extract (ghi đè). Chỉ gồm:
//       max_ai_mrhuynh_win.exe   bộ cài – phần mềm TỰ CẬP NHẬT tải file này
//       max_ai_mrhuynh_win.zip   cho khách tải lần đầu (bên trong 1 tệp .exe)
//       max_win.json      phiên bản, SHA-256, dung lượng (trang quản trị đọc)
//
// macOS (GitHub Actions tự gọi, không cần làm gì):  node tools/make-downloads.js --mac <arm64.dmg>  (chỉ chip Apple)
//   → dist/downloads-mac/ = tệp TÊN CỐ ĐỊNH đưa lên GitHub Releases:
//       max_ai_mrhuynh_mac.zip (khách tải lần đầu, bộ cài chip Apple) – link cố định
//         https://github.com/alltoolsmax/Max-Video-AI/releases/latest/download/max_ai_mrhuynh_mac.zip
//       max_ai_mrhuynh_mac_apple.dmg (phần mềm Mac tự cập nhật) + max_mac.json (máy chủ đọc)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');

const DIST = path.join(__dirname, '..', 'dist');
const today = () => new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

// ---- zip tối giản (không nén – .exe/.dmg đã nén sẵn), không cần thư viện ngoài
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32File(file) {
  let c = 0xffffffff;
  const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 20); let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) for (let i = 0; i < n; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  fs.closeSync(fd);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(dest, entries) {           // entries: [[tênTrongZip, đườngDẫn]]
  const out = fs.openSync(dest, 'w'); let off = 0; const central = [];
  const w = (b) => { fs.writeSync(out, b); off += b.length; };
  for (const [name, file] of entries) {
    const size = fs.statSync(file).size; const crc = crc32File(file); const nb = Buffer.from(name, 'utf8'); const at = off;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(nb.length, 26);
    w(h); w(nb);
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 20); let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) w(buf.subarray(0, n));
    fs.closeSync(fd);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(size, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(at, 42);
    central.push(Buffer.concat([c, nb]));
  }
  const cdAt = off; central.forEach(w); const cdSize = off - cdAt;
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cdSize, 12); e.writeUInt32LE(cdAt, 16); w(e);
  fs.closeSync(out);
}
function sha256(file) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 20); let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd); return h.digest('hex');
}
function fresh(dir) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); return dir; }

function win() {
  const setup = path.join(DIST, `MaxAI-Setup-${pkg.version}.exe`);
  if (!fs.existsSync(setup)) { console.error('Không thấy ' + setup + ' (build bộ cài trước).'); process.exit(1); }
  const out = fresh(path.join(DIST, 'downloads'));
  const exe = path.join(out, 'max_ai_mrhuynh_win.exe');
  fs.copyFileSync(setup, exe);
  zipStore(path.join(out, 'max_ai_mrhuynh_win.zip'), [['max_ai_mrhuynh_win.exe', exe]]);
  const info = { version: pkg.version, sha256: sha256(exe), size: fs.statSync(exe).size,
    zip_size: fs.statSync(path.join(out, 'max_ai_mrhuynh_win.zip')).size, date: today() };
  fs.writeFileSync(path.join(out, 'max_win.json'), JSON.stringify(info, null, 1));
  const z = path.join(DIST, 'downloads-upload.zip');
  zipStore(z, ['max_ai_mrhuynh_win.exe', 'max_ai_mrhuynh_win.zip', 'max_win.json'].map((n) => [n, path.join(out, n)]));
  console.log('Đã tạo ' + z);
}

// Chỉ build cho Mac chip Apple (M1 trở lên): engine tạo video không chạy trên Mac chip Intel.
function mac(arm) {
  if (!arm || !fs.existsSync(arm)) { console.error('Không thấy ' + arm); process.exit(1); }
  const out = fresh(path.join(DIST, 'downloads-mac'));
  const info = { version: pkg.version, date: today(), archs: ['apple'] };
  const name = 'max_ai_mrhuynh_mac_apple.dmg'; const dst = path.join(out, name);
  fs.copyFileSync(arm, dst);
  info.apple = { file: name, sha256: sha256(dst), size: fs.statSync(dst).size };
  zipStore(path.join(out, 'max_ai_mrhuynh_mac.zip'), [[name, dst]]);
  info.zip = 'max_ai_mrhuynh_mac.zip'; info.zip_size = fs.statSync(path.join(out, 'max_ai_mrhuynh_mac.zip')).size;
  fs.writeFileSync(path.join(out, 'max_mac.json'), JSON.stringify(info, null, 1));
  console.log('Đã tạo ' + out + ': ' + fs.readdirSync(out).join(', '));
}

if (process.argv[2] === '--mac') mac(process.argv[3]);
else win();
