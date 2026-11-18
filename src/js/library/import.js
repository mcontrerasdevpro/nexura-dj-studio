// Importación de bibliotecas de otros programas DJ a partir de sus exportaciones abiertas:
//  · colección XML con <DJ_PLAYLISTS> (exportación «collection.xml»)
//  · colección NML (<NML><COLLECTION><ENTRY>…)
//  · base de datos XML con <VirtualDJ_Database>
// Cada parser devuelve { format, tracks: [{ path, title, artist, album, genre, year, comment, rating,
// plays, duration, bpm, firstBeat, grid, key: {tonic, minor}, cues: [{n, t, le, name, color}], loops }],
// playlists: [{ name, paths: [] }] } con rutas de archivo nativas.
import { KEY_NAMES, keyToCamelot, keyLabel, CUE_COLORS } from '../util.js';
import { normalize, dominantBpm } from '../audio/grid.js';

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; };
const hex2 = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');

// ---------------------------------------------------------------- tonalidades
const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
// Camelot (8A = La menor) y Open Key (1m = La menor, 1d = Do mayor)
export function parseKey(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m;
  if ((m = /^0?(\d{1,2})\s*([AB])$/i.exec(s))) { // Camelot
    const n = +m[1]; if (n < 1 || n > 12) return null;
    const minor = m[2].toUpperCase() === 'A';
    // Camelot: 8A = Am (9), cada número +7 semitonos; 8B = C (0)
    const tonic = ((minor ? 9 : 0) + (n - 8) * 7 % 12 + 24) % 12;
    return { tonic, minor };
  }
  if ((m = /^(\d{1,2})\s*([md])$/i.exec(s))) { // Open Key: 1d = C, 1m = Am
    const n = +m[1]; if (n < 1 || n > 12) return null;
    const minor = m[2].toLowerCase() === 'm';
    return { tonic: ((minor ? 9 : 0) + (n - 1) * 7 % 12 + 24) % 12, minor };
  }
  if ((m = /^([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|maj|major|M)?$/.exec(s))) {
    const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
    const tonic = NOTE[(m[1] + acc).toLowerCase()];
    if (tonic == null) return null;
    const q = m[3] || '';
    return { tonic, minor: q === 'm' || /^min/i.test(q) };
  }
  return null;
}
export function keyFields(k) {
  if (!k) return {};
  const name = KEY_NAMES[k.tonic];
  return { keyTonic: k.tonic, keyMinor: k.minor, key: keyLabel(k.tonic, k.minor), camelot: keyToCamelot(name, k.minor), keyLocked: true };
}

// ---------------------------------------------------------------- rutas
// file://localhost/E:/Music/x.mp3 → E:\Music\x.mp3 ; file://localhost/Users/a/x.mp3 → /Users/a/x.mp3
export function fileUrlToPath(loc) {
  let s = String(loc || '');
  s = s.replace(/^file:\/\/localhost/i, '').replace(/^file:\/\//i, '');
  try { s = decodeURIComponent(s); } catch (_) { /* tal cual */ }
  if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
  if (/^[A-Za-z]:\//.test(s)) s = s.replace(/\//g, '\\');
  return s;
}
// VOLUME="E:" DIR="/:Music/:House/:" FILE="x.mp3" → E:\Music\House\x.mp3 (en Mac: /Volumes/<vol>/… o /…)
export function nmlPath(volume, dir, file) {
  const parts = String(dir || '').split('/:').filter(Boolean);
  if (/^[A-Za-z]:$/.test(volume || '')) return volume + '\\' + [...parts, file].join('\\');
  return '/' + [...parts, file].join('/');
}

const xml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('El archivo no es un XML válido');
  return doc;
};
const kids = (el, name) => el ? [...el.children].filter(c => c.tagName === name) : [];
const attr = (el, k) => (el && el.getAttribute(k)) ?? null;

// ---------------------------------------------------------------- <DJ_PLAYLISTS>
function parseDjPlaylists(doc) {
  const col = doc.querySelector('DJ_PLAYLISTS > COLLECTION');
  const byId = new Map(), byLoc = new Map(), tracks = [];
  for (const T of kids(col, 'TRACK')) {
    const path = fileUrlToPath(attr(T, 'Location'));
    if (!path) continue;
    const tempos = kids(T, 'TEMPO').map(e => ({ t: num(attr(e, 'Inizio')), bpm: num(attr(e, 'Bpm')), beat: num(attr(e, 'Battito')) || 1 })).filter(x => x.t != null && x.bpm > 20);
    let firstBeat = null, grid = null, bpm = num(attr(T, 'AverageBpm'));
    if (tempos.length) {
      // primer tiempo de compás: Battito indica en qué tiempo (1-4) cae la marca
      const t0 = tempos[0];
      firstBeat = t0.t - ((t0.beat - 1) % 4) * 60 / t0.bpm;
      const distinct = tempos.some(x => Math.abs(x.bpm - t0.bpm) > 0.02);
      if (distinct && tempos.length > 1) {
        const g = normalize([{ t: firstBeat, bpm: t0.bpm }, ...tempos.slice(1).map(x => ({ t: x.t, bpm: x.bpm }))]);
        if (g.length > 1) { grid = g; bpm = dominantBpm(g, num(attr(T, 'TotalTime'))); }
      } else bpm = t0.bpm;
    }
    const cues = [], loops = [];
    for (const P of kids(T, 'POSITION_MARK')) {
      const n = num(attr(P, 'Num')), t = num(attr(P, 'Start')), e = num(attr(P, 'End')), type = num(attr(P, 'Type'));
      if (t == null) continue;
      const r = attr(P, 'Red'), color = r != null ? '#' + hex2(+r) + hex2(+attr(P, 'Green')) + hex2(+attr(P, 'Blue')) : null;
      const isLoop = type === 4 && e != null && e > t;
      if (n != null && n >= 0 && n < 8) cues.push({ n, t, le: isLoop ? e : undefined, name: attr(P, 'Name') || '', color });
      else if (isLoop) loops.push({ s: t, e });
    }
    const tr = {
      path, title: attr(T, 'Name'), artist: attr(T, 'Artist'), album: attr(T, 'Album'), genre: attr(T, 'Genre'),
      year: attr(T, 'Year'), comment: attr(T, 'Comments'), rating: Math.round((num(attr(T, 'Rating')) || 0) / 51),
      plays: num(attr(T, 'PlayCount')) || 0, duration: num(attr(T, 'TotalTime')) || 0,
      bpm, firstBeat, grid, key: parseKey(attr(T, 'Tonality')), cues, loops
    };
    tracks.push(tr);
    byId.set(attr(T, 'TrackID'), path); byLoc.set(attr(T, 'Location'), path);
  }
  const playlists = [];
  const walk = (node, prefix) => {
    for (const N of kids(node, 'NODE')) {
      const name = attr(N, 'Name') || '';
      if (attr(N, 'Type') === '0') walk(N, name && name !== 'ROOT' ? prefix + name + ' / ' : prefix);
      else {
        const keyType = attr(N, 'KeyType');
        const paths = kids(N, 'TRACK').map(e => keyType === '1' ? (byLoc.get(attr(e, 'Key')) || fileUrlToPath(attr(e, 'Key'))) : byId.get(attr(e, 'Key'))).filter(Boolean);
        playlists.push({ name: prefix + name, paths });
      }
    }
  };
  walk(doc.querySelector('DJ_PLAYLISTS > PLAYLISTS'), '');
  return { format: 'Colección XML', tracks, playlists };
}

// ---------------------------------------------------------------- <NML>
function parseNml(doc) {
  const tracks = [], byKey = new Map();
  for (const E of kids(doc.querySelector('NML > COLLECTION'), 'ENTRY')) {
    const L = kids(E, 'LOCATION')[0];
    if (!L) continue;
    const vol = attr(L, 'VOLUME') || '', dir = attr(L, 'DIR') || '', file = attr(L, 'FILE') || '';
    const path = nmlPath(vol, dir, file);
    const info = kids(E, 'INFO')[0], tempo = kids(E, 'TEMPO')[0], mk = kids(E, 'MUSICAL_KEY')[0];
    let key = null;
    if (mk && attr(mk, 'VALUE') != null) { const v = +attr(mk, 'VALUE'); if (v >= 0 && v < 24) key = { tonic: v % 12, minor: v >= 12 }; }
    if (!key && info) key = parseKey(attr(info, 'KEY'));
    const bpm = tempo ? num(attr(tempo, 'BPM')) : null;
    let firstBeat = null; const cues = [], loops = [];
    for (const C of kids(E, 'CUE_V2')) {
      const type = num(attr(C, 'TYPE')), t = (num(attr(C, 'START')) || 0) / 1000, len = (num(attr(C, 'LEN')) || 0) / 1000, hc = num(attr(C, 'HOTCUE'));
      if (type === 4) { if (firstBeat == null) firstBeat = t; continue; } // marca de grid
      const isLoop = type === 5 && len > 0;
      if (hc != null && hc >= 0 && hc < 8) cues.push({ n: hc, t, le: isLoop ? t + len : undefined, name: attr(C, 'NAME') === 'n.n.' ? '' : (attr(C, 'NAME') || ''), color: null });
      else if (isLoop) loops.push({ s: t, e: t + len });
    }
    const album = kids(E, 'ALBUM')[0];
    const ranking = info ? num(attr(info, 'RANKING')) : null;
    tracks.push({
      path, title: attr(E, 'TITLE'), artist: attr(E, 'ARTIST'), album: album ? attr(album, 'TITLE') : null,
      genre: info ? attr(info, 'GENRE') : null, comment: info ? attr(info, 'COMMENT') : null,
      rating: ranking ? Math.round(ranking / 51) : 0, plays: info ? num(attr(info, 'PLAYCOUNT')) || 0 : 0,
      duration: info ? num(attr(info, 'PLAYTIME_FLOAT')) || num(attr(info, 'PLAYTIME')) || 0 : 0,
      bpm, firstBeat, grid: null, key, cues, loops
    });
    byKey.set(vol + dir + file, path);
  }
  const playlists = [];
  const walk = (node, prefix) => {
    for (const N of kids(node, 'NODE')) {
      const name = attr(N, 'NAME') || '';
      if (attr(N, 'TYPE') === 'FOLDER') { const sub = kids(N, 'SUBNODES')[0]; walk(sub, name && name !== '$ROOT' ? prefix + name + ' / ' : prefix); }
      else if (attr(N, 'TYPE') === 'PLAYLIST') {
        const pl = kids(N, 'PLAYLIST')[0];
        const paths = kids(pl, 'ENTRY').map(e => { const pk = kids(e, 'PRIMARYKEY')[0]; return pk ? byKey.get(attr(pk, 'KEY')) : null; }).filter(Boolean);
        playlists.push({ name: prefix + name, paths });
      }
    }
  };
  const root = doc.querySelector('NML > PLAYLISTS');
  if (root) walk(root, '');
  return { format: 'Colección NML', tracks, playlists };
}

// ---------------------------------------------------------------- <VirtualDJ_Database>
function parseVdjDatabase(doc) {
  const tracks = [];
  for (const S of kids(doc.documentElement, 'Song')) {
    const path = attr(S, 'FilePath'); if (!path) continue;
    const tags = kids(S, 'Tags')[0], infos = kids(S, 'Infos')[0], scan = kids(S, 'Scan')[0];
    // el BPM se guarda como segundos por beat
    const spb = num(attr(scan, 'Bpm')) || num(attr(tags, 'Bpm'));
    const bpm = spb ? (spb < 10 ? Math.round(60 / spb * 100) / 100 : spb) : null;
    let firstBeat = null; const cues = [];
    for (const P of kids(S, 'Poi')) {
      const type = attr(P, 'Type'), t = num(attr(P, 'Pos'));
      if (t == null) continue;
      if (type === 'beatgrid') { if (firstBeat == null) firstBeat = t; continue; }
      const n = num(attr(P, 'Num'));
      if ((type == null || type === 'cue') && n != null && n >= 1 && n <= 8) cues.push({ n: n - 1, t, name: attr(P, 'Name') || '', color: null });
    }
    tracks.push({
      path, title: attr(tags, 'Title'), artist: attr(tags, 'Author'), album: attr(tags, 'Album'), genre: attr(tags, 'Genre'),
      year: attr(tags, 'Year'), rating: num(attr(tags, 'Stars')) || 0, plays: num(attr(infos, 'PlayCount')) || 0,
      duration: num(attr(infos, 'SongLength')) || 0, bpm, firstBeat, grid: null,
      key: parseKey(attr(scan, 'Key') || attr(tags, 'Key')), cues, loops: []
    });
  }
  return { format: 'Base de datos XML', tracks, playlists: [] };
}

// ---------------------------------------------------------------- listas sueltas
const dirOf = (p) => (/[\\/]/.test(p) ? p.replace(/[\\/][^\\/]*$/, '') : '');
const baseName = (p) => (p.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
// quita los segmentos «.» y «..» (C:\Música\Listas\..\a.mp3 → C:\Música\a.mp3)
function collapse(p, sep) {
  const parts = p.split(sep), out = [];
  for (const s of parts) {
    if (s === '.') continue;
    if (s === '..' && out.length && out[out.length - 1] !== '..' && !/^[A-Za-z]:$/.test(out[out.length - 1]) && out[out.length - 1] !== '') out.pop();
    else out.push(s);
  }
  return out.join(sep);
}
export function resolvePath(entry, listPath) {
  let s = entry.trim();
  if (/^file:/i.test(s)) return fileUrlToPath(s);
  if (/^[A-Za-z]:[\\/]/.test(s)) return collapse(s.replace(/\//g, '\\'), '\\');
  if (s.startsWith('\\\\')) return '\\\\' + collapse(s.slice(2), '\\');
  if (s.startsWith('/')) return collapse(s, '/');
  const dir = dirOf(listPath);
  if (!dir) return s; // lista sin carpeta conocida (modo navegador): se queda relativa
  const win = /^[A-Za-z]:/.test(dir) || dir.includes('\\');
  return win ? collapse(dir + '\\' + s.replace(/\//g, '\\'), '\\') : collapse(dir + '/' + s.replace(/\\/g, '/'), '/');
}
// Texto de una lista: UTF-8 (.m3u8 y la mayoría de .m3u) y, si no es UTF-8 válido, Latin-1 (Windows-1252)
export function decodePlaylist(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch (_) { return new TextDecoder('windows-1252').decode(bytes); }
}
// .m3u / .m3u8: una ruta por línea; «#EXTINF:duración,Artista - Título» describe la línea siguiente
// (el resto de líneas «#» son comentarios). Devuelve también entries con título/artista/duración.
export function parseM3u(text, listPath) {
  const entries = [];
  let info = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#')) {
      const m = /^#EXTINF:\s*(-?[\d.]+)[^,]*,(.*)$/i.exec(l);
      if (m) {
        const dur = parseFloat(m[1]), label = m[2].trim();
        const sep = label.indexOf(' - ');
        info = { duration: dur > 0 ? dur : 0, artist: sep > 0 ? label.slice(0, sep).trim() : '', title: (sep > 0 ? label.slice(sep + 3) : label).trim() };
      }
      continue;
    }
    entries.push({ path: resolvePath(l, listPath), ...(info || {}) });
    info = null;
  }
  return { name: baseName(listPath) || 'Lista', paths: entries.map(e => e.path), entries };
}
// carpeta virtual XML (<VirtualFolder><song path="…"/>)
export function parseVirtualFolder(text, listPath) {
  const doc = xml(text);
  const paths = [...doc.getElementsByTagName('song')].map(s => s.getAttribute('path')).filter(Boolean);
  return { name: baseName(listPath) || 'Lista', paths };
}

export function parseLibrary(text) {
  const head = text.slice(0, 4000);
  if (/<DJ_PLAYLISTS/i.test(head)) return parseDjPlaylists(xml(text));
  if (/<NML\b/.test(head)) return parseNml(xml(text));
  if (/<VirtualDJ_Database/i.test(head)) return parseVdjDatabase(xml(text));
  throw new Error('Formato no reconocido: elige una colección exportada en XML o NML');
}

// Aplica los datos importados a una pista de la biblioteca. Sin «overwrite» solo rellena lo vacío
// y respeta lo que el usuario ya ha fijado a mano (BPM/tonalidad bloqueados, hot cues existentes).
export function mergeInto(t, src, { grid = true, key = true, cues = true, tags = true, overwrite = false } = {}) {
  const p = {};
  if (tags) {
    for (const k of ['title', 'artist', 'album', 'genre', 'year', 'comment']) if (src[k] && (overwrite || !t[k])) p[k] = src[k];
    if (src.rating && (overwrite || !t.rating)) p.rating = Math.max(0, Math.min(5, src.rating));
    if (src.plays && src.plays > (t.plays || 0)) p.plays = src.plays;
  }
  if (grid && src.bpm > 20 && (overwrite || !t.bpmLocked)) {
    p.bpm = Math.round(src.bpm * 10000) / 10000; p.firstBeat = src.firstBeat ?? t.firstBeat ?? 0; p.grid = src.grid || null; p.bpmLocked = true;
  }
  if (key && src.key && (overwrite || !t.keyLocked)) Object.assign(p, keyFields(src.key));
  if (cues && (src.cues.length || src.loops.length)) {
    const c = (t.cues || Array(8).fill(null)).slice(), l = (t.loops || Array(8).fill(null)).slice();
    let n = 0;
    for (const q of src.cues) {
      if (c[q.n] && !overwrite && !c[q.n].auto) continue;
      c[q.n] = { t: q.t, color: q.color || CUE_COLORS[q.n % CUE_COLORS.length], name: q.name || '' };
      if (q.le) c[q.n].le = q.le;
      n++;
    }
    for (const q of src.loops) { const free = l.findIndex(x => !x); if (free < 0) break; if (!l.some(x => x && Math.abs(x.s - q.s) < 0.01)) l[free] = { s: q.s, e: q.e }; }
    p.cues = c; p.loops = l;
  }
  return p;
}
