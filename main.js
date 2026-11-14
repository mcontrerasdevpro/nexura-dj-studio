// Nexura DJ Studio — proceso principal (Electron)
// © NexuraIA
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const APP_NAME = 'Nexura DJ Studio';
const SRC_DIR = path.join(__dirname, 'src');
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.mp4', '.webm']);
const isDev = process.argv.includes('--dev');
const { createLogger } = require('./main/logger');
const backup = require('./main/backup');
const report = require('./main/report');
const stats = require('./main/stats');
const ytSearch = require('./src/js/shared/yt-search.js');
const { createUpdater } = require('./main/updater');
const cleanupScan = require('./main/cleanup-scan');
const tagWriter = require('./main/tag-writer');
const recycle = require('./main/recycle');
const { createMb } = require('./main/musicbrainz');

// Servicios de NexuraIA (src/config/servicios.json; vacío = desactivado):
//   feedbackUrl → informes y sugerencias (POST JSON); statsUrl → contador anónimo de uso (POST JSON);
//   searchUrl → búsqueda de YouTube sin clave propia (POST JSON { id, q, max }; ver src/js/shared/yt-search.js).
// Compatibilidad con la beta: si feedbackUrl está vacío se usa «feedbackWebhook» de config.local.json
// (archivo privado, no se sube al repositorio; ver config.local.example.json).
function readJsonFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return {}; } }
const SERVICES = readJsonFile(path.join(SRC_DIR, 'config', 'servicios.json'));
const LEGACY_WEBHOOK = String(readJsonFile(path.join(__dirname, 'config.local.json')).feedbackWebhook || '');
const webUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? String(u) : '');
const FEEDBACK_URL = webUrl(SERVICES.feedbackUrl) || webUrl(LEGACY_WEBHOOK);
const STATS_URL = webUrl(SERVICES.statsUrl);
// searchUrl → búsqueda de YouTube para quien no tiene clave propia. NEXURA_SEARCH_URL solo para pruebas.
const SEARCH_URL = webUrl(process.env.NEXURA_SEARCH_URL) || webUrl(SERVICES.searchUrl);
const OS_LABEL = report.windowsLabel(process.platform, os.release());

// El audio en tiempo real no debe frenarse cuando la ventana pierde el foco
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Pruebas (tools/ui-check-rc1-escritorio.cjs): datos en una carpeta temporal, sin tocar los del usuario
if (process.env.NEXURA_USER_DATA) app.setPath('userData', process.env.NEXURA_USER_DATA);

// Ajustes que se aplican al arrancar, antes de que exista la ventana (<datos de usuario>\arranque.json):
// gpu: 'auto' | 'off' (Ajustes → Audio → Rendimiento → «Aceleración por GPU»). Con algunas tarjetas y
// controladores (p. ej. AMD con canvas acelerado) la forma de onda puede quedarse congelada; sin aceleración
// se dibuja con la CPU. Solo se puede cambiar antes de «ready»: hace falta reiniciar la app.
const bootFile = () => path.join(app.getPath('userData'), 'arranque.json');
const BOOT = readJsonFile(bootFile());
const GPU_OFF = BOOT.gpu === 'off';
if (GPU_OFF) app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let serverPort = 0;

// ---------------------------------------------------------------------------
// Rutas de datos
// ---------------------------------------------------------------------------
const dataDir = () => path.join(app.getPath('userData'), 'data');
const waveDir = () => path.join(dataDir(), 'waveforms');
const recDir = () => path.join(app.getPath('music'), APP_NAME, 'Grabaciones');
const copiasDir = () => path.join(app.getPath('userData'), 'copias');
const reportsDir = () => path.join(app.getPath('userData'), 'informes');

async function ensureDirs() {
  await fsp.mkdir(waveDir(), { recursive: true });
}

// Registro técnico local (<datos de usuario>\logs, 5 archivos de 1 MB como mucho)
let logger = null;
const log = (level, source, msg) => { try { (logger || (logger = createLogger(path.join(app.getPath('userData'), 'logs')))).write(level, source, msg); } catch (_) { /* nunca romper por el registro */ } };
process.on('uncaughtException', (e) => { log('ERROR', 'main', 'Excepción no capturada: ' + ((e && e.stack) || e)); console.error(e); });
process.on('unhandledRejection', (e) => { log('ERROR', 'main', 'Promesa rechazada: ' + ((e && e.stack) || e)); });

// Mientras se restaura una copia no se escribe nada en los datos (la interfaz puede tener guardados pendientes)
let storeLocked = false;
const backupNow = (reason) => backup.makeBackup(dataDir(), copiasDir(), { reason, version: app.getVersion() });

// Al arrancar: si la biblioteca o los ajustes no se pueden leer, ofrecer la última copia buena en vez de
// empezar vacío (la app guardaría encima una biblioteca vacía). Si todo está bien, copia del día.
async function startupBackup() {
  const health = backup.checkHealth(dataDir());
  if (!health.ok) {
    log('ERROR', 'copias', 'Datos dañados al arrancar: ' + health.damaged.join(', '));
    const good = backup.latestGood(copiasDir());
    const when = good ? new Date(good.date || Date.now()).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const buttons = good ? [`Restaurar la copia del ${when}`, 'Empezar con la biblioteca vacía'] : ['Empezar con la biblioteca vacía'];
    const r = await dialog.showMessageBox({
      type: 'warning', title: APP_NAME, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
      message: 'No se ha podido leer tu biblioteca',
      detail: (good
        ? `El archivo de ${health.damaged.includes('library.json') ? 'la biblioteca' : 'los ajustes'} está dañado (por ejemplo, por un corte de luz). Hay una copia de seguridad buena${good.tracks != null ? ` con ${good.tracks} pistas` : ''}.`
        : 'El archivo está dañado y no hay copias de seguridad.') +
        '\n\nSi empiezas con la biblioteca vacía, el archivo dañado se guarda aparte (no se borra) en la carpeta de datos.'
    });
    if (good && r.response === 0) {
      try { backup.restoreBackup(dataDir(), copiasDir(), good.name, { version: app.getVersion() }); log('INFO', 'copias', 'Restaurada la copia ' + good.name); return; }
      catch (e) { log('ERROR', 'copias', 'No se pudo restaurar: ' + e.message); dialog.showErrorBox(APP_NAME, 'No se pudo restaurar la copia: ' + e.message); }
    }
    backup.setAsideDamaged(dataDir(), health.damaged);
    return;
  }
  try {
    const r = backup.autoBackup(dataDir(), copiasDir(), { version: app.getVersion() });
    if (r.name) log('INFO', 'copias', `Copia automática ${r.name} (${r.tracks ?? '?'} pistas)`);
  } catch (e) { log('WARN', 'copias', 'Copia automática: ' + e.message); }
}

// Actualizaciones: solo en la app instalada con el instalador (no en «npm start» ni en la Microsoft Store,
// que actualiza ella misma)
let updater = null;
function setupUpdater() {
  let autoUpdater = null;
  // NEXURA_UPDATER_TEST=1: probarlo sin instalar (lee dev-app-update.yml de la raíz del proyecto)
  const test = process.env.NEXURA_UPDATER_TEST === '1';
  const enabled = (app.isPackaged || test) && !process.windowsStore && process.env.NEXURA_NO_UPDATES !== '1';
  if (enabled) { try { ({ autoUpdater } = require('electron-updater')); if (test) autoUpdater.forceDevUpdateConfig = true; } catch (e) { log('WARN', 'actualizaciones', 'electron-updater no disponible: ' + e.message); } }
  updater = createUpdater({
    autoUpdater, enabled: enabled && !!autoUpdater,
    send: (ev) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:event', ev); },
    log: (level, msg) => log(level, 'actualizaciones', msg),
    beforeInstall: async (reason) => { const r = backupNow(reason); if (r.name) log('INFO', 'copias', 'Copia antes de actualizar: ' + r.name); }
  });
}

// ---------------------------------------------------------------------------
// Servidor local: la interfaz se sirve por http://localhost para que el
// reproductor oficial de YouTube (IFrame API) funcione (no admite file://).
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8'
};

// Lectura de archivos de audio para la interfaz por el servidor local (/__audio/<token>?p=<ruta>): pasar una pista
// entera (60 MB en WAV) como respuesta de IPC paraba la interfaz casi 1 s en un PC lento; con fetch llega a trozos.
// Solo con el token aleatorio de esta sesión (lo conoce la interfaz por app:info) y solo archivos de audio.
const AUDIO_TOKEN = crypto.randomBytes(24).toString('hex');
async function serveAudio(u, res) {
  const p = u.searchParams.get('p') || '';
  if (!path.isAbsolute(p) || !AUDIO_EXT.has(path.extname(p).toLowerCase())) { res.writeHead(403); return res.end(); }
  let st;
  try { st = await fsp.stat(p); } catch (_) { res.writeHead(404); return res.end(); }
  if (!st.isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://localhost');
        if (u.pathname === '/__audio/' + AUDIO_TOKEN) return await serveAudio(u, res);
        const urlPath = decodeURIComponent(u.pathname);
        let rel = urlPath === '/' ? '/index.html' : urlPath;
        const filePath = path.normalize(path.join(SRC_DIR, rel));
        if (!filePath.startsWith(SRC_DIR)) { res.writeHead(403); return res.end(); }
        const data = await fsp.readFile(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      } catch (e) {
        res.writeHead(404); res.end('Not found');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---------------------------------------------------------------------------
// Lectura de etiquetas (ID3v2 / ID3v1 / FLAC Vorbis) sin dependencias
// ---------------------------------------------------------------------------
function decodeText(buf, enc) {
  try {
    if (enc === 0) return buf.toString('latin1');
    if (enc === 3) return buf.toString('utf8');
    if (enc === 1) {
      if (buf[0] === 0xFE && buf[1] === 0xFF) return swap16(buf.slice(2)).toString('utf16le');
      if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
      return buf.toString('utf16le');
    }
    if (enc === 2) return swap16(buf).toString('utf16le');
  } catch (_) { /* ignore */ }
  return buf.toString('latin1');
}
function swap16(b) { const c = Buffer.from(b); if (c.length % 2) return c.slice(0, -1).swap16(); return c.swap16(); }
const clean = (s) => (s || '').replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();

async function readTags(filePath) {
  const tags = {};
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const ver = head[3];
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      const tag = Buffer.alloc(Math.min(size, 4 * 1024 * 1024));
      await fh.read(tag, 0, tag.length, 10);
      let p = 0;
      const idLen = ver === 2 ? 3 : 4;
      const hdrLen = ver === 2 ? 6 : 10;
      const map = ver === 2
        ? { TT2: 'title', TP1: 'artist', TAL: 'album', TCO: 'genre', TBP: 'bpm', TKE: 'key', TYE: 'year', TRC: 'isrc' }
        : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCON: 'genre', TBPM: 'bpm', TKEY: 'key', TYER: 'year', TDRC: 'year', TSRC: 'isrc' };
      while (p + hdrLen < tag.length) {
        const id = tag.toString('latin1', p, p + idLen);
        if (!/^[A-Z0-9]+$/.test(id)) break;
        let fsize;
        if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
        else if (ver === 4) fsize = (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7];
        else fsize = tag.readUInt32BE(p + 4);
        const body = tag.slice(p + hdrLen, p + hdrLen + fsize);
        if (map[id] && body.length > 1) tags[map[id]] = clean(decodeText(body.slice(1), body[0]));
        p += hdrLen + fsize;
        if (fsize <= 0) break;
      }
    } else if (head.toString('latin1', 0, 4) === 'fLaC') {
      let pos = 4;
      for (let guard = 0; guard < 64; guard++) {
        const bh = Buffer.alloc(4);
        await fh.read(bh, 0, 4, pos);
        const last = bh[0] & 0x80, type = bh[0] & 0x7F;
        const len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
        if (type === 4) {
          const b = Buffer.alloc(len);
          await fh.read(b, 0, len, pos + 4);
          let q = 0;
          const vlen = b.readUInt32LE(q); q += 4 + vlen;
          const n = b.readUInt32LE(q); q += 4;
          for (let i = 0; i < n && q < b.length; i++) {
            const l = b.readUInt32LE(q); q += 4;
            const kv = b.toString('utf8', q, q + l); q += l;
            const eq = kv.indexOf('=');
            const k = kv.slice(0, eq).toUpperCase(), v = kv.slice(eq + 1);
            const m = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', GENRE: 'genre', BPM: 'bpm', INITIALKEY: 'key', DATE: 'year', ISRC: 'isrc' };
            if (m[k]) tags[m[k]] = clean(v);
          }
          break;
        }
        pos += 4 + len;
        if (last) break;
      }
    }
    if (!tags.title && path.extname(filePath).toLowerCase() === '.mp3') {
      const st = await fh.stat();
      if (st.size > 128) {
        const t = Buffer.alloc(128);
        await fh.read(t, 0, 128, st.size - 128);
        if (t.toString('latin1', 0, 3) === 'TAG') {
          tags.title = clean(t.toString('latin1', 3, 33));
          tags.artist = clean(t.toString('latin1', 33, 63));
          tags.album = clean(t.toString('latin1', 63, 93));
        }
      }
    }
  } catch (_) { /* fichero sin etiquetas legibles */ }
  finally { if (fh) await fh.close().catch(() => {}); }

  // Si no hay etiquetas, "Artista - Título.mp3"
  if (!tags.title) {
    const base = path.basename(filePath, path.extname(filePath));
    const m = base.split(' - ');
    if (m.length >= 2) { tags.artist = tags.artist || m[0].trim(); tags.title = m.slice(1).join(' - ').trim(); }
    else tags.title = base;
  }
  return tags;
}

// Carátula: APIC (ID3v2.3/2.4), PIC (ID3v2.2) o bloque PICTURE de FLAC → { mime, data } o null
function id3Pictures(tag, ver) {
  const pics = [];
  const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
  let p = 0;
  while (p + hdrLen < tag.length) {
    const id = tag.toString('latin1', p, p + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize;
    if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
    else if (ver === 4) fsize = (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7];
    else fsize = tag.readUInt32BE(p + 4);
    if (fsize <= 0) break;
    if (id === 'APIC' || id === 'PIC') {
      const b = tag.slice(p + hdrLen, p + hdrLen + fsize);
      const enc = b[0];
      let q = 1, mime;
      if (id === 'PIC') { mime = 'image/' + b.toString('latin1', 1, 4).toLowerCase().replace('jpg', 'jpeg'); q = 4; }
      else { const z = b.indexOf(0, 1); mime = b.toString('latin1', 1, z); q = z + 1; }
      const type = b[q]; q++;
      // descripción terminada en 0 (dos ceros alineados en UTF-16)
      if (enc === 1 || enc === 2) { while (q + 1 < b.length && !(b[q] === 0 && b[q + 1] === 0)) q += 2; q += 2; }
      else { while (q < b.length && b[q] !== 0) q++; q++; }
      if (q < b.length) pics.push({ type, mime: mime || 'image/jpeg', data: b.slice(q) });
    }
    p += hdrLen + fsize;
  }
  return pics;
}
async function readCover(filePath) {
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    let pics = [];
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      const tag = Buffer.alloc(Math.min(size, 16 * 1024 * 1024));
      await fh.read(tag, 0, tag.length, 10);
      pics = id3Pictures(tag, head[3]);
    } else if (head.toString('latin1', 0, 4) === 'fLaC') {
      let pos = 4;
      for (let guard = 0; guard < 64; guard++) {
        const bh = Buffer.alloc(4);
        await fh.read(bh, 0, 4, pos);
        const last = bh[0] & 0x80, type = bh[0] & 0x7F, len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
        if (type === 6 && len < 16 * 1024 * 1024) {
          const b = Buffer.alloc(len);
          await fh.read(b, 0, len, pos + 4);
          let q = 0;
          const ptype = b.readUInt32BE(q); q += 4;
          const ml = b.readUInt32BE(q); q += 4; const mime = b.toString('latin1', q, q + ml); q += ml;
          const dl = b.readUInt32BE(q); q += 4 + dl + 16;
          const n = b.readUInt32BE(q); q += 4;
          pics.push({ type: ptype, mime, data: b.slice(q, q + n) });
        }
        pos += 4 + len;
        if (last) break;
      }
    }
    return pics.find(x => x.type === 3) || pics[0] || null; // 3 = portada
  } catch (_) { return null; }
  finally { if (fh) await fh.close().catch(() => {}); }
}

async function fileInfo(filePath) {
  const st = await fsp.stat(filePath);
  const tags = await readTags(filePath);
  return { path: filePath, size: st.size, mtime: st.mtimeMs, ...tags };
}

async function scanFolder(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) await scanFolder(full, out, depth + 1); }
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

// Árbol de una carpeta para crear crates con su estructura: { name, path, files: [info], dirs: [nodo] }
const byName = (a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
async function audioTree(dir, depth = 0) {
  const node = { name: path.basename(dir) || dir.replace(/[\\/]+$/, ''), path: dir, files: [], dirs: [] };
  if (depth > 12) return node;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return node; }
  for (const e of entries.sort(byName)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) node.dirs.push(await audioTree(full, depth + 1)); }
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) { try { node.files.push(await fileInfo(full)); } catch (_) { /* skip */ } }
  }
  return node;
}
// Rutas soltadas o elegidas → { files: archivos sueltos, dirs: árboles de las carpetas }
async function audioTreeFor(paths) {
  const out = { files: [], dirs: [] };
  for (const p of paths || []) {
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory()) out.dirs.push(await audioTree(p));
      else if (AUDIO_EXT.has(path.extname(p).toLowerCase())) out.files.push(await fileInfo(p));
    } catch (_) { /* skip */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// YouTube: OAuth (opcional, para "Mis listas") y API Data v3
// ---------------------------------------------------------------------------
const secretsFile = () => path.join(dataDir(), 'secrets.bin');
let ytTokens = null; // { access_token, refresh_token, expiry, clientId, clientSecret }

async function loadSecrets() {
  try {
    const raw = await fsp.readFile(secretsFile());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    ytTokens = JSON.parse(json);
  } catch (_) { ytTokens = null; }
}
async function saveSecrets() {
  const json = JSON.stringify(ytTokens || {});
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  await fsp.writeFile(secretsFile(), data);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function ytOAuthLogin(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (!u.searchParams.has('code') && !u.searchParams.has('error')) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;background:#0b0d14;color:#fff;text-align:center;padding-top:80px">' +
        '<h2>Nexura DJ Studio</h2><p>Cuenta conectada. Ya puedes volver a la aplicación.</p></body></html>');
      srv.close();
      if (u.searchParams.get('state') !== state) return reject(new Error('Estado OAuth no válido'));
      if (u.searchParams.has('error')) return reject(new Error(u.searchParams.get('error')));
      try {
        const body = new URLSearchParams({
          code: u.searchParams.get('code'), client_id: clientId, client_secret: clientSecret,
          code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect
        });
        const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error_description || j.error || 'Error de token');
        ytTokens = { access_token: j.access_token, refresh_token: j.refresh_token, expiry: Date.now() + (j.expires_in - 60) * 1000, clientId, clientSecret };
        await saveSecrets();
        resolve({ ok: true });
      } catch (e) { reject(e); }
    });
    let redirect = '';
    srv.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${srv.address().port}`;
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state
      });
      shell.openExternal(url);
    });
    setTimeout(() => { try { srv.close(); } catch (_) {} reject(new Error('Tiempo de espera agotado')); }, 5 * 60 * 1000);
  });
}

async function ytAccessToken() {
  if (!ytTokens || !ytTokens.refresh_token) return null;
  if (ytTokens.access_token && Date.now() < ytTokens.expiry) return ytTokens.access_token;
  const body = new URLSearchParams({
    client_id: ytTokens.clientId, client_secret: ytTokens.clientSecret,
    refresh_token: ytTokens.refresh_token, grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'No se pudo renovar la sesión de YouTube');
  ytTokens.access_token = j.access_token;
  ytTokens.expiry = Date.now() + (j.expires_in - 60) * 1000;
  await saveSecrets();
  return ytTokens.access_token;
}

// ---------------------------------------------------------------------------
// Spotify: solo metadatos de listas, álbumes y pistas (título, artistas, duración, ISRC, carátula).
// Nunca se descarga ni se extrae audio. OAuth con PKCE (sin client secret) y redirect fijo en
// 127.0.0.1 (Spotify exige registrar el URI exacto; mismo valor que SPOTIFY_REDIRECT_URI en spotify-core.js).
// ---------------------------------------------------------------------------
const SPOTIFY_PORT = 43827;
const SPOTIFY_REDIRECT = `http://127.0.0.1:${SPOTIFY_PORT}/callback`;
const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative';
const spotifyFile = () => path.join(dataDir(), 'spotify.bin');
let spTokens = null; // { access_token, refresh_token, expiry, clientId, user }

async function loadSpotify() {
  try {
    const raw = await fsp.readFile(spotifyFile());
    spTokens = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
  } catch (_) { spTokens = null; }
}
async function saveSpotify() {
  const json = JSON.stringify(spTokens || {});
  await fsp.writeFile(spotifyFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8'));
}
async function spotifyToken(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || 'Error de token de Spotify (HTTP ' + r.status + ')');
  return j;
}

let spLogin = null;
function spotifyLogin(clientId) {
  if (!/^[A-Za-z0-9]{16,64}$/.test(String(clientId || ''))) return Promise.reject(new Error('Client ID de Spotify no válido'));
  if (spLogin) { try { spLogin.close(); } catch (_) {} spLogin = null; }
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    let done = false;
    const finish = (err, val) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { srv.close(); } catch (_) {}
      spLogin = null;
      err ? reject(err) : resolve(val);
    };
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, SPOTIFY_REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const ok = u.searchParams.has('code') && u.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;background:#0b0d14;color:#fff;text-align:center;padding-top:80px">' +
        `<h2>Nexura DJ Studio</h2><p>${ok ? 'Cuenta de Spotify conectada. Ya puedes volver a la aplicación.' : 'No se pudo conectar la cuenta. Vuelve a la aplicación e inténtalo de nuevo.'}</p></body></html>`);
      if (u.searchParams.get('state') !== state) return finish(new Error('Estado OAuth no válido'));
      if (u.searchParams.has('error')) return finish(new Error(u.searchParams.get('error') === 'access_denied' ? 'Acceso denegado en Spotify' : u.searchParams.get('error')));
      try {
        const j = await spotifyToken({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: SPOTIFY_REDIRECT, client_id: clientId, code_verifier: verifier });
        spTokens = { access_token: j.access_token, refresh_token: j.refresh_token, expiry: Date.now() + ((j.expires_in || 3600) - 60) * 1000, clientId, user: '' };
        try {
          const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + j.access_token } }).then(r => (r.ok ? r.json() : null));
          if (me) spTokens.user = me.display_name || me.id || '';
        } catch (_) { /* el nombre es opcional */ }
        await saveSpotify();
        finish(null, { ok: true, user: spTokens.user });
      } catch (e) { finish(e); }
    });
    spLogin = srv;
    srv.on('error', (e) => finish(new Error(e.code === 'EADDRINUSE' ? `El puerto ${SPOTIFY_PORT} está ocupado por otro programa: ciérralo y vuelve a intentarlo.` : e.message)));
    srv.listen(SPOTIFY_PORT, '127.0.0.1', () => {
      shell.openExternal('https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT, scope: SPOTIFY_SCOPES,
        code_challenge_method: 'S256', code_challenge: challenge, state
      }));
    });
    const timer = setTimeout(() => finish(new Error('Tiempo de espera agotado al conectar con Spotify')), 5 * 60 * 1000);
  });
}

async function spotifyAccess(force = false) {
  if (!spTokens || !spTokens.refresh_token) return null;
  if (!force && spTokens.access_token && Date.now() < spTokens.expiry) return spTokens.access_token;
  const j = await spotifyToken({ grant_type: 'refresh_token', refresh_token: spTokens.refresh_token, client_id: spTokens.clientId });
  spTokens.access_token = j.access_token;
  if (j.refresh_token) spTokens.refresh_token = j.refresh_token; // Spotify puede rotarlo
  spTokens.expiry = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
  await saveSpotify();
  return spTokens.access_token;
}

// GET a la Web API (solo https://api.spotify.com/v1/…): { ok, status, data }. Renueva el token si caduca
// y espera (como mucho 10 s) si Spotify pide reintentar más tarde (429).
async function spotifyApi(url) {
  const full = /^https:\/\//.test(url) ? url : 'https://api.spotify.com' + url;
  const u = new URL(full);
  if (u.origin !== 'https://api.spotify.com' || !u.pathname.startsWith('/v1/')) throw new Error('Dirección de la API de Spotify no válida');
  let token = await spotifyAccess();
  if (!token) throw new Error('Conecta tu cuenta de Spotify en Ajustes → Spotify');
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401 && attempt === 0) { token = await spotifyAccess(true); continue; }
    if (r.status === 429 && attempt < 2) {
      const wait = Math.min(10, Number(r.headers.get('retry-after')) || 2);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  }
  return { ok: false, status: 429, data: null };
}

// Página pública de inserción (open.spotify.com/embed/…): solo el HTML con el JSON de metadatos
async function spotifyEmbed(type, id) {
  if (!['playlist', 'album', 'track'].includes(type) || !/^[A-Za-z0-9]{22}$/.test(String(id || ''))) throw new Error('Enlace de Spotify no válido');
  const r = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', Accept: 'text/html'
    }
  });
  if (r.status === 404) throw new Error('La lista no existe o no es pública.');
  if (!r.ok) throw new Error('Spotify respondió HTTP ' + r.status);
  const text = await r.text();
  return text.slice(0, 8 * 1024 * 1024);
}

// Enlaces que la interfaz puede abrir en el navegador del sistema (platform.openExternal)
const EXTERNAL_HOSTS = [
  'youtube.com', 'youtu.be', 'nexuraia.com',
  'spotify.com', // open.spotify.com y developer.spotify.com (instrucciones de Ajustes → Spotify)
  'beatport.com', 'bandcamp.com', 'music.apple.com', 'itunes.apple.com', // «Comprar»
  'console.cloud.google.com' // crear la clave de YouTube (Ajustes → YouTube)
];
function externalAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'github.com' && /^\/mcontrerasdevpro\/nexura-dj-studio(\/|$)/.test(u.pathname)) return true; // guía del README
    return u.protocol === 'https:' && EXTERNAL_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// Stems (Demucs en tools/stems con su propio entorno de Python)
// ---------------------------------------------------------------------------
const { spawn } = require('child_process');
const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'];
// El motor necesita una carpeta con permiso de escritura (uv crea ahí su .venv): en la app instalada
// los archivos van dentro del paquete (resources/stems), así que se copian a E:\IA\nexura-stems si
// existe E:\IA o a los datos de la app. Con «npm start» se usa la misma carpeta: un solo entorno.
const stemsSource = () => (app.isPackaged ? path.join(process.resourcesPath, 'stems') : path.join(__dirname, 'tools', 'stems'));
function stemsTool() {
  const dir = process.platform === 'win32' && fs.existsSync('E:\\IA') ? 'E:\\IA\\nexura-stems' : path.join(dataDir(), 'stems-engine');
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['pyproject.toml', 'separate.py']) {
      const src = path.join(stemsSource(), f), dst = path.join(dir, f);
      const a = fs.readFileSync(src);
      if (!fs.existsSync(dst) || !a.equals(fs.readFileSync(dst))) fs.writeFileSync(dst, a);
    }
  } catch (e) { console.warn('stems tool', e.message); }
  return dir;
}
const stemsPython = () => path.join(stemsTool(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
// Carpeta por defecto: E:\IA\stems si existe E:\IA (SSD de modelos), si no dentro de los datos de la app
function defaultStemsDir() {
  if (process.platform === 'win32' && fs.existsSync('E:\\IA')) return 'E:\\IA\\stems';
  return path.join(dataDir(), 'stems');
}
const stemsDirOf = (dir) => (dir && path.isAbsolute(dir) ? dir : defaultStemsDir());
const safeId = (id) => /^[\w-]+$/.test(String(id || ''));
let stemsProc = null;

function findUv() {
  const home = os.homedir();
  const cands = [path.join(home, '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'), path.join(home, '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')];
  return cands.find(c => fs.existsSync(c)) || 'uv';
}
function stemsEnv() {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
  if (process.platform === 'win32' && fs.existsSync('E:\\IA')) {
    env.TORCH_HOME = env.TORCH_HOME || 'E:\\IA\\modelos\\torch';
    env.UV_CACHE_DIR = env.UV_CACHE_DIR || 'E:\\IA\\cache\\uv';
    env.UV_PYTHON_INSTALL_DIR = env.UV_PYTHON_INSTALL_DIR || 'E:\\IA\\python';
  }
  return env;
}
function sendStems(ev) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stems:event', ev); }

function registerStemsIpc() {
  ipcMain.handle('stems:info', async (_e, dir) => ({
    installed: fs.existsSync(stemsPython()), tool: stemsTool(), dir: stemsDirOf(dir), busy: !!stemsProc
  }));
  ipcMain.handle('stems:status', async (_e, ids, dir) => {
    const base = stemsDirOf(dir), out = {};
    for (const id of ids || []) {
      if (!safeId(id)) continue;
      out[id] = STEM_NAMES.every(n => fs.existsSync(path.join(base, id, n + '.flac')));
    }
    return out;
  });
  ipcMain.handle('stems:read', async (_e, id, dir) => {
    if (!safeId(id)) throw new Error('id no válido');
    const base = path.join(stemsDirOf(dir), id), out = {};
    for (const n of STEM_NAMES) {
      const buf = await fsp.readFile(path.join(base, n + '.flac'));
      out[n] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return out;
  });
  ipcMain.handle('stems:delete', async (_e, id, dir) => {
    if (!safeId(id)) return false;
    await fsp.rm(path.join(stemsDirOf(dir), id), { recursive: true, force: true });
    return true;
  });
  // Instala el entorno (uv sync): Python 3.11 + PyTorch CUDA + Demucs. Tarda unos minutos la primera vez.
  ipcMain.handle('stems:install', async () => {
    if (stemsProc) throw new Error('Ya hay un proceso de stems en marcha');
    return new Promise((resolve) => {
      const p = spawn(findUv(), ['sync', '--python', '3.11'], { cwd: stemsTool(), env: stemsEnv(), windowsHide: true });
      stemsProc = p;
      const line = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(l => sendStems({ ev: 'log', text: l.slice(0, 300) }));
      p.stdout.on('data', line); p.stderr.on('data', line);
      p.on('error', (e) => { stemsProc = null; sendStems({ ev: 'log', text: 'No se pudo ejecutar uv: ' + e.message }); resolve({ ok: false, error: e.message }); });
      p.on('close', (code) => { stemsProc = null; resolve({ ok: code === 0 && fs.existsSync(stemsPython()), code }); });
    });
  });
  // Separa una lista de pistas: [{id, path}]. Emite eventos 'stems:event' con el progreso.
  ipcMain.handle('stems:separate', async (_e, jobs, dir, model) => {
    if (stemsProc) throw new Error('Ya hay una separación en marcha');
    if (!fs.existsSync(stemsPython())) throw new Error('El motor de stems no está instalado');
    const out = stemsDirOf(dir);
    await fsp.mkdir(out, { recursive: true });
    const list = (jobs || []).filter(j => safeId(j.id) && j.path && fs.existsSync(j.path));
    return new Promise((resolve) => {
      const p = spawn(stemsPython(), [path.join(stemsTool(), 'separate.py'), '--out', out, '--model', ['htdemucs', 'htdemucs_ft'].includes(model) ? model : 'htdemucs'], { cwd: stemsTool(), env: stemsEnv(), windowsHide: true });
      stemsProc = p;
      let buf = '', errTail = '';
      const results = { done: [], failed: [] };
      p.stdout.on('data', (d) => {
        buf += String(d);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!l) continue;
          try {
            const ev = JSON.parse(l);
            if (ev.ev === 'done') results.done.push(ev.id);
            if (ev.ev === 'error') results.failed.push(ev);
            sendStems(ev);
          } catch (_) { sendStems({ ev: 'log', text: l.slice(0, 300) }); }
        }
      });
      p.stderr.on('data', (d) => { errTail = (errTail + String(d)).slice(-2000); });
      p.on('error', (e) => { stemsProc = null; resolve({ ...results, error: e.message }); });
      p.on('close', (code) => { stemsProc = null; resolve({ ...results, code, error: code ? errTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') : '' }); });
      p.stdin.end(JSON.stringify(list));
    });
  });
  ipcMain.handle('stems:cancel', async () => { if (stemsProc) { stemsProc.kill(); stemsProc = null; } return true; });
}

// ---------------------------------------------------------------------------
// «Limpiar biblioteca»: análisis en un hilo aparte (main/cleanup-worker.js), consultas a MusicBrainz, Papelera
// de Windows y escritura de etiquetas con copia de las originales. Datos en userData/data/limpieza.
// NEXURA_MB_URL / NEXURA_CAA_URL solo para pruebas (servidor simulado).
// ---------------------------------------------------------------------------
const cleanupDir = () => path.join(dataDir(), 'limpieza');
const CLEAN_EXT = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm|wma|ape|wv|mpc|aif|aiff|alac|ac3|mp2|ra)$/i;
let cleanWorker = null, cleanJob = null, cleanPrio = 'normal', onlineCancel = false, mbClient = null;
const sendCleanup = (ev) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cleanup:event', ev); };
const mb = () => mbClient || (mbClient = createMb({
  cacheDir: cleanupDir(), userAgent: `NexuraDJStudio/${app.getVersion()} (contacto@nexuraia.com)`,
  base: webUrl(process.env.NEXURA_MB_URL) || undefined, caa: webUrl(process.env.NEXURA_CAA_URL) || undefined,
  gap: process.env.NEXURA_MB_URL ? 50 : 1100
}));
function cleanupWorker() {
  if (cleanWorker) return cleanWorker;
  const { Worker } = require('worker_threads');
  cleanWorker = new Worker(path.join(__dirname, 'main', 'cleanup-worker.js'));
  cleanWorker.on('message', (m) => {
    if (!m || !cleanJob) return;
    if (m.t === 'progress') sendCleanup(m);
    else if (m.t === 'done') { const j = cleanJob; cleanJob = null; j.resolve(m.result); }
    else if (m.t === 'error') { const j = cleanJob; cleanJob = null; j.reject(new Error(m.message)); }
  });
  cleanWorker.on('error', (e) => { log('ERROR', 'limpieza', 'Hilo de análisis: ' + e.message); if (cleanJob) { cleanJob.reject(e); cleanJob = null; } cleanWorker = null; });
  cleanWorker.on('exit', () => { cleanWorker = null; });
  return cleanWorker;
}
function registerCleanupIpc() {
  ipcMain.handle('cleanup:scan', async (_e, entries) => {
    if (cleanJob) throw new Error('Ya hay un análisis en marcha');
    const list = (entries || []).filter(x => x && typeof x.path === 'string' && x.path && !/^(web|youtube):/.test(x.path)).map(x => ({ id: String(x.id), path: x.path }));
    await fsp.mkdir(cleanupDir(), { recursive: true });
    const cacheFile = path.join(cleanupDir(), 'archivos.ndjson');
    const t0 = Date.now();
    let res;
    try {
      res = await new Promise((resolve, reject) => {
        cleanJob = { resolve, reject };
        cleanupWorker().postMessage({ t: 'scan', entries: list, cacheFile, priority: cleanPrio });
      });
    } catch (e) {
      // sin hilo aparte (no debería pasar): se hace aquí mismo, cediendo el turno entre archivos
      log('WARN', 'limpieza', 'Análisis sin hilo aparte: ' + e.message);
      cleanJob = { resolve: () => {}, reject: () => {}, inline: true, cancel: false };
      try { res = await cleanupScan.scanEntries(list, { cache: cleanupScan.createCache(cacheFile), cancelled: () => cleanJob && cleanJob.cancel, priority: () => cleanPrio, onProgress: sendCleanup }); }
      finally { cleanJob = null; }
    }
    log('INFO', 'limpieza', `Análisis: ${list.length} archivos en ${Math.round((Date.now() - t0) / 100) / 10} s (${res.stats.cached} de la caché, ${res.stats.probed} leídos, ${res.stats.partial}+${res.stats.full} huellas)${res.cancelled ? ' · cancelado' : ''}`);
    return res;
  });
  ipcMain.handle('cleanup:cancel', () => {
    onlineCancel = true;
    if (cleanJob && cleanJob.inline) cleanJob.cancel = true;
    else if (cleanWorker) cleanWorker.postMessage({ t: 'cancel' });
    return true;
  });
  ipcMain.handle('cleanup:priority', (_e, v) => { cleanPrio = v === 'low' ? 'low' : 'normal'; if (cleanWorker) cleanWorker.postMessage({ t: 'priority', v: cleanPrio }); return cleanPrio; });
  // MusicBrainz: queries [{ key, artist, title }] → { results, offline, done }
  ipcMain.handle('cleanup:lookup', async (_e, queries) => {
    onlineCancel = false;
    const list = (queries || []).slice(0, 5000).map(q => ({ key: String(q.key), artist: String(q.artist || '').slice(0, 200), title: String(q.title || '').slice(0, 200) }));
    const r = await mb().lookupMany(list, { onProgress: sendCleanup, cancelled: () => onlineCancel });
    log('INFO', 'limpieza', `Internet: ${r.done}/${list.length} consultas${r.offline ? ' · sin conexión' : ''}`);
    return r;
  });
  ipcMain.handle('cleanup:cover', async (_e, releaseId) => {
    try { const b = await mb().cover(String(releaseId || '')); return b ? `data:image/${b[0] === 0xff ? 'jpeg' : 'png'};base64,` + b.toString('base64') : null; } catch (_) { return null; }
  });
  ipcMain.handle('cleanup:trash', async (_e, paths) => {
    const list = (paths || []).map(String).filter(p => CLEAN_EXT.test(p) && path.isAbsolute(p));
    const r = await recycle.trashFiles(list, { trashItem: (p) => shell.trashItem(p) });
    log('INFO', 'limpieza', `Papelera: ${r.filter(x => x.ok).length}/${list.length} archivos`);
    return r;
  });
  ipcMain.handle('cleanup:restoreTrash', async (_e, paths) => {
    const out = [];
    for (const p of (paths || []).map(String).filter(p => CLEAN_EXT.test(p) && path.isAbsolute(p))) out.push(await recycle.restoreFromRecycleBin(p));
    log('INFO', 'limpieza', `Devueltos de la Papelera: ${out.filter(x => x.how === 'restored').length}/${out.length}`);
    return out;
  });
  const dropArt = async (id) => { if (!/^[a-z0-9_-]+$/i.test(String(id || ''))) return; for (const e of ['.jpg', '.none']) await fsp.unlink(path.join(dataDir(), 'art', id + e)).catch(() => {}); };
  // writes: [{ id, path, fields, cover: releaseId }] → [{ id, path, ok, error, size, backup, cover }]
  ipcMain.handle('cleanup:writeTags', async (_e, opId, writes) => {
    if (!/^[a-z0-9_-]+$/i.test(String(opId || ''))) throw new Error('Operación no válida');
    const dir = path.join(cleanupDir(), 'etiquetas', opId);
    const out = [];
    let n = 0;
    for (const w of writes || []) {
      const p = String(w.path || '');
      const fields = {};
      for (const k of ['title', 'artist', 'album', 'year', 'genre']) if (w.fields && w.fields[k] != null) fields[k] = String(w.fields[k]).slice(0, 500);
      let cover = null;
      if (w.cover) { try { const b = await mb().cover(String(w.cover)); if (b) cover = { data: b, mime: b[0] === 0xff ? 'image/jpeg' : 'image/png' }; } catch (_) { /* sin carátula */ } }
      const r = await tagWriter.writeTags(p, fields, { cover, backupBase: path.join(dir, String(++n)) });
      if (r.ok && cover) await dropArt(w.id);
      out.push({ id: w.id, path: p, ok: r.ok, error: r.error || '', size: r.size || 0, backup: r.ok ? `${opId}/${n}` : '', cover: !!(r.ok && cover) });
      sendCleanup({ t: 'write', done: out.length, total: writes.length });
    }
    log('INFO', 'limpieza', `Etiquetas escritas: ${out.filter(x => x.ok).length}/${out.length} archivos`);
    return out;
  });
  ipcMain.handle('cleanup:restoreTags', async (_e, items) => {
    const out = [];
    for (const it of items || []) {
      const b = String(it.backup || '');
      if (!/^[a-z0-9_-]+\/\d+$/i.test(b)) { out.push({ path: it.path, ok: false, error: 'copia no válida' }); continue; }
      const r = await tagWriter.restoreTags(String(it.path || ''), path.join(cleanupDir(), 'etiquetas', ...b.split('/')));
      if (r.ok) await dropArt(it.id);
      out.push({ id: it.id, path: it.path, ok: r.ok, error: r.error || '', size: r.size || 0 });
    }
    log('INFO', 'limpieza', `Etiquetas originales devueltas: ${out.filter(x => x.ok).length}/${out.length} archivos`);
    return out;
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
// Aceleración por GPU (Ajustes → Audio → Rendimiento): composición, canvas 2D y rasterización
function gpuStatus() {
  try {
    const s = app.getGPUFeatureStatus();
    const on = (v) => /^enabled/.test(String(v || ''));
    return { compositing: on(s.gpu_compositing), canvas2d: on(s['2d_canvas']), raster: on(s.rasterization) };
  } catch (_) { return null; }
}

// Escrituras de data/<nombre>.json en cola por archivo: dos guardados seguidos (p. ej. uno diferido y el de
// cerrar la app) no se pisan el archivo temporal y siempre gana el último que ha llegado
const storeQueue = new Map();
function storeWrite(name, text) {
  const file = path.join(dataDir(), name + '.json'), tmp = file + '.tmp';
  const job = (storeQueue.get(name) || Promise.resolve()).catch(() => {}).then(async () => {
    if (storeLocked) return false;
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, file);
    return true;
  });
  storeQueue.set(name, job);
  job.finally(() => { if (storeQueue.get(name) === job) storeQueue.delete(name); }).catch(() => {});
  return job;
}
const storeIdle = () => Promise.all([...storeQueue.values()].map(p => p.catch(() => {})));

// Antes de cerrar la ventana (o reiniciar) se pide a la interfaz que guarde lo pendiente (biblioteca con
// guardado diferido y ajustes) y se espera a que esté escrito en disco; como mucho `ms`
let flushSeq = 0, closeFlushed = false;
function flushRenderer(ms = 4000) {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!wc || wc.isCrashed()) return storeIdle();
  const id = ++flushSeq;
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); ipcMain.removeListener('app:flushed', on); resolve(); };
    const on = (_e, rid) => { if (rid === id) done(); };
    const t = setTimeout(() => { log('WARN', 'main', 'La interfaz no ha confirmado el guardado al cerrar'); done(); }, ms);
    ipcMain.on('app:flushed', on);
    wc.send('app:flush', id);
  }).then(storeIdle);
}

// Analizador en segundo plano: ventana oculta (src/analysis.html, su propio proceso) que lee, decodifica y analiza
// las pistas del análisis por lotes sin pasar el audio por la interfaz. Se crea al primer trabajo y se cierra
// tras 60 s sin trabajo. Si falla, la interfaz analiza como antes (app.analyzeOne).
let anaWin = null, anaReady = null, anaSeq = 0, anaIdle = null;
const anaJobs = new Map();
function anaFailAll(msg) { for (const j of anaJobs.values()) j.reject(new Error(msg)); anaJobs.clear(); }
function analysisWindow() {
  if (anaWin && !anaWin.isDestroyed()) return anaReady;
  const w = anaWin = new BrowserWindow({
    show: false, width: 320, height: 200, title: APP_NAME + ' · análisis',
    webPreferences: { preload: path.join(__dirname, 'main', 'analysis-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  w.webContents.on('render-process-gone', (_e, d) => { log('ERROR', 'analisis', `El analizador en segundo plano se ha cerrado (${d.reason})`); anaFailAll('El analizador se ha cerrado'); if (!w.isDestroyed()) w.destroy(); });
  w.on('closed', () => { if (anaWin === w) anaWin = null; anaFailAll('El analizador se ha cerrado'); });
  anaReady = w.loadURL(`http://localhost:${serverPort}/analysis.html`).then(() => w);
  anaReady.catch(() => { if (!w.isDestroyed()) w.destroy(); });
  return anaReady;
}
function registerAnalysisIpc() {
  ipcMain.handle('analysis:run', async (_e, job) => {
    clearTimeout(anaIdle);
    const w = await analysisWindow();
    const id = ++anaSeq;
    try {
      return await new Promise((resolve, reject) => {
        anaJobs.set(id, { resolve, reject });
        w.webContents.send('analysis:job', { id, path: String((job && job.path) || ''), url: `/__audio/${AUDIO_TOKEN}`, sr: Number(job && job.sr) || 48000, opts: (job && job.opts) || {} });
      });
    } finally {
      if (!anaJobs.size) anaIdle = setTimeout(() => { if (anaWin && !anaWin.isDestroyed()) anaWin.destroy(); }, 60000);
    }
  });
  ipcMain.on('analysis:done', (e, m) => {
    if (!anaWin || anaWin.isDestroyed() || e.sender !== anaWin.webContents || !m) return;
    const j = anaJobs.get(m.id);
    if (!j) return;
    anaJobs.delete(m.id);
    if (m.ok) j.resolve({ result: m.result, duration: m.duration }); else j.reject(new Error(String(m.error || 'error')));
  });
}

// Diagnóstico de rendimiento del equipo para el informe (sin datos personales: modelos y números)
const GPU_VENDORS = { 0x1002: 'AMD', 0x1022: 'AMD', 0x10de: 'NVIDIA', 0x8086: 'Intel', 0x1414: 'Microsoft (software)', 0x5143: 'Qualcomm' };
async function systemPerf() {
  const cpus = os.cpus() || [];
  let gpus = [];
  try {
    const g = await app.getGPUInfo('basic');
    gpus = (g.gpuDevice || []).map(d => ({ vendor: GPU_VENDORS[d.vendorId] || '0x' + Number(d.vendorId || 0).toString(16), device: '0x' + Number(d.deviceId || 0).toString(16), driver: String(d.driverVersion || ''), active: !!d.active }));
  } catch (_) { /* sin información */ }
  return {
    cpu: String((cpus[0] && cpus[0].model) || '').replace(/\s+/g, ' ').trim(), threads: cpus.length, mhz: (cpus[0] && cpus[0].speed) || 0,
    ramGB: Math.round(os.totalmem() / 1073741824), gpus, gpuStatus: gpuStatus(), gpuSetting: GPU_OFF ? 'off' : 'auto', electron: process.versions.electron
  };
}

function registerIpc() {
  registerStemsIpc();
  registerAnalysisIpc();
  registerCleanupIpc();
  ipcMain.handle('app:info', () => ({
    os: `${os.type()} ${os.release()} (${os.arch()})`, electron: process.versions.electron,
    isBeta: /beta|alpha|rc/i.test(app.getVersion()), osLabel: OS_LABEL, store: !!process.windowsStore,
    services: { feedback: !!FEEDBACK_URL, stats: !!STATS_URL, search: !!SEARCH_URL }, updates: !!(updater && updater.status().state !== 'disabled'),
    version: app.getVersion(), name: APP_NAME, platform: process.platform, gpu: gpuStatus(), gpuOff: GPU_OFF, audioUrl: `/__audio/${AUDIO_TOKEN}`,
    userData: app.getPath('userData'), recordings: recDir()
  }));

  // ---- Aceleración por GPU: 'auto' | 'off' en arranque.json (se aplica al reiniciar)
  const gpuState = () => ({ setting: readJsonFile(bootFile()).gpu === 'off' ? 'off' : 'auto', offNow: GPU_OFF, status: gpuStatus() });
  ipcMain.handle('gpu:get', () => gpuState());
  ipcMain.handle('gpu:set', async (_e, v) => {
    const boot = { ...readJsonFile(bootFile()), gpu: v === 'off' ? 'off' : 'auto' };
    await fsp.writeFile(bootFile(), JSON.stringify(boot, null, 2));
    log('INFO', 'main', `Aceleración por GPU: ${boot.gpu === 'off' ? 'desactivada' : 'automática'} (al reiniciar)`);
    return gpuState();
  });
  // Reiniciar ahora (tras cambiar la aceleración por GPU): guarda lo pendiente y vuelve a abrir la app
  ipcMain.handle('app:relaunch', async () => {
    await flushRenderer();
    closeFlushed = true;
    app.relaunch();
    app.quit();
    return true;
  });

  ipcMain.handle('dialog:openFiles', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Añadir pistas', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map(e => e.slice(1)) }]
    });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(fileInfo));
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Añadir carpeta', properties: ['openDirectory'] });
    if (r.canceled) return [];
    const files = await scanFolder(r.filePaths[0]);
    const out = [];
    for (const f of files) { try { out.push(await fileInfo(f)); } catch (_) { /* skip */ } }
    return out;
  });
  // «+ Carpeta» con crates por carpeta: árbol de la carpeta elegida (o null)
  ipcMain.handle('dialog:openFolderTree', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Añadir carpeta', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return audioTreeFor([r.filePaths[0]]);
  });
  ipcMain.handle('fs:listAudioTree', async (_e, paths) => audioTreeFor((paths || []).map(String)));

  ipcMain.handle('dialog:openSample', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Cargar muestra', properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map(e => e.slice(1)) }]
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // Biblioteca de otro programa DJ (colección XML / NML): devuelve ruta y texto
  // Colecciones y listas de otros programas DJ: varios archivos a la vez; devuelve sus bytes
  ipcMain.handle('dialog:openLibraryFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar biblioteca o listas de otro programa DJ', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Colecciones y listas', extensions: ['xml', 'nml', 'vdjfolder', 'm3u', 'm3u8', 'crate'] }]
    });
    if (r.canceled) return null;
    const out = [];
    for (const p of r.filePaths) {
      const st = await fsp.stat(p);
      if (st.size > 300 * 1024 * 1024) throw new Error('Archivo demasiado grande: ' + path.basename(p));
      const buf = await fsp.readFile(p);
      out.push({ path: p, name: path.basename(p), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) });
    }
    return out;
  });
  // Primeros bytes de un archivo de audio (etiquetas ID3 / bloques FLAC con cues y beatgrid)
  ipcMain.handle('fs:readHead', async (_e, p, n) => {
    const fh = await fsp.open(p, 'r');
    try {
      const len = Math.max(0, Math.min(Number(n) || 0, 32 * 1024 * 1024));
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally { await fh.close(); }
  });

  ipcMain.handle('fs:infoForPaths', async (_e, paths) => {
    const out = [];
    for (const p of paths || []) {
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) { for (const f of await scanFolder(p)) out.push(await fileInfo(f)); }
        else if (AUDIO_EXT.has(path.extname(p).toLowerCase())) out.push(await fileInfo(p));
      } catch (_) { /* skip */ }
    }
    return out;
  });

  ipcMain.handle('fs:readFile', async (_e, p) => {
    const buf = await fsp.readFile(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('fs:exists', async (_e, p) => { try { await fsp.access(p); return true; } catch (_) { return false; } });
  // Comprobación por lotes de archivos perdidos: [ruta] → [true/false]
  ipcMain.handle('fs:existsMany', async (_e, paths) => Promise.all((paths || []).slice(0, 2000).map(p => fsp.access(String(p)).then(() => true, () => false))));

  // Listas .m3u / .m3u8 (botón de la barra lateral de la biblioteca): devuelve sus bytes
  ipcMain.handle('dialog:openPlaylist', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar lista M3U', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Listas M3U', extensions: ['m3u', 'm3u8'] }]
    });
    if (r.canceled) return null;
    const out = [];
    for (const p of r.filePaths) {
      const st = await fsp.stat(p);
      if (st.size > 50 * 1024 * 1024) throw new Error('Lista demasiado grande: ' + path.basename(p));
      const buf = await fsp.readFile(p);
      out.push({ path: p, name: path.basename(p), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) });
    }
    return out;
  });

  // Relocalizar archivos perdidos: el usuario elige una carpeta y se buscan (en subcarpetas) los
  // archivos con esos nombres. Devuelve { dir, files: [{ path, size }] } o null si cancela.
  ipcMain.handle('dialog:findFiles', async (_e, names) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Carpeta donde buscar los archivos perdidos', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const want = new Set((names || []).map(n => String(n).toLowerCase()));
    const files = [];
    let seen = 0;
    const walk = async (dir, depth) => {
      if (depth > 16 || seen > 500000) return;
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('$')) await walk(full, depth + 1); continue; }
        seen++;
        if (!want.has(e.name.toLowerCase())) continue;
        try { files.push({ path: full, size: (await fsp.stat(full)).size }); } catch (_) { /* skip */ }
      }
    };
    await walk(r.filePaths[0], 0);
    return { dir: r.filePaths[0], files };
  });

  // Carátula en miniatura (JPEG de 96 px como data: URL) con caché en userData/data/art
  ipcMain.handle('art:get', async (_e, id, p) => {
    if (!/^[a-z0-9_-]+$/i.test(String(id || '')) || !p) return null;
    const dir = path.join(dataDir(), 'art');
    const jpg = path.join(dir, id + '.jpg'), none = path.join(dir, id + '.none');
    try { return 'data:image/jpeg;base64,' + (await fsp.readFile(jpg)).toString('base64'); } catch (_) { /* sin caché */ }
    if (fs.existsSync(none)) return null;
    await fsp.mkdir(dir, { recursive: true });
    const pic = await readCover(p);
    let img = pic ? nativeImage.createFromBuffer(pic.data) : null;
    if (!img || img.isEmpty()) { if (fs.existsSync(p)) await fsp.writeFile(none, ''); return null; }
    const { width, height } = img.getSize(), k = 96 / Math.max(width, height, 1);
    if (k < 1) img = img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' });
    const out = img.toJPEG(82);
    await fsp.writeFile(jpg, out);
    return 'data:image/jpeg;base64,' + out.toString('base64');
  });

  ipcMain.handle('store:get', async (_e, name) => {
    if (!/^[a-z0-9_-]+$/i.test(name)) return null;
    try { return JSON.parse(await fsp.readFile(path.join(dataDir(), name + '.json'), 'utf8')); } catch (_) { return null; }
  });
  // data: texto JSON (lo normal: la interfaz ya lo prepara a trozos sin bloquearse) u objeto (versiones antiguas)
  ipcMain.handle('store:set', async (_e, name, data) => {
    if (!/^[a-z0-9_-]+$/i.test(name) || storeLocked) return false;
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    if (!/^\s*[[{]/.test(text)) return false;
    return storeWrite(name, text);
  });

  ipcMain.handle('wave:get', async (_e, id) => {
    if (!/^[a-z0-9_-]+$/i.test(id)) return null;
    try { const b = await fsp.readFile(path.join(waveDir(), id + '.bin')); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    catch (_) { return null; }
  });
  ipcMain.handle('wave:set', async (_e, id, data) => {
    if (!/^[a-z0-9_-]+$/i.test(id)) return false;
    await fsp.writeFile(path.join(waveDir(), id + '.bin'), Buffer.from(data));
    return true;
  });

  ipcMain.handle('rec:save', async (_e, data, name) => {
    await fsp.mkdir(recDir(), { recursive: true });
    const safe = String(name || 'Nexura-set').replace(/[^a-z0-9 _.-]/gi, '_');
    const file = path.join(recDir(), safe.endsWith('.wav') ? safe : safe + '.wav');
    await fsp.writeFile(file, Buffer.from(data));
    return file;
  });
  ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); return true; });
  // ---- Registro técnico: líneas de la interfaz (errores de JS, promesas, audio, MIDI…)
  ipcMain.on('log:write', (_e, lines) => {
    for (const l of (Array.isArray(lines) ? lines : []).slice(0, 50)) log(l && l.level, 'ui:' + String((l && l.source) || 'app').slice(0, 14), l && l.msg);
  });
  ipcMain.handle('log:openFolder', () => shell.openPath(path.join(app.getPath('userData'), 'logs')));

  // ---- Copias de seguridad de la biblioteca (main/backup.js)
  ipcMain.handle('backup:list', () => ({ dir: copiasDir(), list: backup.listBackups(copiasDir()) }));
  // reason: 'manual' (Ajustes) o 'limpieza' (justo antes de aplicar cambios de «Limpiar biblioteca»)
  ipcMain.handle('backup:create', (_e, reason) => {
    const why = reason === 'limpieza' ? 'limpieza' : 'manual';
    const r = backupNow(why);
    if (r.skipped === 'danada') throw new Error('La biblioteca actual está dañada: no se copia para no desplazar las copias buenas.');
    if (r.skipped) throw new Error('Todavía no hay biblioteca que copiar.');
    log('INFO', 'copias', (why === 'limpieza' ? 'Copia antes de limpiar ' : 'Copia manual ') + r.name);
    return r;
  });
  // Restaurar: copia del estado actual, sustituir los datos y reiniciar la app (sin dejar que la interfaz
  // guarde encima lo que tiene en memoria)
  ipcMain.handle('backup:restore', async (_e, name) => {
    storeLocked = true;
    try {
      const r = backup.restoreBackup(dataDir(), copiasDir(), String(name || ''), { version: app.getVersion() });
      log('INFO', 'copias', `Restaurada la copia ${name} (antes: ${r.before})`);
      setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
      return r;
    } catch (e) { storeLocked = false; throw e; }
  });
  ipcMain.handle('backup:openFolder', async () => { await fsp.mkdir(copiasDir(), { recursive: true }); return shell.openPath(copiasDir()); });

  // ---- Informe de errores y sugerencias (main/report.js)
  // info: { kind, text, email, attach, controller, decks, known: [títulos/artistas/archivos a ocultar] }
  const techFor = async (info) => report.technical({
    version: app.getVersion(), os: `${OS_LABEL} (${os.release()}, ${os.arch()})`, controller: info.controller, decks: info.decks,
    log: logger ? logger.tail(report.LOG_LINES) : [], known: info.known, user: os.userInfo().username, home: os.homedir(),
    perf: { system: await systemPerf(), app: info.perf }
  });
  ipcMain.handle('report:preview', async (_e, info) => { const t = await techFor(info || {}); return { ...t, perfLines: report.perfText(t.perf) }; });
  ipcMain.handle('report:send', async (_e, info) => {
    info = info || {};
    // sugerencias que quedaron en cola en la beta: se envían tal cual (sin alternativa)
    if (info.legacy) {
      if (!FEEDBACK_URL) return { ok: false };
      const r = await fetch(FEEDBACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: APP_NAME, ...info.legacy }) }).catch(() => null);
      return { ok: !!(r && r.ok) };
    }
    const tech = info.attach ? await techFor(info) : null;
    const payload = report.buildPayload({ kind: info.kind, text: info.text, email: info.email, attach: !!info.attach, tech, version: app.getVersion() });
    if (FEEDBACK_URL) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(FEEDBACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) { log('INFO', 'informe', 'Informe enviado'); return { ok: true, via: 'web' }; }
        log('WARN', 'informe', 'El servicio de informes respondió HTTP ' + r.status);
      } catch (e) { log('WARN', 'informe', 'Sin conexión con el servicio de informes'); }
    }
    // alternativa: guardar el informe en un .txt y abrir el correo con el texto
    await fsp.mkdir(reportsDir(), { recursive: true });
    const file = path.join(reportsDir(), `informe-${backup.folderName(new Date())}.txt`);
    const txt = report.reportText({ kind: payload.type, text: payload.message, email: payload.email, tech }).replace(/\n/g, '\r\n');
    await fsp.writeFile(file, '﻿' + txt);
    shell.openExternal(report.mailtoUrl({ kind: payload.type, text: payload.message, email: payload.email, file: tech ? file : '' })).catch(() => {});
    if (tech) shell.showItemInFolder(file);
    return { ok: false, via: 'mail', file };
  });

  // ---- Contador anónimo de uso (main/stats.js): solo con statsUrl y permiso del usuario
  ipcMain.handle('stats:send', async (_e, info) => {
    info = info || {};
    const r = await stats.sendStats({
      url: STATS_URL, enabled: info.enabled === true, file: path.join(dataDir(), 'instalacion.id'),
      data: { version: app.getVersion(), lang: app.getLocale(), os: OS_LABEL, decks: info.decks, controller: info.controller }
    });
    if (r.sent) log('INFO', 'estadisticas', 'Estadísticas anónimas enviadas');
    return { sent: r.sent, reason: r.reason };
  });
  // Lo que se enviaría (para enseñarlo en Ajustes), sin enviar nada
  ipcMain.handle('stats:preview', (_e, info) => stats.buildPayload({ id: '00000000-0000-4000-8000-000000000000', version: app.getVersion(), lang: app.getLocale(), os: OS_LABEL, decks: (info || {}).decks, controller: (info || {}).controller }));

  // ---- Actualizaciones (main/updater.js)
  ipcMain.handle('update:configure', (_e, cfg) => { updater.configure(cfg || {}); return updater.status(); });
  ipcMain.handle('update:check', () => updater.check(true));
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (externalAllowed(url) || /^mailto:contacto@nexuraia\.com\?/.test(url)) { shell.openExternal(url); return true; }
    return false;
  });

  // Spotify (solo metadatos)
  ipcMain.handle('spotify:embed', async (_e, type, id) => spotifyEmbed(type, id));
  ipcMain.handle('spotify:api', async (_e, url) => spotifyApi(String(url || '')));
  ipcMain.handle('spotify:login', async (_e, clientId) => spotifyLogin(String(clientId || '').trim()));
  ipcMain.handle('spotify:logout', async () => { spTokens = null; await saveSpotify(); return true; });
  ipcMain.handle('spotify:status', async () => ({ connected: !!(spTokens && spTokens.refresh_token), user: (spTokens && spTokens.user) || '', redirectUri: SPOTIFY_REDIRECT }));

  // YouTube
  ipcMain.handle('yt:oembed', async (_e, videoId) => {
    if (!/^[\w-]{6,20}$/.test(videoId)) return null;
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId));
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  });
  ipcMain.handle('yt:api', async (_e, endpoint, params, apiKey) => {
    if (!/^[a-zA-Z]+$/.test(endpoint)) throw new Error('Endpoint no válido');
    const q = new URLSearchParams(params || {});
    const headers = {};
    let token = null;
    try { token = await ytAccessToken(); } catch (_) { token = null; }
    if (token) headers.Authorization = 'Bearer ' + token;
    else if (apiKey) q.set('key', apiKey);
    else throw new Error('Necesitas una clave de API de YouTube o conectar tu cuenta de Google en Ajustes');
    let r;
    try { r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${q}`, { headers }); } catch (_) { throw new Error(ytSearch.MSG.net); }
    let j = null;
    try { j = await r.json(); } catch (_) { j = null; }
    if (!r.ok) throw new Error(ytSearch.ytErrorInfo(r.status, j).message);
    return j;
  });
  // Búsqueda por el servicio de NexuraIA (sin clave propia): solo el texto, el nº de resultados y el id anónimo
  // de la instalación (data/instalacion.id, el del contador; se crea aunque las estadísticas estén desactivadas)
  ipcMain.handle('yt:search', async (_e, q, max) => {
    const id = stats.loadState(path.join(dataDir(), 'instalacion.id')).id;
    try { return { items: await ytSearch.serviceSearch({ url: SEARCH_URL, id, q, max }) }; } catch (e) {
      log(e.code === 'limit' ? 'INFO' : 'WARN', 'youtube', 'Búsqueda por el servicio: ' + (e.code || 'error') + (e.status ? ' HTTP ' + e.status : ''));
      return { error: e.code || 'down', message: e.message };
    }
  });
  ipcMain.handle('yt:checkKey', async (_e, key) => ytSearch.checkKey(key));
  ipcMain.handle('yt:login', async (_e, clientId, clientSecret) => ytOAuthLogin(clientId, clientSecret));
  ipcMain.handle('yt:logout', async () => { ytTokens = null; await saveSecrets(); return true; });
  ipcMain.handle('yt:status', async () => ({ connected: !!(ytTokens && ytTokens.refresh_token) }));
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------
function setupPermissions() {
  const allowed = new Set(['midi', 'midiSysex', 'media', 'speaker-selection', 'fullscreen']);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680, height: 1000, minWidth: 900, minHeight: 600,
    backgroundColor: '#07080d', title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false
    }
  });
  Menu.setApplicationMenu(null);
  // Cerrar: primero la interfaz guarda lo pendiente (biblioteca con guardado diferido, ajustes) y se espera a
  // que esté en disco; después se cierra de verdad
  const win = mainWindow;
  // la ventana oculta de análisis no debe mantener la app abierta
  win.on('closed', () => { if (anaWin && !anaWin.isDestroyed()) anaWin.destroy(); });
  win.on('close', (e) => {
    if (closeFlushed) return;
    e.preventDefault();
    flushRenderer().finally(() => { closeFlushed = true; if (!win.isDestroyed()) win.close(); });
  });
  mainWindow.webContents.on('render-process-gone', (_e, d) => log('ERROR', 'main', `La interfaz se cerró inesperadamente (${d.reason}, código ${d.exitCode})`));
  mainWindow.webContents.on('unresponsive', () => log('WARN', 'main', 'La interfaz no responde'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  closeFlushed = false;
  await mainWindow.loadURL(`http://localhost:${serverPort}/index.html`);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') log('ERROR', 'main', `Proceso ${d.type}${d.name ? ' (' + d.name + ')' : ''} terminado: ${d.reason}`); });

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(async () => {
  await ensureDirs();
  log('INFO', 'main', `Inicio ${APP_NAME} ${app.getVersion()} · ${OS_LABEL} ${os.release()} · Electron ${process.versions.electron}`);
  await startupBackup();
  setupUpdater();
  await loadSecrets();
  await loadSpotify();
  setupPermissions();
  registerIpc();
  serverPort = await startStaticServer();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
