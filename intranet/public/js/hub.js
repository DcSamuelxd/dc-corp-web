const hubToken = localStorage.getItem('dc_token');
const hubRole = localStorage.getItem('dc_role');
const hubName = localStorage.getItem('dc_name') || 'Administrador';

if (!hubToken) {
  window.location.replace('/intranet');
} else if (hubRole === 'teacher') {
  window.location.replace('/intranet/panel');
} else if (hubRole !== 'admin') {
  window.location.replace('/intranet/estudiante');
}

function logoutHub() {
  localStorage.clear();
  window.location.href = '/intranet';
}

document.addEventListener('DOMContentLoaded', async () => {
  const nameEl = document.getElementById('hubAdminName');
  if (nameEl) nameEl.textContent = hubName;

  const badge = document.getElementById('hubWaBadge');
  if (!badge) return;
  try {
    const res = await fetch('/intranet/api/admin/whatsapp/status', {
      headers: { Authorization: `Bearer ${hubToken}` }
    });
    if (res.status === 401 || res.status === 403) {
      logoutHub();
      return;
    }
    const data = await res.json();
    if (data.status === 'connected') {
      badge.textContent = `Conectado${data.phoneNumber ? ' +' + data.phoneNumber : ''}`;
      badge.className = 'px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold';
    } else if (data.status === 'qr') {
      badge.textContent = 'Esperando QR';
      badge.className = 'px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold';
    } else {
      badge.textContent = 'Desconectado';
      badge.className = 'px-2.5 py-1 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-bold';
    }
  } catch {
    badge.textContent = 'Sin conexión';
  }
});
