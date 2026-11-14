// Panel «Archivos» de la biblioteca (vista 'files'; solo en la app de escritorio): columnas de navegación con
// Música, Documentos y las unidades del equipo; al pulsar una carpeta se abre su contenido en la columna siguiente
// y sus archivos de audio salen en la tabla de la biblioteca (library-ui.js → refresh). Los que ya están en la
// biblioteca usan sus datos; los demás, las etiquetas del archivo (main.js → files:meta, de pocos en pocos y sin
// prisa) y se ven más apagados. Lee una carpeta cada vez (main.js → files:list, sin subcarpetas). Las rutas no
// se escriben en el registro técnico ni van en el informe de errores.
import { el, debounce } from '../util.js';
import { btn } from './controls.js';
import { platform } from '../platform.js';

const META_BATCH = 8;
const KIND_ICON = { music: '♪', docs: '▤', desktop: '▭', downloads: '↓', disk: '⛁', usb: '⏏', net: '⇄', cd: '◎' };
const ERRORS = { denied: 'Sin permiso para abrir esta carpeta', missing: 'La carpeta ya no existe', slow: 'La carpeta no responde (¿unidad de red desconectada?)', error: 'No se pudo leer la carpeta' };
const lower = (p) => String(p || '').toLowerCase().replace(/[\\/]+$/, '');
const within = (parent, p) => { const a = lower(parent), b = lower(p); return b === a || b.startsWith(a + '\\') || b.startsWith(a + '/'); };

export class FilesBrowser {
  constructor(ui) {
    this.ui = ui; this.app = ui.app; this.lib = ui.lib;
    this.roots = null;          // { places, drives }
    this.chain = [];            // carpetas abiertas, de la raíz a la actual: [{ path, name, dirs, files, error }]
    this.ext = new Map();       // ruta → pista de un archivo que no está en la biblioteca (para la tabla)
    this.metaDone = new Set();  // rutas con las etiquetas ya leídas (o intentadas)
    this.req = 0;
    this.metaRun = 0;
    this.refreshSoon = debounce(() => { if (this.active) this.ui.refresh(); }, 250);
    this.panel = el('div', { class: 'lib-files', hidden: true, role: 'group', 'aria-label': 'Archivos: unidades y carpetas del equipo' });
    this.cols = el('div', { class: 'fb-cols' });
    this.pathEl = el('span', { class: 'fb-path' });
    this.statusEl = el('span', { class: 'fb-status' });
    this.addBtn = btn('＋ Añadir esta carpeta a la biblioteca', { cls: 'small fb-add', title: 'Añade la carpeta abierta (con sus subcarpetas) como con «Añadir música → Carpeta…»', onClick: () => this.addFolder() });
    this.panel.append(el('div', { class: 'fb-bar' }, this.pathEl, this.statusEl, this.addBtn), this.cols);
    this.lib.on('change', () => { if (this.active) this.renderCols(); });
  }

  get available() { return platform.files.available; }
  get active() { return this.ui.viewId === 'files'; }
  get dir() { return this.chain[this.chain.length - 1] || null; }

  // Al abrir la vista: unidades y carpetas de usuario y, la primera vez, la última carpeta abierta
  async show() {
    this.panel.hidden = false;
    if (!this.roots) {
      this.renderCols();
      this.roots = await platform.files.roots().catch(() => ({ places: [], drives: [] }));
      const last = this.app.settings.filesDir;
      if (last && !this.chain.length) await this.openPath(last);
    }
    this.renderCols();
  }
  hide() { this.panel.hidden = true; this.metaRun++; }

  rootList() { return this.roots ? [...this.roots.places, ...this.roots.drives] : []; }
  rootLabel(r) { return r.letter ? (r.name ? `${r.name} (${r.letter})` : `Disco local (${r.letter})`) : r.name; }

  // Abre una ruta completa (la última carpeta abierta): desde la raíz que la contiene, carpeta a carpeta
  async openPath(p) {
    const root = this.rootList().filter(r => within(r.path, p)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!root) return false;
    const sep = p.includes('\\') ? '\\' : '/';
    const rest = String(p).slice(root.path.replace(/[\\/]+$/, '').length).split(/[\\/]+/).filter(Boolean);
    const req = ++this.req;
    const chain = [];
    let cur = root.path;
    for (let i = -1; i < rest.length; i++) {
      if (i >= 0) cur = cur.replace(/[\\/]+$/, '') + sep + rest[i];
      const r = await platform.files.list(cur);
      if (req !== this.req) return false;
      if (r.error && i >= 0) break; // ya no existe o no se puede abrir: se queda en la anterior
      chain.push(this.node(r));
      if (r.error) break;
    }
    this.chain = chain;
    this.afterOpen(false);
    return true;
  }
  node(r) { return { path: r.path, name: r.name || r.path, dirs: r.dirs || [], files: r.files || [], error: r.error || '' }; }

  // Pulsar una carpeta de la columna «col» (0 = raíces): se abre en la columna siguiente
  async open(col, path) {
    const req = ++this.req;
    this.chain = this.chain.slice(0, col);
    this.loading = path;
    this.renderCols();
    const r = await platform.files.list(path);
    if (req !== this.req) return;
    this.loading = null;
    this.chain.push(this.node(r));
    this.afterOpen(true);
  }
  afterOpen(scroll) {
    const d = this.dir;
    if (d && !d.error) this.app.setSetting('filesDir', d.path);
    this.renderCols();
    if (scroll) requestAnimationFrame(() => { this.cols.scrollLeft = this.cols.scrollWidth; });
    if (this.active) this.ui.refresh(true);
    this.loadMeta();
  }

  // ------------------------------------------------------------ columnas
  renderCols() {
    const x = this.cols.scrollLeft;
    const item = (col, e, label, icon, on, title = '') => {
      const b = el('button', { class: 'fb-item' + (on ? ' on' : '') + (this.loading === e.path ? ' loading' : '') + (e.ready === false ? ' off' : ''), type: 'button', title: title || label, 'aria-pressed': String(on), dataset: { path: e.path } },
        el('i', { 'aria-hidden': 'true' }, icon), el('span', {}, label), el('b', { 'aria-hidden': 'true' }, '›'));
      b.addEventListener('click', () => this.open(col, e.path));
      return b;
    };
    const cur = (i) => this.chain[i] && this.chain[i].path;
    const cols = [];
    // 1.ª columna: lugares (Música, Documentos…) y unidades con su nombre de volumen
    const r = this.roots;
    cols.push(el('div', { class: 'fb-col fb-roots' }, el('div', { class: 'fb-head' }, 'EQUIPO'),
      el('div', { class: 'fb-list' }, ...(r ? [
        ...r.places.map(p => item(0, p, p.name, KIND_ICON[p.kind] || '▤', lower(cur(0)) === lower(p.path), p.path)),
        r.drives.length ? el('div', { class: 'fb-sep' }, 'UNIDADES') : null,
        ...r.drives.map(d => item(0, d, this.rootLabel(d), KIND_ICON[d.kind] || '⛁', lower(cur(0)) === lower(d.path)))
      ] : [el('p', { class: 'fb-note' }, 'Buscando unidades…')]))));
    // una columna por carpeta abierta, con sus subcarpetas
    this.chain.forEach((d, i) => {
      const body = d.error ? [el('p', { class: 'fb-note warn' }, ERRORS[d.error] || ERRORS.error)]
        : d.dirs.length ? d.dirs.map(s => item(i + 1, s, s.name, '▸', lower(cur(i + 1)) === lower(s.path)))
          : [el('p', { class: 'fb-note' }, 'Sin subcarpetas')];
      cols.push(el('div', { class: 'fb-col' }, el('div', { class: 'fb-head', title: d.path }, d.name, d.files.length ? el('small', {}, String(d.files.length)) : null), el('div', { class: 'fb-list' }, ...body)));
    });
    this.cols.replaceChildren(...cols);
    this.cols.scrollLeft = x;
    const d = this.dir;
    this.pathEl.textContent = d ? d.path : 'Elige una carpeta o una unidad';
    this.pathEl.title = d ? d.path : '';
    const inLib = d ? d.files.filter(f => this.lib.byPath(f.path)).length : 0;
    this.statusEl.textContent = d && !d.error ? (d.files.length ? `${d.files.length} archivos de audio · ${inLib} en la biblioteca` : 'Sin archivos de audio en esta carpeta') : '';
    this.addBtn.disabled = !d || !!d.error;
  }

  // ------------------------------------------------------------ tabla
  // Pistas de la carpeta abierta: las de la biblioteca tal cual; los demás archivos, con sus etiquetas
  rows() {
    const d = this.dir;
    if (!d || d.error) return [];
    return d.files.map(f => this.lib.byPath(f.path) || this.extTrack(f));
  }
  // Pista suelta de la biblioteca (library.looseTrack): se puede cargar en un deck (doble clic, arrastrar, teclado
  // o controladora) sin añadirla; al soltarla en una crate o en Prepare se añade (library-ui.js → adoptLoose)
  extTrack(f) {
    let t = this.ext.get(f.path);
    if (!t || !t.external) {
      // «Artista - Título.mp3» mientras llegan las etiquetas
      const base = f.name.replace(/\.[^.]+$/, ''), m = base.split(' - ');
      t = this.lib.looseTrack(m.length >= 2 ? { path: f.path, artist: m[0].trim(), title: m.slice(1).join(' - ').trim(), size: f.size } : { path: f.path, title: base, size: f.size });
      if (!t.external) return t; // ya está en la biblioteca
      if (!this.ext.has(f.path)) t.added = 0;
      this.ext.set(f.path, t);
    }
    return t;
  }
  isExternal(t) { return !!(t && t.external); }

  // Etiquetas de los archivos que no están en la biblioteca: de 8 en 8, cediendo entre lotes; se corta si se
  // abre otra carpeta o se sale de la vista
  async loadMeta() {
    const run = ++this.metaRun, d = this.dir;
    if (!d || d.error) return;
    const todo = d.files.map(f => f.path).filter(p => !this.metaDone.has(p) && !this.lib.byPath(p));
    for (let i = 0; i < todo.length; i += META_BATCH) {
      if (run !== this.metaRun || !this.active) return;
      const batch = todo.slice(i, i + META_BATCH);
      batch.forEach(p => this.metaDone.add(p));
      let infos = [];
      try { infos = await platform.files.meta(batch); } catch (_) { /* se queda con el nombre del archivo */ }
      for (const info of infos) {
        const t = this.ext.get(info.path);
        if (!t || !t.external || info.error) continue;
        for (const k of ['title', 'artist', 'album', 'genre', 'year', 'key']) if (info[k]) t[k] = info[k];
        if (info.bpm && parseFloat(info.bpm)) t.bpm = parseFloat(info.bpm);
        if (info.duration) t.duration = info.duration;
      }
      this.refreshSoon();
      await new Promise(r => setTimeout(r, 30));
    }
  }

  // «Añadir esta carpeta a la biblioteca»: la importación de carpetas de siempre (con crates por carpeta si
  // está activado «Crear crates con la estructura de carpetas»)
  async addFolder() {
    const d = this.dir;
    if (!d || d.error) return;
    if (/^[a-z]:[\\/]?$|^\/$/i.test(d.path) && !(await this.app.confirm(`¿Añadir la unidad entera ${d.path} a la biblioteca? Se buscará música en todas sus carpetas y puede tardar.`))) return;
    const st = document.querySelector('#lib-status');
    if (st) st.textContent = 'Buscando archivos de audio en la carpeta…';
    let tree;
    try { tree = await platform.files.tree([d.path]); } finally { if (st) st.textContent = ''; }
    const target = this.app.settings.folderToCrates !== false ? null : undefined;
    const added = await this.app.importTree(tree, target);
    this.renderCols();
    this.ui.refresh();
    return added;
  }
}
