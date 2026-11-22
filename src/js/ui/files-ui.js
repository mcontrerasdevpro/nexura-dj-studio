// Panel «Archivos» de la biblioteca (vista 'files'; solo en la app de escritorio). Las carpetas del equipo se ven
// como un ÁRBOL en la barra lateral (grupo CARPETAS de library-ui.js → renderSide): favoritas arriba (★) y el nodo
// «Carpetas del equipo» con Música, Documentos, Escritorio, Descargas y las unidades. Cada carpeta se despliega
// con ▸/▾ (o ← →) y solo se lee al desplegarla (main.js → files:list, una carpeta cada vez). Al pulsar una carpeta,
// su música sale en la tabla, también la de sus subcarpetas (búsqueda en segundo plano con un límite de archivos
// y de niveles; interruptor «Incluir subcarpetas»), con la columna «Carpeta». Los archivos que ya están en la
// biblioteca usan sus datos; los demás, las etiquetas del archivo (main.js → files:meta, de pocos en pocos, primero
// los que se ven) y se ven más apagados. Las rutas no se escriben en el registro técnico ni van en el informe.
import { el, debounce } from '../util.js';
import { btn } from './controls.js';
import { platform } from '../platform.js';

const META_BATCH = 8;
export const SCAN_MAX_FILES = 5000, SCAN_MAX_DEPTH = 6;
const SCAN_PAR = 3; // carpetas leídas a la vez en la búsqueda por subcarpetas
const ERRORS = { denied: 'Sin permiso para abrir esta carpeta', missing: 'La carpeta ya no existe', slow: 'La carpeta no responde (¿unidad de red desconectada?)', error: 'No se pudo leer la carpeta' };
const lower = (p) => String(p || '').toLowerCase().replace(/[\\/]+$/, '');
const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
const byName = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
const fmtN = (n) => n.toLocaleString('es-ES');

export class FilesBrowser {
  constructor(ui) {
    this.ui = ui; this.app = ui.app; this.lib = ui.lib;
    this.roots = null;          // { places, drives }
    this.cache = new Map();     // ruta (minúsculas) → contenido leído { path, name, dirs, files, error }
    this.reading = new Set();   // carpetas del árbol que se están leyendo
    this.dir = null;            // carpeta abierta: { path, name, files: [{ path, name, size, rel }], error, scanning, folders, capped, rec }
    this.relOf = new Map();     // ruta (minúsculas) → subcarpeta dentro de la abierta ('' = en la misma)
    this.parentOf = new Map();  // clave de nodo del árbol → clave del padre (← sube al padre)
    this.ext = new Map();       // ruta → pista de un archivo que no está en la biblioteca (para la tabla)
    this.metaDone = new Set();  // rutas con las etiquetas ya leídas (o intentadas)
    this.req = 0;
    this.metaRun = 0;
    this.refreshSoon = debounce(() => { if (this.active) { this.sortFiles(); this.ui.refresh(); this.renderBar(); } }, 250);
    this.sideSoon = debounce(() => this.ui.renderSide(), 30);
    this.panel = el('div', { class: 'lib-files', hidden: true, role: 'group', 'aria-label': 'Carpeta abierta' });
    this.upBtn = btn('↑', { cls: 'small icon fb-up', title: 'Carpeta superior', onClick: () => this.openParent() });
    this.pathEl = el('span', { class: 'fb-path' });
    this.statusEl = el('span', { class: 'fb-status', role: 'status', 'aria-live': 'polite' });
    this.recBox = el('input', { type: 'checkbox', class: 'fb-rec-box' });
    this.recBox.checked = this.recursive;
    this.recBox.addEventListener('change', () => { this.app.setSetting('filesRecursive', this.recBox.checked); if (this.dir) this.openDir(this.dir.path); });
    this.recEl = el('label', { class: 'fb-rec', title: 'Muestra también la música de las subcarpetas (hasta 5.000 archivos y 6 niveles)' }, this.recBox, el('span', {}, 'Incluir subcarpetas'));
    this.addBtn = btn('＋ Añadir esta carpeta a la biblioteca', { cls: 'small fb-add', title: 'Añade la carpeta abierta (con sus subcarpetas) como con «Añadir música → Carpeta…»', onClick: () => this.addFolder() });
    this.panel.append(el('div', { class: 'fb-bar' }, this.upBtn, this.pathEl, this.statusEl, this.recEl, this.addBtn));
    this.lib.on('change', () => { if (this.active) this.renderBar(); });
    this.renderBar();
  }

  get available() { return platform.files.available; }
  get active() { return this.ui.viewId === 'files'; }
  get recursive() { return this.app.settings.filesRecursive !== false; }

  // Al abrir la vista: la primera vez, la última carpeta abierta (o la que se dejó a medio buscar)
  async show() {
    this.panel.hidden = false;
    await this.ensureRoots();
    const last = this.app.settings.filesDir;
    if (this.dir && this.dir.stale) this.openDir(this.dir.path);
    else if (!this.dir && last) this.openDir(last);
    this.renderBar();
  }
  // al salir de la vista se dejan de leer etiquetas y subcarpetas (al volver se termina la búsqueda)
  hide() {
    this.panel.hidden = true; this.metaRun++;
    if (this.dir && this.dir.scanning) { this.req++; this.dir.stale = true; }
  }

  ensureRoots() {
    if (!this.available) return Promise.resolve(null);
    if (!this.rootsP) this.rootsP = platform.files.roots().catch(() => ({ places: [], drives: [] })).then(r => { this.roots = r; this.sideSoon(); return r; });
    return this.rootsP;
  }
  rootList() { return this.roots ? [...this.roots.places, ...this.roots.drives] : []; }
  rootLabel(r) { return r.letter ? (r.name ? `${r.name} (${r.letter})` : `Disco local (${r.letter})`) : r.name; }

  // Contenido de una carpeta (y a la caché, para el árbol)
  async list(path) {
    let r;
    try { r = await platform.files.list(path); } catch (_) { r = { path, error: 'error', dirs: [], files: [] }; }
    const n = { path: r.path || path, name: r.name || baseName(path), dirs: r.dirs || [], files: r.files || [], error: r.error || '' };
    this.cache.set(lower(path), n);
    return n;
  }

  // ------------------------------------------------------------ árbol de la barra lateral
  openKeys() { return new Set(this.app.settings.filesOpen || ['fd-root']); }
  setOpen(key, open) {
    const s = this.openKeys();
    if (open) s.add(key); else s.delete(key);
    this.app.setSetting('filesOpen', [...s].slice(-200));
    // al desplegar se vuelve a leer la carpeta (puede haber cambiado); mientras, se ve lo que ya se leyó
    if (open && key !== 'fd-root') this.readNode(key.slice(3), true);
    this.ui.renderSide();
  }
  readNode(path, force = false) {
    const k = lower(path);
    if (this.reading.has(k) || (!force && this.cache.has(k))) return;
    this.reading.add(k);
    this.list(path).finally(() => { this.reading.delete(k); this.sideSoon(); });
  }
  favs() { return (this.app.settings.filesFav || []).filter(Boolean); }
  isFav(path) { return this.favs().some(p => lower(p) === lower(path)); }
  toggleFav(path) {
    const on = this.isFav(path);
    this.app.setSetting('filesFav', on ? this.favs().filter(p => lower(p) !== lower(path)) : [...this.favs(), path]);
    this.app.toast(on ? `«${baseName(path)}» quitada de las carpetas favoritas` : `«${baseName(path)}» en las carpetas favoritas (arriba del árbol, con ★)`, 'ok');
    this.ui.renderSide();
  }

  // Filas del grupo CARPETAS: favoritas (★) y «Carpetas del equipo» con los lugares y las unidades
  sideItems(hit) {
    if (!this.available) return [];
    this.ensureRoots();
    this.parentOf.clear();
    const open = this.openKeys(), out = [], q = !!this.ui.treeQ;
    for (const p of this.favs()) this.folderRows({ path: p, name: baseName(p) }, 'fv', 0, null, open, out, hit, { fav: true });
    const rootOpen = open.has('fd-root') || q;
    const tw = this.twisty('fd-root', true, rootOpen);
    const root = this.ui.sideItem(null, 'Carpetas del equipo', null, {
      node: 'fd-root', icon: 'pc', twisty: tw, expanded: rootOpen, cls: 'fd-item fd-root',
      title: 'Música, Documentos, Escritorio, Descargas y las unidades del equipo: despliega una carpeta con ▸ y púlsala para ver su música',
      onClick: () => this.setOpen('fd-root', !open.has('fd-root'))
    });
    if (!q || hit('Carpetas del equipo')) out.push(root);
    if (rootOpen) {
      if (!this.roots) out.push(el('p', { class: 'side-note fd-note', style: { '--depth': 1 } }, 'Buscando unidades…'));
      else for (const r of this.rootList()) this.folderRows({ path: r.path, name: this.rootLabel(r), kind: r.kind, ready: r.ready }, 'fd', 1, 'node:fd-root', open, out, hit, { root: true });
    }
    return out;
  }
  twisty(key, can, isOpen, loading = false) {
    const tw = el('span', { class: 'si-tw', title: can ? (isOpen ? 'Plegar' : 'Desplegar') : null });
    if (loading) tw.textContent = '…';
    else if (can) tw.append(this.ui.icon(isOpen ? 'open' : 'closed', 14, null, 2.4));
    if (can && !loading) tw.addEventListener('click', (e) => { e.stopPropagation(); this.setOpen(key, !isOpen); });
    return tw;
  }
  folderRows(e, prefix, depth, parentKey, open, out, hit, opts = {}) {
    const key = prefix + ':' + e.path, nodeKey = 'node:' + key, L = this.cache.get(lower(e.path));
    if (parentKey) this.parentOf.set(nodeKey, parentKey);
    const isOpen = open.has(key) && e.ready !== false;
    if (isOpen && !L) this.readNode(e.path);
    const loading = isOpen && !L && this.reading.has(lower(e.path));
    const can = e.ready !== false && (!L || L.dirs.length > 0 || !!L.error);
    const on = this.active && this.dir && lower(this.dir.path) === lower(e.path);
    const icon = opts.fav ? 'fav' : e.kind === 'music' ? 'lib' : opts.root && /^(disk|usb|net|cd)$/.test(e.kind || '') ? 'disk' : 'files';
    const it = this.ui.sideItem(null, e.name, null, {
      node: key, icon, depth, twisty: this.twisty(key, can, isOpen, loading), expanded: can ? isOpen : null,
      cls: 'fd-item' + (on ? ' on' : '') + (e.ready === false ? ' off' : '') + (opts.fav ? ' fav' : ''),
      title: opts.fav ? 'Carpeta favorita · clic derecho: quitar de favoritos' : 'Clic: ver su música (con las subcarpetas) · ▸: desplegar · clic derecho: favoritos',
      onClick: () => this.openDir(e.path), menu: () => this.folderMenu(e.path)
    });
    it.dataset.path = e.path;
    if (on) it.setAttribute('aria-current', 'true');
    // con el buscador del árbol: solo las que coinciden (y se sigue bajando por las desplegadas)
    if (!this.ui.treeQ || hit(e.name)) out.push(it);
    if (!isOpen || !L) return;
    if (L.error) { out.push(el('p', { class: 'side-note fd-note warn', style: { '--depth': depth + 1 } }, ERRORS[L.error] || ERRORS.error)); return; }
    for (const d of L.dirs) this.folderRows(d, prefix, depth + 1, nodeKey, open, out, hit);
  }
  folderMenu(path) {
    const fav = this.isFav(path);
    return [
      { label: 'Ver su música', fn: () => this.openDir(path) },
      { label: fav ? '☆ Quitar de favoritos' : '★ Añadir a favoritos', fn: () => this.toggleFav(path) },
      { label: 'Añadir esta carpeta a la biblioteca', fn: () => this.addFolder(path) },
      { label: 'Mostrar en el Explorador', fn: () => platform.showItem(path) }
    ];
  }
  // ← / → en el árbol (library-ui.js → sideKey) sobre un nodo de carpeta: true si ha hecho algo
  sideKey(key, dir) {
    const k = key.slice(5), open = this.openKeys();
    const can = k === 'fd-root' || (() => { const L = this.cache.get(lower(k.slice(3))); return !L || L.dirs.length > 0; })();
    const isOpen = open.has(k);
    if (dir > 0) { if (!can || isOpen) return false; this.setOpen(k, true); return true; }
    if (isOpen) { this.setOpen(k, false); return true; }
    const p = this.parentOf.get(key);
    if (p) { this.ui.focusSideKey(p); return true; }
    return false;
  }
  // la carpeta abierta, marcada en el árbol (sin volver a dibujarlo)
  markSide() {
    const p = this.active && this.dir ? lower(this.dir.path) : null;
    for (const it of this.ui.tree.querySelectorAll('.fd-item[data-path]')) {
      const on = lower(it.dataset.path) === p;
      it.classList.toggle('on', on);
      if (on) it.setAttribute('aria-current', 'true'); else it.removeAttribute('aria-current');
    }
  }
  // Acceso rápido «Archivos» y barra de iconos: el árbol desplegado y a la vista
  reveal() {
    if (!this.openKeys().has('fd-root')) this.setOpen('fd-root', true);
    const g = this.ui.tree.querySelector('.side-group[data-sec="folders"]');
    if (g) this.ui.tree.scrollTop = Math.max(0, g.offsetTop - 2);
  }

  // ------------------------------------------------------------ carpeta abierta y búsqueda por subcarpetas
  async openDir(path) {
    const req = ++this.req;
    this.metaRun++;
    const rec = this.recursive;
    if (this.active) this.ui.saveViewState(); // fran6: la carpeta que se deja recuerda su sitio
    this.dir = { path, name: baseName(path), files: [], error: '', scanning: true, folders: 0, capped: false, deep: false, rec };
    this.relOf.clear();
    if (!this.active) this.ui.setView('files');
    else { this.ui.restoreViewState(); this.ui.scroller.scrollTop = 0; this.ui._noAnchor = true; this.ui.relayout(); this.ui._noAnchor = false; }
    this.markSide();
    this.renderBar();
    this.ui.refresh(true);
    const r = await this.list(path);
    if (req !== this.req) return;
    this.dir.name = r.name || this.dir.name;
    if (r.error) {
      this.dir.error = r.error; this.dir.scanning = false;
      this.renderBar(); this.ui.refresh(true);
      return;
    }
    this.app.setSetting('filesDir', r.path || path);
    this.addFiles(r.files, '');
    this.refreshSoon();
    if (rec && r.dirs.length) await this.scan(req, r.dirs.map(d => ({ path: d.path, rel: d.name, depth: 1 })));
    if (req !== this.req) return;
    this.dir.scanning = false;
    this.sortFiles();
    this.renderBar();
    this.ui.refresh();
    this.loadMeta();
  }
  // Recorrido en anchura (primero las subcarpetas más cercanas), varias carpetas a la vez, hasta el límite
  async scan(req, queue) {
    const d = this.dir;
    const worker = async () => {
      while (queue.length) {
        if (req !== this.req) return;
        if (d.files.length >= SCAN_MAX_FILES) { d.capped = true; return; }
        const q = queue.shift();
        const r = await this.list(q.path);
        if (req !== this.req) return;
        d.folders++;
        if (r.error) continue;
        this.addFiles(r.files, q.rel);
        if (q.depth < SCAN_MAX_DEPTH) queue.push(...r.dirs.map(s => ({ path: s.path, rel: q.rel + '\\' + s.name, depth: q.depth + 1 })));
        else if (r.dirs.length) d.deep = true;
        this.refreshSoon();
      }
    };
    await Promise.all(Array.from({ length: SCAN_PAR }, worker));
  }
  addFiles(files, rel) {
    const d = this.dir, room = SCAN_MAX_FILES - d.files.length;
    if (files.length > room) d.capped = true;
    for (const f of files.slice(0, Math.max(0, room))) {
      d.files.push({ ...f, rel });
      this.relOf.set(lower(f.path), rel);
    }
  }
  // por subcarpeta y nombre (la de arriba primero): así salen agrupadas aunque se lean a la vez
  sortFiles() {
    if (!this.dir) return;
    this.dir.files.sort((a, b) => (a.rel === b.rel ? 0 : !a.rel ? -1 : !b.rel ? 1 : byName(a.rel, b.rel)) || byName(a.name, b.name));
  }
  openParent() {
    const d = this.dir; if (!d) return;
    const root = this.rootList().find(r => lower(r.path) === lower(d.path));
    const m = /^(.*[\\/])[^\\/]+[\\/]?$/.exec(d.path);
    if (root || !m) return;
    const up = m[1].length > 3 ? m[1].replace(/[\\/]+$/, '') : m[1];
    this.openDir(up);
  }

  renderBar() {
    const d = this.dir;
    this.pathEl.textContent = d ? d.path : 'Elige una carpeta en «Carpetas del equipo» (barra lateral)';
    this.pathEl.title = d ? d.path : '';
    this.recBox.checked = this.recursive;
    let s = '';
    if (d && d.error) s = ERRORS[d.error] || ERRORS.error;
    else if (d && d.scanning) s = `Buscando en las subcarpetas… ${fmtN(d.files.length)} archivos de audio · ${fmtN(d.folders)} carpetas`;
    else if (d) {
      const inLib = d.files.filter(f => this.lib.byPath(f.path)).length;
      s = d.files.length ? `${fmtN(d.files.length)} archivos de audio${d.rec && d.folders ? ` en ${fmtN(d.folders + 1)} carpetas` : ''} · ${fmtN(inLib)} en la biblioteca` : '';
      if (d.capped) s += ` · límite de ${fmtN(SCAN_MAX_FILES)}: abre una subcarpeta para ver el resto`;
      else if (d.deep) s += ` · solo ${SCAN_MAX_DEPTH} niveles de subcarpetas`;
    }
    this.statusEl.textContent = s;
    this.statusEl.classList.toggle('scanning', !!(d && d.scanning));
    this.statusEl.classList.toggle('warn', !!(d && (d.error || d.capped)));
    this.addBtn.disabled = !d || !!d.error;
    this.upBtn.disabled = !d || this.rootList().some(r => lower(r.path) === lower(d.path));
  }
  // Mensaje de la tabla vacía (library-ui.js → refresh): [título, texto]
  emptyText() {
    const d = this.dir;
    if (!d) return ['Elige una carpeta', 'En la barra lateral, despliega «Carpetas del equipo» (▸) y pulsa una carpeta: su música sale aquí, también la de sus subcarpetas. Arrástrala a un deck para pincharla o a una crate para añadirla. Clic derecho en una carpeta → «Añadir a favoritos».'];
    if (d.error) return [ERRORS[d.error] || ERRORS.error, d.path];
    if (d.scanning) return ['Buscando archivos de audio…', d.rec ? 'Se buscan también en las subcarpetas.' : ''];
    return ['No hay archivos de audio en esta carpeta', d.rec ? 'Tampoco en sus subcarpetas.' : 'Activa «Incluir subcarpetas» para ver la música de sus subcarpetas.'];
  }

  // ------------------------------------------------------------ tabla
  // Pistas de la carpeta abierta: las de la biblioteca tal cual; los demás archivos, con sus etiquetas
  rows() {
    const d = this.dir;
    if (!d || d.error) return [];
    return d.files.map(f => this.lib.byPath(f.path) || this.extTrack(f));
  }
  // subcarpeta de la pista dentro de la carpeta abierta (columna «Carpeta»)
  relFolder(t) { return t ? this.relOf.get(lower(t.path)) : undefined; }
  sortByFolder(list, dir) {
    const k = (t) => this.relFolder(t) || '';
    return list.slice().sort((a, b) => (byName(k(a), k(b)) || byName(a.title || '', b.title || '')) * dir);
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

  // Etiquetas de los archivos que no están en la biblioteca: de 8 en 8 (primero los que se ven en la tabla),
  // cediendo entre lotes; se corta si se abre otra carpeta o se sale de la vista
  async loadMeta() {
    const run = ++this.metaRun, d = this.dir;
    if (!d || d.error) return;
    const pending = (p) => !this.metaDone.has(p) && !this.lib.byPath(p);
    for (;;) {
      if (run !== this.metaRun || !this.active) return;
      const vis = (this.ui._visible || []).filter(t => t.external).map(t => t.path).filter(pending);
      const batch = vis.slice(0, META_BATCH);
      for (const f of d.files) { if (batch.length >= META_BATCH) break; if (pending(f.path) && !batch.includes(f.path)) batch.push(f.path); }
      if (!batch.length) return;
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
  async addFolder(path = this.dir && !this.dir.error ? this.dir.path : null) {
    if (!path) return;
    if (/^[a-z]:[\\/]?$|^\/$/i.test(path) && !(await this.app.confirm(`¿Añadir la unidad entera ${path} a la biblioteca? Se buscará música en todas sus carpetas y puede tardar.`))) return;
    const st = document.querySelector('#lib-status');
    if (st) st.textContent = 'Buscando archivos de audio en la carpeta…';
    let tree;
    try { tree = await platform.files.tree([path]); } finally { if (st) st.textContent = ''; }
    const target = this.app.settings.folderToCrates !== false ? null : undefined;
    const added = await this.app.importTree(tree, target);
    this.renderBar();
    this.ui.refresh();
    return added;
  }
}
