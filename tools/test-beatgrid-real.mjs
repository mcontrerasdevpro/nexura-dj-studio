// Beatgrid con pistas REALES (solo en el PC de Miguel: E:\Musica\Dance; si no existe, se salta con un aviso).
// Para cada pista: BPM detectado, primer beat, número de marcas y la deriva del grid frente a los golpes de bombo
// medidos en el audio (tools/beat-medir.mjs) al principio, a la mitad y al final. Comprueba que en los temas
// 4/4 estables la deriva máxima quede por debajo de 10 ms. Después, SYNC con dos pistas reales a distinto BPM
// durante 3 min (con y sin key lock) midiendo la desviación entre los bombos EN EL AUDIO DE SALIDA de los decks.
// Las pistas se leen en su sitio: no se copian ni se guardan.
// Uso: node tools/test-beatgrid-real.mjs [--core ruta/analysis-core.js] [--json salida.json] [--sin-sync] [--solo N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasFfmpeg, decodeMono, bassEnvelope, measureGrid } from './beat-medir.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'E:\\Musica\\Dance';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SR = 48000;

// 14 pistas variadas: house, trance, makina, remember, bases y alguna con intro sin bombo (intro: true)
export const TRACKS = [
  { g: 'house', p: 'House\\Dayvi Ft. Victor Cárdenas & Kelly Ruiz - Baila Conmigo (Original Mix).mp3' },
  { g: 'house', p: 'Años 90\\90\'s Dance Hits\\Wamdue Project - King of my castle.mp3' },
  { g: 'house', p: 'Años 2010\\Wally Lopez - Power To You.mp3' },
  { g: 'trance', p: 'Trance\\A State Of Trance (Classics The Full Unmixed Versions)-4CD-2006\\CD1\\03 - system f - out of the blue.mp3' },
  { g: 'trance', p: 'Trance\\A State Of Trance (Classics The Full Unmixed Versions)-4CD-2006\\CD4\\09 - three drives on a vinyl - greece 2000.mp3' },
  { g: 'trance', p: 'Trance\\Armin van Buuren - A State Of Trance Top 20 - 2022, Vol. 1 (Selected by Armin van Buuren) (2022)\\01. Armin van Buuren - Human Touch (Club Mix).mp3' },
  { g: 'trance', intro: true, p: 'Trance\\A State Of Trance (Classics The Full Unmixed Versions)-4CD-2006\\CD1\\01 - delerium ft. sarah mclachlan - silence (tiestos in search of sunrise mix).mp3' },
  { g: 'makina', p: 'Años 90\\90\'s Dance Hits\\chasis - happy people (makina90).mp3' },
  { g: 'makina', p: 'Album Completos\\TECHNO VALENCIA - VOL. 06 - B€NY - 2 CD\'s - 2006 - 2011\\CD - 1\\04 - Speed Limits - Remember.mp3' },
  { g: 'makina', p: 'Recopilatorios 90\\MAQUINA TOTAL\\Máquina Total 15 (2004)\\Cd2\\01.Bluestorm - Land of freedom.mp3' },
  { g: 'bases', p: 'Años 90\\90\'s Dance Hits\\DLM -  Let Yourself Go (Museo Dance - Bases 90).mp3' },
  { g: 'remember', p: 'Años 90\\90\'s Progressive, Techno E Trance\\Emmanuel Top - Acid Phase (Original club mix).mp3' },
  { g: 'remember', p: 'Recopilatorios 90\\MAQUINA TOTAL\\Máquina Total 15 (2004)\\Cd2\\03Gigi D\'Agostino - Another Way.mp3' },
  { g: 'trance', intro: true, p: 'Años 90\\90\'s Progressive, Techno E Trance\\Robert Miles - Children.mp3' }
];

if (!fs.existsSync(BASE)) { console.log(`⚠ No existe ${BASE}: prueba con pistas reales saltada (solo se ejecuta en el PC con la música)`); process.exit(0); }
if (!hasFfmpeg()) { console.log('⚠ ffmpeg no está en el PATH: prueba con pistas reales saltada'); process.exit(0); }

const corePath = arg('--core') ? path.resolve(arg('--core')) : path.join(root, 'src/js/analysis/analysis-core.js');
const { analyze } = await import(pathToFileURL(corePath));
const Grid = await import(pathToFileURL(path.join(root, 'src/js/audio/grid.js')));

let failed = 0, total = 0;
const check = (name, ok, data) => { total++; if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok ? ' ' + JSON.stringify(data) : ''}`); };
const name = (p) => path.basename(p).replace(/\.[^.]+$/, '');

// Pista como la guarda la app tras analizarla (Analyzer.meta)
function asTrack(r, duration) {
  const t = { bpm: r.bpm, firstBeat: r.firstBeat, grid: null };
  if (r.grid && r.grid.length > 1) Object.assign(t, Grid.gridUpdate(r.grid, duration));
  return t;
}

const rows = [];
const only = arg('--solo') ? +arg('--solo') : TRACKS.length;
const grids = new Map(); // título → pista con su grid (para el SYNC)
for (const tr of TRACKS.slice(0, only)) {
  const file = path.join(BASE, tr.p);
  if (!fs.existsSync(file)) { console.log(`⚠ no está: ${name(tr.p)}`); continue; }
  const x = decodeMono(file, SR), duration = x.length / SR;
  const t0 = Date.now();
  const r = analyze(x, SR, {});
  const ms = Date.now() - t0;
  if (!r.bpm) { rows.push({ title: name(tr.p), g: tr.g, bpm: null }); continue; }
  const t = asTrack(r, duration);
  const env = bassEnvelope(x, SR);
  const nB = Math.floor(Grid.beatAt(t, duration)) + 1;
  const m = measureGrid(env, (b) => Grid.beatTime(t, b), nB, t.bpm, duration, t.firstBeat);
  const row = { title: name(tr.p), g: tr.g, intro: !!tr.intro, dur: Math.round(duration), bpm: r.bpm, firstBeat: +r.firstBeat.toFixed(4), marks: t.grid ? t.grid.length : 1, ...m, ms };
  rows.push(row);
  grids.set(tr.p, t);
  console.log(`  ${row.title.slice(0, 48).padEnd(48)} ${String(row.bpm).padEnd(8)} marcas ${row.marks}  inicio ${row.start} · mitad ${row.mid} · final ${row.end} ms  (cob. ${row.coverage}, real ${row.realBpm} ±${row.realResidP90} ms, ${ms} ms)`);
}

// temas 4/4 estables: con un reloj constante, los golpes encajan en una recta (residuo p90 ≤ 6 ms) en la mayoría de zonas
const stable = rows.filter(r => r.bpm && r.stable);
for (const r of stable) check(`${r.title}: deriva máx. ${r.max} ms (< 10 ms) · ${r.bpm} BPM`, r.max != null && r.max < 10, r);
check(`Al menos 8 temas 4/4 estables medidos (${stable.length})`, stable.length >= 8, rows.map(r => [r.title, r.realResidP90, r.coverage, r.stable]));
check('Temas de tempo constante: grid constante (1 marca) en todos los estables', stable.every(r => r.marks === 1), stable.filter(r => r.marks > 1).map(r => [r.title, r.marks]));
// sin redondear a 0,01 ni a un entero cercano: el BPM guardado coincide con el de los golpes a ±0,003
check('BPM con precisión de milésimas en los estables (|BPM − BPM de los golpes| ≤ 0,003)', stable.every(r => Math.abs(r.bpm - r.realBpm) <= 0.003), stable.map(r => [r.title, r.bpm, r.realBpm]));

// ---------------------------------------------------------------- SYNC con pistas reales, medido en el audio
// Dos pistas a distinto BPM desde el segundo 30, SYNC en la segunda y 3 min sonando: desviación entre los bombos
// que salen de los dos decks (mediana de las zonas de 16 beats de ±10 s) a los 0,5, 1,5 y 3 min
const syncRows = [];
if (!process.argv.includes('--sin-sync')) {
  const { syncRun } = await import(pathToFileURL(path.join(root, 'tools/sync-sim.mjs')));
  const { outputDeviation } = await import(pathToFileURL(path.join(root, 'tools/beat-medir.mjs')));
  const find = (s) => TRACKS.find(t => t.p.includes(s));
  const PAIRS = [
    { a: 'three drives', b: 'Emmanuel Top', kl: false },
    { a: 'three drives', b: 'Emmanuel Top', kl: true },
    { a: 'system f', b: 'chasis', kl: false },
    { a: 'system f', b: 'chasis', kl: true }
  ];
  const START = 30;
  for (const pr of PAIRS) {
    const A = find(pr.a), B = find(pr.b);
    if (!A || !B || !grids.has(A.p) || !grids.has(B.p)) continue;
    const ta = grids.get(A.p), tb = grids.get(B.p);
    const run = await syncRun({ a: { x: decodeMono(path.join(BASE, A.p), SR), track: ta }, b: { x: decodeMono(path.join(BASE, B.p), SR), track: tb }, seconds: 192, aStart: START, bStart: START, keylockB: pr.kl });
    const envA = bassEnvelope(run.out[0], SR), envB = bassEnvelope(run.out[1], SR);
    const clock = (k) => Grid.beatTime(run.tA, k) - START;
    const at = (t) => outputDeviation(envA, envB, clock, Math.round(Grid.beatAt(run.tA, START + t - 10)), Math.round(Grid.beatAt(run.tA, START + t + 10)), 60 / ta.bpm).median;
    const row = { a: name(A.p), b: name(B.p), bpmA: ta.bpm, bpmB: tb.bpm, keylock: pr.kl, pct: +((ta.bpm / tb.bpm - 1) * 100).toFixed(2), m05: at(30), m15: at(90), m3: at(180) };
    syncRows.push(row);
    console.log(`  SYNC ${row.b.slice(0, 30)} (${row.bpmB}) → ${row.a.slice(0, 30)} (${row.bpmA}), ${row.pct} %${pr.kl ? ', key lock' : ''}: bombos en la salida ${row.m05} · ${row.m15} · ${row.m3} ms (0,5 · 1,5 · 3 min)`);
    // la medida en el audio tiene ±3 ms de ruido (bombos distintos en cada tema); por debajo de ~10 ms no se
    // oye «flam» entre los dos bombos
    const lim = pr.kl ? 12 : 8;
    check(`SYNC real ${row.b} → ${row.a}${pr.kl ? ' con key lock' : ''}: |desviación de los bombos en el audio| < ${lim} ms a los 0,5, 1,5 y 3 min`, [row.m05, row.m15, row.m3].every(v => v != null && Math.abs(v) < lim), row);
  }
}

const json = arg('--json');
if (json) fs.writeFileSync(json, JSON.stringify({ core: path.relative(root, corePath), rows, sync: syncRows }, null, 1));

console.log(`\n${total - failed}/${total} comprobaciones del beatgrid con pistas reales correctas`);
process.exit(failed ? 1 : 0);
