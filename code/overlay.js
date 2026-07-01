// overlay.js
// Плавающее, перетаскиваемое, полупрозрачное окно чата на любом сайте.
// Показывает входящие из Discord, позволяет писать вручную и отвечать нейронкой
// (генерация + мгновенная отправка собеседнику), даже когда вы на другом сайте.

(function () {
  'use strict';
  if (window.top !== window.self) return;        // не плодим окна в iframe'ах
  if (window.__daiOverlay) return;
  window.__daiOverlay = true;

  const OPACITY_STEPS = [1, 0.85, 0.65];
  let opacityIdx = 0;
  let minimized = true;
  let unread = 0;
  const EYE = (browser.runtime && browser.runtime.getURL) ? browser.runtime.getURL('eye.png') : 'eye.png';

  // ── Стили ──────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #dai-root{all:initial;position:fixed!important;right:24px!important;bottom:24px!important;
      z-index:2147483647!important;font-family:'Segoe UI',Inter,system-ui,Arial,sans-serif!important;}
    #dai-root *{box-sizing:border-box!important;font-family:inherit!important;margin:0!important;padding:0!important;}

    /* свёрнутый пузырь */
    #dai-bubble{width:54px!important;height:54px!important;border-radius:50%!important;cursor:grab!important;
      background:url("${EYE}") center/56% no-repeat, #08080e!important;
      border:1px solid rgba(255,255,255,.14)!important;
      display:flex!important;align-items:center!important;justify-content:center!important;color:#fff!important;
      box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.05)!important;
      transition:transform .15s ease!important;position:relative!important;user-select:none!important;}
    #dai-bubble:hover{transform:scale(1.07)!important;}
    #dai-bubble:active{cursor:grabbing!important;}
    #dai-badge{position:absolute!important;top:-3px!important;right:-3px!important;min-width:20px!important;height:20px!important;
      padding:0 5px!important;border-radius:10px!important;background:#ED4245!important;color:#fff!important;font-size:11px!important;
      font-weight:800!important;display:none!important;align-items:center!important;justify-content:center!important;
      box-shadow:0 0 0 2px rgba(10,10,20,.6)!important;}
    #dai-badge.on{display:flex!important;}

    /* окно */
    #dai-win{width:344px!important;height:472px!important;display:none!important;flex-direction:column!important;
      border-radius:18px!important;overflow:hidden!important;
      background:rgba(16,16,28,.72)!important;
      -webkit-backdrop-filter:blur(22px) saturate(150%)!important;backdrop-filter:blur(22px) saturate(150%)!important;
      border:1px solid rgba(255,255,255,.12)!important;
      box-shadow:0 24px 70px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06)!important;
      transition:opacity .18s ease,transform .18s ease!important;opacity:0!important;transform:translateY(10px) scale(.98)!important;}
    #dai-win.show{display:flex!important;opacity:1!important;transform:none!important;}

    /* CRT / Serial Experiments Lain эффект */
    #dai-scan{position:absolute!important;inset:0!important;pointer-events:none!important;z-index:50!important;
      border-radius:18px!important;overflow:hidden!important;
      background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0,rgba(0,0,0,.16) 1px,transparent 1px,transparent 3px)!important;
      animation:daiFlick 2.6s steps(40) infinite!important;}
    #dai-sweep{position:absolute!important;left:0!important;right:0!important;top:0!important;height:36%!important;
      background:linear-gradient(180deg,transparent,rgba(150,195,255,.10),transparent)!important;
      animation:daiSweep 5.5s linear infinite!important;}
    #dai-win{animation:daiBright 7s ease-in-out infinite!important;}
    @keyframes daiFlick{0%{opacity:.92}8%{opacity:1}11%{opacity:.82}14%{opacity:1}48%{opacity:.9}
      52%{opacity:1}70%{opacity:.86}73%{opacity:1}100%{opacity:.95}}
    @keyframes daiSweep{0%{transform:translateY(-130%)}100%{transform:translateY(380%)}}
    @keyframes daiBright{0%,100%{filter:brightness(1)}47%{filter:brightness(1.03)}50%{filter:brightness(.96)}
      53%{filter:brightness(1.04)}}

    #dai-head{display:flex!important;align-items:center!important;gap:9px!important;padding:11px 12px!important;cursor:grab!important;
      background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02))!important;
      border-bottom:1px solid rgba(255,255,255,.08)!important;}
    #dai-head:active{cursor:grabbing!important;}
    #dai-av{width:30px!important;height:30px!important;border-radius:50%!important;flex-shrink:0!important;
      background:url("${EYE}") center/64% no-repeat, #08080e!important;
      border:1px solid rgba(255,255,255,.14)!important;
      display:flex!important;align-items:center!important;justify-content:center!important;}
    #dai-htxt{flex:1!important;min-width:0!important;}
    #dai-ttl{font-size:12px!important;font-weight:800!important;color:#fff!important;letter-spacing:.2px!important;}
    #dai-sub{font-size:10px!important;color:rgba(255,255,255,.42)!important;margin-top:1px!important;white-space:nowrap!important;
      overflow:hidden!important;text-overflow:ellipsis!important;}
    #dai-htools{display:flex!important;gap:5px!important;}
    .dai-ic{width:26px!important;height:26px!important;border:none!important;border-radius:8px!important;cursor:pointer!important;
      background:rgba(255,255,255,.08)!important;color:rgba(255,255,255,.6)!important;font-size:12px!important;
      display:flex!important;align-items:center!important;justify-content:center!important;transition:.15s!important;outline:none!important;}
    .dai-ic:hover{background:rgba(255,255,255,.2)!important;color:#fff!important;}
    #dai-close:hover{background:rgba(237,66,69,.5)!important;color:#fff!important;}

    #dai-notice{display:none!important;margin:8px 10px 0!important;padding:8px 10px!important;border-radius:9px!important;font-size:11px!important;
      line-height:1.4!important;}
    #dai-notice.warn{display:block!important;background:rgba(237,66,69,.14)!important;border:1px solid rgba(237,66,69,.32)!important;color:#ff8585!important;}
    #dai-notice.info{display:block!important;background:rgba(255,180,0,.12)!important;border:1px solid rgba(255,180,0,.28)!important;color:#ffc24d!important;}

    #dai-log{flex:1!important;overflow-y:auto!important;padding:12px 12px 6px!important;display:flex!important;flex-direction:column!important;gap:8px!important;}
    #dai-log::-webkit-scrollbar{width:7px!important;}
    #dai-log::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14)!important;border-radius:4px!important;}
    .dai-row{display:flex!important;width:100%!important;}
    .dai-row.them{justify-content:flex-start!important;}
    .dai-row.me{justify-content:flex-end!important;}
    .dai-bub{max-width:80%!important;padding:7px 11px!important;border-radius:14px!important;font-size:12.5px!important;line-height:1.45!important;
      word-break:break-word!important;white-space:pre-wrap!important;}
    .dai-row.them .dai-bub{background:rgba(255,255,255,.08)!important;color:#eef!important;border-bottom-left-radius:5px!important;}
    .dai-row.me .dai-bub{background:linear-gradient(135deg,#5865F2,#6f5cf2)!important;color:#fff!important;border-bottom-right-radius:5px!important;}
    .dai-name{font-size:10px!important;font-weight:700!important;color:#9db1ff!important;margin-bottom:2px!important;}
    #dai-empty{margin:auto!important;text-align:center!important;color:rgba(255,255,255,.3)!important;font-size:11px!important;line-height:1.6!important;}

    #dai-status{display:none!important;align-items:center!important;gap:7px!important;padding:0 14px 6px!important;font-size:11px!important;color:#9db1ff!important;}
    #dai-status.on{display:flex!important;}
    #dai-sp{width:11px!important;height:11px!important;border:2px solid rgba(157,177,255,.25)!important;border-top-color:#9db1ff!important;
      border-radius:50%!important;animation:dspin .7s linear infinite!important;}
    @keyframes dspin{to{transform:rotate(360deg)!important;}}

    #dai-foot{padding:8px 10px 11px!important;border-top:1px solid rgba(255,255,255,.08)!important;
      background:rgba(0,0,0,.18)!important;}
    #dai-inwrap{display:flex!important;gap:7px!important;align-items:flex-end!important;}
    #dai-ta{flex:1!important;min-height:38px!important;max-height:96px!important;resize:none!important;outline:none!important;
      background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:11px!important;
      color:#eef!important;font-size:12.5px!important;line-height:1.45!important;padding:9px 11px!important;transition:border-color .2s!important;}
    #dai-ta:focus{border-color:rgba(88,101,242,.6)!important;}
    #dai-send{flex-shrink:0!important;width:38px!important;height:38px!important;border:none!important;border-radius:11px!important;cursor:pointer!important;
      background:#5865F2!important;color:#fff!important;font-size:16px!important;transition:.15s!important;outline:none!important;}
    #dai-send:hover{background:#4752c4!important;}
    #dai-airow{display:flex!important;gap:7px!important;margin-top:8px!important;}
    #dai-ai{flex:1!important;border:none!important;border-radius:10px!important;cursor:pointer!important;padding:9px 0!important;
      font-size:11.5px!important;font-weight:800!important;letter-spacing:.2px!important;color:#0a0a14!important;
      background:linear-gradient(135deg,#57F287,#43d97c)!important;transition:filter .15s!important;outline:none!important;}
    #dai-ai:hover{filter:brightness(1.08)!important;}
    #dai-draft{flex-shrink:0!important;padding:9px 13px!important;border-radius:10px!important;cursor:pointer!important;font-size:11.5px!important;
      font-weight:700!important;background:rgba(87,242,135,.12)!important;color:#57F287!important;border:1px solid rgba(87,242,135,.25)!important;
      transition:.15s!important;outline:none!important;}
    #dai-draft:hover{background:rgba(87,242,135,.22)!important;}
    #dai-pause{flex-shrink:0!important;width:38px!important;border-radius:10px!important;cursor:pointer!important;border:1px solid rgba(255,255,255,.1)!important;
      background:rgba(255,255,255,.06)!important;color:rgba(255,255,255,.55)!important;font-size:13px!important;transition:.15s!important;outline:none!important;}
    #dai-pause.on{background:rgba(255,180,0,.22)!important;color:#ffb400!important;border-color:rgba(255,180,0,.4)!important;}
  `;
  (document.head || document.documentElement).appendChild(style);

  // ── Разметка ───────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'dai-root';
  root.innerHTML = `
    <div id="dai-bubble" title="Wire Node"><span id="dai-badge">0</span></div>
    <div id="dai-win">
      <div id="dai-head">
        <div id="dai-av"></div>
        <div id="dai-htxt">
          <div id="dai-ttl">Wire Node V.0.1</div>
          <div id="dai-sub">ожидание сообщений…</div>
        </div>
        <div id="dai-htools">
          <button class="dai-ic" id="dai-opacity" title="Прозрачность">◐</button>
          <button class="dai-ic" id="dai-clear" title="Очистить чат">🗑</button>
          <button class="dai-ic" id="dai-min" title="Свернуть">—</button>
          <button class="dai-ic" id="dai-close" title="Скрыть">✕</button>
        </div>
      </div>
      <div id="dai-notice"></div>
      <div id="dai-log"><div id="dai-empty">Пока пусто.<br>Открой переписку в Discord — сообщения появятся здесь.</div></div>
      <div id="dai-status"><div id="dai-sp"></div><span>Нейросеть печатает…</span></div>
      <div id="dai-foot">
        <div id="dai-inwrap">
          <textarea id="dai-ta" rows="1" placeholder="Написать собеседнику…"></textarea>
          <button id="dai-send" title="Отправить в Discord">➤</button>
        </div>
        <div id="dai-airow">
          <button id="dai-ai" title="Сгенерировать и сразу отправить">🤖 Ответить ИИ</button>
          <button id="dai-draft" title="Сгенерировать в поле для правки">✎</button>
          <button id="dai-pause" title="Тихий режим">⏸</button>
        </div>
      </div>
      <div id="dai-scan"><div id="dai-sweep"></div></div>
    </div>`;
  (document.body || document.documentElement).appendChild(root);

  const $ = id => document.getElementById(id);
  const win = $('dai-win'), bubble = $('dai-bubble'), badge = $('dai-badge');
  const log = $('dai-log'), ta = $('dai-ta'), notice = $('dai-notice');
  const status = $('dai-status'), sub = $('dai-sub');

  // ── Перетаскивание (мышь + тач) ───────────────────────
  function makeDraggable(handle, onClick) {
    let sx, sy, ox, oy, moved, dragging = false;
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('.dai-ic')) return;
      dragging = true; moved = false;
      const r = root.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      root.style.left = r.left + 'px'; root.style.top = r.top + 'px';
      root.style.right = 'auto'; root.style.bottom = 'auto';
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      const w = win.classList.contains('show') ? 344 : 54;
      const h = win.classList.contains('show') ? 472 : 54;
      let nx = Math.min(Math.max(ox + dx, 4), window.innerWidth - w - 4);
      let ny = Math.min(Math.max(oy + dy, 4), window.innerHeight - h - 4);
      root.style.left = nx + 'px'; root.style.top = ny + 'px';
    });
    const end = e => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      savePos();
      if (!moved && onClick) onClick();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function savePos() {
    const r = root.getBoundingClientRect();
    browser.storage.local.set({ uiPos: { left: r.left, top: r.top } }).catch(() => {});
  }
  function applyPos(p) {
    if (!p) return;
    const left = Math.min(Math.max(p.left, 4), window.innerWidth - 60);
    const top = Math.min(Math.max(p.top, 4), window.innerHeight - 60);
    root.style.left = left + 'px'; root.style.top = top + 'px';
    root.style.right = 'auto'; root.style.bottom = 'auto';
  }

  // ── Открыть / свернуть ────────────────────────────────
  function openWin() {
    minimized = false;
    bubble.style.display = 'none';
    win.classList.add('show');
    unread = 0; updateBadge();
    browser.storage.local.set({ uiMin: false }).catch(() => {});
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    refreshNotice();
  }
  function minWin() {
    minimized = true;
    win.classList.remove('show');
    bubble.style.display = 'flex';
    browser.storage.local.set({ uiMin: true }).catch(() => {});
  }
  function updateBadge() {
    if (unread > 0) { badge.textContent = unread > 99 ? '99+' : String(unread); badge.classList.add('on'); }
    else badge.classList.remove('on');
  }

  // ── Рендер истории ────────────────────────────────────
  let lastSenderName = '';
  async function renderLog() {
    lastSenderName = '';
    let hist = [];
    try {
      const d = await browser.storage.local.get(['histories', 'activeChannel']);
      if (d.histories && d.activeChannel && d.histories[d.activeChannel]) hist = d.histories[d.activeChannel];
    } catch (e) {}
    log.innerHTML = '';
    if (!hist.length) {
      const e = document.createElement('div'); e.id = 'dai-empty';
      e.innerHTML = 'Пока пусто.<br>Открой переписку в Discord — сообщения появятся здесь.';
      log.appendChild(e); sub.textContent = 'ожидание сообщений…'; return;
    }
    for (const m of hist) {
      const row = document.createElement('div');
      row.className = 'dai-row ' + (m.role === 'them' ? 'them' : 'me');
      const bub = document.createElement('div');
      bub.className = 'dai-bub';
      if (m.role === 'them' && m.sender) {
        const n = document.createElement('div'); n.className = 'dai-name'; n.textContent = m.sender; bub.appendChild(n);
        lastSenderName = m.sender;
      }
      const t = document.createElement('div'); t.textContent = m.text; bub.appendChild(t);
      row.appendChild(bub); log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
    if (lastSenderName) sub.textContent = 'собеседник: ' + lastSenderName;
  }

  // ── Уведомления (нет ключа / пауза) ───────────────────
  async function refreshNotice() {
    let d = {};
    try { d = await browser.storage.local.get(['apiKey', 'paused']); } catch (e) {}
    if (!d.apiKey) { notice.className = 'warn'; notice.textContent = '⚠ Укажи API-ключ в настройках (иконка расширения).'; }
    else if (d.paused) { notice.className = 'info'; notice.textContent = '⏸ Тихий режим: окно не открывается автоматически.'; }
    else { notice.className = ''; notice.textContent = ''; }
    setPauseBtn(!!d.paused);
  }
  function setPauseBtn(p) { const b = $('dai-pause'); if (b) { b.textContent = p ? '▶' : '⏸'; p ? b.classList.add('on') : b.classList.remove('on'); } }

  function applyEnabled(enabled) {
    root.style.display = (enabled === false) ? 'none' : '';
  }

  // ── Действия ──────────────────────────────────────────
  function sendToDiscord(text) {
    text = (text || '').trim();
    if (!text) return;
    browser.runtime.sendMessage({ type: 'SEND_TO_DISCORD', text }).catch(() => {});
  }
  function manualSend() {
    const t = ta.value.trim();
    if (!t) return;
    sendToDiscord(t);
    ta.value = ''; ta.style.height = 'auto';
  }
  async function aiReply(autoSend) {
    status.classList.add('on');
    $('dai-ai').disabled = true; $('dai-draft').disabled = true;
    let res = {};
    try { res = await browser.runtime.sendMessage({ type: 'AI_GENERATE' }); } catch (e) { res = { error: e.message }; }
    status.classList.remove('on');
    $('dai-ai').disabled = false; $('dai-draft').disabled = false;

    if (res && res.reply) {
      if (autoSend) sendToDiscord(res.reply);
      else { ta.value = res.reply; ta.focus(); autoGrow(); }
    } else {
      const map = { no_key: 'Нет API-ключа', empty_context: 'Нет сообщений для ответа', empty_response: 'Пустой ответ модели', timeout: 'Таймаут запроса' };
      notice.className = 'warn';
      notice.textContent = '⚠ ' + (map[res && res.error] || (res && res.error) || 'Ошибка генерации');
    }
  }
  function autoGrow() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; }

  // ── События ───────────────────────────────────────────
  makeDraggable($('dai-head'));
  makeDraggable(bubble, openWin);
  $('dai-min').addEventListener('click', minWin);
  $('dai-close').addEventListener('click', minWin);
  $('dai-send').addEventListener('click', manualSend);
  $('dai-ai').addEventListener('click', () => aiReply(true));
  $('dai-draft').addEventListener('click', () => aiReply(false));
  $('dai-clear').addEventListener('click', () => browser.runtime.sendMessage({ type: 'CLEAR_HISTORY' }).catch(() => {}));
  $('dai-opacity').addEventListener('click', () => {
    opacityIdx = (opacityIdx + 1) % OPACITY_STEPS.length;
    win.style.opacity = OPACITY_STEPS[opacityIdx];
    browser.storage.local.set({ uiOpacity: opacityIdx }).catch(() => {});
  });
  $('dai-pause').addEventListener('click', async () => {
    let d = {}; try { d = await browser.storage.local.get(['paused']); } catch (e) {}
    await browser.storage.local.set({ paused: !d.paused }).catch(() => {});
    refreshNotice();
  });
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manualSend(); } });

  // Новое сообщение от background
  browser.runtime.onMessage.addListener(msg => {
    if (!msg) return;
    if (msg.type === 'NEW_DM') {
      renderLog();
      if (!msg.paused) openWin();
      else if (minimized) { unread++; updateBadge(); }
    }
    if (msg.type === 'ACTIVE_CHANGED') {
      renderLog();
    }
  });

  // Кросс-вкладочная синхронизация истории/паузы
  if (browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.histories || changes.activeChannel) renderLog();
      if (changes.paused || changes.apiKey) refreshNotice();
      if (changes.enabled) applyEnabled(changes.enabled.newValue);
    });
  }

  // ── Старт ─────────────────────────────────────────────
  (async () => {
    let d = {};
    try { d = await browser.storage.local.get(['uiPos', 'uiMin', 'uiOpacity', 'enabled']); } catch (e) {}
    applyPos(d.uiPos);
    if (typeof d.uiOpacity === 'number') { opacityIdx = d.uiOpacity; win.style.opacity = OPACITY_STEPS[opacityIdx]; }
    minimized = d.uiMin !== false; // по умолчанию свёрнуто
    if (minimized) { bubble.style.display = 'flex'; } else { openWin(); }
    applyEnabled(d.enabled);
    await renderLog();
    await refreshNotice();
  })();
})();
