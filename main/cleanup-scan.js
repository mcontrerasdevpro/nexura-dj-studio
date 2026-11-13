// «Limpiar biblioteca» — análisis de los archivos (sin Electron; se prueba en Node: tools/test-limpieza.mjs).
// Para cada pista local: existe o no, formato y calidad, etiquetas del archivo (main/audio-probe.js) y, solo si
// hace falta, la huella de sus datos de audio para encontrar duplicados exactos:
//   1) mismo tamaño de audio → 2) SHA-1 del primer y último MB → 3) si coinciden, SHA-1 completo.
// Caché por archivo (ruta + tamaño + fecha) en un NDJSON: la segunda vez casi no se lee nada. Se puede cancelar
// en cualquier momento (lo hecho queda en la caché y la siguiente vez sigue por donde iba) y bajar la prioridad
// mientras suena música (una lectura cada vez, con pausas).
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { probeFile } = require('./audio-probe');

const VERSION = 2;            // sube si cambia lo que se guarda por archivo (invalida la caché)
const MB = 1024 * 1024;
const keyOf = (p, size, mtime) => `${String(p).toLowerCase()}|${size}|${Math.round(mtime)}`;

// ------------------------------------------------------------------ caché
function createCache(file) {
  const map = new Map();
  let lines = 0, fd = null;
  if (file) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        lines++;
        try { const r = JSON.parse(line); if (r && r.k && r.v === VERSION) map.set(r.k, r); } catch (_) { /* línea cortada al cerrar: se repite */ }
      }
    } catch (_) { /* sin caché todavía */ }
  }
  return {
    get: (k) => map.get(k) || null,
    set(k, rec) {
      const r = { ...rec, k, v: VERSION };
      map.set(k, r);
      if (!file) return;
      try { if (fd == null) fd = fs.openSync(file, 'a'); fs.writeSync(fd, JSON.stringify(r) + '\n'); lines++; } catch (_) { /* disco lleno: se sigue sin caché */ }
    },
    // reescribe el archivo solo con lo vigente cuando tiene muchas líneas repetidas
    compact(keep = null) {
      if (!file) return;
      this.close();
      if (keep) for (const k of [...map.keys()]) if (!keep.has(k)) map.delete(k);
      if (lines <= map.size * 2 + 200 && !keep) return;
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, [...map.values()].map(r => JSON.stringify(r)).join('\n') + '\n');
      fs.renameSync(tmp, file);
      lines = map.size;
    },
    close() { if (fd != null) { try { fs.closeSync(fd); } catch (_) { /* nada */ } fd = null; } },
    get size() { return map.size; }
  };
}

// ------------------------------------------------------------------ huellas
async function hashPart(file, start, end) {
  const fh = await fsp.open(file, 'r');
  try {
    const len = end - start, h = crypto.createHash('sha1').update(String(len));
    const read = async (pos, n) => { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, pos); h.update(b.subarray(0, bytesRead)); };
    if (len <= 2 * MB) await read(start, len);
    else { await read(start, MB); await read(end - MB, MB); }
    return h.digest('hex');
  } finally { await fh.close(); }
}
function hashFull(file, start, end) {
  return new Promise((resolve, reject) => {
    if (end <= start) return resolve(crypto.createHash('sha1').update('0').digest('hex'));
    const h = crypto.createHash('sha1').update(String(end - start));
    fs.createReadStream(file, { start, end: end - 1, highWaterMark: MB }).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

const DEFAULT_DEPS = {
  stat: (p) => fsp.stat(p),
  probe: probeFile,
  hashPart, hashFull,
  sleep: (ms) => new Promise(r => setTimeout(r, ms))
};

// Lo que se devuelve a la interfaz por cada pista (sin campos internos de la caché)
function publicRec(id, p, r) {
  if (!r || r.missing) return { id, path: p, missing: true };
  const { k, v, ...rest } = r;
  return { id, path: p, ...rest };
}

// entries: [{ id, path }]. opts: { cache, onProgress(ev), cancelled(), priority() → 'low'|'normal', deps }
// Devuelve { records: [rec por entrada, en el mismo orden], cancelled, stats }
async function scanEntries(entries, opts = {}) {
  const deps = { ...DEFAULT_DEPS, ...(opts.deps || {}) };
  const cache = opts.cache || createCache(null);
  const cancelled = opts.cancelled || (() => false);
  const prio = opts.priority || (() => 'normal');
  const stats = { total: entries.length, cached: 0, probed: 0, missing: 0, partial: 0, full: 0, ms: 0 };
  const t0 = Date.now();
  let last = 0;
  const progress = (phase, done, total, force = false) => {
    const now = Date.now();
    if (!opts.onProgress || (!force && now - last < 150)) return;
    last = now;
    opts.onProgress({ t: 'progress', phase, done, total, cached: stats.cached });
  };
  const recs = new Array(entries.length).fill(null);
  const keys = new Array(entries.length).fill(null);

  // trabajo con concurrencia limitada; con prioridad baja (suena música), de uno en uno y con pausas
  async function pool(list, fn, phase) {
    let i = 0, done = 0;
    const worker = async (n) => {
      while (i < list.length && !cancelled()) {
        if (prio() === 'low' && n > 0) { await deps.sleep(200); continue; }
        const it = list[i++];
        await fn(it);
        done++;
        progress(phase, done, list.length);
        if (prio() === 'low') await deps.sleep(opts.lowPause ?? 25);
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency || 4 }, (_, n) => worker(n)));
    progress(phase, done, list.length, true);
  }

  // 1) leer: estado del archivo y, si no está en la caché, su información
  const toProbe = [];
  await pool(entries.map((e, i) => i), async (i) => {
    const e = entries[i];
    let st;
    try { st = await deps.stat(e.path); } catch (err) { recs[i] = { missing: true }; stats.missing++; return; }
    if (st.isDirectory && st.isDirectory()) { recs[i] = { missing: true }; stats.missing++; return; }
    const k = keyOf(e.path, st.size, st.mtimeMs);
    keys[i] = k;
    const c = cache.get(k);
    if (c) { recs[i] = c; stats.cached++; return; }
    toProbe.push(i);
    let r;
    try { r = await deps.probe(e.path); } catch (err) { r = { damaged: 'no se puede leer (' + (err.code || err.message) + ')', audioStart: 0, audioEnd: st.size }; }
    if (r.missing) { recs[i] = { missing: true }; stats.missing++; return; }
    r.size = st.size; r.mtime = Math.round(st.mtimeMs);
    stats.probed++;
    recs[i] = r;
    cache.set(k, r);
  }, 'leer');
  if (cancelled()) { cache.close(); return { records: entries.map((e, i) => publicRec(e.id, e.path, recs[i])), cancelled: true, stats: { ...stats, ms: Date.now() - t0 } }; }

  // 2) huella parcial: solo archivos cuyo audio mide lo mismo que el de otro
  const region = (r) => [r.audioStart || 0, r.audioEnd != null ? r.audioEnd : r.size];
  const bySize = new Map();
  entries.forEach((e, i) => {
    const r = recs[i];
    if (!r || r.missing || r.damaged) return;
    const [a, b] = region(r);
    if (b - a <= 0) return;
    const l = bySize.get(b - a) || []; l.push(i); bySize.set(b - a, l);
  });
  const needPart = [...bySize.values()].filter(l => l.length > 1).flat().filter(i => !recs[i].part);
  await pool(needPart, async (i) => {
    const r = recs[i], [a, b] = region(r);
    try {
      r.part = await deps.hashPart(entries[i].path, a, b);
      if (b - a <= 2 * MB) r.full = r.part;   // el parcial ya es el audio entero
    } catch (err) { r.part = 'ERR'; }
    stats.partial++;
    cache.set(keys[i], r);
  }, 'huella');
  if (cancelled()) { cache.close(); return { records: entries.map((e, i) => publicRec(e.id, e.path, recs[i])), cancelled: true, stats: { ...stats, ms: Date.now() - t0 } }; }

  // 3) huella completa donde coincide la parcial (los más pequeños primero)
  const byPart = new Map();
  entries.forEach((e, i) => {
    const r = recs[i];
    if (!r || !r.part || r.part === 'ERR') return;
    const l = byPart.get(r.part) || []; l.push(i); byPart.set(r.part, l);
  });
  const needFull = [...byPart.values()].filter(l => l.length > 1).flat().filter(i => !recs[i].full)
    .sort((x, y) => (region(recs[x])[1] - region(recs[x])[0]) - (region(recs[y])[1] - region(recs[y])[0]));
  await pool(needFull, async (i) => {
    const r = recs[i], [a, b] = region(r);
    try { r.full = await deps.hashFull(entries[i].path, a, b); } catch (err) { r.full = ''; }
    stats.full++;
    cache.set(keys[i], r);
  }, 'comprobar');
  // los que comparten parcial pero no se llegaron a comprobar no cuentan como iguales
  const isCancelled = cancelled();
  cache.close();
  try { if (!isCancelled && opts.compact !== false) cache.compact(); } catch (_) { /* no importa */ }
  stats.ms = Date.now() - t0;
  return { records: entries.map((e, i) => publicRec(e.id, e.path, recs[i])), cancelled: isCancelled, stats };
}

module.exports = { scanEntries, createCache, hashPart, hashFull, keyOf, VERSION };
