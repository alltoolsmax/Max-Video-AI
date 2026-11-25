// Chuẩn bị máy chủ bản quyền Max AI trên hosting active.mrhuynh.net (giống hosting\chuan-bi-hosting.bat của Video AI).
//
//   node tools/prepare-hosting.js [tên-miền]        (mặc định active.mrhuynh.net)
//
// Việc làm:
//  1. Tạo "con dấu" ký giấy phép (hosting/.maxai_seed.hex) nếu chưa có. KHÔNG xóa / KHÔNG đổi file này:
//     đổi con dấu = mọi key đã bán không dùng được với bản build mới.
//  2. Ghi khóa CÔNG KHAI + địa chỉ máy chủ vào src/main/license-config.json (phần mềm dùng để kiểm tra giấy phép).
//  3. Tạo hosting/upload/:
//       MaxAI-hosting-update.zip  – tải lên thư mục chính của hosting rồi Extract (ghi đè). Không chứa config/dữ liệu.
//       active_private/maxai/config.php – CHỈ tải lên lần đầu (có con dấu). Lần sau không cần.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const HOST = (process.argv[2] || 'active.mrhuynh.net').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SEED_FILE = path.join(ROOT, 'hosting', '.maxai_seed.hex');
const OUT = path.join(ROOT, 'hosting', 'upload');

// ---- con dấu Ed25519 (32 byte) → khóa công khai dạng base64url (giống PHP sodium_crypto_sign_seed_keypair)
let seed = fs.existsSync(SEED_FILE) ? fs.readFileSync(SEED_FILE, 'utf8').trim() : '';
if (!/^[0-9a-f]{64}$/.test(seed)) {
  seed = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SEED_FILE, seed + '\n', { mode: 0o600 });
  console.log('Đã tạo con dấu mới: ' + SEED_FILE + '  ← SAO LƯU file này (USB / Drive riêng), không gửi cho ai.');
}
const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]);
const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
const pub = crypto.createPublicKey(priv).export({ format: 'jwk' }).x; // base64url, 32 byte

// ---- khóa công khai vào phần mềm
const cfgFile = path.join(ROOT, 'src', 'main', 'license-config.json');
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
Object.assign(cfg, { product: 'maxai', server_url: `https://${HOST}/maxai`, public_key: pub });
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
console.log('Đã ghi khóa công khai vào ' + path.relative(ROOT, cfgFile) + ': ' + pub);

// ---- gói tải lên hosting
fs.rmSync(OUT, { recursive: true, force: true });
const H = path.join(ROOT, 'hosting');
const files = [
  'active.mrhuynh.net/maxai/index.php', 'active.mrhuynh.net/maxai/.htaccess',
  'active.mrhuynh.net/admin/maxai_api.php', 'active.mrhuynh.net/admin/api.php', 'active.mrhuynh.net/admin/index.html',
  'active.mrhuynh.net/webhook.php',
  'active_private/maxai/lib.php', 'active_private/maxai/config.example.php',
];
const entries = files.map((f) => [f.replace(/^active\.mrhuynh\.net\//, ''), path.join(H, f)]);
// zip giải nén tại thư mục chính của subdomain; active_private nằm ngang hàng (giống Video AI) → đặt đường dẫn ../
fs.mkdirSync(OUT, { recursive: true });
const pub_entries = entries.filter(([n]) => !n.startsWith('active_private/'));
const priv_entries = entries.filter(([n]) => n.startsWith('active_private/'));
zipStore(path.join(OUT, 'MaxAI-hosting-update.zip'), pub_entries);
zipStore(path.join(OUT, 'MaxAI-private-update.zip'), priv_entries.map(([n, f]) => [n.replace(/^active_private\//, ''), f]));
const conf = fs.readFileSync(path.join(H, 'active_private/maxai/config.example.php'), 'utf8')
  .replace("'DAN_SEED_HEX_VAO_DAY'", `'${seed}'`);
fs.mkdirSync(path.join(OUT, 'active_private', 'maxai'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'active_private', 'maxai', 'config.php'), conf, { mode: 0o600 });
console.log(`
Xong. Thư mục ${path.relative(ROOT, OUT)}:
  MaxAI-hosting-update.zip   → cPanel › File Manager › thư mục gốc của ${HOST} › Upload › Extract (ghi đè)
                               (thêm maxai/, admin/maxai_api.php; cập nhật admin/api.php, admin/index.html, webhook.php)
  MaxAI-private-update.zip   → thư mục active_private/ › Upload › Extract (tạo/ghi đè active_private/maxai/lib.php)
  active_private/maxai/config.php → CHỈ LẦN ĐẦU: tải vào active_private/maxai/ (quyền 600). Có con dấu – giữ bí mật.
Kiểm tra: https://${HOST}/maxai/v1/plans  ·  https://${HOST}/admin/ › nút ⚡ Max AI
Rồi đưa src/main/license-config.json lên GitHub để bản build mới khóa key.`);

// ---- zip không nén (giống tools/make-downloads.js)
function zipStore(dest, list) {
  const d = new Date();
  const DOS_DATE = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const DOS_TIME = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = []; const central = []; let off = 0;
  for (const [name, file] of list) {
    const data = fs.readFileSync(file); const nb = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(Buffer.concat([c, nb]));
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(list.length, 8); e.writeUInt16LE(list.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.writeFileSync(dest, Buffer.concat([...parts, cd, e]));
}
