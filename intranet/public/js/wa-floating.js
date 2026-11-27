(function () {
  const fToken = localStorage.getItem('dc_token');
  const fRole = localStorage.getItem('dc_role');
  const isShare = new URLSearchParams(window.location.search).has('share');

  if (!fToken || fRole !== 'admin' || isShare || window.location.pathname.includes('/whatsapp')) {
    return;
  }

  const wfState = {
    open: false,
    cat: 'all',
    chats: [],
    stickers: [],
    activePhone: '',
    activeJid: '',
    activeTitle: '',
    activeCategory: 'libre',
    showStickers: false,
    sse: null
  };

  const WF_CAT = {
    tareas: { label: 'Tareas', cls: 'bg-sky-100 text-sky-800' },
    libre: { label: 'Libre', cls: 'bg-emerald-100 text-emerald-800' },
    ti: { label: 'TI', cls: 'bg-indigo-100 text-indigo-800' }
  };

  function wfEsc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function wfApi(url, opts = {}) {
    const headers = { ...(opts.headers || {}), Authorization: `Bearer ${fToken}` };
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    if (opts.body && !isForm && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function wfStickerUrl(fn) {
    return `/intranet/api/admin/whatsapp/stickers/file/${encodeURIComponent(fn)}?token=${encodeURIComponent(fToken)}`;
  }

  function mountFloatingWidget() {
    if (document.getElementById('waFloatingRoot')) return;
    const root = document.createElement('div');
    root.id = 'waFloatingRoot';
    root.className = 'wa-fab-root no-print';
    root.innerHTML = `
      <button type="button" id="waFabTriggerBtn" title="WhatsApp Rápido DC CORP" class="wa-fab-trigger">
        <i class="fa-brands fa-whatsapp"></i>
        <span id="waFabUnreadBadge" class="wa-fab-unread hidden">0</span>
        <span id="waFabStatusDot" class="wa-fab-status-dot"></span>
      </button>

      <div id="waFabWindow" class="wa-fab-window">
        <div class="wa-fab-head">
          <div class="flex items-center gap-2 min-w-0">
            <button type="button" id="waFabBackBtn" class="hidden w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 text-white items-center justify-center text-xs shrink-0">
              <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="min-w-0">
              <div id="waFabHeadTitle" class="text-xs font-extrabold truncate">WhatsApp DC CORP</div>
              <div id="waFabHeadSub" class="text-[10px] text-emerald-200 truncate">Acceso rápido</div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <a href="/intranet/whatsapp" title="Abrir Centro Completo" class="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-xs">
              <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
            </a>
            <button type="button" id="waFabCloseBtn" title="Minimizar" class="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-sm">
              &times;
            </button>
          </div>
        </div>

        <!-- Vista 1: Lista de Chats -->
        <div id="waFabListView" class="flex-1 flex flex-col p-3 gap-2 overflow-hidden">
          <form id="waFabNewForm" class="flex gap-1.5">
            <input id="waFabNewPhone" type="text" placeholder="Número (ej. 992507489)" class="flex-1 px-2.5 py-1.5 rounded-xl bg-white/90 border border-slate-200 text-xs">
            <select id="waFabNewCat" class="px-2 py-1.5 rounded-xl bg-white/90 border border-slate-200 text-[11px] font-bold text-slate-700">
              <option value="libre">Libre</option>
              <option value="tareas">Tareas</option>
              <option value="ti">TI</option>
            </select>
            <button type="submit" class="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">Ir</button>
          </form>

          <div class="grid grid-cols-4 gap-1 text-[10px]">
            <button type="button" data-wcat="all" class="wf-cat-btn py-1 rounded-lg bg-slate-900 text-white font-bold">Todos</button>
            <button type="button" data-wcat="tareas" class="wf-cat-btn py-1 rounded-lg bg-white/80 text-sky-800 font-semibold">📚 Tareas</button>
            <button type="button" data-wcat="libre" class="wf-cat-btn py-1 rounded-lg bg-white/80 text-emerald-800 font-semibold">💬 Libres</button>
            <button type="button" data-wcat="ti" class="wf-cat-btn py-1 rounded-lg bg-white/80 text-indigo-800 font-semibold">🛠️ TI</button>
          </div>

          <div id="waFabChatsBox" class="flex-1 overflow-y-auto aurora-scroll space-y-1.5 pr-0.5"></div>
        </div>

        <!-- Vista 2: Hilo de Chat -->
        <div id="waFabThreadView" class="hidden flex-1 flex-col overflow-hidden">
          <div class="px-3 py-1.5 bg-white/65 border-b border-slate-200/70 flex items-center justify-between gap-2 text-[11px]">
            <select id="waFabThreadCat" class="px-2 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700 text-[11px]">
              <option value="tareas">📚 Recordatorios de tareas</option>
              <option value="libre">💬 Mensajes libres</option>
              <option value="ti">🛠️ Soporte TI</option>
            </select>
            <div class="flex items-center gap-1">
              <button type="button" id="waFabRepairBtn" title="Reparar cifrado Signal" class="px-2 py-1 rounded-lg bg-amber-100 text-amber-800 font-bold">
                <i class="fa-solid fa-wrench"></i>
              </button>
              <button type="button" id="waFabDeleteBtn" title="Borrar chat" class="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 font-bold">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>

          <div id="waFabMsgsBox" class="flex-1 overflow-y-auto aurora-scroll p-3 space-y-2"></div>

          <div id="waFabStickersBox" class="hidden border-t border-slate-200 bg-white/90 p-2 max-h-32 overflow-y-auto grid grid-cols-5 gap-1.5"></div>

          <form id="waFabSendForm" class="p-2.5 border-t border-slate-200/80 bg-white/80 flex items-center gap-1.5">
            <button type="button" id="waFabStickerBtn" title="Stickers" class="w-8 h-8 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <i class="fa-regular fa-face-smile-wink"></i>
            </button>
            <input id="waFabMsgInput" type="text" placeholder="Mensaje..." class="flex-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs">
            <button type="submit" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0">
              <i class="fa-solid fa-paper-plane"></i>
            </button>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    document.getElementById('waFabTriggerBtn').addEventListener('click', () => toggleFabWindow());
    document.getElementById('waFabCloseBtn').addEventListener('click', () => toggleFabWindow(false));
    document.getElementById('waFabBackBtn').addEventListener('click', () => closeFabThread());
    document.getElementById('waFabNewForm').addEventListener('submit', onFabNewNumber);
    document.getElementById('waFabSendForm').addEventListener('submit', onFabSendMsg);
    document.getElementById('waFabStickerBtn').addEventListener('click', toggleFabStickers);
    document.getElementById('waFabThreadCat').addEventListener('change', onFabChangeCat);
    document.getElementById('waFabDeleteBtn').addEventListener('click', onFabDeleteActive);
    document.getElementById('waFabRepairBtn').addEventListener('click', onFabRepairActive);

    root.querySelectorAll('.wf-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wfState.cat = btn.dataset.wcat;
        root.querySelectorAll('.wf-cat-btn').forEach(b => {
          b.className = b.dataset.wcat === wfState.cat
            ? 'wf-cat-btn py-1 rounded-lg bg-slate-900 text-white font-bold'
            : 'wf-cat-btn py-1 rounded-lg bg-white/80 text-slate-700 font-semibold';
        });
        renderFabChats();
      });
    });

    refreshFabStatusAndChats();
    connectFabSse();
  }

  function toggleFabWindow(force) {
    const win = document.getElementById('waFabWindow');
    if (!win) return;
    wfState.open = typeof force === 'boolean' ? force : !wfState.open;
    win.classList.toggle('is-open', wfState.open);
    if (wfState.open) {
      refreshFabStatusAndChats();
      if (wfState.activePhone) loadFabThread();
    }
  }

  async function refreshFabStatusAndChats() {
    try {
      const [st, chats] = await Promise.all([
        wfApi('/intranet/api/admin/whatsapp/status'),
        wfApi('/intranet/api/admin/whatsapp/chats')
      ]);
      wfState.chats = chats || [];

      const dot = document.getElementById('waFabStatusDot');
      const sub = document.getElementById('waFabHeadSub');
      if (dot) {
        dot.className = 'wa-fab-status-dot ' + (st.status === 'connected' ? 'is-online' : (st.status === 'qr' ? 'is-qr' : ''));
      }
      if (sub && !wfState.activePhone) {
        sub.textContent = st.status === 'connected'
          ? `Conectado${st.phoneNumber ? ' +' + st.phoneNumber : ''}`
          : (st.status === 'qr' ? 'Esperando escaneo QR' : 'Desconectado');
      }

      const unread = wfState.chats.reduce((acc, c) => acc + Number(c.unread_count || 0), 0);
      const badge = document.getElementById('waFabUnreadBadge');
      if (badge) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.toggle('hidden', unread <= 0);
      }

      renderFabChats();
    } catch {}
  }

  function renderFabChats() {
    const box = document.getElementById('waFabChatsBox');
    if (!box) return;
    const list = wfState.chats.filter(c => wfState.cat === 'all' || (c.category || 'libre') === wfState.cat);
    if (!list.length) {
      box.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">Sin chats en este segmento.</p>`;
      return;
    }
    box.innerHTML = list.map((c, idx) => {
      const m = WF_CAT[c.category || 'libre'] || WF_CAT.libre;
      return `
        <div class="group p-2 rounded-xl bg-white/80 hover:bg-white border border-white flex items-center justify-between gap-2 shadow-sm transition">
          <button type="button" data-idx="${idx}" class="wf-open-chat flex-1 min-w-0 text-left">
            <div class="flex items-center justify-between gap-1">
              <span class="text-xs font-bold text-slate-900 truncate">${wfEsc(c.display_name)}</span>
              <span class="px-1.5 py-0.2 rounded text-[9px] font-bold ${m.cls} shrink-0">${m.label}</span>
            </div>
            <div class="flex items-center justify-between gap-1 mt-0.5">
              <span class="text-[11px] text-slate-500 truncate">${wfEsc(c.last_body || '')}</span>
              ${Number(c.unread_count) > 0 ? `<span class="px-1.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold">${c.unread_count}</span>` : ''}
            </div>
          </button>
          <button type="button" data-phone="${wfEsc(c.peer_phone)}" class="wf-del-chat w-6 h-6 rounded-lg hover:bg-rose-100 text-rose-600 text-[11px] flex items-center justify-center shrink-0">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
    }).join('');

    box.querySelectorAll('.wf-open-chat').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = list[Number(btn.dataset.idx)];
        if (item) openFabThread(item.peer_phone, item.display_name, item.category || 'libre', item.peer_jid || '');
      });
    });
    box.querySelectorAll('.wf-del-chat').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Borrar este chat?')) return;
        await wfApi(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(btn.dataset.phone)}`, { method: 'DELETE' }).catch(() => {});
        refreshFabStatusAndChats();
      });
    });
  }

  function onFabNewNumber(e) {
    e.preventDefault();
    const raw = document.getElementById('waFabNewPhone').value.replace(/\D/g, '');
    if (!raw) return;
    const phone = raw.length === 9 && raw.startsWith('9') ? `51${raw}` : raw;
    const cat = document.getElementById('waFabNewCat').value || 'libre';
    document.getElementById('waFabNewPhone').value = '';
    openFabThread(phone, `+${phone}`, cat, '');
  }

  function openFabThread(phone, title, cat, jid) {
    wfState.activePhone = String(phone);
    wfState.activeTitle = title || `+${phone}`;
    wfState.activeCategory = cat || 'libre';
    wfState.activeJid = jid || '';

    document.getElementById('waFabHeadTitle').textContent = wfState.activeTitle;
    document.getElementById('waFabHeadSub').textContent = `+${phone}`;
    document.getElementById('waFabThreadCat').value = wfState.activeCategory;

    document.getElementById('waFabListView').classList.add('hidden');
    const tv = document.getElementById('waFabThreadView');
    tv.classList.remove('hidden');
    tv.classList.add('flex');
    const back = document.getElementById('waFabBackBtn');
    back.classList.remove('hidden');
    back.classList.add('flex');

    loadFabThread();
  }

  function closeFabThread() {
    wfState.activePhone = '';
    document.getElementById('waFabHeadTitle').textContent = 'WhatsApp DC CORP';
    document.getElementById('waFabBackBtn').classList.add('hidden');
    document.getElementById('waFabThreadView').classList.add('hidden');
    document.getElementById('waFabThreadView').classList.remove('flex');
    document.getElementById('waFabListView').classList.remove('hidden');
    refreshFabStatusAndChats();
  }

  async function loadFabThread() {
    if (!wfState.activePhone) return;
    const box = document.getElementById('waFabMsgsBox');
    try {
      const msgs = await wfApi(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(wfState.activePhone)}`);
      if (!msgs.length) {
        box.innerHTML = `<p class="text-[11px] text-slate-500 text-center py-8">Escribe el primer mensaje abajo.</p>`;
        return;
      }
      box.innerHTML = msgs.map(m => {
        const isOut = m.direction === 'out';
        if (m.media_type === 'sticker' && m.media_file) {
          return `<div class="flex ${isOut ? 'justify-end' : 'justify-start'}"><img src="${wfStickerUrl(m.media_file)}" alt="Sticker" class="w-20 h-20 object-contain"></div>`;
        }
        return `
          <div class="flex ${isOut ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[82%] px-3 py-2 rounded-2xl text-xs shadow-sm ${isOut ? 'bg-emerald-600 text-white rounded-br-sm' : 'bg-white text-slate-900 border border-slate-200/80 rounded-bl-sm'}">
              <div class="whitespace-pre-line break-words">${wfEsc(m.body)}</div>
            </div>
          </div>
        `;
      }).join('');
      box.scrollTop = box.scrollHeight;
      refreshFabStatusAndChats();
    } catch {}
  }

  async function onFabSendMsg(e) {
    e.preventDefault();
    if (!wfState.activePhone) return;
    const inp = document.getElementById('waFabMsgInput');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    try {
      await wfApi(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(wfState.activePhone)}`, {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          category: wfState.activeCategory,
          peer_jid: wfState.activeJid
        })
      });
      loadFabThread();
    } catch (err) {
      alert(err.message);
      inp.value = text;
    }
  }

  async function toggleFabStickers() {
    const box = document.getElementById('waFabStickersBox');
    wfState.showStickers = box.classList.contains('hidden');
    box.classList.toggle('hidden', !wfState.showStickers);
    if (!wfState.showStickers) return;
    try {
      const stickers = await wfApi('/intranet/api/admin/whatsapp/stickers');
      if (!stickers.length) {
        box.innerHTML = `<p class="col-span-full text-[11px] text-slate-500 text-center py-2">Sube o recibe stickers para usarlos aquí.</p>`;
        return;
      }
      box.innerHTML = stickers.map(s => `
        <button type="button" data-fn="${wfEsc(s.file_name)}" class="wf-stk-item p-1 rounded-lg hover:bg-emerald-50 flex items-center justify-center">
          <img src="${wfStickerUrl(s.file_name)}" alt="Sticker" class="w-11 h-11 object-contain">
        </button>
      `).join('');
      box.querySelectorAll('.wf-stk-item').forEach(b => {
        b.addEventListener('click', async () => {
          box.classList.add('hidden');
          try {
            await wfApi(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(wfState.activePhone)}/sticker`, {
              method: 'POST',
              body: JSON.stringify({
                file_name: b.dataset.fn,
                category: wfState.activeCategory,
                peer_jid: wfState.activeJid
              })
            });
            loadFabThread();
          } catch (err) {
            alert(err.message);
          }
        });
      });
    } catch {}
  }

  async function onFabChangeCat(e) {
    if (!wfState.activePhone) return;
    wfState.activeCategory = e.target.value;
    await wfApi(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(wfState.activePhone)}/category`, {
      method: 'PATCH',
      body: JSON.stringify({ category: wfState.activeCategory })
    }).catch(() => {});
    refreshFabStatusAndChats();
  }

  async function onFabDeleteActive() {
    if (!wfState.activePhone || !confirm('¿Borrar este chat?')) return;
    await wfApi(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(wfState.activePhone)}`, { method: 'DELETE' }).catch(() => {});
    closeFabThread();
  }

  async function onFabRepairActive() {
    if (!wfState.activePhone) return;
    try {
      const res = await wfApi(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(wfState.activePhone)}/repair`, { method: 'POST' });
      alert(`Cifrado reparado (${res.removed || 0} llaves limpiadas). Envía un mensaje nuevo.`);
    } catch (err) {
      alert(err.message);
    }
  }

  function connectFabSse() {
    try {
      const es = new EventSource(`/intranet/api/chat/stream?token=${encodeURIComponent(fToken)}`);
      wfState.sse = es;
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.type === 'wa_message') {
            refreshFabStatusAndChats();
            if (wfState.open && wfState.activePhone && d.message && d.message.peer_phone === wfState.activePhone) {
              loadFabThread();
            }
          }
        } catch {}
      };
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountFloatingWidget);
  } else {
    mountFloatingWidget();
  }
})();
