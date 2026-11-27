// ==================== MATERIALES + TARJETAS DE CLASE ====================
function cleanDisplayName(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(escape(str));
  } catch {
    return str;
  }
}

function renderAttachmentAdmin(f) {
  const fileUrl = `/intranet/api/files/${f.file_name}?token=${token}`;
  if (f.file_type === 'pdf') {
    return `
      <div class="p-2.5 rounded-xl bg-[#f5f5f7] border border-black/[0.06] flex items-center justify-between gap-2">
        <div class="min-w-0">
          <span class="px-2 py-0.5 rounded-md bg-red-500/10 text-red-700 text-[10px] font-bold">${f.label}</span>
          <p class="text-xs font-medium text-[#1d1d1f] truncate mt-0.5">${cleanDisplayName(f.original_name)}</p>
        </div>
        <button type="button" onclick="openPdfModal('${fileUrl}', '${f.label} — ${f.original_name.replace(/'/g, '')}')"
          class="px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold shrink-0 transition">
          <i class="fa-solid fa-eye mr-1"></i> Ver PDF
        </button>
      </div>
    `;
  } else if (f.file_type === 'audio') {
    return `
      <div class="p-2.5 rounded-xl bg-[#f5f5f7] border border-black/[0.06] space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-700 text-[10px] font-bold"><i class="fa-solid fa-headphones mr-1"></i>${f.label}</span>
          <span class="text-[11px] text-[#6e6e73] truncate">${cleanDisplayName(f.original_name)}</span>
        </div>
        <audio controls preload="none" src="${fileUrl}" class="w-full h-8"></audio>
      </div>
    `;
  } else {
    return `
      <div class="p-2.5 rounded-xl bg-[#f5f5f7] border border-black/[0.06] flex items-center justify-between gap-2">
        <span class="text-xs font-medium truncate"><strong class="text-[#0071e3]">[${f.label}]</strong> ${cleanDisplayName(f.original_name)}</span>
        <a href="${fileUrl}" target="_blank" class="text-[#0071e3] text-xs font-semibold hover:underline shrink-0">Descargar</a>
      </div>
    `;
  }
}

function openImageModal(imgUrl, title) {
  document.getElementById('imgModalTitle').innerText = title || 'Imagen de resolución';
  document.getElementById('imgViewerTag').src = imgUrl;
  document.getElementById('imgDownloadLink').href = imgUrl;
  document.getElementById('imageViewerModal').classList.remove('hidden');
}

function closeImageModal() {
  document.getElementById('imageViewerModal').classList.add('hidden');
  document.getElementById('imgViewerTag').src = '';
}

function getGradeEquivalence(rawScore) {
  const n = parseFloat(rawScore);
  if (isNaN(n) || n < 0 || n > 20) {
    return {
      valid: false,
      letter: '—',
      label: 'Ingresa 0 – 20',
      badgeClass: 'bg-black/5 text-[#6e6e73] border-black/10',
      trophy: false
    };
  }
  if (n >= 18) {
    return {
      valid: true,
      letter: 'AD',
      label: 'Excelente / Logro destacado',
      badgeClass: 'bg-emerald-600 text-white border-emerald-700',
      trophy: true
    };
  }
  if (n >= 14) {
    return {
      valid: true,
      letter: 'A',
      label: 'Bueno / Logro esperado',
      badgeClass: 'bg-emerald-500 text-white border-emerald-600',
      trophy: false
    };
  }
  if (n >= 11) {
    return {
      valid: true,
      letter: 'B',
      label: 'Regular / En proceso',
      badgeClass: 'bg-amber-400 text-amber-950 border-amber-500',
      trophy: false
    };
  }
  return {
    valid: true,
    letter: 'C',
    label: 'Deficiente / En inicio',
    badgeClass: 'bg-red-600 text-white border-red-700',
    trophy: false
  };
}

function updateGradePreviewBadge(subId) {
  const inp = document.getElementById(`gradeScore-${subId}`);
  const badge = document.getElementById(`gradeEquivBadge-${subId}`);
  if (!inp || !badge) return;
  const eq = getGradeEquivalence(inp.value);
  badge.className = `px-3 py-1.5 rounded-xl border text-[11px] font-bold inline-flex items-center gap-1.5 transition ${eq.badgeClass}`;
  badge.innerHTML = `${eq.trophy ? '<i class="fa-solid fa-trophy"></i>' : ''}<span>${eq.letter} • ${eq.label}</span>`;
}

function renderSubmissionsAdmin(mat) {
  const subs = mat.submissions || [];
  if (Number(mat.evaluation_enabled) !== 1 && !subs.length) return '';
  const expectedStudents = (studentsCache || []).filter(s => {
    const inGroup = (s.group_ids || []).includes(Number(mat.group_id)) || Number(s.group_id) === Number(mat.group_id);
    if (!inGroup) return false;
    if (mat.category === 'Particulares' && mat.target_grade && mat.target_grade !== 'Todos') {
      const sg = (s.grade || '').trim();
      if (sg && sg !== mat.target_grade) return false;
    }
    return true;
  });
  const submittedIds = new Set(subs.map(sb => Number(sb.student_id)));
  const pendingStudents = expectedStudents.filter(s => !submittedIds.has(Number(s.id)));

  if (!subs.length && !pendingStudents.length) return '';

  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/[0.06]">
        <p class="text-xs font-bold text-[#1d1d1f]"><i class="fa-solid fa-clipboard-check mr-1.5 text-emerald-600"></i>Control de Entregas</p>
        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700"><i class="fa-solid fa-check mr-1"></i>Entregaron: ${subs.length}</span>
          <span class="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800"><i class="fa-regular fa-clock mr-1"></i>Faltan: ${pendingStudents.length}</span>
        </div>
      </div>

      ${subs.length ? `
        <div class="space-y-2.5">
          <p class="text-xs font-bold text-indigo-700"><i class="fa-solid fa-file-circle-check mr-1.5"></i>Resoluciones entregadas (${subs.length})</p>
          ${subs.map(sb => {
            const sFiles = (sb.files && sb.files.length)
              ? sb.files
              : (sb.file_name ? [{ id: sb.id, file_name: sb.file_name, original_name: sb.original_name, file_type: (sb.original_name || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'image' }] : []);
            const scoreVal = (sb.grade_score !== null && sb.grade_score !== undefined) ? sb.grade_score : '';
            const eq = getGradeEquivalence(scoreVal);

            const filesButtonsHtml = sFiles.map((sf, idx) => {
              const fUrl = `/intranet/api/files/${sf.file_name}?token=${token}`;
              const cleanN = cleanDisplayName(sf.original_name || `Archivo ${idx + 1}`).replace(/'/g, '');
              if (sf.file_type === 'pdf') {
                return `<button type="button" onclick="openPdfModal('${fUrl}', '${cleanN}')" class="btn-interactive px-2.5 py-1 rounded-full bg-red-600 text-white text-[10px] font-semibold inline-flex items-center gap-1"><i class="fa-solid fa-file-pdf"></i> PDF ${idx + 1}</button>`;
              }
              return `<button type="button" onclick="openImageModal('${fUrl}', '${cleanN}')" class="btn-interactive px-2.5 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold inline-flex items-center gap-1"><i class="fa-solid fa-image"></i> Ver Imagen ${idx + 1}</button>`;
            }).join('');

            return `
              <div class="p-3 rounded-xl bg-indigo-500/[0.05] border border-indigo-500/15 space-y-2.5 text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span class="font-bold text-[#1d1d1f]">${sb.student_name || 'Estudiante'}</span>
                    ${sb.student_grade ? `<span class="ml-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 text-[10px] font-semibold">${sb.student_grade}</span>` : ''}
                    <p class="text-[11px] text-[#6e6e73] mt-0.5">${sFiles.length} archivo(s) adjunto(s)</p>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">${filesButtonsHtml}</div>
                </div>
                <div class="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 pt-1">
                  <div class="flex items-center gap-1.5 bg-white border border-black/10 rounded-lg px-2.5 py-1">
                    <span class="text-[11px] font-semibold text-[#6e6e73]">Nota (0-20):</span>
                    <input type="number" id="gradeScore-${sb.id}" min="0" max="20" step="0.5" value="${scoreVal}" placeholder="0 - 20"
                      oninput="updateGradePreviewBadge(${sb.id})"
                      class="w-16 text-xs font-bold text-[#1d1d1f] focus:outline-none">
                  </div>
                  <span id="gradeEquivBadge-${sb.id}" class="px-3 py-1.5 rounded-xl border text-[11px] font-bold inline-flex items-center gap-1.5 ${eq.badgeClass}">
                    ${eq.trophy ? '<i class="fa-solid fa-trophy"></i>' : ''}<span>${eq.letter} • ${eq.label}</span>
                  </span>
                  <input type="text" id="gradeFeedback-${sb.id}" value="${(sb.feedback || '').replace(/"/g, '&quot;')}"
                    placeholder="Observación o retroalimentación..."
                    class="flex-1 min-w-[160px] bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs">
                  <button type="button" onclick="saveSubmissionGrade(${sb.id})"
                    class="btn-interactive px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold shrink-0">
                    Guardar Nota
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : '<p class="text-xs text-[#6e6e73] py-2">Ningún estudiante ha enviado entregas todavía.</p>'}

      ${pendingStudents.length ? `
        <div class="pt-3 border-t border-black/[0.06] space-y-2">
          <p class="text-xs font-bold text-amber-800"><i class="fa-regular fa-clock mr-1.5"></i>Faltan por entregar (${pendingStudents.length})</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto aurora-scroll pr-1">
            ${pendingStudents.map(ps => `
              <div class="card-interactive flex items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 text-xs">
                <div class="min-w-0">
                  <p class="font-semibold text-[#1d1d1f] truncate">${ps.full_name}</p>
                  <span class="text-[10px] text-[#6e6e73]">${isMusicStudent(ps) ? (ps.instrument || 'Música') : (ps.grade || 'Matemáticas')}</span>
                </div>
                <button type="button" onclick="openStudentDetailModal(${ps.id})"
                  class="btn-interactive shrink-0 px-2.5 py-1 rounded-lg bg-white border border-black/10 text-[10px] font-semibold text-[#1d1d1f]">
                  Ver perfil
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : (subs.length ? '<div class="p-3 rounded-xl bg-emerald-500/10 text-emerald-700 text-xs font-semibold text-center"><i class="fa-solid fa-circle-check mr-1.5"></i>¡Todos los alumnos de este grupo ya entregaron!</div>' : '')}
    </div>
  `;
}

async function saveSubmissionGrade(subId) {
  const scoreEl = document.getElementById(`gradeScore-${subId}`);
  const fbEl = document.getElementById(`gradeFeedback-${subId}`);
  const grade_score = parseFloat(scoreEl.value);
  if (isNaN(grade_score) || grade_score < 0 || grade_score > 20) {
    showToast('Ingresa una nota válida entre 0 y 20', "error");
    return;
  }

  const res = await fetch(`/intranet/api/admin/submissions/${subId}/grade`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ grade_score, feedback: fbEl.value })
  });

  if (res.ok) {
    showToast('Calificación guardada', "success");
    loadMaterials();
  } else {
    const d = await res.json();
    showToast(d.error || 'Error al guardar nota', "error");
  }
}

function renderConsultasAdmin(mat) {
  const consultas = mat.consultas || [];
  if (!consultas.length) return `<div id="consultasContainer-${mat.id}"></div>`;

  const byStudent = {};
  consultas.forEach(c => {
    if (!byStudent[c.student_id]) {
      byStudent[c.student_id] = { student_name: c.student_name || 'Estudiante', messages: [] };
    }
    byStudent[c.student_id].messages.push(c);
  });

  return `
    <div id="consultasContainer-${mat.id}" class="pt-3 border-t border-black/[0.07] space-y-3">
      <p class="text-xs font-bold text-[#0071e3]"><i class="fa-solid fa-comments mr-1.5"></i>Consultas en vivo (${Object.keys(byStudent).length})</p>
      ${Object.entries(byStudent).map(([stuId, thread]) => `
        <div class="p-3 rounded-xl bg-[#0071e3]/[0.05] border border-[#0071e3]/15 space-y-2">
          <p class="text-[11px] font-bold text-[#1d1d1f]">Alumno: ${thread.student_name}</p>
          <div class="space-y-1.5">
            ${thread.messages.map(msg => {
              const isStaff = msg.sender_role === 'admin' || msg.sender_role === 'teacher';
              return `
                <div class="text-xs p-2 rounded-lg ${isStaff ? 'bg-emerald-500/15 text-emerald-950 ml-4' : 'bg-white text-[#1d1d1f]'}">
                  <span class="font-bold text-[10px] block text-[#6e6e73]">${msg.sender_name}:</span>
                  <span>${msg.content}</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="flex gap-1.5 pt-1">
            <input type="text" id="replyInput-${mat.id}-${stuId}" onkeydown="if(event.key==='Enter'){event.preventDefault();replyStudentConsulta(${mat.id}, ${stuId});}"
              placeholder="Responder a ${thread.student_name}..."
              class="flex-1 bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs">
            <button type="button" onclick="replyStudentConsulta(${mat.id}, ${stuId})"
              class="px-3 py-1.5 rounded-lg bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-semibold">
              Responder
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function replyStudentConsulta(materialId, studentId) {
  const input = document.getElementById(`replyInput-${materialId}-${studentId}`);
  const content = input.value.trim();
  if (!content) return;

  input.value = '';
  const res = await fetch(`/intranet/api/admin/materials/${materialId}/reply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ student_id: studentId, content })
  });
  if (res.ok) {
    const created = await res.json();
    appendRealtimeAdminConsulta(created);
  }
}

function appendRealtimeAdminConsulta(msg) {
  const mat = materialsCache.find(m => Number(m.id) === Number(msg.material_id));
  if (!mat) return;
  if (!mat.consultas) mat.consultas = [];
  if (mat.consultas.some(c => Number(c.id) === Number(msg.id))) return;

  mat.consultas.push(msg);
  const container = document.getElementById(`consultasContainer-${mat.id}`);
  if (container) {
    container.outerHTML = renderConsultasAdmin(mat);
  }

  if (msg.sender_role === 'student' && document.getElementById('panel-materiales').classList.contains('hidden')) {
    document.getElementById('unreadChatDot').classList.remove('hidden');
    const mDot = document.getElementById('mobileUnreadDot');
    if (mDot) mDot.classList.remove('hidden');
  }
}

let adminSseSource = null;
let adminSseRetryMs = 3000;
let adminSseTimer = null;

function setAdminLiveBadge(state) {
  const el = document.getElementById('liveAdminBadge');
  if (!el) return;
  el.classList.remove('hidden');
  if (state === 'live') {
    el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/25 text-[10px] font-semibold';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> En vivo';
  } else {
    el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/25 text-[10px] font-semibold';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Reconectando...';
  }
}

function initAdminRealtimeChat() {
  if (adminSseSource) {
    adminSseSource.close();
    adminSseSource = null;
  }
  if (adminSseTimer) {
    clearTimeout(adminSseTimer);
    adminSseTimer = null;
  }

  const evtSource = new EventSource(`/intranet/api/chat/stream?token=${encodeURIComponent(token)}`);
  adminSseSource = evtSource;

  evtSource.onopen = () => {
    adminSseRetryMs = 3000;
    setAdminLiveBadge('live');
  };

  evtSource.onerror = () => {
    setAdminLiveBadge('reconnecting');
    evtSource.close();
    if (adminSseSource === evtSource) adminSseSource = null;
    const wait = adminSseRetryMs;
    adminSseRetryMs = Math.min(adminSseRetryMs * 2, 30000);
    adminSseTimer = setTimeout(initAdminRealtimeChat, wait);
  };

  evtSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'chat_message' && payload.message) {
        appendRealtimeAdminConsulta(payload.message);
      } else if (payload.type === 'notification' && payload.notification) {
        if (typeof adminNotificationsCache !== 'undefined') {
          adminNotificationsCache.unshift(payload.notification);
          updateAdminNotifBadges(adminNotificationsCache.filter(n => !n.is_read).length);
          renderAdminNotificationsList();
        }
      } else if (payload.type === 'student_dm_audit' && payload.message) {
        if (typeof onAdminAuditMessageEvent === 'function') {
          onAdminAuditMessageEvent(payload.message);
        }
      } else if (payload.type === 'staff_dm' && payload.message) {
        if (typeof onStaffDmEvent === 'function') {
          onStaffDmEvent(payload.message);
        }
      }
    } catch {}
  };
}

window.addEventListener('online', () => {
  if (!adminSseSource) {
    adminSseRetryMs = 3000;
    initAdminRealtimeChat();
  }
});

const selectedAdminMatInstrument = {};

function getYtEmbed(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function selectAdminInstrument(matId, label) {
  selectedAdminMatInstrument[matId] = label;
  const mat = materialsCache.find(item => Number(item.id) === Number(matId));
  if (!mat) return;
  const stageEl = document.getElementById(`adminSolStage-${matId}`);
  const sideEl = document.getElementById(`adminSolSidebar-${matId}`);
  if (stageEl) stageEl.innerHTML = renderAdminSolStage(mat, label);
  if (sideEl) sideEl.innerHTML = renderAdminSolSidebar(mat, label);
}

function renderAdminSolSidebar(m, activeLabel) {
  const files = m.files || [];
  const labels = Array.from(new Set(files.map(f => f.label || 'General (Canción completa)')));
  if (!labels.length) labels.push('General (Canción completa)');

  return `
    <div class="space-y-1.5">
      <span class="block text-[10px] font-bold uppercase tracking-wider text-[#6e6e73] px-1">Instrumento / Parte</span>
      <div class="flex flex-row lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        ${labels.map(lbl => {
          const isAct = lbl === activeLabel;
          return `
            <button type="button" onclick="selectAdminInstrument(${m.id}, '${lbl.replace(/'/g, "\'")}')"
              class="shrink-0 text-left px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-between gap-2 ${
                isAct
                  ? 'bg-[#1d1d1f] text-white shadow-sm'
                  : 'bg-[#f5f5f7] hover:bg-black/[0.06] text-[#1d1d1f]'
              }">
              <span class="truncate">${lbl}</span>
              <i class="fa-solid fa-chevron-right text-[10px] opacity-60 hidden lg:inline"></i>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderAdminSolStage(m, activeLabel) {
  const ytEmbed = getYtEmbed(m.external_url);
  const matchingFiles = (m.files || []).filter(f => (f.label || 'General (Canción completa)') === activeLabel);

  return `
    <div class="space-y-3">
      ${ytEmbed ? `
        <div class="aspect-video w-full rounded-2xl overflow-hidden bg-black">
          <iframe src="${ytEmbed}" class="w-full h-full border-0" allowfullscreen></iframe>
        </div>
      ` : (m.external_url ? `
        <a href="${m.external_url}" target="_blank"
          class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-red-600/10 text-red-700 hover:bg-red-600/20 text-xs font-semibold transition">
          <i class="fa-brands fa-youtube"></i> Abrir enlace de referencia
        </a>
      ` : '')}

      <div class="p-3.5 rounded-2xl bg-[#f5f5f7]/80 border border-black/[0.06] space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-[#1d1d1f]">${activeLabel}</span>
          <span class="text-[10px] text-[#6e6e73]">${matchingFiles.length} archivo(s)</span>
        </div>
        ${matchingFiles.length
          ? matchingFiles.map(renderAttachmentAdmin).join('')
          : '<p class="text-xs text-[#6e6e73] py-2">Sin archivos asignados a esta etiqueta aún.</p>'
        }
      </div>
    </div>
  `;
}

let selectedAdminMaterialId = null;
const adminMaterialInnerTab = {};

function selectAdminMaterial(matId) {
  selectedAdminMaterialId = matId ? Number(matId) : null;
  renderMaterialsFiltered();
}

function setAdminMaterialInnerTab(matId, tabKey) {
  adminMaterialInnerTab[matId] = tabKey;
  ['material', 'entregas', 'consultas'].forEach(k => {
    const panel = document.getElementById(`adminMatTabPanel-${matId}-${k}`);
    if (panel) {
      if (k === tabKey) {
        panel.classList.remove('hidden', 'section-enter');
        void panel.offsetWidth;
        panel.classList.add('section-enter');
      } else {
        panel.classList.add('hidden');
        panel.classList.remove('section-enter');
      }
    }
    const btn = document.getElementById(`adminMatTabBtn-${matId}-${k}`);
    if (btn) {
      btn.className = (k === tabKey)
        ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5'
        : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5';
    }
  });
}

function selectClassroomCard(groupId, pushHistory = true) {
  selectedClassroomCardId = groupId ? Number(groupId) : null;
  selectedAdminMaterialId = null;
  const cardsGrid = document.getElementById('classroomCardsGrid');
  const listEl = document.getElementById('materialsList');
  const backBtn = document.getElementById('btnBackToClassroomCards');
  const titleEl = document.getElementById('classroomHeaderTitle');
  const metaEl = document.getElementById('classroomHeaderMeta');

  if (selectedClassroomCardId) {
    const grp = groupsCache.find(g => Number(g.id) === Number(selectedClassroomCardId));
    if (grp) {
      renderMaterialGroupChecklist([grp.id]);
    }
    titleEl.innerText = grp ? grp.name : 'Aula seleccionada';
    metaEl.innerText = grp
      ? `${grp.category} • ${grp.student_count || 0} alumno(s)${grp.schedule ? ` • ${grp.schedule}` : ''}`
      : '';
    if (cardsGrid) cardsGrid.classList.add('hidden');
    if (listEl) listEl.classList.remove('hidden');
    if (backBtn) backBtn.classList.remove('hidden');
    renderMaterialsFiltered();
  } else {
    titleEl.innerText = 'Clases y Subgrupos';
    metaEl.innerText = 'Presiona una tarjeta de clase para ver sus materiales, entregas y consultas.';
    if (cardsGrid) cardsGrid.classList.remove('hidden');
    if (listEl) listEl.classList.add('hidden');
    if (backBtn) backBtn.classList.add('hidden');
    renderClassroomCards();
  }
  syncAdminUrl(pushHistory);
}

function renderClassroomCards() {
  const grid = document.getElementById('classroomCardsGrid');
  if (!grid) return;

  if (!groupsCache.length) {
    grid.innerHTML = '<p class="col-span-full text-xs text-[#6e6e73] text-center py-8">Crea primero un grupo o subgrupo en "Subgrupos y Alumnado".</p>';
    return;
  }

  grid.innerHTML = groupsCache.map(g => {
    const countMats = materialsCache.filter(m => Number(m.group_id) === Number(g.id)).length;
    const isSol = g.category === 'Sol Music';
    return `
      <button type="button" onclick="selectClassroomCard(${g.id})"
        class="card-interactive text-left p-5 rounded-2xl bg-white/95 hover:bg-white border border-black/[0.07] shadow-sm flex flex-col justify-between gap-3">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isSol ? 'bg-amber-500/15 text-amber-800' : 'bg-indigo-500/10 text-indigo-700'}">${g.category}</span>
            <span class="px-2.5 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold">${countMats} tema(s)</span>
          </div>
          <h3 class="text-sm sm:text-base font-bold text-[#1d1d1f] leading-snug">${g.name}</h3>
          ${g.schedule ? `<p class="text-xs text-[#0071e3] font-medium"><i class="fa-regular fa-clock mr-1"></i>${g.schedule}</p>` : ''}
          ${g.description ? `<p class="text-xs text-[#6e6e73] line-clamp-2">${g.description}</p>` : ''}
        </div>
        <div class="pt-2 border-t border-black/[0.05] flex items-center justify-between text-xs font-semibold text-[#0071e3]">
          <span>Abrir materiales de la clase</span>
          <i class="fa-solid fa-arrow-right text-[11px]"></i>
        </div>
      </button>
    `;
  }).join('');
}

async function loadMaterials() {
  const res = await fetch('/intranet/api/admin/materials', { headers: authHeaders() });
  materialsCache = await res.json();
  renderClassroomCards();
  if (selectedClassroomCardId) {
    renderMaterialsFiltered();
  }
  renderGlobalSubmissionsPanel();
}

const expandedGlobalSubMat = {};

function toggleGlobalSubCard(matId) {
  expandedGlobalSubMat[matId] = !expandedGlobalSubMat[matId];
  const body = document.getElementById(`globalSubBody-${matId}`);
  const chev = document.getElementById(`globalSubChev-${matId}`);
  if (body) body.classList.toggle('hidden', !expandedGlobalSubMat[matId]);
  if (chev) chev.classList.toggle('rotate-180', Boolean(expandedGlobalSubMat[matId]));
}

function renderGlobalSubmissionsPanel() {
  const container = document.getElementById('globalSubmissionsContainer');
  if (!container) return;

  const q = (document.getElementById('entregasSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('entregasStatusFilter')?.value || 'all';

  let ungradedTotal = 0;
  const enriched = (materialsCache || [])
    .filter(m => Number(m.evaluation_enabled) === 1 || (m.submissions && m.submissions.length > 0))
    .map(m => {
      const subs = m.submissions || [];
      const expected = (studentsCache || []).filter(s => {
        const inGroup = (s.group_ids || []).includes(Number(m.group_id)) || Number(s.group_id) === Number(m.group_id);
        if (!inGroup) return false;
        if (m.category === 'Particulares' && m.target_grade && m.target_grade !== 'Todos') {
          const sg = (s.grade || '').trim();
          if (sg && sg !== m.target_grade) return false;
        }
        return true;
      });
      const submittedIds = new Set(subs.map(sb => Number(sb.student_id)));
      const pendingCount = expected.filter(s => !submittedIds.has(Number(s.id))).length;
      const ungradedCount = subs.filter(sb => sb.grade_score === null || sb.grade_score === undefined).length;
      ungradedTotal += ungradedCount;
      return { mat: m, subs, pendingCount, ungradedCount };
    });

  const badgeEl = document.getElementById('entregasPendingBadge');
  if (badgeEl) {
    badgeEl.innerText = ungradedTotal > 9 ? '9+' : String(ungradedTotal);
    badgeEl.classList.toggle('hidden', ungradedTotal === 0);
  }

  const filtered = enriched.filter(item => {
    if (statusFilter === 'ungraded' && item.ungradedCount === 0) return false;
    if (statusFilter === 'pending' && item.pendingCount === 0) return false;
    if (q) {
      const haystack = `${item.mat.title} ${item.mat.group_name || ''} ${item.subs.map(s => s.student_name).join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-8">No hay actividades que coincidan con este filtro.</p>';
    return;
  }

  container.innerHTML = filtered.map(({ mat, subs, pendingCount, ungradedCount }) => {
    const isOpen = Boolean(expandedGlobalSubMat[mat.id]);
    const isSol = (mat.publish_format === 'music') || (!mat.publish_format && mat.category === 'Sol Music');
    return `
      <div class="card-interactive rounded-2xl bg-white/95 border border-black/[0.07] overflow-hidden shadow-sm">
        <button type="button" onclick="toggleGlobalSubCard(${mat.id})"
          class="w-full p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-black/[0.015] transition">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="px-2.5 py-0.5 rounded-full ${isSol ? 'bg-amber-500/15 text-amber-800' : 'bg-indigo-500/10 text-indigo-700'} text-[10px] font-bold">${mat.group_name || 'Aula'}</span>
              ${mat.target_grade ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-[10px] font-bold">${mat.target_grade}</span>` : ''}
            </div>
            <h4 class="text-sm sm:text-base font-bold text-[#1d1d1f] truncate mt-1">${mat.title}</h4>
          </div>

          <div class="flex flex-wrap items-center gap-2 shrink-0">
            ${ungradedCount ? `<span class="px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-700 text-[10px] font-bold">${ungradedCount} por calificar</span>` : ''}
            <span class="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 text-[10px] font-bold">Entregaron: ${subs.length}</span>
            <span class="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-800 text-[10px] font-bold">Faltan: ${pendingCount}</span>
            <i id="globalSubChev-${mat.id}" class="fa-solid fa-chevron-down text-xs text-[#6e6e73] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}"></i>
          </div>
        </button>

        <div id="globalSubBody-${mat.id}" class="${isOpen ? 'section-enter' : 'hidden'} p-4 sm:p-5 pt-3 border-t border-black/[0.06] bg-[#f8fafc]">
          ${renderSubmissionsAdmin(mat) || '<p class="text-xs text-[#6e6e73] text-center py-4">Sin alumnos asignados.</p>'}
        </div>
      </div>
    `;
  }).join('');
}

function openPublishMaterialModal() {
  if (selectedClassroomCardId) {
    renderMaterialGroupChecklist([selectedClassroomCardId]);
  } else {
    renderMaterialGroupChecklist();
  }
  document.getElementById('publishMaterialModal').classList.remove('hidden');
}

function closePublishMaterialModal() {
  document.getElementById('publishMaterialModal').classList.add('hidden');
}

function renderMaterialsFiltered() {
  const gid = selectedClassroomCardId;
  const filteredMats = gid
    ? materialsCache.filter(m => Number(m.group_id) === Number(gid))
    : materialsCache;

  const listContainer = document.getElementById('materialsList');
  if (!filteredMats.length) {
    selectedAdminMaterialId = null;
    listContainer.innerHTML = '<div class="glass-bento p-8 text-center"><p class="text-xs text-[#6e6e73]">No hay materiales publicados en esta aula todavía.</p></div>';
    return;
  }

  const activeMat = selectedAdminMaterialId
    ? filteredMats.find(m => Number(m.id) === Number(selectedAdminMaterialId))
    : null;

  if (!activeMat) {
    selectedAdminMaterialId = null;
    listContainer.innerHTML = `
      <div class="section-enter grid grid-cols-1 md:grid-cols-2 gap-3.5">
        ${filteredMats.map((m, idx) => {
          const isSol = (m.publish_format === 'music') || (!m.publish_format && m.category === 'Sol Music');
          const filesCount = (m.files || []).length;
          const subsCount = (m.submissions || []).length;
          const notesCount = (m.notes || []).length;
          return `
            <div onclick="selectAdminMaterial(${m.id})" role="button" tabindex="0"
              class="card-interactive cursor-pointer text-left p-4 sm:p-5 rounded-2xl bg-white/95 hover:bg-white border border-black/[0.07] shadow-sm flex flex-col justify-between gap-3">
              <div class="flex items-start justify-between gap-2.5">
                <div class="flex items-start gap-3 min-w-0">
                  <div class="w-10 h-10 rounded-xl ${isSol ? 'bg-amber-500/15 text-amber-700' : 'bg-[#0071e3]/10 text-[#0071e3]'} flex items-center justify-center text-sm shrink-0">
                    <i class="fa-solid ${isSol ? 'fa-music' : 'fa-book-open'}"></i>
                  </div>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="text-[10px] font-bold uppercase tracking-wider ${isSol ? 'text-amber-700' : 'text-indigo-600'}">Tema ${filteredMats.length - idx}</span>
                      ${m.target_grade ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-[10px] font-bold">${m.target_grade}</span>` : ''}
                    </div>
                    <h4 class="text-sm sm:text-base font-bold text-[#1d1d1f] break-words leading-snug mt-0.5">${m.title}</h4>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button type="button" onclick="event.stopPropagation(); openEditMaterialModal(${m.id})"
                    class="btn-interactive px-2.5 py-1 rounded-lg bg-[#0071e3]/10 hover:bg-[#0071e3]/20 text-[#0071e3] text-[11px] font-semibold" title="Editar material">
                    <i class="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button type="button" onclick="event.stopPropagation(); deleteMaterial(${m.id})"
                    class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>

              <div class="pt-2.5 border-t border-black/[0.05] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6e6e73]">
                <div class="flex flex-wrap items-center gap-2.5">
                  <span><i class="fa-regular fa-folder-open mr-1"></i>${filesCount} archivo(s)</span>
                  ${subsCount ? `<span class="text-emerald-700 font-semibold"><i class="fa-solid fa-clipboard-check mr-1"></i>${subsCount} entrega(s)</span>` : ''}
                  ${notesCount ? `<span class="text-indigo-700 font-semibold"><i class="fa-regular fa-comments mr-1"></i>${notesCount}</span>` : ''}
                </div>
                <span class="font-semibold text-[#0071e3]">Abrir <i class="fa-solid fa-arrow-right ml-0.5 text-[10px]"></i></span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    return;
  }

  const m = activeMat;
  const isSol = (m.publish_format === 'music') || (!m.publish_format && m.category === 'Sol Music');
  const files = m.files || [];
  const subsCount = (m.submissions || []).length;
  const notesCount = (m.notes || []).length;
  const activeInnerTab = adminMaterialInnerTab[m.id] || 'material';
  const defaultLbl = selectedAdminMatInstrument[m.id]
    || (files[0] ? files[0].label : 'General (Canción completa)');
  selectedAdminMatInstrument[m.id] = defaultLbl;

  const bodyContent = isSol
    ? `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1">
        <div class="lg:col-span-8" id="adminSolStage-${m.id}">
          ${renderAdminSolStage(m, defaultLbl)}
        </div>
        <div class="lg:col-span-4" id="adminSolSidebar-${m.id}">
          ${renderAdminSolSidebar(m, defaultLbl)}
        </div>
      </div>
    `
    : `
      ${m.external_url ? `
        <div>
          <a href="${m.external_url}" target="_blank"
            class="btn-interactive inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600/10 text-red-700 hover:bg-red-600/20 text-xs font-semibold">
            <i class="fa-brands fa-youtube"></i> Ver video / enlace de referencia
          </a>
        </div>` : ''}
      ${files.length ? `<div class="space-y-2 pt-1">${files.map(renderAttachmentAdmin).join('')}</div>` : '<p class="text-xs text-[#6e6e73] py-4 text-center">No hay archivos adjuntos en este tema.</p>'}
    `;

  listContainer.innerHTML = `
    <div class="section-enter glass-bento p-4 sm:p-6 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-black/[0.06]">
        <div class="flex items-center gap-3 min-w-0">
          <button type="button" onclick="selectAdminMaterial(null)"
            class="btn-interactive px-3.5 py-2 rounded-full bg-[#f5f5f7] hover:bg-black/[0.06] border border-black/10 text-[#1d1d1f] text-xs font-semibold shrink-0">
            <i class="fa-solid fa-arrow-left mr-1.5"></i> Todos los temas
          </button>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="px-2.5 py-0.5 rounded-full ${isSol ? 'bg-amber-500/15 text-amber-800' : 'bg-indigo-500/10 text-indigo-700'} text-[10px] font-semibold">[${m.category || 'Particulares'}] ${m.group_name || 'General'}</span>
              ${m.target_grade ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-[10px] font-bold"><i class="fa-solid fa-graduation-cap mr-1"></i>${m.target_grade}</span>` : ''}
            </div>
            <h4 class="text-base sm:text-lg font-bold text-[#1d1d1f] truncate mt-0.5">${m.title}</h4>
            ${m.description ? `<p class="text-xs text-[#6e6e73] mt-0.5">${m.description}</p>` : ''}
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" onclick="openEditMaterialModal(${m.id})"
            class="btn-interactive px-3 py-1.5 rounded-full bg-[#0071e3]/10 hover:bg-[#0071e3]/20 text-[#0071e3] text-xs font-semibold">
            <i class="fa-solid fa-pen-to-square mr-1"></i> Editar
          </button>
          <button type="button" onclick="deleteMaterial(${m.id})"
            class="btn-interactive px-3 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-600 text-xs font-semibold" title="Eliminar">
            <i class="fa-solid fa-trash mr-1"></i> Eliminar
          </button>
        </div>
      </div>

      <!-- Tabs internos compactos -->
      ${(() => {
        const showEntregasTab = Number(m.evaluation_enabled) === 1 || subsCount > 0;
        const safeActiveTab = (!showEntregasTab && activeInnerTab === 'entregas') ? 'material' : activeInnerTab;
        return `
      <div class="inline-flex p-1 rounded-xl bg-black/[0.05]">
        <button type="button" id="adminMatTabBtn-${m.id}-material" onclick="setAdminMaterialInnerTab(${m.id}, 'material')"
          class="${safeActiveTab === 'material' ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5' : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5'}">
          <i class="fa-solid ${isSol ? 'fa-music' : 'fa-folder-open'} text-[#0071e3]"></i> Material y Pistas
        </button>
        ${showEntregasTab ? `
        <button type="button" id="adminMatTabBtn-${m.id}-entregas" onclick="setAdminMaterialInnerTab(${m.id}, 'entregas')"
          class="${safeActiveTab === 'entregas' ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5' : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5'}">
          <i class="fa-solid fa-clipboard-check text-emerald-600"></i> Entregas ${subsCount ? `<span class="px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-700 text-[10px]">${subsCount}</span>` : ''}
        </button>
        ` : ''}
        <button type="button" id="adminMatTabBtn-${m.id}-consultas" onclick="setAdminMaterialInnerTab(${m.id}, 'consultas')"
          class="${safeActiveTab === 'consultas' ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5' : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5'}">
          <i class="fa-regular fa-comments text-indigo-600"></i> Consultas ${notesCount ? `<span class="px-1.5 py-0.2 rounded-full bg-indigo-500/15 text-indigo-700 text-[10px]">${notesCount}</span>` : ''}
        </button>
      </div>

      <div id="adminMatTabPanel-${m.id}-material" class="${safeActiveTab === 'material' ? 'section-enter' : 'hidden'} space-y-3">
        ${bodyContent}
      </div>

      ${showEntregasTab ? `
      <div id="adminMatTabPanel-${m.id}-entregas" class="${safeActiveTab === 'entregas' ? 'section-enter' : 'hidden'}">
        ${renderSubmissionsAdmin(m) || '<p class="text-xs text-[#6e6e73] py-6 text-center">Ningún estudiante ha enviado entregas en este tema todavía.</p>'}
      </div>
      ` : ''}

      <div id="adminMatTabPanel-${m.id}-consultas" class="${safeActiveTab === 'consultas' ? 'section-enter' : 'hidden'}">
        ${renderConsultasAdmin(m) || '<p class="text-xs text-[#6e6e73] py-6 text-center">No hay consultas de estudiantes en este tema todavía.</p>'}
      </div>
        `;
      })()}
    </div>
  `;
}

let editDeletedFileIds = [];

function addEditFileRow(defaultLabel = '1ra Guitarra') {
  const container = document.getElementById('editNewFileRows');
  const row = document.createElement('div');
  row.className = 'edit-new-file-row bg-white p-2 rounded-xl border border-black/10 flex flex-col sm:flex-row sm:items-center gap-2';
  const opts = INSTRUMENT_OPTIONS.map(o => `<option value="${o}" ${o === defaultLabel ? 'selected' : ''}>${o}</option>`).join('');
  row.innerHTML = `
    <select class="edit-new-label bg-[#f5f5f7] border border-black/10 rounded-lg px-2.5 py-1.5 text-xs font-semibold sm:w-44 shrink-0">${opts}</select>
    <input type="file" multiple accept=".pdf,.mp3,.wav,.ogg,.m4a,.doc,.docx,.zip,.gpx" class="edit-new-input flex-1 text-xs">
    <button type="button" onclick="this.parentElement.remove()" class="text-red-500 px-2 py-1 text-xs"><i class="fa-solid fa-xmark"></i></button>
  `;
  container.appendChild(row);
}

function openEditMaterialModal(matId) {
  const mat = materialsCache.find(item => Number(item.id) === Number(matId));
  if (!mat) return;

  editDeletedFileIds = [];
  document.getElementById('editMatId').value = mat.id;
  document.getElementById('editMatTitle').value = mat.title || '';
  document.getElementById('editMatUrl').value = mat.external_url || '';
  document.getElementById('editMatDesc').value = mat.description || '';
  const editGradeSel = document.getElementById('editMatTargetGrade');
  if (editGradeSel) editGradeSel.value = mat.target_grade || 'Todos';
  const editEvalCb = document.getElementById('editMatEvalEnabled');
  if (editEvalCb) editEvalCb.checked = Number(mat.evaluation_enabled) === 1;
  document.getElementById('editNewFileRows').innerHTML = '';

  const listEl = document.getElementById('editExistingFilesList');
  const files = mat.files || [];
  if (!files.length) {
    listEl.innerHTML = '<p class="text-xs text-[#6e6e73]">No hay archivos adjuntos en esta publicación.</p>';
  } else {
    listEl.innerHTML = files.map(f => {
      const opts = INSTRUMENT_OPTIONS.map(o => `<option value="${o}" ${o === f.label ? 'selected' : ''}>${o}</option>`).join('');
      return `
        <div id="existingFileRow-${f.id}" class="flex flex-wrap items-center justify-between gap-2 bg-white p-2 rounded-xl border border-black/10 text-xs">
          <select data-file-id="${f.id}" class="edit-existing-label bg-[#f5f5f7] border border-black/10 rounded-lg px-2 py-1 text-xs font-semibold">${opts}</select>
          <span class="flex-1 truncate font-medium text-[#1d1d1f]">${cleanDisplayName(f.original_name)}</span>
          <button type="button" onclick="markExistingFileDelete(${f.id})" class="text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg text-xs" title="Quitar archivo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');
  }

  document.getElementById('editMaterialModal').classList.remove('hidden');
}

function markExistingFileDelete(fileId) {
  if (!editDeletedFileIds.includes(fileId)) editDeletedFileIds.push(fileId);
  const row = document.getElementById(`existingFileRow-${fileId}`);
  if (row) row.remove();
}

function closeEditMaterialModal() {
  document.getElementById('editMaterialModal').classList.add('hidden');
}

document.getElementById('editMaterialForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const matId = document.getElementById('editMatId').value;
  const btn = document.getElementById('btnSaveEditMat');
  btn.disabled = true;
  btn.innerText = 'Guardando...';

  const formData = new FormData();
  const origMat = materialsCache.find(item => Number(item.id) === Number(matId));
  formData.append('title', document.getElementById('editMatTitle').value);
  formData.append('external_url', document.getElementById('editMatUrl').value);
  formData.append('description', document.getElementById('editMatDesc').value);
  formData.append('target_grade', document.getElementById('editMatTargetGrade')?.value || 'Todos');
  const editEvalCb = document.getElementById('editMatEvalEnabled');
  formData.append('evaluation_enabled', editEvalCb && editEvalCb.checked ? '1' : '0');
  if (origMat) {
    formData.append('publish_format', origMat.publish_format || (origMat.category === 'Sol Music' ? 'music' : 'classroom'));
  }
  formData.append('deleted_file_ids', JSON.stringify(editDeletedFileIds));

  const updatedMeta = [];
  document.querySelectorAll('.edit-existing-label').forEach(sel => {
    const fid = Number(sel.dataset.fileId);
    if (!editDeletedFileIds.includes(fid)) {
      updatedMeta.push({ id: fid, label: sel.value });
    }
  });
  formData.append('updated_files_meta', JSON.stringify(updatedMeta));

  const newLabels = [];
  document.querySelectorAll('.edit-new-file-row').forEach(row => {
    const inp = row.querySelector('.edit-new-input');
    const sel = row.querySelector('.edit-new-label');
    if (inp && inp.files && inp.files.length > 0) {
      Array.from(inp.files).forEach(file => {
        formData.append('files', file);
        newLabels.push(sel.value);
      });
    }
  });
  formData.append('labels', JSON.stringify(newLabels));

  const res = await fetch(`/intranet/api/admin/materials/${matId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });

  btn.disabled = false;
  btn.innerText = 'Guardar Cambios';
  if (res.ok) {
    closeEditMaterialModal();
    loadMaterials();
  } else {
    const d = await res.json();
    showToast(d.error || 'Error guardando los cambios', "error");
  }
});


document.getElementById('materialForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const checkedGroups = Array.from(document.querySelectorAll('input[name="matGroupCheck"]:checked')).map(cb => Number(cb.value));
  if (!checkedGroups.length) {
    showToast('Selecciona al menos un aula o subgrupo destino.', "error");
    return;
  }

  const btn = document.getElementById('btnUploadMat');
  btn.disabled = true;
  btn.innerText = 'Subiendo archivos...';

  const formData = new FormData();
  formData.append('group_id', String(checkedGroups[0]));
  formData.append('group_ids', JSON.stringify(checkedGroups));
  formData.append('title', document.getElementById('matTitle').value);
  formData.append('description', document.getElementById('matDesc').value);
  const pubFmt = document.getElementById('matFormatSelect')?.value || 'music';
  const evalChecked = pubFmt === 'classroom' && document.getElementById('matEvalEnabled')?.checked;
  formData.append('publish_format', pubFmt);
  formData.append('evaluation_enabled', evalChecked ? '1' : '0');
  formData.append('target_grade', document.getElementById('matTargetGrade')?.value || 'Todos');
  formData.append('external_url', document.getElementById('matUrl').value);

  const labels = [];
  document.querySelectorAll('.file-upload-row').forEach(row => {
    const fileInput = row.querySelector('.file-input-item');
    const labelSelect = row.querySelector('.file-label-select');
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      Array.from(fileInput.files).forEach(file => {
        formData.append('files', file);
        labels.push(labelSelect.value);
      });
    }
  });
  formData.append('labels', JSON.stringify(labels));

  const res = await fetch('/intranet/api/admin/materials', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>Publicar Material en el Aula</span>';
  if (res.ok) {
    document.getElementById('materialForm').reset();
    document.getElementById('fileRowsContainer').innerHTML = '';
    addFileRow('General (Canción completa)');
    addFileRow('1ra Guitarra');
    renderMaterialGroupChecklist(selectedClassroomCardId ? [selectedClassroomCardId] : null);
    closePublishMaterialModal();
    loadMaterials();
  } else {
    const errData = await res.json().catch(() => ({}));
    showToast(errData.error || 'Error al publicar el material', "error");
  }
});


async function deleteMaterial(id) {
  if (!confirm('¿Eliminar este material y todos sus archivos adjuntos?')) return;
  await fetch(`/intranet/api/admin/materials/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadMaterials();
}


loadAllData().then(initAdminRealtimeChat);

