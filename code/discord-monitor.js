// discord-monitor.js
// Автоматически определяет, КТО собеседник, а кто ты (по заголовку диалога и списку авторов),
// и пересылает в background ТОЛЬКО сообщения собеседника. Текст берёт из самого сообщения,
// а не из цитаты-ответа.

(function () {
  'use strict';
  if (window.top !== window.self) return;

  let observer = null;
  let debTimer = null;
  let baselined = false;
  let autoOwn = null;
  const seen = new Set();
  const recentSent = [];

  function normalize(s) {
    return (s || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function nameNorm(s) {
    return (s || '').replace(/^@+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function cleanName(s) { return (s || '').replace(/^@+/, '').trim(); }
  function looseMatch(a, b) {
    const x = nameNorm(a), y = nameNorm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    return (Math.min(x.length, y.length) >= 4) && (x.includes(y) || y.includes(x));
  }

  function isInDM() { return window.location.pathname.includes('/channels/@me/'); }
  function currentChannelId() {
    const m = window.location.pathname.match(/\/channels\/@me\/(\d+)/);
    return m ? m[1] : null;
  }

  // Имя собеседника из шапки/вкладки
  function parseDocTitle() {
    let t = document.title || '';
    t = t.replace(/^\(\d+\)\s*/, '');
    t = t.replace(/\s*[|\-–—•]\s*Discord\b.*$/i, '');
    t = t.replace(/\bDiscord\b/ig, '').trim();
    return t;
  }
  function getDmTitle() {
    const sel = ['section[class*="title"] h1', 'header[class*="title"] [class*="title"]', '[class*="titleWrapper"] [class*="title"]'];
    for (const s of sel) { const e = document.querySelector(s); if (e && e.textContent.trim()) return e.textContent.trim(); }
    return '';
  }
  function titleCandidates() { return [getDmTitle(), parseDocTitle()].filter(Boolean); }

  function detectOwnName() {
    const sel = [
      'section[class*="panels"] [class*="nameTag"] [class*="username"]',
      'section[class*="panels"] [class*="nameTag"]',
      '[class*="panelTitleContainer"]'
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el && el.textContent.trim()) return el.textContent.trim().split('\n')[0].trim();
    }
    return null;
  }

  function announceChannel() {
    if (!isInDM()) return;
    const ch = currentChannelId();
    if (!ch) return;
    browser.runtime.sendMessage({ type: 'ACTIVE_CHANNEL', channel: ch, name: getDmTitle() }).catch(() => {});
  }

  // Текст самого сообщения (с эмодзи через alt), без цитаты ответа
  function readMessageText(el) {
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const img = (n.matches && n.matches('img')) ? n : (n.querySelector && n.querySelector('img'));
        if (img && img.alt) out += img.alt; else out += n.textContent;
      }
    });
    return out.trim();
  }
  function pickAfterHeader(cands, header) {
    for (const c of cands) {
      if (c.closest('[class*="replied"], [class*="reference"], [id^="message-reply-context"]')) continue;
      if (header && (header.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING)) continue; // c стоит ДО заголовка = это цитата
      return c;
    }
    return null;
  }
  function getContentEl(li) {
    const byId = li.querySelector('[id^="message-content-"]');   // самый надёжный признак реального текста
    if (byId) return byId;
    const header = li.querySelector('h3[class*="header"]');
    return pickAfterHeader(li.querySelectorAll('div[class*="messageContent"]'), header)
        || pickAfterHeader(li.querySelectorAll('div[class*="markup"]'), header);
  }
  // Автор именно этого сообщения (из h3-заголовка, не из цитаты)
  function headerName(li) {
    const h = li.querySelector('h3[class*="header"]');
    if (!h) return null;
    if (h.closest('[class*="repliedMessage"]') || h.closest('[id^="message-reply-context"]')) return null;
    const u = h.querySelector('[class*="username"]') || h.querySelector('span');
    return u ? u.textContent.trim() : null;
  }
  function getAuthors() {
    const out = [];
    document.querySelectorAll('li[class*="messageListItem"]').forEach(li => {
      const n = headerName(li);
      if (n && !out.includes(n)) out.push(n);
    });
    return out;
  }

  // Определяем собеседника (partner) и себя (own)
  function resolveIdentities(manualNick) {
    const authors = getAuthors();
    const manual = (manualNick || '').trim();
    const ownGuess = manual || autoOwn || detectOwnName();
    const titles = titleCandidates();
    let partner = null, own = null;

    if (authors.length === 2) {
      // 1) сначала находим СЕБЯ по нику/аккаунту, собеседник = второй участник
      if (ownGuess) {
        own = authors.find(a => looseMatch(a, ownGuess)) || null;
        if (own) partner = authors.find(a => a !== own) || null;
      }
      // 2) если себя не нашли — определяем собеседника по заголовку диалога
      if (!partner) {
        partner = authors.find(a => titles.some(t => looseMatch(a, t))) || null;
        if (partner) own = authors.find(a => a !== partner) || null;
      }
      // 3) крайний случай
      if (!partner) { partner = authors[0]; own = authors[1] || ownGuess; }
    } else if (authors.length === 1) {
      const only = authors[0];
      if (ownGuess && looseMatch(only, ownGuess)) { own = only; partner = null; }
      else { partner = only; own = ownGuess || null; }
    } else {
      own = ownGuess; partner = null; // группа/неизвестно — пересылаем всё, кроме own
    }
    return { partner, own };
  }

  function classify(author, partner, own) {
    if (partner && author === partner) return 'them';
    if (own && author === own) return 'me';
    if (partner && looseMatch(author, partner)) return 'them';
    if (own && looseMatch(author, own)) return 'me';
    if (partner) return 'me';      // собеседник известен, но автор не он -> это мы
    return 'them';                 // собеседник неизвестен (группа) -> входящее
  }

  function matchSentEcho(norm, raw) {
    const now = Date.now();
    for (let i = recentSent.length - 1; i >= 0; i--) {
      if (now - recentSent[i].ts > 15000) { recentSent.splice(i, 1); continue; }
      const r = recentSent[i];
      if ((r.norm && r.norm === norm) || (r.raw && r.raw === raw)) return i;
    }
    return -1;
  }

  function scan() {
    browser.storage.local.get(['enabled', 'paused', 'ownName']).then(data => {
      if (data.enabled === false || !isInDM()) return;
      if (!autoOwn) autoOwn = detectOwnName();

      const { partner, own } = resolveIdentities(data.ownName);
      const items = document.querySelectorAll('li[class*="messageListItem"]');
      const total = items.length;
      let currentAuthor = '';
      const toForward = [];
      let lastThem = null;

      items.forEach((li, idx) => {
        const hn = headerName(li);
        if (hn) currentAuthor = hn;
        const author = currentAuthor;

        const contentEl = getContentEl(li);
        if (!contentEl) return;
        const id = li.id || li.getAttribute('data-list-item-id') || (idx + ':' + readMessageText(contentEl).slice(0, 24));
        const isNew = !seen.has(id);
        seen.add(id);

        if (classify(author, partner, own) !== 'them') return;  // только собеседник
        const text = readMessageText(contentEl);
        if (!text) return;

        const norm = normalize(text);
        const echoIdx = matchSentEcho(norm, text);
        if (echoIdx !== -1) { recentSent.splice(echoIdx, 1); return; }

        const lastFew = idx >= total - 8;
        if (!baselined) { if (lastFew) lastThem = { author, text }; return; }
        if (!isNew || !lastFew) return;
        toForward.push({ author, text });
      });

      const ch = currentChannelId();
      const send = m => browser.runtime.sendMessage({
        type: 'NEW_DM', sender: cleanName(m.author), text: m.text, channel: ch, paused: !!data.paused
      }).catch(() => {});

      if (!baselined) { baselined = true; if (lastThem) send(lastThem); }
      else toForward.forEach(send);

      if (seen.size > 800) { seen.clear(); baselined = false; }
    }).catch(() => {});
  }

  function scheduleScan() { clearTimeout(debTimer); debTimer = setTimeout(scan, 250); }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'SEND_TO_DISCORD') {
      recentSent.push({ raw: (msg.text || '').trim(), norm: normalize(msg.text), ts: Date.now() });
      sendTextToDiscord(msg.text);
    }
  });

  function sendTextToDiscord(text) {
    const selectors = [
      'div[role="textbox"][data-slate-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[class*="textArea"] div[contenteditable="true"]'
    ];
    let inputBox = null;
    for (const sel of selectors) { inputBox = document.querySelector(sel); if (inputBox) break; }
    if (!inputBox) return;
    inputBox.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    inputBox.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    setTimeout(() => {
      if (!inputBox.textContent.trim()) { try { document.execCommand('insertText', false, text); } catch (e) {} }
      setTimeout(() => {
        inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }, 120);
    }, 150);
  }

  function startObserver() {
    if (observer) observer.disconnect();
    const target = document.querySelector('main') || document.body;
    observer = new MutationObserver(scheduleScan);
    observer.observe(target, { childList: true, subtree: true });
  }

  function resetForChannel() {
    seen.clear(); baselined = false; autoOwn = null;
    setTimeout(startObserver, 400);
    setTimeout(scan, 700);
    setTimeout(announceChannel, 800);
  }

  function init() {
    startObserver();
    setTimeout(scan, 800);
    setTimeout(announceChannel, 900);
    let lastPath = window.location.pathname;
    setInterval(() => {
      if (window.location.pathname !== lastPath) { lastPath = window.location.pathname; resetForChannel(); }
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 1500);
})();
