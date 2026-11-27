const waToken = localStorage.getItem('dc_token');
const waRole = localStorage.getItem('dc_role');

if (!waToken || waRole !== 'admin') {
  window.location.replace('/intranet');
}

const waCenter = {
  sideTab: 'chats',
  categoryFilter: 'all',
  chats: [],
  contacts: [],
  stickers: [],
  activePhone: '',
  activeJid: '',
  activeTitle: '',
  activeCategory: 'libre',
  qrPoll: null,
  sse: null
};

const CAT_META = {
  tareas: { label: 'Tareas', badge: 'bg-sky-100 text-sky-800', avatar: 'bg-sky-500/20 text-sky-800' },
  libre: { label: 'Libre', badge: 'bg-emerald-100 text-emerald-800', avatar: 'bg-emerald-500/20 text-emerald-800' },
  ti: { label: 'Soporte TI', badge: 'bg-indigo-100 text-indigo-800', avatar: 'bg-indigo-500/20 text-indigo-800' }
};

function escWa(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function logoutWaCenter() {
  localStorage.clear();
  window.location.href = '/intranet';
}

async function apiWa(url, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${waToken}` };
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body && !isForm && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    logoutWaCenter();
    throw new Error('No autorizado');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
  return data;
}

function stickerUrl(fileName) {
  return `/intranet/api/admin/whatsapp/stickers/file/${encodeURIComponent(fileName)}?token=${encodeURIComponent(waToken)}`;
}

async function loadWaStatus() {
  try {
    const st = await apiWa('/intranet/api/admin/whatsapp/status');
    const topBadge = document.getElementById('waTopBadge');
    const topPhone = document.getElementById('waTopPhone');
    if (st.status === 'connected') {
      topBadge.textContent = '● Conectado';
      topBadge.className = 'text-[11px] font-bold text-emerald-700';
      topPhone.textContent = st.phoneNumber ? `(+${st.phoneNumber})` : '';
    } else if (st.status === 'qr') {
      topBadge.textContent = '● Esperando QR';
      topBadge.className = 'text-[11px] font-bold text-amber-700';
      topPhone.textContent = '';
    } else {
      topBadge.textContent = '● Desconectado';
      topBadge.className = 'text-[11px] font-bold text-rose-600';
      topPhone.textContent = '';
    }

    const modalStatus = document.getElementById('waModalStatusText');
    const modalPhone = document.getElementById('waModalPhoneText');
    const modalErr = document.getElementById('waModalErrText');
    const qrBox = document.getElementById('waModalQrBox');
    const qrImg = document.getElementById('waModalQrImg');
    if (modalStatus) modalStatus.textContent = st.status;
    if (modalPhone) modalPhone.textContent = st.phoneNumber ? `Número vinculado: +${st.phoneNumber}` : '';
    if (modalErr) modalErr.textContent = st.lastError || '';
    if (qrBox && qrImg) {
      if (st.status === 'qr' && st.qrDataUrl) {
        qrImg.src = st.qrDataUrl;
        qrBox.classList.remove('hidden');
      } else {
        qrBox.classList.add('hidden');
      }
    }
  } catch {}
}

async function loadWaSidebarData() {
  try {
    const [chats, contacts] = await Promise.all([
      apiWa('/intranet/api/admin/whatsapp/chats'),
      apiWa('/intranet/api/admin/whatsapp/contacts')
    ]);
    waCenter.chats = chats || [];
    waCenter.contacts = contacts || [];
    updateCategoryCounts();
    renderWaSidebarList();
  } catch {}
}

function updateCategoryCounts() {
  const source = waCenter.sideTab === 'chats' ? waCenter.chats : waCenter.contacts;
  const cTareas = source.filter(x => (x.category || 'libre') === 'tareas').length;
  const cLibre = source.filter(x => (x.category || 'libre') === 'libre').length;
  const cTi = source.filter(x => (x.category || 'libre') === 'ti').length;

  const map = {
    all: `Todos (${source.length})`,
    tareas: `📚 ${cTareas}`,
    libre: `💬 ${cLibre}`,
    ti: `🛠️ ${cTi}`
  };
  Object.entries(map).forEach(([k, text]) => {
    const btn = document.getElementById(`waCatBtn-${k}`);
    if (!btn) return;
    btn.textContent = text;
    const isAct = waCenter.categoryFilter === k;
    btn.className = isAct
      ? 'wa-cat-btn py-1.5 px-1.5 rounded-xl bg-slate-900 text-white font-bold truncate shadow-sm transition'
      : 'wa-cat-btn py-1.5 px-1.5 rounded-xl bg-white/65 text-slate-700 font-semibold hover:bg-white truncate transition';
  });
}

function setWaCategoryFilter(cat) {
  waCenter.categoryFilter = cat;
  updateCategoryCounts();
  renderWaSidebarList();
}

function switchWaSideTab(tab) {
  waCenter.sideTab = tab;
  const bChats = document.getElementById('waSideTabChats');
  const bContacts = document.getElementById('waSideTabContacts');
  if (tab === 'chats') {
    bChats.className = 'py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold shadow-sm transition';
    bContacts.className = 'py-1.5 rounded-lg text-slate-600 text-xs font-semibold transition';
  } else {
    bContacts.className = 'py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold shadow-sm transition';
    bChats.className = 'py-1.5 rounded-lg text-slate-600 text-xs font-semibold transition';
  }
  updateCategoryCounts();
  renderWaSidebarList();
}

function initialsFrom(name) {
  const clean = String(name || '').replace(/[^a-zA-Z0-9ÁÉÍÓÚÑáéíóúñ ]/g, '').trim();
  if (!clean) return 'WA';
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function renderWaSidebarList() {
  const el = document.getElementById('waSidebarList');
  if (!el) return;
  const q = (document.getElementById('waSearchInput')?.value || '').toLowerCase();
  const catF = waCenter.categoryFilter;

  if (waCenter.sideTab === 'chats') {
    const list = waCenter.chats.filter(c => {
      if (catF !== 'all' && (c.category || 'libre') !== catF) return false;
      return `${c.display_name} ${c.peer_phone} ${c.last_body}`.toLowerCase().includes(q);
    });
    if (!list.length) {
      el.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">No hay conversaciones en este segmento.</p>`;
      return;
    }
    el.innerHTML = list.map((c, idx) => {
      const active = waCenter.activePhone === c.peer_phone;
      const meta = CAT_META[c.category || 'libre'] || CAT_META.libre;
      const timeStr = c.last_at ? new Date(c.last_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="group rounded-2xl border transition flex items-center gap-2.5 p-2.5 ${active ? 'bg-white border-emerald-400 shadow-sm' : 'bg-white/60 hover:bg-white/90 border-white/80'}">
          <button type="button" data-idx="${idx}" onclick="openWaChatByIndex(this.dataset.idx)" class="flex-1 min-w-0 flex items-center gap-2.5 text-left">
            <div class="w-10 h-10 rounded-xl ${meta.avatar} font-extrabold text-xs flex items-center justify-center shrink-0">
              ${escWa(initialsFrom(c.display_name))}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs font-extrabold text-slate-900 truncate">${escWa(c.display_name)}</span>
                <span class="text-[10px] text-slate-400 shrink-0">${escWa(timeStr)}</span>
              </div>
              <div class="flex items-center justify-between gap-1 mt-0.5">
                <span class="text-[11px] text-slate-600 truncate">${escWa(c.last_body || '')}</span>
                <div class="flex items-center gap-1 shrink-0">
                  <span class="px-1.5 py-0.5 rounded-md text-[9px] font-bold ${meta.badge}">${meta.label}</span>
                  ${Number(c.unread_count) > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">${c.unread_count}</span>` : ''}
                </div>
              </div>
            </div>
          </button>
          <button type="button" data-phone="${escWa(c.peer_phone)}" onclick="quickDeleteChat(this.dataset.phone)" title="Borrar chat" class="opacity-60 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center text-xs shrink-0 transition">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
    }).join('');
    el._filteredChats = list;
  } else {
    const list = waCenter.contacts.filter(c => {
      if (catF !== 'all' && (c.category || 'libre') !== catF) return false;
      return `${c.name} ${c.phone} ${c.tag}`.toLowerCase().includes(q);
    });
    if (!list.length) {
      el.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">No hay contactos en este segmento.</p>`;
      return;
    }
    el.innerHTML = list.map((c, idx) => {
      const meta = CAT_META[c.category || 'libre'] || CAT_META.libre;
      return `
        <button type="button" data-idx="${idx}" onclick="openWaContactByIndex(this.dataset.idx)"
          class="w-full text-left p-2.5 rounded-2xl bg-white/60 hover:bg-white/90 border border-white/80 transition flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl ${meta.avatar} font-extrabold text-xs flex items-center justify-center shrink-0">
            ${escWa(initialsFrom(c.name))}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-extrabold text-slate-900 truncate">${escWa(c.name)}</div>
            <div class="text-[11px] text-slate-500 truncate">+${escWa(c.phone)} • ${escWa(c.tag)}</div>
          </div>
          <span class="px-2 py-0.5 rounded-md text-[9px] font-bold ${meta.badge} shrink-0">${meta.label}</span>
        </button>
      `;
    }).join('');
    el._filteredContacts = list;
  }
}

function openWaChatByIndex(idx) {
  const el = document.getElementById('waSidebarList');
  const item = el && el._filteredChats && el._filteredChats[Number(idx)];
  if (!item) return;
  openWaThread(item.peer_phone, item.display_name, item.category || 'libre', item.peer_jid || '');
}

function openWaContactByIndex(idx) {
  const el = document.getElementById('waSidebarList');
  const item = el && el._filteredContacts && el._filteredContacts[Number(idx)];
  if (!item) return;
  openWaThread(item.phone, item.name, item.category || 'libre', '');
}

function startNewNumberChat(e) {
  e.preventDefault();
  const raw = document.getElementById('waNewPhoneInput').value.replace(/\D/g, '');
  if (!raw) return;
  const phone = raw.length === 9 && raw.startsWith('9') ? `51${raw}` : raw;
  const cat = document.getElementById('waNewCatSelect')?.value || 'libre';
  document.getElementById('waNewPhoneInput').value = '';
  openWaThread(phone, `+${phone}`, cat, '');
}

function showMobileThreadView(showThread) {
  const side = document.getElementById('waSidebarPane');
  const thread = document.getElementById('waThreadPane');
  if (!side || !thread) return;
  if (window.innerWidth < 1024) {
    side.classList.toggle('hidden', showThread);
    thread.classList.toggle('hidden', !showThread);
    thread.classList.toggle('flex', showThread);
  } else {
    side.classList.remove('hidden');
    thread.classList.remove('hidden');
    thread.classList.add('flex');
  }
}

function backToMobileWaList() {
  showMobileThreadView(false);
}

async function openWaThread(phone, title, category = 'libre', peerJid = '') {
  waCenter.activePhone = String(phone);
  waCenter.activeJid = String(peerJid || '');
  waCenter.activeTitle = title || `+${phone}`;
  waCenter.activeCategory = category || 'libre';

  document.getElementById('waActiveTitle').textContent = waCenter.activeTitle;
  document.getElementById('waActiveSub').textContent = `+${phone}`;
  document.getElementById('waActiveAvatar').textContent = initialsFrom(waCenter.activeTitle);

  const actions = document.getElementById('waActiveActions');
  if (actions) {
    actions.classList.remove('hidden');
    actions.classList.add('flex');
  }
  const catSel = document.getElementById('waActiveCatSelect');
  if (catSel) catSel.value = waCenter.activeCategory;

  document.getElementById('waMessageInput').disabled = false;
  document.getElementById('waSendBtn').disabled = false;
  document.getElementById('waStickerBtn').disabled = false;

  showMobileThreadView(true);
  await refreshActiveThread();
  loadWaSidebarData();
}

async function refreshActiveThread() {
  if (!waCenter.activePhone) return;
  const box = document.getElementById('waMessagesBox');
  try {
    const msgs = await apiWa(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(waCenter.activePhone)}`);
    if (!msgs.length) {
      box.innerHTML = `<p class="text-xs text-slate-500 text-center py-12">Sin mensajes previos con +${escWa(waCenter.activePhone)}. Escribe un mensaje o envía un sticker abajo.</p>`;
      return;
    }
    const lastWithJid = [...msgs].reverse().find(m => m.peer_jid);
    if (lastWithJid && lastWithJid.peer_jid) {
      waCenter.activeJid = lastWithJid.peer_jid;
    }
    const lastCat = msgs[msgs.length - 1]?.category;
    if (lastCat && document.getElementById('waActiveCatSelect')) {
      waCenter.activeCategory = lastCat;
      document.getElementById('waActiveCatSelect').value = lastCat;
    }

    box.innerHTML = msgs.map(m => {
      const isOut = m.direction === 'out';
      const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '';
      if (m.media_type === 'sticker' && m.media_file) {
        return `
          <div class="flex ${isOut ? 'justify-end' : 'justify-start'}">
            <div class="p-2 rounded-2xl ${isOut ? 'bg-emerald-500/15' : 'bg-white/75'} border border-white/80 shadow-sm">
              <img src="${stickerUrl(m.media_file)}" alt="Sticker" class="w-28 h-28 object-contain">
              <div class="text-[10px] text-slate-500 text-right mt-0.5">${escWa(time)}</div>
            </div>
          </div>
        `;
      }
      return `
        <div class="flex ${isOut ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm shadow-sm ${isOut ? 'bg-emerald-600 text-white rounded-br-sm' : 'bg-white/95 text-slate-900 border border-white rounded-bl-sm'}">
            <div class="whitespace-pre-line break-words">${escWa(m.body)}</div>
            <div class="text-[10px] mt-1 opacity-75 text-right">${escWa(time)}</div>
          </div>
        </div>
      `;
    }).join('');
    box.scrollTop = box.scrollHeight;
  } catch {}
}

async function sendWaChatMessage(e) {
  e.preventDefault();
  if (!waCenter.activePhone) return;
  const inp = document.getElementById('waMessageInput');
  const btn = document.getElementById('waSendBtn');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  btn.disabled = true;
  try {
    const res = await apiWa(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(waCenter.activePhone)}`, {
      method: 'POST',
      body: JSON.stringify({
        message: text,
        category: waCenter.activeCategory,
        peer_jid: waCenter.activeJid
      })
    });
    if (res.to && res.to !== waCenter.activePhone) {
      waCenter.activePhone = res.to;
    }
    await refreshActiveThread();
    loadWaSidebarData();
  } catch (err) {
    alert(err.message);
    inp.value = text;
  } finally {
    btn.disabled = false;
    inp.focus();
  }
}

async function changeActiveChatCategory(newCat) {
  if (!waCenter.activePhone) return;
  waCenter.activeCategory = newCat;
  try {
    await apiWa(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(waCenter.activePhone)}/category`, {
      method: 'PATCH',
      body: JSON.stringify({ category: newCat })
    });
    loadWaSidebarData();
  } catch (err) {
    alert(err.message);
  }
}

async function quickDeleteChat(phone) {
  if (!phone) return;
  if (!confirm('¿Borrar el historial de este chat en la plataforma?')) return;
  try {
    await apiWa(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(phone)}`, { method: 'DELETE' });
    if (waCenter.activePhone === phone) {
      waCenter.activePhone = '';
      document.getElementById('waActiveTitle').textContent = 'Selecciona un chat o contacto';
      document.getElementById('waActiveSub').textContent = 'Chat eliminado.';
      document.getElementById('waActiveActions').classList.add('hidden');
      document.getElementById('waMessageInput').disabled = true;
      document.getElementById('waSendBtn').disabled = true;
      document.getElementById('waStickerBtn').disabled = true;
      document.getElementById('waMessagesBox').innerHTML = `<p class="text-xs text-slate-500 text-center py-14">Conversación eliminada.</p>`;
      showMobileThreadView(false);
    }
    loadWaSidebarData();
  } catch (err) {
    alert(err.message);
  }
}

function deleteActiveChat() {
  if (waCenter.activePhone) quickDeleteChat(waCenter.activePhone);
}

async function repairActiveChatSignal() {
  if (!waCenter.activePhone) return;
  if (!confirm('¿Reiniciar las llaves cifradas Signal con este contacto? Úsalo si le aparecía "Esperando el mensaje".')) return;
  try {
    const res = await apiWa(`/intranet/api/admin/whatsapp/chats/${encodeURIComponent(waCenter.activePhone)}/repair`, { method: 'POST' });
    alert(`Cifrado reparado (${res.removed || 0} sesiones antiguas limpiadas). Envía un nuevo mensaje ahora.`);
    loadWaStatus();
  } catch (err) {
    alert(err.message);
  }
}

// --- STICKERS ---
async function loadWaStickers() {
  try {
    waCenter.stickers = await apiWa('/intranet/api/admin/whatsapp/stickers');
    renderWaStickers();
  } catch {}
}

function toggleWaStickerPopover(forceState) {
  const pop = document.getElementById('waStickerPopover');
  if (!pop) return;
  const show = typeof forceState === 'boolean' ? forceState : pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !show);
  if (show) loadWaStickers();
}

function renderWaStickers() {
  const grid = document.getElementById('waStickerGrid');
  if (!grid) return;
  if (!waCenter.stickers.length) {
    grid.innerHTML = `<p class="col-span-full text-xs text-slate-500 text-center py-4">Aún no hay stickers guardados. Sube un archivo .webp/.png arriba o recibe un sticker por WhatsApp y aparecerá aquí automáticamente.</p>`;
    return;
  }
  grid.innerHTML = waCenter.stickers.map(s => `
    <div class="relative group rounded-xl bg-white/80 hover:bg-white border border-slate-200/80 p-1.5 flex items-center justify-center">
      <button type="button" data-file="${escWa(s.file_name)}" onclick="sendStickerToActiveChat(this.dataset.file)" class="w-full flex items-center justify-center">
        <img src="${stickerUrl(s.file_name)}" alt="Sticker" class="w-14 h-14 object-contain hover:scale-105 transition">
      </button>
      <button type="button" onclick="deleteSavedSticker(${s.id})" title="Quitar" class="hidden group-hover:flex absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] items-center justify-center">&times;</button>
    </div>
  `).join('');
}

async function uploadNewWaSticker(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('sticker', file);
  try {
    await apiWa('/intranet/api/admin/whatsapp/stickers/upload', { method: 'POST', body: fd });
    await loadWaStickers();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSavedSticker(id) {
  try {
    await apiWa(`/intranet/api/admin/whatsapp/stickers/${id}`, { method: 'DELETE' });
    loadWaStickers();
  } catch {}
}

async function sendStickerToActiveChat(fileName) {
  if (!waCenter.activePhone || !fileName) return;
  toggleWaStickerPopover(false);
  try {
    await apiWa(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(waCenter.activePhone)}/sticker`, {
      method: 'POST',
      body: JSON.stringify({
        file_name: fileName,
        category: waCenter.activeCategory,
        peer_jid: waCenter.activeJid
      })
    });
    await refreshActiveThread();
    loadWaSidebarData();
  } catch (err) {
    alert(err.message);
  }
}

function openQrSetupModal() {
  document.getElementById('waQrSetupModal').classList.remove('hidden');
  loadWaStatus();
  if (waCenter.qrPoll) clearInterval(waCenter.qrPoll);
  waCenter.qrPoll = setInterval(loadWaStatus, 2500);
}

function closeQrSetupModal() {
  document.getElementById('waQrSetupModal').classList.add('hidden');
  if (waCenter.qrPoll) {
    clearInterval(waCenter.qrPoll);
    waCenter.qrPoll = null;
  }
}

async function connectWaFromCenter() {
  try {
    await apiWa('/intranet/api/admin/whatsapp/connect', { method: 'POST' });
    loadWaStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function disconnectWaFromCenter() {
  if (!confirm('¿Desvincular la sesión de WhatsApp?')) return;
  try {
    await apiWa('/intranet/api/admin/whatsapp/disconnect', { method: 'POST' });
    loadWaStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function triggerParticularesReminders() {
  try {
    const res = await apiWa('/intranet/api/admin/whatsapp/send-reminders', { method: 'POST' });
    alert(`Se pusieron en cola ${res.queued || 0} recordatorios para apoderados de Particulares.`);
  } catch (err) {
    alert(err.message);
  }
}

function initWaRealtime() {
  if (waCenter.sse) waCenter.sse.close();
  const es = new EventSource(`/intranet/api/chat/stream?token=${encodeURIComponent(waToken)}`);
  waCenter.sse = es;
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'wa_message' && data.message) {
        loadWaSidebarData();
        if (waCenter.activePhone && data.message.peer_phone === waCenter.activePhone) {
          refreshActiveThread();
        }
      }
    } catch {}
  };
}

window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) showMobileThreadView(true);
});

document.addEventListener('DOMContentLoaded', () => {
  const qp = new URLSearchParams(window.location.search);
  const prePhone = qp.get('phone');
  loadWaStatus();
  loadWaSidebarData().then(() => {
    if (prePhone) openWaThread(prePhone, `+${prePhone}`, 'libre', '');
  });
  initWaRealtime();
});
