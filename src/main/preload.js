'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, args) => ipcRenderer.invoke('bridge', channel, args);
const EVENTS = ['update:progress', 'update:available', 'engine:status'];

contextBridge.exposeInMainWorld('fv', {
  config: {
    get: () => call('config:get'),
    set: (values) => call('config:set', values),
  },
  api: (method, route, body) => call('api', { method, route, body }),
  pickFiles: (kinds, multiple) => call('files:pick', { kinds, multiple }),
  dropped: (file) => call('files:dropped', { path: webUtils.getPathForFile(file) }),
  upload: (path) => call('files:upload', { path }),
  save: (route, name) => call('media:save', { route, name }),
  mediaUrl: (route) => (route ? 'fvmedia://api' + route : ''),
  // Max AI: engine trong máy, cập nhật, video hướng dẫn, thông tin ứng dụng
  app: () => call('app:info'),
  legal: () => call('legal:texts'),
  importMedia: (path) => call('files:import', { path }),
  deleteLibrary: (ids) => call('library:delete', { ids }),
  quit: () => call('app:quit'),
  guides: () => call('guides'),
  gpt: {
    info: () => call('gpt:info'),
    set: (key, model) => call('gpt:set', { key, model }),
    test: (key) => call('gpt:test', { key }),
    run: (task, input) => call('gpt:run', { task, input }),
    prompt: (task, input) => call('ai:prompt', { task, input }),
  },
  engine: {
    status: () => call('engine:status'),
    pickRoot: () => call('engine:pickRoot'),
    useDefault: () => call('engine:useDefault'),
    pickModels: () => call('engine:pickModels'),
    plan: (opts) => call('engine:plan', opts),
    install: (opts) => call('engine:install', opts),
    cancel: () => call('engine:cancel'),
    start: () => call('engine:start'),
    stop: () => call('engine:stop'),
    autostart: (value) => call('engine:autostart', { value }),
    auto: () => call('engine:auto'),
    packs: () => call('engine:packs'),
    pack: (id, action) => call('engine:pack', { id, action }),
  },
  update: {
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
  },
  open: (url) => call('shell:open', { url }),
  theme: (t) => ipcRenderer.send('theme', t),
  on: (event, cb) => {
    if (!EVENTS.includes(event)) return () => {};
    const h = (_e, name, payload) => { if (name === event) cb(payload); };
    ipcRenderer.on('event', h);
    return () => ipcRenderer.removeListener('event', h);
  },
});
