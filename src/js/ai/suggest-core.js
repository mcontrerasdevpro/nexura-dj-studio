// Lógica pura de la «Siguiente pista (IA)» (sin DOM; la prueban tools/test-sugerencias-ia.mjs y la usa
// ai/assistant.js). Qué manda, de más a menos:
// 1. BPM: solo se sugiere lo que se puede mezclar de verdad, ±6 % (o el doble y la mitad). Primero se filtra
//    por BPM (barato) y solo se puntúa lo que queda: con 28.000 pistas sugerir no bloquea la interfaz.
// 2. Género: mismo género o de la misma familia (house ↔ tech house ↔ deep house; techno ↔ tech house;
//    pop ↔ dance pop…). Los géneros incompatibles se penalizan fuerte (house → pop casi nunca sale).
// 3. Tonalidad (Camelot) y energía, con menos peso.
// Las pistas sin BPM no se sugieren (salvo, al final, las de género compatible) y las que no tienen tonalidad van
// detrás de las analizadas. Cada sugerencia lleva una explicación corta: «mismo género · 126 BPM · 8A→9A».

const parseCam = (c) => { const m = /^(\d+)([AB])$/.exec(c || ''); return m ? { n: +m[1], l: m[2] } : null; };
const wheel = (d) => ((d % 12) + 12) % 12;

// Margen de BPM para mezclar sin que se note el pitch
export const BPM_RANGE_PCT = 6;

// Relación armónica entre dos códigos Camelot → { score 0..1, label }
export function keyRelation(from, to) {
  const a = parseCam(from), b = parseCam(to);
  if (!a || !b) return { score: 0.4, label: '' };
  const d = wheel(b.n - a.n);
  if (a.l === b.l) {
    if (d === 0) return { score: 1, label: 'misma tonalidad' };
    if (d === 1) return { score: 0.92, label: 'armónica (+1)' };
    if (d === 11) return { score: 0.9, label: 'armónica (−1)' };
    if (d === 2) return { score: 0.62, label: 'subida de energía (+2)' };
    if (d === 7) return { score: 0.55, label: 'subida de semitono' };
    if (d === 10) return { score: 0.45, label: 'bajada (−2)' };
    return { score: 0.1, label: 'choque de tonalidad' };
  }
  if (d === 0) return { score: 0.86, label: a.l === 'A' ? 'relativa mayor' : 'relativa menor' };
  if ((a.l === 'A' && d === 1) || (a.l === 'B' && d === 11)) return { score: 0.6, label: 'diagonal' };
  return { score: 0.1, label: 'choque de tonalidad' };
}

// BPM más cercano al de referencia admitiendo ×½ y ×2 → { bpm, f, pct } (pct = diferencia en %)
export function nearestBpm(ref, bpm) {
  let c = bpm, f = 1;
  for (const k of [0.5, 2]) if (Math.abs(bpm * k - ref) < Math.abs(c - ref)) { c = bpm * k; f = k; }
  return { bpm: c, f, pct: (c - ref) / ref * 100 };
}
export const bpmInRange = (ref, bpm, range = BPM_RANGE_PCT) => !!(ref && bpm) && Math.abs(nearestBpm(ref, bpm).pct) <= range;

// BPM del candidato frente al de referencia → { score 0..1 (0 fuera de rango), pct, inRange, label }
export function bpmRelation(ref, bpm) {
  if (!ref || !bpm) return { score: 0.4, pct: null, inRange: null, label: '' };
  const { f, pct } = nearestBpm(ref, bpm);
  const inRange = Math.abs(pct) <= BPM_RANGE_PCT;
  const score = inRange ? 1 - 0.6 * Math.abs(pct) / BPM_RANGE_PCT : 0;
  const label = `${Math.round(bpm * 10) / 10} BPM${f !== 1 ? (f === 2 ? ' (×2)' : ' (×½)') : ''} · ${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %`;
  return { score, pct, inRange, label };
}

// ------------------------------------------------------------------ géneros
// «Deep-House», «House Music», «TECH HOUSE», «Électro» → «deep house», «house», «tech house», «electro»
export function normGenre(g) {
  return String(g || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/r\s*&\s*b|r\s*n\s*b/g, 'rnb').replace(/d\s*&\s*b|drum\s*(?:&|n|'n'|and)\s*bass/g, 'drum and bass')
    .replace(/hip[\s-]*hop/g, 'hip hop').replace(/&/g, ' and ')
    .replace(/[-_.·:()[\]{}"'!?+]/g, ' ').replace(/\b(music|musica|genre|style|estilo)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Familias: cada patrón (sobre el género normalizado) da una o varias familias. El orden importa: primero los
// más concretos («tech house» es house y también techno; «dance pop» es pop y dance).
const GENRE_RULES = [
  [/\btech house\b/, ['house', 'techno']],
  [/\b(melodic|progressive) house\b/, ['house', 'progressive']],
  [/\b(electro|big room|future|bass) house\b/, ['house', 'edm']],
  [/\b(nu|indie) disco\b/, ['disco', 'house']],
  [/\bdance ?pop\b|\belectro ?pop\b|\bsynth ?pop\b|\beuro ?pop\b/, ['pop', 'dance']],
  [/\blatin pop\b|\bpop latino\b/, ['pop', 'latin']],
  [/\b(minimal|melodic|peak time|hard|acid|industrial|detroit|dub) techno\b|\bminimal\b/, ['techno']],
  [/\bprogressive trance\b|\bprogressive\b/, ['progressive', 'trance']],
  [/\bhouse\b|\bgarage house\b|\bafro house\b|\bjackin\b/, ['house']],
  [/\btechno\b/, ['techno']],
  [/\btrance\b|\bpsy\b|\bpsytrance\b|\bgoa\b/, ['trance']],
  [/\bdrum and bass\b|\bdnb\b|\bjungle\b|\bliquid\b|\bneurofunk\b/, ['dnb']],
  [/\bdubstep\b|\briddim\b|\bbrostep\b|\bbass\b/, ['bass']],
  [/\buk garage\b|\bgarage\b|\b2 step\b|\bspeed garage\b/, ['garage']],
  [/\bbreaks?\b|\bbreakbeat\b/, ['breaks']],
  [/\bhardstyle\b|\bhardcore\b|\bhard dance\b|\bgabber\b/, ['hard']],
  [/\bedm\b|\bbig room\b|\belectro\b|\bfuture bass\b/, ['edm']],
  [/\beurodance\b|\bdance\b|\bitalo\b/, ['dance']],
  [/\bdisco\b|\bfunk\b|\bboogie\b/, ['disco']],
  [/\bsoul\b|\brnb\b|\bneo soul\b/, ['rnb']],
  [/\bhip hop\b|\brap\b|\btrap\b|\bdrill\b|\bgrime\b/, ['hiphop']],
  [/\breggaeton\b|\bdembow\b|\blatin\b|\bsalsa\b|\bbachata\b|\bcumbia\b|\bmerengue\b|\bmoombahton\b|\burbano\b|\bperreo\b/, ['latin']],
  [/\bk ?pop\b|\bj ?pop\b|\bpop\b|\bteen\b|\bschlager\b/, ['pop']],
  [/\brock\b|\bindie\b|\balternative\b|\bmetal\b|\bpunk\b|\bgrunge\b/, ['rock']],
  [/\bambient\b|\bchill\w*\b|\blounge\b|\bdowntempo\b|\blo ?fi\b|\btrip hop\b/, ['chill']],
  [/\breggae\b|\bdub\b|\bdancehall\b|\bska\b/, ['reggae']],
  [/\bjazz\b|\bblues\b|\bswing\b/, ['jazz']],
  [/\bclassical\b|\bclasica\b|\bsoundtrack\b|\bbso\b|\borchestral\b/, ['classical']],
  [/\bflamenco\b|\brumba\b|\bcopla\b|\bsevillanas\b/, ['flamenco']],
  [/\bcountry\b|\bfolk\b|\bacoustic\b|\bsinger songwriter\b/, ['folk']]
];

// Familias vecinas (se mezclan con cuidado). Lo que no aparece aquí es incompatible.
const NEAR = {
  'house|techno': 0.6, 'house|disco': 0.75, 'house|dance': 0.65, 'house|garage': 0.7, 'house|progressive': 0.8, 'house|edm': 0.65,
  'house|rnb': 0.4, 'house|latin': 0.35, 'house|breaks': 0.5,
  'techno|progressive': 0.65, 'techno|trance': 0.55, 'techno|hard': 0.45, 'techno|breaks': 0.45,
  'progressive|trance': 0.8, 'trance|edm': 0.55, 'trance|hard': 0.45, 'edm|dance': 0.75, 'edm|bass': 0.55, 'edm|hard': 0.5,
  'dance|pop': 0.65, 'dance|disco': 0.55, 'dance|latin': 0.4,
  'pop|disco': 0.5, 'pop|rnb': 0.45, 'pop|latin': 0.45, 'pop|rock': 0.35, 'pop|hiphop': 0.3,
  'disco|rnb': 0.6, 'rnb|hiphop': 0.75, 'hiphop|latin': 0.5, 'hiphop|bass': 0.35, 'latin|reggae': 0.45, 'hiphop|reggae': 0.35,
  'dnb|bass': 0.6, 'dnb|breaks': 0.7, 'garage|breaks': 0.6, 'garage|bass': 0.5, 'garage|rnb': 0.45,
  'chill|jazz': 0.45, 'chill|rnb': 0.35, 'jazz|rnb': 0.5, 'jazz|disco': 0.4, 'rock|folk': 0.5, 'flamenco|latin': 0.45, 'flamenco|folk': 0.4
};
const near = (a, b) => (a === b ? 1 : NEAR[a < b ? `${a}|${b}` : `${b}|${a}`] || 0);

const familyCache = new Map();
// Familias de un género (admite varios: «House; Tech House», «Pop / Dance») → { norm: [normalizados], fam: Set }
export function genreInfo(g) {
  const key = String(g || '');
  let r = familyCache.get(key);
  if (r) return r;
  const parts = key.split(/[;,/|]+/).map(normGenre).filter(Boolean);
  const fam = new Set();
  for (const p of parts) for (const [re, f] of GENRE_RULES) if (re.test(p)) { f.forEach(x => fam.add(x)); break; }
  r = { norm: parts, fam };
  if (familyCache.size > 5000) familyCache.clear();
  familyCache.set(key, r);
  return r;
}
export const genreFamilies = (g) => [...genreInfo(g).fam];

// Compatibilidad de géneros → { score 0..1, same, known, label }
//   1 mismo género · 0,85 misma familia · 0,35–0,8 familias vecinas · 0,05 incompatibles · 0,5 sin datos
export function genreRelation(from, to) {
  const a = genreInfo(from), b = genreInfo(to);
  if (!a.norm.length || !b.norm.length) return { score: a.norm.length || b.norm.length ? 0.45 : 0.55, same: false, known: false, label: '' };
  if (a.norm.some(x => b.norm.includes(x))) return { score: 1, same: true, known: true, label: 'mismo género' };
  if (!a.fam.size || !b.fam.size) {
    // géneros que no están en la tabla: se comparan las palabras («tribal house» y «house tribal»)
    const wa = new Set(a.norm.join(' ').split(' ')), shared = b.norm.join(' ').split(' ').some(w => w.length > 2 && wa.has(w));
    return { score: shared ? 0.7 : 0.4, same: false, known: false, label: shared ? 'género parecido' : '' };
  }
  let best = 0;
  for (const x of a.fam) for (const y of b.fam) best = Math.max(best, x === y ? 0.85 : near(x, y));
  if (best >= 0.85) return { score: best, same: false, known: true, label: 'misma familia de género' };
  if (best >= 0.5) return { score: best, same: false, known: true, label: 'género compatible' };
  if (best > 0) return { score: best, same: false, known: true, label: 'género de otra familia' };
  return { score: 0.05, same: false, known: true, label: 'género incompatible' };
}

export const ENERGY_MODES = { up: 'Subir energía', keep: 'Mantener energía', down: 'Bajar energía' };

// Puntuación de una transición from → to → { score 0..1, reasons: [etiquetas largas], why: explicación corta }
// refBpm / refKey: BPM y tonalidad que suenan ahora (con el pitch aplicado), si no los de la pista.
export function transitionScore(from, to, { refBpm, refKey, mode = 'keep' } = {}) {
  const fromKey = refKey ?? from.camelot, fromBpm = refBpm ?? from.bpm;
  const k = keyRelation(fromKey, to.camelot);
  const b = bpmRelation(fromBpm, to.bpm);
  const g = genreRelation(from.genre, to.genre);
  let eScore = 0.5, eLabel = '';
  if (from.energy && to.energy) {
    const target = from.energy + (mode === 'up' ? 1 : mode === 'down' ? -1 : 0);
    eScore = Math.max(0, 1 - Math.abs(to.energy - target) / 4);
    eLabel = `energía ${to.energy}`;
  }
  // género y BPM pesan más que tonalidad y energía
  let score = 0.35 * g.score + 0.3 * b.score + 0.2 * k.score + 0.15 * eScore;
  if (g.known && g.score < 0.3) score *= 0.3;          // géneros incompatibles: casi nunca
  else if (g.known && g.score < 0.5) score *= 0.7;     // de otra familia: detrás
  if (b.inRange === false) score *= 0.2;               // fuera de rango de BPM: no se puede mezclar
  else if (b.inRange === null) score *= 0.6;           // sin BPM: al final
  if (k.score <= 0.1) score *= 0.8;                    // choque de tonalidad
  if (to.source === 'youtube') score -= 0.03;          // sin forma de onda ni FX: algo menos práctica
  const why = [
    g.label === 'mismo género' ? 'mismo género' : g.label && to.genre ? `${g.label === 'género incompatible' ? 'otro género' : g.label.replace('misma familia de género', 'género afín')}: ${to.genre}` : '',
    to.bpm ? `${Math.round(to.bpm)} BPM${b.inRange === false ? ' (fuera de rango)' : ''}` : 'sin BPM',
    fromKey && to.camelot ? `${fromKey}→${to.camelot}` : to.camelot ? to.camelot : 'sin tonalidad'
  ].filter(Boolean).join(' · ');
  return { score: Math.max(0, Math.min(1, score)), reasons: [g.label, k.label, b.label, eLabel].filter(Boolean), why };
}

// Sugerencias para la siguiente pista desde «from» (la que suena) entre «tracks» (iterable).
// Devuelve [{ track, score, reasons, why }] ordenadas: primero las analizadas (BPM + tonalidad) dentro del rango
// de BPM; después las de BPM en rango sin tonalidad; al final, solo si el género encaja, las que no tienen BPM.
// Las de BPM fuera de rango se descartan sin puntuarlas.
export function rankSuggestions(from, tracks, { refBpm, refKey, mode = 'keep', exclude = null, limit = 60 } = {}) {
  const bpm = refBpm || from.bpm;
  const tiers = [[], [], []];
  for (const t of tracks) {
    if (t === from || (exclude && exclude.has(t.id))) continue;
    if (!t.bpm && !t.camelot) continue;                                   // sin analizar
    let tier;
    if (t.bpm && bpm) { if (!bpmInRange(bpm, t.bpm)) continue; tier = t.camelot ? 0 : 1; }
    else if (t.bpm) tier = t.camelot ? 0 : 1;                             // la de referencia no tiene BPM
    else tier = 2;
    const r = transitionScore(from, t, { refBpm: bpm, refKey, mode });
    if (tier === 2 && genreRelation(from.genre, t.genre).score < 0.6) continue;
    tiers[tier].push({ track: t, ...r });
  }
  const out = [];
  for (const list of tiers) {
    if (out.length >= limit) break;
    list.sort((a, b) => b.score - a.score);
    out.push(...list.slice(0, limit - out.length));
  }
  return out;
}
