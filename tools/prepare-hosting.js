// Chuẩn bị máy chủ bản quyền Max AI trên hosting active.mrhuynh.net (giống hosting\chuan-bi-hosting.bat của Video AI).
//
//   node tools/prepare-hosting.js [tên-miền]        (mặc định active.mrhuynh.net)
//
// Việc làm:
//  1. Tạo "con dấu" ký giấy phép (hosting/.maxai_seed.hex) nếu chưa có. KHÔNG xóa / KHÔNG đổi file này:
//     đổi con dấu = mọi key đã bán không dùng được với bản build mới.
//  2. Ghi khóa CÔNG KHAI + địa chỉ máy chủ vào src/main/license-config.json (phần mềm dùng để kiểm tra giấy phép).
//  3. Tạo hosting/upload/MaxAI-hosting.zip (lần đầu, có config.php) và MaxAI-hosting-update.zip (lần sau, không config):
//     tải lên THƯ MỤC CHÍNH của hosting rồi Extract là xong.
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

// ---- gói tải lên hosting: 1 file zip, giải nén ở THƯ MỤC CHÍNH của hosting (nơi có thư mục active.mrhuynh.net và active_private,
//      giống gói cập nhật của Video AI) → tự thêm Max AI + tự đè 3 file dùng chung, không đụng dữ liệu / config của tool khác.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const H = path.join(ROOT, 'hosting');
const code = [
  'active.mrhuynh.net/maxai/index.php', 'active.mrhuynh.net/maxai/.htaccess',
  'active.mrhuynh.net/admin/maxai_api.php', 'active.mrhuynh.net/admin/api.php', 'active.mrhuynh.net/admin/index.html',
  'active.mrhuynh.net/webhook.php',
  'active_private/maxai/lib.php', 'active_private/maxai/config.example.php',
].map((f) => [f.replace(/^active\.mrhuynh\.net\//, HOST + '/'), fs.readFileSync(path.join(H, f))]);
const deny = Buffer.from('Require all denied\n');
const guard = [['active_private/maxai/data/.htaccess', deny], ['active_private/maxai/logs/.htaccess', deny]];
const conf = Buffer.from(fs.readFileSync(path.join(H, 'active_private/maxai/config.example.php'), 'utf8')
  .replace("'DAN_SEED_HEX_VAO_DAY'", `'${seed}'`));
// Lần đầu: có config.php (con dấu). Lần sau: gói cập nhật KHÔNG có config.php → giải nén đè không mất gì.
zipStore(path.join(OUT, 'MaxAI-hosting.zip'), [...code, ...guard, ['active_private/maxai/config.php', conf]]);
zipStore(path.join(OUT, 'MaxAI-hosting-update.zip'), code);
console.log(`
Xong. Thư mục ${path.relative(ROOT, OUT)}:
  MaxAI-hosting.zip         → LẦN ĐẦU: cPanel › File Manager › THƯ MỤC CHÍNH (thấy 2 thư mục ${HOST} và active_private) › Upload › Extract.
                              Tự thêm Max AI, tự đè admin/api.php, admin/index.html, webhook.php. Có con dấu – giữ bí mật.
  MaxAI-hosting-update.zip  → LẦN SAU (cập nhật mã): làm y hệt. Không có config.php nên không mất gì.
Kiểm tra: https://${HOST}/maxai/v1/plans  ·  https://${HOST}/admin/ › nút ⚡ Max AI
Rồi đưa src/main/license-config.json lên GitHub để bản build mới khóa key.`);

// ---- zip không nén (giống tools/make-downloads.js)
function zipStore(dest, list) {   // list: [[tên trong zip, Buffer]]
  const d = new Date();
  const DOS_DATE = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const DOS_TIME = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = []; const central = []; let off = 0;
  for (const [name, data] of list) {
    const nb = Buffer.from(name, 'utf8'); const crc = crc32(data);
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
