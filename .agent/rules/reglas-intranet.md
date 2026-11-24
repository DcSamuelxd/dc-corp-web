# Reglas del Proyecto — Intranet DC CORP

En cada nueva tarea relacionada con la intranet (`intranet/`), debes cumplir estrictamente estas reglas:

1. **Consultar siempre `guia-estilo.md` antes de crear o modificar vistas**:
   - Revisa `/guia-estilo.md` en la raíz del proyecto para respetar la paleta de colores hex, tipografía, clases `.glass-bento` / `.apple-nav` / `.bottom-dock`, botones e inputs existentes.
2. **Modificar únicamente las líneas o secciones solicitadas sin reescribir archivos completos**:
   - Usa las anclas HTML (`<!-- HEADER -->`, `<!-- NAVEGACIÓN PRINCIPAL -->`, `<!-- CONTENIDO PRINCIPAL -->`, `<!-- MODALES -->`, `<!-- SCRIPTS -->`) para ubicar exactamente la sección afectada y aplicar cambios puntuales.
3. **Mantener HTML, CSS y JS estrictamente separados**:
   - Prohibido agregar etiquetas `<style>` o `<script>` inline dentro de los archivos `.html`.
   - Todo estilo nuevo debe ir en `intranet/public/css/styles.css` y toda lógica nueva en `intranet/public/js/` (`login.js`, `admin.js`, `student.js` o módulos dedicados en `intranet/public/js/`).
