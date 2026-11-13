// Capa de plataforma: usa el puente de Electron (window.nexura) y, si no existe
// (modo navegador para pruebas), recurre a APIs web equivalentes.
import { treeFromRelPaths } from './library/folder-crates.js';

const N = window.nexura;
export const isDesktop = !!(N && N.isDesktop);

const webFiles = new Map();
const webWaves = new Map();
const webLog = [];
// shared/anonymize.js no es un módulo ES (también lo carga el proceso principal con require): deja la API
// en globalThis.nexuraAnonymize
async function webAnonymizer() {
  if (!globalThis.nexuraAnonymize) await import('./shared/anonymize.js');
  return globalThis.nexuraAnonymize;
}
// Igual con shared/yt-search.js (búsqueda de YouTube y errores de la Data API) → globalThis.nexuraYtSearch
async function webYtSearch() {
  if (!globalThis.nexuraYtSearch) await import('./shared/yt-search.js');
  return globalThis.nexuraYtSearch;
}
let webServices = null;
async function webSearchUrl() {
  if (window.__nexuraServices) return window.__nexuraServices.searchUrl || '';
  if (!webServices) webServices = await fetch('config/servicios.json').then(r => r.json()).catch(() => ({}));
  return /^https?:\/\//.test(webServices.searchUrl || '') ? webServices.searchUrl : '';
}
function webInstallId() {
  let id = localStorage.getItem('nexura_instalacion_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('nexura_instalacion_id', id); }
  return id;
}

function webInfo(file) {
  const id = 'web:' + file.name + ':' + file.size;
  webFiles.set(id, file);
  const base = file.name.replace(/\.[^.]+$/, '');
  const parts = base.split(' - ');
  return {
    path: id, size: file.size, mtime: file.lastModified,
    title: parts.length > 1 ? parts.slice(1).join(' - ') : base,
    artist: parts.length > 1 ? parts[0] : ''
  };
}

function pickWeb(dir) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'audio/*';
    if (dir) inp.webkitdirectory = true;
    inp.onchange = () => resolve([...inp.files].filter(f => /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm)$/i.test(f.name)).map(webInfo));
    inp.click();
  });
}

const AUDIO_RE = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm)$/i;
const byName = (a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });

// Navegador: carpeta soltada (FileSystemDirectoryEntry) → { name, files, dirs }
async function webEntryTree(dir, depth = 0) {
  const node = { name: dir.name, files: [], dirs: [] };
  if (depth > 12) return node;
  const reader = dir.createReader(), entries = [];
  for (;;) {
    const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
    if (!batch.length) break;
    entries.push(...batch);
  }
  for (const e of entries.sort(byName)) {
    if (e.isDirectory) { if (!e.name.startsWith('.')) node.dirs.push(await webEntryTree(e, depth + 1)); }
    else if (AUDIO_RE.test(e.name)) { const f = await new Promise((res) => e.file(res, () => res(null))); if (f) node.files.push(webInfo(f)); }
  }
  return node;
}

// Navegador: «+ Carpeta» con webkitdirectory → árbol por webkitRelativePath
function pickWebTree() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.webkitdirectory = true;
    inp.onchange = () => resolve(treeFromRelPaths([...inp.files].filter(f => AUDIO_RE.test(f.name))
      .sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath, 'es', { numeric: true, sensitivity: 'base' }))
      .map(f => ({ rel: f.webkitRelativePath || f.name, info: webInfo(f) }))));
    inp.click();
  });
}

export const platform = {
  async info() {
    if (N) return N.info();
    return { version: 'web', name: 'Nexura DJ Studio', platform: 'web', recordings: '(descargas)' };
  },
  async storeGet(name) {
    if (N) return N.storeGet(name);
    try { return JSON.parse(localStorage.getItem('nexura_' + name)); } catch (_) { return null; }
  },
  async storeSet(name, data) {
    if (N) return N.storeSet(name, data);
    try { localStorage.setItem('nexura_' + name, JSON.stringify(data)); } catch (_) { /* cuota */ }
    return true;
  },
  async readFile(p) {
    if (N) return N.readFile(p);
    const f = webFiles.get(p);
    if (!f) throw new Error('El archivo ya no está disponible en esta sesión del navegador');
    return new Uint8Array(await f.arrayBuffer());
  },
  async exists(p) { if (N) return N.exists(p); return webFiles.has(p); },
  // Archivos perdidos por lotes: [true/false] o null si no se puede comprobar (navegador)
  async existsMany(paths) { if (N && N.existsMany) return N.existsMany(paths); return null; },
  // Listas .m3u / .m3u8: [{ path, name, data }] o null
  async openPlaylist() {
    if (N && N.openPlaylist) return N.openPlaylist();
    return new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = '.m3u,.m3u8';
      inp.onchange = async () => resolve(inp.files.length ? await Promise.all([...inp.files].map(async f => ({ path: f.name, name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))) : null);
      inp.click();
    });
  },
  // Lista o archivo soltado: bytes y ruta (en el navegador solo el nombre)
  async playlistFromFile(file) {
    const p = N && N.pathForFile ? N.pathForFile(file) : null;
    return { path: p || file.name, name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
  },
  // Relocalizar: elegir carpeta y buscar archivos por nombre → { dir, files: [{path, size}] } o null
  async findFiles(names) {
    if (N && N.findFiles) return N.findFiles(names);
    throw new Error('Relocalizar archivos solo está disponible en la app de escritorio');
  },
  // Carátula en miniatura (data: URL) o null
  async artGet(id, p) { if (N && N.artGet) return N.artGet(id, p); return null; },
  async openFiles() { if (N) return N.openFiles(); return pickWeb(false); },
  async openFolder() { if (N) return N.openFolder(); return pickWeb(true); },
  // «+ Carpeta» conservando la estructura: { files: [], dirs: [árbol] } o null
  async openFolderTree() { if (N && N.openFolderTree) return N.openFolderTree(); return pickWebTree(); },
  // Lo soltado como árbol { files: sueltos, dirs: [carpetas] }. Lo que depende del evento (archivos y
  // entradas) se lee antes del primer await: el DataTransfer deja de ser válido al acabar el evento.
  treeFromDrop(dt) {
    const files = [...(dt.files || [])];
    if (N) {
      const paths = files.map(f => N.pathForFile(f)).filter(Boolean);
      return N.listAudioTree ? N.listAudioTree(paths) : N.infoForPaths(paths).then(infos => ({ files: infos, dirs: [] }));
    }
    const entries = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null);
    return (async () => {
      const out = { files: [], dirs: [] };
      if (!entries.some(e => e && e.isDirectory)) { out.files = files.filter(f => AUDIO_RE.test(f.name)).map(webInfo); return out; }
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e && e.isDirectory) out.dirs.push(await webEntryTree(e));
        else if (files[i] && AUDIO_RE.test(files[i].name)) out.files.push(webInfo(files[i]));
      }
      return out;
    })();
  },
  // Devuelve [{ path, name, data: Uint8Array }] o null
  async openLibraryFile() {
    if (N) return N.openLibraryFile();
    return new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = '.xml,.nml,.vdjfolder,.m3u,.m3u8,.crate';
      inp.onchange = async () => resolve(inp.files.length ? await Promise.all([...inp.files].map(async f => ({ path: f.name, name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))) : null);
      inp.click();
    });
  },
  // Primeros n bytes de un archivo (escritorio); en el navegador, el archivo entero si se añadió
  async readHead(p, n) {
    if (N) return N.readHead(p, n);
    const f = webFiles.get(p); if (!f) throw new Error('Archivo no disponible');
    return new Uint8Array(await f.slice(0, n).arrayBuffer());
  },
  // Información (etiquetas) de rutas de audio del disco; en el navegador no hay acceso a rutas
  async infoForPaths(paths) { if (N) return N.infoForPaths(paths); return []; },
  async openSample() {
    if (N) return N.openSample();
    const r = await pickWeb(false);
    return r[0] ? r[0].path : null;
  },
  async filesFromDrop(fileList) {
    const files = [...fileList];
    if (N) {
      const paths = files.map(f => N.pathForFile(f)).filter(Boolean);
      return N.infoForPaths(paths);
    }
    return files.filter(f => /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm)$/i.test(f.name)).map(webInfo);
  },
  async waveGet(id) { if (N) return N.waveGet(id); return webWaves.get(id) || null; },
  async waveSet(id, data) { if (N) return N.waveSet(id, data); webWaves.set(id, data); return true; },
  async saveRecording(bytes, name) {
    if (N) return N.saveRecording(bytes, name);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url; a.download = name + '.wav'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return name + '.wav';
  },
  showItem(p) { if (N) N.showItem(p); },
  openExternal(url) {
    if (N) return N.openExternal(url);
    if (url.startsWith('mailto:')) location.href = url; else window.open(url, '_blank', 'noopener');
  },
  // Registro técnico local (<datos de usuario>\logs). En el navegador solo queda en memoria.
  log(lines) {
    if (N && N.log) return N.log(lines);
    webLog.push(...lines.map(l => `${new Date().toISOString()} [${l.level}] [ui:${l.source}] ${l.msg}`));
    webLog.splice(0, Math.max(0, webLog.length - 400));
  },
  openLogFolder() { if (N && N.openLogFolder) return N.openLogFolder(); },
  // Informe de errores y sugerencias (el proceso principal anonimiza y envía; ver main/report.js).
  // Modo navegador (pruebas): vista previa con el registro en memoria y envío simulado con
  // window.__nexuraReportMock = { send(info) } o, si no existe, abre el correo.
  report: {
    async preview(info) {
      if (N && N.report) return N.report.preview(info);
      const { anonymize } = await webAnonymizer();
      return { version: 'web', os: navigator.platform || 'navegador', controller: info.controller || 'ninguna', decks: info.decks === 4 ? 4 : 2, log: webLog.slice(-200).map(l => anonymize(l, { known: info.known })) };
    },
    async send(info) {
      if (N && N.report) return N.report.send(info);
      if (window.__nexuraReportMock) return window.__nexuraReportMock.send(info);
      location.href = 'mailto:contacto@nexuraia.com?subject=' + encodeURIComponent('Nexura DJ Studio') + '&body=' + encodeURIComponent(String(info.text || '').slice(0, 1200));
      return { ok: false, via: 'mail', file: '' };
    }
  },
  // Copias de seguridad de la biblioteca (solo escritorio)
  backup: {
    available: !!(N && N.backup),
    list() { return N && N.backup ? N.backup.list() : Promise.resolve({ dir: '', list: [] }); },
    create(reason) { if (!N || !N.backup) throw new Error('Las copias de seguridad solo están disponibles en la app de escritorio'); return N.backup.create(reason); },
    restore(name) { if (!N || !N.backup) throw new Error('Las copias de seguridad solo están disponibles en la app de escritorio'); return N.backup.restore(name); },
    openFolder() { if (N && N.backup) return N.backup.openFolder(); }
  },
  // Contador anónimo de uso (solo escritorio y solo con statsUrl en src/config/servicios.json)
  stats: {
    send(info) { return N && N.stats ? N.stats.send(info) : Promise.resolve({ sent: false, reason: 'navegador' }); },
    preview(info) {
      if (N && N.stats) return N.stats.preview(info);
      return Promise.resolve({ id: '00000000-0000-4000-8000-000000000000', version: 'web', lang: navigator.language || 'es-ES', os: 'Windows 11', decks: info.decks === 4 ? 4 : 2, controller: !!info.controller });
    }
  },
  // Actualizaciones automáticas (solo la app instalada)
  updates: {
    available: !!(N && N.updates),
    configure(cfg) { return N && N.updates ? N.updates.configure(cfg) : Promise.resolve({ state: 'disabled' }); },
    check() { return N && N.updates ? N.updates.check() : Promise.resolve({ state: 'disabled' }); },
    download() { return N && N.updates ? N.updates.download() : Promise.resolve(false); },
    install() { return N && N.updates ? N.updates.install() : Promise.resolve(false); },
    onEvent(fn) { return N && N.updates ? N.updates.onEvent(fn) : () => {}; }
  },
  // «Limpiar biblioteca» (solo escritorio: lee los archivos, consulta MusicBrainz, Papelera y etiquetas).
  // Modo simulado para pruebas: window.__nexuraCleanupMock con las mismas funciones (onEvent(fn) incluido).
  cleanup: {
    get api() { return window.__nexuraCleanupMock || (N && N.cleanup) || null; },
    get available() { return !!this.api; },
    call(name, ...args) { const a = this.api; if (!a) throw new Error('«Limpiar biblioteca» solo está disponible en la app de escritorio'); return a[name](...args); },
    scan(entries) { return this.call('scan', entries); },
    cancel() { return this.api ? this.api.cancel() : Promise.resolve(true); },
    priority(v) { return this.api ? this.api.priority(v) : Promise.resolve(v); },
    lookup(queries) { return this.call('lookup', queries); },
    cover(releaseId) { return this.api ? this.api.cover(releaseId) : Promise.resolve(null); },
    trash(paths) { return this.call('trash', paths); },
    restoreTrash(paths) { return this.call('restoreTrash', paths); },
    writeTags(opId, writes) { return this.call('writeTags', opId, writes); },
    restoreTags(items) { return this.call('restoreTags', items); },
    onEvent(fn) { return this.api && this.api.onEvent ? this.api.onEvent(fn) : () => {}; }
  },
  // Stems (solo escritorio: necesita el motor de Demucs instalado en tools/stems)
  stems: {
    available: !!(N && N.stems),
    info(dir) { return N && N.stems ? N.stems.info(dir) : Promise.resolve({ installed: false, unsupported: true }); },
    status(ids, dir) { return N && N.stems ? N.stems.status(ids, dir) : Promise.resolve({}); },
    read(id, dir) { if (!N || !N.stems) throw new Error('Stems disponibles solo en la app de escritorio'); return N.stems.read(id, dir); },
    remove(id, dir) { return N && N.stems ? N.stems.remove(id, dir) : Promise.resolve(false); },
    install() { if (!N || !N.stems) throw new Error('Stems disponibles solo en la app de escritorio'); return N.stems.install(); },
    separate(jobs, dir, model) { if (!N || !N.stems) throw new Error('Stems disponibles solo en la app de escritorio'); return N.stems.separate(jobs, dir, model); },
    cancel() { return N && N.stems ? N.stems.cancel() : Promise.resolve(true); },
    onEvent(fn) { return N && N.stems ? N.stems.onEvent(fn) : () => {}; }
  },
  // Spotify (solo metadatos; la petición la hace el proceso principal). Modo simulado para pruebas:
  // si existe window.__nexuraSpotifyMock = { embed, api, login, logout, status } se usa en su lugar.
  spotify: {
    get mock() { return window.__nexuraSpotifyMock || null; },
    get available() { return !!(this.mock || (N && N.spotify)); },
    async embed(type, id) {
      if (this.mock) return this.mock.embed(type, id);
      if (N && N.spotify) return N.spotify.embed(type, id);
      throw new Error('La importación de Spotify solo está disponible en la app de escritorio');
    },
    async api(url) {
      if (this.mock) return this.mock.api(url);
      if (N && N.spotify) return N.spotify.api(url);
      throw new Error('La cuenta de Spotify solo se puede conectar en la app de escritorio');
    },
    async login(clientId) {
      if (this.mock) return this.mock.login(clientId);
      if (N && N.spotify) return N.spotify.login(clientId);
      throw new Error('Disponible solo en la app de escritorio');
    },
    async logout() { if (this.mock) return this.mock.logout(); if (N && N.spotify) return N.spotify.logout(); return true; },
    async status() {
      if (this.mock) return this.mock.status();
      if (N && N.spotify) return N.spotify.status();
      return { connected: false, user: '' };
    }
  },
  yt: {
    async oembed(id) {
      if (N) return N.yt.oembed(id);
      try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
        return r.ok ? r.json() : null;
      } catch (_) { return null; }
    },
    async api(endpoint, params, apiKey) {
      if (N) return N.yt.api(endpoint, params, apiKey);
      if (!apiKey) throw new Error('Necesitas una clave de API de YouTube (Ajustes → YouTube)');
      const { MSG, ytErrorInfo } = await webYtSearch();
      const q = new URLSearchParams({ ...params, key: apiKey });
      let r;
      try { r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${q}`); } catch (_) { throw new Error(MSG.net); }
      let j = null;
      try { j = await r.json(); } catch (_) { j = null; }
      if (!r.ok) throw new Error(ytErrorInfo(r.status, j).message);
      return j;
    },
    // Búsqueda por el servicio de NexuraIA (searchUrl de servicios.json) para quien no tiene clave propia.
    // Devuelve { items } o { error: 'limit'|'down'|'bad'|'none', message }. En el navegador (pruebas) la
    // dirección sale de window.__nexuraServices.searchUrl o de config/servicios.json.
    async search(q, max) {
      if (N && N.yt.search) return N.yt.search(q, max);
      const { serviceSearch } = await webYtSearch();
      try { return { items: await serviceSearch({ url: await webSearchUrl(), id: webInstallId(), q, max }) }; } catch (e) { return { error: e.code || 'down', message: e.message }; }
    },
    async searchAvailable() {
      if (N) return !!((await N.info()).services || {}).search;
      return !!(await webSearchUrl());
    },
    // Textos y utilidades de shared/yt-search.js (MSG, GUIDE, maskKey…)
    texts() { return webYtSearch(); },
    // «Comprobar clave»: { ok, code, message }
    async checkKey(key) {
      if (N && N.yt.checkKey) return N.yt.checkKey(key);
      const { checkKey } = await webYtSearch();
      return checkKey(key);
    },
    async login(id, secret) { if (N) return N.yt.login(id, secret); throw new Error('Disponible solo en la app de escritorio'); },
    async logout() { if (N) return N.yt.logout(); return true; },
    async status() { if (N) return N.yt.status(); return { connected: false }; }
  }
};
