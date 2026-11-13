// «Limpiar biblioteca» (app.cleanupUI): diálogo grande con 4 pestañas — Duplicados · Etiquetas · Calidad ·
// Historial de cambios. El análisis de los archivos va en el proceso principal (main/cleanup-scan.js, en un hilo
// aparte y con caché); aquí se calculan los resultados (library/cleanup-core.js), se aplican los cambios con su
// deshacer (library.mergeDuplicates / applyTagEdits) y se guarda el historial en data/limpieza.json.
// Antes de aplicar nada: comprobación de «Proteger biblioteca» y copia de seguridad de la biblioteca.
import { el, uid } from '../util.js';
import { btn } from './controls.js';
import { platform } from '../platform.js';
import * as C from '../library/cleanup-core.js';

const PAGE = 40;
const MAX_OPS = 30;
const TABS = [['dups', 'Duplicados'], ['tags', 'Etiquetas'], ['quality', 'Calidad'], ['history', 'Historial de cambios']];
const PHASE = { leer: 'Leyendo los archivos', huella: 'Buscando archivos iguales', comprobar: 'Comprobando los archivos iguales' };
const CONF_TEXT = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const fmtDate = (t) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const dirOf = (p) => String(p || '').split(/[\\/]/).slice(0, -1).join('\\');
const fileOf = (p) => String(p || '').split(/[\\/]/).pop();

export class CleanupUI {
  constructor(app) {
    this.app = app;
    this.isOpen = false;
    this.tab = 'dups';
    this.scope = 'all';
    this.state = 'idle';              // idle | scanning | done | cancelled | error
    this.records = new Map();         // id de pista → lo leído del archivo
    this.online = new Map();          // id → mejor coincidencia de internet (o { none: true })
    this.ops = null;                  // historial de cambios (se carga al abrir)
    this.dupKind = 'exact'; this.dupSel = new Set(); this.keepChoice = new Map(); this.dupShown = PAGE;
    this.tagFilter = 'proposals'; this.picks = new Map(); this.tagShown = PAGE;
    this.qFilter = null; this.qShown = PAGE;
    this.covers = new Map();
    this.progress = null;
    platform.cleanup.onEvent((ev) => this.onEvent(ev));
    // mientras suena algo (o se graba) el análisis va a baja prioridad
    setInterval(() => this.updatePriority(), 1000);
  }
  get L() { return this.app.library; }

  // ------------------------------------------------------------ abrir / cerrar
  async open(scope = null) {
    if (!platform.cleanup.available) {
      return this.app.modal('Limpiar biblioteca', el('p', {}, '«Limpiar biblioteca» necesita leer tus archivos de música: solo está disponible en la app de escritorio.'));
    }
    if (this.ops === null) await this.loadOps();
    const v = this.app.libraryUI ? this.app.libraryUI.viewId : 'all';
    const want = scope || (this.viewScopeOk(v) ? v : 'all');
    if (this.isOpen) { this.render(); return; }
    this.isOpen = true;
    this.build();
    // si el análisis sigue en marcha (se cerró el diálogo sin cancelar) se ve su progreso
    if (this.state === 'scanning') { this.render(); return; }
    if (want !== this.scope || this.state === 'idle' || this.stale()) { this.scope = want; this.scopeSel.value = want; this.analyze(); }
    else { this.compute(); this.render(); }
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener('keydown', this.onKey, true);
    this.ov.remove();
    this.ov = null;
  }
  viewScopeOk(v) { return !!v && !['all', 'everything', 'yt-all', 'ai:next'].includes(v) && !v.startsWith('yt:') && this.L.view(v).some(t => t.source === 'local'); }
  viewLabel(v) {
    const L = this.L, [kind, id] = v.split(':');
    if (v === 'prepare') return 'Prepare';
    if (kind === 'crate') return this.app.libraryUI ? this.app.libraryUI.crateLabel(L.crate(id)) : (L.crate(id) || {}).name;
    if (kind === 'smart') return (L.smart.find(s => s.id === id) || {}).name || 'Smart crate';
    if (kind === 'history') return 'Historial';
    return v;
  }
  scopeTracks() { return (this.scope === 'all' ? [...this.L.tracks.values()] : this.L.view(this.scope)).filter(t => t.source === 'local'); }
  // la biblioteca ha cambiado desde el último análisis (pistas nuevas o quitadas)
  stale() { const ts = this.scopeTracks(); return ts.length !== this._n || ts.some(t => !this.records.has(t.id)); }

  build() {
    const close = btn('✕', { cls: 'micro', title: 'Cerrar (Esc)', onClick: () => this.close() });
    close.setAttribute('aria-label', 'Cerrar');
    const opts = { all: `Toda la biblioteca (${this.L.view('all').length} pistas)` };
    const v = this.app.libraryUI ? this.app.libraryUI.viewId : 'all';
    if (this.viewScopeOk(v)) opts[v] = `Lo abierto: «${this.viewLabel(v)}» (${this.L.view(v).filter(t => t.source === 'local').length} pistas)`;
    if (this.scope !== 'all' && !opts[this.scope] && this.viewScopeOk(this.scope)) opts[this.scope] = `«${this.viewLabel(this.scope)}»`;
    this.scopeSel = el('select', { class: 'sel cl-scope', 'aria-label': 'Qué revisar' }, ...Object.entries(opts).map(([k, l]) => el('option', { value: k }, l)));
    this.scopeSel.value = opts[this.scope] ? this.scope : 'all';
    this.scopeSel.addEventListener('change', () => { this.scope = this.scopeSel.value; this.analyze(); });
    this.statusEl = el('div', { class: 'cl-status', role: 'status', 'aria-live': 'polite' });
    this.tabsEl = el('div', { class: 'cl-tabs', role: 'tablist' });
    this.body = el('div', { class: 'cl-body', role: 'tabpanel' });
    const box = el('div', { class: 'modal cleanup', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Limpiar biblioteca' },
      el('div', { class: 'modal-head cl-head' }, el('h2', {}, 'Limpiar biblioteca'), el('label', { class: 'cl-scope-l' }, el('span', {}, 'Revisar:'), this.scopeSel), close),
      this.statusEl, this.tabsEl, this.body);
    this.ov = el('div', { class: 'modal-ov cl-ov' }, box);
    this.ov.addEventListener('pointerdown', (e) => { if (e.target === this.ov) this.close(); });
    this.onKey = (e) => { if (e.key === 'Escape' && !this.app._modal && !document.querySelector('.ctx')) { e.stopPropagation(); this.close(); } };
    document.addEventListener('keydown', this.onKey, true);
    document.body.appendChild(this.ov);
  }

  // ------------------------------------------------------------ análisis
  async analyze() {
    if (this.state === 'scanning') return;
    const tracks = this.scopeTracks();
    this.state = 'scanning';
    this.progress = { phase: 'leer', done: 0, total: tracks.length };
    this.render();
    this.updatePriority(true);
    let res;
    try { res = await platform.cleanup.scan(tracks.map(t => ({ id: t.id, path: t.path }))); }
    catch (e) { this.state = 'error'; this.error = e.message; this.render(); return; }
    for (const r of res.records) this.records.set(r.id, r);
    this.lastStats = { ...res.stats, n: res.records.length };
    this.state = res.cancelled ? 'cancelled' : 'done';
    this._n = tracks.length;
    this.progress = null;
    this.compute();
    this.render();
  }
  async cancel() { await platform.cleanup.cancel(); }
  onEvent(ev) {
    if (!ev) return;
    if (ev.t === 'progress') { this.progress = ev; if (this.isOpen) this.renderStatus(); }
    if (ev.t === 'online') { this.onlineProgress = ev; if (this.isOpen) this.renderStatus(); }
    if (ev.t === 'write') { this.writeProgress = ev.done < ev.total ? ev : null; if (this.isOpen) this.renderStatus(); }
  }
  updatePriority(force = false) {
    if (this.state !== 'scanning' && !force) return;
    const busy = this.app.decks.some(d => d.playing) || !!(this.app.engine && this.app.engine.recording) || !!(this.app.autoplay && this.app.autoplay.enabled) || !!(this.app.automix && this.app.automix.enabled);
    if (busy !== this._busy || force) { this._busy = busy; platform.cleanup.priority(busy ? 'low' : 'normal'); }
  }

  compute() {
    const L = this.L, tracks = this.scopeTracks();
    const items = tracks.map(t => ({ track: t, rec: this.records.get(t.id) })).filter(x => x.rec);
    const crates = new Map();
    for (const c of L.crates) for (const i of c.ids) crates.set(i, (crates.get(i) || 0) + 1);
    this.items = items;
    this.dups = C.findDuplicates(items, { crateCount: (id) => crates.get(id) || 0 });
    for (const g of this.dups.groups) if (!this.keepChoice.has(g.id) || !g.members.some(m => m.id === this.keepChoice.get(g.id))) this.keepChoice.set(g.id, g.keep);
    const all = [...L.tracks.values()].filter(t => t.source === 'local');
    this.tagRows = C.reviewTags(items, { allTracks: all, online: this.online });
    this.tagById = new Map(this.tagRows.map(r => [r.id, r]));
    this.qRows = C.reviewQuality(items);
    // casillas de etiquetas: se conservan las que siguen teniendo sentido
    for (const k of [...this.picks.keys()]) { const [id, f] = k.split('|'); const r = this.tagById.get(id); if (!r || (f !== 'cover' && !r.fields[f] && !this.picks.get(k).manual)) this.picks.delete(k); }
  }

  // ------------------------------------------------------------ dibujo
  render() {
    if (!this.isOpen) return;
    this.renderStatus();
    const counts = {
      dups: this.dups ? this.dups.groups.length : null,
      tags: this.tagRows ? this.tagRows.filter(r => Object.keys(r.fields).length || r.cover).length : null,
      quality: this.qRows ? this.qRows.length : null,
      history: (this.ops || []).filter(o => !o.undone).length
    };
    this.tabsEl.replaceChildren(...TABS.map(([k, label]) => {
      const b = el('button', { type: 'button', class: 'cl-tab' + (this.tab === k ? ' on' : ''), role: 'tab', 'aria-selected': String(this.tab === k), dataset: { tab: k } }, label, counts[k] != null ? el('span', { class: 'cl-n' }, String(counts[k])) : null);
      b.addEventListener('click', () => { this.tab = k; this.render(); });
      return b;
    }));
    const scroll = this.body.scrollTop;
    const keepScroll = this._keepScroll;
    this._keepScroll = false;
    if (this.tab === 'history') this.body.replaceChildren(this.historyPanel());
    else if (!this.dups) this.body.replaceChildren(el('p', { class: 'cl-empty' }, this.state === 'scanning' ? 'Analizando tus archivos… Puedes seguir pinchando mientras tanto: si suena música, el análisis va más despacio para no molestar.' : 'Pulsa «Analizar» para empezar.'));
    else if (this.tab === 'dups') this.body.replaceChildren(this.dupsPanel());
    else if (this.tab === 'tags') this.body.replaceChildren(this.tagsPanel());
    else this.body.replaceChildren(this.qualityPanel());
    if (keepScroll) this.body.scrollTop = scroll;
  }
  rerender() { this._keepScroll = true; this.render(); }

  renderStatus() {
    if (!this.statusEl) return;
    this.scopeSel.disabled = this.state === 'scanning';
    const p = this.progress, on = this.onlineProgress && this.onlineBusy ? this.onlineProgress : null;
    const parts = [];
    let pct = null;
    if (this.state === 'scanning') {
      const label = p ? PHASE[p.phase] || 'Analizando' : 'Preparando';
      parts.push(el('span', {}, `${label}… ${p ? `${p.done} de ${p.total}` : ''}${p && p.cached ? ` · ${p.cached} ya analizados antes` : ''}${this._busy ? ' · a baja velocidad mientras suena música' : ''}`));
      pct = p && p.total ? (p.phase === 'leer' ? 0 : p.phase === 'huella' ? 70 : 85) + (p.done / p.total) * (p.phase === 'leer' ? 70 : 15) : 0;
      parts.push(btn('Cancelar', { cls: 'small', title: 'Detener el análisis (lo hecho se guarda y la próxima vez sigue por aquí)', onClick: () => this.cancel() }));
    } else if (this.writeProgress) {
      const wp = this.writeProgress;
      parts.push(el('span', {}, `Guardando las etiquetas en los archivos… ${wp.done} de ${wp.total}`));
      pct = (wp.done / wp.total) * 100;
    } else if (on) {
      parts.push(el('span', {}, `Buscando en internet… ${on.done} de ${on.total} (1 consulta por segundo)`));
      pct = on.total ? (on.done / on.total) * 100 : 0;
      parts.push(btn('Cancelar', { cls: 'small', onClick: () => this.cancel() }));
    } else if (this.state === 'cancelled') {
      parts.push(el('span', {}, `Análisis detenido: resultados parciales (${this.items ? this.items.length : 0} de ${this.scopeTracks().length} pistas).`));
      parts.push(btn('Reanudar', { cls: 'small primary', title: 'Sigue por donde iba: lo ya analizado no se repite', onClick: () => this.analyze() }));
    } else if (this.state === 'error') {
      parts.push(el('span', { class: 'cl-err' }, 'No se pudo analizar: ' + this.error));
      parts.push(btn('Reintentar', { cls: 'small', onClick: () => this.analyze() }));
    } else if (this.state === 'done') {
      // tras resolver o deshacer se recalcula sin volver a leer: el tiempo y la caché ya no vienen al caso
      const s = this.lastStats && this.lastStats.n === (this.items ? this.items.length : 0) ? this.lastStats : {};
      const secs = s.ms == null ? '' : s.ms < 1000 ? ' en menos de 1 s' : ` en ${(s.ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
      parts.push(el('span', {}, `${plural(this.items ? this.items.length : 0, 'pista revisada', 'pistas revisadas')}${secs}${s.cached ? ` (${s.cached} sin cambios desde la última vez: no hace falta volver a leerlas)` : ''}. Solo se revisan archivos de tu ordenador (los vídeos de YouTube no).`));
      parts.push(btn('Analizar de nuevo', { cls: 'small', onClick: () => this.analyze() }));
    } else parts.push(btn('Analizar', { cls: 'small primary', onClick: () => this.analyze() }));
    const bar = el('div', { class: 'cl-bar' + (pct != null ? ' on' : '') }, el('div', { style: { width: (pct || 0).toFixed(1) + '%' } }));
    this.statusEl.replaceChildren(el('div', { class: 'cl-st-row' }, ...parts), bar);
  }

  // ------------------------------------------------------------ Duplicados
  dupsPanel() {
    const D = this.dups;
    const exact = D.groups.filter(g => g.kind === 'exact'), same = D.groups.filter(g => g.kind === 'same');
    const chip = (k, label, n) => { const b = el('button', { type: 'button', class: 'cl-chip' + (this.dupKind === k ? ' on' : ''), 'aria-pressed': String(this.dupKind === k), dataset: { k } }, label, el('span', { class: 'cl-n' }, String(n))); b.addEventListener('click', () => { this.dupKind = k; this.dupShown = PAGE; this.rerender(); }); return b; };
    const head = el('div', { class: 'cl-intro' },
      el('p', {}, 'Canciones que tienes repetidas. Te proponemos qué copia conservar (la de mejor calidad, luego la que tiene más datos en Nexura y luego la que está mejor ordenada); puedes elegir otra. Al resolver, la otra copia se quita de Nexura y sus cues, crates, valoración, reproducciones e historial pasan a la que conservas.'),
      el('div', { class: 'cl-chips' }, chip('exact', 'Exactos', exact.length), chip('same', 'Misma canción en otra calidad', same.length), chip('versions', 'Versiones (solo informa)', D.versions.length)));
    if (this.dupKind === 'versions') return el('div', {}, head, this.versionsList());
    const list = this.dupKind === 'exact' ? exact : same;
    if (!list.length) return el('div', {}, head, el('p', { class: 'cl-empty' }, this.dupKind === 'exact' ? 'No hay archivos exactamente iguales. 👍' : 'No hay la misma canción repetida en otra calidad. 👍'));
    const selN = list.filter(g => this.dupSel.has(g.id)).length;
    if (this.trashOn == null) this.trashOn = this.app.settings.cleanupTrash !== false;
    const trash = el('input', { type: 'checkbox', class: 'cl-trash' });
    trash.checked = this.trashOn;
    trash.addEventListener('change', () => { this.trashOn = trash.checked; this.app.setSetting('cleanupTrash', trash.checked); });
    const tools = el('div', { class: 'cl-actions' },
      el('label', { class: 'cl-check' }, trash, el('span', {}, 'Mover también los archivos a la Papelera de Windows', el('small', {}, 'No se borran del todo: puedes recuperarlos desde la Papelera o con «Deshacer».'))),
      el('div', { class: 'cl-btns' },
        btn('Seleccionar todos', { cls: 'small', onClick: () => { list.forEach(g => this.dupSel.add(g.id)); this.rerender(); } }),
        btn('Ninguno', { cls: 'small', onClick: () => { list.forEach(g => this.dupSel.delete(g.id)); this.rerender(); } }),
        this.resolveBtn = btn(`Resolver los seleccionados (${selN})`, { cls: 'small primary cl-resolve-sel', onClick: () => this.resolve(list.filter(g => this.dupSel.has(g.id)).map(g => g.id)) })));
    this.resolveBtn.disabled = !selN;
    const shown = list.slice(0, this.dupShown);
    return el('div', {}, head, tools, el('div', { class: 'cl-list' }, ...shown.map(g => this.groupCard(g))), this.more(list.length, this.dupShown, () => { this.dupShown += PAGE; this.rerender(); }));
  }
  groupCard(g) {
    const keep = this.keepChoice.get(g.id) || g.keep;
    const keeper = g.members.find(m => m.id === keep);
    const sel = el('input', { type: 'checkbox', 'aria-label': 'Seleccionar el grupo ' + g.title });
    sel.checked = this.dupSel.has(g.id);
    sel.addEventListener('change', () => { if (sel.checked) this.dupSel.add(g.id); else this.dupSel.delete(g.id); this.rerender(); });
    const why = keep === g.keep ? `Propuesta: ${g.why.charAt(0).toLowerCase() + g.why.slice(1)}` : 'Has elegido otra copia';
    const rows = g.members.slice().sort((a, b) => (a.id === g.keep ? -1 : b.id === g.keep ? 1 : b.q.score - a.q.score)).map(m => {
      const radio = el('input', { type: 'radio', name: 'k-' + g.id, value: m.id });
      radio.checked = m.id === keep;
      radio.addEventListener('change', () => { this.keepChoice.set(g.id, m.id); this.rerender(); });
      const same = keeper && m.id !== keep && m.hash && m.hash === keeper.hash;
      const open = el('button', { type: 'button', class: 'link cl-path', title: 'Mostrar en la carpeta' }, dirOf(m.path));
      open.addEventListener('click', (e) => { e.preventDefault(); platform.showItem(m.path); });
      return el('label', { class: 'cl-mem' + (m.id === keep ? ' keep' : ' drop') },
        radio,
        el('span', { class: 'cl-mem-main' }, el('b', {}, fileOf(m.path)), open),
        el('span', { class: 'cl-mem-meta' },
          el('span', { class: 'cl-q' + (m.q.lossless ? ' ll' : m.q.kbps && m.q.kbps < 192 ? ' low' : '') }, m.q.label),
          el('span', {}, C.fmtDur(m.rec.dur || m.track.duration)),
          el('span', { class: 'cl-data' }, C.nexuraLabel(m.data))),
        el('span', { class: 'cl-badge ' + (m.id === keep ? 'ok' : 'warn') }, m.id === keep ? 'Se conserva' : same ? 'Se quita · mismo audio' : 'Se quita'));
    });
    return el('div', { class: 'cl-group', dataset: { g: g.id } },
      el('div', { class: 'cl-g-head' }, sel, el('div', { class: 'cl-g-title' }, el('b', {}, g.title), el('small', {}, `${g.kind === 'exact' ? 'Mismo audio' : 'Misma canción'} · ${plural(g.members.length, 'copia', 'copias')} · ${why}`)),
        btn('Resolver', { cls: 'small cl-resolve', title: 'Conservar la copia marcada y quitar las demás', onClick: () => this.resolve([g.id]) })),
      el('div', { class: 'cl-mems', role: 'radiogroup', 'aria-label': 'Copia que se conserva' }, ...rows));
  }
  versionsList() {
    const V = this.dups.versions;
    if (!V.length) return el('p', { class: 'cl-empty' }, 'No hay versiones distintas de una misma canción.');
    return el('div', {},
      el('p', { class: 'hint' }, 'Remezclas, versiones extendidas, directos o acústicas de la misma canción. No son duplicados: no se toca nada, es solo para que lo sepas.'),
      el('div', { class: 'cl-list' }, ...V.slice(0, this.dupShown).map(g => el('div', { class: 'cl-group ver' },
        el('div', { class: 'cl-g-head' }, el('div', { class: 'cl-g-title' }, el('b', {}, g.title), el('small', {}, plural(g.members.length, 'versión', 'versiones')))),
        el('div', { class: 'cl-mems' }, ...g.members.map(m => el('div', { class: 'cl-mem' },
          el('span', { class: 'cl-mem-main' }, el('b', {}, m.label), el('span', { class: 'cl-path' }, fileOf(m.path))),
          el('span', { class: 'cl-mem-meta' }, el('span', {}, C.fmtDur(m.dur)), el('span', {}, C.quality(m.rec).label)))))))),
      this.more(V.length, this.dupShown, () => { this.dupShown += PAGE; this.rerender(); }));
  }
  more(total, shown, fn) {
    if (total <= shown) return null;
    return el('div', { class: 'cl-more' }, btn(`Mostrar más (${total - shown} más)`, { cls: 'small', onClick: fn }));
  }

  // Resolver grupos: conservar la marcada, fusionar sus datos y quitar las demás (y a la Papelera si se pide)
  async resolve(ids) {
    const L = this.L;
    const groups = ids.map(id => this.dups.groups.find(g => g.id === id)).filter(Boolean);
    if (!groups.length) return;
    if (!L.guard('remove') || !L.guard('crateTracks')) return;
    const plan = groups.map(g => { const keep = this.keepChoice.get(g.id) || g.keep; return { keep, drop: g.members.map(m => m.id).filter(id => id !== keep) }; });
    const n = plan.reduce((s, p) => s + p.drop.length, 0);
    const trash = this.trashOn !== false;
    const ok = await this.app.modal('Resolver duplicados', el('div', { class: 'cl-confirm' },
      el('p', {}, `Se conservará una copia de ${plural(groups.length, 'canción', 'canciones')} y se quitarán ${plural(n, 'pista', 'pistas')} de la biblioteca.`),
      el('p', {}, trash ? `Sus ${plural(n, 'archivo irá', 'archivos irán')} a la Papelera de Windows (no se borran del todo).` : 'Los archivos se quedan en el disco.'),
      el('p', { class: 'hint' }, 'Los cues, crates, valoración, reproducciones e historial pasan a la copia que conservas. Antes se hace una copia de seguridad de la biblioteca y lo puedes deshacer en «Historial de cambios».')), ['Cancelar', 'Resolver']);
    if (ok !== 1) return;
    if (!await this.safetyBackup()) return;
    const titles = groups.map(g => g.title);
    const undo = L.mergeDuplicates(plan);
    if (!undo) return;
    const paths = (undo.removed && undo.removed.tracks || []).map(t => t.path);
    let trashed = [];
    if (trash && paths.length) {
      try { trashed = await platform.cleanup.trash(paths); } catch (e) { this.app.toast('No se pudieron mover a la Papelera: ' + e.message, 'error', 7000); }
    }
    for (const id of plan.flatMap(p => p.drop)) { this.records.delete(id); this.app.bufferCache.delete(id); }
    for (const g of groups) this.dupSel.delete(g.id);
    const op = {
      id: uid(), kind: 'dups', date: Date.now(), groups: groups.length, removed: n, titles: titles.slice(0, 6),
      trashed: trashed.filter(r => r.ok).map(r => r.path), trashFailed: trashed.filter(r => !r.ok).map(r => ({ path: r.path, error: r.error })),
      undo: compactUndo(undo)
    };
    await this.addOp(op);
    this._n = this.scopeTracks().length;
    this.compute(); this.rerender();
    const t = op.trashed.length;
    this.app.toast(`${plural(groups.length, 'duplicado resuelto', 'duplicados resueltos')} · ${plural(n, 'pista quitada', 'pistas quitadas')}${trash ? ` · ${plural(t, 'archivo', 'archivos')} en la Papelera` : ''}`, op.trashFailed.length ? 'warn' : 'ok', 7000, { label: 'Deshacer', fn: () => this.undo(op.id) });
    if (op.trashFailed.length) this.app.toast(`${plural(op.trashFailed.length, 'archivo no se pudo', 'archivos no se pudieron')} mover a la Papelera (siguen en su carpeta): ${op.trashFailed[0].error}`, 'warn', 8000);
  }

  // ------------------------------------------------------------ Etiquetas
  tagsPanel() {
    const rows = this.tagRows;
    const withProp = rows.filter(r => Object.keys(r.fields).length || r.cover);
    const counts = {};
    for (const r of rows) for (const i of r.issues) counts[i] = (counts[i] || 0) + 1;
    const chip = (k, label, n) => { const b = el('button', { type: 'button', class: 'cl-chip' + (this.tagFilter === k ? ' on' : ''), 'aria-pressed': String(this.tagFilter === k), dataset: { k } }, label, el('span', { class: 'cl-n' }, String(n))); b.addEventListener('click', () => { this.tagFilter = k; this.tagShown = PAGE; this.rerender(); }); return b; };
    const list = this.tagFilter === 'proposals' ? withProp : rows.filter(r => r.issues.includes(this.tagFilter));
    const high = this.highKeys();
    const nSel = this.selectedChanges().length;
    const needOnline = list.filter(r => !this.online.has(r.id) && this.wantsOnline(r)).length;
    if (this.writeOn == null) this.writeOn = this.app.settings.cleanupWriteFiles !== false;
    const write = el('input', { type: 'checkbox', class: 'cl-write' });
    write.checked = this.writeOn;
    write.addEventListener('change', () => { this.writeOn = write.checked; this.app.setSetting('cleanupWriteFiles', write.checked); });
    const onlineBtn = btn(needOnline ? `Buscar en internet (${needOnline})` : 'Buscar en internet', { cls: 'small cl-online', title: 'Busca artista, título, año, estilo y carátula en bases de datos libres de música. Una consulta por segundo: solo se envían el artista y el título.', onClick: () => this.lookupOnline(list) });
    onlineBtn.disabled = !needOnline || this.onlineBusy || this.state === 'scanning';
    const applyBtn = btn(`Aplicar los cambios marcados (${nSel})`, { cls: 'small primary cl-apply', onClick: () => this.applyTags() });
    applyBtn.disabled = !nSel;
    const highBtn = btn(`Marcar las de confianza alta (${high.length})`, { cls: 'small cl-high', onClick: () => { for (const k of high) { const [id, f] = k.split('|'); const r = this.tagById.get(id); this.picks.set(k, { on: true, value: f === 'cover' ? r.cover.releaseId : r.fields[f].val }); } this.rerender(); } });
    highBtn.disabled = !high.length;
    const head = el('div', { class: 'cl-intro' },
      el('p', {}, 'Pistas con etiquetas que faltan o están sucias (nombre, artista, año, estilo, carátula). Para cada una te proponemos un valor y te decimos de dónde sale y cuánto nos fiamos. Marca lo que quieras cambiar (o escríbelo tú) y pulsa «Aplicar».'),
      el('div', { class: 'cl-chips' }, chip('proposals', 'Con propuestas', withProp.length),
        ...Object.keys(C.ISSUE_LABEL).filter(k => counts[k]).map(k => chip(k, C.ISSUE_LABEL[k], counts[k]))));
    const tools = el('div', { class: 'cl-actions' },
      el('label', { class: 'cl-check' }, write, el('span', {}, 'Guardar también en el archivo', el('small', {}, 'Solo en MP3 y FLAC (las demás, como WAV o M4A, solo cambian en Nexura). Antes se guarda una copia de las etiquetas originales; el sonido no se toca.'))),
      el('div', { class: 'cl-btns' }, onlineBtn, highBtn, applyBtn));
    if (!list.length) return el('div', {}, head, tools, el('p', { class: 'cl-empty' }, this.tagFilter === 'proposals' ? 'No hay propuestas: tus etiquetas están en orden. 👍' : 'Nada en este apartado.'));
    return el('div', {}, head, tools, el('div', { class: 'cl-list' }, ...list.slice(0, this.tagShown).map(r => this.tagCard(r))),
      this.more(list.length, this.tagShown, () => { this.tagShown += PAGE; this.rerender(); }));
  }
  wantsOnline(r) { return r.issues.some(i => ['noArtist', 'noTitle', 'generic', 'mismatch', 'noYear', 'noGenre', 'noCover'].includes(i)); }
  highKeys() {
    const out = [];
    for (const r of this.tagRows) {
      for (const [f, p] of Object.entries(r.fields)) if (p.conf === 'alta') out.push(r.id + '|' + f);
      if (r.cover && r.cover.conf === 'alta') out.push(r.id + '|cover');
    }
    return out;
  }
  tagCard(r) {
    const t = this.L.get(r.id), rec = this.records.get(r.id);
    if (!t) return null;
    const fields = Object.keys(C.FIELD_LABEL).filter(f => f !== 'cover' && (r.fields[f] || (f === 'year' && r.issues.includes('noYear')) || (f === 'genre' && r.issues.includes('noGenre')) || (f === 'artist' && r.issues.includes('noArtist')) || (f === 'title' && (r.issues.includes('noTitle') || r.issues.includes('generic')))));
    const fileTags = rec && rec.tags;
    const rowsEls = fields.map(f => {
      const key = r.id + '|' + f, p = r.fields[f], pick = this.picks.get(key);
      const box = el('input', { type: 'checkbox', 'aria-label': `Cambiar ${C.FIELD_LABEL[f].toLowerCase()}` });
      box.checked = !!(pick && pick.on);
      const inp = el('input', { type: 'text', class: 'cl-val', value: pick ? pick.value : (p ? p.val : ''), placeholder: p ? '' : 'Escríbelo si lo sabes', 'aria-label': `${C.FIELD_LABEL[f]} nuevo` });
      box.addEventListener('change', () => { this.picks.set(key, { on: box.checked, value: inp.value, manual: !p || inp.value !== p.val }); this.refreshTagCounts(); });
      inp.addEventListener('input', () => { box.checked = !!inp.value.trim(); this.picks.set(key, { on: box.checked, value: inp.value, manual: true }); this.refreshTagCounts(); });
      const cur = String(t[f] ?? '').trim();
      const noFile = fileTags && !String(fileTags[f] || '').trim() && cur;
      return el('div', { class: 'cl-field' },
        box, el('span', { class: 'cl-f-name' }, C.FIELD_LABEL[f]),
        el('span', { class: 'cl-f-cur' + (cur ? '' : ' empty') }, cur || '(vacío)', noFile ? el('small', {}, 'el archivo no lo tiene') : null),
        el('span', { class: 'cl-arrow', 'aria-hidden': 'true' }, '→'), inp,
        p ? el('span', { class: 'cl-conf ' + p.conf, title: 'Origen: ' + p.src }, CONF_TEXT[p.conf], el('small', {}, p.src)) : el('span', { class: 'cl-conf none' }, 'Sin propuesta'));
    });
    if (r.cover) {
      const key = r.id + '|cover', pick = this.picks.get(key);
      const box = el('input', { type: 'checkbox', 'aria-label': 'Añadir la carátula' });
      box.checked = !!(pick && pick.on);
      box.addEventListener('change', () => { this.picks.set(key, { on: box.checked, value: r.cover.releaseId }); this.refreshTagCounts(); });
      const img = el('img', { class: 'cl-cover', alt: 'Carátula propuesta', width: 56, height: 56 });
      this.loadCover(r.cover.releaseId, img);
      rowsEls.push(el('div', { class: 'cl-field' }, box, el('span', { class: 'cl-f-name' }, 'Carátula'), el('span', { class: 'cl-f-cur empty' }, '(sin carátula)'), el('span', { class: 'cl-arrow', 'aria-hidden': 'true' }, '→'), img,
        el('span', { class: 'cl-conf ' + r.cover.conf, title: 'Origen: internet' }, CONF_TEXT[r.cover.conf], el('small', {}, 'internet'))));
    }
    const on = this.online.get(r.id);
    return el('div', { class: 'cl-tag', dataset: { id: r.id } },
      el('div', { class: 'cl-t-head' }, el('div', { class: 'cl-g-title' }, el('b', {}, fileOf(t.path)), el('small', {}, dirOf(t.path))),
        el('div', { class: 'cl-issues' }, ...r.issues.map(i => el('span', { class: 'cl-badge' }, C.ISSUE_LABEL[i])), on && on.none ? el('span', { class: 'cl-badge dim' }, 'no está en internet') : null)),
      rowsEls.length ? el('div', { class: 'cl-fields' }, ...rowsEls) : el('p', { class: 'hint' }, 'Sin propuestas. ' + (r.issues.includes('noCover') ? 'Prueba «Buscar en internet» para buscar la carátula.' : '')));
  }
  async loadCover(id, img) {
    if (this.covers.has(id)) { const u = this.covers.get(id); if (u) img.src = u; else img.classList.add('none'); return; }
    const u = await platform.cleanup.cover(id).catch(() => null);
    this.covers.set(id, u);
    if (u) img.src = u; else img.classList.add('none');
  }
  refreshTagCounts() {
    const n = this.selectedChanges().length;
    const b = this.body.querySelector('.cl-apply');
    if (b) { b.textContent = `Aplicar los cambios marcados (${n})`; b.disabled = !n; }
  }
  // Cambios marcados por pista: [{ id, patch: { campo: valor }, cover: releaseId | null }]
  selectedChanges() {
    const by = new Map();
    for (const [k, p] of this.picks) {
      if (!p.on) continue;
      const [id, f] = k.split('|');
      if (!this.L.get(id)) continue;
      const v = String(p.value ?? '').trim();
      const c = by.get(id) || { id, patch: {}, cover: null };
      if (f === 'cover') c.cover = v || null;
      else { if (!v) continue; c.patch[f] = f === 'year' ? (C.yearOf(v) || v) : v; }
      by.set(id, c);
    }
    return [...by.values()].filter(c => Object.keys(c.patch).length || c.cover);
  }
  async lookupOnline(list) {
    const rows = list.filter(r => !this.online.has(r.id) && this.wantsOnline(r));
    const queries = [];
    for (const r of rows) { const t = this.L.get(r.id); const q = t && C.lookupQuery(t, r); if (q) queries.push({ key: r.id, ...q }); else this.online.set(r.id, { none: true, reason: 'sin nombre' }); }
    if (!queries.length) { this.app.toast('Para buscar en internet hace falta saber al menos el artista y el título', 'info', 5000); this.compute(); this.rerender(); return; }
    this.onlineBusy = true;
    this.onlineProgress = { done: 0, total: queries.length };
    this.rerender();
    let res;
    try { res = await platform.cleanup.lookup(queries); }
    catch (e) { res = { results: {}, offline: true }; }
    this.onlineBusy = false;
    let found = 0;
    for (const q of queries) {
      const r = res.results[q.key];
      if (!r) continue;
      const t = this.L.get(q.key), rec = this.records.get(q.key);
      const best = C.bestOnline(r.items, { artist: q.artist, title: q.title, dur: (rec && rec.dur) || (t && t.duration) || 0 }, r.artistTags);
      this.online.set(q.key, best || { none: true });
      if (best) found++;
    }
    if (res.offline) this.app.toast('No hay conexión a internet (o el servicio no responde): solo se muestran las propuestas de tu biblioteca.', 'warn', 7000);
    else this.app.toast(`Internet: ${found} de ${queries.length} pistas encontradas`, found ? 'ok' : 'info', 5000);
    this.compute(); this.rerender();
  }

  async applyTags() {
    const L = this.L;
    const changes = this.selectedChanges();
    if (!changes.length) return;
    if (!L.guard('tags')) return;
    const write = this.writeOn !== false;
    const writable = write ? changes.filter(c => /\.(mp3|flac)$/i.test(L.get(c.id).path)) : [];
    const coverOnlyNexura = changes.filter(c => c.cover && !writable.includes(c)).length;
    const ok = await this.app.modal('Aplicar cambios de etiquetas', el('div', { class: 'cl-confirm' },
      el('p', {}, `Se cambiarán las etiquetas de ${plural(changes.length, 'pista', 'pistas')} en Nexura.`),
      write ? el('p', {}, writable.length ? `También se guardarán en ${plural(writable.length, 'archivo', 'archivos')} (MP3/FLAC). Antes se guarda una copia de sus etiquetas originales; el sonido no se toca.` : 'Ninguna es MP3 ni FLAC: solo se cambian en Nexura.') : el('p', {}, 'Los archivos no se tocan.'),
      coverOnlyNexura ? el('p', { class: 'hint' }, `${plural(coverOnlyNexura, 'carátula', 'carátulas')} no se pueden guardar (solo se guardan en archivos MP3/FLAC).`) : null,
      el('p', { class: 'hint' }, 'Antes se hace una copia de seguridad de la biblioteca y lo puedes deshacer en «Historial de cambios».')), ['Cancelar', 'Aplicar']);
    if (ok !== 1) return;
    if (!await this.safetyBackup()) return;
    const opId = uid().replace(/[^a-z0-9]/gi, '');
    const nexura = changes.filter(c => Object.keys(c.patch).length);
    const undo = L.applyTagEdits(nexura.map(c => ({ id: c.id, patch: c.patch })));
    if (!undo) return;
    let files = [];
    if (writable.length) {
      try { files = await platform.cleanup.writeTags(opId, writable.map(c => ({ id: c.id, path: L.get(c.id).path, fields: c.patch, cover: c.cover }))); }
      catch (e) { this.app.toast('No se pudieron guardar las etiquetas en los archivos: ' + e.message, 'error', 8000); }
      this.writeProgress = null;
    }
    for (const f of files.filter(x => x.ok)) {
      const t = L.get(f.id), rec = this.records.get(f.id);
      if (t && f.size) t.size = f.size;
      if (rec) { rec.tags = { ...(rec.tags || {}), ...changes.find(c => c.id === f.id).patch, cover: !!((rec.tags && rec.tags.cover) || f.cover) }; }
      if (f.cover && this.app.libraryUI) this.app.libraryUI.art.delete(f.id);
    }
    // sin escribir en el archivo, lo de Nexura pasa a ser lo «del archivo» para no volver a proponerlo
    for (const c of nexura) { const rec = this.records.get(c.id); if (rec && !files.some(f => f.id === c.id && f.ok)) rec.tags = { ...(rec.tags || {}), ...c.patch }; }
    for (const c of changes) for (const k of [...this.picks.keys()]) if (k.startsWith(c.id + '|')) this.picks.delete(k);
    const failed = files.filter(x => !x.ok);
    const op = {
      id: opId, kind: 'tags', date: Date.now(), tracks: changes.length, titles: changes.slice(0, 6).map(c => fileOf(L.get(c.id).path)),
      files: files.filter(x => x.ok).map(x => ({ id: x.id, path: x.path, backup: x.backup, cover: x.cover })), failed: failed.map(x => ({ path: x.path, error: x.error })), undo
    };
    await this.addOp(op);
    L.saveSoon();
    this.compute(); this.rerender();
    if (this.app.libraryUI) this.app.libraryUI.refresh();
    this.app.toast(`Etiquetas cambiadas en ${plural(changes.length, 'pista', 'pistas')}${writable.length ? ` · ${op.files.length} de ${writable.length} ${writable.length === 1 ? 'archivo' : 'archivos'} guardados` : ''}`, failed.length ? 'warn' : 'ok', 7000, { label: 'Deshacer', fn: () => this.undo(op.id) });
    if (failed.length) this.app.modal('Algunos archivos no se han podido guardar', el('div', {},
      el('p', {}, `En ${plural(failed.length, 'archivo', 'archivos')} el cambio se ha hecho solo en Nexura:`),
      el('ul', { class: 'cl-fail' }, ...failed.slice(0, 12).map(f => el('li', {}, el('b', {}, fileOf(f.path)), ' — ', f.error)))));
  }

  // ------------------------------------------------------------ Calidad
  qualityPanel() {
    const rows = this.qRows, counts = {};
    for (const r of rows) for (const i of r.issues) counts[i] = (counts[i] || 0) + 1;
    const keys = Object.keys(C.QUALITY_LABEL).filter(k => counts[k]);
    if (!this.qFilter || !counts[this.qFilter]) this.qFilter = keys[0] || null;
    const head = el('div', { class: 'cl-intro' }, el('p', {}, 'Archivos que conviene revisar. Aquí no se cambia nada: solo te avisamos y puedes crear una crate con ellos para ocuparte después.'));
    if (!keys.length) return el('div', {}, head, el('p', { class: 'cl-empty' }, 'Todos los archivos están bien. 👍'));
    const chip = (k) => { const b = el('button', { type: 'button', class: 'cl-chip' + (this.qFilter === k ? ' on' : ''), 'aria-pressed': String(this.qFilter === k), dataset: { k } }, C.QUALITY_LABEL[k], el('span', { class: 'cl-n' }, String(counts[k]))); b.addEventListener('click', () => { this.qFilter = k; this.qShown = PAGE; this.rerender(); }); return b; };
    const list = rows.filter(r => r.issues.includes(this.qFilter));
    const tracks = list.map(r => this.L.get(r.id)).filter(Boolean);
    const tools = el('div', { class: 'cl-actions' }, el('p', { class: 'hint cl-qhint' }, C.QUALITY_HINT[this.qFilter]),
      el('div', { class: 'cl-btns' },
        this.qFilter === 'missing' ? btn('Relocalizar…', { cls: 'small', title: 'Buscar los archivos que se han movido en otra carpeta o disco', onClick: async () => { await this.app.relocateMissing(tracks); this.analyze(); } }) : null,
        btn(`Crear crate con estas pistas (${tracks.length})`, { cls: 'small primary cl-crate', onClick: () => this.crateFrom(tracks, C.QUALITY_LABEL[this.qFilter]) })));
    return el('div', {}, head, el('div', { class: 'cl-chips' }, ...keys.map(chip)), tools,
      el('div', { class: 'cl-list cl-qlist' }, ...tracks.slice(0, this.qShown).map(t => {
        const rec = this.records.get(t.id), q = C.quality(rec);
        return el('div', { class: 'cl-qrow', dataset: { id: t.id } },
          el('span', { class: 'cl-mem-main' }, el('b', {}, fileOf(t.path)), el('span', { class: 'cl-path' }, dirOf(t.path))),
          el('span', { class: 'cl-mem-meta' }, el('span', { class: 'cl-q' + (q.kbps && q.kbps < 192 ? ' low' : '') }, rec && rec.missing ? 'No existe' : q.label), el('span', {}, C.fmtDur((rec && rec.dur) || t.duration)),
            rec && rec.damaged ? el('span', { class: 'cl-err' }, rec.damaged) : null));
      })), this.more(tracks.length, this.qShown, () => { this.qShown += PAGE; this.rerender(); }));
  }
  crateFrom(tracks, label) {
    const L = this.L;
    if (!tracks.length || !L.guard('crate')) return;
    const c = L.createCrate(`Revisar · ${label}`);
    if (!c) return;
    L.addToCrate(c.id, tracks.map(t => t.id));
    this.app.toast(`Crate «${c.name}» creada con ${plural(tracks.length, 'pista', 'pistas')}`, 'ok', 6000, { label: 'Abrir', fn: () => { this.close(); this.app.libraryUI.setView('crate:' + c.id); } });
  }

  // ------------------------------------------------------------ Historial de cambios / deshacer
  async loadOps() {
    const d = await platform.storeGet('limpieza').catch(() => null);
    this.ops = (d && Array.isArray(d.ops)) ? d.ops : [];
  }
  async saveOps() { await platform.storeSet('limpieza', { version: 1, ops: this.ops.slice(0, MAX_OPS) }); }
  async addOp(op) { if (this.ops === null) await this.loadOps(); this.ops.unshift(op); this.ops = this.ops.slice(0, MAX_OPS); await this.saveOps(); }
  opTitle(o) {
    if (o.kind === 'dups') return `Duplicados resueltos: ${plural(o.groups, 'canción', 'canciones')}, ${plural(o.removed, 'pista quitada', 'pistas quitadas')}${o.trashed.length ? `, ${plural(o.trashed.length, 'archivo', 'archivos')} a la Papelera` : ''}`;
    return `Etiquetas cambiadas: ${plural(o.tracks, 'pista', 'pistas')}${o.files.length ? `, ${plural(o.files.length, 'archivo guardado', 'archivos guardados')}` : ' (solo en Nexura)'}`;
  }
  historyPanel() {
    const ops = this.ops || [];
    const head = el('div', { class: 'cl-intro' }, el('p', {}, 'Todo lo que has cambiado con esta herramienta. «Deshacer» lo deja como estaba: devuelve las pistas a la biblioteca con sus datos, los archivos desde la Papelera y las etiquetas originales a los archivos.'),
      el('p', { class: 'hint' }, 'Antes de cada cambio se guarda una copia de seguridad de la biblioteca (Ajustes → Biblioteca → Copias de seguridad).'));
    if (!ops.length) return el('div', {}, head, el('p', { class: 'cl-empty' }, 'Todavía no has hecho cambios con esta herramienta.'));
    return el('div', {}, head, el('div', { class: 'cl-list' }, ...ops.map(o => el('div', { class: 'cl-op' + (o.undone ? ' undone' : ''), dataset: { op: o.id } },
      el('div', { class: 'cl-g-title' }, el('b', {}, this.opTitle(o)), el('small', {}, fmtDate(o.date) + (o.titles && o.titles.length ? ' · ' + o.titles.join(', ') + (o.groups > o.titles.length || o.tracks > o.titles.length ? '…' : '') : ''))),
      o.undone
        ? el('span', { class: 'cl-badge dim' }, 'Deshecho el ' + fmtDate(o.undone) + (o.undoNote ? ' · ' + o.undoNote : ''))
        : btn('Deshacer', { cls: 'small cl-undo', onClick: () => this.undo(o.id) })))));
  }
  async undo(id) {
    if (this.ops === null) await this.loadOps();
    const o = this.ops.find(x => x.id === id);
    if (!o || o.undone) return;
    const L = this.L;
    let note = '', missing = [];
    if (o.kind === 'dups') {
      if (!L.undoMerge(o.undo)) return;
      if (o.trashed.length) {
        let res = [];
        try { res = await platform.cleanup.restoreTrash(o.trashed); } catch (e) { res = o.trashed.map(p => ({ path: p, ok: false })); }
        missing = res.filter(r => !r.ok).map(r => r.path);
        const back = res.filter(r => r.how === 'restored').length;
        note = `${plural(back, 'archivo devuelto', 'archivos devueltos')} desde la Papelera` + (missing.length ? `, ${missing.length} sin encontrar` : '');
      }
    } else {
      if (!L.guard('tags')) return;
      let res = [];
      if (o.files.length) { try { res = await platform.cleanup.restoreTags(o.files); } catch (e) { res = o.files.map(f => ({ ...f, ok: false, error: e.message })); } }
      L.undoTagEdits(o.undo);
      for (const r of res.filter(x => x.ok)) { const t = L.get(r.id); if (t && r.size) t.size = r.size; if (this.app.libraryUI) this.app.libraryUI.art.delete(r.id); }
      const bad = res.filter(r => !r.ok);
      note = o.files.length ? `${res.length - bad.length} de ${o.files.length} archivos con sus etiquetas originales` : '';
      if (bad.length) missing = bad.map(r => `${r.path} — ${r.error}`);
      // lo leído de esos archivos ya no vale
      for (const f of o.files) this.records.delete(f.id);
      for (const u of o.undo) this.records.delete(u.id);
    }
    o.undone = Date.now(); o.undoNote = note;
    await this.saveOps();
    L.saveSoon();
    if (this.app.libraryUI) this.app.libraryUI.refresh();
    this.app.toast('Cambio deshecho' + (note ? ': ' + note : ''), missing.length ? 'warn' : 'ok', 7000);
    if (missing.length && o.kind === 'dups') {
      this.app.modal('Algunos archivos no están en la Papelera', el('div', {},
        el('p', {}, `Las pistas han vuelto a la biblioteca, pero ${plural(missing.length, 'archivo no se ha', 'archivos no se han')} encontrado en la Papelera (quizá la vaciaste o se restauraron a mano).`),
        el('p', { class: 'hint' }, 'Si siguen ahí: abre la «Papelera de reciclaje» del escritorio, busca el archivo, clic derecho → «Restaurar». Si no aparecen, usa «Relocalizar» en la pestaña Calidad.'),
        el('ul', { class: 'cl-fail' }, ...missing.slice(0, 12).map(p => el('li', {}, p)))));
    } else if (missing.length) {
      this.app.modal('Algunos archivos no se han podido devolver', el('div', {}, el('p', {}, 'En Nexura todo ha vuelto a como estaba, pero estos archivos conservan las etiquetas nuevas:'), el('ul', { class: 'cl-fail' }, ...missing.slice(0, 12).map(p => el('li', {}, p)))));
    }
    if (this.isOpen) { if (this.stale()) this.analyze(); else { this.compute(); this.rerender(); } }
  }

  // Copia de seguridad de la biblioteca justo antes de aplicar (la de Ajustes → Biblioteca)
  async safetyBackup() {
    if (!platform.backup.available) return true;   // navegador (pruebas): sin copias
    try {
      await this.L.save();
      await platform.backup.create('limpieza');
      return true;
    } catch (e) {
      const r = await this.app.modal('No se pudo hacer la copia de seguridad', el('p', {}, `${e.message} ¿Quieres seguir sin copia? Podrás deshacer el cambio igualmente en «Historial de cambios».`), ['Cancelar', 'Seguir sin copia']);
      return r === 1;
    }
  }
}

// El deshacer de «quitar de la biblioteca» trae el orden de las 40.000 pistas: para guardarlo en el historial basta
// con la pista que iba delante de cada una (library.restoreRemoved lo entiende)
export function compactUndo(u) {
  if (!u || !u.removed || !u.removed.order) return u;
  const pos = new Map(u.removed.order.map((id, i) => [id, i]));
  const tracks = u.removed.tracks.slice().sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  const prev = {};
  for (const t of tracks) { const i = pos.get(t.id); prev[t.id] = i > 0 ? u.removed.order[i - 1] : null; }
  return { ...u, removed: { ...u.removed, order: null, tracks, prev } };
}
