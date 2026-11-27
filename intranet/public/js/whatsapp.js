const waToken = localStorage.getItem('dc_token');
const waRole = localStorage.getItem('dc_role');

if (!waToken || waRole !== 'admin') {
  window.location.replace('/intranet');
}

const waCenter = {
  sideTab: 'chats',
  chats: [],
  contacts: [],
  activePhone: '',
  activeTitle: '',
  qrPoll: null,
  sse: null
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
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    logoutWaCenter();
    throw new Error('No autorizado');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
  return data;
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
    renderWaSidebarList();
  } catch {}
}

function switchWaSideTab(tab) {
  waCenter.sideTab = tab;
  const bChats = document.getElementById('waSideTabChats');
  const bContacts = document.getElementById('waSideTabContacts');
  if (tab === 'chats') {
    bChats.className = 'py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold shadow-sm';
    bContacts.className = 'py-1.5 rounded-lg text-slate-600 text-xs font-semibold';
  } else {
    bContacts.className = 'py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold shadow-sm';
    bChats.className = 'py-1.5 rounded-lg text-slate-600 text-xs font-semibold';
  }
  renderWaSidebarList();
}

function renderWaSidebarList() {
  const el = document.getElementById('waSidebarList');
  if (!el) return;
  const q = (document.getElementById('waSearchInput')?.value || '').toLowerCase();

  if (waCenter.sideTab === 'chats') {
    const list = waCenter.chats.filter(c =>
      `${c.display_name} ${c.peer_phone} ${c.last_body}`.toLowerCase().includes(q)
    );
    if (!list.length) {
      el.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">Sin chats aún. Escribe a un contacto o número nuevo.</p>`;
      return;
    }
    el.innerHTML = list.map(c => {
      const active = waCenter.activePhone === c.peer_phone;
      return `
        <button type="button" onclick="openWaThread('${escWa(c.peer_phone)}', '${escWa(c.display_name)}')"
          class="w-full text-left p-3 rounded-2xl border transition flex items-start justify-between gap-2 ${active ? 'bg-white border-emerald-400 shadow-sm' : 'bg-white/55 hover:bg-white/80 border-white/75'}">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-extrabold text-slate-900 truncate">${escWa(c.display_name)}</div>
            <div class="text-[11px] text-slate-600 truncate mt-0.5">${escWa(c.last_body || '')}</div>
          </div>
          ${Number(c.unread_count) > 0 ? `<span class="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold shrink-0">${c.unread_count}</span>` : ''}
        </button>
      `;
    }).join('');
  } else {
    const list = waCenter.contacts.filter(c =>
      `${c.name} ${c.phone} ${c.tag}`.toLowerCase().includes(q)
    );
    if (!list.length) {
      el.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">No hay contactos con WhatsApp registrado.</p>`;
      return;
    }
    el.innerHTML = list.map(c => `
      <button type="button" onclick="openWaThread('${escWa(c.phone)}', '${escWa(c.name)}')"
        class="w-full text-left p-3 rounded-2xl bg-white/55 hover:bg-white/85 border border-white/75 transition flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-extrabold text-slate-900 truncate">${escWa(c.name)}</div>
          <div class="text-[11px] text-slate-500 truncate">+${escWa(c.phone)} • ${escWa(c.tag)}</div>
        </div>
        <i class="fa-solid fa-comment-dots text-emerald-600 text-xs shrink-0"></i>
      </button>
    `).join('');
  }
}

function startNewNumberChat(e) {
  e.preventDefault();
  const raw = document.getElementById('waNewPhoneInput').value.replace(/\D/g, '');
  if (!raw) return;
  const phone = raw.length === 9 && raw.startsWith('9') ? `51${raw}` : raw;
  document.getElementById('waNewPhoneInput').value = '';
  openWaThread(phone, `+${phone}`);
}

async function openWaThread(phone, title) {
  waCenter.activePhone = phone;
  waCenter.activeTitle = title || `+${phone}`;
  document.getElementById('waActiveTitle').textContent = waCenter.activeTitle;
  document.getElementById('waActiveSub').textContent = `+${phone}`;
  document.getElementById('waMessageInput').disabled = false;
  document.getElementById('waSendBtn').disabled = false;
  await refreshActiveThread();
  loadWaSidebarData();
}

async function refreshActiveThread() {
  if (!waCenter.activePhone) return;
  const box = document.getElementById('waMessagesBox');
  try {
    const msgs = await apiWa(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(waCenter.activePhone)}`);
    if (!msgs.length) {
      box.innerHTML = `<p class="text-xs text-slate-500 text-center py-12">Sin mensajes previos con +${escWa(waCenter.activePhone)}. Escribe el primero abajo.</p>`;
      return;
    }
    box.innerHTML = msgs.map(m => {
      const isOut = m.direction === 'out';
      const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="flex ${isOut ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm shadow-sm ${isOut ? 'bg-emerald-600 text-white rounded-br-sm' : 'bg-white/90 text-slate-900 border border-white rounded-bl-sm'}">
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
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  try {
    await apiWa(`/intranet/api/admin/whatsapp/messages/${encodeURIComponent(waCenter.activePhone)}`, {
      method: 'POST',
      body: JSON.stringify({ message: text })
    });
    await refreshActiveThread();
    loadWaSidebarData();
  } catch (err) {
    alert(err.message);
    inp.value = text;
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

document.addEventListener('DOMContentLoaded', () => {
  loadWaStatus();
  loadWaSidebarData();
  initWaRealtime();
});
