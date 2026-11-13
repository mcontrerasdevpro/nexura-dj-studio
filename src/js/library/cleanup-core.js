// «Limpiar biblioteca» — lógica pura (sin DOM ni disco; se prueba en Node: tools/test-limpieza.mjs).
// Recibe las pistas de la biblioteca y lo que el proceso principal ha leído de cada archivo (main/cleanup-scan.js:
// formato, calidad, etiquetas del archivo, huella del audio) y calcula:
//   · duplicados: exactos (mismo audio) y la misma canción en otra calidad, con la copia que conviene conservar;
//     las versiones distintas (remix, extended, directo…) se agrupan aparte, solo para informar
//   · etiquetas: problemas (sin artista, «Pista 01», basura de vídeos, MAYÚSCULAS…) y propuestas con su confianza
//   · calidad: bitrate bajo, formatos que conviene convertir, dañados, perdidos, duraciones raras
// Las reglas de normalización vienen de los scripts del informe de la música (.revision/informe-musica).
import { fold, splitArtists, textSim } from '../spotify/spotify-core.js';

export { fold, splitArtists };

// ------------------------------------------------------------------ textos genéricos y nombre de archivo
const GENERIC_TITLE = /^(pista|track|tr|piste|faixa|titel|title|titulo|cancion|song|audio|untitled|sin titulo|unknown|desconocido|desconocida|nueva grabacion|new recording|grabacion|recording|tema|corte)( ?\d+)?$/;
const GENERIC_ARTIST = /^(unknown|unknown artist|artista desconocido|desconocido|various|various artists|varios|varios artistas|va|v a|artist|artista|no artist|sin artista)$/;
export const isGenericTitle = (s) => { const f = fold(s); return !f || /^\d+$/.test(f) || GENERIC_TITLE.test(f); };
export const isGenericArtist = (s) => { const f = fold(s); return !f || GENERIC_ARTIST.test(f); };

// Relleno de vídeos y webs: «(Official Video)», «[Lyrics]», «(QUEURBANO.COM)», «[HD]», «(By @alguien)»
export const JUNK = /\b(official|oficial|video|videoclip|clip|lyrics?|letra|audio|hd|hq|4k|1080p|720p|visualizer|subtitulad[oa]|con letra|music video|videoclip oficial|free download|out now|premiere|estreno)\b|www\.|\.com\b|\.net\b|\.es\b|@/i;
export function stripJunk(s) {
  return String(s || '')
    .replace(/\s*[([]([^()[\]]*)[)\]]/g, (m, inner) => (JUNK.test(inner) ? '' : m))
    .replace(/\s+[-–|]\s*(official|oficial)\b.*$/i, '')
    .replace(/\s*\bwww\.\S+/gi, '').replace(/\s+\S+\.(com|net|es)\b/gi, '')
    .replace(/\s*\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ').trim();
}
// «ArtistaVEVO», «Artista - Topic», «Artista Official» → «Artista»
export const cleanArtist = (s) => stripJunk(String(s || '').replace(/\s*-\s*topic$/i, '').replace(/\s*vevo$/i, '').replace(/\s+official$/i, '').trim());

// «PequeÃ±a» (UTF-8 leído como Latin-1) → «Pequeña»
export function fixMojibake(s) {
  s = String(s || '');
  if (!/[ÃÂ][\u0080-¿]/.test(s) || ![...s].every(c => c.charCodeAt(0) <= 0xff)) return s;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from([...s].map(c => c.charCodeAt(0)))); } catch (_) { return s; }
}
const BROKEN = /�|ï¿½|[ÃÂ][\u0080-¿]/;

// «01 - Artista - Título», «01. Título», «A1 Artista - Título», «105-jam_feat._amon_-_reason» → separadores normales
export function separators(name) {
  let s = String(name || '');
  if (!/\s[-–]\s/.test(s) && /_/.test(s)) {
    s = s.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    if (!/\s[-–]\s/.test(s)) s = s.replace(/(\S)-(?=\S)/g, '$1 - ');
  }
  return s.replace(/(\S)[-–]\s+/g, '$1 - ').replace(/\s+[-–](\S)/g, ' - $1').replace(/\s+/g, ' ').trim();
}
// Nombre del archivo (sin extensión) → { artist, title }. El número de pista inicial se quita si lleva
// separador («3 - », «12. ») o cero delante («03 »); «3 Doors Down» y «50 Cent - …» se respetan.
export function fromFileName(name, tagArtist = '') {
  let s = separators(String(name || '').replace(/\s+/g, ' ').trim()).replace(/_/g, ' ');
  s = s.replace(/^(va|v a|various artists?)\s+-\s+/i, '');
  s = s.replace(/^\s*(\d{1,3}|[a-d]\d{1,2})\s*[.)\-–]\s*(?=\S)/i, '')
    .replace(/^\s*(0\d{1,2})\s+(?=\S)/, '')
    .replace(/^\s*(\d{2,3})\s+(?=\S)/, (m, n) => (fold(tagArtist).startsWith(n) ? m : ''));
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0].trim() && !isGenericArtist(parts[0]) && !isGenericTitle(parts.slice(1).join(' - '))) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: isGenericTitle(s) ? '' : s };
}
export const baseName = (p) => String(p || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
export const folderNames = (p) => String(p || '').split(/[\\/]/).slice(0, -1).filter(Boolean);
export const extOf = (p) => (/\.([a-z0-9]{1,5})$/i.exec(String(p || '')) || [])[1]?.toLowerCase() || '';

// MAYÚSCULAS → «Tipo Título» (las palabras cortas de enlace en minúscula salvo al principio)
const SMALL = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'en', 'a', 'al', 'con', 'por', 'of', 'the', 'and', 'in', 'on', 'to', 'at', 'feat', 'ft', 'vs', 'x']);
export const isShouting = (s) => { const l = String(s || '').replace(/[^\p{L}]/gu, ''); return l.length > 3 && l === l.toUpperCase() && l !== l.toLowerCase(); };
export function titleCase(s) {
  let first = true;
  return String(s || '').toLowerCase().replace(/[\p{L}\p{N}']+/gu, (w) => {
    const r = !first && SMALL.has(w.replace(/\.$/, '')) ? w : w.charAt(0).toUpperCase() + w.slice(1);
    first = false;
    return r;
  }).replace(/\b(Dj|Mc|Uk|Usa|Edm|Vip)\b/g, (m) => m.toUpperCase());
}

// ------------------------------------------------------------------ versiones del título
const NEUTRAL = /^(original( mix| version| edit)?|(\d{4} )?(digital(ly)? )?remaster(ed)?( version)?( \d{4})?|album version|single version|lp version|mono( version)?|stereo( version)?|explicit( version)?|clean( version)?|deluxe( edition| version)?|bonus track|main( version| mix)?|from .+|taken from .+)$/;
const EDIT = /^(radio( edit| version| mix)?|extended( mix| version| edit)?|club( mix| edit| version)|short( edit| version)|edit|single edit|original extended( mix)?|extended original( mix)?|intro( edit| clean| dirty)?|dj edit)$/;
const DISTINCT = /\b(remix|rmx|mix|rework|re edit|reedit|bootleg|vip|dub|flip|refix|cover|live|en vivo|en directo|directo|acoustic|acustica|acustico|unplugged|instrumental|acapella|a cappella|karaoke|demo|version|edit|mashup|sped up|slowed|nightcore|remake|reprise|megamix|medley)\b/;
const FEAT = /^(feat|ft|featuring|with|con)\b\.?\s*/i;
// «Título (feat. X) [Y Remix] - Radio Edit» → { base, title, feat, version (texto), vkey (clave), kind }
//   vkey = '' para la original; «extended», «radio edit», «y remix», «live»… distinguen versiones
export function parseVersion(title) {
  let s = String(title || '').replace(/\s+/g, ' ').trim();
  const descs = [], feat = [];
  s = s.replace(/\s*[([]([^()[\]]*)[)\]]/g, (_, inner) => { descs.push(inner.trim()); return ' '; });
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length > 1) {
    const keep = [parts[0]];
    for (const p of parts.slice(1)) { const f = fold(p); if (NEUTRAL.test(f) || EDIT.test(f) || DISTINCT.test(f) || FEAT.test(f)) descs.push(p.trim()); else keep.push(p); }
    s = keep.join(' - ');
  }
  s = s.replace(/\s+(?:feat|ft|featuring)\b\.?\s+(.+)$/i, (_, who) => { feat.push(who.trim()); return ''; });
  let kind = 'original', rest = s.trim();
  const ver = [], vk = [];
  for (const d of descs) {
    const f = fold(d);
    if (!f) continue;
    if (FEAT.test(d.trim())) { feat.push(d.replace(FEAT, '').trim()); continue; }
    if (JUNK.test(d)) continue;
    if (NEUTRAL.test(f)) continue;
    if (EDIT.test(f)) { if (kind === 'original') kind = 'edit'; ver.push(d); vk.push(f.replace(/ (mix|version)$/, '')); continue; }
    if (DISTINCT.test(f)) { kind = 'version'; ver.push(d); vk.push(f); continue; }
    rest += ` (${d})`;   // «(Part 2)»: es parte del título
  }
  return { base: fold(rest), title: rest.replace(/\s+/g, ' ').trim(), feat, version: ver.join(', '), vkey: vk.sort().join('+'), kind };
}
// Artistas principales (sin feat.), ordenados: «B & A feat. C» = «A & B»
export function artistKey(artist) {
  const main = String(artist || '').split(/\s+(?:feat|ft|featuring)\b\.?\s+/i)[0];
  return splitArtists(cleanArtist(main)).sort().join(' ');
}

// ------------------------------------------------------------------ calidad
const LOSSLESS = new Set(['flac', 'wav', 'aif', 'aiff', 'ape', 'wv', 'alac']);
// Formatos que la app no reproduce o que conviene convertir
export const CONVERT = new Set(['wma', 'ape', 'wv', 'mpc', 'ra', 'ac3', 'mp2', 'amr']);
const LOSSY_LOW = new Set(['mp3', 'aac', 'm4a', 'mp2', 'mp4']);
const fmtLabel = (r) => (r.codec === 'alac' ? 'ALAC' : r.codec === 'aac' && r.fmt !== 'aac' ? 'AAC' : String(r.fmt || '?').toUpperCase());
// { score, label, lossless, kbps } — el «escalón» de bitrate hace que 318 y 320 kbps cuenten igual
export function quality(rec) {
  if (!rec || rec.missing) return { score: -2, label: 'No existe', lossless: false, kbps: 0 };
  if (rec.damaged) return { score: -1, label: 'Dañado', lossless: false, kbps: 0 };
  const lossless = !!rec.lossless || LOSSLESS.has(rec.fmt);
  const kbps = Math.round(rec.br || 0);
  if (lossless) {
    const bits = rec.bits || 16, khz = (rec.sr || 44100) / 1000;
    return { score: 10000 + bits * 10 + Math.round(khz), label: `${fmtLabel(rec)} ${bits} bits/${khz.toLocaleString('es-ES', { maximumFractionDigits: 1 })} kHz`, lossless, kbps };
  }
  const tier = kbps >= 310 ? 320 : kbps >= 250 ? 256 : kbps >= 215 ? 224 : kbps >= 185 ? 192 : kbps >= 150 ? 160 : kbps >= 120 ? 128 : kbps;
  return { score: CONVERT.has(rec.fmt) ? tier * 0.9 : tier, label: `${fmtLabel(rec)} ${kbps || '?'} kbps${rec.vbr ? ' VBR' : ''}`, lossless, kbps };
}

// ------------------------------------------------------------------ ¿cuál conservar?
// Datos que la pista tiene en Nexura (cues, beatgrid, crates, valoración, reproducciones)
export function nexuraData(t, crateCount = 0) {
  const n = (a) => (a || []).filter(Boolean).length;
  const cues = n(t.cues), loops = n(t.loops) + n(t.cueLoops);
  const score = cues * 3 + loops * 2 + (t.analyzed ? 2 : 0) + (t.bpmLocked ? 2 : 0) + (t.grid && t.grid.length ? 2 : 0) + crateCount * 2 + (t.rating || 0) + Math.min(10, t.plays || 0) + (t.comment ? 1 : 0);
  return { cues, loops, analyzed: !!t.analyzed, crates: crateCount, rating: t.rating || 0, plays: t.plays || 0, score };
}
export function nexuraLabel(d) {
  const out = [];
  if (d.cues) out.push(`${d.cues} cue${d.cues > 1 ? 's' : ''}`);
  if (d.loops) out.push(`${d.loops} loop${d.loops > 1 ? 's' : ''}`);
  if (d.analyzed) out.push('analizada');
  if (d.crates) out.push(`en ${d.crates} crate${d.crates > 1 ? 's' : ''}`);
  if (d.rating) out.push('★'.repeat(d.rating));
  if (d.plays) out.push(`${d.plays} reproducci${d.plays > 1 ? 'ones' : 'ón'}`);
  return out.join(' · ') || 'sin datos en Nexura';
}
// Ruta «ordenada»: penaliza Descargas, Nueva carpeta, copias «(2)», «- copia»…; premia carpetas descriptivas
const BAD_DIR = /^(nueva carpeta( \(\d+\))?|new folder( \(\d+\))?|copia|copy|copia de .*|descargas|downloads|download|temp|tmp|escritorio|desktop|varios|misc|sin titulo|untitled|recuperad[oa]s?|recycle.*|backup|respaldo|pendientes?|por ordenar|ordenar|otros|otras?)$/i;
const BAD_NAME = /(\(\d{1,2}\)|\bcopia\b|\bcopy\b|- copia|- copy|\[\d{1,2}\]|~\d|\.tmp$)/i;
export function pathScore(p) {
  const dirs = folderNames(p);
  let s = 0;
  for (const d of dirs) { if (BAD_DIR.test(d.trim())) s -= 40; if (/\(\d{1,2}\)$/.test(d)) s -= 25; }
  if (BAD_NAME.test(baseName(p))) s -= 30;
  s += Math.min(4, folderNames(p).length) * 3;
  if (/ - /.test(baseName(p))) s += 5;
  return s;
}
// Propuesta: mejor calidad → más datos en Nexura → ruta más ordenada. Devuelve { id, why }
export function proposeKeep(members) {
  const sorted = members.slice().sort((a, b) => (b.q.score - a.q.score) || (b.data.score - a.data.score) || (b.pathScore - a.pathScore) || String(a.path).localeCompare(String(b.path)));
  const best = sorted[0], second = sorted[1];
  let why = 'Ruta más ordenada';
  if (second && best.q.score > second.q.score) why = `Mejor calidad (${best.q.label})`;
  else if (second && best.data.score > second.data.score) why = 'Tiene más datos en Nexura (' + nexuraLabel(best.data) + ')';
  return { id: best.id, why };
}

// ------------------------------------------------------------------ duplicados
// items: [{ track, rec }] (rec = lo leído del archivo; rec.full = huella del audio). ctx.crateCount(id).
// Devuelve { groups: [{ id, kind: 'exact'|'same', title, members, keep, why }], versions: [{ id, title, members }] }
export function findDuplicates(items, ctx = {}) {
  const crateCount = ctx.crateCount || (() => 0);
  const live = items.filter(x => x.rec && !x.rec.missing && !x.rec.damaged);
  const parent = new Map(live.map(x => [x.track.id, x.track.id]));
  const find = (a) => { let r = a; while (parent.get(r) !== r) r = parent.get(r); let c = a; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x); };
  // 1) mismo audio (huella completa de los datos de audio, sin las etiquetas)
  const byHash = new Map();
  for (const x of live) if (x.rec.full) { const l = byHash.get(x.rec.full); if (l) join(l, x.track.id); else byHash.set(x.rec.full, x.track.id); }
  // 2) misma canción: artista + título normalizados, misma versión y duración ±3 s
  const info = new Map(), bySong = new Map();
  for (const x of live) {
    const t = x.track;
    const artist = cleanArtist(fixMojibake(t.artist)), title = stripJunk(fixMojibake(t.title));
    const a = isGenericArtist(artist) ? '' : artistKey(artist);
    const v = parseVersion(title);
    const dur = x.rec.dur || t.duration || 0;
    info.set(t.id, { a, v, dur, title: v.title, artist });
    if (!a || !v.base || isGenericTitle(v.base)) continue;
    const k = a + '|' + v.base;
    const l = bySong.get(k) || [];
    l.push(t.id); bySong.set(k, l);
  }
  const versions = [];
  for (const [k, ids] of bySong) {
    if (ids.length < 2) continue;
    const byV = new Map();
    for (const id of ids) { const vk = info.get(id).v.vkey; const l = byV.get(vk) || []; l.push(id); byV.set(vk, l); }
    for (const l of byV.values()) {
      const s = l.filter(id => info.get(id).dur > 0).sort((p, q) => info.get(p).dur - info.get(q).dur);
      for (let i = 1; i < s.length; i++) if (info.get(s[i]).dur - info.get(s[i - 1]).dur <= 3) join(s[i - 1], s[i]);
    }
    if (byV.size > 1) versions.push({ key: k, ids });
  }
  // grupos
  const byRoot = new Map();
  for (const x of live) { const r = find(x.track.id); const l = byRoot.get(r) || []; l.push(x); byRoot.set(r, l); }
  const member = (x) => ({
    id: x.track.id, path: x.track.path, track: x.track, rec: x.rec, q: quality(x.rec),
    data: nexuraData(x.track, crateCount(x.track.id)), pathScore: pathScore(x.track.path), hash: x.rec.full || ''
  });
  const groups = [];
  for (const l of byRoot.values()) {
    if (l.length < 2) continue;
    const members = l.map(member);
    const kind = members.every(m => m.hash && m.hash === members[0].hash) ? 'exact' : 'same';
    const best = proposeKeep(members);
    const i0 = info.get(best.id);
    groups.push({ id: 'g:' + members.map(m => m.id).sort().join(','), kind, title: i0.artist && i0.title ? `${i0.artist} – ${i0.title}` : baseName(members[0].path), members, keep: best.id, why: best.why });
  }
  groups.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title, 'es') : a.kind === 'exact' ? -1 : 1));
  // versiones: una fila por versión (los duplicados de una misma versión cuentan una vez)
  const vgroups = [];
  for (const { key, ids } of versions) {
    const seen = new Set(), rows = [];
    for (const id of ids) {
      const r = find(id);
      if (seen.has(r)) continue;
      seen.add(r);
      const x = live.find(y => y.track.id === id);
      rows.push({ id, path: x.track.path, track: x.track, rec: x.rec, label: info.get(id).v.version || 'Original', dur: info.get(id).dur });
    }
    if (rows.length > 1) { const i0 = info.get(ids[0]); vgroups.push({ id: 'v:' + key, title: `${i0.artist} – ${i0.v.title}`, members: rows }); }
  }
  vgroups.sort((a, b) => a.title.localeCompare(b.title, 'es'));
  return { groups, versions: vgroups };
}

// ------------------------------------------------------------------ géneros
// [género que se propone, palabras en carpetas, etiquetas de internet…] (lo más concreto primero)
const GENRES = [
  ['Navidad', /\b(navidad|navidenas?|navideno|villancicos?|christmas|xmas)\b/],
  ['Infantil', /\b(infantil|infantiles|kids|children|cantajuegos?)\b/],
  ['Sevillanas', /\b(sevillanas?|rocieras?)\b/],
  ['Flamenco', /\b(flamenco|flamenca|flamenquito|bulerias)\b/],
  ['Rumba', /\b(rumbas?|rumba catalana)\b/],
  ['Remember', /\b(remember|makina|bakalao|bakalo|ruta del bakalao|italo disco)\b/],
  ['Reggaeton', /\b(reggaeton|regueton|reggeaton|reguetton|reggaetton|dembow|perreo)\b/],
  ['Salsa', /\b(salsa|timba)\b/],
  ['Bachata', /\b(bachatas?)\b/],
  ['Merengue', /\b(merengues?)\b/],
  ['Cumbia', /\b(cumbias?|vallenatos?)\b/],
  ['Latin', /\b(latin|latino|latina|tropical|kizomba|latin pop)\b/],
  ['Hip Hop', /\b(hip hop|hiphop|rap|trap|grime)\b/],
  ['R&B', /\b(r and b|rnb|r b|soul)\b/],
  ['Disco', /\b(nu disco|disco funk|italo|disco)\b/],
  ['Funk', /\b(funk|funky|boogie)\b/],
  ['Trance', /\b(trance|psytrance|psy trance|goa|uplifting)\b/],
  ['Techno', /\b(techno|tekno|minimal|hard techno)\b/],
  ['Drum & Bass', /\b(drum and bass|drum n bass|dnb|jungle)\b/],
  ['Dubstep', /\b(dubstep)\b/],
  ['Hardstyle', /\b(hardstyle|hardcore)\b/],
  ['House', /\b(house|deep house|tech house|garage|afro house|progressive house)\b/],
  ['EDM', /\b(edm|big room|electro house|electro|future bass|moombahton)\b/],
  ['Dance', /\b(dance|eurodance|hands up|dance pop)\b/],
  ['Electrónica', /\b(electronic|electronica)\b/],
  ['Pop', /\b(pop|top 40|top40|los 40|40 principales)\b/],
  ['Rock', /\b(rock|metal|punk|grunge|indie|alternative|alternativ[oa]|heavy|new wave|britpop)\b/],
  ['Reggae', /\b(reggae|ska|dancehall)\b/],
  ['Jazz', /\b(jazz|swing|bossa)\b/],
  ['Blues', /\b(blues)\b/],
  ['Clásica', /\b(clasica|classical)\b/],
  ['Chill Out', /\b(chill|chillout|chill out|lounge|ambient)\b/],
  ['Baladas', /\b(baladas?|ballads?|romanticas?)\b/],
  ['Country', /\b(country|folk)\b/]
];
// Texto (carpeta, etiqueta de internet) → género o '' (en carpetas, «Disco 1» es un álbum, no un género)
export function genreFrom(text, { folder = false } = {}) {
  let f = fold(text);
  if (folder && !/^discos?$|\b(nu|italo) disco\b|\bdisco (funk|music|hits)\b/.test(f)) f = f.replace(/\bdiscos?\b/g, ' ');
  if (!f || f.length < 2) return '';
  for (const [g, re] of GENRES) if (re.test(f)) return g;
  return '';
}
// Año en el nombre de una carpeta de álbum: «(1988) - Keeper», «1981 - Greatest Hits», «Greatest Hits (1981)»
export function yearFromFolder(name) {
  const s = String(name || '').trim();
  let m = /^\(?((?:19[5-9]|20[0-3])\d)\)?(?!\s*[-–]\s*(?:19|20)\d\d)\s*[-–.]\s*\S/.exec(s);
  if (m) return m[1];
  m = /[([]((?:19[5-9]|20[0-3])\d)[)\]]\s*$/.exec(s);
  return m ? m[1] : '';
}
const validYear = (y) => { const n = parseInt(y, 10); return n >= 1900 && n <= new Date().getFullYear() + 1 ? String(n) : ''; };
export const yearOf = (v) => validYear((/\b(1[89]\d\d|20\d\d)\b/.exec(String(v || '')) || [])[1]);

// ------------------------------------------------------------------ etiquetas
export const TAG_FIELDS = ['artist', 'title', 'album', 'year', 'genre'];
export const FIELD_LABEL = { artist: 'Artista', title: 'Título', album: 'Álbum', year: 'Año', genre: 'Género', cover: 'Carátula' };
export const ISSUE_LABEL = {
  noArtist: 'Sin artista', noTitle: 'Sin título', generic: 'Título genérico («Pista 01»)', junk: 'Basura de vídeos o webs',
  underscores: 'Guiones bajos', shouting: 'EN MAYÚSCULAS', broken: 'Letras mal codificadas', noYear: 'Sin año', noGenre: 'Sin género',
  noCover: 'Sin carátula', mismatch: 'No coincide con el nombre del archivo'
};
const words = (s) => fold(s).split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w) && !['the', 'and', 'feat', 'mix', 'remix', 'edit', 'mp3', 'los', 'las', 'del'].includes(w));
// Las etiquetas no tienen ninguna palabra en común con un nombre de archivo descriptivo
export function tagsMismatch(artist, title, file) {
  if (!artist || !title || isGenericTitle(title)) return false;
  const name = new Set(words(file));
  if (name.size < 2) return false;
  const tags = words(`${artist} ${title}`);
  return tags.length > 0 && !tags.some(w => name.has(w));
}
const HIGH = 'alta', MED = 'media', LOW = 'baja';
const CONF_RANK = { alta: 3, media: 2, baja: 1 };

// Mapa artista → género mayoritario en la biblioteca (≥ 2 pistas y ≥ 60 %)
export function artistGenres(tracks) {
  const m = new Map();
  for (const t of tracks) {
    const a = artistKey(t.artist), g = genreFrom(t.genre) || String(t.genre || '').trim();
    if (!a || !g) continue;
    const c = m.get(a) || new Map();
    c.set(g, (c.get(g) || 0) + 1); m.set(a, c);
  }
  const out = new Map();
  for (const [a, c] of m) {
    const tot = [...c.values()].reduce((s, n) => s + n, 0);
    const [g, n] = [...c.entries()].sort((x, y) => y[1] - x[1])[0];
    if (tot >= 2 && n / tot >= 0.6) out.set(a, { genre: g, n });
  }
  return out;
}
// Forma más usada de escribir cada artista en la biblioteca («beyonce» → «Beyoncé»)
export function artistSpellings(tracks) {
  const m = new Map();
  for (const t of tracks) {
    const name = cleanArtist(t.artist);
    const a = artistKey(name);
    if (!a || isShouting(name) || BROKEN.test(name)) continue;
    const c = m.get(a) || new Map();
    c.set(name, (c.get(name) || 0) + 1); m.set(a, c);
  }
  const out = new Map();
  for (const [a, c] of m) out.set(a, [...c.entries()].sort((x, y) => y[1] - x[1])[0][0]);
  return out;
}

// Revisión de una pista: problemas y propuestas por campo.
//   track = datos en Nexura; rec.tags = etiquetas del archivo (vacías si no tiene); ctx = { genres, spellings, online }
//   online (opcional) = mejor coincidencia de internet { artist, title, year, genre, releaseId, conf }
// Devuelve { id, issues: [códigos], fields: { campo: { cur, file, val, conf, src } }, cover: { conf, src, releaseId } | null }
export function reviewTrack(track, rec, ctx = {}) {
  const ft = (rec && rec.tags) || {};
  const file = baseName(track.path);
  const issues = new Set(), fields = {};
  const cur = {};
  for (const k of TAG_FIELDS) cur[k] = String(track[k] ?? '').trim();
  // En MP3 y FLAC (donde se pueden escribir) manda lo que lleva el archivo: si le falta una etiqueta, falta
  // aunque Nexura muestre el nombre del archivo. En los demás formatos solo cuenta lo que hay en Nexura.
  const writable = /\.(mp3|flac)$/i.test(track.path || '');
  const hasFileTags = writable && !!rec && !rec.missing && !rec.damaged;
  const fileTag = {};
  for (const k of TAG_FIELDS) fileTag[k] = hasFileTags ? String(ft[k] ?? '').trim() : cur[k];
  const art0 = fileTag.artist, tit0 = fileTag.title;
  const propose = (k, val, conf, src) => {
    val = String(val || '').trim();
    if (!val) return;
    const same = val === cur[k] && val === fileTag[k];
    if (same) return;
    const old = fields[k];
    if (old && CONF_RANK[old.conf] >= CONF_RANK[conf]) return;
    fields[k] = { cur: cur[k], file: fileTag[k], val, conf, src };
  };
  const fn = fromFileName(file, art0);
  // artista y título
  let artist = fixMojibake(art0), title = fixMojibake(tit0);
  if (BROKEN.test(art0 + tit0)) {
    issues.add('broken');
    if (artist !== art0) propose('artist', artist, HIGH, 'arreglo de letras');
    if (title !== tit0) propose('title', title, HIGH, 'arreglo de letras');
  }
  // «Pista 07»: en la etiqueta o, si el archivo no tiene título, en el nombre que muestra Nexura
  const genericT = title ? isGenericTitle(title) : isGenericTitle(cur.title || file);
  if (!artist || isGenericArtist(artist)) issues.add('noArtist');
  if (!title) issues.add('noTitle');
  if (genericT) issues.add('generic');
  if ((!artist || isGenericArtist(artist) || !title || genericT) && (fn.artist || fn.title)) {
    const clean = !JUNK.test(fn.artist + ' ' + fn.title);
    if (fn.artist && (!artist || isGenericArtist(artist))) propose('artist', titleIfShouting(cleanArtist(fn.artist)), clean ? HIGH : MED, 'nombre del archivo');
    if (fn.title && (!title || genericT)) propose('title', titleIfShouting(stripJunk(fn.title) || fn.title), fn.artist && clean ? HIGH : MED, 'nombre del archivo');
  }
  // basura de vídeos/webs, guiones bajos, mayúsculas
  const ca = cleanArtist(artist), ct = stripJunk(title);
  if (artist && ca !== artist) { issues.add('junk'); if (ca) propose('artist', ca, HIGH, 'limpieza de la etiqueta'); }
  if (title && ct !== title) { issues.add('junk'); if (ct) propose('title', ct, HIGH, 'limpieza de la etiqueta'); }
  for (const k of ['artist', 'title']) {
    const v = fields[k]?.val || (k === 'artist' ? artist : title) || cur[k];
    if (!/_/.test(v)) continue;
    issues.add('underscores');
    propose(k, v.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim(), HIGH, 'guiones bajos → espacios');
  }
  for (const k of ['artist', 'title', 'album']) {
    const v = fields[k]?.val || (k === 'album' ? fileTag.album : k === 'artist' ? artist : title);
    if (isShouting(v)) { issues.add('shouting'); propose(k, titleCase(v), MED, 'mayúsculas → tipo título'); }
  }
  // la forma habitual de escribir el artista en la biblioteca
  const akNow = artistKey(fields.artist?.val || artist);
  const spelled = ctx.spellings && akNow ? ctx.spellings.get(akNow) : '';
  if (spelled && spelled !== (fields.artist?.val || artist) && fold(spelled) === fold(fields.artist?.val || artist)) propose('artist', spelled, MED, 'otras pistas del mismo artista');
  // etiquetas que no tienen nada que ver con el nombre del archivo
  if (!issues.has('noArtist') && !issues.has('noTitle') && !genericT && fn.artist && fn.title && tagsMismatch(artist, title, file)) {
    issues.add('mismatch');
    propose('artist', cleanArtist(fn.artist), LOW, 'nombre del archivo');
    propose('title', stripJunk(fn.title) || fn.title, LOW, 'nombre del archivo');
  }
  // artista desde la carpeta (el archivo solo trae el título)
  const dirs = folderNames(track.path);
  const parentDir = dirs[dirs.length - 1] || '';
  if (!fields.artist && (!artist || isGenericArtist(artist)) && parentDir && !genreFrom(parentDir, { folder: true }) && !yearOf(parentDir) && !isGenericArtist(parentDir) && !/^(cd|disc|disco|vol)\s*\d+$/i.test(parentDir) && !/^[a-z]:$/i.test(parentDir) && dirs.length > 1) {
    propose('artist', stripJunk(parentDir.replace(/_/g, ' ')), LOW, 'carpeta');
  }
  // año
  const year = yearOf(fileTag.year);
  if (!year) {
    issues.add('noYear');
    for (const d of dirs.slice().reverse()) { const y = yearFromFolder(d); if (y) { propose('year', y, MED, 'carpeta'); break; } }
  } else if (year !== cur.year && !cur.year) propose('year', year, HIGH, 'etiqueta del archivo');
  // género
  const genre = fileTag.genre;
  if (!genre) {
    issues.add('noGenre');
    for (const d of dirs.slice().reverse()) { const g = genreFrom(d, { folder: true }); if (g) { propose('genre', g, MED, 'carpeta'); break; } }
    const ag = ctx.genres && akNow ? ctx.genres.get(akNow) : null;
    if (ag) propose('genre', ag.genre, MED, 'otras pistas del mismo artista');
  }
  // carátula (solo en los formatos donde se puede añadir)
  if (hasFileTags && !ft.cover) issues.add('noCover');
  // internet
  let cover = null;
  const on = ctx.online;
  if (on && on.conf) {
    const conf = on.conf === HIGH ? HIGH : MED;
    const needName = issues.has('noArtist') || issues.has('noTitle') || issues.has('generic');
    if (needName || issues.has('mismatch')) {
      propose('artist', on.artist, conf, 'internet');
      propose('title', on.title, conf, 'internet');
    } else if (on.conf === HIGH) {
      // mismo nombre con otra grafía (acentos, mayúsculas): solo se sugiere, con confianza media
      if (on.artist && fold(on.artist) === fold(fields.artist?.val || artist) && on.artist !== (fields.artist?.val || artist) && !fields.artist) propose('artist', on.artist, MED, 'internet');
      if (on.title && fold(on.title) === fold(fields.title?.val || title) && on.title !== (fields.title?.val || title) && !fields.title) propose('title', on.title, MED, 'internet');
    }
    if (!year && on.year) propose('year', on.year, conf, 'internet');
    if (!genre && on.genre) propose('genre', on.genre, conf === HIGH ? MED : LOW, 'internet');
    if (issues.has('noCover') && on.releaseId) cover = { conf, src: 'internet', releaseId: on.releaseId };
  }
  return { id: track.id, issues: [...issues], fields, cover };
}
const titleIfShouting = (s) => (isShouting(s) ? titleCase(s) : s);

// Revisión de toda la lista (ctx.online = Map id → coincidencia)
export function reviewTags(items, ctx = {}) {
  const all = ctx.allTracks || items.map(x => x.track);
  const genres = ctx.genres || artistGenres(all), spellings = ctx.spellings || artistSpellings(all);
  const out = [];
  for (const x of items) {
    if (!x.rec || x.rec.missing) continue;
    const r = reviewTrack(x.track, x.rec, { genres, spellings, online: ctx.online ? ctx.online.get(x.track.id) : null });
    if (r.issues.length || Object.keys(r.fields).length || r.cover) out.push(r);
  }
  // primero lo que más se nota (sin nombre, «Pista 01», basura…), después lo que solo falta (año, género, carátula)
  const weight = (r) => r.issues.reduce((s, i) => s + (MINOR.has(i) ? 1 : 10), 0) + Object.values(r.fields).reduce((s, f) => s + CONF_RANK[f.conf], 0);
  return out.map((r, i) => ({ r, i, w: weight(r) })).sort((a, b) => b.w - a.w || a.i - b.i).map(x => x.r);
}
const MINOR = new Set(['noYear', 'noGenre', 'noCover']);
// Qué buscar en internet para una pista: el artista y el título propuestos (o los actuales si están bien)
export function lookupQuery(track, review) {
  const f = (review && review.fields) || {};
  const artist = (f.artist && f.artist.conf !== LOW ? f.artist.val : '') || track.artist;
  const title = (f.title && f.title.conf !== LOW ? f.title.val : '') || track.title;
  if (!artist || !title || isGenericArtist(artist) || isGenericTitle(title)) return null;
  return { artist: cleanArtist(artist), title: parseVersion(stripJunk(title)).title || stripJunk(title) };
}

// ------------------------------------------------------------------ coincidencia en internet (MusicBrainz)
// cands: [{ id, title, artist, length (ms), date, score, releases: [{ id, date, type, status, title }], tags: [{name, count}] }]
// want: { artist, title, dur (s) }. Devuelve { artist, title, year, genre, releaseId, conf, score } o null
export function bestOnline(cands, want, artistTags = null) {
  const wa = artistKey(want.artist), wt = parseVersion(want.title).base;
  if (!wa || !wt) return null;
  let best = null;
  for (const c of cands || []) {
    const ca = artistKey(c.artist), ct = parseVersion(c.title).base;
    const sa = ca === wa ? 1 : textSim(ca, wa), st = ct === wt ? 1 : textSim(ct, wt);
    if (sa < 0.85 || st < 0.85) continue;
    const dd = want.dur > 0 && c.length > 0 ? Math.abs(c.length / 1000 - want.dur) : null;
    if (dd != null && dd > 8) continue;
    const s = (c.score || 0) / 100 * 0.3 + sa * 0.35 + st * 0.35 - (dd != null && dd > 3 ? 0.05 : 0);
    if (!best || s > best.s) best = { c, s, sa, st, dd };
  }
  if (!best) return null;
  const { c } = best;
  const exact = best.sa === 1 && best.st === 1 && (c.score || 0) >= 95 && (best.dd == null || best.dd <= 3);
  // la primera publicación oficial (álbum o sencillo) con fecha: año y carátula
  const rels = (c.releases || []).filter(r => r.id).slice().sort((a, b) => (relRank(a) - relRank(b)) || String(a.date || '9999').localeCompare(String(b.date || '9999')));
  const year = yearOf(c.date) || yearOf(rels.find(r => r.date)?.date);
  const tags = (c.tags && c.tags.length ? c.tags : artistTags) || [];
  return { artist: c.artist, title: c.title, year, genre: genreFromTags(tags), releaseId: rels[0]?.id || '', conf: exact ? HIGH : MED, score: Math.round(best.s * 100), mbid: c.id };
}
const relRank = (r) => (r.status && r.status !== 'Official' ? 2 : 0) + (r.type === 'Album' || r.type === 'Single' ? 0 : 1);
export function genreFromTags(tags) {
  const votes = new Map();
  for (const t of tags || []) { const g = genreFrom(t.name); if (g) votes.set(g, (votes.get(g) || 0) + Math.max(1, t.count || 0)); }
  const tot = [...votes.values()].reduce((s, n) => s + n, 0);
  const [g, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return g && n / tot >= 0.4 ? g : '';
}

// ------------------------------------------------------------------ calidad
export const QUALITY_LABEL = {
  lt128: 'Menos de 128 kbps', lt192: 'Entre 128 y 191 kbps', convert: 'Formato a convertir (WMA, APE…)',
  damaged: 'Archivo dañado', missing: 'El archivo no existe', short: 'Muy corta (< 30 s)', long: 'Muy larga (> 20 min)'
};
export const QUALITY_HINT = {
  lt128: 'Se oye mal en un equipo de sonido grande. Busca una copia mejor (320 kbps o sin pérdida).',
  lt192: 'Calidad justa para pinchar. Si puedes, consigue una copia de 320 kbps.',
  convert: 'Nexura no reproduce este formato. Conviértelo a FLAC o MP3 con un programa de conversión.',
  damaged: 'No se puede leer bien: puede estar cortado o corrupto. Vuelve a copiarlo o descárgalo de nuevo.',
  missing: 'El archivo se ha movido o borrado. Usa «Relocalizar» para buscarlo en otra carpeta.',
  short: 'Suelen ser samples, efectos o descargas cortadas.',
  long: 'Suelen ser sesiones o mezclas enteras, no canciones sueltas.'
};
export function qualityIssues(track, rec) {
  const out = [];
  if (!rec) return out;
  if (rec.missing) return ['missing'];
  if (rec.damaged) out.push('damaged');
  const ext = rec.fmt || extOf(track.path);
  if (CONVERT.has(ext)) out.push('convert');
  if (!rec.damaged && LOSSY_LOW.has(ext) && !rec.lossless && rec.br > 0) { if (rec.br < 128) out.push('lt128'); else if (rec.br < 192) out.push('lt192'); }
  const dur = rec.dur || track.duration || 0;
  if (dur > 0 && dur < 30) out.push('short');
  if (dur > 20 * 60) out.push('long');
  return out;
}
export function reviewQuality(items) {
  const out = [];
  for (const x of items) { const issues = qualityIssues(x.track, x.rec); if (issues.length) out.push({ id: x.track.id, issues }); }
  return out;
}

// ------------------------------------------------------------------ utilidades de presentación
export const confRank = (c) => CONF_RANK[c] || 0;
export function fmtDur(s) {
  if (!(s > 0)) return '--:--';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
