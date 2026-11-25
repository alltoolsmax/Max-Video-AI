'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { Bridge } = require('./bridge');

// fvmedia://api/freevideo/agent/v1/... → chuyển tiếp tới FreeVideo kèm token (để <video>/<img> hiển thị được).
protocol.registerSchemesAsPrivileged([
  { scheme: 'fvmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let win;
let bridge;

// Nhật ký khởi động (để tìm lỗi khi app không mở được): ~/Library/Logs/Max AI/main.log (Mac), %APPDATA%\Max AI\logs\main.log (Windows)
let logFile = null;
function log(...args) {
  const line = new Date().toISOString() + ' ' + args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  try {
    if (!logFile) { logFile = path.join(app.getPath('logs'), 'main.log'); fs.mkdirSync(path.dirname(logFile), { recursive: true }); if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.unlinkSync(logFile); }
    fs.appendFileSync(logFile, line + '\n');
  } catch { /* bỏ qua */ }
}
process.on('uncaughtException', (e) => {
  log('[lỗi] uncaughtException', e);
  try { dialog.showErrorBox('Max Video AI gặp lỗi', String((e && e.stack) || e) + '\n\nNhật ký: ' + (logFile || '')); } catch { /* bỏ qua */ }
});
process.on('unhandledRejection', (e) => log('[lỗi] unhandledRejection', e));
log('Khởi động Max Video AI', app.getVersion(), process.platform, process.arch, 'Electron', process.versions.electron);

// Giao diện tối/sáng đã lưu (để nền cửa sổ và nút đóng/thu nhỏ đúng màu ngay khi mở, giống GCloud Hub)
function savedTheme() {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).prefs.theme;
    return t === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : (t || 'dark');
  } catch { return 'dark'; }
}

function createWindow() {
  const theme = savedTheme();
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'Max Video AI by Mr. Huỳnh', backgroundColor: theme === 'light' ? '#f4f6fb' : '#0b1020', show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: theme === 'light' ? '#334155' : '#cbd5e1', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => { log('Cửa sổ sẵn sàng'); win.show(); });
  // Phòng khi trang không vẽ được (ready-to-show không tới): vẫn hiện cửa sổ sau 8 giây
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) { log('[cảnh báo] ready-to-show chưa tới sau 8 giây — hiện cửa sổ'); win.show(); } }, 8000);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('[lỗi] did-fail-load', code, desc, url));
  win.webContents.on('render-process-gone', (_e, d) => log('[lỗi] render-process-gone', d));
  win.webContents.on('preload-error', (_e, p, err) => log('[lỗi] preload-error', p, err));
  win.webContents.on('console-message', (e) => { const lv = e.level !== undefined ? e.level : 0; if (lv === 'error' || lv === 'warning' || lv >= 2) log('[renderer]', e.message || ''); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).then(() => log('Đã tải giao diện'), (e) => log('[lỗi] loadFile', e));
  // Liên kết ngoài mở bằng trình duyệt, không mở trong app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
  // Kiểm thử tự động: MAXAI_SMOKE=<file.png> chụp màn hình sau khi tải xong rồi thoát.
  if (process.env.MAXAI_SMOKE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      log('Smoke: visible=' + win.isVisible());
      const image = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.MAXAI_SMOKE, image.toPNG());
      app.quit();
    }, 7000));
  }
}

app.whenReady().then(() => {
  log('app ready, userData=' + app.getPath('userData'));
  bridge = new Bridge({
    settingsPath: path.join(app.getPath('userData'), 'settings.json'),
    dialogs: {
      async pickFolder(title) {
        const r = await dialog.showOpenDialog(win, { title: title || 'Chọn thư mục cài Max AI Engine', properties: ['openDirectory', 'createDirectory'] });
        return r.canceled ? null : r.filePaths[0];
      },
      async pickFiles(filters, multiple) {
        const r = await dialog.showOpenDialog(win, { filters, properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
        return r.canceled ? [] : r.filePaths;
      },
      async saveFile(name) {
        const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name) });
        return r.canceled ? null : r.filePath;
      },
      openExternal: (url) => shell.openExternal(url),
    },
    emit: (name, payload) => { if (win && !win.isDestroyed()) win.webContents.send('event', name, payload); },
    quit: () => app.exit(0),
  });

  // Đổi màu nút đóng/thu nhỏ khi người dùng đổi giao diện sáng/tối
  ipcMain.on('theme', (_e, theme) => {
    try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: theme === 'light' ? '#334155' : '#cbd5e1', height: 40 }); } catch { /* macOS */ }
  });

  protocol.handle('fvmedia', (request) => {
    const url = new URL(request.url);
    return bridge.connection.media(url.pathname + url.search, request.headers.get('range'));
  });

  ipcMain.handle('bridge', (_event, channel, args) => bridge.handle(channel, args));
  bridge.start().then(() => log('Bridge đã chạy'), (e) => log('[lỗi] bridge.start', e));

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  app.setAppUserModelId('net.mrhuynh.maxai');
  createWindow();
  log('Đã tạo cửa sổ');
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e) => { log('[lỗi] khởi động', e); try { dialog.showErrorBox('Max Video AI không khởi động được', String((e && e.stack) || e)); } catch { /* bỏ qua */ } });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Đóng Max Video AI → tắt engine AI (ComfyUI) và dừng việc tải mô hình đang chạy (lần sau tải tiếp).
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || !bridge) return;
  event.preventDefault();
  quitting = true;
  bridge.shutdown().finally(() => app.quit());
});
