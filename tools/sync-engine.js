#!/usr/bin/env node
/* Cập nhật Max AI Engine (mã nguồn mở Apache-2.0) lên một tag mới: node tools/sync-engine.js v0.6.12
   Tải mã nguồn engine vào engine/, giữ LICENSE/NOTICE, ghi engine/maxai-engine.json. Không tải mô hình. */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const tag = process.argv[2];
if (!tag) { console.error('Cách dùng: node tools/sync-engine.js <tag>'); process.exit(1); }
const UP = 'FlashML-org/FreeVideo';
const root = path.join(__dirname, '..'), dst = path.join(root, 'engine');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maxai-engine-'));
execFileSync('git', ['clone', '--depth', '1', '--branch', tag, `https://github.com/${UP}.git`, tmp], { stdio: 'inherit' });
const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD']).toString().trim();
for (const x of ['.git', '.github', 'docs', 'README.zh-CN.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CITATION.cff']) fs.rmSync(path.join(tmp, x), { recursive: true, force: true });
if (fs.existsSync(path.join(tmp, 'README.md'))) fs.renameSync(path.join(tmp, 'README.md'), path.join(tmp, 'UPSTREAM-README.md'));
const keep = path.join(dst, 'MAXAI-ENGINE.md'), note = fs.existsSync(keep) ? fs.readFileSync(keep) : null;
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(tmp, dst, { recursive: true });
if (note) fs.writeFileSync(keep, note);
fs.writeFileSync(path.join(dst, 'maxai-engine.json'), JSON.stringify({ name: 'Max AI Engine', upstream: UP, tag, commit }, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Engine → ${tag} (${commit.slice(0, 7)})`);
