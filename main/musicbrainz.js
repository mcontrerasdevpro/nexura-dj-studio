// Consultas a MusicBrainz (artista, título, año, estilos) y Cover Art Archive (carátulas) para «Limpiar
// biblioteca». Sin Electron (se prueba en Node con un servidor local: tools/test-limpieza.mjs).
// Reglas de MusicBrainz: como mucho 1 petición por segundo y un User-Agent con nombre, versión y contacto.
// Todo se guarda en caché (respuestas en musicbrainz.json, carátulas en caa/): repetir no vuelve a preguntar.
// Sin red: { offline: true } y ningún error a la vista.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DAY = 86400000;
const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const lucene = (s) => String(s || '').replace(/[\\+\-!(){}[\]^"~*?:/]|&&|\|\|/g, ' ').replace(/\s+/g, ' ').trim();

function createMb({ cacheDir, userAgent, base = 'https://musicbrainz.org/ws/2', caa = 'https://coverartarchive.org', fetch = globalThis.fetch, gap = 1100, timeout = 15000, maxAge = 90 * DAY } = {}) {
  const file = cacheDir ? path.join(cacheDir, 'musicbrainz.json') : null;
  let cache = {};
  try { if (file) cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { cache = {}; }
  let dirty = 0, lastAt = 0, chain = Promise.resolve();
  const save = () => {
    if (!file || !dirty) return;
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(cache)); fs.renameSync(file + '.tmp', file); dirty = 0; } catch (_) { /* sin caché */ }
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // cola: las peticiones van de una en una y cada una sale al menos «gap» ms después de que TERMINE la anterior
  // (contando desde la salida, la latencia de la red podía juntar dos llegadas a menos de 1 s)
  const queued = (fn) => { const p = chain.then(async () => { const d = gap - (Date.now() - lastAt); if (d > 0) await wait(d); try { return await fn(); } finally { lastAt = Date.now(); } }); chain = p.catch(() => {}); return p; };
  async function get(url, { json = true } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await queued(async () => {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
        try { return await fetch(url, { headers: { 'User-Agent': userAgent, Accept: json ? 'application/json' : 'image/*' }, signal: ctl.signal, redirect: 'follow' }); }
        finally { clearTimeout(t); }
      });
      if (r.status === 503 || r.status === 429) { await wait(1500 * (attempt + 1)); continue; }
      if (r.status === 404) return null;
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.http = r.status; throw e; }
      return json ? r.json() : Buffer.from(await r.arrayBuffer());
    }
    const e = new Error('servicio ocupado'); e.busy = true; throw e;
  }
  const fresh = (c) => c && Date.now() - (c.t || 0) < maxAge;

  // Grabaciones que coinciden con artista + título → [{ id, title, artist, artistId, length, date, score, releases, tags }]
  async function searchRecording(artist, title) {
    const key = 'rec:' + norm(artist) + '|' + norm(title);
    if (fresh(cache[key])) return { items: cache[key].items, cached: true };
    const q = `recording:"${lucene(title)}" AND artist:"${lucene(artist)}"`;
    const j = await get(`${base}/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=8`);
    const items = ((j && j.recordings) || []).map(r => ({
      id: r.id, title: r.title || '', score: r.score || 0, length: r.length || 0, date: r['first-release-date'] || '',
      artist: (r['artist-credit'] || []).map(c => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim(),
      artistId: ((r['artist-credit'] || [])[0] || {}).artist ? r['artist-credit'][0].artist.id : '',
      releases: (r.releases || []).slice(0, 12).map(x => ({ id: x.id, title: x.title || '', date: x.date || '', status: x.status || '', type: (x['release-group'] || {})['primary-type'] || '' })),
      tags: (r.tags || []).map(t => ({ name: t.name, count: t.count || 0 }))
    }));
    cache[key] = { t: Date.now(), items };
    dirty++; if (dirty >= 10) save();
    return { items };
  }
  // Estilos de un artista (si la grabación no trae ninguno)
  async function artistTags(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return [];
    const key = 'art:' + id;
    if (fresh(cache[key])) return cache[key].tags;
    const j = await get(`${base}/artist/${id}?inc=genres+tags&fmt=json`);
    const tags = [...((j && j.genres) || []), ...((j && j.tags) || [])].map(t => ({ name: t.name, count: t.count || 0 }));
    cache[key] = { t: Date.now(), tags };
    dirty++;
    return tags;
  }
  // Carátula de una publicación (JPEG de 500 px) → Buffer o null. Caché en caa/<id>.jpg (o .none)
  async function cover(releaseId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(releaseId || ''))) return null;
    const dir = cacheDir ? path.join(cacheDir, 'caa') : null;
    const jpg = dir && path.join(dir, releaseId + '.jpg'), none = dir && path.join(dir, releaseId + '.none');
    if (dir) { try { return await fsp.readFile(jpg); } catch (_) { /* sin caché */ } if (fs.existsSync(none)) return null; }
    const b = await get(`${caa}/release/${releaseId}/front-500`, { json: false });
    const ok = b && b.length > 100 && ((b[0] === 0xff && b[1] === 0xd8) || b.toString('latin1', 1, 4) === 'PNG');
    if (dir) { await fsp.mkdir(dir, { recursive: true }); if (ok) await fsp.writeFile(jpg, b); else await fsp.writeFile(none, ''); }
    return ok ? b : null;
  }

  // Varias consultas seguidas con progreso; se para si se cancela o si no hay conexión (3 fallos seguidos)
  // queries: [{ key, artist, title }] → { results: { key: { items, artistTags } }, offline, done }
  async function lookupMany(queries, { onProgress, cancelled = () => false } = {}) {
    const results = {};
    let fails = 0, offline = false, done = 0;
    for (const q of queries) {
      if (cancelled()) break;
      try {
        const r = await searchRecording(q.artist, q.title);
        let tags = null;
        const top = r.items.find(x => x.score >= 85);
        if (top && !top.tags.length && top.artistId) tags = await artistTags(top.artistId).catch(() => null);
        results[q.key] = { items: r.items, artistTags: tags };
        fails = 0;
      } catch (e) {
        if (!e.http) fails++;
        if (fails >= 3) { offline = true; break; }
      }
      done++;
      if (onProgress) onProgress({ t: 'online', done, total: queries.length });
    }
    save();
    return { results, offline, done };
  }
  return { searchRecording, artistTags, cover, lookupMany, save };
}

module.exports = { createMb };
