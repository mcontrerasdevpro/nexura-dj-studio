// Interfaz de la biblioteca
import { el, fmtTime, camelotCompatible, debounce, uid, keyColor, CUE_COLORS, toast } from '../util.js';
import { btn, select } from './controls.js';
import { SMART_FIELDS, SMART_OPS, CRATE_SORTS } from '../library/library.js';
import { cratePath, pathLabel, effectiveColor } from '../library/crate-tree.js';
import { treeFiles } from '../library/folder-crates.js';
import { COLUMNS, COL_BY_KEY, DEFAULT_COLS, visibleColumns, columnTemplate, columnsFor } from '../library/columns.js';
import { ENERGY_MODES } from '../ai/assistant.js';

// Columnas: catálogo en library/columns.js. Las que se ven dependen de las elegidas por el usuario
// (clic derecho en la cabecera; settings.libCols o, por crate, settings.libColsByView) y de cuántas caben
// (--lib-max en el CSS de cada tamaño de pantalla). La plantilla resultante va en --lib-cols (en #library)
// con los anchos que el usuario ajusta arrastrando el borde de la cabecera (settings.libColW).
const GRID = 'var(--lib-cols)';
const SIDE_MIN = 140, SIDE_MAX = 520;
const ART_SIZES = { small: { row: 28, col: 30 }, medium: { row: 44, col: 46 } };
// 1 h 05 min / 42 min
const countLabel = (n, one = 'pista', many = 'pistas') => n === 1 ? '1 ' + one : `${n} ${many}`;
const fmtTotal = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
// minúsculas y sin acentos (buscador de la barra lateral)
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Iconos de trazo (24×24) de la barra lateral; un color fijo por tipo
const ICON = {
  lib: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  prep: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
  hist: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  crate: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  smart: 'M4 5h16l-6 7v6l-4 2v-8z',
  yt: 'M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M10 9l5 3-5 3z',
  sp: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M7.5 10c3-1 6.5-.7 9 .8 M8 13.2c2.4-.7 5-.4 7 .7 M8.6 16c1.8-.5 3.7-.3 5.3.5',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z M20 20l-4-4',
  plus: 'M12 5v14 M5 12h14',
  sort: 'M7 20V4 M3 8l4-4 4 4 M17 4v16 M13 16l4 4 4-4',
  import: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  open: 'M6 9l6 6 6-6',
  closed: 'M9 6l6 6-6 6',
  rail: 'M4 5h16v14H4z M9 5v14'
};
// Todas, Prepare e Historial en gris del tema; IA morado, crates ámbar, smart verde, YouTube rojo y Spotify verde
const ICON_COLOR = { lib: 'var(--ico-lib)', ai: '#c792ff', prep: 'var(--ico-prep)', hist: 'var(--ico-hist)', crate: '#f2b544', smart: '#3fd6a4', yt: '#ff5a5a', sp: '#3ddc84' };
function icon(name, size = 18, color = null, width = 2, cls = 'ico') {
  const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
  // un color var(--…) no vale como atributo de SVG: va en el estilo
  const cssVar = /^var\(/.test(color || '');
  for (const [k, v] of Object.entries({ class: cls, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: (!cssVar && color) || 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  if (cssVar) s.style.stroke = color;
  p.setAttribute('d', ICON[name] || '');
  s.appendChild(p);
  return s;
}
// Barra de iconos: las vistas (Todas, IA, Prepare) se abren; el resto salta a su sección del árbol
const RAIL = [
  { k: 'all', label: 'Todas', icon: 'lib', view: 'all', title: 'Todas las pistas' },
  { k: 'ai', label: 'IA', icon: 'ai', view: 'ai:next', title: 'Siguiente pista (IA)' },
  { k: 'prep', label: 'Prepare', icon: 'prep', view: 'prepare', title: 'Prepare' },
  { k: 'crates', label: 'Crates', icon: 'crate', sec: 'crates', title: 'Ir a los crates' },
  { k: 'smart', label: 'Smart', icon: 'smart', sec: 'smart', title: 'Ir a las smart crates' },
  { k: 'yt', label: 'YouTube', icon: 'yt', sec: 'online', at: '.side-item.yt', title: 'Ir a los vídeos y listas de YouTube' },
  { k: 'sp', label: 'Spotify', icon: 'sp', sec: 'online', at: '.side-item.spotify', title: 'Ir a las listas importadas de Spotify' },
  { k: 'hist', label: 'Historial', icon: 'hist', sec: 'library', at: '[data-node="history"]', title: 'Ir al historial' }
];

export class LibraryUI {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.lib = app.library;
    this.viewId = app.settings.libView || 'all';
    this.search = '';
    this.sort = app.settings.libSort || { field: null, dir: 1 };
    this.rows = [];
    this.sel = new Set();
    this.cursor = -1;
    this.anchor = -1;
    this.focus = 'table';
    this.cols = [];
    this.rowH = 28;
    this.missing = new Map();   // id → true (perdido) / false (existe); comprobado en esta sesión
    this.art = new Map();       // id → data: URL | null (sin carátula) | 'pending'
    this.checkMissingSoon = debounce(() => this.checkMissing(), 250);
    this.loadArtSoon = debounce(() => this.loadArt(), 120);
    this.build();
    this.lib.on('change', debounce(() => { this.renderSide(); this.refresh(); }, 60));
    this.lib.on('track', debounce(() => this.refresh(false), 120));
    app.on('settings', (k) => {
      if (k === 'protectLibrary') this.refreshLock();
      if (k === 'libColsSame' || k === 'libArtSize') this.relayout();
      if (k === 'libRail') this.updateRail();
    });
    // modo laptop (clase de body) → barra de iconos en «Automática»
    new MutationObserver(() => this.updateRail()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.renderSide();
    this.updateRail();
    this.relayout();
    requestAnimationFrame(() => this.revealActive());
  }

  build() {
    this.sideCur = this.viewId;   // fila con el foco del teclado en la barra lateral
    this.railSel = null;          // botón de la barra de iconos pulsado (hasta cambiar de vista)
    this.treeQ = '';
    this.side = el('nav', { class: 'lib-side', 'aria-label': 'Biblioteca' });
    this.treeIn = el('input', { class: 'side-search', type: 'search', placeholder: 'Buscar crates y listas…', 'aria-label': 'Buscar crates y listas' });
    this.treeIn.addEventListener('input', debounce(() => { this.treeQ = this.treeIn.value.trim(); this.renderSide(); }, 100));
    this.treeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (this.treeIn.value) { this.treeIn.value = ''; this.treeQ = ''; this.renderSide(); } else this.treeIn.blur(); }
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); const f = this.tree.querySelector('.side-item'); if (f) { this.setSideCur(f); f.focus(); } }
    });
    this.railBtn = el('button', { class: 'side-rail-btn', type: 'button' }, icon('rail', 16));
    this.railBtn.addEventListener('click', () => this.app.setSetting('libRail', this.railOn() ? 'off' : 'on'));
    this.tree = el('div', { class: 'lib-tree' });
    const addBtn = el('button', { class: 'side-btn', type: 'button', title: 'Añadir archivos o una carpeta de música (también puedes arrastrarlos a la biblioteca)' }, icon('plus', 14, null, 2.2), 'Añadir música');
    addBtn.addEventListener('click', () => this.menuAt(addBtn, [
      { label: 'Archivos…', fn: () => this.app.addFiles(false) },
      { label: 'Carpeta…', fn: () => this.app.addFiles(true) }
    ]));
    const impBtn = el('button', { class: 'side-btn', type: 'button', title: 'Importar biblioteca de otro programa DJ: BPM, beatgrid, tonalidad, hot cues, loops y listas (colección XML o NML)' }, icon('import', 14, null, 2.2), 'Importar…');
    impBtn.addEventListener('click', () => this.app.importLibrary());
    this.side.append(
      el('div', { class: 'side-head' }, el('label', { class: 'side-find' }, icon('search', 16), this.treeIn), this.railBtn),
      this.tree,
      el('div', { class: 'side-foot' }, addBtn, impBtn));
    this.side.addEventListener('focusin', () => { this.focus = 'side'; this.root.classList.add('side-focus'); });
    this.rail = el('nav', { class: 'lib-rail', 'aria-label': 'Secciones de la biblioteca' }, ...RAIL.map(r => {
      const b = el('button', { class: 'rail-btn', type: 'button', title: r.title, 'aria-pressed': 'false', dataset: { k: r.k } }, icon(r.icon, 22, ICON_COLOR[r.icon]), el('span', {}, r.label));
      b.addEventListener('click', () => this.railGo(r));
      return b;
    }));
    this.searchIn = el('input', { class: 'search', type: 'search', placeholder: 'Buscar (título, artista, BPM, tonalidad…) o pegar un enlace de YouTube o Spotify  ·  Ctrl+F' });
    this.searchIn.addEventListener('input', debounce(() => {
      const v = this.searchIn.value.trim();
      // Si se pega un enlace de YouTube en el buscador, se importa directamente
      if (/^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(v)) {
        this.searchIn.value = ''; this.search = '';
        this.app.ytImport(v);
        return;
      }
      // y uno de Spotify abre el diálogo de importación
      if (/^(https?:\/\/)?(open|play)\.spotify\.com\/|^spotify:(user:[^:]+:)?(playlist|album|track):/i.test(v)) {
        this.searchIn.value = ''; this.search = '';
        this.app.spotifyImportDialog(v);
        return;
      }
      this.search = this.searchIn.value; this.refresh();
    }, 120));
    this.searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.searchIn.value = ''; this.search = ''; this.refresh(); this.searchIn.blur(); } if (e.key === 'Enter') this.searchIn.blur(); });
    this.countEl = el('span', { class: 'count' });
    this.viewIco = el('span', { class: 'view-ico' });
    this.viewTitle = el('span', { class: 'view-title' });
    this.aiMode = select(ENERGY_MODES, this.app.ai.mode, (v) => { this.app.ai.setMode(v); this.refresh(); });
    this.aiMode.classList.add('ai-mode');
    this.aiMode.title = 'Qué buscar respecto a la pista que suena';
    // ☰: pliega el árbol y deja solo la barra de iconos (en ≤ 760 px, al revés: muestra el árbol)
    this.sideToggle = btn('☰', { cls: 'small lib-side-toggle', title: 'Mostrar u ocultar el árbol de la biblioteca', onClick: () => { this.root.classList.toggle('tree-toggled'); this.placeSideRs(); } });
    this.sideToggle.setAttribute('aria-label', 'Mostrar u ocultar el árbol de la biblioteca');
    this.lockBtn = btn('🔓', { cls: 'small lib-lock', onClick: () => this.app.setSetting('protectLibrary', !this.app.settings.protectLibrary) });
    const toolbar = el('div', { class: 'lib-toolbar' },
      this.sideToggle,
      el('span', { class: 'view-head' }, this.viewIco, this.viewTitle), this.countEl, this.aiMode, this.searchIn, this.lockBtn,
      btn('✨ Pedir set', { cls: 'small ai-btn', title: 'Describe un set con tus palabras y la IA lo crea con tu música', onClick: () => this.app.aiPromptDialog() }),
      btn('Analizar', { cls: 'small', onClick: () => this.app.analyzeMany(this.rows.filter(t => t.source === 'local' && (!t.analyzed || t.sections === undefined))), title: 'Analiza BPM, tonalidad, forma de onda, estructura y energía de las pistas visibles que lo necesiten (respeta tus BPM corregidos)' }));
    this.head = el('div', { class: 'lib-head', style: { gridTemplateColumns: GRID }, title: 'Clic: ordenar · clic derecho: elegir columnas' });
    this.head.addEventListener('contextmenu', (e) => { e.preventDefault(); this.columnsMenu(e); });
    this.scroller = el('div', { class: 'lib-scroll', tabindex: 0 });
    this.spacer = el('div', { class: 'lib-spacer' });
    this.rowsEl = el('div', { class: 'lib-rows' });
    this.scroller.append(this.spacer, this.rowsEl);
    this.scroller.addEventListener('scroll', () => this.renderRows());
    this.scroller.addEventListener('focus', () => { this.focus = 'table'; this.root.classList.remove('side-focus'); });
    this.empty = el('div', { class: 'lib-empty' });
    const main = el('div', { class: 'lib-main' }, toolbar, this.head, this.scroller, this.empty);
    // tirador para el ancho de la barra lateral
    this.sideRs = el('div', { class: 'lib-side-rs', title: 'Arrastra para cambiar el ancho · doble clic: ancho por defecto' });
    this.root.append(this.rail, this.side, main, this.sideRs);
    this.bindSideResizer();
    // al cambiar de tamaño de pantalla cambia cuántas columnas caben (--lib-max) y si se ve la barra de iconos
    window.addEventListener('resize', () => { this.updateRail(); if (this.colMax() !== this._max) this.relayout(); else this.applyColWidths(); this.placeSideRs(); });
    // soltar archivos del sistema (las listas .m3u/.m3u8 se importan como crate)
    main.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); main.classList.add('drop'); } });
    main.addEventListener('dragleave', () => main.classList.remove('drop'));
    // en una crate abierta, las carpetas soltadas se convierten en sus subcrates; en otra vista, solo se añaden
    main.addEventListener('drop', (e) => { main.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); this.dropData(e.dataTransfer, { target: this.viewId.startsWith('crate:') ? this.viewId.slice(6) : undefined }); } });
    new ResizeObserver(() => this.renderRows()).observe(this.scroller);
    new ResizeObserver(() => this.placeSideRs()).observe(this.side);
  }

  // ------------------------------------------------------------ barra lateral
  // Fila del árbol: botón con triángulo (o hueco), icono del tipo, nombre y contador. «id» = vista que abre;
  // sin id (opts.node) es un nodo que solo se pliega (Historial)
  sideItem(id, label, count, opts = {}) {
    const on = !!id && id === this.viewId;
    const it = el('button', { type: 'button', tabindex: -1, class: 'side-item' + (on ? ' on' : '') + (opts.depth ? ' sub' : '') + (opts.cls ? ' ' + opts.cls : ''), dataset: id ? { view: id } : { node: opts.node }, title: opts.title || null, 'aria-current': on ? 'true' : null },
      opts.twisty || el('span', { class: 'si-tw' }),
      icon(opts.icon, 18, opts.color || ICON_COLOR[opts.icon], 2, 'si-ico'), el('span', { class: 'si-label' }, label), count != null ? el('span', { class: 'si-count' }, String(count)) : null);
    it.style.setProperty('--depth', opts.depth || 0);
    if (opts.expanded != null) it.setAttribute('aria-expanded', String(opts.expanded));
    it.addEventListener('click', () => { this.setSideCur(it); if (opts.onClick) opts.onClick(); else this.setView(id); });
    if (opts.menu) it.addEventListener('contextmenu', (e) => { e.preventDefault(); this.app.contextMenu(e, typeof opts.menu === 'function' ? opts.menu() : opts.menu); });
    // crates: arrastrar una crate sobre otra la convierte en su subcrate; con el orden personalizado,
    // soltarla en el borde superior/inferior la coloca delante/detrás en ese nivel
    if (opts.crateId) {
      it.draggable = true;
      it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/nexura-crate', opts.crateId); e.dataTransfer.effectAllowed = 'move'; });
    }
    const zone = (e) => {
      if (this.app.settings.crateSort !== 'custom') return 'into';
      const r = it.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    };
    const clear = () => it.classList.remove('drop', 'drop-before', 'drop-after');
    if (opts.drop || opts.crateId) {
      const ok = (e) => (opts.drop && (e.dataTransfer.types.includes('text/nexura-track') || e.dataTransfer.types.includes('Files'))) || (opts.crateId && e.dataTransfer.types.includes('text/nexura-crate'));
      it.addEventListener('dragover', (e) => {
        if (!ok(e)) return;
        e.preventDefault(); clear();
        const z = opts.crateId && e.dataTransfer.types.includes('text/nexura-crate') ? zone(e) : 'into';
        it.classList.add(z === 'into' ? 'drop' : 'drop-' + z);
      });
      it.addEventListener('dragleave', clear);
      it.addEventListener('drop', async (e) => {
        e.preventDefault(); clear();
        const crate = e.dataTransfer.getData('text/nexura-crate');
        if (crate && opts.crateId) return this.dropCrate(crate, opts.crateId, zone(e));
        if (!opts.drop) return;
        const ids = e.dataTransfer.getData('text/nexura-track');
        if (ids) opts.drop(ids.split(','));
        else if (e.dataTransfer.files.length && opts.crateId) await this.dropData(e.dataTransfer, { target: opts.crateId, listParent: opts.crateId });
        else if (e.dataTransfer.files.length) { const added = await this.dropData(e.dataTransfer); if (added.length) opts.drop(added.map(t => t.id)); }
      });
    }
    return it;
  }
  // Grupo del árbol: cabecera (título y como mucho un botón) y sus filas
  group(sec, title, action, rows, head = null) {
    const h = head || el('div', { class: 'side-sec' });
    h.append(el('span', { class: 'sec-title' }, title), action || '');
    return el('div', { class: 'side-group', dataset: { sec } }, h, ...rows);
  }
  secBtn(label, aria, fn) {
    const b = el('button', { class: 'sec-btn', type: 'button', 'aria-label': aria, title: aria }, icon('plus', 12, null, 2.4), label);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
    return b;
  }
  // Menú bajo un botón (los menús contextuales se colocan en la posición del ratón)
  menuAt(b, items) { const r = b.getBoundingClientRect(); this.app.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, items); }
  importMenu(b) {
    this.menuAt(b, [
      { label: 'Lista de YouTube…', fn: () => this.app.ytImportDialog() },
      { label: 'Mis listas de YouTube…', fn: () => this.app.ytMyPlaylists() },
      { label: 'Buscar en YouTube…', fn: () => this.app.ytSearchDialog() },
      { label: 'Lista de Spotify…', fn: () => this.app.spotifyImportDialog() },
      { label: 'Archivo M3U…', fn: () => this.app.importM3u() }
    ]);
  }

  // Soltar una crate: dentro de otra (subcrate) o delante/detrás de ella en su nivel
  dropCrate(id, target, z) {
    const L = this.lib;
    if (id === target) return;
    if (z === 'into') {
      if (L.subcrateIds(id).includes(target)) return this.app.toast('No se puede meter una crate dentro de uno de sus subcrates', 'warn');
      if (L.setCrateParent(id, target)) this.expandCrate(target);
    } else if (!L.moveCrate(id, target, z === 'after') && !L.protected) this.app.toast('No se puede meter una crate dentro de uno de sus subcrates', 'warn');
  }

  // Archivos y carpetas soltados: las listas .m3u/.m3u8 se importan como crate (dentro de «listParent» si
  // se sueltan sobre una crate de la barra lateral); el audio, según «target» (ver app.importTree):
  // undefined = solo a la biblioteca, null = carpetas como crates en la raíz, id = archivos sueltos a esa
  // crate y cada carpeta como subcrate suyo con su estructura. Devuelve las pistas añadidas.
  async dropData(dt, { target, listParent = null } = {}) {
    const files = [...dt.files];
    const treeP = this.app.platform.treeFromDrop(dt);   // antes de cualquier await (el evento caduca)
    const lists = files.filter(f => /\.m3u8?$/i.test(f.name));
    if (lists.length) await this.app.importPlaylists(await Promise.all(lists.map(f => this.app.platform.playlistFromFile(f))), listParent);
    const tree = await treeP;
    if (lists.length && !treeFiles(tree).length) return [];
    return this.app.importTree(tree, target);
  }

  // --- árbol de crates (subcrates)
  collapsedCrates() { return new Set(this.app.settings.crateCollapsed || []); }
  setCrateOpen(id, open) {
    const s = this.collapsedCrates();
    if (open === !s.has(id)) return;
    if (open) s.delete(id); else s.add(id);
    this.app.setSetting('crateCollapsed', [...s].filter(x => this.lib.crate(x)));
    this.renderSide();
  }
  // despliega los antepasados de «id» (y la propia) para que se vea
  expandCrate(id) {
    const s = this.collapsedCrates(), path = cratePath(this.lib.crates, id);
    if (!path.some(c => s.has(c.id))) return;
    for (const c of path) s.delete(c.id);
    this.app.setSetting('crateCollapsed', [...s]);
    this.renderSide();
  }
  crateLabel(c) { return c ? pathLabel(this.lib.crates, c.id) : ''; }
  // Lista de crates para submenús («Añadir a crate», «Mover a…»), sangrada según la profundidad
  crateChoices(fn, filter = null) {
    return this.lib.crateTree(this.app.settings.crateSort, null, true).filter(x => !filter || filter(x.c)).map(({ c, depth }) => ({
      label: ' '.repeat(depth) + (depth ? '└ ' : '') + c.name, color: effectiveColor(this.lib.crates, c.id).color, fn: () => fn(c)
    }));
  }
  async newCrate(parent = null) {
    const L = this.lib;
    if (!L.guard('crate')) return null;
    const n = await this.app.prompt(parent ? `Nuevo subcrate en «${this.crateLabel(L.crate(parent))}»` : 'Nombre de la crate', '');
    const c = n && L.createCrate(n, parent);
    if (c) { if (parent) this.expandCrate(parent); this.setView('crate:' + c.id); }
    return c;
  }
  async deleteCrateAsk(c) {
    const L = this.lib;
    if (!L.guard('crate')) return;
    const subs = L.subcrateIds(c.id);
    let mode = 'all';
    if (subs.length) {
      const r = await this.app.modal('Eliminar crate', el('p', {}, `«${this.crateLabel(c)}» tiene ${subs.length} subcrate(s). ¿Qué hago con ellos? Las pistas siguen en la biblioteca.`), ['Cancelar', 'Borrar también los subcrates', 'Subirlos un nivel']);
      if (r < 1) return;
      mode = r === 1 ? 'all' : 'lift';   // el botón principal (Intro) es el que no borra nada más
    } else if (!await this.app.confirm(`¿Eliminar la crate «${this.crateLabel(c)}»? Las pistas siguen en la biblioteca.`)) return;
    const removed = L.deleteCrate(c.id, mode);
    if (removed && removed.some(id => this.viewId === 'crate:' + id)) this.setView('all');
  }

  crateMenu(c) {
    const L = this.lib, parent = L.crate(c.parent);
    const banned = new Set([c.id, ...L.subcrateIds(c.id)]);
    return [
      { label: 'Nuevo subcrate…', fn: () => this.newCrate(c.id) },
      { label: 'Renombrar…', fn: async () => { if (!L.guard('crate')) return; const n = await this.app.prompt('Nombre de la crate', c.name); if (n) L.renameCrate(c.id, n); } },
      { label: 'Color', sub: [...CUE_COLORS.map(col => ({ label: '●', color: col, fn: () => L.setCrateColor(c.id, col) })), { label: parent ? 'Sin color (el de la crate padre)' : 'Sin color', fn: () => L.setCrateColor(c.id, null) }] },
      { label: 'Mover a…', sub: [
        { label: (parent ? '' : '✓ ') + 'Raíz (CRATES)', fn: () => L.setCrateParent(c.id, null) },
        ...this.crateChoices((p) => { if (L.setCrateParent(c.id, p.id)) this.expandCrate(p.id); }, (x) => !banned.has(x.id) && x.id !== c.parent)
      ] },
      { label: '⇩ Importar M3U aquí (como subcrate)…', fn: () => this.app.importM3u(c.id) },
      ...(c.spotify ? [
        { label: 'Revisar importación de Spotify…', fn: () => this.app.spotifyCrate(c.id, false) },
        { label: 'Actualizar desde Spotify', fn: () => this.app.spotifyCrate(c.id, true) }
      ] : []),
      { label: 'Ordenar crates', sub: this.sortMenu() },
      ...(this.app.stems.available ? [{ label: '🎚 Separar stems de la crate (segundo plano)', fn: () => { const n = this.app.stems.enqueue(L.crateTrackIds(c.id).map(id => L.get(id))); this.app.toast(n ? `${n} pista(s) en cola de stems` : 'Todas las pistas de la crate ya tienen stems', n ? 'ok' : 'info'); } }] : []),
      { label: 'Eliminar crate', danger: true, fn: () => this.deleteCrateAsk(c) }
    ];
  }
  setCrateSort(k) { this.app.setSetting('crateSort', k); this.renderSide(); }
  // «N pistas · duración»: con el ajuste de subcrates incluye las de sus descendientes (sin duplicar)
  crateInfo(c) {
    const ts = this.lib.crateTrackIds(c.id).map(i => this.lib.get(i)).filter(Boolean);
    return `${ts.length} pistas · ${fmtTotal(ts.reduce((s, t) => s + (t.duration || 0), 0))}`;
  }
  // Spotify: las listas importadas (crate en la raíz sin subcrates) van en LISTAS ONLINE, no en el árbol
  isOnlineCrate(c) { return !!(c && c.spotify && !this.lib.crate(c.parent) && !this.lib.subcrateIds(c.id).length); }
  crateItem({ c, depth, hasKids, open }) {
    const L = this.lib, sp = this.isOnlineCrate(c);
    const { color, inherited } = effectiveColor(L.crates, c.id);
    const twisty = el('span', { class: 'si-tw', title: hasKids ? (open ? 'Plegar' : 'Desplegar') : null }, hasKids ? icon(open ? 'open' : 'closed', 14, null, 2.4) : null);
    if (hasKids) twisty.addEventListener('click', (e) => { e.stopPropagation(); this.setCrateOpen(c.id, !open); });
    const it = this.sideItem('crate:' + c.id, c.name, L.crateTrackIds(c.id).length, {
      icon: sp || (c.spotify && !color) ? 'sp' : 'crate', color: sp ? null : color, depth, twisty, crateId: c.id, expanded: hasKids ? open : null,
      cls: 'crate' + (sp ? ' spotify' : '') + (inherited ? ' inherit' : ''),
      title: (depth ? this.crateLabel(c) + '\n' : '') + this.crateInfo(c), drop: (ids) => L.addToCrate(c.id, ids),
      menu: () => this.crateMenu(c)
    });
    if (hasKids) it.dataset.kids = open ? 'open' : 'closed';
    return it;
  }
  // Árbol de crates; con el buscador, las que coinciden y sus antepasados (desplegados)
  crateSideItems(hit) {
    const L = this.lib, sort = this.app.settings.crateSort;
    if (!this.treeQ) return L.crateTree(sort, this.collapsedCrates()).filter(x => !this.isOnlineCrate(x.c)).map(x => this.crateItem(x));
    const show = new Set();
    for (const c of L.crates) if (!this.isOnlineCrate(c) && hit(c.name)) for (const p of cratePath(L.crates, c.id)) show.add(p.id);
    const all = L.crateTree(sort, null).filter(x => show.has(x.c.id));
    return all.map(x => { const kids = all.some(y => y.c.parent === x.c.id); return this.crateItem({ ...x, hasKids: kids, open: kids }); });
  }
  sortMenu() { return Object.entries(CRATE_SORTS).map(([k, v]) => ({ label: (this.app.settings.crateSort === k ? '✓ ' : ' ') + v, fn: () => this.setCrateSort(k) })); }
  // Botón ⇅ de la cabecera CRATES: abre el mismo menú de orden (el tooltip dice el orden actual)
  sortBtn() {
    const cur = CRATE_SORTS[this.app.settings.crateSort] || CRATE_SORTS.custom;
    const b = el('button', { class: 'sec-btn sec-ico', type: 'button', 'aria-label': 'Ordenar crates', title: `Ordenar crates · ahora: ${cur}` }, icon('sort', 14, null, 2.2));
    b.addEventListener('click', (e) => { e.stopPropagation(); this.menuAt(b, this.sortMenu()); });
    return b;
  }
  // Cabecera «CRATES»: soltar aquí una crate la devuelve a la raíz; soltar carpetas crea crates en la raíz.
  // Clic derecho: orden de las crates, nueva crate e importar M3U
  cratesHead() {
    const sec = el('div', { class: 'side-sec', title: 'Suelta aquí una crate para devolverla a la raíz, o carpetas de música para crear crates con su estructura · clic derecho: ordenar crates' });
    sec.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/nexura-crate') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); sec.classList.add('drop'); } });
    sec.addEventListener('dragleave', () => sec.classList.remove('drop'));
    sec.addEventListener('drop', (e) => {
      sec.classList.remove('drop');
      const id = e.dataTransfer.getData('text/nexura-crate');
      if (id) { e.preventDefault(); this.lib.setCrateParent(id, null); }
      else if (e.dataTransfer.files.length) { e.preventDefault(); this.dropData(e.dataTransfer, { target: null }); }
    });
    sec.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.app.contextMenu(e, [
        { label: 'Ordenar crates', sub: this.sortMenu() },
        { label: 'Nueva crate…', fn: () => this.newCrate(null) },
        { label: '⇩ Importar lista M3U como crate…', fn: () => this.app.importM3u() }
      ]);
    });
    return sec;
  }
  // «Reiniciar pistas tocadas» (de la sesión mostrada o de todas): menú del nodo Historial
  resetPlayedItems() {
    const L = this.lib, h = this.viewId.startsWith('history:') ? this.viewId.slice(8) : null;
    const all = { label: 'Reiniciar pistas tocadas (todas las sesiones)', fn: () => { L.resetPlayed(); this.app.toast('Marcas de pistas tocadas reiniciadas', 'ok'); } };
    return h ? [{ label: 'Reiniciar las de la sesión mostrada', fn: () => { L.resetPlayed(h); this.app.toast('Marcas de la sesión reiniciadas', 'ok'); } }, all] : [all];
  }
  setHistOpen(open) { this.app.setSetting('libHistOpen', !!open); this.renderSide(); }
  sessionLabel(h) { return new Date(h.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  renderSide() {
    const L = this.lib, t = this.tree, top = t.scrollTop, hadFocus = t.contains(document.activeElement);
    const q = fold(this.treeQ), hit = (s) => !q || fold(s).includes(q);
    let local = 0, yt = 0;
    for (const x of L.tracks.values()) { if (x.source === 'local') local++; else if (x.source === 'youtube') yt++; }
    // la vista abierta ya no existe (lista de YouTube borrada o ningún vídeo): a YouTube o a «Todas las pistas»
    const gone = this.viewId === 'yt-all' ? !yt : this.viewId.startsWith('yt:') && !L.ytPlaylists.some(p => 'yt:' + p.id === this.viewId);
    if (gone) this.setView(yt ? 'yt-all' : 'all');
    const libMenu = [
      { label: 'Relocalizar archivos perdidos…', fn: () => this.app.relocateMissing() },
      { label: 'Comprobar archivos perdidos', fn: () => this.checkAllMissing() }
    ];
    // BIBLIOTECA: vistas fijas e Historial (plegable, con sus sesiones)
    const lib = [];
    if (hit('Todas las pistas')) lib.push(this.sideItem('all', 'Todas las pistas', local, { icon: 'lib', menu: libMenu }));
    if (hit('Siguiente pista (IA)')) lib.push(this.sideItem('ai:next', 'Siguiente pista (IA)', null, { icon: 'ai', cls: 'ai' }));
    if (hit('Prepare')) lib.push(this.sideItem('prepare', 'Prepare', L.prepare.length, { icon: 'prep', drop: (ids) => L.addToPrepare(ids), menu: [{ label: 'Vaciar Prepare', fn: () => L.removeFromPrepare([...L.prepare]) }] }));
    const sessions = L.history.slice().reverse().slice(0, 30);
    const shown = q && !hit('Historial') ? sessions.filter(h => hit(this.sessionLabel(h))) : sessions;
    if (shown.length || hit('Historial')) {
      const open = !!this.app.settings.libHistOpen || (!!q && shown.length > 0 && !hit('Historial'));
      const twisty = el('span', { class: 'si-tw' }, sessions.length ? icon(open ? 'open' : 'closed', 14, null, 2.4) : null);
      lib.push(this.sideItem(null, 'Historial', sessions.length, { node: 'history', icon: 'hist', cls: 'hist-node', twisty, expanded: sessions.length ? open : null, title: 'Sesiones anteriores · clic derecho: reiniciar pistas tocadas', onClick: () => this.setHistOpen(!this.app.settings.libHistOpen), menu: () => this.resetPlayedItems() }));
      if (open) lib.push(...shown.map(h => this.sideItem('history:' + h.id, this.sessionLabel(h), h.entries.length, {
        icon: 'hist', depth: 1,
        menu: [
          { label: 'Reiniciar pistas tocadas de esta sesión', fn: () => { L.resetPlayed(h.id); this.app.toast('Marcas de la sesión reiniciadas', 'ok'); } },
          { label: 'Exportar CSV', fn: () => this.app.exportHistory(h.id) }
        ]
      })));
    }
    const crates = this.crateSideItems(hit);
    const smart = L.smart.filter(sc => hit(sc.name)).map(sc => this.sideItem('smart:' + sc.id, sc.name, L.view('smart:' + sc.id).length, {
      icon: 'smart',
      menu: [
        { label: 'Editar reglas…', fn: () => this.smartEditor(sc) },
        { label: 'Eliminar', fn: () => { if (L.deleteSmart(sc.id) && this.viewId === 'smart:' + sc.id) this.setView('all'); } }
      ]
    }));
    // LISTAS ONLINE: YouTube (todos los vídeos y listas importadas) y listas importadas de Spotify
    const online = [];
    // sin vídeos de YouTube no se muestra la vista agregada
    if (yt && hit('YouTube · todos los vídeos')) online.push(this.sideItem('yt-all', 'YouTube · todos los vídeos', yt, { icon: 'yt', cls: 'yt', title: 'Todos los vídeos de YouTube de la biblioteca · clic derecho: quitarlos', menu: () => this.ytAllMenu() }));
    online.push(...L.ytPlaylists.filter(p => hit(p.title)).map(p => this.sideItem('yt:' + p.id, p.title, p.ids.length, {
      icon: 'yt', cls: 'yt', title: 'Lista de YouTube', menu: () => this.ytListMenu(p)
    })));
    online.push(...this.lib.sortedCrates(this.app.settings.crateSort).filter(c => this.isOnlineCrate(c) && hit(c.name)).map(c => this.crateItem({ c, depth: 0, hasKids: false, open: false })));
    const groups = [
      this.group('library', 'BIBLIOTECA', null, lib),
      this.group('crates', 'CRATES', el('span', { class: 'sec-btns' }, this.secBtn('Nuevo', 'Nuevo crate (para un subcrate: clic derecho en la crate → «Nuevo subcrate…» o arrastra una crate sobre otra)', () => this.newCrate(null)), this.sortBtn()), crates, this.cratesHead()),
      this.group('smart', 'SMART CRATES', this.secBtn('Nuevo', 'Nuevo smart crate', () => this.smartEditor()), smart),
      this.group('online', 'LISTAS ONLINE', this.secBtn('Importar', 'Importar lista de YouTube, Spotify o M3U', (b) => this.importMenu(b)), online)
    ];
    // con el buscador se ocultan las secciones sin coincidencias
    t.replaceChildren(...(q ? groups.filter(g => g.querySelector('.side-item')) : groups));
    if (q && !t.firstChild) t.append(el('p', { class: 'side-none' }, `Nada coincide con «${this.treeQ}»`));
    t.scrollTop = top;
    this.sideItems = [...t.querySelectorAll('.side-item')];
    this.setSideCur(this.sideCur);
    // el foco del teclado sigue en la misma fila tras redibujar (plegar, contadores…)
    if (hadFocus && !t.contains(document.activeElement)) this.curItem()?.focus({ preventScroll: true });
  }

  // --- foco del teclado en el árbol (una sola fila con tabindex=0)
  keyOf(it) { return it.dataset.view || 'node:' + it.dataset.node; }
  itemFor(key) {
    if (!key) return null;
    return this.tree.querySelector(key.startsWith('node:') ? `.side-item[data-node="${key.slice(5)}"]` : `.side-item[data-view="${CSS.escape(key)}"]`);
  }
  curItem() { return this.itemFor(this.sideCur) || this.tree.querySelector('.side-item.on') || this.tree.querySelector('.side-item'); }
  setSideCur(x) {
    if (x) this.sideCur = typeof x === 'string' ? x : this.keyOf(x);
    const cur = this.curItem();
    for (const it of this.sideItems || []) { it.tabIndex = it === cur ? 0 : -1; it.classList.toggle('cur', it === cur); }
  }
  // desplaza el árbol (solo el árbol) para que se vea la vista abierta
  revealActive() {
    const it = this.tree.querySelector('.side-item.on'), t = this.tree;
    if (it && (it.offsetTop < t.scrollTop || it.offsetTop + it.offsetHeight > t.scrollTop + t.clientHeight)) t.scrollTop = it.offsetTop - (t.clientHeight - it.offsetHeight) / 2;
  }
  focusSideKey(key) { this.setSideCur(key); if (this.focus === 'side') this.curItem()?.focus({ preventScroll: true }); }

  // --- barra de iconos
  // Automática: en modo laptop o con la ventana de 1100 px o menos; Siempre / Nunca (Ajustes → Biblioteca)
  railOn() {
    const m = this.app.settings.libRail || 'auto';
    return m === 'on' || (m === 'auto' && (document.body.classList.contains('laptop-mode') || window.innerWidth <= 1100));
  }
  updateRail() {
    const on = this.railOn();
    if (on !== this.root.classList.contains('rail-on')) { this.root.classList.toggle('rail-on', on); this.root.classList.remove('tree-toggled'); }
    this.railBtn.classList.toggle('on', on);
    this.railBtn.setAttribute('aria-pressed', String(on));
    const lbl = on ? 'Ocultar la barra de iconos' : 'Mostrar la barra de iconos';
    this.railBtn.setAttribute('aria-label', lbl); this.railBtn.title = lbl;
    this.updateRailSel();
    this.placeSideRs();
  }
  railKey(id = this.viewId) {
    const [k, v] = id.split(':');
    if (id === 'all' || id === 'everything') return 'all';
    if (id === 'ai:next') return 'ai';
    if (id === 'prepare') return 'prep';
    if (k === 'crate') return this.isOnlineCrate(this.lib.crate(v)) ? 'sp' : 'crates';
    if (k === 'smart') return 'smart';
    if (k === 'yt' || id === 'yt-all') return 'yt';
    if (k === 'history') return 'hist';
    return null;
  }
  updateRailSel() {
    const k = this.railSel || this.railKey();
    for (const b of this.rail.children) { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  railGo(r) {
    if (r.view) this.setView(r.view);
    this.railSel = r.k;
    // con el árbol plegado (☰) se vuelve a mostrar para ver la sección
    if (!this.side.offsetWidth) { this.root.classList.toggle('tree-toggled'); this.placeSideRs(); }
    if (this.treeQ && !this.tree.querySelector(`.side-group[data-sec="${r.sec || 'library'}"]`)) { this.treeIn.value = ''; this.treeQ = ''; this.renderSide(); }
    if (r.k === 'hist' && !this.app.settings.libHistOpen && this.lib.history.length) this.setHistOpen(true);
    this.updateRailSel();
    const g = this.tree.querySelector(`.side-group[data-sec="${r.sec || 'library'}"]`);
    if (!g) return;
    const at = (r.at && this.tree.querySelector(r.at)) || (r.view && this.itemFor(r.view));
    this.tree.scrollTop = Math.max(0, (at || g).offsetTop - (at ? 34 : 2));
    for (const x of this.tree.querySelectorAll('.side-group.flash')) x.classList.remove('flash');
    void g.offsetWidth; g.classList.add('flash');
    clearTimeout(this._flashT); this._flashT = setTimeout(() => g.classList.remove('flash'), 1600);
    if (at) this.setSideCur(at);
  }

  setView(id) {
    this.viewId = id;
    this.sideCur = id;
    this.railSel = null;
    this.app.setSetting('libView', id);
    this.sel.clear(); this.cursor = -1;
    for (const it of this.tree.querySelectorAll('.side-item')) {
      const on = it.dataset.view === id;
      it.classList.toggle('on', on);
      if (on) it.setAttribute('aria-current', 'true'); else it.removeAttribute('aria-current');
    }
    this.setSideCur(id);
    this.updateRailSel();
    this.revealActive();
    // con columnas por crate, cada vista tiene las suyas
    if (this.app.settings.libColsSame === false) this.relayout(); else this.refresh();
    this.scroller.scrollTop = 0;
  }

  viewName() {
    const id = this.viewId, L = this.lib;
    if (id === 'all') return 'Todas las pistas';
    if (id === 'prepare') return 'Prepare';
    if (id === 'ai:next') return 'Siguiente pista (IA)';
    if (id === 'yt-all') return 'YouTube';
    const [k, v] = id.split(':');
    if (k === 'crate') return this.crateLabel(L.crate(v)) || 'Crate';
    if (k === 'smart') return (L.smart.find(c => c.id === v) || {}).name || 'Smart crate';
    if (k === 'yt') return (L.ytPlaylists.find(c => c.id === v) || {}).title || 'Lista';
    if (k === 'history') { const h = L.history.find(x => x.id === v); return h ? 'Historial › ' + this.sessionLabel(h) : 'Historial'; }
    return '';
  }
  // Icono y color de la vista (cabecera de la tabla)
  viewIcon() {
    const id = this.viewId, [k, v] = id.split(':');
    if (k === 'crate') {
      const c = this.lib.crate(v);
      if (this.isOnlineCrate(c)) return { icon: 'sp', color: ICON_COLOR.sp };
      return { icon: 'crate', color: (c && effectiveColor(this.lib.crates, c.id).color) || ICON_COLOR.crate };
    }
    const n = { all: 'lib', everything: 'lib', 'ai:next': 'ai', prepare: 'prep', 'yt-all': 'yt' }[id] || { smart: 'smart', yt: 'yt', history: 'hist' }[k] || 'lib';
    return { icon: n, color: ICON_COLOR[n] };
  }

  // ------------------------------------------------------------ tabla
  refresh(resetScroll = false) {
    const keepId = this.cursor >= 0 && this.rows[this.cursor] ? this.rows[this.cursor].id : null;
    const isAi = this.viewId === 'ai:next';
    this.root.classList.toggle('ai-view', isAi);
    if (isAi) {
      const q = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      this.rows = this.app.ai.suggest(80).filter(t => !q.length || q.every(tok => `${t.title} ${t.artist} ${t.genre} ${t.camelot} ${t.bpm ? Math.round(t.bpm) : ''}`.toLowerCase().includes(tok)));
    } else this.rows = this.lib.query(this.viewId, this.search, this.viewId.startsWith('history:') && !this.sort.field ? null : this.sort);
    if (keepId) this.cursor = this.rows.findIndex(r => r.id === keepId);
    // tras quitar pistas con Supr queda seleccionada la que ocupa ahora su lugar
    if (this.pendingSel != null) {
      const i = Math.min(this.pendingSel, this.rows.length - 1);
      this.pendingSel = null; this.sel.clear();
      if (i >= 0) this.sel.add(this.rows[i].id);
      this.cursor = this.anchor = i;
    }
    // información de la vista: número de pistas y duración total
    const total = this.rows.reduce((s, t) => s + (t.duration || 0), 0);
    this.countEl.textContent = `${this.rows.length} pistas${total ? ' · ' + fmtTotal(total) : ''}`;
    const name = this.viewName(), vi = this.viewIcon();
    this.viewTitle.textContent = name;
    this.viewIco.replaceChildren(icon(vi.icon, 18, vi.color));
    this.searchIn.placeholder = this.viewId === 'all' || this.viewId === 'everything'
      ? 'Buscar (título, artista, BPM, tonalidad…) o pegar un enlace de YouTube o Spotify  ·  Ctrl+F'
      : `Buscar en «${name}» (título, artista, BPM, tonalidad…)  ·  Ctrl+F`;
    this.refreshLock();
    for (const h of this.head.children) {
      h.classList.toggle('sorted', h.dataset.key === this.sort.field);
      h.dataset.dir = this.sort.dir > 0 ? '▲' : '▼';
    }
    this.spacer.style.height = this.rows.length * this.rowH + 'px';
    const empty = !this.rows.length;
    this.empty.style.display = empty ? 'flex' : 'none';
    if (empty) {
      this.empty.innerHTML = '';
      if (this.viewId === 'all' && !this.search) this.empty.append(el('div', {}, el('h3', {}, 'Tu biblioteca está vacía'), el('p', {}, 'Arrastra aquí archivos o carpetas de música, o usa «+ Añadir música» en la barra lateral.')));
      else if (this.viewId === 'ai:next' && !this.app.ai.refDeck()) this.empty.append(el('div', {}, el('h3', {}, '✨ Sugerencias de la IA'), el('p', {}, 'Carga una pista en un deck y aquí verás las que mejor mezclan con ella: tonalidad compatible, BPM cercano y energía.')));
      else if (this.viewId === 'ai:next') this.empty.append(el('p', {}, 'No hay pistas analizadas que encajen. Analiza tu biblioteca con «Analizar».'));
      else if (this.viewId.startsWith('yt') && !this.search) this.empty.append(el('div', {}, el('h3', {}, 'Sin vídeos de YouTube'), el('p', {}, 'En la barra lateral, pulsa «+ Importar» en LISTAS ONLINE → «Lista de YouTube…» y pega la URL de una lista de reproducción.')));
      else this.empty.append(el('p', {}, 'No hay resultados.'));
    }
    if (resetScroll) this.scroller.scrollTop = 0;
    this.renderRows();
  }

  activeKey() {
    const playing = this.app.decks.filter(d => d.track && d.playing);
    const d = playing.length ? playing[playing.length - 1] : this.app.decks.find(d => d.track);
    return d ? d.displayKey : '';
  }

  refreshLock() {
    const on = !!this.app.settings.protectLibrary;
    this.lockBtn.textContent = on ? '🔒' : '🔓';
    this.lockBtn.classList.toggle('on', on);
    this.lockBtn.title = on ? 'Biblioteca protegida: no se pueden borrar ni editar pistas, crates ni beatgrids (clic para desbloquear)' : 'Proteger biblioteca (evita borrar o editar por error durante una sesión)';
  }

  // ---------------------------------------------------------------- columnas configurables
  colMax() { return parseInt(getComputedStyle(this.root).getPropertyValue('--lib-max'), 10) || 99; }
  chosenCols() { return columnsFor(this.app.settings, this.viewId); }
  setChosenCols(keys) {
    const s = this.app.settings;
    if (s.libColsSame === false) this.app.setSetting('libColsByView', { ...(s.libColsByView || {}), [this.viewId]: keys });
    else this.app.setSetting('libCols', keys);
    this.relayout();
  }
  // Cabecera y plantilla según las columnas visibles (al cambiarlas, de vista o de tamaño de pantalla)
  relayout() {
    this._max = this.colMax();
    this.cols = visibleColumns(this.chosenCols(), this._max);
    const art = this.cols.some(c => c.key === 'art');
    const size = ART_SIZES[this.app.settings.libArtSize] || ART_SIZES.small;
    this.rowH = art ? size.row : 28;
    this.root.style.setProperty('--row-h', this.rowH + 'px');
    this.root.style.setProperty('--art-w', size.col + 'px');
    this.head.innerHTML = '';
    for (const c of this.cols) {
      const h = el('div', { class: 'th' + (c.key === 'explicit' ? ' center' : ''), dataset: { key: c.key }, title: c.menu || c.label }, c.label);
      h.appendChild(this.colResizer(c.key, h));
      if (!c.nosort) h.addEventListener('click', (e) => {
        if (e.target.classList.contains('col-rs')) return;
        // ▲ → ▼ → sin orden (orden propio de la crate o del set)
        this.sort = this.sort.field !== c.key ? { field: c.key, dir: 1 } : this.sort.dir > 0 ? { field: c.key, dir: -1 } : { field: null, dir: 1 };
        this.app.setSetting('libSort', this.sort);
        this.refresh();
      });
      this.head.appendChild(h);
    }
    this.applyColWidths();
    this.refresh();
  }
  columnsMenu(e) {
    const s = this.app.settings, chosen = new Set(visibleColumns(this.chosenCols()).map(c => c.key));
    const mark = (on) => (on ? '✓ ' : ' ');
    const hidden = new Set(visibleColumns(this.chosenCols()).map(c => c.key)); for (const c of this.cols) hidden.delete(c.key);
    this.app.contextMenu(e, [
      ...COLUMNS.filter(c => !c.fixed).map(c => ({
        label: mark(chosen.has(c.key)) + (c.menu || c.label) + (hidden.has(c.key) ? ' (no cabe en esta pantalla)' : ''),
        fn: () => { const k = new Set(chosen); k.has(c.key) ? k.delete(c.key) : k.add(c.key); this.setChosenCols(COLUMNS.filter(x => !x.fixed && k.has(x.key)).map(x => x.key)); }
      })),
      { label: mark(s.libColsSame !== false) + 'Mismas columnas en todos los crates', fn: () => this.app.setSetting('libColsSame', s.libColsSame === false) },
      { label: 'Tamaño de la carátula', sub: [['small', 'Pequeña'], ['medium', 'Mediana']].map(([k, v]) => ({ label: mark((s.libArtSize || 'small') === k) + v, fn: () => this.app.setSetting('libArtSize', k) })) },
      { label: 'Restablecer columnas', fn: () => { this.app.setSetting('libColW', {}); this.setChosenCols(DEFAULT_COLS.filter(k => !COL_BY_KEY[k].fixed)); } }
    ]);
  }

  // ---------------------------------------------------------------- tamaños ajustables
  colResizer(key, th) {
    const h = el('span', { class: 'col-rs', title: 'Arrastra para cambiar el ancho · doble clic: ancho automático' });
    h.addEventListener('click', (e) => e.stopPropagation());
    h.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const w = { ...(this.app.settings.libColW || {}) }; delete w[key];
      this.app.setSetting('libColW', w); this.applyColWidths();
    });
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      // al empezar se fijan los anchos actuales de todas las columnas visibles (así solo cambia esta)
      const w = { ...(this.app.settings.libColW || {}) };
      for (const t of this.head.children) if (t.offsetWidth && !w[t.dataset.key]) w[t.dataset.key] = Math.round(t.getBoundingClientRect().width);
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width, min = COL_BY_KEY[key]?.min || 70;
      document.body.classList.add('resizing-col');
      const move = (ev) => { w[key] = Math.round(Math.max(min, Math.min(900, w0 + ev.clientX - x0))); this.applyColWidths(w); };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-col');
        this.app.setSetting('libColW', w);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    return h;
  }
  applyColWidths(w = this.app.settings.libColW || {}) {
    // en pantallas estrechas (≤ 760 px) se ignoran los anchos fijados para que todo quepa
    this.root.style.setProperty('--lib-cols', columnTemplate(this.cols, this._max <= 5 ? {} : w));
  }
  bindSideResizer() {
    const h = this.sideRs;
    const saved = this.app.settings.libSideW;
    if (saved) this.root.style.setProperty('--side-w', saved + 'px');
    h.addEventListener('dblclick', () => { this.root.style.removeProperty('--side-w'); this.app.setSetting('libSideW', null); });
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.side.getBoundingClientRect().width;
      const max = Math.min(SIDE_MAX, this.root.getBoundingClientRect().width * 0.5);
      let w = w0;
      document.body.classList.add('resizing-col');
      const move = (ev) => { w = Math.round(Math.max(SIDE_MIN, Math.min(max, w0 + ev.clientX - x0))); this.root.style.setProperty('--side-w', w + 'px'); };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-col');
        this.app.setSetting('libSideW', w);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  }
  placeSideRs() {
    const w = this.side.offsetWidth;
    this.sideRs.hidden = !w || w > this.root.offsetWidth * 0.8; // en móvil la barra va encima: sin tirador
    if (w) this.sideRs.style.left = (this.side.offsetLeft + w) + 'px';
    this.applyColWidths();
  }

  // Valoración: 5 estrellas, clic para cambiar (la misma otra vez = sin valoración)
  ratingCell(t) {
    const r = t.rating || 0;
    const c = el('span', { class: 'rating', title: r ? `${r} de 5 · clic para cambiar` : 'Sin valorar · clic para valorar' },
      ...[1, 2, 3, 4, 5].map(n => el('i', { class: n <= r ? 'on' : '', dataset: { n } }, '★')));
    if (t.source === 'local' || t.source === 'youtube') c.addEventListener('pointerdown', (e) => {
      const n = +e.target.dataset.n; if (!n || e.button !== 0) return;
      e.stopPropagation();
      this.lib.setRating([t.id], n === r ? 0 : n);
    });
    return c;
  }
  cell(key, t, ctx) {
    switch (key) {
      case 'status': {
        const { ai, deckIdx, played } = ctx, lost = this.missing.get(t.id) === true;
        if (ai) return el('span', { class: 'st ai-score', title: ai.reasons.join(' · '), style: `--s:${ai.score.toFixed(2)}` }, String(Math.round(ai.score * 100)));
        if (lost && deckIdx == null) return el('span', { class: 'st missing', title: 'Archivo no encontrado: clic derecho → «Relocalizar archivos perdidos…»' }, '!');
        return el('span', { class: 'st' + (deckIdx != null ? ' deck' + deckIdx : '') },
          deckIdx != null ? String(deckIdx + 1) : t.source === 'youtube' ? '▶' : (t.analyzed ? (played ? '✓' : '') : '○'));
      }
      case 'art': {
        const url = t.source === 'youtube' ? t.thumb : this.art.get(t.id);
        return el('span', { class: 'c-art' }, url && url !== 'pending' ? el('img', { src: url, alt: '', loading: 'lazy' }) : el('i', {}, '♪'));
      }
      case 'title': return el('span', { class: 'c-title', title: ctx.ai ? ctx.ai.reasons.join(' · ') : '' }, t.title || '—', t.energy ? el('small', { class: 'nrg', title: 'Energía estimada por la IA (1-10)' }, '⚡' + t.energy) : null, t.stems ? el('small', { class: 'stm', title: 'Stems separados (voz, batería, bajo, melodía)' }, 'STEMS') : null);
      case 'artist': return el('span', { class: 'c-artist' }, t.artist || '');
      case 'bpm': return el('span', { class: 'num c-bpm' }, t.bpm ? (Math.round(t.bpm * 10) / 10).toString() : '');
      case 'camelot': { const ok = ctx.akey && camelotCompatible(ctx.akey, t.camelot); return el('span', { class: 'num key' + (ok ? ' compat' : ''), style: { color: keyColor(t.camelot) } }, (ok ? '◉ ' : '') + (t.camelot || t.key || '')); }
      case 'duration': return el('span', { class: 'num' }, t.duration ? fmtTime(t.duration, false) : '');
      case 'rating': return this.ratingCell(t);
      case 'explicit': return el('span', { class: 'c-explicit' }, t.explicit ? el('b', { title: 'Explicit' }, 'E') : '');
      case 'plays': return el('span', { class: 'num' }, t.plays ? String(t.plays) : '');
      case 'year': return el('span', { class: 'num' }, t.year ? String(t.year).slice(0, 4) : '');
      case 'energy': return el('span', { class: 'num' }, t.energy ? '⚡' + t.energy : '');
      case 'added': return el('span', { class: 'num dim' }, t.added ? new Date(t.added).toLocaleDateString('es-ES') : '');
      default: return el('span', {}, t[key] || '');
    }
  }

  renderRows() {
    const RH = this.rowH;
    const top = this.scroller.scrollTop, h = this.scroller.clientHeight || 300;
    const first = Math.max(0, Math.floor(top / RH) - 5);
    const last = Math.min(this.rows.length, Math.ceil((top + h) / RH) + 5);
    const loaded = new Map(this.app.decks.filter(d => d.track).map(d => [d.track.id, d.idx]));
    // en una sesión del historial, las tocadas de esa sesión; en el resto, las de la sesión actual
    const played = this.lib.playedIds(this.viewId.startsWith('history:') ? this.viewId.slice(8) : null);
    const akey = this.activeKey();
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const t = this.rows[i];
      const ctx = { deckIdx: loaded.get(t.id), ai: this.viewId === 'ai:next' ? this.app.ai.scores.get(t.id) : null, played: played.has(t.id), akey };
      const r = el('div', {
        class: 'row-t' + (this.sel.has(t.id) ? ' sel' : '') + (i === this.cursor ? ' cur' : '') + (i % 2 ? ' odd' : '') + (ctx.played ? ' played' : '') + (t.source === 'youtube' ? ' yt' : '') + (this.missing.get(t.id) === true ? ' missing' : ''),
        style: { top: i * RH + 'px', gridTemplateColumns: GRID }, draggable: 'true', dataset: { i }
      }, ...this.cols.map(c => this.cell(c.key, t, ctx)));
      r.addEventListener('pointerdown', (e) => this.onRowDown(e, i));
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.sel.has(t.id)) this.selectOnly(i); this.rowMenu(e); });
      r.addEventListener('dragstart', (e) => {
        const ids = this.sel.has(t.id) ? [...this.sel] : [t.id];
        e.dataTransfer.setData('text/nexura-track', ids.join(','));
        e.dataTransfer.effectAllowed = 'copy';
      });
      frag.appendChild(r);
    }
    this.rowsEl.innerHTML = '';
    this.rowsEl.appendChild(frag);
    this._visible = this.rows.slice(first, last);
    this.checkMissingSoon();
    if (this.cols.some(c => c.key === 'art')) this.loadArtSoon();
  }

  // ---------------------------------------------------------------- archivos perdidos y carátulas
  markMissing(id, lost) { if (this.missing.get(id) !== lost) { this.missing.set(id, lost); this.renderRows(); } }
  // Comprueba por IPC las pistas visibles que aún no se han comprobado en esta sesión
  async checkMissing(list = this._visible || []) {
    const todo = list.filter(t => t.source === 'local' && !this.missing.has(t.id));
    if (!todo.length) return 0;
    for (const t of todo) this.missing.set(t.id, false);
    const ex = await this.app.platform.existsMany(todo.map(t => t.path));
    if (!ex) return 0; // navegador: no se puede comprobar
    let lost = 0;
    todo.forEach((t, i) => { if (!ex[i]) { this.missing.set(t.id, true); lost++; } });
    if (lost) this.renderRows();
    return lost;
  }
  async checkAllMissing() {
    if (!this.app.platform.existsMany) return;
    const all = [...this.lib.tracks.values()].filter(t => t.source === 'local');
    for (const t of all) this.missing.delete(t.id);
    let lost = 0;
    for (let i = 0; i < all.length; i += 1000) lost += await this.checkMissing(all.slice(i, i + 1000));
    this.renderRows();
    this.app.toast(lost ? `${lost} archivo(s) perdidos (marcados con «!»). Clic derecho → «Relocalizar archivos perdidos…»` : 'Todos los archivos están en su sitio', lost ? 'warn' : 'ok', 6000);
  }
  async loadArt() {
    const todo = (this._visible || []).filter(t => t.source === 'local' && !this.art.has(t.id) && this.missing.get(t.id) !== true);
    if (!todo.length) return;
    for (const t of todo) this.art.set(t.id, 'pending');
    for (const t of todo) {
      try { this.art.set(t.id, await this.app.platform.artGet(t.id, t.path)); } catch (_) { this.art.set(t.id, null); }
    }
    this.renderRows();
  }

  onRowDown(e, i) {
    if (e.button === 2) return;
    // doble clic propio: la fila se redibuja en cada pulsación y el evento dblclick nativo se pierde
    const now = performance.now();
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && this.lastDown && this.lastDown.i === i && now - this.lastDown.at < 450) {
      this.lastDown = null;
      const t = this.rows[i];
      if (t) this.app.loadToDeck(t.id, this.app.freeDeckIndex());
      return;
    }
    this.lastDown = { i, at: now };
    this.scroller.focus({ preventScroll: true });
    const t = this.rows[i];
    if (e.shiftKey && this.anchor >= 0) {
      this.sel.clear();
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      for (let k = a; k <= b; k++) this.sel.add(this.rows[k].id);
    } else if (e.ctrlKey || e.metaKey) {
      this.sel.has(t.id) ? this.sel.delete(t.id) : this.sel.add(t.id);
      this.anchor = i;
    } else if (!this.sel.has(t.id)) {
      this.sel.clear(); this.sel.add(t.id); this.anchor = i;
    }
    this.cursor = i;
    this.renderRows();
  }
  selectOnly(i) { this.sel.clear(); if (this.rows[i]) this.sel.add(this.rows[i].id); this.cursor = this.anchor = i; this.renderRows(); }
  selected() { return this.rows.filter(t => this.sel.has(t.id)); }
  current() { return this.rows[this.cursor] || this.selected()[0] || null; }

  // Navegación (teclado / encoder de la controladora). En la barra lateral, «open» abre la vista al moverse
  // (encoder MIDI, como hasta ahora); con el teclado (open = false) solo se mueve el foco e Intro la abre
  move(delta, open = true) {
    if (this.focus === 'side') {
      const items = this.sideItems || [];
      const cur = this.curItem();
      let i = items.indexOf(cur);
      i = Math.max(0, Math.min(items.length - 1, i + delta));
      const it = items[i];
      if (!it) return;
      this.setSideCur(it);
      it.focus({ preventScroll: true });
      it.scrollIntoView({ block: 'nearest' });
      if (open && it.dataset.view) this.setView(it.dataset.view);
      return;
    }
    if (!this.rows.length) return;
    const i = Math.max(0, Math.min(this.rows.length - 1, (this.cursor < 0 ? -1 : this.cursor) + delta));
    this.selectOnly(i);
    const RH = this.rowH, top = i * RH, st = this.scroller.scrollTop, h = this.scroller.clientHeight;
    if (top < st) this.scroller.scrollTop = top;
    else if (top + RH > st + h) this.scroller.scrollTop = top + RH - h;
  }
  // ← / → (teclado o botones MIDI) con la barra lateral activa, sobre la fila con el foco: ← pliega la crate
  // (o el Historial) o sube a su padre; → despliega. Devuelve false si no hace nada (→ pasa entonces a la
  // tabla). «open»: al subir al padre también lo abre (MIDI, como antes; el teclado solo mueve el foco)
  sideKey(dir, open = true) {
    if (this.focus !== 'side') return false;
    const it = this.curItem(), key = it ? this.keyOf(it) : this.viewId;
    if (key === 'node:history') {
      const o = !!this.app.settings.libHistOpen;
      if (!this.lib.history.length || (dir > 0 ? o : !o)) return dir < 0;
      this.setHistOpen(dir > 0);
      return true;
    }
    if (key.startsWith('history:')) { if (dir > 0) return false; this.focusSideKey('node:history'); return true; }
    const c = key.startsWith('crate:') ? this.lib.crate(key.slice(6)) : null;
    if (!c) return dir < 0;
    const hasKids = this.lib.subcrateIds(c.id).length > 0, isOpen = hasKids && !this.collapsedCrates().has(c.id);
    if (dir > 0) { if (!hasKids || isOpen) return false; this.setCrateOpen(c.id, true); return true; }
    if (isOpen) this.setCrateOpen(c.id, false);
    else if (this.lib.crate(c.parent)) { this.focusSideKey('crate:' + c.parent); if (open) this.setView('crate:' + c.parent); }
    this.curItem()?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  toggleFocus(to) {
    this.focus = to || (this.focus === 'side' ? 'table' : 'side');
    this.root.classList.toggle('side-focus', this.focus === 'side');
    if (this.focus === 'side') { const it = this.curItem(); if (it) { this.setSideCur(it); it.focus({ preventScroll: true }); } }
    else this.scroller.focus({ preventScroll: true });
  }

  rowMenu(e) {
    const app = this.app, L = this.lib;
    const sel = this.selected();
    const ids = sel.map(t => t.id);
    const one = sel[0];
    const items = [
      { label: 'Cargar en Deck 1', fn: () => app.loadToDeck(one.id, 0) },
      { label: 'Cargar en Deck 2', fn: () => app.loadToDeck(one.id, 1) },
      ...(app.deckCount === 4 ? [{ label: 'Cargar en Deck 3', fn: () => app.loadToDeck(one.id, 2) }, { label: 'Cargar en Deck 4', fn: () => app.loadToDeck(one.id, 3) }] : []),
      { label: 'Añadir a Prepare', fn: () => L.addToPrepare(ids) },
      { label: 'Añadir a crate', sub: [...this.crateChoices((c) => L.addToCrate(c.id, ids)), { label: '+ Nueva crate…', fn: async () => { if (!L.guard('crate')) return; const n = await app.prompt('Nombre de la crate', ''); const c = n && L.createCrate(n); if (c) L.addToCrate(c.id, ids); } }] },
      { label: 'Mostrar en qué crates está', fn: () => this.showCratesOf(one) },
      { label: 'Valoración', sub: [5, 4, 3, 2, 1, 0].map(n => ({ label: n ? '★'.repeat(n) + '☆'.repeat(5 - n) : 'Sin valoración', fn: () => L.setRating(ids, n) })) },
      { label: (one && one.explicit ? '✓ ' : ' ') + 'Explicit (E)', fn: () => L.setExplicit(ids, !(one && one.explicit)) }
    ];
    if (one && one.source === 'local') {
      items.push({ label: 'Cargar en sampler', sub: Array.from({ length: 8 }, (_, i) => ({ label: 'Ranura ' + (i + 1), fn: () => { app.sampler.loadSlot(i, one.path, one.title); app.saveSamplerSoon(); } })) });
      items.push({ label: 'Volver a analizar', fn: () => app.analyzeMany(sel.filter(t => t.source === 'local'), true) });
      items.push({ label: '✨ Cues automáticos (IA)', fn: () => app.aiAutoCues(sel) });
      items.push({ label: 'Leer cues y beatgrid guardados en el archivo', fn: () => app.readMarkersFromFiles(sel) });
      if (app.stems.available) {
        const loc = sel.filter(t => t.source === 'local'), withSt = loc.filter(t => t.stems);
        items.push({ label: withSt.length === loc.length ? '🎚 Volver a separar stems (IA)' : '🎚 Separar stems (IA)', fn: () => app.stems.separate(loc, withSt.length === loc.length) });
        if (withSt.length) items.push({ label: 'Borrar stems', fn: async () => { if (await app.confirm(`¿Borrar los stems de ${withSt.length} pista(s)? Se pueden volver a separar.`)) app.stems.remove(withSt); } });
      }
      if (app.platform.showItem && window.nexura) items.push({ label: 'Mostrar en carpeta', fn: () => app.platform.showItem(one.path) });
      if (window.nexura) {
        const lost = sel.filter(t => this.missing.get(t.id) === true);
        items.push({ label: lost.length ? `Relocalizar archivos perdidos (${lost.length})…` : 'Relocalizar archivos perdidos…', fn: () => app.relocateMissing(lost.length ? lost : null) });
      }
    }
    if (one && one.source === 'youtube') items.push({ label: 'Abrir en YouTube', fn: () => app.platform.openExternal('https://www.youtube.com/watch?v=' + one.ytId) });
    if (one && (one.bpm || one.camelot)) items.push({ label: '✨ Crear set desde esta pista (IA)…', fn: () => app.aiBuildSet(one) });
    items.push({ label: 'Editar…', fn: () => this.editTrack(one) });
    if (this.viewId.startsWith('crate:')) items.push({ label: this.crateDeep(this.viewId.slice(6)) ? 'Quitar de la crate y sus subcrates' : 'Quitar de la crate', key: 'Supr', fn: () => this.removeFromCrate(this.viewId.slice(6), ids) });
    if (this.viewId === 'prepare') items.push({ label: 'Quitar de Prepare', key: 'Supr', fn: () => this.removeFromPrepare(ids) });
    const supr = this.viewId === 'all' || this.viewId === 'everything' || this.viewId === 'yt-all';
    items.push({ label: `Eliminar de la biblioteca (${ids.length})`, key: supr ? 'Supr' : 'Ctrl+Supr', danger: true, fn: () => this.deleteFromLibrary(ids) });
    app.contextMenu(e, items);
  }

  // ------------------------------------------------------------ quitar pistas (menú y teclado)
  // Foco en la tabla (no en el buscador ni en la barra lateral)
  tableFocused() { return this.focus === 'table' && this.scroller.contains(document.activeElement); }
  // Ctrl+Supr: con pistas seleccionadas en la tabla vale también con el foco en otra parte de la
  // biblioteca (barra lateral, cabecera…) o sin foco; nunca en campos de texto ni diálogos (app.js)
  hardDeleteReady() {
    if (!this.sel.size) return false;
    const a = document.activeElement;
    return this.tableFocused() || !a || a === document.body || this.root.contains(a);
  }
  // Supr: lo que corresponde a la vista; hard (Ctrl+Supr): eliminar de la biblioteca desde cualquier vista,
  // al instante y sin confirmar (aviso con «Deshacer» y Ctrl+Z)
  deleteKey(hard = false) {
    const ids = this.selected().map(t => t.id), v = this.viewId;
    if (!ids.length) return false;
    if (hard) return this.deleteFromLibrary(ids, { ask: false });
    if (v === 'all' || v === 'everything' || v === 'yt-all') return this.deleteFromLibrary(ids, { ask: true });   // Supr sin Ctrl: con confirmación, como antes
    if (v.startsWith('crate:')) return this.removeFromCrate(v.slice(6), ids);
    if (v === 'prepare') return this.removeFromPrepare(ids);
    // historial, smart crates, Siguiente pista (IA) y listas de YouTube: su contenido no se edita a mano
    const what = v.startsWith('history:') ? 'del historial' : v.startsWith('smart:') ? 'de una smart crate (sigue sus reglas)' : v === 'ai:next' ? 'de las sugerencias de la IA' : 'de una lista de YouTube importada';
    toast(`Supr no quita pistas ${what}. Para eliminarlas de la biblioteca: Ctrl+Supr`, 'warn', 4500);
    return false;
  }
  // en una crate padre que muestra las pistas de sus subcrates, se quitan también de ellos
  crateDeep(cid) { return this.lib.subTracks && this.lib.subcrateIds(cid).length > 0; }
  removeFromCrate(cid, ids) {
    const L = this.lib, c = L.crate(cid);
    if (!c || !L.guard('crateTracks')) return false;
    const first = this.firstSelIndex(ids);
    const undo = L.removeFromCrate(cid, ids, this.crateDeep(cid));
    if (!undo) return false;
    this.pendingSel = first; this.refresh();   // en el acto (no esperar al redibujado): otra pulsación seguida actúa ya sobre la siguiente
    const name = this.crateLabel(c);
    const fn = undo.length ? this.pushUndo(() => { if (L.restoreCrates(undo)) toast(`Pistas devueltas a «${name}»`, 'ok'); }) : null;
    toast(`${countLabel(ids.length)} ${ids.length === 1 ? 'quitada' : 'quitadas'} de «${name}»`, 'ok', 6000, fn ? { label: 'Deshacer', fn } : null);
    return true;
  }
  removeFromPrepare(ids) {
    const L = this.lib, first = this.firstSelIndex(ids);
    const old = L.removeFromPrepare(ids);
    this.pendingSel = first; this.refresh();
    const fn = this.pushUndo(() => { L.restorePrepare(old); toast('Pistas devueltas a Prepare', 'ok'); });
    toast(`${countLabel(ids.length)} ${ids.length === 1 ? 'quitada' : 'quitadas'} de Prepare`, 'ok', 6000, { label: 'Deshacer', fn });
    return true;
  }
  // Eliminar de la biblioteca (los archivos no se borran). ask: pedir confirmación (null = solo si son
  // más de 20, el menú de la pista; la tecla Ctrl+Supr nunca pregunta). Siempre con «Deshacer» / Ctrl+Z
  async deleteFromLibrary(ids, { ask = null } = {}) {
    const L = this.lib;
    if (!ids.length || !L.guard('remove')) return false;
    const first = this.firstSelIndex(ids);
    if (ask == null) ask = ids.length > 20;
    if (ask) {
      const ok = await this.app.confirm(`¿Quitar ${countLabel(ids.length)} de la biblioteca? Los archivos no se borran del disco.`);
      this.scroller.focus({ preventScroll: true });   // para seguir con el teclado tras el diálogo
      if (!ok) return false;
    }
    const undo = L.remove(ids);
    if (!undo || !undo.tracks.length) return false;
    this.pendingSel = first; this.refresh();   // en el acto: Ctrl+Supr varias veces seguidas va eliminando la siguiente
    const fn = this.pushUndo(() => { if (L.restoreRemoved(undo)) toast(`${countLabel(undo.tracks.length)} ${undo.tracks.length === 1 ? 'devuelta' : 'devueltas'} a la biblioteca`, 'ok'); });
    toast(`${countLabel(ids.length)} ${ids.length === 1 ? 'eliminada' : 'eliminadas'} de la biblioteca (los archivos siguen en el disco)`, 'ok', 8000, { label: 'Deshacer', fn });
    return true;
  }

  // ------------------------------------------------------------ YouTube: quitar vídeos y listas
  ytAllMenu() {
    const n = this.lib.ytTrackIds().length;
    return [{ label: `Quitar todos los vídeos de YouTube de la biblioteca (${n})`, key: 'Supr', danger: true, fn: () => this.removeAllYt() }];
  }
  ytListMenu(p) {
    const n = this.lib.ytPlaylistOrphans(p.id).length;
    return [
      { label: 'Actualizar desde YouTube', fn: () => this.app.ytImport(p.playlistId) },
      { label: 'Eliminar lista', key: 'Supr', danger: true, fn: () => this.deleteYtList(p) },
      { label: `Eliminar lista y sus vídeos de la biblioteca (${n})`, danger: true, fn: () => this.deleteYtListAndVideos(p) }
    ];
  }
  // «YouTube · todos los vídeos»: todos fuera de la biblioteca (y de crates, Prepare y listas), con Deshacer
  async removeAllYt() {
    const L = this.lib, ids = L.ytTrackIds();
    if (!ids.length || !L.guard('remove')) return false;
    if (!await this.app.confirm(`¿Quitar ${ids.length === 1 ? 'el vídeo' : `los ${ids.length} vídeos`} de YouTube de la biblioteca? También salen de las crates, de Prepare y de las listas de YouTube.`)) return false;
    const undo = L.remove(ids);
    if (!undo || !undo.tracks.length) return false;
    const fn = this.pushUndo(() => { if (L.restoreRemoved(undo)) toast(`${countLabel(undo.tracks.length, 'vídeo', 'vídeos')} de YouTube ${undo.tracks.length === 1 ? 'devuelto' : 'devueltos'} a la biblioteca`, 'ok'); });
    toast(`${countLabel(undo.tracks.length, 'vídeo', 'vídeos')} de YouTube ${undo.tracks.length === 1 ? 'quitado' : 'quitados'} de la biblioteca`, 'ok', 8000, { label: 'Deshacer', fn });
    return true;
  }
  // Lista importada: solo la lista (los vídeos siguen en «YouTube · todos los vídeos»)
  async deleteYtList(p, { ask = false } = {}) {
    const L = this.lib;
    if (!L.guard('crate')) return false;
    if (ask && !await this.app.confirm(`¿Eliminar la lista «${p.title}»? Sus vídeos siguen en la biblioteca.`)) return false;
    const undo = L.deleteYtPlaylist(p.id);
    if (!undo) return false;
    const fn = this.pushUndo(() => { if (L.restoreYtPlaylist(undo)) toast(`Lista «${p.title}» recuperada`, 'ok'); });
    toast(`Lista «${p.title}» eliminada`, 'ok', 6000, { label: 'Deshacer', fn });
    return true;
  }
  // Lista y sus vídeos que no estén en otra lista ni en una crate
  async deleteYtListAndVideos(p) {
    const L = this.lib, n = L.ytPlaylistOrphans(p.id).length;
    if (!L.guard('crate') || !L.guard('remove')) return false;
    const kept = new Set(p.ids).size - n;
    if (!await this.app.confirm(`¿Eliminar la lista «${p.title}» y quitar ${countLabel(n, 'vídeo', 'vídeos')} de la biblioteca?` + (kept ? ` ${countLabel(kept, 'vídeo', 'vídeos')} se ${kept === 1 ? 'queda' : 'quedan'} porque ${kept === 1 ? 'está' : 'están'} en otra lista o en una crate.` : ''))) return false;
    const undo = L.deleteYtPlaylistWithVideos(p.id);
    if (!undo) return false;
    const fn = this.pushUndo(() => { if (L.restoreYtPlaylistWithVideos(undo)) toast(`Lista «${p.title}» y sus vídeos recuperados`, 'ok'); });
    toast(`Lista «${p.title}» eliminada` + (n ? ` · ${countLabel(n, 'vídeo', 'vídeos')} ${n === 1 ? 'quitado' : 'quitados'} de la biblioteca` : ''), 'ok', 8000, { label: 'Deshacer', fn });
    return true;
  }
  // Supr / Ctrl+Supr con el foco en una fila de YouTube de la barra lateral (siempre con confirmación)
  sideDeleteTarget() {
    const a = document.activeElement;
    if (!a || !this.tree.contains(a) || !a.classList.contains('side-item')) return null;
    const v = a.dataset.view || '';
    if (v === 'yt-all') return { all: true };
    const p = v.startsWith('yt:') && this.lib.ytPlaylists.find(x => 'yt:' + x.id === v);
    return p ? { list: p } : null;
  }
  sideDeleteKey() {
    const t = this.sideDeleteTarget();
    if (!t) return false;
    if (t.all) this.removeAllYt(); else this.deleteYtList(t.list, { ask: true });
    return true;
  }

  // Deshacer de Supr / Ctrl+Supr: el botón del aviso o Ctrl+Z (la última primero; vale durante 2 minutos).
  // Devuelve la función del botón: cada deshacer se aplica una sola vez
  pushUndo(apply) {
    const u = { apply, at: Date.now(), done: false };
    const run = () => { if (u.done) return false; u.done = true; this.undoStack = this.undoStack.filter(x => x !== u); apply(); return true; };
    u.run = run;
    this.undoStack = [...(this.undoStack || []), u].slice(-20);
    return run;
  }
  undoLast() {
    const now = Date.now();
    this.undoStack = (this.undoStack || []).filter(u => !u.done && now - u.at < 120000);
    const u = this.undoStack[this.undoStack.length - 1];
    return u ? u.run() : false;
  }
  firstSelIndex(ids) { const s = new Set(ids); const i = this.rows.findIndex(t => s.has(t.id)); return i < 0 ? null : i; }

  showCratesOf(t) {
    if (!t) return;
    // ruta completa de cada crate (Dance › 2024), en orden de árbol
    const order = this.lib.sortedCrates(this.app.settings.crateSort);
    const list = this.lib.cratesOf(t.id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const body = el('div', { class: 'crates-of' },
      el('p', {}, `«${t.title || '—'}»${t.artist ? ' · ' + t.artist : ''}`),
      list.length
        ? el('ul', { class: 'crates-of-list' }, ...list.map(c => {
          const li = el('li', { title: 'Abrir la crate' }, el('span', { class: 'swatch', style: { background: effectiveColor(this.lib.crates, c.id).color || 'var(--line2)' } }), this.crateLabel(c), el('small', {}, this.crateInfo(c)));
          li.addEventListener('click', () => { this.app.closeModal(); this.expandCrate(c.id); this.setView('crate:' + c.id); });
          return li;
        }))
        : el('p', { class: 'hint' }, 'Esta pista no está en ninguna crate.'),
      this.lib.prepare.includes(t.id) ? el('p', { class: 'hint' }, 'También está en Prepare.') : null);
    this.app.modal('Crates de la pista', body, ['Cerrar']);
  }

  async editTrack(t) {
    if (!t || !this.lib.guard('tags')) return;
    const f = {};
    const field = (k, label) => { f[k] = el('input', { value: t[k] ?? '' }); return el('label', { class: 'frm' }, el('span', {}, label), f[k]); };
    const body = el('div', { class: 'form' }, field('title', 'Título'), field('artist', 'Artista'), field('album', 'Álbum'), field('genre', 'Género'), field('bpm', 'BPM'), field('camelot', 'Tonalidad (Camelot, p. ej. 8A)'), field('comment', 'Comentario'));
    const ok = await this.app.modal('Editar pista', body, ['Cancelar', 'Guardar']);
    if (ok !== 1) return;
    const patch = {};
    for (const k of Object.keys(f)) patch[k] = f[k].value.trim();
    patch.bpm = parseFloat(String(patch.bpm).replace(',', '.')) || null;
    if (patch.bpm !== t.bpm) patch.bpmLocked = true;
    if (patch.camelot !== t.camelot) patch.keyLocked = true;
    patch.camelot = patch.camelot.toUpperCase();
    this.lib.editTrack(t.id, patch);
    this.refresh();
  }

  async smartEditor(sc) {
    if (!this.lib.guard('smart')) return;
    const edit = sc ? JSON.parse(JSON.stringify(sc)) : { id: uid(), name: 'Nueva smart crate', match: 'all', rules: [{ field: 'genre', op: 'contains', value: '' }] };
    const name = el('input', { value: edit.name });
    const match = select({ all: 'Cumplir todas las reglas', any: 'Cumplir alguna regla' }, edit.match, (v) => { edit.match = v; });
    const rulesEl = el('div', { class: 'rules' });
    const renderRules = () => {
      rulesEl.innerHTML = '';
      edit.rules.forEach((r, i) => {
        const v1 = el('input', { value: r.value || '', placeholder: 'valor' });
        v1.addEventListener('input', () => { r.value = v1.value; });
        const v2 = el('input', { value: r.value2 || '', placeholder: 'hasta', style: { display: r.op === 'between' ? '' : 'none' } });
        v2.addEventListener('input', () => { r.value2 = v2.value; });
        rulesEl.appendChild(el('div', { class: 'rule' },
          select(SMART_FIELDS, r.field, (v) => { r.field = v; }),
          select(SMART_OPS, r.op, (v) => { r.op = v; v2.style.display = v === 'between' ? '' : 'none'; }),
          v1, v2,
          btn('✕', { cls: 'micro', onClick: () => { edit.rules.splice(i, 1); renderRules(); } })));
      });
    };
    renderRules();
    const body = el('div', { class: 'form' }, el('label', { class: 'frm' }, el('span', {}, 'Nombre'), name), match, rulesEl,
      btn('+ Regla', { cls: 'small', onClick: () => { edit.rules.push({ field: 'bpm', op: 'between', value: '120', value2: '130' }); renderRules(); } }));
    const ok = await this.app.modal(sc ? 'Editar smart crate' : 'Nueva smart crate', body, ['Cancelar', 'Guardar']);
    if (ok !== 1) return;
    edit.name = name.value.trim() || 'Smart crate';
    if (this.lib.saveSmart(edit)) this.setView('smart:' + edit.id);
  }
}
