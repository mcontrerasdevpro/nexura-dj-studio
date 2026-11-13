// Copias de seguridad de la biblioteca: los JSON de <datos de usuario>\data (library.json = pistas, cues,
// beatgrid, crates, Prepare, historial; settings.json = ajustes) se copian a
// <datos de usuario>\copias\AAAA-MM-DD_HHMM\ con un copia.json que describe la copia. Se conservan las 14
// más recientes. Las formas de onda, carátulas y stems no se copian: se regeneran solas.
// Sin dependencias de Electron (se prueba en Node: tools/test-copias.mjs).
'use strict';
const fs = require('fs');
const path = require('path');

const KEEP = 14;
const MANIFEST = 'copia.json';
const CRITICAL = ['library.json', 'settings.json'];
const pad = (n) => String(n).padStart(2, '0');
const folderName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const dayOf = (d) => folderName(d).slice(0, 10);

// ¿Se puede leer este JSON? (un archivo vacío o cortado a medias no vale)
function readJson(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    if (!txt.trim()) return { ok: false, error: 'vacío' };
    return { ok: true, data: JSON.parse(txt) };
  } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'no existe' : e.message }; }
}

// Archivos que se copian: los .json de la carpeta de datos (no los temporales)
function dataFiles(dataDir) {
  try {
    return fs.readdirSync(dataDir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.json$/i.test(e.name) && !/\.tmp$/i.test(e.name) && !/\.danada-/.test(e.name))
      .map(e => e.name).sort();
  } catch (_) { return []; }
}

// Estado de los datos actuales: { ok, damaged: [nombres], exists }
function checkHealth(dataDir) {
  const damaged = [];
  let exists = false;
  for (const name of CRITICAL) {
    const f = path.join(dataDir, name);
    if (!fs.existsSync(f)) continue;
    exists = true;
    if (!readJson(f).ok) damaged.push(name);
  }
  return { ok: !damaged.length, damaged, exists };
}

function dirSize(dir) {
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile()) n += fs.statSync(path.join(dir, e.name)).size; } catch (_) { /* nada */ }
  return n;
}

// Lista de copias, de la más reciente a la más antigua: [{ name, date, size, ok, reason, version, tracks }]
function listBackups(copiasDir) {
  let entries = [];
  try { entries = fs.readdirSync(copiasDir, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(e.name)); } catch (_) { return []; }
  return entries.map(e => {
    const dir = path.join(copiasDir, e.name);
    const m = readJson(path.join(dir, MANIFEST));
    const man = m.ok ? m.data : {};
    const lib = fs.existsSync(path.join(dir, 'library.json'));
    return {
      name: e.name, date: man.date || null, size: dirSize(dir), reason: man.reason || 'auto', version: man.version || '',
      tracks: man.tracks ?? null, ok: man.ok !== false && lib
    };
  }).sort((a, b) => (b.date || b.name).localeCompare(a.date || a.name) || b.name.localeCompare(a.name));
}

function prune(copiasDir, keep = KEEP) {
  const list = listBackups(copiasDir);
  const removed = [];
  for (const b of list.slice(keep)) {
    try { fs.rmSync(path.join(copiasDir, b.name), { recursive: true, force: true }); removed.push(b.name); } catch (_) { /* en uso */ }
  }
  return removed;
}

// Hace una copia. reason: auto | manual | actualizacion | antes-de-restaurar | limpieza.
// Con la biblioteca dañada no se hace (salvo allowDamaged): una copia mala desplazaría a las buenas.
function makeBackup(dataDir, copiasDir, { reason = 'manual', version = '', now = new Date(), keep = KEEP, allowDamaged = false } = {}) {
  const files = dataFiles(dataDir);
  if (!files.includes('library.json')) return { skipped: 'sin-biblioteca' };
  const health = checkHealth(dataDir);
  if (!health.ok && !allowDamaged) return { skipped: 'danada', damaged: health.damaged };
  fs.mkdirSync(copiasDir, { recursive: true });
  let name = folderName(now), i = 2;
  while (fs.existsSync(path.join(copiasDir, name))) name = `${folderName(now)}-${i++}`;
  const dir = path.join(copiasDir, name), tmp = dir + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const out = [];
  for (const f of files) {
    fs.copyFileSync(path.join(dataDir, f), path.join(tmp, f));
    out.push({ name: f, size: fs.statSync(path.join(tmp, f)).size });
  }
  const lib = readJson(path.join(tmp, 'library.json'));
  const tracks = lib.ok && Array.isArray(lib.data.tracks) ? lib.data.tracks.length : null;
  fs.writeFileSync(path.join(tmp, MANIFEST), JSON.stringify({ date: now.toISOString(), reason, version, ok: health.ok, tracks, files: out }, null, 2));
  fs.renameSync(tmp, dir); // la copia solo aparece cuando está completa
  const removed = prune(copiasDir, keep);
  return { name, dir, size: dirSize(dir), tracks, removed };
}

// Copia automática al arrancar: como mucho una al día
function autoBackup(dataDir, copiasDir, { version = '', now = new Date(), keep = KEEP } = {}) {
  const today = dayOf(now);
  const done = listBackups(copiasDir).some(b => b.reason === 'auto' && (b.date ? dayOf(new Date(b.date)) : b.name.slice(0, 10)) === today);
  if (done) return { skipped: 'hoy' };
  return makeBackup(dataDir, copiasDir, { reason: 'auto', version, now, keep });
}

function latestGood(copiasDir) {
  return listBackups(copiasDir).find(b => b.ok) || null;
}

// Restaura una copia: antes copia el estado actual (aunque esté dañado, para no perder nada) y después
// sustituye los archivos de datos por los de la copia (escritura atómica: .tmp + rename).
function restoreBackup(dataDir, copiasDir, name, { version = '', now = new Date(), keep = KEEP } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(String(name || ''))) throw new Error('Copia no válida');
  const src = path.join(copiasDir, name);
  if (!fs.existsSync(path.join(src, 'library.json'))) throw new Error('La copia no contiene la biblioteca');
  for (const f of dataFiles(src).filter(f => f !== MANIFEST)) {
    if (!readJson(path.join(src, f)).ok) throw new Error(`La copia está dañada (${f})`);
  }
  const before = makeBackup(dataDir, copiasDir, { reason: 'antes-de-restaurar', version, now, keep: keep + 1, allowDamaged: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const restored = [];
  for (const f of dataFiles(src).filter(f => f !== MANIFEST)) {
    const dst = path.join(dataDir, f), tmp = dst + '.tmp';
    fs.copyFileSync(path.join(src, f), tmp);
    fs.renameSync(tmp, dst);
    restored.push(f);
  }
  // la copia restaurada no debe desaparecer al podar por la copia «antes de restaurar»
  prune(copiasDir, keep + 1);
  return { restored, before: before.name || null };
}

// Biblioteca dañada al arrancar y el usuario prefiere empezar de cero: se aparta (no se borra)
function setAsideDamaged(dataDir, names, now = new Date()) {
  const moved = [];
  for (const n of names) {
    const f = path.join(dataDir, n);
    if (!fs.existsSync(f)) continue;
    const to = path.join(dataDir, n.replace(/\.json$/i, `.danada-${folderName(now)}.json`));
    fs.renameSync(f, to);
    moved.push(path.basename(to));
  }
  return moved;
}

module.exports = { KEEP, folderName, checkHealth, listBackups, makeBackup, autoBackup, latestGood, restoreBackup, prune, setAsideDamaged, dataFiles };
