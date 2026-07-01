// background.js
// Ретранслирует сообщения, хранит ОТДЕЛЬНУЮ историю для каждого диалога (по ID канала),
// и сам делает запросы к ИИ (чтобы CSP сайтов не блокировал fetch).

const HISTORY_LIMIT = 60;
const CONTEXT_MESSAGES = 14;
const SENT_ECHO_WINDOW = 15000;

function normalize(s) {
  return (s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function defaultModelFor(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('groq.com')) return 'llama-3.3-70b-versatile';
  if (u.includes('openai.com')) return 'gpt-4o-mini';
  if (u.includes('openrouter.ai')) return 'deepseek/deepseek-chat';
  if (u.includes('deepseek')) return 'deepseek-chat';
  if (u.includes('artemox')) return 'deepseek-chat';
  return 'deepseek-chat';
}

async function getStore() {
  const d = await browser.storage.local.get(['histories', 'activeChannel', 'channelNames']);
  return {
    histories: (d.histories && typeof d.histories === 'object') ? d.histories : {},
    active: d.activeChannel || null,
    names: (d.channelNames && typeof d.channelNames === 'object') ? d.channelNames : {}
  };
}

function pushTo(histories, ch, entry) {
  const key = ch || '_';
  const arr = histories[key] || [];
  arr.push({ ...entry, ts: Date.now() });
  while (arr.length > HISTORY_LIMIT) arr.shift();
  histories[key] = arr;
  return arr;
}

// Рассылаем во все вкладки (в т.ч. discord.com), кроме служебных/расширений
function broadcastToPages(msg) {
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (!tab.url) return;
      if (tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:') ||
          tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:') ||
          tab.url.startsWith('edge:') || tab.url.startsWith('view-source:')) return;
      browser.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  });
}

function relayToDiscord(text) {
  browser.tabs.query({ url: '*://discord.com/*' }).then(tabs => {
    tabs.forEach(tab => browser.tabs.sendMessage(tab.id, { type: 'SEND_TO_DISCORD', text }).catch(() => {}));
  });
}

async function generateReply() {
  const d = await browser.storage.local.get(['apiKey', 'apiUrl', 'model', 'systemPrompt']);
  const key = (d.apiKey || '').trim();
  if (!key) return { error: 'no_key' };

  const url = (d.apiUrl || 'https://api.deepseek.com/chat/completions').trim();
  const model = (d.model || '').trim() || defaultModelFor(url);
  const sys = (d.systemPrompt || 'Ты — это я. Отвечай от моего лица в личке Discord: дружелюбно, кратко, естественно, на русском.').trim();

  const { histories, active } = await getStore();
  const hist = (histories[active] || []).slice(-CONTEXT_MESSAGES);
  if (!hist.length) return { error: 'empty_context' };

  const messages = [{ role: 'system', content: sys }];
  for (const m of hist) messages.push({ role: m.role === 'them' ? 'user' : 'assistant', content: m.text });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://discord.com',
        'X-Title': 'Discord AI'
      },
      body: JSON.stringify({ model, messages, max_tokens: 320, temperature: 0.85 }),
      signal: ctrl.signal
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) return { error: (j && j.error && j.error.message) || ('HTTP ' + resp.status) };
    const reply = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    const clean = (reply || '').trim();
    return clean ? { reply: clean } : { error: 'empty_response' };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : (e.message || 'network_error') };
  } finally {
    clearTimeout(timer);
  }
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  // Сменился открытый диалог в Discord
  if (msg.type === 'ACTIVE_CHANNEL') {
    return (async () => {
      const { names } = await getStore();
      if (msg.name) names[msg.channel] = msg.name;
      await browser.storage.local.set({ activeChannel: msg.channel, channelNames: names });
      broadcastToPages({ type: 'ACTIVE_CHANGED', channel: msg.channel });
    })();
  }

  if (msg.type === 'NEW_DM') {
    return (async () => {
      const cfg = await browser.storage.local.get(['ownName']);
      const own = (cfg.ownName || '').replace(/^@+/, '').trim().toLowerCase();
      const snd = (msg.sender || '').replace(/^@+/, '').trim().toLowerCase();
      if (own && snd && (own === snd || (own.length >= 4 && (snd.includes(own) || own.includes(snd))))) return; // это мы

      const { histories, names } = await getStore();
      const ch = msg.channel || '_';
      const arr = histories[ch] || [];
      const now = Date.now();
      const n = normalize(msg.text);
      const echo = arr.some(m => m.role === 'me' && (now - m.ts) < SENT_ECHO_WINDOW &&
                                 n !== '' && normalize(m.text) === n);
      if (echo) return;
      const last = arr[arr.length - 1];
      if (last && last.role === 'them' && n !== '' && normalize(last.text) === n && (now - last.ts) < 30000) return; // тот же текст при переоткрытии

      pushTo(histories, ch, { role: 'them', sender: msg.sender || '', text: msg.text });
      if (msg.sender) names[ch] = msg.sender;
      await browser.storage.local.set({ histories, activeChannel: ch, channelNames: names });
      broadcastToPages({ type: 'NEW_DM', sender: msg.sender || '', text: msg.text, paused: !!msg.paused, channel: ch });
    })();
  }

  if (msg.type === 'SEND_TO_DISCORD') {
    return (async () => {
      const { histories, active } = await getStore();
      pushTo(histories, active || '_', { role: 'me', text: msg.text });
      await browser.storage.local.set({ histories });
      relayToDiscord(msg.text);
    })();
  }

  if (msg.type === 'AI_GENERATE') {
    return generateReply();
  }

  // Очистить только текущий диалог
  if (msg.type === 'CLEAR_HISTORY') {
    return (async () => {
      const { histories, active } = await getStore();
      if (active) delete histories[active]; else for (const k in histories) delete histories[k];
      await browser.storage.local.set({ histories });
    })();
  }
});
