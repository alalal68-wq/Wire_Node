// compat.js — минимальный шим WebExtensions API.
// Firefox: уже есть промис-based `browser` -> ничего не делаем.
// Chrome (MV2): есть колбэк-based `chrome` -> оборачиваем в промисы и кладём в `browser`.
(function () {
  if (typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime) return;
  const c = globalThis.chrome;
  if (!c) return;

  const wrap = (fn, ctx) => (...args) =>
    new Promise((resolve, reject) => {
      try {
        fn.call(ctx, ...args, (res) => {
          const err = c.runtime && c.runtime.lastError;
          if (err) reject(new Error(err.message || String(err)));
          else resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });

  globalThis.browser = {
    runtime: {
      sendMessage: wrap(c.runtime.sendMessage, c.runtime),
      onMessage: c.runtime.onMessage,
      getURL: c.runtime.getURL ? c.runtime.getURL.bind(c.runtime) : undefined,
      get lastError() { return c.runtime.lastError; },
    },
    storage: {
      local: {
        get: wrap(c.storage.local.get, c.storage.local),
        set: wrap(c.storage.local.set, c.storage.local),
      },
      onChanged: c.storage.onChanged,
    },
    tabs: {
      query: wrap(c.tabs.query, c.tabs),
      sendMessage: wrap(c.tabs.sendMessage, c.tabs),
    },
  };
})();
