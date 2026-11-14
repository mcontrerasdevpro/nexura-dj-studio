// Biblioteca: pistas, crates, smart crates, historial, prepare y listas de YouTube
import { Emitter, hashId, uid, yieldToUI } from '../util.js';
import { platform } from '../platform.js';
import { energyFrom, ENERGY_VERSION } from '../analysis/analysis-core.js';
import { normalizeParents, canMoveInto, crateTrackIds, deletePlan, descendantIds, flattenTree, parentId, ensurePath } from './crate-tree.js';
import { applyFolderTree, pruneTree, treeFiles } from './folder-crates.js';

export const SMART_FIELDS = {
  title: 'Título', artist: 'Artista', album: 'Álbum', genre: 'Género', bpm: 'BPM', camelot: 'Tonalidad (Camelot)',
  key: 'Tonalidad', year: 'Año', comment: 'Comentario', plays: 'Reproducciones', added: 'Añadida (días)', source: 'Origen', rating: 'Valoración', energy: 'Energía (IA)'
};
export const SMART_OPS = {
  contains: 'contiene', notcontains: 'no contiene', is: 'es', isnot: 'no es', gt: 'mayor que', lt: 'menor que', between: 'entre'
};

function newTrack(info) {
  return {
    id: hashId(info.path), path: info.path, source: 'local',
    title: info.title || '', artist: info.artist || '', album: info.album || '', genre: info.genre || '',
    year: info.year || '', comment: '', rating: 0, isrc: info.isrc || '',
    bpm: info.bpm ? parseFloat(info.bpm) || null : null, firstBeat: 0,
    key: info.key || '', camelot: '', keyTonic: null, keyMinor: null,
    duration: 0, size: info.size || 0, rmsDb: null,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
    added: Date.now(), plays: 0, lastPlayed: 0, analyzed: false, bpmLocked: false, keyLocked: false
  };
}

// Biblioteca protegida (settings.protectLibrary): qué no se puede hacer y el aviso que se muestra
const PROTECTED = {
  remove: 'borrar pistas', crate: 'crear, borrar, renombrar u ordenar crates', crateTracks: 'añadir o quitar pistas de las crates',
  smart: 'crear, editar o borrar smart crates', tags: 'editar etiquetas ni valoraciones', grid: 'cambiar el BPM ni el beatgrid'
};
// Guardado diferido: espera tras el último cambio, espera máxima desde el primero y pistas por trozo
const SAVE_DELAY = 1500, SAVE_MAX_WAIT = 8000, SAVE_CHUNK = 400;
export const CRATE_SORTS ={ created: 'Como se crearon', alpha: 'Por nombre (A → Z)', custom: 'Personalizado (arrastrar)' };

export class Library extends Emitter {
  constructor() {
    super();
    this.tracks = new Map();
    this.crates = [];
    this.smart = [];
    this.history = [];
    this.prepare = [];
    this.ytPlaylists = [];
    this.session = null;
    this.protected = false;   // lo fija la app desde settings.protectLibrary
    this.subTracks = true;    // settings.crateSubTracks: una crate muestra también las pistas de sus subcrates
    this._byPath = null;      // índice ruta → pista (las pistas relocalizadas conservan su id antiguo)
    // Guardado agrupado y diferido (ver saveSoon / save / flush)
    this._dirty = false; this._timer = 0; this._firstDirty = 0; this._saving = null; this._run = 0;
  }

  // Guardar la biblioteca: con miles de pistas, enviarla entera como objeto al proceso principal bloqueaba la
  // interfaz más de 1 s en un PC lento (la forma de onda se quedaba parada). Ahora:
  // - saveSoon() solo marca que hay cambios: se guarda 1,5 s después del último cambio (como mucho 8 s después
  //   del primero) y en un momento de reposo (requestIdleCallback), así que un análisis de 100 pistas no guarda
  //   100 veces seguidas;
  // - se envía como texto JSON preparado a trozos de SAVE_CHUNK pistas, cediendo el hilo entre trozos;
  // - flush() guarda ya, de una vez, si hay algo pendiente: al cerrar la app (main.js lo pide antes de cerrar la
  //   ventana), al recargar y antes de instalar una actualización. No se pierde nada.
  saveSoon() {
    this._dirty = true;
    const now = Date.now();
    if (!this._firstDirty) this._firstDirty = now;
    clearTimeout(this._timer);
    const delay = Math.max(0, Math.min(SAVE_DELAY, this._firstDirty + SAVE_MAX_WAIT - now));
    this._timer = setTimeout(() => {
      const go = () => { this.save().catch(e => console.warn('biblioteca: no se pudo guardar', e)); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2000 }); else go();
    }, delay);
  }
  get savePending() { return this._dirty || !!this._saving; }

  // Texto JSON de la biblioteca. chunked: cede el hilo entre trozos de pistas (devuelve null si otro guardado
  // lo ha sustituido mientras tanto)
  async _serialize(chunked, run) {
    const list = [...this.tracks.values()], parts = [];
    for (let i = 0; i < list.length; i += SAVE_CHUNK) {
      parts.push(list.slice(i, i + SAVE_CHUNK).map(t => JSON.stringify(t)).join(','));
      if (chunked && i + SAVE_CHUNK < list.length) {
        await yieldToUI();
        if (run !== this._run) return null;
      }
    }
    const rest = JSON.stringify({ crates: this.crates, smart: this.smart, history: this.history.slice(-200), prepare: this.prepare, ytPlaylists: this.ytPlaylists });
    return '{"version":1,"tracks":[' + parts.filter(Boolean).join(',') + '],' + rest.slice(1);
  }

  // Guarda ahora (a trozos). Si llegan cambios mientras se guarda, se vuelve a programar otro guardado.
  async save() {
    clearTimeout(this._timer);
    if (this._saving) await this._saving.catch(() => {});
    const run = ++this._run;
    this._dirty = false; this._firstDirty = 0;
    const job = (async () => {
      const text = await this._serialize(true, run);
      if (text == null) return false;             // lo ha sustituido flush()
      return platform.storeSet('library', text);
    })();
    this._saving = job;
    try { return await job; }
    catch (e) { this._dirty = true; throw e; }
    finally { if (this._saving === job) this._saving = null; if (this._dirty) this.saveSoon(); }
  }

  // Guarda ya y de una vez (sin ceder el hilo) si hay cambios pendientes o un guardado a medias
  async flush() {
    if (!this._dirty && !this._saving) return true;
    clearTimeout(this._timer);
    const run = ++this._run;                      // un guardado a trozos en curso ya no envía nada
    this._dirty = false; this._firstDirty = 0;
    const text = await this._serialize(false, run);
    const p = platform.storeSet('library', text);
    this._saving = null;
    return p;
  }

  // Comprobación central de «Proteger biblioteca»: devuelve false (y avisa) si la acción no está permitida
  guard(kind) {
    if (!this.protected || !PROTECTED[kind]) return true;
    this.emit('protected', `Biblioteca protegida: no se puede ${PROTECTED[kind]}. Quita el candado 🔒 para hacer cambios.`);
    return false;
  }

  async load() {
    const d = await platform.storeGet('library');
    let migrated = false;
    if (d) {
      for (const t of d.tracks || []) {
        t.cues = t.cues || Array(8).fill(null);
        t.loops = t.loops || Array(8).fill(null);
        if (t.source === 'local' && !t.cueLoops) t.cueLoops = Array(8).fill(null);
        // recalcular la energía de pistas analizadas con una fórmula anterior (sin volver a analizar el audio)
        if (t.energyCurve && t.rmsDb != null && t.energyV !== ENERGY_VERSION) { t.energy = energyFrom(t.rmsDb, t.bpm, t.energyCurve); t.energyV = ENERGY_VERSION; migrated = true; }
        this.tracks.set(t.id, t);
      }
      this.crates = d.crates || [];
      // subcrates: las crates antiguas no tienen «parent» (= raíz); se reparan padres perdidos y ciclos
      if (normalizeParents(this.crates)) migrated = true;
      this.smart = d.smart || [];
      this.history = d.history || [];
      this.prepare = d.prepare || [];
      this.ytPlaylists = d.ytPlaylists || [];
    }
    if (!this.smart.length) {
      this.smart.push({ id: uid(), name: 'House 120–130 BPM', match: 'all', rules: [{ field: 'bpm', op: 'between', value: '120', value2: '130' }] });
    }
    if (migrated) this.saveSoon();
    this.emit('change');
  }

  get(id) { return this.tracks.get(id); }
  // Pista por ruta: primero por id (hash de la ruta) y, si no, por la ruta guardada (pistas relocalizadas)
  byPath(p) {
    const t = this.tracks.get(hashId(p));
    if (t) return t;
    if (!this._byPath) { this._byPath = new Map(); for (const x of this.tracks.values()) if (x.path) this._byPath.set(x.path.toLowerCase(), x); }
    return this._byPath.get(String(p).toLowerCase()) || null;
  }

  addFiles(infos, crateId = null) {
    const added = [];
    for (const info of infos) {
      let t = this.byPath(info.path);
      if (!t) { t = newTrack(info); this.tracks.set(t.id, t); if (this._byPath) this._byPath.set(t.path.toLowerCase(), t); }
      added.push(t);
    }
    if (crateId && this.guard('crateTracks')) this.addToCrate(crateId, added.map(t => t.id));
    this.saveSoon();
    this.emit('change');
    return added;
  }

  addYouTubeItems(items, playlist) {
    const ids = [];
    for (const it of items) {
      const id = 'yt_' + it.videoId.replace(/[^\w-]/g, '');
      let t = this.tracks.get(id);
      if (!t) {
        t = newTrack({ path: 'youtube:' + it.videoId, title: it.title, artist: it.channel });
        t.id = id; t.source = 'youtube'; t.ytId = it.videoId; t.thumb = it.thumb || '';
        t.duration = it.duration || 0; t.analyzed = false;
        this.tracks.set(id, t);
      } else {
        if (it.title && !t.title) t.title = it.title;
        if (it.channel && !t.artist) t.artist = it.channel;
        if (it.duration) t.duration = it.duration;
      }
      ids.push(id);
    }
    if (playlist) {
      let pl = this.ytPlaylists.find(p => p.playlistId === playlist.playlistId);
      if (!pl) { pl = { id: uid(), playlistId: playlist.playlistId, title: playlist.title || 'Lista de YouTube', ids: [] }; this.ytPlaylists.push(pl); }
      pl.title = playlist.title || pl.title;
      pl.ids = ids;
    }
    this.saveSoon();
    this.emit('change');
    return ids;
  }

  update(id, patch) {
    const t = this.tracks.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.saveSoon();
    this.emit('track', t);
  }
  // Cambios hechos a mano por el usuario (etiquetas, valoración, explicit): respetan la protección
  editTrack(id, patch) { if (!this.guard('tags')) return false; this.update(id, patch); return true; }
  setRating(ids, rating) {
    if (!this.guard('tags')) return false;
    const r = Math.max(0, Math.min(5, Math.round(rating) || 0));
    for (const id of ids) { const t = this.tracks.get(id); if (t) t.rating = r; }
    this.saveSoon(); this.emit('change');
    return true;
  }
  setExplicit(ids, on) {
    if (!this.guard('tags')) return false;
    for (const id of ids) { const t = this.tracks.get(id); if (t) t.explicit = !!on; }
    this.saveSoon(); this.emit('change');
    return true;
  }

  // Quita pistas de la biblioteca (los archivos no se tocan). Devuelve lo necesario para deshacer con
  // restoreRemoved (las pistas con todos sus datos, su posición y la de cada crate/lista tocada) o false.
  // El historial no se toca: sus entradas siguen apuntando al mismo id.
  remove(ids) {
    if (!this.guard('remove')) return false;
    const drop = new Set(ids.filter(id => this.tracks.has(id)));
    const undo = { order: [...this.tracks.keys()], tracks: [...drop].map(id => this.tracks.get(id)), crates: [], prepare: null, yt: [] };
    for (const id of drop) this.tracks.delete(id);
    for (const c of this.crates) if (c.ids.some(i => drop.has(i))) { undo.crates.push({ id: c.id, ids: c.ids.slice() }); c.ids = c.ids.filter(i => !drop.has(i)); }
    if (this.prepare.some(i => drop.has(i))) { undo.prepare = this.prepare.slice(); this.prepare = this.prepare.filter(i => !drop.has(i)); }
    for (const p of this.ytPlaylists) if (p.ids.some(i => drop.has(i))) { undo.yt.push({ id: p.id, ids: p.ids.slice() }); p.ids = p.ids.filter(i => !drop.has(i)); }
    this._byPath = null;
    this.saveSoon();
    this.emit('change');
    return undo;
  }
  // Deshacer remove: devuelve las pistas (mismo objeto: cues, beatgrid, valoración…) a su posición en la
  // biblioteca, en las crates, en Prepare y en las listas de YouTube. Las añadidas mientras tanto se
  // conservan (al final); una pista que se ha vuelto a añadir entretanto no se duplica.
  restoreRemoved(undo) {
    if (!undo || !undo.tracks || !undo.tracks.length || !this.guard('remove')) return false;
    const back = new Map(undo.tracks.filter(t => !this.tracks.has(t.id)).map(t => [t.id, t]));
    // undo guardado en disco («Limpiar biblioteca»): en vez del orden completo, la pista que iba delante de cada una
    let order = undo.order;
    if (!order && undo.prev) {
      order = [...this.tracks.keys()];
      for (const t of undo.tracks) {
        if (!back.has(t.id)) continue;
        const p = undo.prev[t.id], i = p == null ? -1 : order.indexOf(p);
        if (p != null && i < 0) order.push(t.id); else order.splice(i + 1, 0, t.id);
      }
    }
    const map = new Map();
    for (const id of order || []) { const t = this.tracks.get(id) || back.get(id); if (t) map.set(id, t); }
    for (const [id, t] of this.tracks) if (!map.has(id)) map.set(id, t);
    this.tracks = map;
    // contenido anterior de cada lista, sin las pistas que ya no existen; las añadidas después, al final
    const merge = (old, cur) => { const keep = old.filter(i => this.tracks.has(i)), had = new Set(keep); return [...keep, ...cur.filter(i => !had.has(i))]; };
    for (const u of undo.crates) { const c = this.crate(u.id); if (c) c.ids = merge(u.ids, c.ids); }
    if (undo.prepare) this.prepare = merge(undo.prepare, this.prepare);
    for (const u of undo.yt) { const p = this.ytPlaylists.find(x => x.id === u.id); if (p) p.ids = merge(u.ids, p.ids); }
    this._byPath = null;
    this.saveSoon();
    this.emit('change');
    return true;
  }

  // «Limpiar biblioteca» → resolver duplicados. groups: [{ keep, drop: [ids] }]. En la pista que se conserva se
  // juntan los datos de las otras: crates (en el sitio de la otra), Prepare, historial, reproducciones,
  // valoración y, si no tiene, sus hot cues / loops / Cue Loops. Las otras se quitan de la biblioteca (sus
  // archivos no se tocan aquí). Devuelve lo necesario para undoMerge o false (biblioteca protegida).
  mergeDuplicates(groups) {
    if (!this.guard('remove') || !this.guard('crateTracks')) return false;
    const list = groups.map(g => ({ keep: this.tracks.get(g.keep), drop: g.drop.filter(id => id !== g.keep && this.tracks.has(id)).map(id => this.tracks.get(id)) })).filter(g => g.keep && g.drop.length);
    const map = new Map();
    for (const g of list) for (const t of g.drop) map.set(t.id, g.keep.id);
    const undo = { keepers: [], crates: [], prepare: null, history: [], removed: null, at: Date.now() };
    const empty = (a) => !(a || []).some(Boolean);
    const copy = (a) => JSON.parse(JSON.stringify(a || Array(8).fill(null)));
    for (const { keep, drop } of list) {
      undo.keepers.push({ id: keep.id, before: { cues: copy(keep.cues), loops: copy(keep.loops), cueLoops: keep.cueLoops ? copy(keep.cueLoops) : null, rating: keep.rating || 0, plays: keep.plays || 0, lastPlayed: keep.lastPlayed || 0 } });
      for (const k of ['cues', 'loops', 'cueLoops']) {
        if (!empty(keep[k])) continue;
        const from = drop.filter(t => !empty(t[k])).sort((a, b) => b[k].filter(Boolean).length - a[k].filter(Boolean).length)[0];
        if (from) keep[k] = copy(from[k]);
      }
      keep.rating = Math.max(keep.rating || 0, ...drop.map(t => t.rating || 0));
      keep.plays = (keep.plays || 0) + drop.reduce((s, t) => s + (t.plays || 0), 0);
      keep.lastPlayed = Math.max(keep.lastPlayed || 0, ...drop.map(t => t.lastPlayed || 0));
    }
    // crates y Prepare: la conservada ocupa el sitio de la quitada (sin repetirse)
    const swap = (ids) => { const out = [], seen = new Set(); for (const i of ids) { const j = map.get(i) || i; if (!seen.has(j)) { seen.add(j); out.push(j); } } return out; };
    for (const c of this.crates) if (c.ids.some(i => map.has(i))) { const ids = c.ids.slice(); c.ids = swap(c.ids); undo.crates.push({ id: c.id, ids, after: c.ids.slice() }); }
    if (this.prepare.some(i => map.has(i))) { const ids = this.prepare.slice(); this.prepare = swap(this.prepare); undo.prepare = { ids, after: this.prepare.slice() }; }
    for (const h of this.history) h.entries.forEach((e, i) => { if (map.has(e.id)) { undo.history.push({ s: h.id, i, id: e.id }); e.id = map.get(e.id); } });
    undo.removed = this.remove([...map.keys()]);
    return undo;
  }
  // Deshace mergeDuplicates: vuelven las pistas quitadas (con todos sus datos), las crates, Prepare y el historial
  // como estaban, y la conservada recupera sus datos anteriores
  undoMerge(undo) {
    if (!undo || !this.guard('remove') || !this.guard('crateTracks')) return false;
    if (undo.removed) this.restoreRemoved(undo.removed);
    for (const k of undo.keepers) { const t = this.tracks.get(k.id); if (t) { Object.assign(t, k.before); if (!k.before.cueLoops) delete t.cueLoops; } }
    // contenido anterior; lo añadido después de resolver (que no estaba antes ni justo después) se conserva al final
    const back = (u, cur) => { const had = new Set([...u.ids, ...u.after]); return [...u.ids.filter(i => this.tracks.has(i)), ...cur.filter(i => !had.has(i))]; };
    for (const u of undo.crates) { const c = this.crate(u.id); if (c) c.ids = back(u, c.ids); }
    if (undo.prepare) this.prepare = back(undo.prepare, this.prepare);
    for (const u of undo.history) { const h = this.history.find(x => x.id === u.s); if (h && h.entries[u.i]) h.entries[u.i].id = u.id; }
    this.saveSoon(); this.emit('change');
    return true;
  }
  // «Limpiar biblioteca» → etiquetas: changes [{ id, patch }] → deshacer [{ id, before }] o false
  applyTagEdits(changes) {
    if (!this.guard('tags')) return false;
    const undo = [];
    for (const { id, patch } of changes) {
      const t = this.tracks.get(id);
      if (!t) continue;
      const before = {};
      for (const k of Object.keys(patch)) before[k] = t[k] === undefined ? null : t[k];
      undo.push({ id, before });
      Object.assign(t, patch);
    }
    this.saveSoon(); this.emit('change');
    return undo;
  }
  undoTagEdits(undo) {
    if (!undo || !this.guard('tags')) return false;
    for (const { id, before } of undo) { const t = this.tracks.get(id); if (t) for (const [k, v] of Object.entries(before)) { if (v === null) delete t[k]; else t[k] = v; } }
    this.saveSoon(); this.emit('change');
    return true;
  }

  // Relocalizar: cambia la ruta conservando el id (crates, Prepare, historial, formas de onda, stems,
  // cues y beatgrid siguen apuntando a la misma pista). moves: [{ id, path, size? }]
  relocate(moves) {
    let n = 0;
    for (const m of moves) {
      const t = this.tracks.get(m.id);
      if (!t || !m.path) continue;
      t.path = m.path;
      if (m.size) t.size = m.size;
      n++;
    }
    this._byPath = null;
    if (n) { this.saveSoon(); this.emit('change'); }
    return n;
  }

  // --- Crates
  // (las crates antiguas no tienen «created»: se ordenan por su posición, que es el orden en que se crearon)
  // Subcrates: crate.parent = id de la crate padre (null o ausente = raíz); ver crate-tree.js
  createCrate(name, parent = null) {
    if (!this.guard('crate')) return null;
    const c = this._newCrate(name, parent);
    this.saveSoon(); this.emit('change'); return c;
  }
  _newCrate(name, parent = null) {
    const c = { id: uid(), name, ids: [], created: Date.now(), parent: parent && this.crates.some(x => x.id === parent) ? parent : null };
    this.crates.push(c);
    return c;
  }
  // Carpetas soltadas o elegidas (árbol de folder-crates.js) sobre «target» (id de crate o null = raíz):
  // añade todas las pistas a la biblioteca y crea/reutiliza un subcrate por carpeta con sus pistas.
  // Con la biblioteca protegida solo se añaden a la biblioteca (y se avisa).
  // Devuelve { tracks, created: [crates], top: [crates de primer nivel], blocked }
  addFolderTree(tree, target = null) {
    const tracks = this.addFiles(treeFiles(tree));
    const pruned = pruneTree(tree);
    if (target && !this.crate(target)) target = null;
    const needs = pruned.dirs.length ? 'crate' : target && pruned.files.length ? 'crateTracks' : null;
    if (!needs) return { tracks, created: [], top: [], blocked: false };
    if (this.protected) { this.guard(needs); return { tracks, created: [], top: [], blocked: true }; }
    const plan = applyFolderTree(this.crates, pruned, target, { make: (n, p) => this._newCrate(n, p), idOf: (p) => { const t = this.byPath(p); return t ? t.id : null; } });
    for (const [cid, ids] of plan.assign) {
      const c = this.crate(cid);
      if (!c) continue;
      const have = new Set(c.ids);
      for (const i of ids) if (!have.has(i)) { have.add(i); c.ids.push(i); }
    }
    this.saveSoon(); this.emit('change');
    return { tracks, created: plan.created, top: plan.top, blocked: false };
  }
  crate(id) { return this.crates.find(c => c.id === id) || null; }
  renameCrate(id, name) { if (!this.guard('crate')) return; const c = this.crates.find(c => c.id === id); if (c) { c.name = name; this.saveSoon(); this.emit('change'); } }
  // mode 'all' = borra también los subcrates; 'lift' = los sube un nivel. Devuelve los ids borrados (o false)
  deleteCrate(id, mode = 'all') {
    if (!this.guard('crate')) return false;
    const plan = deletePlan(this.crates, id, mode);
    this.crates = plan.crates; this.saveSoon(); this.emit('change');
    return plan.removed;
  }
  setCrateColor(id, color) { if (!this.guard('crate')) return; const c = this.crates.find(c => c.id === id); if (c) { c.color = color || null; this.saveSoon(); this.emit('change'); } }
  // Convierte «id» en subcrate de «parent» (null = raíz), al final de ese nivel; nunca dentro de sí misma
  // ni de un descendiente (ciclos)
  setCrateParent(id, parent) {
    if (!this.guard('crate')) return false;
    parent = parent || null;
    if (!canMoveInto(this.crates, id, parent)) return false;
    const i = this.crates.findIndex(c => c.id === id);
    const [c] = this.crates.splice(i, 1);
    c.parent = parent;
    this.crates.push(c);
    this.saveSoon(); this.emit('change');
    return true;
  }
  // Orden personalizado: coloca la crate «id» delante (o detrás, after) de «refId», en el nivel de «refId»
  moveCrate(id, refId, after = false) {
    if (!this.guard('crate') || id === refId) return false;
    const ref = refId ? this.crate(refId) : null;
    const parent = ref ? parentId(this.crates, ref) : null;
    if (!canMoveInto(this.crates, id, parent)) return false;
    const i = this.crates.findIndex(c => c.id === id);
    if (i < 0) return false;
    const [c] = this.crates.splice(i, 1);
    c.parent = parent;
    const j = ref ? this.crates.indexOf(ref) : -1;
    if (j < 0) this.crates.push(c); else this.crates.splice(after ? j + 1 : j, 0, c);
    this.saveSoon(); this.emit('change');
    return true;
  }
  // Todas las crates en orden de árbol (cada nivel según «mode»); con depth para sangrar menús
  sortedCrates(mode = 'custom') { return flattenTree(this.crates, mode, null, true).map(x => x.c); }
  crateTree(mode = 'custom', collapsed = null, all = false) { return flattenTree(this.crates, mode, collapsed, all); }
  subcrateIds(id) { return descendantIds(this.crates, id); }
  // Pistas de la crate (ids): con subs (por defecto, el ajuste) también las de sus subcrates, sin duplicar
  crateTrackIds(id, subs = this.subTracks) { return crateTrackIds(this.crates, id, subs); }
  // Busca o crea la ruta de nombres [«Dance», «2024»] bajo «root»; con la biblioteca protegida no crea
  ensureCratePath(names, root = null) { return ensurePath(this.crates, names, (name, p) => this.createCrate(name, p), root); }
  cratesOf(id) { return this.crates.filter(c => c.ids.includes(id)); }
  addToCrate(id, ids) {
    if (!this.guard('crateTracks')) return false;
    const c = this.crates.find(c => c.id === id);
    if (!c) return false;
    for (const i of ids) if (!c.ids.includes(i)) c.ids.push(i);
    this.saveSoon(); this.emit('change');
    return true;
  }
  // Sustituye el contenido de una crate conservando el orden dado (listas importadas que se actualizan)
  setCrateIds(id, ids) {
    if (!this.guard('crateTracks')) return false;
    const c = this.crates.find(c => c.id === id);
    if (!c) return false;
    c.ids = [...new Set(ids)].filter(i => this.tracks.has(i));
    this.saveSoon(); this.emit('change');
    return true;
  }
  // Crate creada a partir de una lista de Spotify (crate.spotify.key = 'playlist:<id>')
  crateBySpotify(key) { return this.crates.find(c => c.spotify && c.spotify.key === key) || null; }
  // deep: quita también de los subcrates (en la vista de una crate padre que muestra sus pistas).
  // Devuelve lo necesario para deshacer ([{id, ids}] con el contenido anterior de cada crate tocada) o null
  removeFromCrate(id, ids, deep = false) {
    if (!this.guard('crateTracks')) return null;
    const c = this.crates.find(c => c.id === id);
    if (!c) return null;
    const drop = new Set(ids), undo = [];
    for (const x of [c, ...(deep ? descendantIds(this.crates, id).map(d => this.crate(d)) : [])]) {
      if (!x || !x.ids.some(i => drop.has(i))) continue;
      undo.push({ id: x.id, ids: x.ids.slice() });
      x.ids = x.ids.filter(i => !drop.has(i));
    }
    this.saveSoon(); this.emit('change');
    return undo;
  }
  // Deshacer removeFromCrate: vuelve al orden anterior (sin pistas ya borradas de la biblioteca) y
  // conserva al final las añadidas mientras tanto
  restoreCrates(undo) {
    if (!undo || !undo.length || !this.guard('crateTracks')) return false;
    for (const u of undo) {
      const c = this.crate(u.id);
      if (!c) continue;
      const old = u.ids.filter(i => this.tracks.has(i)), had = new Set(old);
      c.ids = [...old, ...c.ids.filter(i => !had.has(i))];
    }
    this.saveSoon(); this.emit('change');
    return true;
  }
  // Borra la lista (no sus vídeos). Devuelve lo necesario para restoreYtPlaylist ({ list, index }) o false
  deleteYtPlaylist(id) {
    if (!this.guard('crate')) return false;
    const index = this.ytPlaylists.findIndex(p => p.id === id);
    if (index < 0) return false;
    const list = this.ytPlaylists[index];
    this.ytPlaylists = this.ytPlaylists.filter(p => p !== list);
    this.saveSoon(); this.emit('change');
    return { list: { ...list, ids: list.ids.slice() }, index };
  }
  restoreYtPlaylist(undo) {
    if (!undo || !undo.list || !this.guard('crate') || this.ytPlaylists.some(p => p.id === undo.list.id)) return false;
    const list = { ...undo.list, ids: undo.list.ids.filter(i => this.tracks.has(i)) };
    this.ytPlaylists.splice(Math.min(undo.index, this.ytPlaylists.length), 0, list);
    this.saveSoon(); this.emit('change');
    return true;
  }
  // Todos los vídeos de YouTube de la biblioteca (vista «YouTube · todos los vídeos»)
  ytTrackIds() { return [...this.tracks.values()].filter(t => t.source === 'youtube').map(t => t.id); }
  // Vídeos de la lista que no están en otra lista de YouTube ni en ninguna crate
  ytPlaylistOrphans(id) {
    const p = this.ytPlaylists.find(x => x.id === id);
    if (!p) return [];
    const used = new Set();
    for (const x of this.ytPlaylists) if (x !== p) for (const i of x.ids) used.add(i);
    for (const c of this.crates) for (const i of c.ids) used.add(i);
    return [...new Set(p.ids)].filter(i => !used.has(i) && this.tracks.get(i)?.source === 'youtube');
  }
  // Borra la lista y sus vídeos sin otro uso (ytPlaylistOrphans). Devuelve { list, removed } para
  // restoreYtPlaylistWithVideos o false
  deleteYtPlaylistWithVideos(id) {
    if (!this.guard('crate') || !this.guard('remove')) return false;
    const ids = this.ytPlaylistOrphans(id);
    const list = this.deleteYtPlaylist(id);
    if (!list) return false;
    const removed = ids.length ? this.remove(ids) : null;
    return { list, removed };
  }
  restoreYtPlaylistWithVideos(undo) {
    if (!undo || !this.guard('crate') || !this.guard('remove')) return false;
    if (undo.removed) this.restoreRemoved(undo.removed);   // primero los vídeos: la lista solo conserva los que existen
    return this.restoreYtPlaylist(undo.list);
  }

  // --- Smart crates
  saveSmart(sc) {
    if (!this.guard('smart')) return false;
    const i = this.smart.findIndex(s => s.id === sc.id);
    if (i >= 0) this.smart[i] = sc; else this.smart.push({ ...sc, id: sc.id || uid() });
    this.saveSoon(); this.emit('change');
    return true;
  }
  deleteSmart(id) { if (!this.guard('smart')) return false; this.smart = this.smart.filter(s => s.id !== id); this.saveSoon(); this.emit('change'); return true; }
  matchRule(t, r) {
    let v = t[r.field];
    if (r.field === 'added') v = (Date.now() - (t.added || 0)) / 86400000;
    const num = parseFloat(v), a = parseFloat(r.value), b = parseFloat(r.value2);
    const s = String(v ?? '').toLowerCase(), q = String(r.value ?? '').toLowerCase();
    switch (r.op) {
      case 'contains': return s.includes(q);
      case 'notcontains': return !s.includes(q);
      case 'is': return s === q;
      case 'isnot': return s !== q;
      case 'gt': return num > a;
      case 'lt': return num < a;
      case 'between': return num >= Math.min(a, b) && num <= Math.max(a, b);
    }
    return false;
  }
  smartTracks(sc) {
    const all = [...this.tracks.values()];
    if (!sc.rules.length) return all;
    return all.filter(t => sc.match === 'any' ? sc.rules.some(r => this.matchRule(t, r)) : sc.rules.every(r => this.matchRule(t, r)));
  }

  // --- Prepare
  addToPrepare(ids) { for (const i of ids) if (!this.prepare.includes(i)) this.prepare.push(i); this.saveSoon(); this.emit('change'); }
  // Devuelve la lista anterior (para deshacer con restorePrepare)
  removeFromPrepare(ids) { const old = this.prepare.slice(); this.prepare = this.prepare.filter(i => !ids.includes(i)); this.saveSoon(); this.emit('change'); return old; }
  restorePrepare(old) {
    const had = new Set(old);
    this.prepare = [...old.filter(i => this.tracks.has(i)), ...this.prepare.filter(i => !had.has(i))];
    this.saveSoon(); this.emit('change');
  }

  // --- Historial
  logPlay(track, deck) {
    if (!this.session) {
      this.session = { id: uid(), date: Date.now(), entries: [] };
      this.history.push(this.session);
    }
    const last = this.session.entries[this.session.entries.length - 1];
    if (last && last.id === track.id) return;
    this.session.entries.push({ id: track.id, title: track.title, artist: track.artist, bpm: track.bpm, key: track.camelot, deck, time: Date.now() });
    track.plays = (track.plays || 0) + 1;
    track.lastPlayed = Date.now();
    this.saveSoon();
    this.emit('change');
  }
  // Pistas marcadas como tocadas en una sesión (por defecto la actual), sin las anteriores a un reinicio
  playedIds(sessionId = null) {
    const s = sessionId ? this.history.find(h => h.id === sessionId) : this.session;
    if (!s) return new Set();
    const from = s.resetAt || 0;
    return new Set(s.entries.filter(e => e.time > from).map(e => e.id));
  }
  // «Reiniciar pistas tocadas»: quita la marca de una sesión o de todas (el historial no se borra)
  resetPlayed(sessionId = null) {
    const now = Date.now();
    for (const h of this.history) if (!sessionId || h.id === sessionId) h.resetAt = now;
    this.saveSoon(); this.emit('change');
  }
  historyCsv(sessionId) {
    const s = this.history.find(h => h.id === sessionId);
    if (!s) return '';
    const rows = [['Hora', 'Deck', 'Artista', 'Título', 'BPM', 'Tonalidad']];
    for (const e of s.entries) rows.push([new Date(e.time).toLocaleTimeString(), e.deck + 1, e.artist, e.title, e.bpm || '', e.key || '']);
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  }

  // --- Consulta para la tabla
  view(viewId) {
    if (!viewId || viewId === 'all') return [...this.tracks.values()].filter(t => t.source === 'local');
    if (viewId === 'everything') return [...this.tracks.values()];
    if (viewId === 'prepare') return this.prepare.map(i => this.tracks.get(i)).filter(Boolean);
    if (viewId === 'yt-all') return [...this.tracks.values()].filter(t => t.source === 'youtube');
    const [kind, id] = viewId.split(':');
    if (kind === 'crate') return this.crateTrackIds(id).map(i => this.tracks.get(i)).filter(Boolean);
    if (kind === 'smart') { const s = this.smart.find(s => s.id === id); return s ? this.smartTracks(s) : []; }
    if (kind === 'yt') { const p = this.ytPlaylists.find(p => p.id === id); return p ? p.ids.map(i => this.tracks.get(i)).filter(Boolean) : []; }
    if (kind === 'history') {
      const h = this.history.find(h => h.id === id);
      return h ? h.entries.map(e => this.tracks.get(e.id)).filter(Boolean) : [];
    }
    return [];
  }

  query(viewId, search = '', sort = { field: null, dir: 1 }) {
    let list = this.view(viewId);
    const q = search.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/);
      list = list.filter(t => {
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.comment} ${t.key} ${t.camelot} ${t.year || ''} ${t.bpm ? Math.round(t.bpm) : ''}`.toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      });
    }
    if (sort && sort.field) {
      const f = sort.field, d = sort.dir;
      list = list.slice().sort((a, b) => {
        let x = a[f], y = b[f];
        if (f === 'camelot') { x = camelotSortKey(x); y = camelotSortKey(y); }
        if (f === 'explicit') { x = a.explicit ? 1 : 0; y = b.explicit ? 1 : 0; return (y - x) * d; }
        if (f === 'rating') { x = a.rating || 0; y = b.rating || 0; return (y - x) * d; }
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * d;
      });
    }
    return list;
  }
}

function camelotSortKey(c) {
  const m = /^(\d+)([AB])$/.exec(c || '');
  return m ? parseInt(m[1], 10) * 2 + (m[2] === 'B' ? 1 : 0) : null;
}
