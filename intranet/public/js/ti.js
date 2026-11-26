const tiToken = localStorage.getItem('dc_token');
const tiRole = localStorage.getItem('dc_role');
const urlParams = new URLSearchParams(window.location.search);
const shareToken = urlParams.get('share');

const tiState = {
  clients: [],
  assets: [],
  orders: [],
  evidences: [],
  invoices: [],
  nextNumbers: { REC: 'REC-2026-0001', EST: 'EST0001' },
  invoiceItems: [],
  activeTab: 'dashboard',
  isPublicShare: Boolean(shareToken)
};

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function moneyFmt(val) {
  const num = Number(val || 0);
  return `S/ ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function logoutTi() {
  localStorage.clear();
  window.location.href = '/intranet';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

async function apiTi(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (tiToken) headers.Authorization = `Bearer ${tiToken}`;
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/intranet';
    throw new Error('Sesión inválida');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
  return data;
}

function evidenceFileUrl(evId) {
  if (tiState.isPublicShare) {
    return `/intranet/api/ti/evidences/${evId}/file?share=${encodeURIComponent(shareToken)}`;
  }
  return `/intranet/api/ti/evidences/${evId}/file?token=${encodeURIComponent(tiToken)}`;
}

// --- Conversión de monto a letras (Soles Peruanos) ---
function numeroALetras(monto) {
  const n = Math.max(0, Number(monto || 0));
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const decStr = String(centavos).padStart(2, '0');

  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const decenas = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function menorMil(num) {
    if (num === 0) return '';
    if (num === 100) return 'CIEN';
    let out = '';
    const c = Math.floor(num / 100);
    const r = num % 100;
    if (c > 0) out += centenas[c] + (r > 0 ? ' ' : '');
    if (r >= 10 && r <= 19) {
      out += especiales[r - 10];
    } else if (r >= 21 && r <= 29) {
      out += 'VEINTI' + unidades[r - 20];
    } else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      if (d > 0) out += decenas[d] + (u > 0 ? ' Y ' : '');
      if (u > 0) out += unidades[u];
    }
    return out.trim();
  }

  let texto = '';
  if (entero === 0) {
    texto = 'CERO';
  } else {
    const millones = Math.floor(entero / 1000000);
    const restoMillon = entero % 1000000;
    const miles = Math.floor(restoMillon / 1000);
    const resto = restoMillon % 1000;

    if (millones === 1) texto += 'UN MILLÓN ';
    else if (millones > 1) texto += `${menorMil(millones)} MILLONES `;

    if (miles === 1) texto += 'MIL ';
    else if (miles > 1) texto += `${menorMil(miles)} MIL `;

    if (resto > 0) texto += menorMil(resto);
  }

  return `${texto.trim()} Y ${decStr}/100 SOLES`;
}

// --- Inicialización ---
async function initTiPortal() {
  if (tiState.isPublicShare) {
    setupPublicShareUI();
    try {
      const data = await fetch(`/intranet/api/ti/public/${encodeURIComponent(shareToken)}`).then(r => {
        if (!r.ok) throw new Error('Enlace inválido');
        return r.json();
      });
      tiState.clients = [data.client];
      tiState.assets = data.assets || [];
      tiState.orders = data.orders || [];
      tiState.evidences = data.evidences || [];
      document.getElementById('publicClientTitle').textContent = data.client.name;
      document.getElementById('publicClientSub').textContent = [data.client.subtitle, data.client.location].filter(Boolean).join(' • ');
      renderAllTi();
    } catch (e) {
      alert('Enlace de seguimiento no válido o expirado.');
    }
    return;
  }

  if (!tiToken || tiRole !== 'admin') {
    window.location.href = '/intranet';
    return;
  }

  await loadTiOverview();
}

function setupPublicShareUI() {
  document.getElementById('publicShareBanner').classList.remove('hidden');
  ['mobileBackEdu', 'mobileLogoutBtn', 'tiSidebarFooter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  document.querySelectorAll('[data-tab="dashboard"], [data-tab="clients"], [data-tab="invoices"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('button[onclick*="openOrderModal"], button[onclick*="openAssetModal"], button[onclick*="openClientModal"], button[onclick*="openInvoiceModal"]').forEach(el => el.classList.add('hidden'));
  switchTiTab('history');
}

async function loadTiOverview() {
  try {
    const data = await apiTi('/intranet/api/ti/overview');
    tiState.clients = data.clients || [];
    tiState.assets = data.assets || [];
    tiState.orders = data.orders || [];
    tiState.evidences = data.evidences || [];
    tiState.invoices = data.invoices || [];
    tiState.nextNumbers = data.nextNumbers || tiState.nextNumbers;
    renderAllTi();
  } catch (err) {
    alert(err.message);
  }
}

function switchTiTab(tab) {
  tiState.activeTab = tab;
  ['dashboard', 'orders', 'history', 'assets', 'clients', 'invoices'].forEach(t => {
    const sec = document.getElementById(`tab-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tab);
  });

  document.querySelectorAll('.ti-nav-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.className = active
      ? 'ti-nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-left transition bg-sky-500/20 text-white border border-sky-400/30'
      : 'ti-nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-left transition text-slate-300 hover:bg-white/10';
  });

  document.querySelectorAll('.ti-dock-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.className = active
      ? 'ti-dock-btn flex flex-col items-center py-1 px-2 rounded-xl text-[10px] font-bold text-sky-700 bg-white/70'
      : 'ti-dock-btn flex flex-col items-center py-1 px-2 rounded-xl text-[10px] font-medium text-slate-600';
  });

  if (tab === 'history') renderHistoryTab();
  if (tab === 'dashboard') renderDashboard();
}

function renderAllTi() {
  populateClientSelects();
  onHistoryClientChange();
  renderKpis();
  renderDashboard();
  renderOrders();
  renderHistoryTab();
  renderAssets();
  renderClients();
  renderInvoices();
}

function renderDashboard() {
  const breakdownEl = document.getElementById('dashServiceBreakdown');
  const activityEl = document.getElementById('dashRecentActivity');
  const assetsEl = document.getElementById('dashRecentAssets');
  const invoicesEl = document.getElementById('dashRecentInvoices');
  if (!breakdownEl || !activityEl || !assetsEl || !invoicesEl) return;

  const totalOrders = tiState.orders.length || 1;
  const categories = [
    { label: 'Reparación', color: 'bg-sky-500' },
    { label: 'Mantenimiento', color: 'bg-indigo-500' },
    { label: 'Instalación de Red', color: 'bg-emerald-500' },
    { label: 'Reconstrucción', color: 'bg-amber-500' },
    { label: 'Soporte / Licencias', color: 'bg-violet-500' }
  ];

  breakdownEl.innerHTML = categories.map(cat => {
    const count = tiState.orders.filter(o => o.order_type === cat.label).length;
    const pct = tiState.orders.length ? Math.round((count / totalOrders) * 100) : 0;
    return `
      <div class="space-y-1">
        <div class="flex justify-between text-xs">
          <span class="font-bold text-slate-700">${escHtml(cat.label)}</span>
          <span class="font-semibold text-slate-500">${count} (${pct}%)</span>
        </div>
        <div class="ti-dash-bar-track">
          <div class="ti-dash-bar-fill ${cat.color}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const recentOrders = tiState.orders.slice(0, 4);
  activityEl.innerHTML = recentOrders.length ? recentOrders.map(o => `
    <div class="p-2.5 rounded-xl bg-white/55 border border-white/75 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xs font-extrabold text-slate-900 truncate">${escHtml(o.title)}</div>
        <div class="text-[11px] text-slate-600 truncate">${escHtml(o.client_name || '')} • ${escHtml(o.service_date)}</div>
      </div>
      <span class="px-2 py-0.5 rounded-lg bg-sky-100/80 text-sky-800 text-[10px] font-bold shrink-0">${escHtml(o.order_type)}</span>
    </div>
  `).join('') : `<p class="text-xs text-slate-500">Sin trabajos recientes todavía.</p>`;

  const recentAssets = tiState.assets.slice(0, 4);
  assetsEl.innerHTML = recentAssets.length ? recentAssets.map(a => `
    <button type="button" onclick="openAssetHistory(${a.id})" class="w-full text-left p-2.5 rounded-xl bg-white/55 hover:bg-white/80 border border-white/75 flex items-center justify-between gap-2 transition">
      <div class="min-w-0">
        <div class="text-xs font-extrabold text-slate-900 truncate">${escHtml(a.name)}</div>
        <div class="text-[11px] text-slate-600 truncate">${escHtml(a.category)} • ${escHtml(a.client_name || '')}</div>
      </div>
      <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">${escHtml(a.status)}</span>
    </button>
  `).join('') : `<p class="text-xs text-slate-500">Sin equipos ni redes registrados.</p>`;

  const recentInvs = tiState.invoices.slice(0, 4);
  invoicesEl.innerHTML = recentInvs.length ? recentInvs.map(inv => `
    <div class="p-2.5 rounded-xl bg-white/55 border border-white/75 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xs font-extrabold text-slate-900 truncate">${escHtml(inv.doc_number)} · ${escHtml(inv.client_name)}</div>
        <div class="text-[11px] text-slate-600 truncate">${escHtml(inv.issue_date)}</div>
      </div>
      <button type="button" onclick="previewInvoice(${inv.id})" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold shrink-0">${moneyFmt(inv.total_amount)}</button>
    </div>
  `).join('') : `<p class="text-xs text-slate-500">Aún no has emitido recibos.</p>`;
}

function renderKpis() {
  document.getElementById('kpiClients').textContent = tiState.clients.length;
  document.getElementById('kpiAssets').textContent = tiState.assets.length;
  document.getElementById('kpiOrders').textContent = tiState.orders.length;
  const totalInv = tiState.invoices.reduce((acc, inv) => acc + Number(inv.total_amount || 0), 0);
  document.getElementById('kpiInvoiced').textContent = moneyFmt(totalInv);
}

function populateClientSelects() {
  const clientOpts = tiState.clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  ['orderClientFilter', 'assetClientFilter', 'historyClientFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = `<option value="">Todos los clientes</option>${clientOpts}`;
    el.value = prev;
  });
  ['assetClientInput', 'orderClientInput'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = tiState.clients.length ? clientOpts : `<option value="">Primero crea un cliente</option>`;
    if (prev) el.value = prev;
  });
  const invSel = document.getElementById('invClientSelect');
  if (invSel) {
    invSel.innerHTML = `<option value="">-- Seleccionar cliente guardado --</option>${clientOpts}`;
  }
}

// --- RENDER CLIENTES ---
function renderClients() {
  const container = document.getElementById('clientsGrid');
  if (!container) return;
  if (!tiState.clients.length) {
    container.innerHTML = `<div class="col-span-full ti-liquid-card rounded-2xl p-8 text-center text-sm text-slate-500">Aún no hay clientes registrados. Crea tu primer cliente o institución.</div>`;
    return;
  }
  container.innerHTML = tiState.clients.map(c => {
    const assetCount = tiState.assets.filter(a => Number(a.client_id) === Number(c.id)).length;
    const orderCount = tiState.orders.filter(o => Number(o.client_id) === Number(c.id)).length;
    const shareUrl = `${window.location.origin}/intranet/ti?share=${c.share_token}`;
    return `
      <div class="ti-liquid-card rounded-2xl p-4 sm:p-5 space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="font-extrabold text-slate-900 text-base truncate">${escHtml(c.name)}</h3>
            ${c.subtitle ? `<p class="text-xs text-slate-600">${escHtml(c.subtitle)}</p>` : ''}
          </div>
          <span class="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-[11px] font-bold shrink-0">${assetCount} eq · ${orderCount} trab</span>
        </div>
        <div class="text-xs text-slate-600 space-y-1">
          ${c.ruc_dni ? `<div><strong>RUC/DNI:</strong> ${escHtml(c.ruc_dni)}</div>` : ''}
          ${c.location ? `<div><strong>Ubicación:</strong> ${escHtml(c.location)}</div>` : ''}
          ${(c.contact_name || c.phone) ? `<div><strong>Contacto:</strong> ${escHtml(c.contact_name)} ${c.phone ? `(${escHtml(c.phone)})` : ''}</div>` : ''}
        </div>
        <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="copyShareLink('${escHtml(shareUrl)}')" class="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold">🔗 Copiar enlace seguimiento</button>
          <button type="button" onclick="openClientModal(${c.id})" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">✏️ Editar</button>
          <button type="button" onclick="deleteClient(${c.id})" class="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function copyShareLink(url) {
  navigator.clipboard.writeText(url).then(() => alert('Enlace de seguimiento copiado al portapapeles.'));
}

function openClientModal(id = null) {
  const c = id ? tiState.clients.find(x => Number(x.id) === Number(id)) : null;
  document.getElementById('clientModalTitle').textContent = c ? 'Editar Cliente' : 'Nuevo Cliente';
  document.getElementById('clientIdInput').value = c ? c.id : '';
  document.getElementById('clientNameInput').value = c ? c.name : '';
  document.getElementById('clientSubtitleInput').value = c ? (c.subtitle || '') : '';
  document.getElementById('clientRucInput').value = c ? (c.ruc_dni || '') : '';
  document.getElementById('clientPhoneInput').value = c ? (c.phone || '') : '';
  document.getElementById('clientLocationInput').value = c ? (c.location || '') : '';
  document.getElementById('clientContactInput').value = c ? (c.contact_name || '') : '';
  document.getElementById('clientNotesInput').value = c ? (c.notes || '') : '';
  openModal('clientModal');
}

async function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('clientIdInput').value;
  const payload = {
    name: document.getElementById('clientNameInput').value,
    subtitle: document.getElementById('clientSubtitleInput').value,
    ruc_dni: document.getElementById('clientRucInput').value,
    phone: document.getElementById('clientPhoneInput').value,
    location: document.getElementById('clientLocationInput').value,
    contact_name: document.getElementById('clientContactInput').value,
    notes: document.getElementById('clientNotesInput').value
  };
  try {
    if (id) await apiTi(`/intranet/api/ti/clients/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiTi('/intranet/api/ti/clients', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('clientModal');
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteClient(id) {
  if (!confirm('¿Eliminar cliente y todos sus equipos, órdenes y evidencias?')) return;
  try {
    await apiTi(`/intranet/api/ti/clients/${id}`, { method: 'DELETE' });
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

// --- RENDER EQUIPOS Y REDES ---
function renderAssets() {
  const container = document.getElementById('assetsGrid');
  if (!container) return;
  const q = (document.getElementById('assetSearchInput')?.value || '').toLowerCase();
  const cFilter = document.getElementById('assetClientFilter')?.value || '';
  const catFilter = document.getElementById('assetCatFilter')?.value || '';

  const filtered = tiState.assets.filter(a => {
    if (cFilter && String(a.client_id) !== String(cFilter)) return false;
    if (catFilter && a.category !== catFilter) return false;
    if (q) {
      const hay = `${a.name} ${a.asset_code} ${a.brand_model} ${a.serial_number} ${a.network_info} ${a.area_level} ${a.client_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="col-span-full ti-liquid-card rounded-2xl p-8 text-center text-sm text-slate-500">No hay equipos o nodos de red que coincidan.</div>`;
    return;
  }

  container.innerHTML = filtered.map(a => {
    const ords = tiState.orders.filter(o => Number(o.asset_id) === Number(a.id));
    const evs = tiState.evidences.filter(ev => Number(ev.asset_id) === Number(a.id));
    const badgeColor = a.status === 'Operativo' ? 'bg-emerald-100 text-emerald-800'
      : (a.status === 'De baja' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800');
    return `
      <div class="ti-liquid-card rounded-2xl p-4 sm:p-5 space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-bold">${escHtml(a.category)}</span>
              ${a.asset_code ? `<span class="text-xs font-bold text-sky-700">${escHtml(a.asset_code)}</span>` : ''}
            </div>
            <h3 class="font-extrabold text-slate-900 text-base mt-1">${escHtml(a.name)}</h3>
            <p class="text-xs text-slate-500">${escHtml(a.client_name || '')} ${a.area_level ? `• ${escHtml(a.area_level)}` : ''}</p>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${badgeColor}">${escHtml(a.status)}</span>
        </div>
        <div class="text-xs text-slate-600 space-y-1">
          ${a.brand_model ? `<div><strong>Modelo:</strong> ${escHtml(a.brand_model)} ${a.serial_number ? `| <strong>S/N:</strong> ${escHtml(a.serial_number)}` : ''}</div>` : ''}
          ${a.network_info ? `<div class="text-sky-800 bg-sky-50 px-2.5 py-1 rounded-lg"><strong>Red/IP:</strong> ${escHtml(a.network_info)}</div>` : ''}
          ${a.specs ? `<div class="text-slate-500">${escHtml(a.specs)}</div>` : ''}
        </div>
        <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="openAssetHistory(${a.id})" class="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold">📜 Historial (${ords.length}) & Fotos (${evs.length})</button>
          ${!tiState.isPublicShare ? `
            <button type="button" onclick="openEvidenceModal(${a.client_id}, ${a.id}, null)" class="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold">📷 Adjuntar</button>
            <button type="button" onclick="openAssetModal(${a.id})" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">✏️</button>
            <button type="button" onclick="deleteAsset(${a.id})" class="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold">🗑️</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openAssetModal(id = null) {
  if (!tiState.clients.length) {
    alert('Primero registra al menos un cliente.');
    switchTiTab('clients');
    return;
  }
  const a = id ? tiState.assets.find(x => Number(x.id) === Number(id)) : null;
  document.getElementById('assetModalTitle').textContent = a ? 'Editar Equipo / Nodo de Red' : 'Registrar Equipo / Nodo de Red';
  document.getElementById('assetIdInput').value = a ? a.id : '';
  document.getElementById('assetClientInput').value = a ? a.client_id : tiState.clients[0].id;
  document.getElementById('assetCategoryInput').value = a ? a.category : 'PC';
  document.getElementById('assetNameInput').value = a ? a.name : '';
  document.getElementById('assetCodeInput').value = a ? (a.asset_code || '') : '';
  document.getElementById('assetBrandInput').value = a ? (a.brand_model || '') : '';
  document.getElementById('assetSerialInput').value = a ? (a.serial_number || '') : '';
  document.getElementById('assetAreaInput').value = a ? (a.area_level || '') : '';
  document.getElementById('assetNetworkInput').value = a ? (a.network_info || '') : '';
  document.getElementById('assetStatusInput').value = a ? a.status : 'Operativo';
  document.getElementById('assetSpecsInput').value = a ? (a.specs || '') : '';
  openModal('assetModal');
}

async function saveAsset(e) {
  e.preventDefault();
  const id = document.getElementById('assetIdInput').value;
  const payload = {
    client_id: document.getElementById('assetClientInput').value,
    category: document.getElementById('assetCategoryInput').value,
    name: document.getElementById('assetNameInput').value,
    asset_code: document.getElementById('assetCodeInput').value,
    brand_model: document.getElementById('assetBrandInput').value,
    serial_number: document.getElementById('assetSerialInput').value,
    area_level: document.getElementById('assetAreaInput').value,
    network_info: document.getElementById('assetNetworkInput').value,
    status: document.getElementById('assetStatusInput').value,
    specs: document.getElementById('assetSpecsInput').value
  };
  try {
    if (id) await apiTi(`/intranet/api/ti/assets/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiTi('/intranet/api/ti/assets', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('assetModal');
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteAsset(id) {
  if (!confirm('¿Eliminar este equipo/red y sus fotos asociadas?')) return;
  try {
    await apiTi(`/intranet/api/ti/assets/${id}`, { method: 'DELETE' });
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

function openAssetHistory(assetId) {
  const sel = document.getElementById('historyAssetSelect');
  if (sel) {
    const cf = document.getElementById('historyClientFilter');
    if (cf) cf.value = '';
    onHistoryClientChange();
    sel.value = String(assetId);
    switchTiTab('history');
    return;
  }
}

function onHistoryClientChange() {
  const cf = document.getElementById('historyClientFilter')?.value || '';
  const sel = document.getElementById('historyAssetSelect');
  if (!sel) return;
  const prev = sel.value;
  const list = tiState.assets.filter(a => !cf || String(a.client_id) === String(cf));
  sel.innerHTML = `<option value="">-- Selecciona una computadora, impresora o red --</option>` +
    list.map(a => `<option value="${a.id}">${escHtml(a.name)} (${escHtml(a.category)})${a.client_name ? ' · ' + escHtml(a.client_name) : ''}</option>`).join('');
  if (prev && list.some(a => String(a.id) === String(prev))) sel.value = prev;
  else if (list.length && !prev) sel.value = String(list[0].id);
  renderHistoryTab();
}

function openOrderForSelectedHistory() {
  const assetId = document.getElementById('historyAssetSelect')?.value;
  const a = tiState.assets.find(x => String(x.id) === String(assetId));
  openOrderModal();
  if (a) {
    document.getElementById('orderClientInput').value = a.client_id;
    refreshOrderAssetOptions(a.id);
    if (a.area_level) document.getElementById('orderAreaInput').value = a.area_level;
  }
}

function renderHistoryTab() {
  const summaryEl = document.getElementById('historyAssetSummary');
  const timelineEl = document.getElementById('historyTimelineContainer');
  if (!summaryEl || !timelineEl) return;

  const assetId = document.getElementById('historyAssetSelect')?.value;
  const a = tiState.assets.find(x => String(x.id) === String(assetId));

  if (!a) {
    summaryEl.innerHTML = `<div class="ti-liquid-card rounded-2xl p-6 text-center text-sm text-slate-600">Registra o selecciona una computadora / nodo de red para ver su historial completo de reparaciones y evidencias.</div>`;
    timelineEl.innerHTML = '';
    return;
  }

  const ords = tiState.orders.filter(o => Number(o.asset_id) === Number(a.id));
  const directEvs = tiState.evidences.filter(ev => Number(ev.asset_id) === Number(a.id) && !ev.order_id);
  const badgeColor = a.status === 'Operativo' ? 'bg-emerald-100/90 text-emerald-800'
    : (a.status === 'De baja' ? 'bg-rose-100/90 text-rose-800' : 'bg-amber-100/90 text-amber-800');

  summaryEl.innerHTML = `
    <div class="ti-liquid-card rounded-2xl p-5 space-y-3">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold">${escHtml(a.category)}</span>
            ${a.asset_code ? `<span class="px-2.5 py-0.5 rounded-lg bg-sky-100 text-sky-800 text-[11px] font-bold">${escHtml(a.asset_code)}</span>` : ''}
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${badgeColor}">${escHtml(a.status)}</span>
          </div>
          <h3 class="text-lg font-extrabold text-slate-900 mt-1.5">${escHtml(a.name)}</h3>
          <p class="text-xs text-slate-600">${escHtml(a.client_name || '')} ${a.area_level ? '• ' + escHtml(a.area_level) : ''}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${!tiState.isPublicShare ? `
            <button type="button" onclick="openEvidenceModal(${a.client_id}, ${a.id}, null)" class="px-3.5 py-2 rounded-xl bg-white/80 hover:bg-white text-indigo-700 border border-white text-xs font-bold shadow-sm">📷 Subir Foto al Equipo</button>
          ` : ''}
          <div class="px-3.5 py-2 rounded-xl bg-sky-500/15 text-sky-900 text-xs font-extrabold">${ords.length} intervenciones</div>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-slate-700">
        <div class="p-2.5 rounded-xl bg-white/55 border border-white/70"><strong>Marca / Modelo:</strong> ${escHtml(a.brand_model || '—')}</div>
        <div class="p-2.5 rounded-xl bg-white/55 border border-white/70"><strong>N.° Serie:</strong> ${escHtml(a.serial_number || '—')}</div>
        <div class="p-2.5 rounded-xl bg-white/55 border border-white/70"><strong>Red / IP:</strong> ${escHtml(a.network_info || '—')}</div>
      </div>
      ${a.specs ? `<div class="p-3 rounded-xl bg-white/55 border border-white/70 text-xs text-slate-700"><strong>Hardware / Especificaciones:</strong> ${escHtml(a.specs)}</div>` : ''}
      ${directEvs.length ? `<div><div class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-1.5">Fotos generales del equipo</div>${renderEvidenceGalleryHtml(directEvs)}</div>` : ''}
    </div>
  `;

  if (!ords.length) {
    timelineEl.innerHTML = `<div class="ti-liquid-card rounded-2xl p-6 text-center text-sm text-slate-500">Este equipo aún no tiene reparaciones ni mantenimientos en su historial.</div>`;
    return;
  }

  timelineEl.innerHTML = `<div class="ti-timeline-line space-y-4">` + ords.map(o => {
    const evs = tiState.evidences.filter(ev => Number(ev.order_id) === Number(o.id));
    return `
      <div class="relative">
        <span class="ti-timeline-dot"></span>
        <div class="ti-liquid-card rounded-2xl p-4 sm:p-5 space-y-2.5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-extrabold text-sky-700">${escHtml(o.service_date)}</span>
              <span class="px-2.5 py-0.5 rounded-full bg-sky-100/90 text-sky-800 text-[11px] font-bold">${escHtml(o.order_type)}</span>
              ${o.ref_code ? `<span class="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-bold">${escHtml(o.ref_code)}</span>` : ''}
            </div>
            <div class="flex items-center gap-2">
              ${!tiState.isPublicShare ? `<span class="text-sm font-extrabold text-emerald-700">${moneyFmt(o.subtotal)}</span>` : ''}
              <span class="px-2.5 py-0.5 rounded-full bg-white/80 text-slate-700 text-[11px] font-bold border border-white">${escHtml(o.status)}</span>
            </div>
          </div>
          <h4 class="text-base font-extrabold text-slate-900">${escHtml(o.title)}</h4>
          ${o.diagnosis ? `<div class="text-xs text-slate-700 bg-white/55 p-2.5 rounded-xl border border-white/70"><strong>Diagnóstico:</strong> ${escHtml(o.diagnosis)}</div>` : ''}
          ${o.work_done ? `<div class="text-xs text-slate-800 whitespace-pre-line pl-3 border-l-2 border-sky-400">${escHtml(o.work_done)}</div>` : ''}
          ${o.parts_used ? `<div class="text-xs text-indigo-800 font-semibold"><strong>Repuestos / Materiales:</strong> ${escHtml(o.parts_used)}</div>` : ''}
          ${evs.length ? `<div class="pt-1">${renderEvidenceGalleryHtml(evs)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

// --- RENDER ÓRDENES / TRABAJOS ---
function renderOrders() {
  const container = document.getElementById('ordersList');
  if (!container) return;
  const q = (document.getElementById('orderSearchInput')?.value || '').toLowerCase();
  const cFilter = document.getElementById('orderClientFilter')?.value || '';
  const tFilter = document.getElementById('orderTypeFilter')?.value || '';

  const filtered = tiState.orders.filter(o => {
    if (cFilter && String(o.client_id) !== String(cFilter)) return false;
    if (tFilter && o.order_type !== tFilter) return false;
    if (q) {
      const hay = `${o.title} ${o.ref_code} ${o.act_code} ${o.diagnosis} ${o.work_done} ${o.parts_used} ${o.client_name} ${o.asset_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="ti-liquid-card rounded-2xl p-8 text-center text-sm text-slate-500">No hay trabajos o servicios registrados todavía.</div>`;
    return;
  }

  container.innerHTML = filtered.map(o => {
    const evs = tiState.evidences.filter(ev => Number(ev.order_id) === Number(o.id));
    return `
      <div class="ti-liquid-card rounded-2xl p-4 sm:p-5 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
          <div class="space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-bold">${escHtml(o.order_type)}</span>
              ${o.ref_code ? `<span class="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-bold">${escHtml(o.ref_code)}</span>` : ''}
              ${o.act_code ? `<span class="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-bold">${escHtml(o.act_code)}</span>` : ''}
              <span class="text-xs text-slate-500">${escHtml(o.service_date)}</span>
            </div>
            <h3 class="text-base font-extrabold text-slate-900">${escHtml(o.title)}</h3>
            <p class="text-xs text-slate-600">
              <strong>${escHtml(o.client_name || '')}</strong>
              ${o.area_level ? ` • ${escHtml(o.area_level)}` : ''}
              ${o.asset_name ? ` • Equipo/Red: <span class="text-sky-700 font-semibold">${escHtml(o.asset_name)}</span>` : ''}
            </p>
          </div>
          <div class="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
            ${!tiState.isPublicShare ? `<div class="text-base font-extrabold text-emerald-700">${moneyFmt(o.subtotal)}</div>` : ''}
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${o.status === 'Facturado' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">${escHtml(o.status)}</span>
          </div>
        </div>

        ${o.diagnosis ? `<div class="text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl"><strong>Diagnóstico / Alcance:</strong> ${escHtml(o.diagnosis)}</div>` : ''}
        ${o.work_done ? `<div class="text-xs text-slate-700 whitespace-pre-line pl-2 border-l-2 border-sky-400">${escHtml(o.work_done)}</div>` : ''}
        ${o.parts_used ? `<div class="text-xs text-indigo-700"><strong>Repuestos / Materiales:</strong> ${escHtml(o.parts_used)}</div>` : ''}

        ${evs.length ? `<div class="pt-2">${renderEvidenceGalleryHtml(evs)}</div>` : ''}

        ${!tiState.isPublicShare ? `
          <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="openEvidenceModal(${o.client_id}, ${o.asset_id || 'null'}, ${o.id})" class="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold">📷 Subir Fotos / PDF</button>
            <button type="button" onclick="openOrderModal(${o.id})" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">✏️ Editar</button>
            <button type="button" onclick="deleteOrder(${o.id})" class="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold">🗑️</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function renderEvidenceGalleryHtml(evs) {
  if (!evs.length) return `<p class="text-xs text-slate-400">Sin fotos ni documentos adjuntos.</p>`;
  return `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">` + evs.map(ev => {
    const url = evidenceFileUrl(ev.id);
    if (ev.file_type === 'pdf') {
      return `
        <div class="relative border border-slate-200 rounded-xl p-2.5 bg-slate-50 flex flex-col justify-between gap-1">
          <a href="${url}" target="_blank" class="text-xs font-bold text-sky-700 hover:underline truncate">📄 ${escHtml(ev.original_name)}</a>
          <span class="text-[10px] text-slate-500">${escHtml(ev.stage)}</span>
          ${!tiState.isPublicShare ? `<button type="button" onclick="deleteEvidence(${ev.id})" class="self-end text-[10px] text-rose-600 font-bold">Eliminar</button>` : ''}
        </div>
      `;
    }
    return `
      <div class="relative group border border-slate-200 rounded-xl overflow-hidden bg-slate-100">
        <img src="${url}" alt="${escHtml(ev.caption || ev.original_name)}" onclick="openLightbox('${url}')" class="w-full h-24 object-cover cursor-pointer">
        <div class="p-1.5 bg-white/95 text-[10px] flex items-center justify-between gap-1">
          <span class="font-bold text-slate-700 truncate">${escHtml(ev.stage)}${ev.caption ? ': ' + escHtml(ev.caption) : ''}</span>
          ${!tiState.isPublicShare ? `<button type="button" onclick="deleteEvidence(${ev.id})" class="text-rose-600 font-bold shrink-0">✕</button>` : ''}
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

function openLightbox(url) {
  document.getElementById('lightboxImg').src = url;
  openModal('imageLightboxModal');
}

function refreshOrderAssetOptions(selectedAssetId = '') {
  const cid = document.getElementById('orderClientInput').value;
  const sel = document.getElementById('orderAssetInput');
  const assets = tiState.assets.filter(a => String(a.client_id) === String(cid));
  sel.innerHTML = `<option value="">-- Proyecto general / Sin equipo específico --</option>` +
    assets.map(a => `<option value="${a.id}">${escHtml(a.name)} (${escHtml(a.category)})</option>`).join('');
  if (selectedAssetId) sel.value = String(selectedAssetId);
}

function openOrderModal(id = null) {
  if (!tiState.clients.length) {
    alert('Primero registra un cliente.');
    switchTiTab('clients');
    return;
  }
  const o = id ? tiState.orders.find(x => Number(x.id) === Number(id)) : null;
  document.getElementById('orderModalTitle').textContent = o ? 'Editar Trabajo / Servicio' : 'Nuevo Trabajo / Servicio';
  document.getElementById('orderIdInput').value = o ? o.id : '';
  document.getElementById('orderClientInput').value = o ? o.client_id : tiState.clients[0].id;
  refreshOrderAssetOptions(o ? (o.asset_id || '') : '');
  document.getElementById('orderTypeInput').value = o ? o.order_type : 'Reparación';
  document.getElementById('orderRefInput').value = o ? (o.ref_code || '') : '';
  document.getElementById('orderActInput').value = o ? (o.act_code || '') : '';
  document.getElementById('orderDateInput').value = o ? o.service_date : new Date().toISOString().slice(0, 10);
  document.getElementById('orderTitleInput').value = o ? o.title : '';
  document.getElementById('orderAreaInput').value = o ? (o.area_level || '') : '';
  document.getElementById('orderDiagInput').value = o ? (o.diagnosis || '') : '';
  document.getElementById('orderWorkInput').value = o ? (o.work_done || '') : '';
  document.getElementById('orderPartsInput').value = o ? (o.parts_used || '') : '';
  document.getElementById('orderSubtotalInput').value = o ? Number(o.subtotal || 0) : 0;
  document.getElementById('orderStatusInput').value = o ? o.status : 'Completado';
  openModal('orderModal');
}

async function saveOrder(e) {
  e.preventDefault();
  const id = document.getElementById('orderIdInput').value;
  const payload = {
    client_id: document.getElementById('orderClientInput').value,
    asset_id: document.getElementById('orderAssetInput').value || null,
    order_type: document.getElementById('orderTypeInput').value,
    ref_code: document.getElementById('orderRefInput').value,
    act_code: document.getElementById('orderActInput').value,
    service_date: document.getElementById('orderDateInput').value,
    title: document.getElementById('orderTitleInput').value,
    area_level: document.getElementById('orderAreaInput').value,
    diagnosis: document.getElementById('orderDiagInput').value,
    work_done: document.getElementById('orderWorkInput').value,
    parts_used: document.getElementById('orderPartsInput').value,
    subtotal: Number(document.getElementById('orderSubtotalInput').value || 0),
    status: document.getElementById('orderStatusInput').value
  };
  try {
    if (id) await apiTi(`/intranet/api/ti/orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiTi('/intranet/api/ti/orders', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('orderModal');
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteOrder(id) {
  if (!confirm('¿Eliminar este trabajo y sus evidencias?')) return;
  try {
    await apiTi(`/intranet/api/ti/orders/${id}`, { method: 'DELETE' });
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

function openEvidenceModal(clientId, assetId, orderId) {
  document.getElementById('evClientId').value = clientId;
  document.getElementById('evAssetId').value = assetId || '';
  document.getElementById('evOrderId').value = orderId || '';
  document.getElementById('evCaptionInput').value = '';
  document.getElementById('evFilesInput').value = '';
  openModal('evidenceModal');
}

async function uploadEvidences(e) {
  e.preventDefault();
  const files = document.getElementById('evFilesInput').files;
  if (!files.length) return;
  const fd = new FormData();
  fd.append('client_id', document.getElementById('evClientId').value);
  if (document.getElementById('evAssetId').value) fd.append('asset_id', document.getElementById('evAssetId').value);
  if (document.getElementById('evOrderId').value) fd.append('order_id', document.getElementById('evOrderId').value);
  fd.append('stage', document.getElementById('evStageInput').value);
  fd.append('caption', document.getElementById('evCaptionInput').value);
  for (const f of files) fd.append('files', f);

  try {
    await apiTi('/intranet/api/ti/evidences', { method: 'POST', body: fd });
    closeModal('evidenceModal');
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteEvidence(id) {
  if (!confirm('¿Eliminar esta evidencia?')) return;
  try {
    await apiTi(`/intranet/api/ti/evidences/${id}`, { method: 'DELETE' });
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

// --- FACTURACIÓN / RECIBOS ---
function renderInvoices() {
  const container = document.getElementById('invoicesList');
  if (!container) return;
  if (!tiState.invoices.length) {
    container.innerHTML = `<div class="ti-liquid-card rounded-2xl p-8 text-center text-sm text-slate-500">Aún no has emitido recibos ni cotizaciones.</div>`;
    return;
  }
  container.innerHTML = tiState.invoices.map(inv => `
    <div class="ti-liquid-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="px-2.5 py-0.5 rounded-md bg-slate-900 text-white text-xs font-bold">${escHtml(inv.doc_number)}</span>
          <span class="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-bold">${escHtml(inv.doc_type)}</span>
          <span class="text-xs text-slate-500">${escHtml(inv.issue_date)}</span>
        </div>
        <h3 class="text-base font-extrabold text-slate-900">${escHtml(inv.client_name)}</h3>
        <p class="text-xs text-slate-600">${escHtml(inv.general_concept)}</p>
      </div>
      <div class="flex flex-col sm:items-end gap-2">
        <div class="text-lg font-extrabold text-emerald-700">${moneyFmt(inv.total_amount)}</div>
        <div class="flex flex-wrap gap-2">
          <button type="button" onclick="previewInvoice(${inv.id})" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold">🖨️ Ver / PDF</button>
          <button type="button" onclick="openInvoiceModal(${inv.id})" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">✏️ Editar</button>
          <button type="button" onclick="deleteInvoice(${inv.id})" class="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');
}

function formatLongSpanishDate(dateObj = new Date()) {
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${dateObj.getDate()} de ${meses[dateObj.getMonth()]} de ${dateObj.getFullYear()}`;
}

function suggestInvNumber() {
  if (document.getElementById('invIdInput').value) return;
  const type = document.getElementById('invDocTypeInput').value;
  if (type.includes('COTIZACIÓN')) document.getElementById('invDocNumberInput').value = tiState.nextNumbers.EST;
  else if (type.includes('ACTA')) document.getElementById('invDocNumberInput').value = tiState.nextNumbers.EST.replace('EST', 'ACT');
  else document.getElementById('invDocNumberInput').value = tiState.nextNumbers.REC;
}

function fillInvoiceClient() {
  const cid = document.getElementById('invClientSelect').value;
  const c = tiState.clients.find(x => String(x.id) === String(cid));
  if (!c) return;
  document.getElementById('invClientNameInput').value = c.name;
  document.getElementById('invClientSubInput').value = c.subtitle || '';
  document.getElementById('invClientLocInput').value = c.location || '';
}

function importClientOrdersToInvoice() {
  const cid = document.getElementById('invClientSelect').value;
  if (!cid) {
    alert('Primero selecciona un cliente de la lista.');
    return;
  }
  const orders = tiState.orders.filter(o => String(o.client_id) === String(cid) && o.status !== 'Facturado');
  if (!orders.length) {
    alert('Este cliente no tiene trabajos pendientes de facturar.');
    return;
  }
  tiState.invoiceItems = orders.map((o, idx) => ({
    item_no: String(idx + 1).padStart(2, '0'),
    ref_cotiz: o.ref_code || '',
    ref_act: o.act_code || '',
    area_level: o.area_level || o.order_type,
    title: o.title,
    bullets: o.work_done || o.diagnosis || '',
    subtotal: Number(o.subtotal || 0),
    order_id: o.id
  }));
  const actas = orders.map(o => o.act_code).filter(Boolean).join(', ');
  if (actas) document.getElementById('invActasInput').value = actas;
  renderInvoiceItemRows();
}

function openInvoiceModal(id = null) {
  const inv = id ? tiState.invoices.find(x => Number(x.id) === Number(id)) : null;
  document.getElementById('invoiceModalTitle').textContent = inv ? `Editar ${inv.doc_number}` : 'Nuevo Recibo / Comprobante DC CORP';
  document.getElementById('invIdInput').value = inv ? inv.id : '';
  document.getElementById('invDocTypeInput').value = inv ? inv.doc_type : 'RECIBO DE CAJA / EGRESO';
  document.getElementById('invDocNumberInput').value = inv ? inv.doc_number : tiState.nextNumbers.REC;
  document.getElementById('invDateInput').value = inv ? inv.issue_date : formatLongSpanishDate();
  document.getElementById('invStatusInput').value = inv ? inv.status : 'Emitido';
  document.getElementById('invClientSelect').value = inv && inv.client_id ? String(inv.client_id) : '';
  document.getElementById('invClientNameInput').value = inv ? inv.client_name : '';
  document.getElementById('invClientSubInput').value = inv ? (inv.client_subtitle || '') : '';
  document.getElementById('invClientLocInput').value = inv ? (inv.client_location || '') : '';
  document.getElementById('invConceptInput').value = inv ? inv.general_concept : 'Liquidación General de Servicios TI & Redes';
  document.getElementById('invActasInput').value = inv ? (inv.actas_ref || '') : '';
  document.getElementById('invPayMethodInput').value = inv ? (inv.payment_method || '') : 'Pago al contado / Transferencia contra entrega de conformidad.';
  if (inv && inv.warranty_text) document.getElementById('invWarrantyInput').value = inv.warranty_text;
  if (inv && inv.conformity_text) document.getElementById('invConformityInput').value = inv.conformity_text;

  try {
    tiState.invoiceItems = inv ? JSON.parse(inv.items_json || '[]') : [];
  } catch {
    tiState.invoiceItems = [];
  }
  if (!tiState.invoiceItems.length) {
    tiState.invoiceItems = [{ item_no: '01', ref_cotiz: '', ref_act: '', area_level: '', title: '', bullets: '', subtotal: 0, order_id: null }];
  }
  renderInvoiceItemRows();
  openModal('invoiceModal');
}

function addInvoiceItemRow() {
  const nextNo = String(tiState.invoiceItems.length + 1).padStart(2, '0');
  tiState.invoiceItems.push({ item_no: nextNo, ref_cotiz: '', ref_act: '', area_level: '', title: '', bullets: '', subtotal: 0, order_id: null });
  renderInvoiceItemRows();
}

function removeInvoiceItemRow(idx) {
  tiState.invoiceItems.splice(idx, 1);
  renderInvoiceItemRows();
}

function syncInvoiceItemField(idx, field, value) {
  if (!tiState.invoiceItems[idx]) return;
  tiState.invoiceItems[idx][field] = field === 'subtotal' ? Number(value || 0) : value;
  updateInvoiceTotalDisplay();
}

function updateInvoiceTotalDisplay() {
  const total = tiState.invoiceItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
  document.getElementById('invTotalDisplay').textContent = moneyFmt(total);
  document.getElementById('invWordsInput').value = numeroALetras(total);
}

function renderInvoiceItemRows() {
  const container = document.getElementById('invItemsContainer');
  container.innerHTML = tiState.invoiceItems.map((it, idx) => `
    <div class="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
      <div class="grid grid-cols-2 sm:grid-cols-6 gap-2">
        <input value="${escHtml(it.item_no)}" oninput="syncInvoiceItemField(${idx}, 'item_no', this.value)" placeholder="01" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold">
        <input value="${escHtml(it.ref_cotiz || '')}" oninput="syncInvoiceItemField(${idx}, 'ref_cotiz', this.value)" placeholder="EST0006" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs">
        <input value="${escHtml(it.ref_act || '')}" oninput="syncInvoiceItemField(${idx}, 'ref_act', this.value)" placeholder="ACT0006" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs">
        <input value="${escHtml(it.area_level || '')}" oninput="syncInvoiceItemField(${idx}, 'area_level', this.value)" placeholder="Área / Nivel" class="sm:col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs">
        <div class="flex gap-1">
          <input type="number" step="0.01" min="0" value="${Number(it.subtotal || 0)}" oninput="syncInvoiceItemField(${idx}, 'subtotal', this.value)" placeholder="Subtotal" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold">
          <button type="button" onclick="removeInvoiceItemRow(${idx})" class="px-2 rounded-lg bg-rose-100 text-rose-700 text-xs font-bold">✕</button>
        </div>
      </div>
      <input value="${escHtml(it.title || '')}" oninput="syncInvoiceItemField(${idx}, 'title', this.value)" placeholder="Título resumido del servicio..." class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold">
      <textarea rows="2" oninput="syncInvoiceItemField(${idx}, 'bullets', this.value)" placeholder="• Detalle de trabajos y suministros..." class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs">${escHtml(it.bullets || '')}</textarea>
    </div>
  `).join('');
  updateInvoiceTotalDisplay();
}

async function saveInvoice(e) {
  e.preventDefault();
  const id = document.getElementById('invIdInput').value;
  const total = tiState.invoiceItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
  const payload = {
    doc_type: document.getElementById('invDocTypeInput').value,
    doc_number: document.getElementById('invDocNumberInput').value,
    issue_date: document.getElementById('invDateInput').value,
    status: document.getElementById('invStatusInput').value,
    client_id: document.getElementById('invClientSelect').value || null,
    client_name: document.getElementById('invClientNameInput').value,
    client_subtitle: document.getElementById('invClientSubInput').value,
    client_location: document.getElementById('invClientLocInput').value,
    general_concept: document.getElementById('invConceptInput').value,
    actas_ref: document.getElementById('invActasInput').value,
    items: tiState.invoiceItems,
    total_amount: total,
    amount_words: document.getElementById('invWordsInput').value || numeroALetras(total),
    payment_method: document.getElementById('invPayMethodInput').value,
    warranty_text: document.getElementById('invWarrantyInput').value,
    conformity_text: document.getElementById('invConformityInput').value
  };
  try {
    const saved = id
      ? await apiTi(`/intranet/api/ti/invoices/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await apiTi('/intranet/api/ti/invoices', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('invoiceModal');
    await loadTiOverview();
    previewInvoice(saved.id);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteInvoice(id) {
  if (!confirm('¿Eliminar este comprobante?')) return;
  try {
    await apiTi(`/intranet/api/ti/invoices/${id}`, { method: 'DELETE' });
    await loadTiOverview();
  } catch (err) {
    alert(err.message);
  }
}

function previewInvoice(id) {
  const inv = tiState.invoices.find(x => Number(x.id) === Number(id));
  if (!inv) return;
  let items = [];
  try { items = JSON.parse(inv.items_json || '[]'); } catch {}

  const rowsHtml = items.map(it => {
    const bulletsHtml = String(it.bullets || '').split('\n').filter(Boolean).map(line => `<div>${escHtml(line)}</div>`).join('');
    return `
      <tr>
        <td style="font-weight:700;">${escHtml(it.item_no || '')}</td>
        <td>
          <div style="font-weight:700;">${escHtml(it.ref_cotiz || '')}</div>
          ${it.ref_act ? `<div style="color:#0284c7;font-weight:700;font-size:9.5px;">${escHtml(it.ref_act)}</div>` : ''}
        </td>
        <td style="font-weight:600;">${escHtml(it.area_level || '')}</td>
        <td>
          <div style="font-weight:700;margin-bottom:2px;">${escHtml(it.title || '')}</div>
          <div style="color:#334155;font-size:10px;line-height:1.38;">${bulletsHtml}</div>
        </td>
        <td>${moneyFmt(it.subtotal)}</td>
      </tr>
    `;
  }).join('');

  const summaryRows = items.map(it => `
    <div style="display:flex;justify-content:space-between;padding:4px 12px;font-size:10.5px;border-bottom:1px solid #e2e8f0;">
      <span>${escHtml(it.area_level || it.title)} ${it.ref_cotiz ? `(${escHtml(it.ref_cotiz)})` : ''}:</span>
      <strong>${moneyFmt(it.subtotal)}</strong>
    </div>
  `).join('');

  const warrantyHtml = String(inv.warranty_text || '').split('\n').filter(Boolean).map(l => `<div>${escHtml(l)}</div>`).join('');

  document.getElementById('invoicePreviewInner').innerHTML = `
    <div class="ti-sheet">
      <div class="ti-sheet-header">
        <div class="ti-sheet-brand">
          <img src="/favicon.svg" alt="DC CORP" style="width:46px;height:46px;border-radius:11px;flex-shrink:0;">
          <div>
            <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;color:#0f172a;">DC CORP</div>
            <div style="font-size:9.5px;font-weight:700;color:#0284c7;text-transform:uppercase;">SERVICIOS TECNOLÓGICOS &amp; INFRAESTRUCTURA DE REDES</div>
            <div style="font-size:10px;color:#334155;margin-top:2px;"><strong>RUC:</strong> 10609599346 &nbsp;|&nbsp; <strong>Contacto:</strong> 992507489</div>
            <div style="font-size:10px;color:#334155;"><strong>Titular:</strong> Víctor Samuel Castro Delgado</div>
          </div>
        </div>
        <div class="ti-sheet-docbox">
          <div style="font-size:10.5px;font-weight:800;color:#0f172a;">${escHtml(inv.doc_type)}</div>
          <div style="font-size:14px;font-weight:800;color:#0284c7;margin:2px 0;">N.° ${escHtml(inv.doc_number)}</div>
          <div style="font-size:9.5px;color:#334155;"><strong>Fecha:</strong> ${escHtml(inv.issue_date)}</div>
          <div style="font-size:9.5px;color:#334155;"><strong>Moneda:</strong> ${escHtml(inv.currency || 'Soles Peruanos (S/)')}</div>
        </div>
      </div>

      <div class="ti-sheet-grid2">
        <div class="ti-sheet-card">
          <div style="font-size:9px;font-weight:800;color:#64748b;text-transform:uppercase;">ENTIDAD PAGADORA / SOLICITANTE</div>
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:2px;">${escHtml(inv.client_name)}</div>
          ${inv.client_subtitle ? `<div style="font-size:10px;color:#475569;">${escHtml(inv.client_subtitle)}</div>` : ''}
          ${inv.client_location ? `<div style="font-size:10px;color:#334155;margin-top:3px;"><strong>Ubicación:</strong> ${escHtml(inv.client_location)}</div>` : ''}
        </div>
        <div class="ti-sheet-card">
          <div style="font-size:9px;font-weight:800;color:#64748b;text-transform:uppercase;">CONCEPTO GENERAL DE LA LIQUIDACIÓN</div>
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:2px;">${escHtml(inv.general_concept)}</div>
          ${inv.actas_ref ? `<div style="font-size:10px;font-weight:700;color:#0284c7;margin-top:4px;">Respaldado con Actas de Conformidad (${escHtml(inv.actas_ref)})</div>` : ''}
        </div>
      </div>

      <div class="ti-sheet-section-title">DETALLE DE COTIZACIONES Y SERVICIOS EJECUTADOS</div>
      <table class="ti-sheet-table">
        <thead>
          <tr>
            <th style="width:40px;">ÍTEM</th>
            <th style="width:74px;">REF. COTIZ.</th>
            <th style="width:105px;">ÁREA / NIVEL</th>
            <th>DESCRIPCIÓN RESUMIDA DE LOS TRABAJOS Y SUMINISTROS</th>
            <th style="width:86px;">SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="ti-sheet-grid2" style="margin-top:14px;">
        <div style="space-y:8px;">
          <div class="ti-sheet-card">
            <div style="font-size:10.5px;font-weight:800;color:#0f172a;">SON: ${escHtml(inv.amount_words || numeroALetras(inv.total_amount))} (${moneyFmt(inv.total_amount)}).</div>
            <div style="font-size:10px;color:#334155;margin-top:4px;"><strong>Forma de Cancelación:</strong> ${escHtml(inv.payment_method || '')}</div>
          </div>
          ${warrantyHtml ? `
            <div style="margin-top:8px;font-size:10px;color:#334155;padding:4px 6px;">
              <div style="font-weight:800;color:#0f172a;margin-bottom:2px;">Respaldo de Garantía Técnica:</div>
              ${warrantyHtml}
            </div>
          ` : ''}
        </div>
        <div class="ti-sheet-summary-box">
          ${summaryRows}
          <div class="ti-sheet-total-bar">
            <span>TOTAL A PAGAR:</span>
            <span>${moneyFmt(inv.total_amount)}</span>
          </div>
        </div>
      </div>

      ${inv.conformity_text ? `
        <div class="ti-sheet-conformity">
          <strong>CONSTANCIA DE DESEMBOLSO Y CONFORMIDAD INSTITUCIONAL:</strong> ${escHtml(inv.conformity_text)}
        </div>
      ` : ''}

      <div class="ti-sheet-signatures ti-print-break">
        <div class="ti-sheet-sign-card">
          <div>
            <div style="font-size:9.5px;font-weight:800;color:#0f172a;">POR DC CORP (RECIBÍ CONFORME)</div>
            <div style="font-size:9.5px;color:#334155;margin-top:4px;"><strong>Nombre:</strong> Víctor Samuel Castro Delgado</div>
            <div style="font-size:9.5px;color:#334155;"><strong>RUC:</strong> 10609599346</div>
            <div style="font-size:9.5px;color:#334155;"><strong>Tel:</strong> 992507489</div>
          </div>
          <div style="border-top:1px dashed #94a3b8;padding-top:4px;text-align:center;font-size:9px;color:#64748b;">Firma y Sello del Proveedor Técnico</div>
        </div>
        <div class="ti-sheet-sign-card">
          <div>
            <div style="font-size:9.5px;font-weight:800;color:#0f172a;">${escHtml(inv.sign_client_title || 'POR CLIENTE / ENTIDAD (ENTREGUÉ CONFORME)')}</div>
            <div style="font-size:9.5px;color:#334155;margin-top:6px;">Nombres: ....................................</div>
            <div style="font-size:9.5px;color:#334155;margin-top:4px;">DNI: .........................................</div>
          </div>
          <div style="border-top:1px dashed #94a3b8;padding-top:4px;text-align:center;font-size:9px;color:#64748b;">Firma y Sello Cliente / Directiva</div>
        </div>
        <div class="ti-sheet-sign-card">
          <div>
            <div style="font-size:9.5px;font-weight:800;color:#0f172a;">${escHtml(inv.sign_vb_title || 'V.° B.° DIRECCIÓN / CONFORMIDAD')}</div>
            <div style="font-size:9.5px;color:#334155;margin-top:6px;">Responsable: ................................</div>
            <div style="font-size:9.5px;color:#334155;margin-top:4px;">DNI: .........................................</div>
          </div>
          <div style="border-top:1px dashed #94a3b8;padding-top:4px;text-align:center;font-size:9px;color:#64748b;">Visto Bueno / Sello Institucional</div>
        </div>
      </div>
    </div>
  `;
  openModal('invoicePreviewModal');
}

document.addEventListener('DOMContentLoaded', initTiPortal);
