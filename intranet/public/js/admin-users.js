// ==================== ENVÍO RÁPIDO DE CREDENCIALES ====================
let studentsCache = [];

function sendCredentialsWhatsApp(studentId) {
  const stu = studentsCache.find(s => Number(s.id) === Number(studentId));
  if (!stu) return;
  const passText = stu.plain_hint ? stu.plain_hint : '(clave asignada al registrar)';
  const scheduleLine = stu.schedule ? `\nHorario: *${stu.schedule}*` : '';
  const msg = [
    `Hola *${stu.full_name}*, bienvenido(a) a la plataforma académica *DC CORP* (${stu.category || 'Particulares'} - ${stu.group_names || stu.group_name || ''}).`,
    '',
    `Enlace de acceso: https://dccorp.lat/intranet`,
    `Usuario: *${stu.code}*`,
    `Contraseña: *${passText}*${scheduleLine}`,
    '',
    `Desde tu portal podrás revisar tu asistencia, descargar separatas/partituras en PDF, ensayar con las pistas MP3 y escribir tus consultas directas al docente.`
  ].join('\n');

  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

function copyCredentialsText(studentId) {
  const stu = studentsCache.find(s => Number(s.id) === Number(studentId));
  if (!stu) return;
  const passText = stu.plain_hint ? stu.plain_hint : '(clave asignada)';
  const text = `Portal: https://dccorp.lat/intranet | Usuario: ${stu.code} | Clave: ${passText}`;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Credenciales de ${stu.full_name} copiadas al portapapeles.`, "success");
  });
}

// ==================== SUBGRUPOS Y ALUMNADO ====================
let groupsCache = [];
let teachersCache = [];
let materialsCache = [];
let currentCategoryFilter = 'Todos';
let selectedStudentGroupCardId = '';
let selectedClassroomCardId = null;

function isMusicStudent(stu) {
  const gList = stu.groups || [];
  if (gList.some(g => g.category === 'Sol Music')) return true;
  if (stu.category === 'Sol Music') return true;
  return false;
}

function getStudentAreaBadgeHtml(stu, darkSurface = false) {
  if (isMusicStudent(stu)) {
    const cls = darkSurface
      ? 'bg-amber-400/20 text-amber-200 border border-amber-300/30'
      : 'bg-amber-500/15 text-amber-800';
    return `<span class="px-2.5 py-0.5 rounded-full ${cls} font-semibold text-[10px] inline-flex items-center gap-1"><i class="fa-solid fa-guitar"></i>${stu.instrument || 'Música'}</span>`;
  }
  const cls = darkSurface
    ? 'bg-sky-400/20 text-sky-200 border border-sky-300/30'
    : 'bg-indigo-500/10 text-indigo-700';
  return `<span class="px-2.5 py-0.5 rounded-full ${cls} font-semibold text-[10px] inline-flex items-center gap-1"><i class="fa-solid fa-calculator"></i>Matemáticas${stu.grade ? ` • ${stu.grade}` : ''}</span>`;
}

function setStudentCategoryFilter(cat) {
  currentCategoryFilter = cat;
  selectedStudentGroupCardId = '';
  ['Todos', 'Particulares', 'Sol Music'].forEach(c => {
    const btn = document.getElementById(`cat-${c}`);
    if (btn) {
      btn.className = (c === cat)
        ? "cat-btn segmented-btn px-3.5 py-1.5 rounded-lg text-[#1d1d1f]"
        : "cat-btn segmented-btn px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f]";
    }
  });
  updateSegmentedPill('adminCategoryFilter', `cat-${cat}`);
  loadStudents();
}

window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    updateSegmentedPill('attCategoryFilter', `att-cat-${attCategoryFilter}`);
    updateSegmentedPill('adminCategoryFilter', `cat-${currentCategoryFilter}`);
    updateSegmentedPill('mobileAdminNavGrid', `mtab-${activeAdminTab}`, '.dock-pill');
  });
});

window.addEventListener('resize', () => {
  updateSegmentedPill('attCategoryFilter', `att-cat-${attCategoryFilter}`);
  updateSegmentedPill('adminCategoryFilter', `cat-${currentCategoryFilter}`);
  updateSegmentedPill('mobileAdminNavGrid', `mtab-${activeAdminTab}`, '.dock-pill');
});

function selectStudentGroupCard(groupId) {
  selectedStudentGroupCardId = groupId ? String(groupId) : '';
  const clearBtn = document.getElementById('btnClearGroupCard');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !selectedStudentGroupCardId);
  }
  renderStudentClassCards();
  renderStudentsViews();
}

function renderStudentClassCards() {
  const grid = document.getElementById('studentGroupCardsGrid');
  if (!grid) return;

  const visibleGroups = groupsCache.filter(g => {
    if (!isAdmin) return g.category === 'Sol Music';
    if (currentCategoryFilter && currentCategoryFilter !== 'Todos') {
      return g.category === currentCategoryFilter;
    }
    return true;
  });

  if (!visibleGroups.length) {
    grid.innerHTML = '<p class="col-span-full text-xs text-[#6e6e73] py-2">No hay subgrupos creados en esta vista.</p>';
    return;
  }

  grid.innerHTML = visibleGroups.map(g => {
    const active = String(g.id) === String(selectedStudentGroupCardId);
    const isSol = g.category === 'Sol Music';
    return `
      <div onclick="selectStudentGroupCard(${g.id})" role="button" tabindex="0"
        class="card-interactive cursor-pointer text-left p-3.5 rounded-2xl border flex flex-col justify-between gap-2 ${
          active
            ? 'bg-[#102e44] text-white border-[#0ea5e9] shadow-md shadow-sky-500/15'
            : 'bg-white/95 hover:bg-white text-[#1d1d1f] border-black/[0.08]'
        }">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${
              active
                ? 'bg-sky-400/20 text-sky-200'
                : (isSol ? 'bg-amber-500/15 text-amber-800' : 'bg-indigo-500/10 text-indigo-700')
            }">${g.category}</span>
            <span class="text-[10px] font-semibold truncate ${active ? 'text-slate-200' : 'text-[#6e6e73]'}">
              <i class="fa-solid fa-users mr-1"></i>${g.student_count || 0}
            </span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" onclick="event.stopPropagation(); openEditGroupModal(${g.id})"
              class="btn-interactive px-2 py-1 rounded-lg text-[10px] font-semibold ${
                active ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-[#0071e3]/10 hover:bg-[#0071e3]/20 text-[#0071e3]'
              }" title="Editar subgrupo y ver alumnos">
              <i class="fa-solid fa-pen-to-square"></i> Editar
            </button>
            <button type="button" onclick="event.stopPropagation(); deleteGroup(${g.id})"
              class="p-1.5 rounded-lg text-[10px] ${
                active ? 'text-rose-300 hover:bg-rose-500/20' : 'text-red-500 hover:bg-red-50'
              }" title="Eliminar subgrupo">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        <div>
          <p class="text-xs font-bold leading-snug line-clamp-1">${g.name}</p>
          ${g.schedule ? `<p class="text-[10px] truncate mt-0.5 ${active ? 'text-sky-300' : 'text-[#0071e3]'}"><i class="fa-regular fa-clock mr-1"></i>${g.schedule}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function syncStudentFieldBySelectedGroups(selectedIds, isEdit = false) {
  const selectedGroups = groupsCache.filter(g => selectedIds.includes(Number(g.id)));
  const hasSolMusic = selectedGroups.some(g => g.category === 'Sol Music');
  const isMathOnly = selectedGroups.length > 0 && !hasSolMusic;

  if (!isEdit) {
    document.getElementById('stuInstrumentBox').classList.toggle('hidden', isMathOnly);
    document.getElementById('stuGradeBox').classList.toggle('hidden', !isMathOnly);
  } else {
    document.getElementById('editStuInstrumentBox').classList.toggle('hidden', isMathOnly);
    document.getElementById('editStuGradeBox').classList.toggle('hidden', !isMathOnly);
  }
}

function renderGroupChecklists() {
  const createBox = document.getElementById('stuGroupsChecklist');
  if (!createBox) return;

  if (!groupsCache.length) {
    createBox.innerHTML = '<p class="text-[#6e6e73]">Crea primero un subgrupo arriba.</p>';
    return;
  }

  createBox.innerHTML = groupsCache.map((g, idx) => `
    <label class="flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-white cursor-pointer">
      <input type="checkbox" name="stuGroupCheck" value="${g.id}" ${idx === 0 ? 'checked' : ''} class="rounded text-[#0071e3]">
      <span class="font-medium text-[#1d1d1f]">${isAdmin ? `[${g.category}] ` : ''}${g.name}</span>
    </label>
  `).join('');

  createBox.onchange = () => {
    const vals = Array.from(document.querySelectorAll('input[name="stuGroupCheck"]:checked')).map(cb => Number(cb.value));
    syncStudentFieldBySelectedGroups(vals, false);
  };
}

function renderGroupsCards() {
  renderStudentClassCards();
}

function openEditGroupModal(groupId) {
  const grp = groupsCache.find(g => Number(g.id) === Number(groupId));
  if (!grp) return;

  document.getElementById('editGroupId').value = grp.id;
  document.getElementById('editGroupName').value = grp.name;
  document.getElementById('editGroupSchedule').value = grp.schedule || '';
  document.getElementById('editGroupDesc').value = grp.description || '';
  document.getElementById('editGroupCategory').value = grp.category || 'Particulares';
  document.getElementById('editGroupCategoryWrap').classList.toggle('hidden', !isAdmin);

  const members = studentsCache.filter(s => (s.group_ids || []).includes(Number(grp.id)) || Number(s.group_id) === Number(grp.id));
  const listEl = document.getElementById('editGroupStudentsPreview');
  if (!members.length) {
    listEl.innerHTML = '<p class="text-[#6e6e73] italic">Sin alumnos asignados en este subgrupo.</p>';
  } else {
    listEl.innerHTML = members.map(m => `
      <div class="card-interactive flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-xl border border-black/[0.06]">
        <div class="min-w-0">
          <p class="font-semibold text-[#1d1d1f] truncate">${m.full_name}</p>
          <span class="text-[10px] font-semibold text-[#6e6e73]">${isMusicStudent(m) ? (m.instrument || 'Música') : (m.grade || 'Matemáticas')}</span>
        </div>
        <button type="button" onclick="closeEditGroupModal(); openEditStudentModal(${m.id});"
          class="btn-interactive shrink-0 px-3 py-1 rounded-full bg-[#0071e3]/10 hover:bg-[#0071e3]/20 text-[#0071e3] text-[11px] font-semibold inline-flex items-center gap-1">
          <i class="fa-solid fa-pen-to-square text-[10px]"></i> Editar
        </button>
      </div>
    `).join('');
  }

  document.getElementById('editGroupModal').classList.remove('hidden');
}

function closeEditGroupModal() {
  document.getElementById('editGroupModal').classList.add('hidden');
}

document.getElementById('editGroupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const gid = document.getElementById('editGroupId').value;
  const res = await fetch(`/intranet/api/admin/groups/${gid}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      name: document.getElementById('editGroupName').value,
      category: isAdmin ? document.getElementById('editGroupCategory').value : 'Sol Music',
      schedule: document.getElementById('editGroupSchedule').value,
      description: document.getElementById('editGroupDesc').value
    })
  });
  if (res.ok) {
    closeEditGroupModal();
    loadAllData();
  } else {
    const d = await res.json();
    showToast(d.error || 'Error guardando subgrupo', "error");
  }
});

async function loadAllData() {
  const gRes = await fetch('/intranet/api/admin/groups', { headers: authHeaders() });
  if (gRes.status === 401) return logout();
  groupsCache = await gRes.json();

  const attSel = document.getElementById('attGroupSelect');
  if (attSel) {
    const prev = attSel.value;
    const allowedGroups = isAdmin ? groupsCache : groupsCache.filter(g => g.category === 'Sol Music');
    attSel.innerHTML = allowedGroups.length
      ? allowedGroups.map(g => `<option value="${g.id}">${isAdmin ? `[${g.category || 'Particulares'}] ` : ''}${g.name}</option>`).join('')
      : '<option value="">Crea primero un subgrupo</option>';
    if (prev && allowedGroups.some(g => String(g.id) === prev)) attSel.value = prev;
  }
  renderMaterialGroupChecklist();

  renderGroupChecklists();
  renderGroupsCards();
  renderAttendanceGroupCards();
  syncStudentFieldBySelectedGroups(Array.from(document.querySelectorAll('input[name="stuGroupCheck"]:checked')).map(cb => Number(cb.value)), false);

  if (window.location.hash) {
    applyAdminRouteFromHash(window.location.hash);
  } else {
    syncAdminUrl(false);
  }

  if (isAdmin) {
    await loadTeachers();
  }

  await loadStudents();
  if (selectedAttGroupId) {
    await loadWeeklyGrid();
  }
  await loadMaterials();
  await loadAnnouncementsAdmin();
}

// ==================== PLANA DOCENTE INTERACTIVA ====================
async function loadTeachers() {
  const res = await fetch('/intranet/api/admin/teachers', { headers: authHeaders() });
  teachersCache = await res.json();
  document.getElementById('teacherCount').innerText = `${teachersCache.length} integrante(s)`;

  document.getElementById('teachersList').innerHTML = teachersCache.map(t => {
    const isSelfAdmin = t.role === 'admin';
    const avatarEl = t.avatar_file
      ? `<img src="/intranet/api/avatars/${t.avatar_file}" class="w-12 h-12 rounded-2xl object-cover border border-black/10 shrink-0">`
      : `<div class="w-12 h-12 rounded-2xl ${isSelfAdmin ? 'bg-[#0071e3]' : 'bg-amber-600'} text-white flex items-center justify-center text-base font-bold shrink-0">${t.full_name.charAt(0)}</div>`;

    const cleanPhone = (t.whatsapp || '').replace(/[^0-9]/g, '');
    const waDirectUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Hola ${t.full_name}, te contacto desde Sol Music / DC CORP.`)}`
      : `https://wa.me/?text=${encodeURIComponent(`Hola *${t.full_name}*, aquí tienes tu acceso docente:\n\nEnlace: https://dccorp.lat/intranet\nUsuario: *${t.code}*\nContraseña: *${t.plain_hint || 'Docente2026'}*`)}`;

    return `
      <div onclick="openTeacherProfileModal(${t.id})"
        class="cursor-pointer p-4 rounded-2xl bg-white/95 hover:bg-white border border-black/[0.07] shadow-sm hover:shadow transition flex flex-col justify-between gap-3">
        <div class="flex items-start gap-3">
          ${avatarEl}
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <h4 class="text-sm font-bold text-[#1d1d1f] truncate">${t.full_name}</h4>
              <span class="px-2 py-0.5 rounded-full ${isSelfAdmin ? 'bg-[#0071e3]/10 text-[#0071e3]' : 'bg-amber-500/15 text-amber-800'} text-[10px] font-bold">
                ${t.specialty || (isSelfAdmin ? 'Dirección / Docente' : 'Sol Music')}
              </span>
            </div>
            <p class="text-[11px] text-[#6e6e73] font-mono mt-0.5">Usuario: ${t.code}${t.whatsapp ? ` • WA: ${t.whatsapp}` : ''}</p>
            <p class="text-xs text-[#424245] line-clamp-2 mt-1">${t.bio || '<span class="italic text-[#6e6e73]">Toca para ver o editar su perfil docente</span>'}</p>
          </div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-black/[0.05]" onclick="event.stopPropagation()">
          <button type="button" onclick="openTeacherProfileModal(${t.id})" class="text-[11px] font-semibold text-[#0071e3] hover:underline">
            Ver / Editar perfil
          </button>
          <div class="flex items-center gap-1.5">
            <a href="${waDirectUrl}" target="_blank" class="px-3 py-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 transition">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </a>
            <button type="button" onclick="deleteTeacher(${t.id})" class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs" title="Quitar de plana">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('') || '<p class="col-span-full text-xs text-[#6e6e73] text-center py-8">Aún no hay docentes en la lista.</p>';
}

function openTeacherProfileModal(userId) {
  const u = teachersCache.find(item => Number(item.id) === Number(userId));
  if (!u) return;

  document.getElementById('tpUserId').value = u.id;
  document.getElementById('tpModalName').innerText = u.full_name;
  document.getElementById('tpModalSub').innerText = `${u.specialty || 'Docente'} • Usuario: ${u.code}`;
  document.getElementById('tpFullName').value = u.full_name || '';
  document.getElementById('tpSpecialty').value = u.specialty || '';
  document.getElementById('tpWhatsapp').value = u.whatsapp || '';
  document.getElementById('tpCode').value = u.code || '';
  document.getElementById('tpBio').value = u.bio || '';
  document.getElementById('tpNewPass').value = '';
  document.getElementById('tpAvatarInput').value = '';

  const waLink = document.getElementById('tpWaLink');
  const digits = (u.whatsapp || '').replace(/[^0-9]/g, '');
  if (digits) {
    waLink.href = `https://wa.me/${digits}`;
    waLink.classList.remove('hidden');
  } else {
    waLink.classList.add('hidden');
  }

  const img = document.getElementById('tpAvatarImg');
  const fb = document.getElementById('tpAvatarFallback');
  if (u.avatar_file) {
    img.src = `/intranet/api/avatars/${u.avatar_file}?t=${Date.now()}`;
    img.classList.remove('hidden');
    fb.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    fb.innerText = u.full_name.charAt(0);
    fb.classList.remove('hidden');
  }

  document.getElementById('teacherProfileModal').classList.remove('hidden');
}

async function openAdminAsFacultyModal() {
  const res = await fetch('/intranet/api/admin/teachers', { headers: authHeaders() });
  const list = await res.json();
  teachersCache = list || [];
  const selfEntry = teachersCache.find(x => x.role === 'admin');
  if (selfEntry) {
    openTeacherProfileModal(selfEntry.id);
  }
}

function closeTeacherProfileModal() {
  document.getElementById('teacherProfileModal').classList.add('hidden');
}

async function uploadTeacherAvatar() {
  const uid = document.getElementById('tpUserId').value;
  const inp = document.getElementById('tpAvatarInput');
  if (!inp.files || !inp.files[0]) {
    showToast('Selecciona primero una imagen', "error");
    return;
  }
  const fd = new FormData();
  fd.append('avatar', inp.files[0]);
  const res = await fetch(`/intranet/api/admin/teachers/${uid}/avatar`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fd
  });
  if (res.ok) {
    const d = await res.json();
    const img = document.getElementById('tpAvatarImg');
    img.src = `/intranet/api/avatars/${d.avatar_file}?t=${Date.now()}`;
    img.classList.remove('hidden');
    document.getElementById('tpAvatarFallback').classList.add('hidden');
    await loadTeachers();
  } else {
    showToast('Error subiendo foto', "error");
  }
}

document.getElementById('teacherEditForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = document.getElementById('tpUserId').value;
  try {
    const res = await fetch(`/intranet/api/admin/teachers/${uid}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        full_name: document.getElementById('tpFullName').value,
        specialty: document.getElementById('tpSpecialty').value,
        whatsapp: document.getElementById('tpWhatsapp').value,
        code: document.getElementById('tpCode').value,
        bio: document.getElementById('tpBio').value,
        new_password: document.getElementById('tpNewPass').value,
        enable_faculty: true
      })
    });
    if (res.ok) {
      closeTeacherProfileModal();
      await loadTeachers();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || `Error guardando perfil docente (HTTP ${res.status})`);
    }
  } catch (err) {
    showToast('Error de red al guardar perfil docente: ' + err.message, "error");
  }
});

// ==================== ALUMNADO: TARJETAS DE CLASE + LISTA LIMPIA + PERFIL ====================
async function loadStudents() {
  const query = (isAdmin && currentCategoryFilter !== 'Todos') ? `?category=${encodeURIComponent(currentCategoryFilter)}` : '';
  const res = await fetch(`/intranet/api/admin/students${query}`, { headers: authHeaders() });
  studentsCache = await res.json();
  renderStudentClassCards();
  renderStudentsViews();
}

function renderStudentsViews() {
  const q = (document.getElementById('dirStudentSearch')?.value || '').trim().toLowerCase();
  const selectedGroupId = selectedStudentGroupCardId;

  const uniqueById = [];
  const seenIds = new Set();
  for (const item of (studentsCache || [])) {
    const sid = Number(item.id);
    if (!seenIds.has(sid)) {
      seenIds.add(sid);
      uniqueById.push(item);
    }
  }

  let filtered = uniqueById;
  if (q) {
    filtered = filtered.filter(s =>
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q) ||
      (s.group_names || s.group_name || '').toLowerCase().includes(q)
    );
  }
  if (selectedGroupId) {
    filtered = filtered.filter(s => (s.group_ids || []).includes(Number(selectedGroupId)) || String(s.group_id) === String(selectedGroupId));
  }

  const activeGrpObj = groupsCache.find(g => String(g.id) === String(selectedGroupId));
  document.getElementById('studentCount').innerText = `${filtered.length} alumno(s)${activeGrpObj ? ` en ${activeGrpObj.name}` : (isAdmin ? ` (${currentCategoryFilter})` : ' en Sol Music')}`;

  const listEl = document.getElementById('studentsCompactList');
  if (!listEl) return;

  if (!filtered.length) {
    listEl.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-8">No hay estudiantes para este filtro.</p>';
    return;
  }

  listEl.innerHTML = filtered.map(s => {
    const avatarThumb = s.avatar_file
      ? `<img src="/intranet/api/avatars/${s.avatar_file}" class="w-10 h-10 rounded-full object-cover border border-black/10 shrink-0">`
      : `<div class="w-10 h-10 rounded-full bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center text-xs font-bold shrink-0">${s.full_name.charAt(0)}</div>`;

    return `
      <button type="button" onclick="openStudentDetailModal(${s.id})"
        class="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-[#0071e3]/[0.04] active:scale-[0.995] transition-all duration-150">
        <div class="flex items-center gap-3 min-w-0">
          ${avatarThumb}
          <div class="min-w-0">
            <p class="text-sm font-bold text-[#1d1d1f] truncate">${s.full_name}</p>
            <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
              ${getStudentAreaBadgeHtml(s)}
              ${s.schedule ? `<span class="text-[11px] text-[#0071e3] font-medium truncate"><i class="fa-regular fa-clock mr-1"></i>${s.schedule}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 text-[#6e6e73]">
          <span class="hidden sm:inline text-[11px] font-medium">Ver perfil</span>
          <i class="fa-solid fa-chevron-right text-xs"></i>
        </div>
      </button>
    `;
  }).join('');
}

function openStudentDetailModal(studentId) {
  const stu = studentsCache.find(s => Number(s.id) === Number(studentId));
  if (!stu) return;

  const img = document.getElementById('sdAvatarImg');
  const fb = document.getElementById('sdAvatarFallback');
  if (stu.avatar_file) {
    img.src = `/intranet/api/avatars/${stu.avatar_file}?t=${Date.now()}`;
    img.classList.remove('hidden');
    fb.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    fb.innerText = stu.full_name.charAt(0);
    fb.classList.remove('hidden');
  }

  document.getElementById('sdAreaBadge').outerHTML = `<span id="sdAreaBadge">${getStudentAreaBadgeHtml(stu, true)}</span>`;
  document.getElementById('sdName').innerText = stu.full_name;
  document.getElementById('sdCode').innerText = `Usuario: ${stu.code} • Bloque: ${stu.monthly_quota || 8} clases/mes${stu.whatsapp ? ` • WA Apoderado: ${stu.whatsapp}` : ''}`;

  const schRow = document.getElementById('sdScheduleRow');
  if (stu.schedule) {
    schRow.innerHTML = `<i class="fa-regular fa-clock mr-1"></i>Horario: ${stu.schedule}`;
    schRow.classList.remove('hidden');
  } else {
    schRow.classList.add('hidden');
  }

  const grpBadges = (stu.groups || []).map(g =>
    `<span class="px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-semibold text-[10px]">${g.name}</span>`
  ).join('') || `<span class="px-2 py-0.5 rounded-full bg-black/5 text-[10px]">${stu.group_name || 'Sin grupo'}</span>`;
  document.getElementById('sdGroupsRow').innerHTML = grpBadges;

  const bioEl = document.getElementById('sdBio');
  if (stu.bio && stu.bio.trim()) {
    bioEl.innerText = stu.bio;
    bioEl.className = 'text-[#1d1d1f] mt-0.5 leading-relaxed';
  } else {
    bioEl.innerText = 'Sin descripción registrada en su perfil.';
    bioEl.className = 'text-[#6e6e73] italic mt-0.5 leading-relaxed';
  }

  document.getElementById('sdBtnWa').onclick = () => sendCredentialsWhatsApp(stu.id);
  document.getElementById('sdBtnCopy').onclick = () => copyCredentialsText(stu.id);
  document.getElementById('sdBtnEdit').onclick = () => {
    closeStudentDetailModal();
    openEditStudentModal(stu.id);
  };
  document.getElementById('sdBtnDelete').onclick = () => {
    closeStudentDetailModal();
    deleteStudent(stu.id);
  };

  document.getElementById('studentDetailModal').classList.remove('hidden');
}

function closeStudentDetailModal() {
  document.getElementById('studentDetailModal').classList.add('hidden');
}

function openEditStudentModal(studentId) {
  const stu = studentsCache.find(s => Number(s.id) === Number(studentId));
  if (!stu) return;

  document.getElementById('editStuId').value = stu.id;
  document.getElementById('editStuCode').value = stu.code || '';
  document.getElementById('editStuName').value = stu.full_name;
  document.getElementById('editStuSchedule').value = stu.schedule || '';
  document.getElementById('editStuQuota').value = stu.monthly_quota || 8;
  document.getElementById('editStuWhatsapp').value = stu.whatsapp || '';
  document.getElementById('editStuInstrument').value = stu.instrument || 'Guitarra acustica';
  document.getElementById('editStuGrade').value = stu.grade || '1er Grado Primaria';
  document.getElementById('editStuPass').value = '';

  const currentIds = (stu.group_ids && stu.group_ids.length)
    ? stu.group_ids.map(Number)
    : (stu.group_id ? [Number(stu.group_id)] : []);

  const box = document.getElementById('editStuGroupsChecklist');
  box.innerHTML = groupsCache.map(g => {
    const checked = currentIds.includes(Number(g.id)) ? 'checked' : '';
    return `
      <label class="flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-white cursor-pointer">
        <input type="checkbox" name="editStuGroupCheck" value="${g.id}" ${checked} class="rounded text-[#0071e3]">
        <span class="font-medium text-[#1d1d1f]">${isAdmin ? `[${g.category}] ` : ''}${g.name}</span>
      </label>
    `;
  }).join('');

  syncStudentFieldBySelectedGroups(currentIds, true);
  const editBox = document.getElementById('editStuGroupsChecklist');
  editBox.onchange = () => {
    const vals = Array.from(document.querySelectorAll('input[name="editStuGroupCheck"]:checked')).map(cb => Number(cb.value));
    syncStudentFieldBySelectedGroups(vals, true);
  };
  document.getElementById('editStudentModal').classList.remove('hidden');
}

function closeEditStudentModal() {
  document.getElementById('editStudentModal').classList.add('hidden');
}

document.getElementById('editStudentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const studentId = document.getElementById('editStuId').value;
  const checkedIds = Array.from(document.querySelectorAll('input[name="editStuGroupCheck"]:checked')).map(cb => Number(cb.value));
  if (!checkedIds.length) {
    showToast('Selecciona al menos un subgrupo para el estudiante', "error");
    return;
  }

  const btn = document.getElementById('btnSaveEditStu');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Guardando...';
  }

  try {
    const res = await fetch(`/intranet/api/admin/students/${studentId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        code: document.getElementById('editStuCode').value,
        full_name: document.getElementById('editStuName').value,
        group_ids: checkedIds,
        group_id: checkedIds[0],
        instrument: document.getElementById('editStuInstrument').value,
        grade: document.getElementById('editStuGrade').value,
        schedule: document.getElementById('editStuSchedule').value,
        monthly_quota: document.getElementById('editStuQuota').value,
        whatsapp: document.getElementById('editStuWhatsapp').value,
        new_password: document.getElementById('editStuPass').value
      })
    });

    if (res.ok) {
      closeEditStudentModal();
      loadAllData();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || `Error al actualizar estudiante (HTTP ${res.status})`);
    }
  } catch (err) {
    showToast('Error de conexión al guardar cambios: ' + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Guardar Cambios';
    }
  }
});


function openCreateGroupModal() {
  document.getElementById('createGroupModal').classList.remove('hidden');
}

function closeCreateGroupModal() {
  document.getElementById('createGroupModal').classList.add('hidden');
}

function openCreateStudentModal() {
  document.getElementById('createStudentModal').classList.remove('hidden');
}

function closeCreateStudentModal() {
  document.getElementById('createStudentModal').classList.add('hidden');
}

function openCreateTeacherModal() {
  document.getElementById('createTeacherModal').classList.remove('hidden');
}

function closeCreateTeacherModal() {
  document.getElementById('createTeacherModal').classList.add('hidden');
}

document.getElementById('groupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/intranet/api/admin/groups', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      category: isAdmin ? document.getElementById('groupCategory').value : 'Sol Music',
      name: document.getElementById('groupName').value,
      schedule: document.getElementById('groupSchedule').value,
      description: document.getElementById('groupDesc').value
    })
  });
  if (res.ok) {
    document.getElementById('groupForm').reset();
    closeCreateGroupModal();
    loadAllData();
  } else {
    const d = await res.json();
    showToast(d.error, "error");
  }
});

document.getElementById('studentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const checkedIds = Array.from(document.querySelectorAll('input[name="stuGroupCheck"]:checked')).map(cb => Number(cb.value));
  if (!checkedIds.length) {
    showToast('Selecciona al menos un subgrupo', "error");
    return;
  }

  const res = await fetch('/intranet/api/admin/students', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      full_name: document.getElementById('stuName').value,
      code: document.getElementById('stuCode').value,
      password: document.getElementById('stuPass').value,
      group_ids: checkedIds,
      group_id: checkedIds[0],
      instrument: document.getElementById('stuInstrument').value,
      grade: document.getElementById('stuGrade').value,
      schedule: document.getElementById('stuSchedule').value,
      monthly_quota: document.getElementById('stuQuota').value,
      whatsapp: document.getElementById('stuWhatsapp').value
    })
  });
  if (res.ok) {
    const created = await res.json();
    document.getElementById('studentForm').reset();
    document.getElementById('stuQuota').value = 8;
    closeCreateStudentModal();
    await loadAllData();
    if (confirm('Estudiante registrado. ¿Deseas abrir WhatsApp para enviarle su usuario y contraseña ahora mismo?')) {
      sendCredentialsWhatsApp(created.id);
    }
  } else {
    const d = await res.json();
    showToast(d.error, "error");
  }
});

document.getElementById('teacherForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/intranet/api/admin/teachers', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      full_name: document.getElementById('teaName').value,
      specialty: document.getElementById('teaSpecialty').value,
      whatsapp: document.getElementById('teaWhatsapp').value,
      code: document.getElementById('teaCode').value,
      password: document.getElementById('teaPass').value,
      bio: document.getElementById('teaBio').value
    })
  });
  if (res.ok) {
    document.getElementById('teacherForm').reset();
    closeCreateTeacherModal();
    loadTeachers();
  } else {
    const d = await res.json();
    showToast(d.error, "error");
  }
});


async function deleteGroup(id) {
  if (!confirm('¿Eliminar este subgrupo?')) return;
  await fetch(`/intranet/api/admin/groups/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadAllData();
}

async function deleteStudent(id) {
  if (!confirm('¿Eliminar este estudiante y su historial de asistencias?')) return;
  await fetch(`/intranet/api/admin/students/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadAllData();
}

async function deleteTeacher(id) {
  if (!confirm('¿Quitar de la plana docente?')) return;
  await fetch(`/intranet/api/admin/teachers/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadTeachers();
}


async function loadAnnouncementsAdmin() {
  const res = await fetch('/intranet/api/admin/announcements', { headers: authHeaders() });
  const list = await res.json();
  const container = document.getElementById('announcementsAdminList');
  if (!container) return;
  container.innerHTML = list.map(a => `
    <div class="p-4 rounded-2xl bg-white/95 border border-black/[0.06] flex items-start justify-between gap-3">
      <div class="space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-700 text-[10px] font-bold">${a.target_category}</span>
          ${a.event_date ? `<span class="text-[11px] font-semibold text-[#0071e3]"><i class="fa-regular fa-calendar mr-1"></i>${a.event_date}</span>` : ''}
        </div>
        <h4 class="text-sm font-bold text-[#1d1d1f]">${a.title}</h4>
        <p class="text-xs text-[#6e6e73] leading-relaxed">${a.message}</p>
        <p class="text-[10px] text-[#6e6e73]">Publicado por: ${a.created_by_name}</p>
      </div>
      <button type="button" onclick="deleteAnnouncement(${a.id})" class="text-red-500 hover:text-red-700 text-xs p-1.5" title="Eliminar aviso">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('') || '<p class="text-xs text-[#6e6e73] text-center py-8">No hay avisos publicados actualmente.</p>';
}

document.getElementById('announcementForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/intranet/api/admin/announcements', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      target_category: isAdmin ? document.getElementById('annCategory').value : 'Sol Music',
      title: document.getElementById('annTitle').value,
      event_date: document.getElementById('annDate').value,
      message: document.getElementById('annMessage').value
    })
  });
  if (res.ok) {
    document.getElementById('announcementForm').reset();
    loadAnnouncementsAdmin();
  }
});

async function deleteAnnouncement(id) {
  if (!confirm('¿Eliminar este aviso de la portada de los estudiantes?')) return;
  await fetch(`/intranet/api/admin/announcements/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadAnnouncementsAdmin();
}

async function downloadDatabaseBackup() {
  const res = await fetch('/intranet/api/admin/backup', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    showToast('Error generando copia de seguridad', "error");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `intranet_dccorp_backup_${formatISO(new Date())}.db`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== MENSAJES DIRECTOS Y SUPERVISIÓN ====================
let adminMessagesMode = 'direct';
let activeStaffDmStudent = null;
let activeAuditPair = null;

function setAdminMessagesMode(mode) {
  if (!isAdmin && mode === 'audit') mode = 'direct';
  adminMessagesMode = mode;
  ['direct', 'audit'].forEach(m => {
    const btn = document.getElementById(`msg-mode-${m}`);
    if (btn) {
      btn.className = (m === mode)
        ? 'msg-mode-btn segmented-btn px-3 py-1.5 rounded-lg text-[#1d1d1f]'
        : 'msg-mode-btn segmented-btn px-3 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f]';
    }
  });
  updateSegmentedPill('mensajesModeFilter', `msg-mode-${mode}`);
  const staffWrap = document.getElementById('staffDmWorkspace');
  const auditWrap = document.getElementById('adminAuditWorkspace');
  if (staffWrap) staffWrap.classList.toggle('hidden', mode !== 'direct');
  if (auditWrap) auditWrap.classList.toggle('hidden', mode !== 'audit');
  refreshCurrentMessagesMode();
}

function refreshCurrentMessagesMode() {
  if (adminMessagesMode === 'audit' && isAdmin) {
    loadAdminStudentMessages();
  } else {
    loadStaffStudentMessages();
  }
  requestAnimationFrame(() => updateSegmentedPill('mensajesModeFilter', `msg-mode-${adminMessagesMode}`));
}

async function loadStaffStudentMessages() {
  const listEl = document.getElementById('staffDmStudentList');
  if (!listEl) return;
  const res = await fetch('/intranet/api/staff/messages/students', { headers: authHeaders() });
  if (!res.ok) return;
  const students = await res.json();

  const totalUnread = students.reduce((acc, s) => acc + (s.unread_count || 0), 0);
  const badgeEl = document.getElementById('staffDmBadge');
  if (badgeEl) {
    badgeEl.innerText = totalUnread > 9 ? '9+' : String(totalUnread);
    badgeEl.classList.toggle('hidden', totalUnread === 0);
  }

  if (!students.length) {
    listEl.innerHTML = '<p class="text-xs text-[#6e6e73] py-6 text-center">No hay estudiantes disponibles.</p>';
    return;
  }

  listEl.innerHTML = students.map(s => {
    const active = activeStaffDmStudent && Number(activeStaffDmStudent.id) === Number(s.id);
    return `
      <button type="button" onclick="openStaffDmThread(${s.id}, '${s.full_name.replace(/'/g, "\\'")}')"
        class="card-interactive w-full text-left p-3 rounded-2xl border transition ${active ? 'bg-[#102e44] text-white border-[#0ea5e9]' : 'bg-white/95 hover:bg-white border-black/[0.07] text-[#1d1d1f]'}">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-bold truncate">${s.full_name}</p>
          ${s.unread_count ? `<span class="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold shrink-0">${s.unread_count}</span>` : ''}
        </div>
        <p class="text-[11px] truncate mt-0.5 ${active ? 'text-slate-200' : 'text-[#6e6e73]'}">${s.last_message || (s.instrument || s.grade || 'Estudiante')}</p>
      </button>
    `;
  }).join('');
}

async function openStaffDmThread(studentId, studentName) {
  activeStaffDmStudent = { id: Number(studentId), name: studentName };
  loadStaffStudentMessages();
  const headerEl = document.getElementById('staffDmThreadHeader');
  const boxEl = document.getElementById('staffDmThreadMessages');
  const formEl = document.getElementById('staffDmForm');
  if (headerEl) headerEl.innerText = `Chat con ${studentName}`;
  if (formEl) formEl.classList.remove('hidden');
  if (!boxEl) return;

  const res = await fetch(`/intranet/api/staff/messages/${studentId}`, { headers: authHeaders() });
  const msgs = await res.json();
  if (!msgs.length) {
    boxEl.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-12">Sin mensajes todavía. Escribe para iniciar el chat.</p>';
    return;
  }
  boxEl.innerHTML = msgs.map(m => {
    const isStu = Number(m.sender_id) === Number(studentId);
    return `
      <div class="flex ${isStu ? 'justify-start' : 'justify-end'}">
        <div class="max-w-[82%] p-3 rounded-2xl text-xs shadow-sm ${isStu ? 'bg-white border border-black/[0.06] text-[#1d1d1f]' : 'bg-gradient-to-r from-[#0ea5e9] to-[#0071e3] text-white'}">
          <p class="leading-relaxed">${m.content}</p>
          <span class="block text-[9px] mt-1 ${isStu ? 'text-[#6e6e73]' : 'text-sky-100/80'}">${new Date(m.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    `;
  }).join('');
  boxEl.scrollTop = boxEl.scrollHeight;
}

const staffDmFormEl = document.getElementById('staffDmForm');
if (staffDmFormEl) {
  staffDmFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeStaffDmStudent) return;
    const inp = document.getElementById('staffDmInput');
    const content = inp.value.trim();
    if (!content) return;
    inp.value = '';
    const res = await fetch(`/intranet/api/staff/messages/${activeStaffDmStudent.id}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ content })
    });
    if (res.ok) {
      openStaffDmThread(activeStaffDmStudent.id, activeStaffDmStudent.name);
    }
  });
}

function onStaffDmEvent(msg) {
  loadStaffStudentMessages();
  if (activeStaffDmStudent && (Number(msg.sender_id) === activeStaffDmStudent.id || Number(msg.receiver_id) === activeStaffDmStudent.id)) {
    openStaffDmThread(activeStaffDmStudent.id, activeStaffDmStudent.name);
  }
}

window.addEventListener('DOMContentLoaded', loadStaffStudentMessages);

async function loadAdminStudentMessages() {
  if (!isAdmin) return;
  const listEl = document.getElementById('adminDmConvList');
  if (!listEl) return;
  const res = await fetch('/intranet/api/admin/student-messages', { headers: authHeaders() });
  if (!res.ok) return;
  const convs = await res.json();
  if (!convs.length) {
    listEl.innerHTML = '<p class="text-xs text-[#6e6e73] py-6 text-center">Aún no hay mensajes entre estudiantes.</p>';
    return;
  }
  listEl.innerHTML = convs.map(c => {
    const active = activeAuditPair && activeAuditPair.userA === c.user_a_id && activeAuditPair.userB === c.user_b_id;
    return `
      <button type="button" onclick="openAdminDmThread(${c.user_a_id}, ${c.user_b_id}, '${c.user_a_name.replace(/'/g, "\\'")}', '${c.user_b_name.replace(/'/g, "\\'")}')"
        class="card-interactive w-full text-left p-3.5 rounded-2xl border transition ${active ? 'bg-[#102e44] text-white border-[#0ea5e9]' : 'bg-white/95 hover:bg-white border-black/[0.07] text-[#1d1d1f]'}">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-bold truncate">${c.user_a_name} ↔ ${c.user_b_name}</p>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-sky-400/20 text-sky-200' : 'bg-[#0071e3]/10 text-[#0071e3]'}">${c.total_messages}</span>
        </div>
        <p class="text-[11px] truncate mt-1 ${active ? 'text-slate-200' : 'text-[#6e6e73]'}"><strong>${c.last_sender_name}:</strong> ${c.last_message}</p>
      </button>
    `;
  }).join('');
}

async function openAdminDmThread(userA, userB, nameA, nameB) {
  activeAuditPair = { userA, userB, nameA, nameB };
  loadAdminStudentMessages();
  const headerEl = document.getElementById('adminDmThreadHeader');
  const boxEl = document.getElementById('adminDmThreadMessages');
  if (headerEl) headerEl.innerText = `Conversación: ${nameA} ↔ ${nameB}`;
  if (!boxEl) return;

  const res = await fetch(`/intranet/api/admin/student-messages/${userA}/${userB}`, { headers: authHeaders() });
  const msgs = await res.json();
  if (!msgs.length) {
    boxEl.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-10">Sin mensajes.</p>';
    return;
  }
  boxEl.innerHTML = msgs.map(m => {
    const isA = Number(m.sender_id) === Number(userA);
    return `
      <div class="flex ${isA ? 'justify-start' : 'justify-end'}">
        <div class="max-w-[82%] p-3 rounded-2xl text-xs ${isA ? 'bg-white border border-black/[0.06] text-[#1d1d1f]' : 'bg-[#0071e3] text-white'} shadow-sm">
          <p class="text-[10px] font-bold ${isA ? 'text-[#0071e3]' : 'text-sky-100'} mb-0.5">${m.sender_name}</p>
          <p class="leading-relaxed">${m.content}</p>
          <span class="block text-[9px] mt-1 ${isA ? 'text-[#6e6e73]' : 'text-sky-100/80'}">${new Date(m.created_at).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    `;
  }).join('');
  boxEl.scrollTop = boxEl.scrollHeight;
}

function onAdminAuditMessageEvent(msg) {
  if (activeAdminTab === 'mensajes') {
    loadAdminStudentMessages();
    if (activeAuditPair && ((Number(msg.sender_id) === activeAuditPair.userA && Number(msg.receiver_id) === activeAuditPair.userB) || (Number(msg.sender_id) === activeAuditPair.userB && Number(msg.receiver_id) === activeAuditPair.userA))) {
      openAdminDmThread(activeAuditPair.userA, activeAuditPair.userB, activeAuditPair.nameA, activeAuditPair.nameB);
    }
  }
}

