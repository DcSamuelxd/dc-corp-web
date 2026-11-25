const ua = navigator.userAgent || '';
const isAndroid = /Android/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

const badge = document.getElementById('deviceBadge');
const hintBox = document.getElementById('installHint');
const hintText = document.getElementById('installHintText');

if (isAndroid) {
  badge.innerHTML = '<i class="fa-brands fa-android text-emerald-600 mr-1"></i> Vista Móvil Android';
  if (!isStandalone) {
    hintText.innerHTML = 'Tip Android: toca el menú <strong>⋮</strong> de Chrome y elige <strong>"Añadir a pantalla de inicio"</strong> para usarla como app.';
    hintBox.classList.remove('hidden');
  }
} else if (isIOS) {
  badge.innerHTML = '<i class="fa-brands fa-apple mr-1"></i> Vista Móvil iOS';
  if (!isStandalone) {
    hintText.innerHTML = 'Tip iPhone: toca <strong>Compartir</strong> en Safari y elige <strong>"Agregar a inicio"</strong>.';
    hintBox.classList.remove('hidden');
  }
}

function togglePassVisibility() {
  const inp = document.getElementById('password');
  const icon = document.getElementById('eyeIcon');
  if (inp.type === 'password') {
    inp.type = 'text';
    icon.className = 'fa-regular fa-eye-slash';
  } else {
    inp.type = 'password';
    icon.className = 'fa-regular fa-eye';
  }
}

const existingToken = localStorage.getItem('dc_token');
const existingRole = localStorage.getItem('dc_role');
if (existingToken && existingRole) {
  window.location.replace((existingRole === 'admin' || existingRole === 'teacher') ? '/intranet/admin.html' : '/intranet/student.html');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('errorBox');
  const btn = document.getElementById('submitBtn');
  errorBox.classList.add('hidden');
  btn.disabled = true;
  btn.innerText = 'Verificando...';

  try {
    const res = await fetch('/intranet/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: document.getElementById('code').value,
        password: document.getElementById('password').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    localStorage.setItem('dc_token', data.token);
    localStorage.setItem('dc_role', data.role);
    localStorage.setItem('dc_name', data.full_name);

    window.location.replace((data.role === 'admin' || data.role === 'teacher') ? '/intranet/admin.html' : '/intranet/student.html');
  } catch (err) {
    errorBox.innerText = err.message;
    errorBox.classList.remove('hidden');
    btn.disabled = false;
    btn.innerText = 'Ingresar a la Intranet';
  }
});
