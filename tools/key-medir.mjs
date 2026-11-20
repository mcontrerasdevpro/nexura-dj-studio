// Medición de la detección de tonalidad con temas REALES (solo en el PC con E:\Musica; si no existe, se salta).
// Referencia: la tonalidad de las etiquetas de los archivos (TKEY / initialkey; ver tools/key-tags.mjs). OJO: las
// etiquetas las puso otro programa o una persona y pueden tener errores: es una referencia aproximada.
// Para cada tema: tonalidad detectada por el análisis de la app y comparación con la etiqueta →
//   exacta · compatible (quinta: ±1 en la rueda Camelot; relativa: mismo número A↔B; paralela: misma tónica,
//   mayor↔menor) · grave (el resto).
// Los archivos se leen en su sitio con ffmpeg: no se copian ni se guarda su audio.
// Uso: node tools/key-medir.mjs [--core ruta/analysis-core.js] [--n 80] [--json salida.json] [--lista lista.json]
//      [--seed 7] [--detalle]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasFfmpeg, decodeMono } from './beat-medir.mjs';
import { listAudio, readKeyTag, parseKeyTag, camelotOf } from './key-tags.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = 'E:\\Musica';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SR = 48000;

// Relación entre dos tonalidades (Camelot «8A») → 'exacta' | 'quinta' | 'relativa' | 'paralela' | 'grave'
export function relation(a, b) {
  const ma = /^(\d+)([AB])$/.exec(a || ''), mb = /^(\d+)([AB])$/.exec(b || '');
  if (!ma || !mb) return 'grave';
  const na = +ma[1], nb = +mb[1];
  if (a === b) return 'exacta';
  if (ma[2] === mb[2] && (Math.abs(na - nb) === 1 || Math.abs(na - nb) === 11)) return 'quinta';
  if (na === nb) return 'relativa';
  // paralela: misma tónica, otro modo (C mayor 8B ↔ C menor 5A: el menor está 3 posiciones antes)
  const par = ma[2] === 'B' ? (((na - 1 - 3) % 12) + 12) % 12 + 1 : ((na - 1 + 3) % 12) + 1;
  if (mb[2] !== ma[2] && nb === par) return 'paralela';
  return 'grave';
}

// Selección reproducible de temas con etiqueta de tonalidad: repartidos por carpetas, ~3/4 menores y ~1/4 mayores
export function pickTracks(n = 80, seed = 7) {
  const files = listAudio(BASE).filter(f => /\.mp3$/i.test(f)).sort();
  const tagged = [];
  for (const f of files) { const raw = readKeyTag(f); const k = parseKeyTag(raw); if (k) tagged.push({ f, raw, k }); }
  // pseudoaleatorio con semilla (mulberry32)
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const dirOf = (f) => path.dirname(f);
  const pick = (list, m) => {
    const out = [], perDir = new Map();
    for (const x of shuffle(list.slice())) {
      const d = dirOf(x.f);
      if ((perDir.get(d) || 0) >= 2) continue; // como mucho 2 por carpeta (no todo del mismo disco)
      perDir.set(d, (perDir.get(d) || 0) + 1);
      out.push(x);
      if (out.length >= m) break;
    }
    return out;
  };
  const maj = tagged.filter(x => !x.k.minor), min = tagged.filter(x => x.k.minor);
  const nMaj = Math.round(n / 4);
  return { tagged: tagged.length, list: [...pick(min, n - nMaj), ...pick(maj, nMaj)].map(x => ({ p: path.relative(BASE, x.f), raw: x.raw, ref: camelotOf(x.k) })) };
}

export async function loadKeyFn(corePath) {
  const core = await import(pathToFileURL(corePath));
  // rc.10: analyzeKey(mono, sr) en el núcleo; antes: detectKey sobre la señal diezmada a ~11 kHz
  if (core.analyzeKey) return (x, sr) => core.analyzeKey(x, sr);
  return (x, sr) => { const { d, sr: s2 } = core.decimate(x, sr, 11025); return core.detectKey(d, s2); };
}

export function summarize(rows) {
  const n = rows.length, c = (k) => rows.filter(r => r.rel === k).length;
  const ex = c('exacta'), q = c('quinta'), rl = c('relativa'), pa = c('paralela'), g = c('grave');
  const pct = (v) => (n ? Math.round(v / n * 1000) / 10 : 0);
  return { n, exacta: ex, quinta: q, relativa: rl, paralela: pa, grave: g, pctExacta: pct(ex), pctCompatible: pct(ex + q + rl + pa), pctGrave: pct(g) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!fs.existsSync(BASE)) { console.log(`⚠ No existe ${BASE}: medición saltada`); process.exit(0); }
  if (!hasFfmpeg()) { console.log('⚠ ffmpeg no está en el PATH: medición saltada'); process.exit(0); }
  const corePath = arg('--core') ? path.resolve(arg('--core')) : path.join(root, 'src/js/analysis/analysis-core.js');
  const keyOf = await loadKeyFn(corePath);
  let sel;
  const lista = arg('--lista');
  if (lista && fs.existsSync(lista)) sel = JSON.parse(fs.readFileSync(lista, 'utf8'));
  else { sel = pickTracks(+(arg('--n') || 80), +(arg('--seed') || 7)); if (lista) fs.writeFileSync(lista, JSON.stringify(sel, null, 1)); }
  console.log(`${sel.tagged} temas con tonalidad en la etiqueta; se miden ${sel.list.length} · núcleo ${path.relative(root, corePath)}`);
  const rows = [];
  const t0 = Date.now();
  for (const tr of sel.list) {
    const file = path.join(BASE, tr.p);
    if (!fs.existsSync(file)) continue;
    let x;
    try { x = decodeMono(file, SR); } catch (_) { console.log('⚠ no se pudo decodificar: ' + path.basename(tr.p)); continue; }
    const t1 = Date.now();
    const k = keyOf(x, SR);
    const ms = Date.now() - t1;
    const got = k ? camelotOf(k) : '';
    const rel = relation(tr.ref, got);
    rows.push({ t: path.basename(tr.p).replace(/\.[^.]+$/, ''), ref: tr.ref, raw: tr.raw, got, rel, ms, conf: k && k.conf != null ? +k.conf.toFixed(3) : null, tune: k && k.tuning != null ? +k.tuning.toFixed(1) : null });
    if (process.argv.includes('--detalle')) console.log(`  ${rel.padEnd(8)} ref ${tr.ref.padEnd(3)} (${tr.raw}) → ${got.padEnd(3)} ${ms} ms  ${rows[rows.length - 1].t.slice(0, 60)}`);
  }
  const sum = summarize(rows);
  console.log(`\n${sum.n} temas · exacta ${sum.exacta} (${sum.pctExacta} %) · quinta ${sum.quinta} · relativa ${sum.relativa} · paralela ${sum.paralela} · grave ${sum.grave} (${sum.pctGrave} %) · compatibles (incl. exacta) ${sum.pctCompatible} % · ${Math.round((Date.now() - t0) / 1000)} s`);
  const json = arg('--json');
  if (json) fs.writeFileSync(json, JSON.stringify({ core: path.relative(root, corePath), sum, rows }, null, 1));
}
