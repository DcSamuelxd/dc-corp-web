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

  try {
    const res = await fetch('/intranet/api/admin/hub-summary', {
      headers: { Authorization: `Bearer ${hubToken}` }
    });
    if (res.status === 401 || res.status === 403) {
      logoutHub();
      return;
    }
    const d = await res.json();

    const eduEl = document.getElementById('hubEduStats');
    if (eduEl) {
      eduEl.textContent = `${d.students_count || 0} alumnos${d.ungraded_count ? ` • ${d.ungraded_count} por revisar` : ''}`;
    }

    const tiEl = document.getElementById('hubTiStats');
    if (tiEl) {
      tiEl.textContent = `${d.ti_orders_count || 0} trabajos • ${d.ti_invoices_count || 0} recibos`;
    }

    const badge = document.getElementById('hubWaBadge');
    const waFoot = document.getElementById('hubWaFooterText');
    if (badge) {
      if (d.wa_status === 'connected') {
        badge.textContent = `● Conectado${d.wa_phone ? ' +' + d.wa_phone : ''}`;
        badge.className = 'px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold';
      } else if (d.wa_status === 'qr') {
        badge.textContent = '● Esperando QR';
        badge.className = 'px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold';
      } else {
        badge.textContent = '● Desconectado';
        badge.className = 'px-2.5 py-1 rounded-full bg-slate-200/80 text-slate-700 text-[10px] font-bold';
      }
    }
    if (waFoot && Number(d.wa_unread_count) > 0) {
      waFoot.textContent = `Abrir Centro (${d.wa_unread_count} sin leer)`;
    }
  } catch {}
});
