function getMonday(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

let currentMonday = getMonday(new Date());

function getWeekDays() {
  const names = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(currentMonday);
    dt.setDate(currentMonday.getDate() + i);
    days.push({
      name: names[i],
      dayNum: dt.getDate(),
      monthShort: dt.toLocaleDateString('es-PE', { month: 'short' }),
      iso: formatISO(dt)
    });
  }
  return days;
}

function changeWeek(offsetDays) {
  currentMonday.setDate(currentMonday.getDate() + offsetDays);
  loadWeeklyGrid();
}

function resetToCurrentWeek() {
  currentMonday = getMonday(new Date());
  loadWeeklyGrid();
}

let weeklyDataCache = { students: [], records: [] };
let activeCellContext = null;
let attCategoryFilter = 'Todos';
let selectedAttGroupId = null;

function setAttCategoryFilter(cat) {
  attCategoryFilter = cat;
  document.querySelectorAll('.att-cat-btn').forEach(b => {
    b.className = 'att-cat-btn segmented-btn px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f]';
  });
  const active = document.getElementById(`att-cat-${cat}`);
  if (active) active.className = 'att-cat-btn segmented-btn px-3.5 py-1.5 rounded-lg text-[#1d1d1f]';
  updateSegmentedPill('attCategoryFilter', `att-cat-${cat}`);
  renderAttendanceGroupCards();
}

function renderAttendanceGroupCards() {
  const grid = document.getElementById('attClassroomCardsGrid');
  if (!grid) return;

  const visibleGroups = groupsCache.filter(g => {
    if (!isAdmin) return g.category === 'Sol Music';
    return attCategoryFilter === 'Todos' || g.category === attCategoryFilter;
  });

  if (!visibleGroups.length) {
    grid.innerHTML = '<p class="col-span-full text-xs text-[#6e6e73] text-center py-8">No hay subgrupos disponibles en esta modalidad.</p>';
    return;
  }

  grid.innerHTML = visibleGroups.map(g => {
    const isSol = g.category === 'Sol Music';
    return `
      <button type="button" onclick="selectAttendanceGroupCard(${g.id})"
        class="card-interactive text-left p-5 rounded-2xl bg-white/95 hover:bg-white border border-black/[0.07] shadow-sm flex flex-col justify-between gap-3">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isSol ? 'bg-amber-500/15 text-amber-800' : 'bg-indigo-500/10 text-indigo-700'}">${g.category || 'Particulares'}</span>
            <span class="px-2.5 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold">${g.student_count || 0} alumno(s)</span>
          </div>
          <h4 class="text-sm sm:text-base font-bold text-[#1d1d1f] leading-snug">${g.name}</h4>
          ${g.schedule ? `<p class="text-xs text-[#0071e3] font-medium"><i class="fa-regular fa-clock mr-1"></i>${g.schedule}</p>` : ''}
          ${g.description ? `<p class="text-xs text-[#6e6e73] line-clamp-2">${g.description}</p>` : ''}
        </div>
        <div class="pt-2 border-t border-black/[0.05] flex items-center justify-between text-xs font-semibold text-[#0071e3]">
          <span>Tomar asistencia</span>
          <i class="fa-solid fa-arrow-right text-[11px]"></i>
        </div>
      </button>
    `;
  }).join('');
}

function selectAttendanceGroupCard(groupId, pushHistory = true) {
  selectedAttGroupId = groupId ? Number(groupId) : null;
  const cardsView = document.getElementById('attCardsView');
  const workspace = document.getElementById('attGridWorkspace');
  const sel = document.getElementById('attGroupSelect');
  const searchInput = document.getElementById('attStudentSearch');
  if (searchInput) searchInput.value = '';

  if (selectedAttGroupId) {
    const grp = groupsCache.find(g => Number(g.id) === Number(selectedAttGroupId) && (isAdmin || g.category === 'Sol Music'));
    if (!grp) {
      selectedAttGroupId = null;
      return selectAttendanceGroupCard(null, pushHistory);
    }
    if (sel) sel.value = String(grp.id);
    document.getElementById('attSelectedGroupTitle').innerText = grp.name;
    document.getElementById('attSelectedGroupMeta').innerText = `${grp.category} • ${grp.student_count || 0} alumno(s)${grp.schedule ? ` • ${grp.schedule}` : ''}`;
    if (cardsView) cardsView.classList.add('hidden');
    if (workspace) workspace.classList.remove('hidden');
    loadWeeklyGrid();
  } else {
    if (cardsView) cardsView.classList.remove('hidden');
    if (workspace) workspace.classList.add('hidden');
    renderAttendanceGroupCards();
  }
  syncAdminUrl(pushHistory);
}

async function loadWeeklyGrid() {
  const groupId = document.getElementById('attGroupSelect').value;
  const days = getWeekDays();
  const startISO = days[0].iso;
  const endISO = days[6].iso;
  document.getElementById('weekRangeLabel').innerText = `${days[0].dayNum} ${days[0].monthShort} – ${days[6].dayNum} ${days[6].monthShort}`;

  const container = document.getElementById('weeklyGridContainer');
  if (!groupId) {
    container.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-10">Crea primero un grupo o subgrupo en "Subgrupos y Alumnado".</p>';
    return;
  }

  const res = await fetch(`/intranet/api/admin/weekly-attendance?group_id=${groupId}&start_date=${startISO}&end_date=${endISO}`, {
    headers: authHeaders()
  });
  weeklyDataCache = await res.json();

  if (!weeklyDataCache.students.length) {
    container.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-10">No hay alumnos asignados a este subgrupo todavía.</p>';
    return;
  }

  const todayISO = formatISO(new Date());

  let html = `
    <table class="hidden md:table w-full text-left border-collapse min-w-[780px]">
      <thead>
        <tr class="border-b border-black/[0.08] text-[11px] text-[#6e6e73]">
          <th class="py-3 px-3 font-semibold w-64">Estudiante / Horario</th>
          ${days.map(d => `
            <th class="py-3 px-1.5 text-center font-semibold ${d.iso === todayISO ? 'text-[#0071e3]' : ''}">
              <span class="block uppercase text-[10px]">${d.name}</span>
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full mt-0.5 ${d.iso === todayISO ? 'bg-[#0071e3] text-white' : 'text-[#1d1d1f]'}">${d.dayNum}</span>
            </th>
          `).join('')}
          <th class="py-3 px-3 text-right font-semibold w-28">Bloque Mes</th>
          <th class="py-3 px-2.5 text-center font-semibold w-28">Reforzamientos</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/[0.05] text-xs">
  `;

  let mobileCardsHtml = `<div class="md:hidden space-y-3.5">`;

  weeklyDataCache.students.forEach(stu => {
    const quota = stu.monthly_quota || 8;
    const used = stu.used_this_month || 0;
    const refCount = stu.ref_this_month || 0;
    const pct = Math.min(100, Math.round((used / quota) * 100));
    const barColor = used >= quota ? 'bg-red-500' : (used >= quota - 1 ? 'bg-amber-500' : 'bg-emerald-500');

    const weekRegularCount = weeklyDataCache.records.filter(r =>
      r.student_id === stu.student_id &&
      (r.session_type === 'Regular' || r.session_type === 'Recuperacion') &&
      ['Presente', 'Tardanza', 'Justificado'].includes(r.status)
    ).length;

    html += `
      <tr class="att-stu-item hover:bg-white/60 transition" data-stu-name="${stu.full_name.toLowerCase()} ${stu.code.toLowerCase()}">
        <td class="py-3.5 px-3">
          <p class="font-bold text-[#1d1d1f]">${stu.full_name}</p>
          <div class="flex flex-wrap items-center gap-2 mt-0.5">
            ${stu.schedule ? `<span class="text-[11px] text-[#0071e3] font-medium"><i class="fa-regular fa-clock mr-1"></i>${stu.schedule}</span>` : ''}
            ${weekRegularCount >= 3 ? `<span class="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 text-[10px] font-semibold">${weekRegularCount} clases esta semana</span>` : ''}
          </div>
        </td>
    `;

    mobileCardsHtml += `
      <div class="att-stu-item p-4 rounded-2xl bg-white/95 border border-black/[0.07] shadow-sm space-y-3" data-stu-name="${stu.full_name.toLowerCase()} ${stu.code.toLowerCase()}">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-sm font-bold text-[#1d1d1f]">${stu.full_name}</p>
            ${stu.schedule ? `<p class="text-[11px] text-[#0071e3] font-medium mt-0.5"><i class="fa-regular fa-clock mr-1"></i>${stu.schedule}</p>` : ''}
          </div>
          <div class="flex items-center gap-2.5 shrink-0">
            <div class="text-right">
              <span class="text-xs font-bold ${used >= quota ? 'text-red-600' : 'text-[#1d1d1f]'}">${used}/${quota}</span>
              <div class="w-16 h-1.5 bg-black/10 rounded-full overflow-hidden mt-1">
                <div class="h-full ${barColor}" style="width: ${pct}%"></div>
              </div>
            </div>
            <span class="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-700 text-[10px] font-bold" title="Reforzamientos del mes">
              <i class="fa-solid fa-bolt mr-0.5"></i>${refCount} ref.
            </span>
          </div>
        </div>
        <div class="grid grid-cols-7 gap-1 pt-1">
    `;

    days.forEach(d => {
      const dayRecs = weeklyDataCache.records.filter(r => r.student_id === stu.student_id && r.date === d.iso);
      const mainRec = dayRecs.find(r => r.session_type === 'Regular' || r.session_type === 'Recuperacion');
      const refRec = dayRecs.find(r => r.session_type === 'Reforzamiento');

      let cellBadge = `<span class="w-8 h-8 rounded-full border border-dashed border-black/15 text-black/25 group-hover:border-[#0071e3] group-hover:text-[#0071e3] inline-flex items-center justify-center transition"><i class="fa-solid fa-plus text-[10px]"></i></span>`;
      let mBtnStyle = 'bg-[#f5f5f7] border-black/10 text-[#6e6e73]';
      let mIcon = `<span class="text-[11px] font-bold">${d.dayNum}</span>`;
      let tooltip = 'Clic para marcar asistencia';

      if (mainRec) {
        tooltip = `${mainRec.session_type === 'Recuperacion' ? 'Recuperación' : mainRec.status}${mainRec.recorded_by_name ? ` • Marcado por: ${mainRec.recorded_by_name}` : ''}`;
        if (mainRec.session_type === 'Recuperacion') {
          cellBadge = `<span class="w-8 h-8 rounded-full bg-sky-500 text-white shadow-sm inline-flex items-center justify-center font-bold" title="${tooltip}"><i class="fa-solid fa-rotate-right text-xs"></i></span>`;
          mBtnStyle = 'bg-sky-500 border-sky-500 text-white';
          mIcon = '<i class="fa-solid fa-rotate-right text-xs"></i>';
        } else if (mainRec.status === 'Presente') {
          cellBadge = `<span class="w-8 h-8 rounded-full bg-emerald-500 text-white shadow-sm inline-flex items-center justify-center font-bold" title="${tooltip}"><i class="fa-solid fa-check text-xs"></i></span>`;
          mBtnStyle = 'bg-emerald-500 border-emerald-500 text-white';
          mIcon = '<i class="fa-solid fa-check text-xs"></i>';
        } else if (mainRec.status === 'Tardanza') {
          cellBadge = `<span class="w-8 h-8 rounded-full bg-amber-500 text-white shadow-sm inline-flex items-center justify-center font-bold" title="${tooltip}"><i class="fa-regular fa-clock text-xs"></i></span>`;
          mBtnStyle = 'bg-amber-500 border-amber-500 text-white';
          mIcon = '<i class="fa-regular fa-clock text-xs"></i>';
        } else if (mainRec.status === 'Falta') {
          cellBadge = `<span class="w-8 h-8 rounded-full bg-red-500 text-white shadow-sm inline-flex items-center justify-center font-bold" title="${tooltip}"><i class="fa-solid fa-xmark text-xs"></i></span>`;
          mBtnStyle = 'bg-red-500 border-red-500 text-white';
          mIcon = '<i class="fa-solid fa-xmark text-xs"></i>';
        }
      }

      const refPill = refRec
        ? `<span class="mt-1 px-1.5 py-0.5 rounded-md bg-purple-600 text-white text-[9px] font-bold leading-none"><i class="fa-solid fa-bolt"></i> ${refRec.arrival_time || 'Ref'}</span>`
        : '';

      html += `
        <td class="py-2.5 px-1 text-center align-middle">
          <button type="button" onclick="openCellModal(${stu.student_id}, '${d.iso}', '${d.name} ${d.dayNum} ${d.monthShort}')"
            class="group inline-flex flex-col items-center justify-center p-1 rounded-xl hover:bg-black/[0.04] transition">
            ${cellBadge}
            ${refPill}
          </button>
        </td>
      `;

      mobileCardsHtml += `
        <button type="button" onclick="openCellModal(${stu.student_id}, '${d.iso}', '${d.name} ${d.dayNum} ${d.monthShort}')"
          class="flex flex-col items-center justify-center py-2 rounded-xl border ${d.iso === todayISO && !mainRec ? 'border-[#0071e3] bg-[#0071e3]/5' : mBtnStyle} active:scale-95 transition">
          <span class="text-[9px] uppercase opacity-80">${d.name.slice(0,2)}</span>
          <span class="mt-0.5 h-5 flex items-center justify-center">${mIcon}</span>
          ${refRec ? '<span class="w-1.5 h-1.5 rounded-full bg-purple-600 mt-0.5"></span>' : ''}
        </button>
      `;
    });

    html += `
        <td class="py-3.5 px-3 text-right">
          <span class="text-xs font-bold ${used >= quota ? 'text-red-600' : 'text-[#1d1d1f]'}">${used}/${quota}</span>
          <div class="w-20 h-1.5 bg-black/10 rounded-full overflow-hidden ml-auto mt-1">
            <div class="h-full ${barColor}" style="width: ${pct}%"></div>
          </div>
        </td>
        <td class="py-3.5 px-2.5 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${refCount > 0 ? 'bg-purple-500/15 text-purple-800 border border-purple-500/20' : 'bg-black/[0.04] text-[#6e6e73]'} text-[11px] font-bold">
            <i class="fa-solid fa-bolt text-[10px]"></i> ${refCount} / mes
          </span>
        </td>
      </tr>
    `;
    mobileCardsHtml += `</div></div>`;
  });

  html += `</tbody></table>`;
  mobileCardsHtml += `</div>`;
  container.innerHTML = mobileCardsHtml + html;
}

function appendHoursNote(hoursText) {
  const inp = document.getElementById('modalNoteInput');
  if (!inp) return;
  const cur = inp.value.trim();
  if (!cur) {
    inp.value = hoursText;
  } else if (!cur.toLowerCase().includes(hoursText.toLowerCase())) {
    inp.value = `${hoursText} — ${cur}`;
  }
  inp.focus();
}

function appendRefHoursNote(hoursText) {
  const inp = document.getElementById('modalRefNoteInput');
  if (!inp) return;
  const cur = inp.value.trim();
  if (!cur) {
    inp.value = hoursText;
  } else if (!cur.toLowerCase().includes(hoursText.toLowerCase())) {
    inp.value = `${hoursText} — ${cur}`;
  }
  inp.focus();
}

function openCellModal(studentId, dateISO, dateLabel) {
  const stu = weeklyDataCache.students.find(s => s.student_id === studentId);
  if (!stu) return;
  const dayRecs = weeklyDataCache.records.filter(r => r.student_id === studentId && r.date === dateISO);
  const mainRec = dayRecs.find(r => r.session_type === 'Regular' || r.session_type === 'Recuperacion');
  const refRec = dayRecs.find(r => r.session_type === 'Reforzamiento');

  activeCellContext = {
    student_id: studentId,
    group_id: document.getElementById('attGroupSelect').value,
    date: dateISO
  };

  document.getElementById('modalDateBadge').innerText = dateLabel;
  document.getElementById('modalStudentName').innerText = stu.full_name;
  document.getElementById('modalNoteInput').value = mainRec ? (mainRec.note || '') : '';
  const refNoteEl = document.getElementById('modalRefNoteInput');
  if (refNoteEl) refNoteEl.value = refRec ? (refRec.note || '') : '';
  document.getElementById('modalArrivalInput').value = refRec ? (refRec.arrival_time || '') : '';

  const markerEl = document.getElementById('modalMarkerInfo');
  const markerName = (mainRec && mainRec.recorded_by_name) || (refRec && refRec.recorded_by_name);
  if (markerName) {
    markerEl.innerText = `Último registro marcado por: ${markerName}`;
    markerEl.classList.remove('hidden');
  } else {
    markerEl.classList.add('hidden');
  }

  const solBox = document.getElementById('cellSolMusicWaBox');
  const waTimeEl = document.getElementById('cellWaTimeBadge');
  const currentGroup = (typeof groupsCache !== 'undefined')
    ? groupsCache.find(g => String(g.id) === String(activeCellContext.group_id))
    : null;
  if (solBox) {
    if (currentGroup && currentGroup.category === 'Sol Music') {
      solBox.classList.remove('hidden');
      const arr = (mainRec && mainRec.arrival_time) || (refRec && refRec.arrival_time) || '';
      const dep = (mainRec && mainRec.departure_time) || (refRec && refRec.departure_time) || '';
      const parts = [];
      if (arr) parts.push(`Llegada: ${arr}`);
      if (dep) parts.push(`Salida: ${dep}`);
      if (waTimeEl) waTimeEl.textContent = parts.join(' • ');
    } else {
      solBox.classList.add('hidden');
    }
  }

  document.getElementById('cellModal').classList.remove('hidden');
}

function closeCellModal() {
  document.getElementById('cellModal').classList.add('hidden');
  activeCellContext = null;
}

async function saveCellAction(sessionType, status) {
  if (!activeCellContext) return;
  const note = document.getElementById('modalNoteInput').value.trim();

  if (status !== 'Clear' && (sessionType === 'Regular' || sessionType === 'Recuperacion')) {
    const otherType = sessionType === 'Regular' ? 'Recuperacion' : 'Regular';
    await fetch('/intranet/api/admin/attendance/cell', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ...activeCellContext, session_type: otherType, status: 'Clear' })
    });
  }

  const res = await fetch('/intranet/api/admin/attendance/cell', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...activeCellContext,
      session_type: sessionType,
      status,
      note
    })
  });

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.wa && data.wa.queued) {
      showToast(`Asistencia guardada y aviso de llegada (${data.arrival_time || ''}) enviado por WhatsApp`, 'success');
    }
    closeCellModal();
    loadWeeklyGrid();
  }
}

async function saveCellArrivalNotice() {
  if (!activeCellContext) return;
  const note = document.getElementById('modalNoteInput').value.trim();
  const res = await fetch('/intranet/api/admin/attendance/cell', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...activeCellContext,
      session_type: 'Regular',
      status: 'Presente',
      note,
      notify_arrival: true
    })
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    if (data.wa && data.wa.queued) {
      showToast(`Ingreso (${data.arrival_time}) y aviso WhatsApp enviados al apoderado`, 'success');
    } else {
      showToast(`Ingreso marcado (${data.arrival_time || ''}). ${data.wa?.reason || 'Sin envío WA'}`, 'info');
    }
    closeCellModal();
    loadWeeklyGrid();
  } else {
    showToast(data.error || 'Error al registrar ingreso', 'error');
  }
}

async function notifyCellExitAction() {
  if (!activeCellContext) return;
  const res = await fetch('/intranet/api/admin/attendance/notify-exit', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...activeCellContext,
      session_type: 'Regular'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    if (data.wa && data.wa.queued) {
      showToast(`Salida (${data.departure_time}) y aviso WhatsApp enviados al apoderado`, 'success');
    } else {
      showToast(`Salida registrada (${data.departure_time || ''}). ${data.wa?.reason || 'Sin envío WA'}`, 'info');
    }
    closeCellModal();
    loadWeeklyGrid();
  } else {
    showToast(data.error || 'Error al registrar salida', 'error');
  }
}

async function clearRegularAndRecup() {
  if (!activeCellContext) return;
  await fetch('/intranet/api/admin/attendance/cell', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...activeCellContext, session_type: 'Regular', status: 'Clear' })
  });
  await fetch('/intranet/api/admin/attendance/cell', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...activeCellContext, session_type: 'Recuperacion', status: 'Clear' })
  });
  closeCellModal();
  loadWeeklyGrid();
}

async function saveReforzamientoAction() {
  if (!activeCellContext) return;
  const arrival_time = document.getElementById('modalArrivalInput').value;
  const refNoteEl = document.getElementById('modalRefNoteInput');
  const note = refNoteEl ? refNoteEl.value.trim() : '';

  const res = await fetch('/intranet/api/admin/attendance/cell', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...activeCellContext,
      session_type: 'Reforzamiento',
      status: 'Reforzamiento',
      arrival_time,
      note
    })
  });

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.wa && data.wa.queued) {
      showToast(`Asistencia guardada y aviso de llegada (${data.arrival_time || ''}) enviado por WhatsApp`, 'success');
    }
    closeCellModal();
    loadWeeklyGrid();
  }
}

// ==================== EXPORTACIÓN DIARIA ====================
let lastDailySummaryData = { date: '', records: [] };

function openDailyExportModal() {
  const today = formatISO(new Date());
  document.getElementById('exportDatePicker').value = today;
  document.getElementById('mobileImageSaveBox').classList.add('hidden');
  document.getElementById('capturePreviewWrapper').classList.remove('hidden');
  document.getElementById('dailyExportModal').classList.remove('hidden');
  loadDailyExportPreview();
}

function backToReportEditor() {
  document.getElementById('mobileImageSaveBox').classList.add('hidden');
  document.getElementById('capturePreviewWrapper').classList.remove('hidden');
}

function closeDailyExportModal() {
  document.getElementById('dailyExportModal').classList.add('hidden');
}

async function loadDailyExportPreview() {
  const dateStr = document.getElementById('exportDatePicker').value;
  if (!dateStr) return;

  const [y, m, d] = dateStr.split('-').map(Number);
  const localDate = new Date(y, m - 1, d);
  const formatted = localDate.toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  document.getElementById('capDateFormatted').innerText = formatted;
  document.getElementById('capGeneratedBy').innerText = `Emitido por: ${currentUserName}`;
  document.getElementById('capScopeBadge').innerText = isAdmin ? 'DC CORP • Particulares y Sol Music' : 'Sol Music • Academia';
  document.getElementById('capTimestamp').innerText = `Generado: ${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;

  const res = await fetch(`/intranet/api/admin/daily-summary?date=${dateStr}`, { headers: authHeaders() });
  lastDailySummaryData = await res.json();
  const recs = lastDailySummaryData.records || [];

  const totalPresentes = recs.filter(r => r.session_type !== 'Reforzamiento' && r.status === 'Presente').length;
  const totalRecup = recs.filter(r => r.session_type === 'Recuperacion').length;
  const totalFaltasTard = recs.filter(r => r.session_type !== 'Reforzamiento' && (r.status === 'Falta' || r.status === 'Tardanza')).length;
  const totalRef = recs.filter(r => r.session_type === 'Reforzamiento').length;

  document.getElementById('capStatsRow').innerHTML = `
    <div style="padding: 12px; border-radius: 12px; background-color: #ecfdf5; border: 1px solid #a7f3d0;">
      <span style="display: block; font-size: 18px; font-weight: 700; color: #047857; line-height: 1.2;">${totalPresentes}</span>
      <span style="display: block; font-size: 10px; font-weight: 600; color: #065f46; margin-top: 2px; line-height: 1.2;">Presentes</span>
    </div>
    <div style="padding: 12px; border-radius: 12px; background-color: #f0f9ff; border: 1px solid #bae6fd;">
      <span style="display: block; font-size: 18px; font-weight: 700; color: #0369a1; line-height: 1.2;">${totalRecup}</span>
      <span style="display: block; font-size: 10px; font-weight: 600; color: #075985; margin-top: 2px; line-height: 1.2;">Recuperaciones</span>
    </div>
    <div style="padding: 12px; border-radius: 12px; background-color: #faf5ff; border: 1px solid #e9d5ff;">
      <span style="display: block; font-size: 18px; font-weight: 700; color: #7e22ce; line-height: 1.2;">${totalRef}</span>
      <span style="display: block; font-size: 10px; font-weight: 600; color: #6b21a8; margin-top: 2px; line-height: 1.2;">Reforzamientos</span>
    </div>
    <div style="padding: 12px; border-radius: 12px; background-color: #fef2f2; border: 1px solid #fecaca;">
      <span style="display: block; font-size: 18px; font-weight: 700; color: #b91c1c; line-height: 1.2;">${totalFaltasTard}</span>
      <span style="display: block; font-size: 10px; font-weight: 600; color: #991b1b; margin-top: 2px; line-height: 1.2;">Faltas / Tard.</span>
    </div>
  `;

  const container = document.getElementById('capRecordsContainer');
  if (!recs.length) {
    container.innerHTML = `<div style="padding: 40px 0; text-align: center; font-size: 12px; color: #6e6e73; background-color: #f5f5f7; border-radius: 16px;">No hay asistencias registradas para esta fecha.</div>`;
    return;
  }

  const grouped = {};
  recs.forEach(r => {
    const key = `${r.category || 'Particulares'} — ${r.group_name || 'Sin grupo'}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  container.innerHTML = Object.entries(grouped).map(([groupTitle, items]) => `
    <div style="border-radius: 16px; border: 1px solid rgba(0,0,0,0.08); overflow: hidden;">
      <div style="background-color: #f5f5f7; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(0,0,0,0.06);">
        <span style="font-size: 12px; font-weight: 700; color: #1d1d1f; line-height: 1.3;">${groupTitle}</span>
        <span style="font-size: 10px; font-weight: 600; color: #6e6e73; white-space: nowrap;">${items.length} registro(s)</span>
      </div>
      <div>
        ${items.map((item, idx) => {
          const isRef = item.session_type === 'Reforzamiento';
          const isRec = item.session_type === 'Recuperacion';
          const statusText = isRef
            ? `Reforzamiento${item.arrival_time ? ` (${item.arrival_time})` : ''}`
            : (isRec ? 'Recuperación' : item.status);
          const styleKey = isRef ? 'Reforzamiento' : (isRec ? 'Recuperacion' : item.status);
          const borderTop = idx > 0 ? 'border-top: 1px solid rgba(0,0,0,0.05);' : '';

          const badgeInlineColors = {
            'Presente': 'background-color:#d1fae5;color:#065f46;border-color:#a7f3d0;',
            'Recuperacion': 'background-color:#e0f2fe;color:#075985;border-color:#bae6fd;',
            'Tardanza': 'background-color:#fef3c7;color:#92400e;border-color:#fde68a;',
            'Falta': 'background-color:#fee2e2;color:#991b1b;border-color:#fecaca;',
            'Justificado': 'background-color:#e0f2fe;color:#075985;border-color:#bae6fd;',
            'Reforzamiento': 'background-color:#f3e8ff;color:#6b21a8;border-color:#e9d5ff;'
          };
          const badgeStyle = badgeInlineColors[styleKey] || 'background-color:#f3f4f6;color:#1f2937;border-color:#e5e7eb;';

          return `
            <div style="padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 12px; ${borderTop}">
              <div style="min-width: 0;">
                <p style="font-weight: 600; color: #1d1d1f; line-height: 1.3; margin: 0;">${item.student_name}</p>
                <p style="font-size: 10px; color: #6e6e73; margin-top: 2px; line-height: 1.3;">
                  Bloque mes: <strong>${item.used_this_month || 0}/${item.monthly_quota || 8}</strong>
                  ${item.recorded_by_name ? ` • Marcado por: <strong>${item.recorded_by_name}</strong>` : ''}
                  ${item.note ? ` • "${item.note}"` : ''}
                </p>
              </div>
              <span style="display: inline-block; border-width: 1px; border-style: solid; border-radius: 8px; padding: 4px 11px; font-size: 11px; font-weight: 700; line-height: 1.2; white-space: nowrap; flex-shrink: 0; ${badgeStyle}">
                ${statusText}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

async function sendDailyReportWhatsApp() {
  const dateStr = document.getElementById('exportDatePicker').value || formatISO(new Date());
  const recs = lastDailySummaryData.records || [];
  if (!recs.length) {
    showToast('No hay asistencias registradas para esta fecha.', "error");
    return;
  }

  const scope = isAdmin ? 'DC CORP (Particulares y Sol Music)' : 'Sol Music Academia';
  let lines = [
    `*REPORTE DE ASISTENCIAS — ${scope}*`,
    `Fecha: *${dateStr}*`,
    `Emitido por: ${currentUserName}`,
    ''
  ];

  const grouped = {};
  recs.forEach(r => {
    const key = `${r.category || 'Particulares'} - ${r.group_name || 'Sin grupo'}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  Object.entries(grouped).forEach(([grp, items]) => {
    lines.push(`*${grp}:*`);
    items.forEach(i => {
      const st = i.session_type === 'Reforzamiento'
        ? `Reforzamiento${i.arrival_time ? ` (${i.arrival_time})` : ''}`
        : (i.session_type === 'Recuperacion' ? 'Recuperación' : i.status);
      const marker = i.recorded_by_name ? ` | Prof: ${i.recorded_by_name}` : '';
      lines.push(`• ${i.student_name}: *${st}* (Bloque ${i.used_this_month || 0}/${i.monthly_quota || 8}${marker})`);
    });
    lines.push('');
  });

  lines.push('Portal: https://dccorp.lat/intranet');
  const fullText = lines.join('\n');

  try {
    const linkRes = await fetch('/intranet/api/whatsapp/linked', { headers: { Authorization: `Bearer ${token}` } });
    if (linkRes.ok) {
      const linkData = await linkRes.json();
      if (linkData.connected) {
        const target = prompt('Ingresa el número de WhatsApp destino (o deja el número vinculado):', linkData.phoneNumber || '');
        if (target && target.trim()) {
          const sendRes = await fetch('/intranet/api/whatsapp/send', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ phone: target.trim(), message: fullText })
          });
          const sendData = await sendRes.json().catch(() => ({}));
          if (sendRes.ok) {
            showToast(`Reporte enviado por instancia WhatsApp (+${sendData.from || linkData.phoneNumber})`, 'success');
            return;
          }
        }
      }
    }
  } catch {}

  window.open(`https://wa.me/?text=${encodeURIComponent(fullText)}`, '_blank');
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapCanvasLines(ctx, text, maxWidth) {
  if (!text) return [];
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function loadLogoImageForCanvas(targetHeight) {
  try {
    const resp = await fetch('/logo.svg');
    const svgText = await resp.text();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = svgUrl; });
    const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 4.04;
    const w = Math.round(targetHeight * aspect);
    // Rasterize at 2x so the logo stays crisp on Retina canvas
    const tmp = document.createElement('canvas');
    tmp.width = w * 2;
    tmp.height = targetHeight * 2;
    tmp.getContext('2d').drawImage(img, 0, 0, tmp.width, tmp.height);
    URL.revokeObjectURL(svgUrl);
    return { canvas: tmp, width: w, height: targetHeight };
  } catch (e) {
    console.warn('No se pudo cargar /logo.svg para canvas:', e);
    return null;
  }
}

async function renderDailyReportCanvas(dateStr) {
  const W = 720;
  const PAD = 28;
  const INNER_W = W - PAD * 2; // 664
  const SCALE = 2;
  const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, sans-serif";

  const [yNum, mNum, dNum] = dateStr.split('-').map(Number);
  const localDate = new Date(yNum, mNum - 1, dNum);
  const rawFormatted = localDate.toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const formattedDate = rawFormatted.replace(/\b\w/g, c => c.toUpperCase());
  const issuedBy = `Emitido por: ${currentUserName}`;
  const scopeLabel = isAdmin ? 'DC CORP • Particulares y Sol Music' : 'Sol Music • Academia';
  const generatedAt = `Generado: ${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;

  const recs = lastDailySummaryData.records || [];
  const totalPresentes = recs.filter(r => r.session_type !== 'Reforzamiento' && r.status === 'Presente').length;
  const totalRecup = recs.filter(r => r.session_type === 'Recuperacion').length;
  const totalFaltasTard = recs.filter(r => r.session_type !== 'Reforzamiento' && (r.status === 'Falta' || r.status === 'Tardanza')).length;
  const totalRef = recs.filter(r => r.session_type === 'Reforzamiento').length;

  const grouped = {};
  recs.forEach(r => {
    const key = `${r.category || 'Particulares'} — ${r.group_name || 'Sin grupo'}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });
  const groupEntries = Object.entries(grouped);

  const badgePalette = {
    'Presente': { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
    'Recuperacion': { bg: '#e0f2fe', text: '#075985', border: '#bae6fd' },
    'Tardanza': { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
    'Falta': { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
    'Justificado': { bg: '#e0f2fe', text: '#075985', border: '#bae6fd' },
    'Reforzamiento': { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' }
  };

  // Pre-measure layout using a scratch context
  const measureCvs = document.createElement('canvas');
  const mCtx = measureCvs.getContext('2d');

  const headerH = 66;
  const statsH = 62;
  const statsGapTop = 18;
  const recordsGapTop = 20;

  const groupLayouts = groupEntries.map(([groupTitle, items]) => {
    const rowLayouts = items.map(item => {
      const isRef = item.session_type === 'Reforzamiento';
      const isRec = item.session_type === 'Recuperacion';
      const statusText = isRef
        ? `Reforzamiento${item.arrival_time ? ` (${item.arrival_time})` : ''}`
        : (isRec ? 'Recuperación' : item.status);
      const styleKey = isRef ? 'Reforzamiento' : (isRec ? 'Recuperacion' : item.status);

      mCtx.font = `700 11px ${FONT}`;
      const badgeW = Math.ceil(mCtx.measureText(statusText).width) + 22;
      const textMaxW = INNER_W - 32 - badgeW - 14;

      const metaParts = [
        `Bloque mes: ${item.used_this_month || 0}/${item.monthly_quota || 8}`,
        item.recorded_by_name ? `Marcado por: ${item.recorded_by_name}` : null,
        item.note ? `"${item.note}"` : null
      ].filter(Boolean).join(' • ');

      mCtx.font = `400 10.5px ${FONT}`;
      const metaLines = wrapCanvasLines(mCtx, metaParts, textMaxW);
      const rowH = Math.max(54, 12 + 17 + metaLines.length * 14 + 12);

      return { item, statusText, styleKey, badgeW, metaLines, rowH };
    });

    const groupHeaderH = 38;
    const bodyH = rowLayouts.reduce((acc, r) => acc + r.rowH, 0);
    return { groupTitle, rowLayouts, groupHeaderH, totalH: groupHeaderH + bodyH };
  });

  const recordsBlockH = groupLayouts.length
    ? groupLayouts.reduce((acc, g, idx) => acc + g.totalH + (idx > 0 ? 14 : 0), 0)
    : 84;

  const footerGapTop = 20;
  const footerH = 28;
  const totalH = PAD + headerH + statsGapTop + statsH + recordsGapTop + recordsBlockH + footerGapTop + footerH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = totalH * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // Solid white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, totalH);

  // Subtle outer card border
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  roundRectPath(ctx, 0.5, 0.5, W - 1, totalH - 1, 14);
  ctx.stroke();

  // 1. HEADER
  let y = PAD;
  const logo = await loadLogoImageForCanvas(44);
  let titleX = PAD;
  if (logo) {
    ctx.drawImage(logo.canvas, PAD, y + (48 - logo.height) / 2, logo.width, logo.height);
    titleX = PAD + logo.width + 16;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1d1d1f';
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText('Reporte Diario de Asistencias', titleX, y + 14);

  // Scope pill
  ctx.font = `700 10px ${FONT}`;
  const scopeW = Math.ceil(ctx.measureText(scopeLabel).width) + 18;
  const scopeX = titleX;
  const scopeY = y + 27;
  const scopeH = 20;
  ctx.fillStyle = '#e0f2fe';
  roundRectPath(ctx, scopeX, scopeY, scopeW, scopeH, 6);
  ctx.fill();
  ctx.fillStyle = '#0369a1';
  ctx.textBaseline = 'middle';
  ctx.fillText(scopeLabel, scopeX + 9, scopeY + scopeH / 2 + 0.5);

  // Right date & issuer
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1d1d1f';
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(formattedDate, W - PAD, y + 15);
  ctx.fillStyle = '#6e6e73';
  ctx.font = `400 11px ${FONT}`;
  ctx.fillText(issuedBy, W - PAD, y + 34);

  // Header divider
  y += headerH;
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 4);
  ctx.lineTo(W - PAD, y - 4);
  ctx.stroke();

  // 2. STATS ROW (4 cards)
  y += statsGapTop - 4;
  const statCards = [
    { val: totalPresentes, label: 'Presentes', bg: '#ecfdf5', border: '#a7f3d0', numColor: '#047857', lblColor: '#065f46' },
    { val: totalRecup, label: 'Recuperaciones', bg: '#f0f9ff', border: '#bae6fd', numColor: '#0369a1', lblColor: '#075985' },
    { val: totalRef, label: 'Reforzamientos', bg: '#faf5ff', border: '#e9d5ff', numColor: '#7e22ce', lblColor: '#6b21a8' },
    { val: totalFaltasTard, label: 'Faltas / Tard.', bg: '#fef2f2', border: '#fecaca', numColor: '#b91c1c', lblColor: '#991b1b' }
  ];
  const gap = 10;
  const cardW = (INNER_W - gap * 3) / 4;
  statCards.forEach((sc, i) => {
    const cx = PAD + i * (cardW + gap);
    ctx.fillStyle = sc.bg;
    roundRectPath(ctx, cx, y, cardW, statsH, 12);
    ctx.fill();
    ctx.strokeStyle = sc.border;
    ctx.lineWidth = 1;
    roundRectPath(ctx, cx + 0.5, y + 0.5, cardW - 1, statsH - 1, 12);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sc.numColor;
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(String(sc.val), cx + cardW / 2, y + 23);
    ctx.fillStyle = sc.lblColor;
    ctx.font = `600 10px ${FONT}`;
    ctx.fillText(sc.label, cx + cardW / 2, y + 44);
  });

  // 3. RECORDS LIST
  y += statsH + recordsGapTop;
  if (!groupLayouts.length) {
    ctx.fillStyle = '#f5f5f7';
    roundRectPath(ctx, PAD, y, INNER_W, 84, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#6e6e73';
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText('No hay asistencias registradas para esta fecha.', W / 2, y + 42);
    y += 84;
  } else {
    groupLayouts.forEach((grp, gIdx) => {
      if (gIdx > 0) y += 14;
      const gx = PAD;
      const gy = y;

      // Group card background + clipped header
      ctx.save();
      roundRectPath(ctx, gx, gy, INNER_W, grp.totalH, 16);
      ctx.clip();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(gx, gy, INNER_W, grp.totalH);

      // Group header background
      ctx.fillStyle = '#f5f5f7';
      ctx.fillRect(gx, gy, INNER_W, grp.groupHeaderH);

      // Group header bottom border
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, gy + grp.groupHeaderH);
      ctx.lineTo(gx + INNER_W, gy + grp.groupHeaderH);
      ctx.stroke();

      // Group header text
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1d1d1f';
      ctx.font = `700 12px ${FONT}`;
      ctx.fillText(grp.groupTitle, gx + 16, gy + grp.groupHeaderH / 2);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#6e6e73';
      ctx.font = `600 10px ${FONT}`;
      ctx.fillText(`${grp.rowLayouts.length} registro(s)`, gx + INNER_W - 16, gy + grp.groupHeaderH / 2);

      // Rows
      let ry = gy + grp.groupHeaderH;
      grp.rowLayouts.forEach((row, rIdx) => {
        if (rIdx > 0) {
          ctx.strokeStyle = 'rgba(0,0,0,0.06)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(gx, ry);
          ctx.lineTo(gx + INNER_W, ry);
          ctx.stroke();
        }

        // Student name
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1d1d1f';
        ctx.font = `600 12px ${FONT}`;
        ctx.fillText(row.item.student_name || '', gx + 16, ry + 20);

        // Meta lines
        ctx.fillStyle = '#6e6e73';
        ctx.font = `400 10.5px ${FONT}`;
        row.metaLines.forEach((line, lIdx) => {
          ctx.fillText(line, gx + 16, ry + 36 + lIdx * 14);
        });

        // Status badge on the right
        const pal = badgePalette[row.styleKey] || { bg: '#f3f4f6', text: '#1f2937', border: '#e5e7eb' };
        const badgeH = 24;
        const bx = gx + INNER_W - 16 - row.badgeW;
        const by = ry + (row.rowH - badgeH) / 2;

        ctx.fillStyle = pal.bg;
        roundRectPath(ctx, bx, by, row.badgeW, badgeH, 8);
        ctx.fill();
        ctx.strokeStyle = pal.border;
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 0.5, by + 0.5, row.badgeW - 1, badgeH - 1, 8);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = pal.text;
        ctx.font = `700 11px ${FONT}`;
        ctx.fillText(row.statusText, bx + row.badgeW / 2, by + badgeH / 2 + 0.5);

        ry += row.rowH;
      });

      ctx.restore();

      // Group card border
      ctx.strokeStyle = 'rgba(0,0,0,0.09)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, gx + 0.5, gy + 0.5, INNER_W - 1, grp.totalH - 1, 16);
      ctx.stroke();

      y += grp.totalH;
    });
  }

  // 4. FOOTER
  y += footerGapTop;
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#6e6e73';
  ctx.font = `400 10px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('DC CORP • Plataforma Académica (dccorp.lat/intranet)', PAD, y + 18);
  ctx.textAlign = 'right';
  ctx.fillText(generatedAt, W - PAD, y + 18);

  return canvas;
}

async function downloadDailyPng() {
  const btn = document.getElementById('btnDownloadPng');
  const dateStr = document.getElementById('exportDatePicker').value || formatISO(new Date());
  const fileName = `Asistencias_DCCORP_${dateStr}.png`;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando...';

  try {
    const canvas = await renderDailyReportCanvas(dateStr);

    canvas.toBlob(async (blob) => {
      if (!blob) throw new Error('No se pudo generar la imagen');
      const blobUrl = URL.createObjectURL(blob);

      const saveBox = document.getElementById('mobileImageSaveBox');
      const prevImg = document.getElementById('generatedPreviewImg');
      const dlLink = document.getElementById('directBlobDownloadLink');
      prevImg.src = blobUrl;
      dlLink.href = blobUrl;
      dlLink.download = fileName;
      document.getElementById('capturePreviewWrapper').classList.add('hidden');
      saveBox.classList.remove('hidden');

      const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      const fileObj = new File([blob], fileName, { type: 'image/png' });

      if (isMobileDevice && navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        try {
          await navigator.share({
            files: [fileObj],
            title: `Reporte Asistencias ${dateStr}`
          });
          return;
        } catch {}
      }

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 'image/png');
  } catch (err) {
    console.error(err);
    showToast('Error al generar la imagen', "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-download"></i> Guardar / Compartir PNG';
  }
}


function filterAttendanceStudents() {
  const q = (document.getElementById('attStudentSearch')?.value || '').trim().toLowerCase();
  document.querySelectorAll('.att-stu-item').forEach(el => {
    const hay = el.dataset.stuName || '';
    el.classList.toggle('hidden', q && !hay.includes(q));
  });
}


function filterAttendanceStudents() {
  const q = (document.getElementById('attStudentSearch')?.value || '').trim().toLowerCase();
  document.querySelectorAll('.att-stu-item').forEach(el => {
    const hay = el.dataset.stuName || '';
    el.classList.toggle('hidden', q && !hay.includes(q));
  });
}
