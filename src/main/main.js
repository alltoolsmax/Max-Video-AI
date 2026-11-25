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
    title: 'Max AI by Mr. Huỳnh', backgroundColor: theme === 'light' ? '#f4f6fb' : '#0b1020', show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: theme === 'light' ? '#334155' : '#cbd5e1', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Liên kết ngoài mở bằng trình duyệt, không mở trong app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
  // Kiểm thử tự động: MAXAI_SMOKE=<file.png> chụp màn hình sau khi tải xong rồi thoát.
  if (process.env.MAXAI_SMOKE) {
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[renderer]', message); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const image = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.MAXAI_SMOKE, image.toPNG());
      app.quit();
    }, 7000));
  }
}

app.whenReady().then(() => {
  bridge = new Bridge({
    settingsPath: path.join(app.getPath('userData'), 'settings.json'),
    dialogs: {
      async pickFolder(title) {
        const r = await dialog.showOpenDialog(win, { title: title || 'Chọn thư mục cài đặt FreeVideo', properties: ['openDirectory', 'createDirectory'] });
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
  bridge.start();

  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  app.setAppUserModelId('net.mrhuynh.maxai');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Đóng Max AI → tắt engine AI (ComfyUI) và dừng việc tải mô hình đang chạy (lần sau tải tiếp).
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || !bridge) return;
  event.preventDefault();
  quitting = true;
  bridge.shutdown().finally(() => app.quit());
});
