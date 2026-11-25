const token = localStorage.getItem('dc_token');
const role = localStorage.getItem('dc_role');
if (!token || (role !== 'admin' && role !== 'teacher')) {
  window.location.href = '/intranet';
}
const isAdmin = role === 'admin';
const currentUserName = localStorage.getItem('dc_name') || 'Usuario';
document.getElementById('userName').innerText = currentUserName;
const sidebarUserEl = document.getElementById('sidebarUserName');
if (sidebarUserEl) sidebarUserEl.innerText = currentUserName;

const dateEl = document.getElementById('adminCurrentDate');
if (dateEl) {
  const formatted = new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  dateEl.innerText = formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

const badge = document.getElementById('roleBadge');
const mobileBadge = document.getElementById('mobileRoleBadge');
if (isAdmin) {
  badge.innerText = 'Administrador';
  if (mobileBadge) mobileBadge.innerText = 'Admin';
} else {
  badge.innerText = 'Profesor • Sol Music';
  badge.className = 'px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/25 text-[11px] font-semibold';
  if (mobileBadge) {
    mobileBadge.innerText = 'Profesor';
    mobileBadge.className = 'px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-semibold truncate';
  }
  document.querySelectorAll('.admin-only-tab').forEach(el => {
    el.classList.add('hidden', 'is-hidden-role');
    el.style.display = 'none';
  });
  const mGrid = document.getElementById('mobileAdminNavGrid'); if (mGrid) mGrid.className = 'relative grid grid-cols-5 h-16 max-w-lg mx-auto p-1.5';
  const annCatWrap = document.getElementById('annCategoryWrapper'); if (annCatWrap) annCatWrap.classList.add('hidden');
  document.getElementById('groupCategoryWrapper').classList.add('hidden');
  document.getElementById('adminCategoryFilter').classList.add('hidden');
  const attCatFilter = document.getElementById('attCategoryFilter'); if (attCatFilter) attCatFilter.classList.add('hidden');
  document.getElementById('groupCardTitle').innerText = '1. Crear Subgrupo en Sol Music';
  document.getElementById('groupCardSubtitle').innerText = 'Define nombre, horario y descripción de tu aula.';
  document.getElementById('btnCreateGroup').innerText = '+ Crear Subgrupo Sol Music';
  document.getElementById('btnCreateGroup').className = 'w-full py-2.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition';
  document.getElementById('directoryTitle').innerText = 'Alumnado Sol Music';
}

const authHeaders = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

function logout() {
  localStorage.clear();
  window.location.href = '/intranet';
}

function openPassModal() {
  document.getElementById('passModal').classList.remove('hidden');
}

async function changeAdminPassword() {
  const newPassword = document.getElementById('newAdminPass').value;
  const res = await fetch('/intranet/api/change-password', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ newPassword })
  });
  if (res.ok) {
    alert('Contraseña actualizada correctamente');
    document.getElementById('passModal').classList.add('hidden');
  } else {
    alert('Error: verifica que tenga al menos 6 caracteres');
  }
}

let activeAdminTab = 'asistencia';
let isApplyingAdminRoute = false;

function buildAdminHash() {
  if (activeAdminTab === 'asistencia' && selectedAttGroupId) {
    return `#asistencia/aula/${selectedAttGroupId}`;
  }
  if (activeAdminTab === 'materiales' && selectedClassroomCardId) {
    return `#materiales/aula/${selectedClassroomCardId}`;
  }
  return `#${activeAdminTab}`;
}

function syncAdminUrl(push = true) {
  if (isApplyingAdminRoute) return;
  const targetHash = buildAdminHash();
  if (window.location.hash !== targetHash) {
    const state = { tab: activeAdminTab, attGroupId: selectedAttGroupId, classGroupId: selectedClassroomCardId };
    if (push) history.pushState(state, '', targetHash);
    else history.replaceState(state, '', targetHash);
  }
}

function applyAdminRouteFromHash(hashStr) {
  const clean = (hashStr || '').replace(/^#/, '');
  const parts = clean.split('/').filter(Boolean);
  const validTabs = ['asistencia', 'materiales', 'entregas', 'alumnos', 'avisos', 'profesores', 'mensajes'];
  let tab = validTabs.includes(parts[0]) ? parts[0] : 'asistencia';
  if (!isAdmin && tab === 'profesores') tab = 'asistencia';
  const aulaId = (parts[1] === 'aula' && parts[2]) ? Number(parts[2]) : null;

  isApplyingAdminRoute = true;
  try {
    switchTab(tab, false);
    if (tab === 'asistencia') {
      selectAttendanceGroupCard(aulaId, false);
    } else if (tab === 'materiales') {
      selectClassroomCard(aulaId, false);
    }
  } finally {
    isApplyingAdminRoute = false;
  }
}

window.addEventListener('popstate', () => {
  applyAdminRouteFromHash(window.location.hash);
});

function updateSegmentedPill(containerId, activeBtnId, pillSelector = '.segmented-pill') {
  const container = document.getElementById(containerId);
  const activeBtn = document.getElementById(activeBtnId);
  if (!container || !activeBtn || container.classList.contains('hidden')) return;
  const pill = container.querySelector(pillSelector);
  if (!pill || !activeBtn.offsetWidth) return;
  pill.style.width = `${activeBtn.offsetWidth}px`;
  pill.style.transform = `translate3d(${activeBtn.offsetLeft}px, 0, 0)`;
}

function switchTab(tab, pushHistory = true) {
  if (!isAdmin && tab === 'profesores') return;
  activeAdminTab = tab;
  if (tab === 'mensajes' && typeof refreshCurrentMessagesMode === 'function') {
    refreshCurrentMessagesMode();
  }
  if (tab === 'entregas' && typeof renderGlobalSubmissionsPanel === 'function') {
    renderGlobalSubmissionsPanel();
  }
  if (tab === 'materiales') {
    document.getElementById('unreadChatDot').classList.add('hidden');
    const mDot = document.getElementById('mobileUnreadDot');
    if (mDot) mDot.classList.add('hidden');
  }
  ['asistencia', 'materiales', 'entregas', 'alumnos', 'avisos', 'profesores', 'mensajes'].forEach(t => {
    const panel = document.getElementById(`panel-${t}`);
    if (panel) {
      if (t === tab) {
        panel.classList.remove('hidden', 'section-enter');
        void panel.offsetWidth;
        panel.classList.add('section-enter');
        requestAnimationFrame(() => {
          if (t === 'asistencia') updateSegmentedPill('attCategoryFilter', `att-cat-${attCategoryFilter}`);
          if (t === 'alumnos') updateSegmentedPill('adminCategoryFilter', `cat-${currentCategoryFilter}`);
        });
      } else {
        panel.classList.add('hidden');
        panel.classList.remove('section-enter');
      }
    }
    const btn = document.getElementById(`tab-${t}`);
    if (btn && !btn.classList.contains('hidden')) {
      btn.className = (t === tab)
        ? "tab-btn sidebar-item sidebar-item-active w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left"
        : "tab-btn sidebar-item w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left";
    }
    const mbtn = document.getElementById(`mtab-${t}`);
    if (mbtn && !mbtn.classList.contains('hidden')) {
      mbtn.className = (t === tab)
        ? "mtab-btn dock-btn flex flex-col items-center justify-center gap-0.5 text-white font-bold text-[10px] relative"
        : "mtab-btn dock-btn flex flex-col items-center justify-center gap-0.5 text-[#64748b] font-medium text-[10px] relative";
    }
  });
  updateSegmentedPill('mobileAdminNavGrid', `mtab-${tab}`, '.dock-pill');
  syncAdminUrl(pushHistory);
  const mainEl = document.querySelector('main');
  if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'auto' });
  if (window.innerWidth < 768) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function openPdfModal(fileUrl, title) {
  document.getElementById('pdfModalTitle').innerText = title || 'Documento PDF';
  document.getElementById('pdfFrame').src = fileUrl;
  document.getElementById('pdfDownloadLink').href = fileUrl;
  document.getElementById('pdfViewerModal').classList.remove('hidden');
}

function closePdfModal() {
  document.getElementById('pdfViewerModal').classList.add('hidden');
  document.getElementById('pdfFrame').src = '';
}

const INSTRUMENT_OPTIONS = [
  'General (Canción completa)',
  '1ra Guitarra',
  '2da Guitarra',
  'Bajo',
  'Piano / Teclado',
  'Batería / Percusión',
  'Cantante / Voz',
  'Cuerdas / Violín / Cello',
  'Vientos / Saxofón',
  'Flauta',
  'Guía de Práctica'
];

const CLASSROOM_LABEL_OPTIONS = [
  'Actividad / Tarea (PDF)',
  'Hoja de Reforzamiento',
  'Guía Teórica / Separata',
  'Ficha de Práctica'
];

function getActiveLabelOptions() {
  const fmt = document.getElementById('matFormatSelect')?.value || 'music';
  return fmt === 'classroom'
    ? [...CLASSROOM_LABEL_OPTIONS, ...INSTRUMENT_OPTIONS]
    : [...INSTRUMENT_OPTIONS, ...CLASSROOM_LABEL_OPTIONS];
}

function renderMaterialGroupChecklist(preselectIds = null) {
  const container = document.getElementById('matGroupChecklist');
  if (!container) return;
  const allowedGroups = isAdmin ? groupsCache : groupsCache.filter(g => g.category === 'Sol Music');
  if (!allowedGroups.length) {
    container.innerHTML = '<p class="col-span-full text-[11px] text-[#6e6e73] py-2">Crea primero un subgrupo para publicar material.</p>';
    onMatGroupSelectChange();
    return;
  }

  const currentlyChecked = preselectIds !== null
    ? new Set(preselectIds.map(String))
    : new Set(Array.from(document.querySelectorAll('input[name="matGroupCheck"]:checked')).map(cb => String(cb.value)));

  if (!currentlyChecked.size && selectedClassroomCardId) {
    currentlyChecked.add(String(selectedClassroomCardId));
  } else if (!currentlyChecked.size && allowedGroups[0]) {
    currentlyChecked.add(String(allowedGroups[0].id));
  }

  container.innerHTML = allowedGroups.map(g => {
    const isChecked = currentlyChecked.has(String(g.id));
    const isSol = g.category === 'Sol Music';
    return `
      <label class="mat-group-pill card-interactive flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition ${isChecked ? 'border-[#0071e3] bg-[#0071e3]/[0.07]' : 'border-black/10 bg-white/80 hover:bg-white'}">
        <input type="checkbox" name="matGroupCheck" value="${g.id}" ${isChecked ? 'checked' : ''} onchange="onMatGroupSelectChange()" class="rounded text-[#0071e3] shrink-0">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-bold text-[#1d1d1f] truncate">${g.name}</p>
          <span class="inline-block text-[9px] font-semibold ${isSol ? 'text-amber-700' : 'text-indigo-700'}">${g.category || 'Particulares'}</span>
        </div>
      </label>
    `;
  }).join('');
  onMatGroupSelectChange();
}

function onMatGroupSelectChange() {
  const checkedBoxes = Array.from(document.querySelectorAll('input[name="matGroupCheck"]:checked'));
  const countEl = document.getElementById('matGroupSelectedCount');
  if (countEl) countEl.innerText = `${checkedBoxes.length} seleccionado(s)`;

  document.querySelectorAll('.mat-group-pill').forEach(lbl => {
    const cb = lbl.querySelector('input[type="checkbox"]');
    const active = cb && cb.checked;
    lbl.className = `mat-group-pill card-interactive flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition ${active ? 'border-[#0071e3] bg-[#0071e3]/[0.07]' : 'border-black/10 bg-white/80 hover:bg-white'}`;
  });

  const selectedGroups = checkedBoxes
    .map(cb => groupsCache.find(g => String(g.id) === String(cb.value)))
    .filter(Boolean);
  const fmtSel = document.getElementById('matFormatSelect');
  if (selectedGroups.length && fmtSel) {
    const hasSol = selectedGroups.some(g => g.category === 'Sol Music');
    fmtSel.value = hasSol ? 'music' : 'classroom';
    onMatFormatChange();
  }
}

function onMatFormatChange() {
  const fmt = document.getElementById('matFormatSelect')?.value || 'music';
  const evalBox = document.getElementById('matEvalToggleBox');
  if (evalBox) {
    evalBox.classList.toggle('hidden', fmt !== 'classroom');
  }

  const titleInp = document.getElementById('matTitle');
  const descInp = document.getElementById('matDesc');
  if (fmt === 'classroom') {
    if (titleInp) titleInp.placeholder = 'Ej: Guía de Suma y Resta / Regresión Lineal';
    if (descInp) descInp.placeholder = 'Resuelve la ficha o actividad y sube fotos nítidas de tu trabajo...';
  } else {
    if (titleInp) titleInp.placeholder = 'Ej: De Música Ligera / Carnaval Ayacuchano';
    if (descInp) descInp.placeholder = 'Tonalidad, tempo, estructura o pasajes a ensayar...';
  }

  const opts = getActiveLabelOptions();
  document.querySelectorAll('.file-label-select').forEach((sel, idx) => {
    const cur = sel.value;
    const desired = (idx === 0 && (!cur || INSTRUMENT_OPTIONS.includes(cur) || CLASSROOM_LABEL_OPTIONS.includes(cur)))
      ? (fmt === 'classroom' ? 'Actividad / Tarea (PDF)' : 'General (Canción completa)')
      : cur;
    sel.innerHTML = opts.map(o => `<option value="${o}" ${o === desired ? 'selected' : ''}>${o}</option>`).join('');
  });
}

function loadClassroomPreset() {
  const fmtSel = document.getElementById('matFormatSelect');
  if (fmtSel) {
    fmtSel.value = 'classroom';
    onMatFormatChange();
  }
  const container = document.getElementById('fileRowsContainer');
  container.innerHTML = '';
  ['Actividad / Tarea (PDF)', 'Hoja de Reforzamiento'].forEach(lbl => addFileRow(lbl));
}

function addFileRow(defaultLabel = '1ra Guitarra') {
  const container = document.getElementById('fileRowsContainer');
  const row = document.createElement('div');
  row.className = 'file-upload-row bg-white p-3 rounded-xl border border-black/10 flex flex-col gap-2 min-w-0 w-full';

  const optionsHtml = getActiveLabelOptions().map(opt =>
    `<option value="${opt}" ${opt === defaultLabel ? 'selected' : ''}>${opt}</option>`
  ).join('');

  row.innerHTML = `
    <div class="flex items-center justify-between gap-2 min-w-0">
      <select class="file-label-select flex-1 min-w-0 truncate bg-[#f5f5f7] border border-black/10 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#1d1d1f]">
        ${optionsHtml}
      </select>
      <button type="button" onclick="this.parentElement.parentElement.remove()" class="text-red-500 hover:text-red-700 px-2 py-1 text-xs shrink-0" title="Quitar fila">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <input type="file" multiple accept=".pdf,.mp3,.wav,.ogg,.m4a,.doc,.docx,.zip,.gpx"
      class="file-input-item w-full min-w-0 text-xs text-[#6e6e73] file:mr-2 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-[11px] file:font-semibold file:bg-[#0071e3]/10 file:text-[#0071e3]">
  `;
  container.appendChild(row);
}

function loadSongPreset() {
  const container = document.getElementById('fileRowsContainer');
  container.innerHTML = '';
  [
    'General (Canción completa)',
    '1ra Guitarra',
    '2da Guitarra',
    'Bajo',
    'Piano / Teclado',
    'Batería / Percusión',
    'Cantante / Voz'
  ].forEach(lbl => addFileRow(lbl));
}

addFileRow('General (Canción completa)');
addFileRow('1ra Guitarra');


document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const closeIfOpen = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains("hidden")) {
      fn();
      return true;
    }
    return false;
  };
  if (closeIfOpen("pdfViewerModal", closePdfModal)) return;
  if (closeIfOpen("imageViewerModal", closeImageModal)) return;
  if (closeIfOpen("cellModal", closeCellModal)) return;
  if (closeIfOpen("dailyExportModal", closeDailyExportModal)) return;
  if (closeIfOpen("publishMaterialModal", closePublishMaterialModal)) return;
  if (closeIfOpen("editMaterialModal", closeEditMaterialModal)) return;
  if (closeIfOpen("createGroupModal", closeCreateGroupModal)) return;
  if (closeIfOpen("editGroupModal", closeEditGroupModal)) return;
  if (closeIfOpen("createStudentModal", closeCreateStudentModal)) return;
  if (closeIfOpen("editStudentModal", closeEditStudentModal)) return;
  if (closeIfOpen("studentDetailModal", closeStudentDetailModal)) return;
  if (closeIfOpen("createTeacherModal", closeCreateTeacherModal)) return;
  if (closeIfOpen("teacherProfileModal", closeTeacherProfileModal)) return;
  const passModal = document.getElementById("passModal");
  if (passModal && !passModal.classList.contains("hidden")) {
    passModal.classList.add("hidden");
    return;
  }
  const notifModal = document.getElementById("notificationsModal");
  if (notifModal && !notifModal.classList.contains("hidden")) {
    closeNotificationsModal();
    return;
  }

  // Navegación / limpieza rápida con Escape en todas las secciones (Académico y Gestión)
  if (activeAdminTab === "asistencia" && typeof selectedAttGroupId !== "undefined" && selectedAttGroupId) {
    selectAttendanceGroupCard(null);
    return;
  }
  if (activeAdminTab === "materiales") {
    if (typeof selectedAdminMaterialId !== "undefined" && selectedAdminMaterialId) {
      selectAdminMaterial(null);
      return;
    }
    if (typeof selectedClassroomCardId !== "undefined" && selectedClassroomCardId) {
      selectClassroomCard(null);
      return;
    }
  }
  if (activeAdminTab === "alumnos") {
    if (typeof selectedStudentGroupCardId !== "undefined" && selectedStudentGroupCardId) {
      selectStudentGroupCard("");
      return;
    }
    const searchEl = document.getElementById("dirStudentSearch");
    if (searchEl && searchEl.value) {
      searchEl.value = "";
      renderStudentsViews();
      return;
    }
  }
  if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    document.activeElement.blur();
  }
});

// ==================== CENTRO DE NOTIFICACIONES ====================
let adminNotificationsCache = [];

function updateAdminNotifBadges(unreadCount) {
  document.querySelectorAll('.notif-unread-badge').forEach(el => {
    if (unreadCount > 0) {
      el.innerText = unreadCount > 9 ? '9+' : String(unreadCount);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

function renderAdminNotificationsList() {
  const listEl = document.getElementById('notificationsList');
  if (!listEl) return;
  if (!adminNotificationsCache.length) {
    listEl.innerHTML = '<div class="p-6 rounded-2xl bg-white/90 text-center text-xs text-[#6e6e73]">No tienes notificaciones por ahora.</div>';
    return;
  }
  const iconMap = {
    announcement: { icon: 'fa-bullhorn', cls: 'bg-rose-500/15 text-rose-600' },
    submission: { icon: 'fa-clipboard-check', cls: 'bg-emerald-500/15 text-emerald-700' },
    new_task: { icon: 'fa-book-open', cls: 'bg-[#0071e3]/15 text-[#0071e3]' },
    task_reminder: { icon: 'fa-clock', cls: 'bg-amber-500/15 text-amber-700' },
    grade: { icon: 'fa-star', cls: 'bg-indigo-500/15 text-indigo-700' }
  };
  listEl.innerHTML = adminNotificationsCache.map(n => {
    const meta = iconMap[n.type] || { icon: 'fa-bell', cls: 'bg-sky-500/15 text-sky-700' };
    const unreadCls = n.is_read ? 'bg-white/75 border-black/[0.06] opacity-80' : 'bg-white border-[#0071e3]/30 shadow-sm';
    return `
      <button type="button" onclick="onAdminNotificationClick(${n.id}, '${(n.link_hash || '').replace(/'/g, "\\'")}')"
        class="card-interactive w-full text-left p-3.5 rounded-2xl border flex items-start gap-3 ${unreadCls}">
        <div class="w-9 h-9 rounded-xl ${meta.cls} flex items-center justify-center text-xs shrink-0 mt-0.5">
          <i class="fa-solid ${meta.icon}"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-bold text-[#1d1d1f] truncate">${n.title}</p>
            ${!n.is_read ? '<span class="w-2 h-2 rounded-full bg-[#0071e3] shrink-0"></span>' : ''}
          </div>
          <p class="text-[11px] text-[#424245] mt-0.5 leading-snug">${n.message}</p>
          <span class="block text-[9px] text-[#6e6e73] mt-1">${new Date(n.created_at).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </button>
    `;
  }).join('');
}

async function loadNotifications() {
  try {
    const res = await fetch('/intranet/api/notifications', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    adminNotificationsCache = data.notifications || [];
    updateAdminNotifBadges(data.unread_count || 0);
    renderAdminNotificationsList();
  } catch {}
}

function openNotificationsModal() {
  loadNotifications();
  document.getElementById('notificationsModal').classList.remove('hidden');
}

function closeNotificationsModal() {
  document.getElementById('notificationsModal').classList.add('hidden');
}

async function markAllNotificationsRead() {
  await fetch('/intranet/api/notifications/read', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({})
  });
  adminNotificationsCache = adminNotificationsCache.map(n => ({ ...n, is_read: 1 }));
  updateAdminNotifBadges(0);
  renderAdminNotificationsList();
}

async function onAdminNotificationClick(id, linkHash) {
  await fetch('/intranet/api/notifications/read', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ id })
  });
  adminNotificationsCache = adminNotificationsCache.map(n => Number(n.id) === Number(id) ? { ...n, is_read: 1 } : n);
  updateAdminNotifBadges(adminNotificationsCache.filter(n => !n.is_read).length);
  renderAdminNotificationsList();
  closeNotificationsModal();
  if (linkHash) {
    applyAdminRouteFromHash(linkHash);
    syncAdminUrl(true);
  }
}

function runBrandIntroAnimation() {
  const overlay = document.getElementById('auroraIntroSplash');
  const pill = document.getElementById('auroraIntroLogo');
  if (!overlay || !pill) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    overlay.remove();
    return;
  }

  setTimeout(() => {
    const target = document.getElementById(window.innerWidth >= 768 ? 'brandLogoDesktop' : 'brandLogoMobile');
    if (!target) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
      return;
    }
    const introRect = pill.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const dx = (targetRect.left + targetRect.width / 2) - (introRect.left + introRect.width / 2);
    const dy = (targetRect.top + targetRect.height / 2) - (introRect.top + introRect.height / 2);
    const scale = targetRect.width && introRect.width ? (targetRect.width / introRect.width) : 0.65;

    pill.style.animation = 'none';
    pill.style.transition = 'transform 520ms cubic-bezier(0.22, 1.08, 0.36, 1), opacity 220ms ease 360ms';
    requestAnimationFrame(() => {
      pill.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
      pill.style.opacity = '0';
      overlay.style.backgroundColor = 'transparent';
      overlay.style.backdropFilter = 'none';
      overlay.style.opacity = '0';
    });
    setTimeout(() => overlay.remove(), 600);
  }, 280);
}

window.addEventListener('DOMContentLoaded', () => {
  loadNotifications();
  runBrandIntroAnimation();
});

