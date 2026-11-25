const token = localStorage.getItem('dc_token');
if (!token) window.location.href = '/intranet';

const authHeaders = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });
let dashboardData = null;
let activeGroupId = null;

function logout() {
  localStorage.clear();
  window.location.href = '/intranet';
}

let activeStudentTab = 'materiales';
let isApplyingStudentRoute = false;

function buildStudentHash() {
  if (activeStudentTab === 'materiales' && selectedStudentMaterialId) {
    return `#materiales/tema/${selectedStudentMaterialId}`;
  }
  return `#${activeStudentTab}`;
}

function syncStudentUrl(push = true) {
  if (isApplyingStudentRoute) return;
  const targetHash = buildStudentHash();
  if (window.location.hash !== targetHash) {
    const state = { tab: activeStudentTab, materialId: selectedStudentMaterialId };
    if (push) history.pushState(state, '', targetHash);
    else history.replaceState(state, '', targetHash);
  }
}

function applyStudentRouteFromHash(hashStr) {
  const clean = (hashStr || '').replace(/^#/, '');
  const parts = clean.split('/').filter(Boolean);
  const validTabs = ['materiales', 'asistencia', 'companeros', 'mensajes', 'perfil'];
  const tab = validTabs.includes(parts[0]) ? parts[0] : 'materiales';
  const temaId = (parts[1] === 'tema' && parts[2]) ? Number(parts[2]) : null;

  isApplyingStudentRoute = true;
  try {
    switchStudentTab(tab, false);
    if (tab === 'materiales') {
      selectStudentMaterial(temaId, false);
    }
  } finally {
    isApplyingStudentRoute = false;
  }
}

window.addEventListener('popstate', () => {
  applyStudentRouteFromHash(window.location.hash);
});

function updateMobileStudentDockPill(tabName) {
  const container = document.getElementById('mobileStudentNavGrid');
  const activeBtn = document.getElementById(`mstab-${tabName}`);
  if (!container || !activeBtn) return;
  const pill = container.querySelector('.dock-pill');
  if (!pill || !activeBtn.offsetWidth) return;
  pill.style.width = `${activeBtn.offsetWidth}px`;
  pill.style.transform = `translate3d(${activeBtn.offsetLeft}px, 0, 0)`;
}

function switchStudentTab(tabName, pushHistory = true) {
  activeStudentTab = tabName;
  if (tabName === 'mensajes' && typeof loadStudentPeers === 'function') {
    loadStudentPeers();
  }
  ['materiales', 'asistencia', 'companeros', 'mensajes', 'perfil'].forEach(t => {
    const view = document.getElementById(`view-${t}`);
    if (view) {
      if (t === tabName) {
        view.classList.remove('hidden', 'section-enter');
        void view.offsetWidth;
        view.classList.add('section-enter');
        if (t === 'companeros') {
          requestAnimationFrame(() => updateCommunityPill());
        }
      } else {
        view.classList.add('hidden');
        view.classList.remove('section-enter');
      }
    }
    const btn = document.getElementById(`stab-${t}`);
    if (btn) {
      btn.className = (t === tabName)
        ? "stab-btn sidebar-item sidebar-item-active w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left"
        : "stab-btn sidebar-item w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left";
    }
    const mbtn = document.getElementById(`mstab-${t}`);
    if (mbtn) {
      mbtn.className = (t === tabName)
        ? "mstab-btn dock-btn flex flex-col items-center justify-center gap-0.5 text-white font-bold text-[10px]"
        : "mstab-btn dock-btn flex flex-col items-center justify-center gap-0.5 text-[#64748b] font-medium text-[10px]";
    }
  });
  updateMobileStudentDockPill(tabName);
  syncStudentUrl(pushHistory);
  const mainEl = document.querySelector('main');
  if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'auto' });
  if (window.innerWidth < 768) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => updateMobileStudentDockPill(activeStudentTab));
});

window.addEventListener('resize', () => {
  updateMobileStudentDockPill(activeStudentTab);
});

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

function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

// ==================== METRÓNOMO Y TONOS ====================
let audioCtx = null;
let metroTimer = null;
let metroRunning = false;
let metroBeatIndex = 0;

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function toggleMetronomeDrawer() {
  document.getElementById('metronomeDrawer').classList.toggle('hidden');
}

function playClickSound(isAccent) {
  ensureAudioCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = isAccent ? 1050 : 750;
  gain.gain.setValueAtTime(isAccent ? 0.35 : 0.2, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.065);

  const led = document.getElementById('metroBeatLed');
  led.className = isAccent
    ? 'w-4 h-4 rounded-full bg-amber-600 scale-125 transition-transform duration-75'
    : 'w-4 h-4 rounded-full bg-emerald-500 scale-110 transition-transform duration-75';
  setTimeout(() => {
    led.className = 'w-4 h-4 rounded-full bg-black/15 transition-transform duration-75';
  }, 90);
}

function toggleMetronome() {
  const btn = document.getElementById('btnToggleMetro');
  if (metroRunning) {
    clearInterval(metroTimer);
    metroRunning = false;
    btn.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar';
    btn.className = 'px-4 py-1.5 rounded-full bg-[#1d1d1f] hover:bg-black text-white text-xs font-semibold inline-flex items-center gap-1.5 transition';
  } else {
    const bpm = Math.max(35, Math.min(240, parseInt(document.getElementById('metroBpmInput').value, 10) || 100));
    const beats = parseInt(document.getElementById('metroBeatsSelect').value, 10) || 4;
    metroBeatIndex = 0;
    metroRunning = true;
    btn.innerHTML = '<i class="fa-solid fa-stop"></i> Detener';
    btn.className = 'px-4 py-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition';

    playClickSound(true);
    metroBeatIndex = 1;
    metroTimer = setInterval(() => {
      playClickSound(metroBeatIndex % beats === 0);
      metroBeatIndex++;
    }, (60 / bpm) * 1000);
  }
}

function adjustBpm(delta) {
  const inp = document.getElementById('metroBpmInput');
  const next = Math.max(35, Math.min(240, (parseInt(inp.value, 10) || 100) + delta));
  inp.value = next;
  if (metroRunning) {
    toggleMetronome();
    toggleMetronome();
  }
}

function updateMetronomeBpm() {
  if (metroRunning) {
    toggleMetronome();
    toggleMetronome();
  }
}

function playReferenceTone(freq) {
  ensureAudioCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.28, audioCtx.currentTime + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 2.4);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 2.5);
}

// ==================== CONTROLES DE ENSAYO POR PISTA MP3 ====================
const abLoops = {};

function formatSecs(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setTrackSpeed(fileId, rate, btnEl) {
  const audio = document.getElementById(`audio-${fileId}`);
  if (!audio) return;
  audio.playbackRate = rate;
  const group = btnEl.parentElement;
  group.querySelectorAll('.speed-btn').forEach(b => {
    b.className = 'speed-btn px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-white text-[#6e6e73] hover:text-[#1d1d1f] text-[10px] font-bold border border-black/10 transition';
  });
  btnEl.className = 'speed-btn px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-[#0071e3] text-white text-[10px] font-bold border border-[#0071e3] transition';
}

function setLoopPoint(fileId, point) {
  const audio = document.getElementById(`audio-${fileId}`);
  if (!audio) return;
  if (!abLoops[fileId]) abLoops[fileId] = { a: null, b: null, active: false };
  const st = abLoops[fileId];

  if (point === 'A') {
    st.a = audio.currentTime;
    if (st.b !== null && st.b <= st.a) st.b = null;
  } else if (point === 'B') {
    if (st.a === null) st.a = 0;
    st.b = audio.currentTime;
    if (st.b > st.a + 0.2) {
      st.active = true;
      audio.currentTime = st.a;
      audio.play();
    }
  }
  updateLoopBadge(fileId);
}

function clearLoopPoints(fileId) {
  abLoops[fileId] = { a: null, b: null, active: false };
  updateLoopBadge(fileId);
}

function updateLoopBadge(fileId) {
  const label = document.getElementById(`loopLabel-${fileId}`);
  if (!label) return;
  const st = abLoops[fileId];
  if (!st || (st.a === null && st.b === null)) {
    label.innerText = 'Bucle: desactivado';
    label.className = 'text-[10px] text-[#6e6e73]';
  } else if (st.a !== null && st.b === null) {
    label.innerText = `Punto A: ${formatSecs(st.a)} (marca B)`;
    label.className = 'text-[10px] font-semibold text-amber-700';
  } else {
    label.innerText = `Bucle activo: ${formatSecs(st.a)} → ${formatSecs(st.b)}`;
    label.className = 'text-[10px] font-bold text-purple-700';
  }
}

function handleAudioTimeUpdate(fileId) {
  const st = abLoops[fileId];
  if (!st || !st.active || st.a === null || st.b === null) return;
  const audio = document.getElementById(`audio-${fileId}`);
  if (audio && audio.currentTime >= st.b) {
    audio.currentTime = st.a;
  }
}

function skipTrackSeconds(fileId, delta) {
  const audio = document.getElementById(`audio-${fileId}`);
  if (!audio) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration || 9999, audio.currentTime + delta));
}

function updateAvatarDisplays(avatarFile) {
  const hasAvatar = Boolean(avatarFile);
  const url = hasAvatar ? `/intranet/api/avatars/${avatarFile}?t=${Date.now()}` : '';

  ['navAvatarImg', 'heroAvatarImg', 'profileAvatarPreview'].forEach(id => {
    const img = document.getElementById(id);
    if (hasAvatar) {
      img.src = url;
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden');
    }
  });

  ['navAvatarFallback', 'heroAvatarFallback', 'profileAvatarPlaceholder'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', hasAvatar);
  });
}

function cleanStudentFileName(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(escape(str));
  } catch {
    return str;
  }
}

function renderStudentFile(f) {
  const fileUrl = `/intranet/api/files/${f.file_name}?token=${token}`;
  if (f.file_type === 'pdf') {
    return `
      <div class="p-3.5 rounded-2xl bg-[#f5f5f7] border border-black/[0.06] flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <span class="px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-red-500/10 text-red-700 text-[10px] font-bold">${f.label}</span>
          <p class="text-xs font-semibold text-[#1d1d1f] truncate mt-0.5">${cleanStudentFileName(f.original_name)}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" onclick="openPdfModal('${fileUrl}', '${f.label} — ${cleanStudentFileName(f.original_name).replace(/'/g, '')}')"
            class="px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold transition">
            <i class="fa-solid fa-eye mr-1"></i> Abrir PDF
          </button>
          <a href="${fileUrl}" download="${cleanStudentFileName(f.original_name)}"
            class="px-3 py-1.5 rounded-full bg-black/5 hover:bg-black/10 text-[#1d1d1f] text-[11px] font-semibold transition">
            <i class="fa-solid fa-download"></i>
          </a>
        </div>
      </div>
    `;
  } else if (f.file_type === 'audio') {
    return `
      <div class="p-3.5 rounded-2xl bg-[#f5f5f7] border border-black/[0.06] space-y-2.5 sm:col-span-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="px-2.5 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-purple-500/10 text-purple-700 text-[11px] font-bold">
            <i class="fa-solid fa-headphones mr-1"></i>Pista: ${f.label}
          </span>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-[#6e6e73] truncate max-w-[180px]">${cleanStudentFileName(f.original_name)}</span>
            <a href="${fileUrl}" download="${cleanStudentFileName(f.original_name)}" class="text-[11px] text-[#0071e3] font-semibold hover:underline shrink-0">
              <i class="fa-solid fa-download mr-0.5"></i> MP3
            </a>
          </div>
        </div>

        <audio id="audio-${f.id}" controls preload="metadata" src="${fileUrl}"
          ontimeupdate="handleAudioTimeUpdate(${f.id})" class="w-full h-9"></audio>

        <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/[0.06]">
          <div class="flex items-center gap-1">
            <span class="text-[10px] font-semibold text-[#6e6e73] mr-1">Velocidad:</span>
            <button type="button" onclick="setTrackSpeed(${f.id}, 0.65, this)" class="speed-btn px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-white text-[#6e6e73] hover:text-[#1d1d1f] text-[10px] font-bold border border-black/10">0.65x</button>
            <button type="button" onclick="setTrackSpeed(${f.id}, 0.8, this)" class="speed-btn px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-white text-[#6e6e73] hover:text-[#1d1d1f] text-[10px] font-bold border border-black/10">0.8x</button>
            <button type="button" onclick="setTrackSpeed(${f.id}, 1.0, this)" class="speed-btn px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-[#0071e3] text-white text-[10px] font-bold border border-[#0071e3]">1.0x</button>
            <button type="button" onclick="skipTrackSeconds(${f.id}, -5)" class="ml-1.5 px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-white hover:bg-black/5 text-[#1d1d1f] text-[10px] font-semibold border border-black/10" title="Retroceder 5 segundos">-5s</button>
            <button type="button" onclick="skipTrackSeconds(${f.id}, 5)" class="px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-white hover:bg-black/5 text-[#1d1d1f] text-[10px] font-semibold border border-black/10" title="Adelantar 5 segundos">+5s</button>
          </div>

          <div class="flex items-center gap-1.5">
            <span id="loopLabel-${f.id}" class="text-[10px] text-[#6e6e73]">Bucle: desactivado</span>
            <button type="button" onclick="setLoopPoint(${f.id}, 'A')" class="px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-purple-600/10 hover:bg-purple-600/20 text-purple-800 text-[10px] font-bold">Marcar A</button>
            <button type="button" onclick="setLoopPoint(${f.id}, 'B')" class="px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-bold">Marcar B</button>
            <button type="button" onclick="clearLoopPoints(${f.id})" class="px-2 py-1.5 sm:py-0.5 rounded-lg sm:rounded-md bg-black/5 hover:bg-black/10 text-[#6e6e73] text-[10px] font-semibold">Quitar</button>
          </div>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="p-3 rounded-xl bg-[#f5f5f7] border border-black/[0.06] flex items-center justify-between gap-2">
        <span class="text-xs font-medium truncate"><strong class="text-[#0071e3]">[${f.label}]</strong> ${cleanStudentFileName(f.original_name)}</span>
        <a href="${fileUrl}" download="${cleanStudentFileName(f.original_name)}" class="px-3 py-1 rounded-full bg-[#0071e3] text-white text-[11px] font-semibold shrink-0">
          Descargar
        </a>
      </div>
    `;
  }
}

function renderSingleNoteBubble(n) {
  const isTeacherReply = n.sender_role === 'admin' || n.sender_role === 'teacher';
  const isPersonal = n.note_type === 'personal';

  if (isTeacherReply) {
    return `
      <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-1">
        <div class="flex items-center justify-between">
          <span class="font-bold text-emerald-800"><i class="fa-solid fa-chalkboard-user mr-1"></i>Respuesta de ${n.sender_name}</span>
          <span class="text-[10px] text-emerald-700">${new Date(n.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p class="text-[#1d1d1f] leading-relaxed">${n.content}</p>
      </div>
    `;
  }

  return `
    <div class="p-3 rounded-xl ${isPersonal ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-[#0071e3]/[0.07] border border-[#0071e3]/20'} text-xs flex items-start justify-between gap-2">
      <div class="space-y-1">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPersonal ? 'bg-amber-500/20 text-amber-900' : 'bg-[#0071e3]/15 text-[#0071e3]'}">
          ${isPersonal ? 'Apunte personal' : 'Consulta enviada al profesor'}
        </span>
        <p class="text-[#1d1d1f] leading-relaxed">${n.content}</p>
      </div>
      <button type="button" onclick="deleteStudentNote(${n.id})" class="text-[#6e6e73] hover:text-red-600 text-xs p-1" title="Eliminar">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;
}

const selectedStudentSongLabel = {};

function normalizeInstrumentMatch(stuInst, availableLabels) {
  if (!stuInst || !availableLabels.length) return availableLabels[0] || 'General (Canción completa)';
  const low = stuInst.toLowerCase();
  const exact = availableLabels.find(l => l.toLowerCase() === low);
  if (exact) return exact;
  const partial = availableLabels.find(l => {
    const ll = l.toLowerCase();
    if (low.includes('guitarra') && ll.includes('guitarra')) return true;
    if (low.includes('bajo') && ll.includes('bajo')) return true;
    if (low.includes('piano') && ll.includes('piano')) return true;
    if (low.includes('bater') && ll.includes('bater')) return true;
    if (low.includes('sax') && ll.includes('sax')) return true;
    if (low.includes('flauta') && ll.includes('flauta')) return true;
    if ((low.includes('viol') || low.includes('cello')) && (ll.includes('cuerdas') || ll.includes(low))) return true;
    return ll.includes(low) || low.includes(ll);
  });
  return partial || availableLabels[0];
}

function selectStudentSongLabel(matId, label) {
  selectedStudentSongLabel[matId] = label;
  const mat = (dashboardData.materials || []).find(item => Number(item.id) === Number(matId));
  if (!mat) return;
  const stage = document.getElementById(`stuSolStage-${matId}`);
  const side = document.getElementById(`stuSolSidebar-${matId}`);
  if (stage) stage.innerHTML = renderStudentSolStage(mat, label);
  if (side) side.innerHTML = renderStudentSolSidebar(mat, label);
}

function renderStudentSolSidebar(m, activeLabel) {
  const files = m.files || [];
  const labels = Array.from(new Set(files.map(f => f.label || 'General (Canción completa)')));
  if (!labels.length) labels.push('General (Canción completa)');

  return `
    <div class="p-3.5 rounded-2xl bg-[#f5f5f7] border border-black/[0.06] space-y-2">
      <span class="block text-[10px] font-bold uppercase tracking-wider text-[#6e6e73]">Seleccionar pista / parte</span>
      <div class="flex flex-row lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        ${labels.map(lbl => {
          const isAct = lbl === activeLabel;
          return `
            <button type="button" onclick="selectStudentSongLabel(${m.id}, '${lbl.replace(/'/g, "\\'")}')"
              class="shrink-0 text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center justify-between gap-2 ${
                isAct
                  ? 'bg-[#0071e3] text-white shadow-sm'
                  : 'bg-white hover:bg-black/[0.04] text-[#1d1d1f] border border-black/[0.06]'
              }">
              <span class="truncate">${lbl}</span>
              <i class="fa-solid fa-music text-[10px] ${isAct ? 'text-white/90' : 'text-[#0071e3]'} hidden lg:inline"></i>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderStudentSolStage(m, activeLabel) {
  const ytEmbed = getYouTubeEmbedUrl(m.external_url);
  const matchingFiles = (m.files || []).filter(f => (f.label || 'General (Canción completa)') === activeLabel);

  return `
    <div class="space-y-4">
      ${ytEmbed ? `
        <div class="aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-sm">
          <iframe src="${ytEmbed}" class="w-full h-full border-0" allowfullscreen></iframe>
        </div>
      ` : (m.external_url ? `
        <div>
          <a href="${m.external_url}" target="_blank"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/5 hover:bg-black/10 text-[#1d1d1f] text-xs font-medium transition">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir enlace de referencia
          </a>
        </div>
      ` : '')}

      <div class="p-4 rounded-2xl bg-[#f5f5f7]/80 border border-black/[0.06] space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-[#1d1d1f]">${activeLabel}</span>
          <span class="text-[10px] font-semibold text-[#0071e3]">Material activo</span>
        </div>
        ${matchingFiles.length
          ? `<div class="space-y-2.5">${matchingFiles.map(renderStudentFile).join('')}</div>`
          : '<p class="text-xs text-[#6e6e73] py-2">No hay archivos cargados para esta sección todavía.</p>'
        }
      </div>
    </div>
  `;
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

function getStudentGradeInfo(rawScore) {
  const n = parseFloat(rawScore);
  if (isNaN(n) || n < 0 || n > 20) return null;
  if (n >= 18) return { letter: 'AD', label: 'Excelente / Logro destacado', cls: 'bg-emerald-600 text-white', trophy: true };
  if (n >= 14) return { letter: 'A', label: 'Bueno / Logro esperado', cls: 'bg-emerald-500 text-white', trophy: false };
  if (n >= 11) return { letter: 'B', label: 'Regular / En proceso', cls: 'bg-amber-400 text-amber-950', trophy: false };
  return { letter: 'C', label: 'Deficiente / En inicio', cls: 'bg-red-600 text-white', trophy: false };
}

async function uploadResolution(materialId) {
  const inp = document.getElementById(`resFile-${materialId}`);
  const statusEl = document.getElementById(`resStatus-${materialId}`);
  if (!inp || !inp.files || !inp.files.length) {
    alert('Selecciona al menos un archivo o imagen (máximo 8)');
    return;
  }
  if (inp.files.length > 8) {
    alert('Puedes subir un máximo de 8 archivos por entrega');
    return;
  }

  const fd = new FormData();
  Array.from(inp.files).forEach(file => fd.append('resolutions', file));

  if (statusEl) statusEl.innerText = 'Subiendo archivos...';
  const res = await fetch(`/intranet/api/student/materials/${materialId}/submission`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fd
  });

  if (res.ok) {
    alert('Resolución enviada correctamente');
    loadStudentPortal(activeGroupId);
  } else {
    const d = await res.json();
    alert(d.error || 'Error subiendo resolución');
    if (statusEl) statusEl.innerText = '';
  }
}

function onResolutionFilesSelected(materialId) {
  const inp = document.getElementById(`resFile-${materialId}`);
  const previewEl = document.getElementById(`resSelectedPreview-${materialId}`);
  const btn = document.getElementById(`resSubmitBtn-${materialId}`);
  if (!inp || !previewEl) return;

  const files = Array.from(inp.files || []);
  if (!files.length) {
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    return;
  }
  if (files.length > 8) {
    alert('Puedes adjuntar un máximo de 8 archivos por entrega');
    inp.value = '';
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    return;
  }

  previewEl.innerHTML = files.map(f => {
    const isPdf = (f.name || '').toLowerCase().endsWith('.pdf');
    const sizeKb = f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : '';
    return `
      <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white border border-[#0071e3]/20 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <i class="fa-solid ${isPdf ? 'fa-file-pdf text-red-600' : 'fa-image text-[#0071e3]'} shrink-0"></i>
          <span class="truncate font-medium text-[#1d1d1f]">${f.name}</span>
        </div>
        <span class="text-[10px] text-[#6e6e73] shrink-0">${sizeKb}</span>
      </div>
    `;
  }).join('');
  previewEl.classList.remove('hidden');
  if (btn) btn.classList.add('ring-2', 'ring-[#0071e3]/30');
}

function renderStudentSubmissionBox(m) {
  const isClassroomEval = (m.publish_format === 'classroom' || (dashboardData && dashboardData.student && dashboardData.student.category !== 'Sol Music'));
  const evalActive = (m.evaluation_enabled === undefined || m.evaluation_enabled === null) ? true : Boolean(Number(m.evaluation_enabled));
  if (!isClassroomEval || !evalActive) return '';

  const sub = m.submission;
  const gInfo = (sub && sub.grade_score !== null && sub.grade_score !== undefined) ? getStudentGradeInfo(sub.grade_score) : null;

  const statusBadge = gInfo
    ? `<span class="px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 text-[10px] font-bold">Calificada • ${sub.grade_score}/20</span>`
    : (sub
        ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 text-[10px] font-bold">Entregada</span>`
        : `<span class="px-2.5 py-0.5 rounded-full bg-black/[0.06] text-[#6e6e73] text-[10px] font-bold">Asignada</span>`);

  const gradeHtml = gInfo
    ? `<div class="p-3.5 rounded-2xl bg-white border border-indigo-500/20 text-xs space-y-1.5 shadow-sm">
         <div class="flex flex-wrap items-center justify-between gap-2">
           <span class="font-bold text-[#1d1d1f]"><i class="fa-solid fa-award mr-1.5 text-indigo-600"></i>Calificación del docente</span>
           <div class="flex items-center gap-1.5">
             <span class="px-2.5 py-0.5 rounded-full bg-[#1d1d1f] text-white font-bold text-xs">${sub.grade_score} / 20</span>
             <span class="px-2.5 py-0.5 rounded-full font-bold text-xs inline-flex items-center gap-1 ${gInfo.cls}">
               ${gInfo.trophy ? '<i class="fa-solid fa-trophy"></i>' : ''}<span>${gInfo.letter} • ${gInfo.label}</span>
             </span>
           </div>
         </div>
         ${sub.feedback ? `<p class="text-[#424245] leading-relaxed bg-[#f5f5f7] p-2.5 rounded-xl mt-1">${sub.feedback}</p>` : ''}
       </div>`
    : '';

  const sFiles = sub
    ? ((sub.files && sub.files.length)
        ? sub.files
        : (sub.file_name ? [{ id: sub.id, file_name: sub.file_name, original_name: sub.original_name, file_type: (sub.original_name || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'image' }] : []))
    : [];

  const currentFileHtml = sFiles.length
    ? `<div class="space-y-1.5">
         <p class="text-[11px] text-emerald-700 font-semibold">
           <i class="fa-solid fa-circle-check mr-1"></i>Archivos entregados (${sFiles.length})
         </p>
         <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
           ${sFiles.map((sf, idx) => {
             const fUrl = `/intranet/api/files/${sf.file_name}?token=${token}`;
             const cName = cleanStudentFileName(sf.original_name || `Archivo ${idx + 1}`).replace(/'/g, '');
             const isPdf = sf.file_type === 'pdf';
             const fn = isPdf ? `openPdfModal('${fUrl}', '${cName}')` : `openImageModal('${fUrl}', '${cName}')`;
             return `
               <button type="button" onclick="${fn}"
                 class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white hover:bg-[#f5f5f7] border border-black/10 text-left text-xs transition">
                 <span class="flex items-center gap-2 min-w-0">
                   <i class="fa-solid ${isPdf ? 'fa-file-pdf text-red-600' : 'fa-image text-indigo-600'} shrink-0"></i>
                   <span class="truncate font-semibold text-[#1d1d1f]">${cName}</span>
                 </span>
                 <i class="fa-solid fa-arrow-up-right-from-square text-[10px] text-[#6e6e73] shrink-0"></i>
               </button>
             `;
           }).join('')}
         </div>
       </div>`
    : `<p class="text-[11px] text-[#6e6e73]">Adjunta fotos nítidas de tu cuaderno o un PDF con tu resolución (máximo 8 archivos).</p>`;

  return `
    <div class="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-sm space-y-3.5">
      <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-black/[0.06]">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-xl bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center text-xs">
            <i class="fa-solid fa-folder-open"></i>
          </div>
          <span class="text-sm font-bold text-[#1d1d1f]">Tu trabajo</span>
        </div>
        ${statusBadge}
      </div>

      ${currentFileHtml}

      <div class="space-y-2.5 pt-1">
        <label for="resFile-${m.id}"
          class="flex flex-col items-center justify-center gap-1.5 p-4 rounded-2xl border-2 border-dashed border-[#0071e3]/30 bg-[#f5f5f7]/70 hover:bg-[#0071e3]/[0.04] hover:border-[#0071e3]/60 cursor-pointer transition text-center">
          <span class="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-[#0071e3] text-sm">
            <i class="fa-solid fa-plus"></i>
          </span>
          <span class="text-xs font-semibold text-[#1d1d1f]">Agregar archivo o foto de resolución</span>
          <span class="text-[10px] text-[#6e6e73]">PDF, JPG, PNG o WEBP (hasta 8 archivos)</span>
          <input type="file" id="resFile-${m.id}" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" onchange="onResolutionFilesSelected(${m.id})" class="hidden">
        </label>

        <div id="resSelectedPreview-${m.id}" class="hidden space-y-1.5"></div>

        <button type="button" id="resSubmitBtn-${m.id}" onclick="uploadResolution(${m.id})"
          class="w-full py-2.5 px-4 rounded-full bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.99] text-white text-xs font-semibold shadow-sm transition flex items-center justify-center gap-2">
          <i class="fa-solid fa-paper-plane"></i>
          <span>${sub ? 'Volver a entregar tarea' : 'Entregar tarea'}</span>
        </button>
      </div>

      <span id="resStatus-${m.id}" class="block text-center text-[11px] font-semibold text-[#0071e3]"></span>
      ${gradeHtml}
    </div>
  `;
}

const expandedClassroomTopics = {};
let selectedStudentMaterialId = null;
const studentMaterialInnerTab = {};

function selectStudentMaterial(matId, pushHistory = true) {
  selectedStudentMaterialId = matId ? Number(matId) : null;
  if (dashboardData) {
    renderMaterialsSection(dashboardData.materials || []);
  }
  syncStudentUrl(pushHistory);
}

function setStudentMaterialInnerTab(matId, tabKey) {
  studentMaterialInnerTab[matId] = tabKey;
  ['material', 'trabajo', 'consultas'].forEach(k => {
    const panel = document.getElementById(`matTabPanel-${matId}-${k}`);
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
    const btn = document.getElementById(`matTabBtn-${matId}-${k}`);
    if (btn) {
      btn.className = (k === tabKey)
        ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5'
        : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5';
    }
  });
}

function toggleClassroomTopic(matId) {
  selectStudentMaterial(matId);
}

function renderMaterialsSection(materials) {
  document.getElementById('materialsCountBadge').innerText = `${materials.length} tema(s)`;
  const container = document.getElementById('studentMaterials');
  const stuInstrument = dashboardData && dashboardData.student ? dashboardData.student.instrument : '';
  const stuCategory = dashboardData && dashboardData.student ? (dashboardData.student.category || 'Particulares') : 'Particulares';

  const subEl = document.getElementById('materialsSectionSubtitle');
  const metroBtn = document.getElementById('btnMetronomeDrawer');
  const isMusicArea = stuCategory === 'Sol Music' || materials.some(x => x.publish_format === 'music');

  if (subEl) {
    subEl.innerText = isMusicArea
      ? 'Selecciona una canción o tema para abrir sus pistas, partituras, entregas y consultas.'
      : 'Selecciona un tema para revisar sus guías PDF, subir tu trabajo y consultar al docente.';
  }
  if (metroBtn) {
    metroBtn.classList.toggle('hidden', stuCategory !== 'Sol Music');
  }

  if (!materials.length) {
    selectedStudentMaterialId = null;
    container.innerHTML = '<p class="text-xs text-[#6e6e73] text-center py-10">Tu docente aún no ha subido materiales para este grupo.</p>';
    return;
  }

  const activeMaterial = selectedStudentMaterialId
    ? materials.find(x => Number(x.id) === Number(selectedStudentMaterialId))
    : null;

  if (!activeMaterial) {
    selectedStudentMaterialId = null;
    container.innerHTML = `
      <div class="section-enter grid grid-cols-1 md:grid-cols-2 gap-3.5">
        ${materials.map((m, idx) => {
          const isSolMusic = (m.publish_format === 'music') || (!m.publish_format && stuCategory === 'Sol Music');
          const filesCount = (m.files || []).length;
          const notesCount = (m.notes || []).length;
          const sub = m.submission;
          const hasGrade = sub && sub.grade_score !== null && sub.grade_score !== undefined;
          const gInfo = hasGrade ? getStudentGradeInfo(sub.grade_score) : null;

          let statusPill = `<span class="px-2.5 py-0.5 rounded-full bg-black/[0.05] text-[#6e6e73] text-[10px] font-semibold">Pendiente</span>`;
          if (gInfo) {
            statusPill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${gInfo.cls}">${sub.grade_score}/20 (${gInfo.letter})</span>`;
          } else if (sub) {
            statusPill = `<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 text-[10px] font-bold">Entregado</span>`;
          } else if (isSolMusic && m.evaluation_enabled === 0) {
            statusPill = `<span class="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800 text-[10px] font-bold">Repertorio</span>`;
          }

          return `
            <button type="button" onclick="selectStudentMaterial(${m.id})"
              class="card-interactive text-left p-4 sm:p-5 rounded-2xl bg-white/95 hover:bg-white border border-black/[0.07] shadow-sm flex flex-col justify-between gap-3">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-start gap-3 min-w-0">
                  <div class="w-10 h-10 rounded-xl ${isSolMusic ? 'bg-amber-500/15 text-amber-700' : 'bg-[#0071e3]/10 text-[#0071e3]'} flex items-center justify-center text-sm shrink-0">
                    <i class="fa-solid ${isSolMusic ? 'fa-music' : 'fa-book-open'}"></i>
                  </div>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="text-[10px] font-bold uppercase tracking-wider ${isSolMusic ? 'text-amber-700' : 'text-indigo-600'}">Tema ${materials.length - idx}</span>
                      ${m.target_grade ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-[10px] font-bold">${m.target_grade}</span>` : ''}
                    </div>
                    <h3 class="text-sm sm:text-base font-bold text-[#1d1d1f] break-words leading-snug mt-0.5">${m.title}</h3>
                  </div>
                </div>
                ${statusPill}
              </div>

              <div class="pt-2.5 border-t border-black/[0.05] flex items-center justify-between text-[11px] text-[#6e6e73]">
                <div class="flex items-center gap-3">
                  <span><i class="fa-regular fa-folder-open mr-1"></i>${filesCount} archivo(s)</span>
                  ${notesCount ? `<span><i class="fa-regular fa-comments mr-1"></i>${notesCount}</span>` : ''}
                  <span>${new Date(m.created_at).toLocaleDateString('es-PE')}</span>
                </div>
                <span class="font-semibold text-[#0071e3]">Abrir <i class="fa-solid fa-arrow-right ml-0.5 text-[10px]"></i></span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;
    return;
  }

  const m = activeMaterial;
  const isSolMusic = (m.publish_format === 'music') || (!m.publish_format && stuCategory === 'Sol Music');
  const ytEmbed = getYouTubeEmbedUrl(m.external_url);
  const notes = m.notes || [];
  const notesHtml = notes.map(renderSingleNoteBubble).join('');
  const activeInnerTab = studentMaterialInnerTab[m.id] || 'material';
  const sub = m.submission;
  const hasGrade = sub && sub.grade_score !== null && sub.grade_score !== undefined;
  const gInfo = hasGrade ? getStudentGradeInfo(sub.grade_score) : null;

  let materialBodyHtml = '';
  if (!isSolMusic) {
    materialBodyHtml = `
      ${m.description ? `
        <div class="p-3.5 rounded-2xl bg-[#f5f5f7] space-y-1">
          <span class="block text-[10px] font-bold uppercase tracking-wider text-[#6e6e73]">Indicaciones del tema</span>
          <p class="text-xs text-[#1d1d1f] leading-relaxed">${m.description}</p>
        </div>` : ''}

      ${ytEmbed ? `
        <div class="aspect-video w-full rounded-2xl overflow-hidden bg-black">
          <iframe src="${ytEmbed}" class="w-full h-full border-0" allowfullscreen></iframe>
        </div>` : (m.external_url ? `
        <div>
          <a href="${m.external_url}" target="_blank"
            class="btn-interactive inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/5 hover:bg-black/10 text-[#1d1d1f] text-xs font-medium">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir enlace de referencia
          </a>
        </div>` : '')}

      ${m.files && m.files.length ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          ${m.files.map(renderStudentFile).join('')}
        </div>` : '<p class="text-xs text-[#6e6e73] py-4 text-center">No hay archivos adjuntos en este tema.</p>'}
    `;
  } else {
    const files = m.files || [];
    const labels = Array.from(new Set(files.map(f => f.label || 'General (Canción completa)')));
    if (!labels.length) labels.push('General (Canción completa)');
    const activeLbl = selectedStudentSongLabel[m.id] || normalizeInstrumentMatch(stuInstrument, labels);
    selectedStudentSongLabel[m.id] = activeLbl;

    materialBodyHtml = `
      ${m.description ? `<p class="text-xs text-[#6e6e73] leading-relaxed">${m.description}</p>` : ''}
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
        <div class="lg:col-span-8" id="stuSolStage-${m.id}">
          ${renderStudentSolStage(m, activeLbl)}
        </div>
        <div class="lg:col-span-4" id="stuSolSidebar-${m.id}">
          ${renderStudentSolSidebar(m, activeLbl)}
        </div>
      </div>
    `;
  }

  const workBadge = gInfo
    ? `<span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold ${gInfo.cls}">${sub.grade_score}/20</span>`
    : (sub ? `<span class="w-2 h-2 rounded-full bg-emerald-500"></span>` : '');

  container.innerHTML = `
    <div class="section-enter space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-[#f5f5f7] border border-black/[0.06]">
        <div class="flex items-center gap-3 min-w-0">
          <button type="button" onclick="selectStudentMaterial(null)"
            class="btn-interactive px-3.5 py-2 rounded-full bg-white hover:bg-black/[0.04] border border-black/10 text-[#1d1d1f] text-xs font-semibold shrink-0">
            <i class="fa-solid fa-arrow-left mr-1.5"></i> Todos los temas
          </button>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              ${m.target_grade ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-[10px] font-bold">${m.target_grade}</span>` : ''}
              <span class="text-[10px] text-[#6e6e73]">${new Date(m.created_at).toLocaleDateString('es-PE')}</span>
            </div>
            <h3 class="text-base sm:text-lg font-bold text-[#1d1d1f] truncate">${m.title}</h3>
          </div>
        </div>

        <!-- Tabs internos compactos del tema -->
        <div class="inline-flex p-1 rounded-xl bg-black/[0.06] shrink-0">
          <button type="button" id="matTabBtn-${m.id}-material" onclick="setStudentMaterialInnerTab(${m.id}, 'material')"
            class="${activeInnerTab === 'material' ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5' : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5'}">
            <i class="fa-solid ${isSolMusic ? 'fa-music' : 'fa-folder-open'} text-[#0071e3]"></i> Material
          </button>
          <button type="button" id="matTabBtn-${m.id}-trabajo" onclick="setStudentMaterialInnerTab(${m.id}, 'trabajo')"
            class="${activeInnerTab === 'trabajo' ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5' : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5'}">
            <i class="fa-solid fa-clipboard-check text-emerald-600"></i> Tu trabajo ${workBadge}
          </button>
          <button type="button" id="matTabBtn-${m.id}-consultas" onclick="setStudentMaterialInnerTab(${m.id}, 'consultas')"
            class="${activeInnerTab === 'consultas' ? 'px-3.5 py-1.5 rounded-lg bg-white text-[#1d1d1f] shadow-sm text-xs font-bold transition inline-flex items-center gap-1.5' : 'px-3.5 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-semibold transition inline-flex items-center gap-1.5'}">
            <i class="fa-regular fa-comments text-indigo-600"></i> Consultas ${notes.length ? `<span class="px-1.5 py-0.2 rounded-full bg-indigo-500/15 text-indigo-700 text-[10px]">${notes.length}</span>` : ''}
          </button>
        </div>
      </div>

      <div id="matTabPanel-${m.id}-material" class="${activeInnerTab === 'material' ? 'section-enter' : 'hidden'} p-4 sm:p-5 rounded-2xl bg-white/95 border border-black/[0.06] space-y-4">
        ${materialBodyHtml}
      </div>

      <div id="matTabPanel-${m.id}-trabajo" class="${activeInnerTab === 'trabajo' ? 'section-enter' : 'hidden'}">
        ${renderStudentSubmissionBox(m)}
      </div>

      <div id="matTabPanel-${m.id}-consultas" class="${activeInnerTab === 'consultas' ? 'section-enter' : 'hidden'} p-4 sm:p-5 rounded-2xl bg-white/95 border border-black/[0.06] space-y-3">
        <span class="block text-xs font-bold text-[#1d1d1f]"><i class="fa-regular fa-comments mr-1.5 text-[#0071e3]"></i>Mis notas y consultas en vivo con el docente</span>
        <div id="notesList-${m.id}" class="space-y-2 max-h-72 overflow-y-auto aurora-scroll pr-1">${notesHtml || '<p class="text-[11px] text-[#6e6e73] italic">Aún no has escrito notas o consultas en este tema.</p>'}</div>
        <div class="flex flex-col sm:flex-row gap-2 pt-1">
          <select id="noteType-${m.id}" class="bg-[#f5f5f7] border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold sm:w-44">
            <option value="consulta">Consulta al profesor</option>
            <option value="personal">Nota personal (privada)</option>
          </select>
          <input type="text" id="noteInput-${m.id}" onkeydown="if(event.key==='Enter'){event.preventDefault();sendMaterialNote(${m.id});}"
            placeholder="Escribe tu duda sobre este tema o un apunte..."
            class="flex-1 bg-[#f5f5f7] border border-black/10 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-[#0071e3]">
          <button type="button" onclick="sendMaterialNote(${m.id})"
            class="btn-interactive px-4 py-2 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-semibold shrink-0">
            Enviar
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderAttendancesList() {
  if (!dashboardData) return;
  const filter = document.getElementById('attFilterSelect').value;
  let list = dashboardData.attendances || [];

  if (filter === 'Regular') {
    list = list.filter(a => (a.session_type === 'Regular' || !a.session_type));
  } else if (filter === 'Recuperacion') {
    list = list.filter(a => a.session_type === 'Recuperacion');
  } else if (filter === 'Reforzamiento') {
    list = list.filter(a => a.session_type === 'Reforzamiento');
  }

  const badgeStyles = {
    'Presente': 'bg-emerald-500/10 text-emerald-700',
    'Recuperacion': 'bg-sky-500/10 text-sky-700',
    'Tardanza': 'bg-amber-500/10 text-amber-700',
    'Falta': 'bg-red-500/10 text-red-700',
    'Justificado': 'bg-sky-500/10 text-sky-700',
    'Reforzamiento': 'bg-purple-500/10 text-purple-700'
  };

  const container = document.getElementById('studentAttendances');
  if (!list.length) {
    container.innerHTML = '<p class="col-span-full text-xs text-[#6e6e73] text-center py-10">No hay registros de asistencia en este subgrupo.</p>';
    return;
  }

  container.innerHTML = list.map(a => {
    const isRef = a.session_type === 'Reforzamiento';
    const isRec = a.session_type === 'Recuperacion';
    const label = isRec ? 'Recuperación' : a.status;
    const styleKey = isRec ? 'Recuperacion' : a.status;

    return `
      <div class="p-4 rounded-2xl bg-white/95 border border-black/[0.06] flex items-start justify-between gap-3">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-xs font-bold text-[#1d1d1f]">${a.date}</p>
            ${isRef ? `<span class="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 text-[10px] font-semibold">Reforzamiento${a.arrival_time ? ` • ${a.arrival_time}` : ''}</span>` : ''}
          </div>
          ${a.recorded_by_name ? `<p class="text-[11px] text-[#0071e3] font-medium"><i class="fa-solid fa-chalkboard-user mr-1"></i>Marcado por: ${a.recorded_by_name}</p>` : ''}
          ${a.note ? `<p class="text-[11px] text-[#6e6e73]">${a.note}</p>` : ''}
        </div>
        <span class="px-3 py-1 rounded-full text-[11px] font-semibold shrink-0 ${badgeStyles[styleKey] || 'bg-black/5'}">${label}</span>
      </div>
    `;
  }).join('');
}

let communityScope = 'grupo';

function updateCommunityPill() {
  const container = document.getElementById('communityScopeFilter');
  const activeBtn = document.getElementById(`comm-scope-${communityScope}`);
  if (!container || !activeBtn || activeBtn.classList.contains('hidden')) return;
  const pill = container.querySelector('.segmented-pill');
  if (!pill || !activeBtn.offsetWidth) return;
  pill.style.width = `${activeBtn.offsetWidth}px`;
  pill.style.transform = `translate3d(${activeBtn.offsetLeft}px, 0, 0)`;
}

function setCommunityScope(scope) {
  communityScope = scope;
  ['grupo', 'solmusic', 'profesores'].forEach(s => {
    const btn = document.getElementById(`comm-scope-${s}`);
    if (btn) {
      btn.className = (btn.classList.contains('hidden') ? 'hidden ' : '') +
        (s === scope
          ? 'comm-scope-btn segmented-btn px-3 py-1.5 rounded-lg text-[#1d1d1f]'
          : 'comm-scope-btn segmented-btn px-3 py-1.5 rounded-lg text-[#6e6e73] hover:text-[#1d1d1f]');
    }
  });
  updateCommunityPill();
  renderClassmatesSection();
}

function renderClassmatesSection() {
  if (!dashboardData) return;
  const myId = Number(dashboardData.student.id);
  const isSolStudent = (dashboardData.enrolledGroups || []).some(g => g.category === 'Sol Music') || dashboardData.student.category === 'Sol Music';
  const solBtn = document.getElementById('comm-scope-solmusic');
  if (solBtn) solBtn.classList.toggle('hidden', !isSolStudent);
  if (!isSolStudent && communityScope === 'solmusic') communityScope = 'grupo';

  let list = [];
  let mode = 'student';
  if (communityScope === 'profesores') {
    list = dashboardData.teachers || [];
    mode = 'teacher';
    document.getElementById('classmatesCountBadge').innerText = `${list.length} docente(s)`;
  } else if (communityScope === 'solmusic') {
    list = dashboardData.solMusicCommunity || [];
    document.getElementById('classmatesCountBadge').innerText = `${list.length} en Sol Music`;
  } else {
    list = dashboardData.classmates || [];
    document.getElementById('classmatesGroupTitle').innerText = dashboardData.student.group_name || 'tu grupo';
    document.getElementById('classmatesCountBadge').innerText = `${list.length} integrante(s)`;
  }

  requestAnimationFrame(() => updateCommunityPill());

  const grid = document.getElementById('classmatesGrid');
  if (!list.length) {
    grid.innerHTML = `<p class="col-span-full text-xs text-[#6e6e73] text-center py-10">${mode === 'teacher' ? 'No hay docentes registrados todavía.' : 'Aún no hay otros compañeros registrados aquí.'}</p>`;
    return;
  }

  const isSolGroup = communityScope === 'solmusic' || dashboardData.student.category === 'Sol Music';
  grid.innerHTML = list.map(cm => {
    const isMe = mode === 'student' && Number(cm.id) === myId;
    const avatarHtml = cm.avatar_file
      ? `<img src="/intranet/api/avatars/${cm.avatar_file}" alt="${cm.full_name}" class="w-14 h-14 rounded-2xl object-cover border border-black/10 shrink-0">`
      : `<div class="w-14 h-14 rounded-2xl bg-gradient-to-br ${mode === 'teacher' ? 'from-amber-500 to-orange-600' : 'from-[#0071e3]/85 to-indigo-600/85'} text-white flex items-center justify-center text-lg font-bold shrink-0">${cm.full_name.charAt(0)}</div>`;

    let specialtyBadge = '';
    if (mode === 'teacher') {
      specialtyBadge = `<span class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 font-semibold text-[10px]"><i class="fa-solid fa-chalkboard-user mr-1"></i>${cm.specialty || 'Docente'}</span>`;
    } else if (isSolGroup) {
      specialtyBadge = cm.instrument ? `<span class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 font-semibold text-[10px]"><i class="fa-solid fa-guitar mr-1"></i>${cm.instrument}</span>` : '';
    } else {
      specialtyBadge = cm.grade ? `<span class="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 font-semibold text-[10px]"><i class="fa-solid fa-graduation-cap mr-1"></i>${cm.grade}</span>` : '';
    }

    return `
      <button type="button" onclick="openClassmateModal(${cm.id}, '${mode}')"
        class="card-interactive text-left p-4 rounded-2xl bg-white/95 hover:bg-white border ${isMe ? 'border-[#0071e3]/35 ring-1 ring-[#0071e3]/15' : 'border-black/[0.06]'} shadow-sm flex items-start gap-3.5">
        ${avatarHtml}
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-1.5">
            <p class="text-sm font-bold text-[#1d1d1f] truncate">${cm.full_name}</p>
            ${isMe ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 text-[9px] font-bold shrink-0">Tú</span>' : ''}
          </div>
          ${specialtyBadge ? `<div class="flex flex-wrap items-center gap-1.5 pt-0.5">${specialtyBadge}</div>` : ''}
          ${cm.schedule ? `<p class="text-[11px] text-[#0071e3] font-medium truncate"><i class="fa-regular fa-clock mr-1"></i>${cm.schedule}</p>` : ''}
          <p class="text-xs text-[#6e6e73] line-clamp-2 leading-relaxed">
            ${cm.bio ? cm.bio : '<span class="italic opacity-75">Sin descripción personal</span>'}
          </p>
          <span class="inline-block pt-1 text-[11px] font-semibold text-[#0071e3]">Ver perfil &rarr;</span>
        </div>
      </button>
    `;
  }).join('');
}

function openClassmateModal(personId, mode = 'student') {
  if (!dashboardData) return;
  let cm = null;
  if (mode === 'teacher') {
    cm = (dashboardData.teachers || []).find(t => Number(t.id) === Number(personId));
  } else {
    cm = (dashboardData.classmates || []).find(c => Number(c.id) === Number(personId))
      || (dashboardData.solMusicCommunity || []).find(c => Number(c.id) === Number(personId));
  }
  if (!cm) return;

  const isMe = mode === 'student' && Number(cm.id) === Number(dashboardData.student.id);
  const isSolGroup = communityScope === 'solmusic' || dashboardData.student.category === 'Sol Music';
  document.getElementById('cmModalName').innerText = cm.full_name;
  document.getElementById('cmModalBadge').innerText = mode === 'teacher' ? 'Plana Docente' : (communityScope === 'solmusic' ? 'Sol Music' : (dashboardData.student.group_name || 'Grupo'));

  const instBadge = document.getElementById('cmModalInstBadge');
  if (mode === 'teacher') {
    instBadge.className = 'px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800 text-[11px] font-bold';
    instBadge.innerHTML = `<i class="fa-solid fa-chalkboard-user mr-1"></i><span>${cm.specialty || 'Docente'}</span>`;
    instBadge.classList.remove('hidden');
  } else if (isSolGroup) {
    if (cm.instrument) {
      instBadge.className = 'px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800 text-[11px] font-bold';
      instBadge.innerHTML = `<i class="fa-solid fa-guitar mr-1"></i><span>${cm.instrument}</span>`;
      instBadge.classList.remove('hidden');
    } else {
      instBadge.classList.add('hidden');
    }
  } else {
    if (cm.grade) {
      instBadge.className = 'px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 text-[11px] font-bold';
      instBadge.innerHTML = `<i class="fa-solid fa-graduation-cap mr-1"></i><span>${cm.grade}</span>`;
      instBadge.classList.remove('hidden');
    } else {
      instBadge.classList.add('hidden');
    }
  }
  document.getElementById('cmModalYouTag').classList.toggle('hidden', !isMe);

  const msgBtn = document.getElementById('cmModalMsgBtn');
  if (msgBtn) {
    if (mode === 'student' && !isMe) {
      msgBtn.classList.remove('hidden');
      msgBtn.onclick = () => {
        closeClassmateModal();
        switchStudentTab('mensajes');
        openStudentDmChat(cm.id, cm.full_name);
      };
    } else {
      msgBtn.classList.add('hidden');
    }
  }

  const schEl = document.getElementById('cmModalSchedule');
  if (cm.schedule) {
    schEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i>Horario: ${cm.schedule}`;
    schEl.classList.remove('hidden');
  } else {
    schEl.classList.add('hidden');
  }

  const bioEl = document.getElementById('cmModalBio');
  if (cm.bio && cm.bio.trim()) {
    bioEl.innerText = cm.bio;
    bioEl.className = 'text-xs text-[#1d1d1f] leading-relaxed';
  } else {
    bioEl.innerText = 'Este estudiante aún no ha agregado una descripción personal.';
    bioEl.className = 'text-xs text-[#6e6e73] italic leading-relaxed';
  }

  const imgEl = document.getElementById('cmModalAvatarImg');
  const fbEl = document.getElementById('cmModalAvatarFallback');
  if (cm.avatar_file) {
    imgEl.src = `/intranet/api/avatars/${cm.avatar_file}`;
    imgEl.classList.remove('hidden');
    fbEl.classList.add('hidden');
  } else {
    imgEl.classList.add('hidden');
    fbEl.innerText = cm.full_name.charAt(0);
    fbEl.classList.remove('hidden');
  }

  document.getElementById('classmateProfileModal').classList.remove('hidden');
}

function closeClassmateModal() {
  document.getElementById('classmateProfileModal').classList.add('hidden');
}

function onStudentGroupSwitch(newGroupId) {
  activeGroupId = Number(newGroupId);
  loadStudentPortal(activeGroupId);
}

async function loadStudentPortal(targetGroupId = null) {
  const url = targetGroupId
    ? `/intranet/api/student/dashboard?group_id=${encodeURIComponent(targetGroupId)}`
    : '/intranet/api/student/dashboard';
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 401) return logout();
  dashboardData = await res.json();

  const stu = dashboardData.student;
  activeGroupId = stu.active_group_id || stu.group_id;

  document.getElementById('studentName').innerText = stu.full_name;
  document.getElementById('navStudentShortName').innerText = stu.full_name.split(' ')[0];
  document.getElementById('studentCode').innerText = `Usuario: ${stu.code}`;

  const switcher = document.getElementById('studentGroupSwitcher');
  const eGroups = dashboardData.enrolledGroups || [];
  if (eGroups.length) {
    switcher.innerHTML = eGroups.map(g =>
      `<option value="${g.id}" ${Number(g.id) === Number(activeGroupId) ? 'selected' : ''}>${g.name}</option>`
    ).join('');
  } else {
    switcher.innerHTML = `<option value="${activeGroupId || ''}">${stu.group_name || 'Sin grupo'}</option>`;
  }

  updateAvatarDisplays(stu.avatar_file);

  const bioInput = document.getElementById('bioInput');
  bioInput.value = stu.bio || '';
  document.getElementById('bioCharCount').innerText = `${(stu.bio || '').length}/400`;
  const bioPreview = document.getElementById('studentBioPreview');
  if (stu.bio) {
    bioPreview.innerText = stu.bio;
    bioPreview.classList.remove('hidden');
  } else {
    bioPreview.classList.add('hidden');
  }

  const schText = stu.group_schedule || stu.schedule;
  if (schText) {
    const schEl = document.getElementById('studentSchedule');
    schEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i>Horario: ${schText}`;
    schEl.classList.remove('hidden');
  }

  const catBadge = document.getElementById('categoryBadge');
  const cat = stu.category || 'Particulares';
  if (cat === 'Sol Music') {
    catBadge.innerText = `Sol Music • ${stu.instrument || 'Música'}`;
    catBadge.className = 'inline-block px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800 text-[11px] font-semibold';
  } else {
    catBadge.innerText = `Estudiante de Matemáticas${stu.grade ? ` • ${stu.grade}` : ''}`;
    catBadge.className = 'inline-block px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-800 text-[11px] font-semibold';
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const quota = stu.monthly_quota || 8;
  const regularAtts = dashboardData.attendances.filter(a => (a.session_type === 'Regular' || a.session_type === 'Recuperacion' || !a.session_type));
  const usedMonth = regularAtts.filter(a =>
    a.date.startsWith(currentMonth) && ['Presente', 'Tardanza', 'Justificado'].includes(a.status)
  ).length;
  const refCount = dashboardData.attendances.filter(a => a.session_type === 'Reforzamiento').length;

  const totalReg = regularAtts.length;
  const validReg = regularAtts.filter(a => ['Presente', 'Tardanza', 'Justificado'].includes(a.status)).length;
  const pct = totalReg > 0 ? Math.round((validReg / totalReg) * 100) : 100;

  document.getElementById('statBlock').innerText = `${usedMonth}/${quota}`;
  document.getElementById('statRef').innerText = refCount;
  document.getElementById('statPct').innerText = `${pct}%`;

  const anns = dashboardData.announcements || [];
  const bannerEl = document.getElementById('studentAnnouncementsBanner');
  if (anns.length) {
    bannerEl.innerHTML = anns.map(a => `
      <div class="p-4 rounded-2xl bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-orange-500/10 border border-rose-500/20 flex items-start gap-3">
        <div class="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 mt-0.5">
          <i class="fa-solid fa-bullhorn text-xs"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-xs sm:text-sm font-bold text-[#1d1d1f]">${a.title}</h3>
            ${a.event_date ? `<span class="px-2 py-0.5 rounded-full bg-white/80 text-rose-700 text-[10px] font-bold"><i class="fa-regular fa-calendar mr-1"></i>${a.event_date}</span>` : ''}
          </div>
          <p class="text-xs text-[#424245] mt-0.5 leading-relaxed">${a.message}</p>
        </div>
      </div>
    `).join('');
    bannerEl.classList.remove('hidden');
  } else {
    bannerEl.classList.add('hidden');
  }

  renderMaterialsSection(dashboardData.materials || []);
  renderAttendancesList();
  renderClassmatesSection();
}

let studentSseSource = null;
let studentSseRetryMs = 3000;
let studentSseTimer = null;

function setStudentChatBadge(state) {
  const el = document.getElementById('liveChatStatus');
  if (!el) return;
  if (state === 'live') {
    el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/25 text-[10px] font-semibold';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Chat en vivo';
  } else {
    el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/25 text-[10px] font-semibold';
    el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Reconectando...';
  }
}

function initRealtimeChat() {
  if (studentSseSource) {
    studentSseSource.close();
    studentSseSource = null;
  }
  if (studentSseTimer) {
    clearTimeout(studentSseTimer);
    studentSseTimer = null;
  }

  const evtSource = new EventSource(`/intranet/api/chat/stream?token=${encodeURIComponent(token)}`);
  studentSseSource = evtSource;

  evtSource.onopen = () => {
    studentSseRetryMs = 3000;
    setStudentChatBadge('live');
  };

  evtSource.onerror = () => {
    setStudentChatBadge('reconnecting');
    evtSource.close();
    if (studentSseSource === evtSource) studentSseSource = null;
    const wait = studentSseRetryMs;
    studentSseRetryMs = Math.min(studentSseRetryMs * 2, 30000);
    studentSseTimer = setTimeout(initRealtimeChat, wait);
  };

  evtSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'notification' && payload.notification) {
        studentNotificationsCache.unshift(payload.notification);
        updateStudentNotifBadges(studentNotificationsCache.filter(n => !n.is_read).length);
        renderStudentNotificationsList();
        return;
      }
      if (payload.type === 'student_dm' && payload.message) {
        onIncomingStudentDm(payload.message);
        return;
      }
      if (payload.type === 'chat_message' && payload.message && dashboardData) {
        const msg = payload.message;
        if (Number(msg.student_id) !== Number(dashboardData.student.id)) return;
        const mat = (dashboardData.materials || []).find(m => Number(m.id) === Number(msg.material_id));
        if (!mat) return;
        if (!mat.notes) mat.notes = [];
        if (mat.notes.some(existing => Number(existing.id) === Number(msg.id))) return;

        mat.notes.push(msg);
        const listEl = document.getElementById(`notesList-${msg.material_id}`);
        if (listEl) {
          listEl.insertAdjacentHTML('beforeend', renderSingleNoteBubble(msg));
        }
      }
    } catch {}
  };
}

window.addEventListener('online', () => {
  if (!studentSseSource) {
    studentSseRetryMs = 3000;
    initRealtimeChat();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const notifModal = document.getElementById('notificationsModal');
  if (notifModal && !notifModal.classList.contains('hidden')) return closeNotificationsModal();
  const pdfModal = document.getElementById('pdfViewerModal');
  if (pdfModal && !pdfModal.classList.contains('hidden')) return closePdfModal();
  const imgModal = document.getElementById('imageViewerModal');
  if (imgModal && !imgModal.classList.contains('hidden')) return closeImageModal();
  const cmModal = document.getElementById('classmateProfileModal');
  if (cmModal && !cmModal.classList.contains('hidden')) return closeClassmateModal();
});

let studentNotificationsCache = [];

function updateStudentNotifBadges(unreadCount) {
  document.querySelectorAll('.notif-unread-badge').forEach(el => {
    if (unreadCount > 0) {
      el.innerText = unreadCount > 9 ? '9+' : String(unreadCount);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

function renderStudentNotificationsList() {
  const listEl = document.getElementById('notificationsList');
  if (!listEl) return;
  if (!studentNotificationsCache.length) {
    listEl.innerHTML = '<div class="p-6 rounded-2xl bg-white/90 text-center text-xs text-[#6e6e73]">No tienes notificaciones por ahora.</div>';
    return;
  }
  const iconMap = {
    announcement: { icon: 'fa-bullhorn', cls: 'bg-rose-500/15 text-rose-600' },
    new_task: { icon: 'fa-book-open', cls: 'bg-[#0071e3]/15 text-[#0071e3]' },
    task_reminder: { icon: 'fa-clock', cls: 'bg-amber-500/15 text-amber-700' },
    grade: { icon: 'fa-star', cls: 'bg-emerald-500/15 text-emerald-700' }
  };
  listEl.innerHTML = studentNotificationsCache.map(n => {
    const meta = iconMap[n.type] || { icon: 'fa-bell', cls: 'bg-sky-500/15 text-sky-700' };
    const unreadCls = n.is_read ? 'bg-white/75 border-black/[0.06] opacity-80' : 'bg-white border-[#0071e3]/30 shadow-sm';
    return `
      <button type="button" onclick="onStudentNotificationClick(${n.id}, '${(n.link_hash || '').replace(/'/g, "\\'")}')"
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

async function loadStudentNotifications() {
  try {
    const res = await fetch('/intranet/api/notifications', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    studentNotificationsCache = data.notifications || [];
    updateStudentNotifBadges(data.unread_count || 0);
    renderStudentNotificationsList();
  } catch {}
}

function openNotificationsModal() {
  loadStudentNotifications();
  document.getElementById('notificationsModal').classList.remove('hidden');
}

function closeNotificationsModal() {
  document.getElementById('notificationsModal').classList.add('hidden');
}

async function markAllNotificationsRead() {
  await fetch('/intranet/api/notifications/read', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({})
  });
  studentNotificationsCache = studentNotificationsCache.map(n => ({ ...n, is_read: 1 }));
  updateStudentNotifBadges(0);
  renderStudentNotificationsList();
}

async function onStudentNotificationClick(id, linkHash) {
  await fetch('/intranet/api/notifications/read', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ id })
  });
  studentNotificationsCache = studentNotificationsCache.map(n => Number(n.id) === Number(id) ? { ...n, is_read: 1 } : n);
  updateStudentNotifBadges(studentNotificationsCache.filter(n => !n.is_read).length);
  renderStudentNotificationsList();
  closeNotificationsModal();
  if (linkHash) {
    applyStudentRouteFromHash(linkHash);
    syncStudentUrl(true);
  }
}

window.addEventListener('DOMContentLoaded', loadStudentNotifications);

document.getElementById('bioInput').addEventListener('input', (e) => {
  document.getElementById('bioCharCount').innerText = `${e.target.value.length}/400`;
});

document.getElementById('bioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bio = document.getElementById('bioInput').value;
  const res = await fetch('/intranet/api/student/profile', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bio })
  });
  if (res.ok) {
    const fb = document.getElementById('bioFeedback');
    fb.innerText = 'Descripción actualizada';
    loadStudentPortal(activeGroupId);
    setTimeout(() => fb.innerText = '', 3000);
  }
});

async function uploadStudentAvatar() {
  const input = document.getElementById('avatarFileInput');
  if (!input.files || !input.files[0]) {
    alert('Selecciona primero una imagen');
    return;
  }
  const btn = document.getElementById('btnSaveAvatar');
  btn.disabled = true;
  btn.innerText = 'Subiendo...';

  const formData = new FormData();
  formData.append('avatar', input.files[0]);

  const res = await fetch('/intranet/api/student/avatar', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  btn.disabled = false;
  btn.innerText = 'Subir foto';

  if (res.ok) {
    const data = await res.json();
    updateAvatarDisplays(data.avatar_file);
    input.value = '';
    const fb = document.getElementById('avatarFeedback');
    fb.innerText = 'Foto de perfil actualizada';
    setTimeout(() => fb.innerText = '', 3000);
  } else {
    const err = await res.json();
    alert(err.error || 'Error subiendo la fotografía');
  }
}

document.getElementById('studentPassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('curPassInput').value;
  const newPassword = document.getElementById('newPassInput').value;
  const confirmPassword = document.getElementById('confirmPassInput').value;
  const box = document.getElementById('passFeedbackBox');

  if (newPassword !== confirmPassword) {
    box.className = 'p-3 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium';
    box.innerText = 'Las contraseñas nuevas no coinciden';
    box.classList.remove('hidden');
    return;
  }

  const res = await fetch('/intranet/api/change-password', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ currentPassword, newPassword })
  });
  const data = await res.json();
  if (res.ok) {
    box.className = 'p-3 rounded-xl bg-emerald-500/10 text-emerald-700 text-xs font-medium';
    box.innerText = 'Contraseña actualizada correctamente';
    box.classList.remove('hidden');
    document.getElementById('studentPassForm').reset();
  } else {
    box.className = 'p-3 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium';
    box.innerText = data.error || 'Error actualizando contraseña';
    box.classList.remove('hidden');
  }
});

async function sendMaterialNote(materialId) {
  const noteType = document.getElementById(`noteType-${materialId}`).value;
  const input = document.getElementById(`noteInput-${materialId}`);
  const content = input.value.trim();
  if (!content) return;

  input.value = '';
  const res = await fetch(`/intranet/api/student/materials/${materialId}/notes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ note_type: noteType, content })
  });
  if (res.ok) {
    const created = await res.json();
    const mat = (dashboardData.materials || []).find(m => Number(m.id) === Number(materialId));
    if (mat) {
      if (!mat.notes) mat.notes = [];
      if (!mat.notes.some(n => Number(n.id) === Number(created.id))) {
        mat.notes.push(created);
        const listEl = document.getElementById(`notesList-${materialId}`);
        if (listEl) listEl.insertAdjacentHTML('beforeend', renderSingleNoteBubble(created));
      }
    }
  }
}

async function deleteStudentNote(noteId) {
  if (!confirm('¿Eliminar esta nota o consulta?')) return;
  await fetch(`/intranet/api/student/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  loadStudentPortal(activeGroupId);
}

loadStudentPortal().then(() => {
  initRealtimeChat();
  if (window.location.hash) {
    applyStudentRouteFromHash(window.location.hash);
  } else {
    syncStudentUrl(false);
  }
});
