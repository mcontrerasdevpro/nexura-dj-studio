// Tonalidad con temas REALES (solo en el PC con E:\Musica; si no existe, se salta con un aviso). 80 temas con la
// tonalidad en la etiqueta del archivo (tools/key-medir.mjs → pickTracks, selección reproducible): el detector de
// rc.10 (key-core.js) frente a la etiqueta y frente al de rc.9 (detectKey, que sigue en analysis-core.js para
// comparar). OJO: la etiqueta la puso otro programa o una persona y puede estar mal; por eso se piden mínimos y no
// el 100 %. Los archivos se leen en su sitio: no se copian.
// Uso: node tools/test-key-real.mjs [--n 80] [--json salida.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasFfmpeg, decodeMono } from './beat-medir.mjs';
import { pickTracks, relation, summarize, BASE } from './key-medir.mjs';
import { camelotOf } from './key-tags.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!fs.existsSync(BASE)) { console.log(`⚠ No existe ${BASE}: prueba de tonalidad con temas reales saltada (solo se ejecuta en el PC con la música)`); process.exit(0); }
if (!hasFfmpeg()) { console.log('⚠ ffmpeg no está en el PATH: prueba de tonalidad con temas reales saltada'); process.exit(0); }

const AC = await import(pathToFileURL(path.join(root, 'src/js/analysis/analysis-core.js')));
const KC = await import(pathToFileURL(path.join(root, 'src/js/analysis/key-core.js')));

let failed = 0, total = 0;
const check = (name, ok, data) => { total++; if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && data !== undefined ? ' ' + JSON.stringify(data) : ''}`); };

const sel = pickTracks(+(arg('--n') || 80), 23);
const now = [], old = [];
let ms = 0;
for (const tr of sel.list) {
  let x;
  try { x = decodeMono(path.join(BASE, tr.p), 48000); } catch (_) { continue; }
  const { d, sr } = AC.decimate(x, 48000, 11025);
  const t0 = Date.now();
  const k = KC.keyFromDecimated(d, sr);
  ms += Date.now() - t0;
  const o = AC.detectKey(d, sr);
  now.push({ t: path.basename(tr.p), ref: tr.ref, got: k ? camelotOf(k) : '', rel: relation(tr.ref, k ? camelotOf(k) : '') });
  old.push({ rel: relation(tr.ref, o ? camelotOf(o) : '') });
}
const a = summarize(now), b = summarize(old);
console.log(`  ${a.n} temas · rc.10: exacta ${a.pctExacta} %, compatibles ${a.pctCompatible} %, graves ${a.grave} · rc.9: exacta ${b.pctExacta} %, compatibles ${b.pctCompatible} %, graves ${b.grave} · ${Math.round(ms / Math.max(1, a.n))} ms por tema`);
check(`Al menos 40 temas medidos (${a.n})`, a.n >= 40);
check(`Acierto exacto ≥ 50 % (${a.pctExacta} %)`, a.pctExacta >= 50, a);
check(`Exactas + compatibles (quinta, relativa, paralela) ≥ 75 % (${a.pctCompatible} %)`, a.pctCompatible >= 75, a);
check(`Mejor que el detector de rc.9 en al menos 5 puntos (${b.pctExacta} % → ${a.pctExacta} %)`, a.pctExacta >= b.pctExacta + 5, { rc9: b, rc10: a });
check(`Rápido: < 1,5 s por tema (${Math.round(ms / Math.max(1, a.n))} ms)`, ms / Math.max(1, a.n) < 1500);
const json = arg('--json');
if (json) fs.writeFileSync(json, JSON.stringify({ rc10: a, rc9: b, rows: now }, null, 1));
console.log(`\n${total - failed}/${total} comprobaciones de tonalidad con temas reales correctas`);
process.exit(failed ? 1 : 0);
