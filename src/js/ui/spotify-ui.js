// Diálogo «+ Spotify»: lee una lista (solo metadatos), la empareja con la biblioteca local, permite
// buscar las que faltan en YouTube (reproductor oficial) o comprarlas, y crea/actualiza la crate en el
// orden original. Nunca se descarga ni se extrae audio de Spotify ni de YouTube.
import { el, fmtTime, toast } from '../util.js';
import { btn } from './controls.js';
import { parseYouTubeInput } from '../youtube/youtube.js';
import {
  parseSpotifyInput, spotifyUrl, matchList, crateIdsFrom, itemStatus, buyLinks, youtubeQuery, pickYouTubeResult
} from '../spotify/spotify-core.js';

const PAGE = 400;
const STATUS = {
  local: { ico: '✓', label: 'En tu música', cls: 'ok' },
  review: { ico: '?', label: 'Revisar', cls: 'review' },
  youtube: { ico: '▶', label: 'YouTube', cls: 'yt' },
  missing: { ico: '🛒', label: 'Comprar', cls: 'missing' }
};
const FILTERS = { all: 'Todas', review: 'Revisar', missing: 'Sin encontrar', local: 'En tu música', youtube: 'YouTube' };
// lo que se guarda en la crate para revisar o actualizar la importación más tarde
const slim = (it) => ({ key: it.key, uri: it.uri, title: it.title, artists: it.artists, duration: it.duration, isrc: it.isrc || '', local: it.local, yt: it.yt, manual: it.manual, conf: it.conf, score: it.score });

export class SpotifyImportUI {
  constructor(app) { this.app = app; }
  get lib() { return this.app.library; }

  // opts: { input, crateId (revisar o actualizar esa crate), refetch (volver a leer de Spotify) }
  open(opts = {}) {
    this.list = null; this.items = []; this.filter = 'all'; this.limit = PAGE; this.busy = false; this.stop = false;
    this.crate = opts.crateId ? this.lib.crates.find(c => c.id === opts.crateId) : null;
    const prevUrl = this.crate && this.crate.spotify ? this.crate.spotify.url : '';
    this.input = el('input', { class: 'wide sp-url', value: opts.input || prevUrl || '', placeholder: 'https://open.spotify.com/playlist/…  ·  spotify:playlist:…  (lista, álbum o canción)' });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.read(); } });
    this.readBtn = btn('Leer lista', { cls: 'small primary', onClick: () => this.read() });
    this.mineBtn = btn('Mis listas', { cls: 'small', title: 'Listas de tu cuenta de Spotify (Ajustes → Spotify)', onClick: () => this.mine() });
    this.status = el('div', { class: 'sp-status' });
    this.bar = el('div', { class: 'sp-bar' }, el('div'));
    this.result = el('div', { class: 'sp-result' });
    this.root = el('div', { class: 'sp-import' },
      el('p', { class: 'hint' }, 'Se leen solo los metadatos de la lista (título, artistas, duración, ISRC y carátula) y se buscan en tu música. No se descarga audio de Spotify ni de YouTube.'),
      el('div', { class: 'sp-in' }, this.input, this.readBtn, this.mineBtn),
      this.status, this.bar, this.result);
    this.app.modal('Importar lista de Spotify', this.root, ['Cerrar']).then(() => { this.stop = true; this.root = null; });
    this.app.spotify.status().then(s => { if (this.mineBtn) this.mineBtn.hidden = !s.connected; });
    if (this.crate && this.crate.spotify && !opts.refetch) this.showStored();
    else if (this.input.value && (opts.input || opts.refetch)) this.read();
    else setTimeout(() => this.input.focus(), 40);
  }

  setStatus(text, frac = null) {
    if (!this.root) return;
    this.status.textContent = text || '';
    this.bar.classList.toggle('on', frac != null);
    this.bar.firstChild.style.width = frac != null ? Math.round(Math.max(0.03, Math.min(1, frac)) * 100) + '%' : '0';
  }
  setBusy(on) { this.busy = on; if (this.readBtn) this.readBtn.disabled = on; }

  localTracks() { return [...this.lib.tracks.values()].filter(t => t.source === 'local'); }
  priorFor(key) { const c = this.lib.crateBySpotify(key); return c && c.spotify ? c.spotify.items || [] : []; }

  async read() {
    if (this.busy) return;
    const ref = parseSpotifyInput(this.input.value);
    if (!ref) {
      return this.setStatus(/spotify\.link|spoti\.fi/i.test(this.input.value)
        ? 'Los enlaces cortos (spotify.link) no se pueden leer: ábrelo en el navegador y copia el enlace completo de open.spotify.com.'
        : 'No reconozco ese enlace. Pega el enlace de una lista, álbum o canción de Spotify (Compartir → Copiar enlace).');
    }
    this.setBusy(true);
    this.setStatus('Leyendo la lista de Spotify…', 0.05);
    try {
      const list = await this.app.spotify.importList(ref, (p) => {
        if (p.phase === 'embed') this.setStatus('Leyendo la página pública de Spotify…', 0.3);
        else this.setStatus(`Leyendo la lista con tu cuenta… ${p.n}${p.total ? ' / ' + p.total : ''} pistas`, p.total ? p.n / p.total : 0.3);
      });
      if (!this.root) return;
      this.list = { ...list, key: `${list.type}:${list.id}`, url: spotifyUrl(list.type, list.id) };
      this.crate = this.lib.crateBySpotify(this.list.key);
      this.setStatus(`Buscando ${list.tracks.length} pistas en tu música…`, 0.9);
      await new Promise(r => setTimeout(r, 0));
      this.items = matchList(list.tracks, this.localTracks(), this.priorFor(this.list.key));
      this.setStatus(list.warning || '', null);
      this.renderResult();
    } catch (e) {
      this.setStatus(e.message, null);
    } finally { this.setBusy(false); }
  }

  // Revisar la importación guardada en la crate sin volver a leer Spotify
  showStored() {
    const sp = this.crate.spotify;
    this.list = { type: sp.type, id: sp.id, name: sp.name, owner: sp.owner || '', cover: sp.cover || '', key: sp.key, url: sp.url, source: sp.source, tracks: sp.items };
    this.items = matchList(sp.items, this.localTracks(), sp.items);
    this.setStatus(`Importada el ${new Date(sp.importedAt || Date.now()).toLocaleDateString('es-ES')}. «Leer lista» la vuelve a leer de Spotify y actualiza la crate.`);
    this.renderResult();
  }

  async mine() {
    if (this.busy) return;
    this.setBusy(true);
    this.setStatus('Leyendo tus listas de Spotify…', 0.2);
    try {
      const lists = await this.app.spotify.myPlaylists();
      this.setStatus(lists.length ? `${lists.length} listas en tu cuenta` : 'Tu cuenta no tiene listas', null);
      this.result.innerHTML = '';
      this.result.append(el('div', { class: 'yt-lists sp-mine' }, ...lists.map(l => el('div', { class: 'yt-list-row' },
        l.cover ? el('img', { src: l.cover, alt: '' }) : el('span'),
        el('div', {}, el('b', {}, l.name), el('small', {}, `${l.count} pistas${l.owner ? ' · ' + l.owner : ''}${this.lib.crateBySpotify('playlist:' + l.id) ? ' · ya importada' : ''}`)),
        btn('Importar', { cls: 'small', onClick: () => { this.input.value = spotifyUrl('playlist', l.id); this.read(); } })))));
    } catch (e) { this.setStatus(e.message, null); }
    finally { this.setBusy(false); }
  }

  counts() {
    const n = { local: 0, review: 0, youtube: 0, missing: 0 };
    for (const it of this.items) n[itemStatus(it)]++;
    return n;
  }

  renderResult() {
    if (!this.root) return;
    const L = this.lib, l = this.list, n = this.counts();
    const protectedLib = L.protected;
    const update = !!this.crate;
    this.result.innerHTML = '';
    const cover = l.cover ? el('img', { class: 'sp-cover', src: l.cover, alt: '' }) : el('div', { class: 'sp-cover' });
    if (l.cover) cover.addEventListener('error', () => cover.replaceWith(el('div', { class: 'sp-cover' })));
    const head = el('div', { class: 'sp-head' }, cover,
      el('div', { class: 'sp-meta' },
        el('b', {}, l.name || 'Lista de Spotify'),
        el('small', {}, [{ playlist: 'Lista', album: 'Álbum', track: 'Canción' }[l.type] || 'Lista', l.owner, `${this.items.length} pistas`, l.source === 'api' ? 'leída con tu cuenta' : l.source === 'embed' ? 'leída de la página pública' : ''].filter(Boolean).join(' · ')),
        el('div', { class: 'sp-counts' },
          ...Object.entries(STATUS).map(([k, s]) => el('span', { class: 'sp-count ' + s.cls, title: s.label }, `${s.ico} ${n[k]} ${s.label.toLowerCase()}`)))));
    const filter = el('select', { class: 'sel' }, ...Object.entries(FILTERS).map(([k, v]) => el('option', { value: k }, v)));
    filter.value = this.filter;
    filter.addEventListener('change', () => { this.filter = filter.value; this.limit = PAGE; this.renderRows(); });
    // las dudosas («Revisar») se deciden antes a mano: la búsqueda en bloque solo coge las que faltan
    const missing = this.items.filter(it => itemStatus(it) === 'missing');
    this.ytAllBtn = btn(this.ytRunning ? '■ Detener búsqueda' : `▶ Buscar en YouTube las que faltan (${missing.length})`, {
      cls: 'small', title: 'Busca cada pista en YouTube y elige el mejor resultado por título, artista y duración (evita directos, karaokes y versiones). Se reproducen con el reproductor oficial de YouTube.',
      onClick: () => (this.ytRunning ? (this.stop = true) : this.youtubeAll())
    });
    this.ytAllBtn.disabled = !missing.length && !this.ytRunning;
    const acceptAll = btn(`✓ Aceptar las dudosas (${n.review})`, { cls: 'small', title: 'Acepta la coincidencia más probable de las pistas marcadas «Revisar»', onClick: () => this.acceptReview() });
    acceptAll.disabled = !n.review;
    const tools = el('div', { class: 'sp-tools' }, el('span', {}, 'Mostrar'), filter, acceptAll, this.ytAllBtn);
    this.rowsEl = el('div', { class: 'sp-rows' });
    // destino: crate con el nombre de la lista (o la que ya existe) o Prepare
    this.toPrepare = el('input', { type: 'checkbox', class: 'switch' });
    this.toPrepare.checked = protectedLib;
    const ids = crateIdsFrom(this.items);
    const main = btn(protectedLib ? `Añadir a Prepare (${ids.length})` : update ? `Actualizar crate «${this.crate.name}» (${ids.length})` : `Crear crate «${l.name || 'Spotify'}» (${ids.length})`, {
      cls: 'primary', onClick: () => this.commit(protectedLib ? 'prepare' : 'crate')
    });
    main.disabled = !ids.length;
    const foot = el('div', { class: 'sp-foot' },
      protectedLib ? el('p', { class: 'set-note' }, 'La biblioteca está protegida 🔒: no se pueden crear ni cambiar crates. Puedes añadir las pistas encontradas a Prepare (o quitar el candado).')
        : el('label', { class: 'fb-check' }, this.toPrepare, 'Añadir también a Prepare (para el Automix)'),
      el('p', { class: 'hint' }, 'La crate queda en el orden de la lista con las pistas de tu música y las de YouTube que elijas. Volver a importar la misma lista actualiza la crate.'),
      el('div', { class: 'row' }, main));
    this.result.append(head, tools, this.rowsEl, foot);
    this.renderRows();
  }

  renderRows() {
    if (!this.rowsEl) return;
    this.rowsEl.innerHTML = '';
    const list = this.items.map((it, i) => ({ it, i })).filter(({ it }) => this.filter === 'all' || itemStatus(it) === this.filter);
    for (const { it, i } of list.slice(0, this.limit)) this.rowsEl.appendChild(this.row(it, i));
    if (list.length > this.limit) this.rowsEl.appendChild(btn(`Mostrar ${Math.min(PAGE, list.length - this.limit)} más…`, { cls: 'small', onClick: () => { this.limit += PAGE; this.renderRows(); } }));
    if (!list.length) this.rowsEl.appendChild(el('p', { class: 'hint' }, 'No hay pistas con este filtro.'));
  }

  trackLabel(id) {
    const t = this.lib.get(id);
    return t ? `${t.artist ? t.artist + ' – ' : ''}${t.title}${t.duration ? ' · ' + fmtTime(t.duration, false) : ''}` : '(pista no disponible)';
  }

  row(it, i) {
    const st = itemStatus(it), S = STATUS[st];
    const r = el('div', { class: 'sp-row ' + S.cls, dataset: { i: String(i) } });
    const info = el('div', { class: 'sp-track' },
      el('span', { class: 'sp-n' }, String(i + 1)),
      el('div', {}, el('b', {}, it.title), el('small', {}, (it.artists || []).join(', ') + (it.duration ? ' · ' + fmtTime(it.duration, false) : '') + (it.isrc ? ' · ISRC ' + it.isrc : ''))));
    const badge = el('span', { class: 'sp-badge ' + S.cls, title: S.label }, `${S.ico} ${S.label}`);
    const detail = el('div', { class: 'sp-detail' });
    const acts = el('div', { class: 'sp-acts' });
    if (it.local || it.cands.length) {
      const sel = el('select', { class: 'sel sp-cand', title: 'Pista de tu música que corresponde' },
        ...it.cands.map(c => el('option', { value: c.id }, `${c.isrc ? 'ISRC · ' : Math.round(c.score * 100) + ' % · '}${this.trackLabel(c.id)}`)),
        el('option', { value: '' }, 'Ninguna (no la tengo)'));
      sel.value = it.local || (st === 'review' ? it.cands[0].id : '');
      sel.addEventListener('change', () => this.setLocal(i, sel.value || null));
      detail.append(sel);
      if (st === 'review') acts.append(btn('✓ Es esta', { cls: 'micro', onClick: () => this.setLocal(i, sel.value || null) }));
    }
    if (it.yt && !it.local) {
      detail.append(el('small', { class: 'sp-yt' }, `▶ ${it.yt.title}${it.yt.channel ? ' · ' + it.yt.channel : ''}${it.yt.duration ? ' · ' + fmtTime(it.yt.duration, false) : ''}`));
      acts.append(btn('✕', { cls: 'micro', title: 'Quitar el vídeo de YouTube', onClick: () => { it.yt = null; this.changed(); } }));
    }
    if (!it.local && !it.yt) {
      acts.append(btn('▶ YouTube', { cls: 'micro', title: 'Buscar esta pista en YouTube', onClick: (e) => this.youtubeOne(i, e.currentTarget) }));
      acts.append(btn('🔗', { cls: 'micro', title: 'Pegar el enlace de un vídeo de YouTube', onClick: () => this.pasteLink(i, detail) }));
    }
    acts.append(btn('🛒', { cls: 'micro', title: 'Comprar: buscar en Beatport, Bandcamp o iTunes', onClick: (e) => this.app.contextMenu(e, buyLinks(it).map(b => ({ label: 'Buscar en ' + b.label, fn: () => this.app.platform.openExternal(b.url) }))) }));
    r.append(info, badge, detail, acts);
    return r;
  }

  setLocal(i, id) {
    const it = this.items[i];
    it.local = id; it.manual = true; it.conf = id ? 'high' : 'none';
    if (id) it.yt = null;
    this.changed();
  }
  acceptReview() {
    for (const it of this.items) if (!it.local && it.conf === 'review' && it.cands.length) { it.local = it.cands[0].id; it.manual = true; it.conf = 'high'; it.yt = null; }
    this.changed();
  }
  // redibuja conservando la posición del scroll del diálogo
  changed() {
    const box = this.root && this.root.closest('.modal-body'), y = box ? box.scrollTop : 0;
    this.renderResult();
    if (box) box.scrollTop = y;
  }

  // Pegar un enlace de YouTube a mano (funciona sin clave de API: título por oEmbed)
  pasteLink(i, host) {
    const inp = el('input', { class: 'wide', placeholder: 'https://www.youtube.com/watch?v=…' });
    const ok = async () => {
      const { videoId } = parseYouTubeInput(inp.value);
      if (!videoId) return toast('Pega el enlace de un vídeo de YouTube', 'warn');
      try {
        const [v] = await this.app.youtube.videosInfo([videoId]);
        this.items[i].yt = v || { videoId, title: videoId, channel: '' };
        this.changed();
      } catch (e) { toast(e.message, 'error'); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok(); } });
    host.innerHTML = '';
    host.append(el('div', { class: 'sp-paste' }, inp, btn('OK', { cls: 'micro', onClick: ok })));
    inp.focus();
  }

  async ytReady() {
    if (await this.app.youtube.canSearch()) return true;
    this.setStatus('Buscar en YouTube necesita una clave de API de YouTube o tu cuenta de Google conectada (Ajustes → YouTube; la guía del README explica cómo crear la clave). Sin ella puedes pegar el enlace del vídeo con 🔗.');
    return false;
  }
  async findYouTube(it) {
    const results = await this.app.youtube.search(youtubeQuery(it));
    const best = pickYouTubeResult(it, results);
    return best ? best.item : null;
  }
  async youtubeOne(i, b) {
    if (!(await this.ytReady())) return;
    if (b) b.disabled = true;
    try {
      const v = await this.findYouTube(this.items[i]);
      if (v) { this.items[i].yt = v; this.changed(); }
      else { toast('No hay un resultado de YouTube fiable para esta pista: prueba con 🔗', 'warn'); if (b) b.disabled = false; }
    } catch (e) { toast(e.message, 'error', 6000); if (b) b.disabled = false; }
  }
  // En bloque, de una en una (cada búsqueda gasta cuota de la API de YouTube: ~100 búsquedas al día con una clave gratuita)
  async youtubeAll() {
    if (!(await this.ytReady())) return;
    const todo = this.items.filter(it => itemStatus(it) === 'missing');
    this.ytRunning = true; this.stop = false;
    this.renderResult();
    let found = 0, k = 0;
    try {
      for (const it of todo) {
        if (this.stop || !this.root) break;
        this.setStatus(`Buscando en YouTube ${++k}/${todo.length}: ${(it.artists || [])[0] || ''} – ${it.title}`, k / todo.length);
        const v = await this.findYouTube(it);
        if (v) { it.yt = v; found++; }
      }
      this.setStatus(`YouTube: ${found} de ${k} encontradas${k < todo.length ? ' (búsqueda detenida)' : ''}.`);
    } catch (e) {
      this.setStatus(`YouTube: ${found} encontradas. Se detuvo la búsqueda: ${e.message}`);
    } finally {
      this.ytRunning = false;
      if (this.root) this.renderResult();
    }
  }

  // Crear o actualizar la crate (o añadir a Prepare) en el orden de la lista
  commit(dest) {
    const L = this.lib, l = this.list;
    const yt = this.items.filter(it => !it.local && it.yt).map(it => it.yt);
    if (yt.length) L.addYouTubeItems(yt, null);
    const ids = crateIdsFrom(this.items).filter(id => L.get(id));
    if (!ids.length) return toast('No hay pistas que añadir: no se encontró ninguna en tu música ni en YouTube', 'warn');
    const prepare = dest === 'prepare' || (this.toPrepare && this.toPrepare.checked);
    let crate = null;
    if (dest === 'crate') {
      const meta = { key: l.key, type: l.type, id: l.id, name: l.name, owner: l.owner || '', cover: l.cover || '', url: l.url, source: l.source || '', importedAt: Date.now(), items: this.items.map(slim) };
      crate = L.crateBySpotify(l.key);
      if (crate) { if (!L.setCrateIds(crate.id, ids)) return; }
      else {
        crate = L.createCrate((l.name || 'Spotify').slice(0, 80));
        if (!crate) return;
        L.setCrateIds(crate.id, ids);
      }
      crate.spotify = meta;
      L.saveSoon();
    }
    if (prepare) L.addToPrepare(ids);
    const missing = this.items.filter(it => !it.local && !it.yt).length;
    this.app.closeModal();
    this.app.showInSetOrder(crate ? 'crate:' + crate.id : 'prepare');
    this.app.libraryUI.setView(crate ? 'crate:' + crate.id : 'prepare');
    toast(`${ids.length} pistas ${crate ? `en la crate «${crate.name}»` : 'añadidas a Prepare'}${prepare && crate ? ' y en Prepare' : ''}${missing ? ` · ${missing} sin encontrar (🛒 para comprarlas)` : ''}`, missing ? 'warn' : 'ok', 6000);
    return { crate, ids };
  }
}
