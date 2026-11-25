'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, args) => ipcRenderer.invoke('bridge', channel, args);
const EVENTS = ['update:progress', 'update:available', 'license:changed'];

contextBridge.exposeInMainWorld('fv', {
  config: {
    get: () => call('config:get'),
    set: (values) => call('config:set', values),
    detect: () => call('config:detect'),
    pickRoot: () => call('config:pickRoot'),
  },
  api: (method, route, body) => call('api', { method, route, body }),
  pickFiles: (kinds, multiple) => call('files:pick', { kinds, multiple }),
  dropped: (file) => call('files:dropped', { path: webUtils.getPathForFile(file) }),
  upload: (path) => call('files:upload', { path }),
  save: (route, name) => call('media:save', { route, name }),
  mediaUrl: (route) => (route ? 'fvmedia://api' + route : ''),
  // Max AI: bản quyền, cập nhật, thông tin ứng dụng
  app: () => call('app:info'),
  license: {
    get: () => call('license:get'),
    refresh: () => call('license:refresh'),
    activate: (key) => call('license:activate', { key }),
    plans: () => call('license:plans'),
    guides: () => call('license:guides'),
    order: (plan) => call('license:order', { plan }),
    orderStatus: (code) => call('license:orderStatus', { code }),
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
