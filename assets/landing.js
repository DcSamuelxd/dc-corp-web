let scene, camera, renderer;
let nodeGroup, wireframeIcosahedron, particleSystem;
let mouseX = 0, mouseY = 0;
let targetX = 0, targetY = 0;
let currentMeshMode = 0;

function initThreeJS() {
  const canvas = document.getElementById('webgl-canvas');
  const container = document.getElementById('hero');
  if (!canvas || !container || typeof THREE === 'undefined') return;

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.z = 115;

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  nodeGroup = new THREE.Group();
  scene.add(nodeGroup);

  const icoGeo = new THREE.IcosahedronGeometry(36, 1);
  const icoMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
    transparent: true,
    opacity: 0.24
  });
  wireframeIcosahedron = new THREE.Mesh(icoGeo, icoMat);
  nodeGroup.add(wireframeIcosahedron);

  const particleCount = 135;
  const particlesGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 165;
    positions[i + 1] = (Math.random() - 0.5) * 105;
    positions[i + 2] = (Math.random() - 0.5) * 110;
  }
  particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const pMat = new THREE.PointsMaterial({
    color: 0x00e5ff,
    size: 1.5,
    transparent: true,
    opacity: 0.72
  });
  particleSystem = new THREE.Points(particlesGeo, pMat);
  nodeGroup.add(particleSystem);

  const lineMat = new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.14 });
  const linePoints = [];
  for (let i = 0; i < particleCount; i++) {
    for (let j = i + 1; j < particleCount; j++) {
      const dx = positions[i * 3] - positions[j * 3];
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 30) {
        linePoints.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        linePoints.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
  nodeGroup.add(new THREE.LineSegments(lineGeo, lineMat));

  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', onWindowResize);
  animate3D();
}

function onMouseMove(event) {
  mouseX = (event.clientX - window.innerWidth / 2) * 0.035;
  mouseY = (event.clientY - window.innerHeight / 2) * 0.035;
}

function onWindowResize() {
  const container = document.getElementById('hero');
  if (!container || !renderer || !camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate3D() {
  requestAnimationFrame(animate3D);
  if (nodeGroup) {
    nodeGroup.rotation.y += 0.0014;
    nodeGroup.rotation.x += 0.0005;
    targetX += (mouseX - targetX) * 0.05;
    targetY += (mouseY - targetY) * 0.05;
    nodeGroup.position.x = targetX * 0.35;
    nodeGroup.position.y = -targetY * 0.35;
  }
  if (particleSystem) {
    particleSystem.rotation.y -= 0.0004;
  }
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

const symptomData = {
  slowness: {
    title: 'Diagnóstico preliminar: Lentitud en inicio y carga',
    desc: 'Frecuentemente provocado por discos mecánicos (HDD) degradados, saturación de registros de Windows o memoria RAM insuficiente para la multitarea moderna.',
    solution: '✓ Solución DC CORP: Clonación a SSD M.2 NVMe ultrarrápido, ampliación de RAM y limpieza lógica de arranque.',
    waText: 'Hola Víctor, mi PC presenta lentitud extrema y quisiera cotizar un mantenimiento preventivo o repotenciación con SSD.'
  },
  overheating: {
    title: 'Diagnóstico preliminar: Sobrecalentamiento y apagados repentinos',
    desc: 'La pasta térmica del procesador se secó, ventiladores obstruidos por polvo o el disipador perdió presión de contacto.',
    solution: '✓ Solución DC CORP: Mantenimiento térmico profundo con pasta térmica de alta conductividad y lubricación de ventiladores.',
    waText: 'Hola Víctor, mi computadora calienta mucho y se apaga sola. Necesito cotizar un mantenimiento térmico profundo.'
  },
  bsod: {
    title: 'Diagnóstico preliminar: Pantallas Azules (Blue Screen)',
    desc: 'Suele deberse a módulos de memoria RAM defectuosos con errores de paridad, sectores dañados en disco o controladores corruptos.',
    solution: '✓ Solución DC CORP: Testeo exhaustivo de hardware con herramientas de diagnóstico e instalación limpia de controladores.',
    waText: 'Hola Víctor, mi PC me tira pantalla azul frecuentemente. Quisiera cotizar una revisión y diagnóstico de componentes.'
  },
  novideo: {
    title: 'Diagnóstico preliminar: Enciende ventiladores pero no da video',
    desc: 'Fallo típico en contactos de slots RAM, sulfatación, fuente de poder que perdió una línea de 12V o BIOS desconfigurada.',
    solution: '✓ Solución DC CORP: Diagnóstico a nivel de voltajes, limpieza de sockets y descarte pieza por pieza en banco de prueba.',
    waText: 'Hola Víctor, mi computadora prende las luces y ventiladores pero la pantalla no da video. ¿Cuándo podrías revisarla?'
  },
  network: {
    title: 'Diagnóstico preliminar: Internet inestable o caídas continuas',
    desc: 'Conectores RJ45 rotos, cable UTP quebrado internamente o router del operador saturado por exceso de equipos conectados.',
    solution: '✓ Solución DC CORP: Cableado estructurado Cat6 certificado, crimpado profesional e instalación de Switch / Access Point.',
    waText: 'Hola Víctor, tengo caídas constantes de internet en mi local/casa y necesito revisar el cableado y router.'
  },
  cctv: {
    title: 'Diagnóstico preliminar: Cámaras de seguridad sin señal o app desconectada',
    desc: 'Fallo en la fuente de poder centralizada de 12V, baluns quemados o pérdida de enlace en la red local del DVR/NVR.',
    solution: '✓ Solución DC CORP: Sustitución de fuentes, ajuste de conectores de video y restablecimiento de acceso remoto en celulares.',
    waText: 'Hola Víctor, mis cámaras de seguridad se desconectaron o no se ven en el celular. Quisiera coordinar una visita técnica.'
  }
};

function selectSymptom(key) {
  const data = symptomData[key];
  if (!data) return;

  document.querySelectorAll('.symptom-btn').forEach(btn => {
    if (btn.getAttribute('data-sym') === key) {
      btn.className = 'symptom-btn p-4 rounded-2xl border border-[#0071e3] bg-white text-[#0071e3] text-xs font-semibold flex flex-col items-center gap-2.5 transition shadow-sm';
    } else {
      btn.className = 'symptom-btn p-4 rounded-2xl border border-black/[0.08] bg-white/70 text-[#424245] text-xs font-medium flex flex-col items-center gap-2.5 transition hover:bg-white';
    }
  });

  document.getElementById('diagTitle').innerText = data.title;
  document.getElementById('diagDescription').innerText = data.desc;
  document.getElementById('diagSolution').innerText = data.solution;
  document.getElementById('diagContactBtn').href = `https://wa.me/51992507489?text=${encodeURIComponent(data.waText)}`;
}

const serviceOptionsMap = {
  'Servicio Técnico PC / Laptop': {
    scaleLabel: '2. Tipo de Soporte Técnico',
    options: [
      { text: 'Mantenimiento Preventivo (Limpieza + Pasta térmica) - 1 PC', mult: 1.0 },
      { text: 'Mantenimiento Correctivo + Formateo y Respaldo - 1 PC', mult: 1.4 },
      { text: 'Repotenciación Completa (Instalación SSD + Clonación)', mult: 1.6 },
      { text: 'Pack Corporativo / Oficina (3 a 5 PCs en lote)', mult: 3.5 }
    ]
  },
  'Cableado de Red LAN (Cat6)': {
    scaleLabel: '2. Cantidad de Puntos de Red',
    options: [
      { text: '1 a 2 Puntos de red (Hogar / Habitación / Router)', mult: 1.8 },
      { text: '3 a 6 Puntos de red LAN (Pequeña Oficina)', mult: 4.2 },
      { text: '7 a 15 Puntos + Peinado de Rack / Switch', mult: 8.5 },
      { text: 'Reorganización y etiquetado de rack existente', mult: 3.0 }
    ]
  },
  'CCTV y Videovigilancia': {
    scaleLabel: '2. Sistema de Cámaras',
    options: [
      { text: 'Kit 2 Cámaras de Seguridad + DVR + Configuración Móvil', mult: 3.8 },
      { text: 'Kit 4 Cámaras de Seguridad + DVR + Disco Duro 1TB', mult: 7.2 },
      { text: 'Kit 8 Cámaras de Seguridad para negocio o almacén', mult: 13.5 },
      { text: 'Mantenimiento y reconfiguración de cámaras existentes', mult: 1.5 }
    ]
  },
  'Ensamble y Venta de PC': {
    scaleLabel: '2. Gama de Computadora',
    options: [
      { text: 'PC Ofimática / Estudiante (Gama Económica)', mult: 1.0 },
      { text: 'PC Para Oficina Rápida / Facturación (Core i3 / Ryzen 3)', mult: 1.25 },
      { text: 'Workstation Diseño / Ciencia de Datos (Core i5 + RTX)', mult: 2.2 },
      { text: 'PC Gamer Alta Tasa de FPS (Core i7 / Ryzen 7 + RTX)', mult: 2.9 }
    ]
  },
  'Asesoría en Proyectos de Estadística': {
    scaleLabel: '2. Alcance del Análisis Estadístico',
    options: [
      { text: 'Procesamiento descriptivo + Tablas y gráficos (SPSS / Excel)', mult: 1.0 },
      { text: 'Prueba de hipótesis, normalidad y correlación (Tesis / Artículo)', mult: 1.6 },
      { text: 'Modelos avanzados (Regresión, ANOVA, R / Python) + Interpretación', mult: 2.3 },
      { text: 'Acompañamiento integral desde instrumento hasta sustentación', mult: 3.0 }
    ]
  },
  'Clases Particulares (Matemáticas / Música)': {
    scaleLabel: '2. Materia y Paquete de Sesiones',
    options: [
      { text: 'Matemáticas (Escolar / Pre) - Sesión individual (1.5 hrs)', mult: 1.0 },
      { text: 'Matemáticas Universitarias (Cálculo / Álgebra Lineal) - Sesión', mult: 1.25 },
      { text: 'Música (Guitarra, Bajo, Teclado o Percusión) - Sesión individual', mult: 1.0 },
      { text: 'Paquete Mensual (4 sesiones personalizadas - Mate o Música)', mult: 3.6 }
    ]
  }
};

function getSelectedServiceRadio() {
  return document.querySelector('input[name="service_type"]:checked') || { value: 'Servicio Técnico PC / Laptop', dataset: { baseCost: 70 } };
}

function updateServiceInputs() {
  const selectedRadio = getSelectedServiceRadio();
  const data = serviceOptionsMap[selectedRadio.value];
  if (data) {
    document.getElementById('scaleLabel').innerText = data.scaleLabel;
    const scaleSelect = document.getElementById('projectScale');
    scaleSelect.innerHTML = '';
    data.options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.text;
      el.text = opt.text;
      el.dataset.multiplier = opt.mult;
      scaleSelect.appendChild(el);
    });
  }
  calculateLiveQuote();
}

function calculateLiveQuote() {
  const selectedRadio = getSelectedServiceRadio();
  const serviceName = selectedRadio.value;
  const baseCost = parseFloat(selectedRadio.dataset.baseCost) || 70;

  const scaleSelect = document.getElementById('projectScale');
  const scaleOption = scaleSelect.options[scaleSelect.selectedIndex] || { text: 'Estándar', dataset: { multiplier: 1 } };
  const scaleMultiplier = parseFloat(scaleOption.dataset.multiplier) || 1;

  const urgencySelect = document.getElementById('urgencyLevel');
  const urgencyOption = urgencySelect.options[urgencySelect.selectedIndex];
  const urgencyMultiplier = parseFloat(urgencyOption.dataset.urgencyMult) || 1;

  const currency = document.getElementById('currencySelect').value;
  const name = document.getElementById('clientName').value.trim() || 'No especificado';
  const location = document.getElementById('clientLocation').value.trim() || 'Lima / Virtual';

  let total = baseCost * scaleMultiplier * urgencyMultiplier;
  let symbol = 'S/.';
  if (currency === 'USD') {
    total = total / 3.75;
    symbol = '$';
  }

  document.getElementById('priceDisplay').innerText = `${symbol} ${Math.round(total).toLocaleString()}.00`;

  const summary = `Hola Víctor (DC CORP), quisiera coordinar una cotización:\n\n• Área: ${serviceName}\n• Detalle: ${scaleOption.text}\n• Modalidad: ${urgencyOption.text}\n• Presupuesto aprox: ${symbol} ${Math.round(total).toLocaleString()}.00\n• Contacto: ${name}\n• Ubicación / Modalidad: ${location}\n\n¿Tienes disponibilidad para coordinar?`;
  document.getElementById('quotePreview').innerText = summary;
  return { summary };
}

function sendToWhatsApp() {
  const { summary } = calculateLiveQuote();
  window.open(`https://wa.me/51992507489?text=${encodeURIComponent(summary)}`, '_blank');
}

function submitContactForm() {
  const name = document.getElementById('formName').value.trim();
  const phone = document.getElementById('formPhone').value.trim();
  const service = document.getElementById('formServiceInterest').value;
  const msg = document.getElementById('formMessage').value.trim();
  const statusBox = document.getElementById('contactStatusBox');

  if (!name || !phone || !msg) {
    statusBox.className = 'p-3 rounded-xl text-xs font-medium bg-red-500/10 border border-red-500/25 text-red-700';
    statusBox.innerText = 'Por favor completa los campos requeridos (*)';
    statusBox.classList.remove('hidden');
    return;
  }

  const waText = `Hola Víctor (DC CORP),\nMi nombre es ${name} (Tel: ${phone}).\nÁrea de interés: ${service}\n\nDetalle:\n${msg}`;
  statusBox.className = 'p-3 rounded-xl text-xs font-medium bg-emerald-500/10 border border-emerald-500/25 text-emerald-700';
  statusBox.innerText = 'Abriendo chat de WhatsApp...';
  statusBox.classList.remove('hidden');

  setTimeout(() => {
    window.open(`https://wa.me/51992507489?text=${encodeURIComponent(waText)}`, '_blank');
  }, 350);
}

function initScrollReveal() {
  const els = document.querySelectorAll('.reveal-up');
  if (!('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(el => obs.observe(el));
}

document.addEventListener('DOMContentLoaded', () => {
  initThreeJS();
  updateServiceInputs();
  initScrollReveal();

  const btnSwitchMesh = document.getElementById('btnSwitchMesh');
  if (btnSwitchMesh) {
    btnSwitchMesh.addEventListener('click', () => {
      if (!wireframeIcosahedron) return;
      currentMeshMode = (currentMeshMode + 1) % 3;
      if (currentMeshMode === 0) wireframeIcosahedron.geometry = new THREE.IcosahedronGeometry(36, 1);
      else if (currentMeshMode === 1) wireframeIcosahedron.geometry = new THREE.TorusKnotGeometry(22, 6, 72, 12);
      else wireframeIcosahedron.geometry = new THREE.OctahedronGeometry(36, 2);
    });
  }

  const btnPulseNetwork = document.getElementById('btnPulseNetwork');
  if (btnPulseNetwork) {
    btnPulseNetwork.addEventListener('click', () => {
      if (!particleSystem) return;
      particleSystem.material.color.setHex(0x10b981);
      particleSystem.material.size = 2.6;
      setTimeout(() => {
        particleSystem.material.color.setHex(0x00e5ff);
        particleSystem.material.size = 1.5;
      }, 650);
    });
  }

  const btnResetCamera = document.getElementById('btnResetCamera');
  if (btnResetCamera) {
    btnResetCamera.addEventListener('click', () => {
      mouseX = 0;
      mouseY = 0;
      if (nodeGroup) {
        nodeGroup.rotation.set(0, 0, 0);
        nodeGroup.position.set(0, 0, 0);
      }
    });
  }

  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const menuIcon = document.getElementById('menuIcon');
  if (mobileMenuBtn && mobileMenu && menuIcon) {
    mobileMenuBtn.addEventListener('click', () => {
      const isHidden = mobileMenu.classList.contains('hidden');
      mobileMenu.classList.toggle('hidden', !isHidden);
      menuIcon.classList.toggle('fa-bars', !isHidden);
      menuIcon.classList.toggle('fa-xmark', isHidden);
    });
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        menuIcon.classList.add('fa-bars');
        menuIcon.classList.remove('fa-xmark');
      });
    });
  }
});
