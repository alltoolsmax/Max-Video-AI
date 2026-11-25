'use strict';
// Thay cho preload.js khi chạy giao diện trong trình duyệt thường (dev/harness.js).
(function () {
  const call = async (channel, args) => {
    const r = await fetch('/__bridge', { method: 'POST', body: JSON.stringify({ channel, args }) });
    return r.json();
  };
  const listeners = [];
  const es = new EventSource('/__events');
  es.onmessage = (m) => { const { name, payload } = JSON.parse(m.data); listeners.filter((l) => l.event === name).forEach((l) => l.cb(payload)); };
  window.fv = {
    config: {
      get: () => call('config:get'),
      set: (values) => call('config:set', values),
      detect: () => call('config:detect'),
      pickRoot: () => call('config:pickRoot'),
    },
    api: (method, route, body) => call('api', { method, route, body }),
    pickFiles: (kinds, multiple) => call('files:pick', { kinds, multiple }),
    dropped: async () => null,
    upload: (path) => call('files:upload', { path }),
    save: (route, name) => call('media:save', { route, name }),
    mediaUrl: (route) => (route ? '/__media' + route : ''),
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
    update: { check: () => call('update:check'), download: () => call('update:download'), install: () => call('update:install') },
    open: (url) => call('shell:open', { url }),
    theme: () => {},
    on: (event, cb) => { const l = { event, cb }; listeners.push(l); return () => listeners.splice(listeners.indexOf(l), 1); },
  };
})();
