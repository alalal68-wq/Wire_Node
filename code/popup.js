document.addEventListener('DOMContentLoaded', () => {
  const g = id => document.getElementById(id);

  const PRESETS = {
    deepseek:   { url: 'https://api.deepseek.com/chat/completions',        model: 'deepseek-chat',          ph: 'sk-...' },
    groq:       { url: 'https://api.groq.com/openai/v1/chat/completions',  model: 'llama-3.3-70b-versatile', ph: 'gsk_...' },
    openai:     { url: 'https://api.openai.com/v1/chat/completions',       model: 'gpt-4o-mini',            ph: 'sk-...' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',    model: 'deepseek/deepseek-chat', ph: 'sk-or-...' },
    custom:     { url: '',                                                 model: '',                       ph: 'ваш ключ' }
  };

  function applyPreset(name, force) {
    const p = PRESETS[name]; if (!p) return;
    g('apiKey').placeholder = p.ph;
    if (name === 'custom') return;
    // заполняем только если поле пустое или если пользователь явно сменил провайдер
    if (force || !g('apiUrl').value.trim()) g('apiUrl').value = p.url;
    if (force) g('model').value = '';     // авто-определение по URL
    g('model').placeholder = p.model;
  }

  function providerFromUrl(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('groq.com')) return 'groq';
    if (u.includes('openai.com')) return 'openai';
    if (u.includes('openrouter.ai')) return 'openrouter';
    if (u.includes('deepseek')) return 'deepseek';
    if (!u) return 'deepseek';
    return 'custom';
  }

  // Загрузка
  browser.storage.local.get(['apiKey', 'apiUrl', 'systemPrompt', 'model', 'enabled', 'paused', 'provider', 'ownName']).then(d => {
    if (d.apiKey) g('apiKey').value = d.apiKey;
    g('apiUrl').value = d.apiUrl || PRESETS.deepseek.url;
    if (d.systemPrompt) g('systemPrompt').value = d.systemPrompt;
    if (d.model) g('model').value = d.model;
    if (d.ownName) g('ownName').value = d.ownName;
    g('enabled').checked = d.enabled !== false;
    g('paused').checked = !!d.paused;
    const prov = d.provider || providerFromUrl(g('apiUrl').value);
    g('provider').value = prov;
    applyPreset(prov, false);
  });

  g('provider').addEventListener('change', () => applyPreset(g('provider').value, true));

  // Тумблеры срабатывают сразу, без кнопки «Сохранить»
  g('enabled').addEventListener('change', () => browser.storage.local.set({ enabled: g('enabled').checked }));
  g('paused').addEventListener('change', () => browser.storage.local.set({ paused: g('paused').checked }));

  g('eye').addEventListener('click', () => {
    const f = g('apiKey');
    f.type = f.type === 'password' ? 'text' : 'password';
  });

  g('saveBtn').onclick = () => {
    const key = g('apiKey').value.trim();
    if (!key) { setStatus('⚠ Введи API-ключ', 'err'); return; }
    browser.storage.local.set({
      provider: g('provider').value,
      apiKey: key,
      apiUrl: g('apiUrl').value.trim(),
      model: g('model').value.trim(),
      ownName: g('ownName').value.trim(),
      systemPrompt: g('systemPrompt').value.trim(),
      enabled: g('enabled').checked,
      paused: g('paused').checked
    }).then(() => {
      setStatus('✓ Сохранено!', 'ok');
      setTimeout(() => setStatus('', ''), 2000);
    });
  };

  g('testBtn').onclick = () => {
    browser.runtime.sendMessage({
      type: 'NEW_DM',
      sender: 'Тестовый собеседник',
      text: 'Привет! Это тестовое сообщение 👋',
      paused: false
    });
    window.close();
  };

  function setStatus(t, cls) { g('status').textContent = t; g('status').className = 'status ' + cls; }
});
