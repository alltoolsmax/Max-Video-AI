'use strict';
// Cập nhật online qua máy chủ quản trị chung (active.mrhuynh.net/maxai) — giống Video AI / GCloud Hub:
// hỏi /v1/app/version → {version,url,sha256,size,notes,mandatory,min_version} → tải bộ cài → kiểm tra SHA-256 →
// Windows: chạy bộ cài im lặng (/S) rồi tự mở lại · macOS: thay .app từ .dmg rồi mở lại (lỗi → mở .dmg cho người dùng kéo thả).
// Mỗi lần hỏi cũng là một lượt "đếm máy" (mã máy đã băm + phiên bản) cho trang quản trị.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PKG = require('../../package.json');
const IS_MAC = process.platform === 'darwin';

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

class Updater {
  constructor({ device, onProgress, quit }) {
    this.device = device;
    this.onProgress = onProgress || (() => {});
    this.quit = quit || (() => process.exit(0));
    this.downloaded = null;
    this.last = null;
  }

  endpoint() {
    const q = new URLSearchParams({ os: IS_MAC ? 'mac' : 'win', arch: process.arch === 'arm64' ? 'arm64' : 'x64', v: PKG.version,
      m: this.device.machine, t: String(Date.now()) });
    return this.device.server + '/v1/app/version?' + q;
  }

  async info() {
    if (!this.device.server) throw new Error('Chưa cấu hình máy chủ cập nhật');
    let res;
    try { res = await fetch(this.endpoint(), { cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw new Error('Không kết nối được máy chủ cập nhật'); }
    if (!res.ok) throw new Error(`Máy chủ cập nhật trả lỗi ${res.status}`);
    const m = await res.json().catch(() => { throw new Error('Phản hồi máy chủ không hợp lệ'); });
    if (m && m.ok === false) throw new Error(m.message || 'Máy chủ từ chối yêu cầu');
    return m || {};
  }

  async check() {
    const m = await this.info();
    const latest = m.version || '0.0.0';
    const available = cmpVer(latest, PKG.version) > 0 && Boolean(m.url);
    const forced = Boolean(m.mandatory) || (m.min_version && cmpVer(PKG.version, m.min_version) < 0);
    this.last = { current: PKG.version, latest, notes: m.notes || '', available, mandatory: available && Boolean(forced), size: m.size || 0,
      date: m.released_at ? new Date((m.released_at > 1e12 ? m.released_at : m.released_at * 1000)).toLocaleDateString('vi-VN') : '',
      canInstall: process.platform === 'win32' || IS_MAC };
    return this.last;
  }

  async download() {
    const m = await this.info();
    if (!m.url) throw new Error('Máy chủ chưa công bố bản cập nhật nào');
    if (!/^https:\/\//i.test(m.url) && !process.env.MAXAI_ALLOW_HTTP) throw new Error('Link bản cập nhật không an toàn (cần https)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxai-update-'));
    const ext = IS_MAC ? '.dmg' : '.exe';
    let name = 'MaxAI-update' + ext;
    try { name = path.basename(new URL(m.url).pathname) || name; } catch { /* giữ tên mặc định */ }
    if (!/\.(exe|dmg)$/i.test(name)) name += ext;
    const file = path.join(dir, name);
    const res = await fetch(m.url);
    if (!res.ok || !res.body) throw new Error(`Tải bản cập nhật lỗi ${res.status}`);
    const total = Number(res.headers.get('content-length')) || m.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let got = 0, lastEmit = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      got += buf.length;
      if (Date.now() - lastEmit > 200) { lastEmit = Date.now(); this.onProgress({ got, total }); }
    }
    await new Promise((r) => out.end(r));
    this.onProgress({ got, total: total || got });
    if (!m.sha256) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('Bản cập nhật thiếu mã SHA-256 — đã hủy để bảo đảm an toàn'); }
    if (hash.digest('hex').toLowerCase() !== String(m.sha256).toLowerCase()) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error('Bản cập nhật bị lỗi hoặc không đúng (sai mã SHA-256) — đã hủy, sẽ thử lại sau');
    }
    this.downloaded = { file, version: m.version };
    return { version: m.version, size: got };
  }

  install() {
    if (!this.downloaded) throw new Error('Chưa tải bản cập nhật');
    if (process.platform === 'win32') {
      spawn(this.downloaded.file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => this.quit(), 600);
      return true;
    }
    if (IS_MAC) return this.installMac();
    throw new Error('Tự cài cập nhật chỉ hỗ trợ Windows và macOS');
  }

  installMac() {
    const dmg = this.downloaded.file;
    const exe = process.execPath;
    const idx = exe.indexOf('.app/');
    const dest = idx !== -1 ? exe.slice(0, idx + 4) : path.resolve(path.dirname(exe), '..', '..');
    const sh = path.join(os.tmpdir(), 'maxai-update-' + Date.now() + '.sh');
    const script = `#!/bin/bash
set -u
DMG=${JSON.stringify(dmg)}
DEST=${JSON.stringify(dest)}
open_dmg(){ /usr/bin/open "$DMG"; exit 0; }
sleep 2
PARENT="$(dirname "$DEST")"
[ -w "$PARENT" ] || open_dmg
MNT="$(/usr/bin/mktemp -d /tmp/maxai-dmg-XXXXXX)"
/usr/bin/hdiutil attach "$DMG" -nobrowse -noautoopen -mountpoint "$MNT" >/dev/null 2>&1 || open_dmg
APP="$(/bin/ls "$MNT" | /usr/bin/grep -i '\\.app$' | /usr/bin/head -1)"
if [ -z "$APP" ]; then /usr/bin/hdiutil detach "$MNT" -force >/dev/null 2>&1; open_dmg; fi
/bin/rm -rf "$DEST" 2>/dev/null
if ! /usr/bin/ditto "$MNT/$APP" "$DEST" >/dev/null 2>&1; then /usr/bin/hdiutil detach "$MNT" -force >/dev/null 2>&1; open_dmg; fi
/usr/bin/xattr -dr com.apple.quarantine "$DEST" >/dev/null 2>&1
/usr/bin/hdiutil detach "$MNT" -force >/dev/null 2>&1
/usr/bin/open "$DEST"
/bin/rm -f ${JSON.stringify(sh)} >/dev/null 2>&1
`;
    fs.writeFileSync(sh, script, { mode: 0o755 });
    spawn('/bin/bash', [sh], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => this.quit(), 600);
    return true;
  }
}

module.exports = { Updater, cmpVer };
