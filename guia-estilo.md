# Guía de Estilo — Intranet DC CORP

Documentación oficial de diseño, tokens visuales, componentes y navegación de la intranet académica de **DC CORP** (`intranet/public/`).

---

## 1. Paleta de Colores

### Colores Base y Texto
| Token / Uso | Código Hex / RGBA | Notas |
|---|---|---|
| Fondo principal (`body`) | `#f5f5f7` | Gris claro estilo Apple (`theme-color`) |
| Texto principal | `#1d1d1f` | Títulos, encabezados y cuerpo principal |
| Texto secundario | `#6e6e73` | Subtítulos, etiquetas y metadatos |
| Texto medio | `#424245` | Labels de formularios e iconos sutiles |
| Bordes suaves | `rgba(0, 0, 0, 0.06)` – `rgba(0, 0, 0, 0.15)` | Divisores, bordes de inputs y contenedores |

### Color Primario y Acentos
| Uso | Hex | Hover / Fondo suave |
|---|---|---|
| Primario (DC CORP / Acciones principales) | `#0071e3` | Hover: `#0077ed` · Tint: `rgba(0, 113, 227, 0.10)` |
| Esmeralda (Presente / WhatsApp / Alumnado) | `#059669` / `#10b981` | Badge: `#d1fae5` / `#ecfdf5` · Borde: `#a7f3d0` · Texto: `#065f46` / `#047857` |
| Celeste / Sky (Recuperación / Justificado / Info) | `#0369a1` | Badge: `#e0f2fe` / `#f0f9ff` · Borde: `#bae6fd` · Texto: `#075985` |
| Índigo (Aulas y Materiales) | `#4f46e5` | Tint: `indigo-500/10` · Texto: `indigo-700` |
| Ámbar (Tardanza / Plana Docente) | `#d97706` | Badge: `#fef3c7` · Borde: `#fde68a` · Texto: `#92400e` |
| Púrpura (Reforzamiento) | `#7e22ce` | Badge: `#f3e8ff` / `#faf5ff` · Borde: `#e9d5ff` · Texto: `#6b21a8` |
| Rojo / Rosa (Falta / Avisos / Eliminar) | `#dc2626` / `#e11d48` | Badge: `#fee2e2` / `#fef2f2` · Borde: `#fecaca` · Texto: `#991b1b` |

### Gradientes Radiales de Fondo (`intranet/public/css/styles.css`)
- **Login (`body.page-login`)**: `rgba(0, 113, 227, 0.10)` arriba-izquierda y `rgba(124, 58, 237, 0.08)` abajo-derecha.
- **Admin (`body.page-admin`)**: `rgba(0, 113, 227, 0.08)` arriba-izquierda y `rgba(124, 58, 237, 0.07)` abajo-derecha.
- **Estudiante (`body.page-student`)**: `rgba(0, 113, 227, 0.08)` arriba-izquierda y `rgba(16, 185, 129, 0.07)` abajo-derecha.

---

## 2. Tipografía

- **Font Stack**: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif`
- **Escala habitual**:
  - Título principal de página: `text-xl` / `text-2xl` (`20px`–`24px`), `font-bold`, `tracking-tight`
  - Título de sección / modal: `text-lg` (`18px`) o `text-base` (`16px`), `font-bold`
  - Cuerpo y botones: `text-xs` (`12px`) o `text-sm` (`14px`), `font-medium` / `font-semibold`
  - Etiquetas, badges y metadatos: `text-[10px]` / `text-[11px]`
- **Regla móvil (`<= 640px`)**: `input, select, textarea { font-size: 16px !important; }` para evitar zoom automático en iOS/Android.

---

## 3. Componentes

### Tarjetas (`glass-bento` y `glass-card`)
- **`.glass-bento`** (paneles y modales): fondo `rgba(255, 255, 255, 0.80)`, `backdrop-filter: saturate(180%) blur(24px)`, borde `1px solid rgba(255, 255, 255, 0.92)`, sombra `0 10px 35px rgba(0, 0, 0, 0.045)`, `border-radius: 24px`.
- **`.glass-card`** (login): fondo `rgba(255, 255, 255, 0.85)`, `border-radius: 28px`, sombra `0 18px 45px rgba(0, 0, 0, 0.06)`.
- **Contenedores internos**: fondo `#f5f5f7`, `rounded-2xl`, `border border-black/[0.06]`.

### Botones
- **Primario pill**: `rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-semibold transition`
- **Secundario / Neutro**: `rounded-full bg-black/5 hover:bg-black/10 text-[#1d1d1f] text-xs font-medium`
- **Acción de módulo**: `rounded-full` o `rounded-xl` usando `bg-emerald-600`, `bg-indigo-600`, `bg-amber-600`, `bg-rose-600` con `text-white text-xs font-semibold`.
- **Peligro / Salir**: `bg-red-500/10 hover:bg-red-500/20 text-red-600`.

### Inputs y Modales
- **Inputs**: `bg-white` o `bg-[#f5f5f7]`, `border border-black/10`, `rounded-xl` (o `rounded-2xl` en login), `px-3.5 py-2.5 text-xs`.
- **Overlay de modales**: `fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto`.

---

## 4. Estructura de Navegación y Archivos

### Archivos de la Intranet
- **Vistas HTML (`intranet/public/`)**: `login.html`, `admin.html`, `student.html` (organizadas con anclas `<!-- HEADER -->`, `<!-- CONTENIDO PRINCIPAL -->`, `<!-- MODALES -->`, `<!-- SCRIPTS -->`).
- **Estilos externos**: `/intranet/css/styles.css` (`intranet/public/css/styles.css`).
- **Scripts externos**: `/intranet/js/login.js`, `/intranet/js/admin.js`, `/intranet/js/student.js`.

### Patrón de Navegación
1. **Header Sticky (`.apple-nav`)**: altura `h-16`, logo `/logo.svg`, badge de rol/estado en vivo, accesos de cuenta y botón Salir.
2. **Tabs Desktop (`hidden md:inline-flex` / `hidden md:flex`)**: contenedor `p-1.5 rounded-2xl bg-black/[0.05]`; pestaña activa con `bg-white text-[#1d1d1f] shadow-sm rounded-xl`.
3. **Dock Inferior Móvil (`.bottom-dock`, `md:hidden fixed bottom-0 inset-x-0 z-40`)**: grilla fija inferior (`grid-cols-5` en admin, `grid-cols-4` en estudiante) con soporte `env(safe-area-inset-bottom)`.
