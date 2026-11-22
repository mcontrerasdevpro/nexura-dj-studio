// Medición de los cues automáticos con temas REALES (solo en el PC con E:\Musica\Dance; las pistas se leen en su
// sitio con ffmpeg, no se copian). Para cada tema:
// 1. El análisis de la app (analysis-core.js: BPM, grid y forma de onda) y los cues automáticos de antes (el
//    autocues-core.js de HEAD o el que se pase con --antes) y de ahora.
// 2. Una referencia independiente del algoritmo, por compás y con el audio (no con la forma de onda de la app):
//    bombo (golpe grave en cada beat, tools/beat-medir.mjs), bajos (< 150 Hz) y energía. De ahí, las partes:
//    - Entrada: primer compás desde el que suena el bombo de verdad (3 de 4 compases seguidos).
//    - Break: tramo de 4+ compases sin bombo, con caída de bajos o de energía, entre partes con bombo.
//    - Drop: donde vuelven el bombo y los bajos tras un break.
//    - Outro: desde donde la mezcla empieza a vaciarse sin volver (se van los bajos o la energía baja 4+ dB) hasta el
//      final, si quedan 8+ compases.
// 3. Acierto: el cue está a ±1 compás de una parte de su tipo (Inicio: del primer sonido). Malo: no hay ninguna
//    parte de su tipo a ±1 compás. Falta: hay parte y no hay cue.
// Uso: node tools/cues-medir.mjs [--antes ruta/autocues-core.js] [--ascii salida.txt] [--json salida.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasFfmpeg, decodeMono, bassEnvelope, onsetNear } from './beat-medir.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'E:\\Musica\\Dance';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SR = 44100;

export const TRACKS = [
  'House\\Dayvi Ft. Victor Cárdenas & Kelly Ruiz - Baila Conmigo (Original Mix).mp3',
  'Años 90\\90\'s Dance Hits\\Wamdue Project - King of my castle.mp3',
  'Trance\\A State Of Trance (Classics The Full Unmixed Versions)-4CD-2006\\CD1\\03 - system f - out of the blue.mp3',
  'Trance\\A State Of Trance (Classics The Full Unmixed Versions)-4CD-2006\\CD4\\09 - three drives on a vinyl - greece 2000.mp3',
  'Trance\\Armin van Buuren - A State Of Trance Top 20 - 2022, Vol. 1 (Selected by Armin van Buuren) (2022)\\01. Armin van Buuren - Human Touch (Club Mix).mp3',
  'Trance\\A State Of Trance (Classics The Full Unmixed Versions)-4CD-2006\\CD1\\01 - delerium ft. sarah mclachlan - silence (tiestos in search of sunrise mix).mp3',
  'Años 90\\90\'s Dance Hits\\chasis - happy people (makina90).mp3',
  'Recopilatorios 90\\MAQUINA TOTAL\\Máquina Total 15 (2004)\\Cd2\\01.Bluestorm - Land of freedom.mp3',
  'Años 90\\90\'s Progressive, Techno E Trance\\Emmanuel Top - Acid Phase (Original club mix).mp3',
  'Años 90\\90\'s Progressive, Techno E Trance\\Robert Miles - Children.mp3'
];

if (!fs.existsSync(BASE)) { console.log(`⚠ No existe ${BASE}: medición saltada`); process.exit(0); }
if (!hasFfmpeg()) { console.log('⚠ ffmpeg no está en el PATH: medición saltada'); process.exit(0); }

const { analyze } = await import(pathToFileURL(path.join(root, 'src/js/analysis/analysis-core.js')));
const Grid = await import(pathToFileURL(path.join(root, 'src/js/audio/grid.js')));
const NEW = await import(pathToFileURL(path.join(root, 'src/js/ai/autocues-core.js')));
// versión de antes: su import relativo del grid se cambia por la ruta del worktree
async function loadOld() {
  const src = arg('--antes') ? fs.readFileSync(path.resolve(arg('--antes')), 'utf8') : null;
  if (!src) return null;
  const tmp = path.join(path.dirname(path.resolve(arg('--antes'))), 'autocues-antes-abs.mjs');
  fs.writeFileSync(tmp, src.replace(/from '\.\.\/audio\/grid\.js'/, `from '${pathToFileURL(path.join(root, 'src/js/audio/grid.js')).href}'`));
  return import(pathToFileURL(tmp));
}
const OLD = await loadOld();

// filtro paso bajo de un polo, dos veces
function lowpass(x, sr, fc) {
  const a = 1 - Math.exp(-2 * Math.PI * fc / sr), y = new Float32Array(x.length);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { s1 += a * (x[i] - s1); s2 += a * (s1 - s2); y[i] = s2; }
  return y;
}
const db = (v) => 10 * Math.log10(v + 1e-12);
const pctl = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

// Rasgos por compás desde el compás del Inicio (b0 = beat del primer downbeat con música)
function barFeatures(x, track, b0, nBars) {
  const env = bassEnvelope(x, SR);
  const sub = lowpass(x, SR, 150);
  const rms = (sig, t0, t1) => { const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(sig.length, Math.floor(t1 * SR)); let s = 0; for (let i = i0; i < i1; i++) s += sig[i] * sig[i]; return i1 > i0 ? s / (i1 - i0) : 0; };
  const F = [];
  for (let k = 0; k < nBars; k++) {
    const t0 = Grid.beatTime(track, b0 + 4 * k), t1 = Grid.beatTime(track, b0 + 4 * k + 4);
    let kicks = 0, off = 0;
    for (let j = 0; j < 4; j++) {
      const tb = Grid.beatTime(track, b0 + 4 * k + j), bl = Grid.beatTime(track, b0 + 4 * k + j + 1) - tb;
      const o = onsetNear(env, tb, 0.04); if (o && o.s >= 0.35 * env.loud) kicks++;
      off += rms(sub, tb + 0.45 * bl, tb + 0.85 * bl) / 4; // la línea de bajo: graves ENTRE bombos (sin el golpe)
    }
    F.push({ k, t: t0, kick: kicks / 4, bass: db(rms(sub, t0, t1)), en: db(rms(x, t0, t1)), bassOff: db(off) });
  }
  const bRef = pctl(F.map(f => f.bass), 0.9), eRef = pctl(F.map(f => f.en), 0.9), oRef = pctl(F.map(f => f.bassOff), 0.9);
  for (const f of F) { f.bass -= bRef; f.en -= eRef; f.bassOff -= oRef; }
  return F;
}

// Partes de referencia a partir de los rasgos. Estados por compás: LLENO = bombo (3-4 golpes) y bajos a ≤ 3 dB de
// lo normal del tema; BAJO = bajos 7+ dB por debajo, o sin bombo y con la energía 3+ dB por debajo; el resto, parcial
function reference(F) {
  const n = F.length, kickOn = (k) => k >= 0 && k < n && F[k].kick >= 0.75;
  // (bombo en 2+ beats: hay partes con el bombo a medio tiempo que siguen siendo «llenas»)
  const full = (k) => k >= 0 && k < n && F[k].kick >= 0.5 && F[k].bass >= -3;
  const low = (k) => k >= 0 && k < n && (F[k].bass <= -7 || (!kickOn(k) && F[k].en <= -3));
  const firstSound = F.findIndex(f => f.en > -30);
  let entry = -1;
  for (let k = 0; k + 4 <= n; k++) if (kickOn(k) && [k, k + 1, k + 2, k + 3].filter(kickOn).length >= 3) { entry = k; break; }
  // breaks: tramos de 4+ compases no llenos con al menos 2 bajos, entre partes llenas (4+ compases)
  const fullRun = (a, b) => { let c = 0; for (let k = a; k < b; k++) if (full(k)) c++; return c; };
  const breaks = [], drops = [];
  for (let k = Math.max(0, entry); entry >= 0 && k < n;) {
    if (full(k)) { k++; continue; }
    let e = k; while (e < n && !full(e)) e++;
    let lows = 0; for (let j = k; j < e; j++) if (low(j)) lows++;
    if (e - k >= 4 && lows >= 2 && fullRun(k - 6, k) >= 4 && e + 4 <= n && fullRun(e, e + 6) >= 4) { breaks.push(k); drops.push(e); }
    k = e;
  }
  // outro: tras la última parte llena (4+ compases), la mezcla se vacía y no vuelve (quedan 8+ compases)
  const mean = (a, b, key) => { let s = 0, c = 0; for (let k = Math.max(0, a); k < Math.min(n, b); k++) { s += F[k][key]; c++; } return c ? s / c : -99; };
  let outro = -1, lastFull = -1;
  for (let k = n - 1; k >= 3; k--) if (full(k) && full(k - 1) && full(k - 2) && full(k - 3)) { lastFull = k; break; }
  if (lastFull >= 0 && n - (lastFull + 1) >= 8) outro = lastFull + 1;
  else if (lastFull >= 0) {
    // lleno hasta el final: la energía baja 3+ dB en los últimos compases y no vuelve
    const ref = mean(lastFull - 24, lastFull - 8, 'en');
    for (let k = Math.max(entry + 8, lastFull - 40); k < n - 8; k++) if (mean(k, n, 'en') < ref - 3 && F.slice(k).every(f => f.en < ref - 1)) { outro = k; break; }
  }
  // v4 (fran6): subidones = entradas a una parte llena (6+ compases) tras 4+ compases que no lo son
  const rises = [];
  for (let k = 1; k < n;) {
    if (!full(k)) { k++; continue; }
    let e = k; while (e < n && (full(e) || full(e + 1))) e++;
    let p = k; while (p > 0 && !full(p - 1)) p--;
    if (e - k >= 6 && k - p >= 4) rises.push(k);
    k = Math.max(e, k + 1);
  }
  // entrada de la línea de bajo (graves entre bombos a ≤ 6 dB de lo normal, 3 de 4 compases) tras el bombo
  let bassIn = -1;
  const bassOn = (k) => k >= 0 && k < n && F[k].bassOff >= -6 && F[k].kick >= 0.5;
  for (let k = Math.max(0, entry); entry >= 0 && k + 4 <= n; k++) if (bassOn(k) && [k, k + 1, k + 2, k + 3].filter(bassOn).length >= 3) { bassIn = k; break; }
  return { start: firstSound, entry, breaks, drops, outro, rises, bassIn };
}

// Puntuación v4: 1 Beat = entrada del bombo (o el primer sonido si suena desde el principio) · 2 Subidón y
// 3 Principal = alguna entrada a parte llena (subidón) de la referencia · 4 Salida = un subidón posterior o el outro.
// Los cues de versiones anteriores se traducen (Inicio/Entrada → Beat, Drop → Principal, Outro → Salida; Break no
// cuenta). Acierto: a ±1 compás. Falta: hay parte en la referencia y no hay cue.
const V4 = { start: 'beat', entry: 'beat', drop: 'main', outro: 'exit', beat: 'beat', rise: 'rise', main: 'main', exit: 'exit' };
function score(cues, ref, b0, track) {
  const barOf = (t) => (Grid.beatAt(track, t) - b0) / 4;
  const out = { ok: 0, bad: 0, miss: 0, detail: [] };
  const c4 = {};
  for (const c of cues) { const k = V4[c.type]; if (k && !(k === 'beat' && c4.beat && c.type === 'start')) c4[k] = c; }
  const rises = ref.rises.length ? ref.rises : ref.drops;
  const mainBar = c4.main ? barOf(c4.main.t) : -1;
  const want = {
    // Beat: el bombo con el bajo (si el bajo entra ≤ 12 compases después del bombo) o el primer bombo
    beat: [ref.bassIn >= 0 && ref.bassIn - Math.max(0, ref.entry) <= 12 ? ref.bassIn : (ref.entry > ref.start + 2 ? ref.entry : Math.max(0, ref.start))],
    rise: [...rises, ...(ref.bassIn >= 0 ? [ref.bassIn] : [])],
    main: rises,
    exit: [...rises.filter(r => r > mainBar + 4), ...(ref.outro >= 0 ? [ref.outro] : [])]
  };
  for (const type of Object.keys(want)) {
    const c = c4[type];
    if (!c) { if (want[type].length && (type === 'main' || type === 'beat')) { out.miss++; out.detail.push(`${type}: falta (ref ${want[type].join('/')})`); } continue; }
    const b = barOf(c.t), d = want[type].length ? Math.min(...want[type].map(w => Math.abs(w - b))) : 99;
    if (d <= 1.01) { out.ok++; out.detail.push(`${type} ✓ ${b.toFixed(1)}`); }
    else { out.bad++; out.detail.push(`${type} ✗ ${b.toFixed(1)} (ref ${want[type].join('/') || '—'})`); }
  }
  return out;
}

const bar = (v, lo, hi, w = 10) => { const n = Math.max(0, Math.min(w, Math.round((v - lo) / (hi - lo) * w))); return '█'.repeat(n) + '·'.repeat(w - n); };
let ascii = '';
const results = [];
for (const p of TRACKS) {
  const file = path.join(BASE, p), title = path.basename(p).replace(/\.[^.]+$/, '');
  if (!fs.existsSync(file)) { console.log('⚠ no está:', title); continue; }
  const x = decodeMono(file, SR), duration = x.length / SR;
  const r = analyze(x, SR, {});
  if (!r.bpm) continue;
  const track = { bpm: r.bpm, firstBeat: r.firstBeat, grid: null, duration };
  if (r.grid && r.grid.length > 1) Object.assign(track, Grid.gridUpdate(r.grid, duration));
  const wave = { data: r.wave, rate: r.waveRate };
  const opts = { energy: NEW.waveEnergy(wave), onset: NEW.waveOnset(wave), wave };
  const now = NEW.autoCuePoints(track, opts);
  const before = OLD ? OLD.autoCuePoints(track, { energy: OLD.waveEnergy(wave), onset: OLD.waveOnset(wave), wave }) : [];
  // compás 0 = el primer downbeat con música (el mismo cálculo que el Inicio de antes / el Beat de ahora)
  const b0 = NEW.startBeat(track, opts.onset);
  const nBars = Math.floor((Grid.beatAt(track, duration) - b0) / 4);
  const F = barFeatures(x, track, b0, nBars);
  const ref = reference(F);
  // nombre@compás (% de la duración)
  const lbl = (q) => `${q.name}@${((Grid.beatAt(track, q.t) - b0) / 4).toFixed(0)} (${Math.round(100 * q.t / duration)} %)`;
  const sb = OLD ? score(before, ref, b0, track) : null, sn = score(now, ref, b0, track);
  results.push({ title, bpm: r.bpm, ref, antes: sb, ahora: sn, cAntes: before.map(lbl), cAhora: now.map(lbl), pct: now.map(q => Math.round(100 * q.t / duration)), cola: now.map(q => +(duration - q.t).toFixed(1)) });
  console.log(`\n${title} · ${r.bpm} BPM · ${nBars} compases`);
  console.log(`  referencia: inicio ${ref.start} · entrada ${ref.entry} · breaks ${ref.breaks.join(',') || '—'} · drops ${ref.drops.join(',') || '—'} · subidones ${ref.rises.join(',') || '—'} · entra el bajo ${ref.bassIn} · outro ${ref.outro >= 0 ? ref.outro : '—'}`);
  if (sb) console.log(`  antes: ${results.at(-1).cAntes.join(' · ')}  → ${sb.ok} bien, ${sb.bad} mal, ${sb.miss} faltan · ${sb.detail.join(' | ')}`);
  console.log(`  ahora: ${results.at(-1).cAhora.join(' · ')}  → ${sn.ok} bien, ${sn.bad} mal, ${sn.miss} faltan · ${sn.detail.join(' | ')}`);
  const mark = (list, k) => list.filter(q => Math.round((Grid.beatAt(track, q.t) - b0) / 4) === k).map(q => q.name[0] + q.name[1]).join(',');
  ascii += `\n== ${title} (${r.bpm} BPM) ==\n compás ref bombo  bajos(dB)       energía(dB)      app:bombo bajos est  antes  ahora  ref\n`;
  const A = NEW.barFeatures ? NEW.barFeatures(track, wave, b0, nBars) : [];
  for (const f of F) {
    const a = A[f.k];
    const refm = [f.k === ref.entry ? 'EN' : '', ref.breaks.includes(f.k) ? 'BR' : '', ref.drops.includes(f.k) ? 'DR' : '', f.k === ref.outro ? 'OU' : ''].filter(Boolean).join(',');
    const stt = f.kick >= 0.5 && f.bass >= -3 ? 'L' : (f.bass <= -7 || (f.kick < 0.75 && f.en <= -3)) ? 'b' : '·';
    ascii += ` ${String(f.k).padStart(4)} ${stt} ${bar(f.kick, 0, 1, 4)}  ${bar(f.bass, -30, 0)} ${f.bass.toFixed(0).padStart(3)}  ${bar(f.en, -24, 0)} ${f.en.toFixed(0).padStart(3)}  ${a ? `${bar(a.kick, 0, 1, 4)} ${a.bass.toFixed(0).padStart(3)} ${a.en.toFixed(0).padStart(3)} ${a.state}` : ''}  ${mark(before, f.k).padEnd(5)}  ${mark(now, f.k).padEnd(5)}  ${refm}\n`;
  }
}
const sum = (k, f) => results.reduce((s, r) => s + (r[k] ? r[k][f] : 0), 0);
console.log(`\nTotal (${results.length} temas):`);
if (OLD) console.log(`  antes: ${sum('antes', 'ok')} bien · ${sum('antes', 'bad')} mal · ${sum('antes', 'miss')} faltan (acierto ${(100 * sum('antes', 'ok') / Math.max(1, sum('antes', 'ok') + sum('antes', 'bad'))).toFixed(0)} % de los puestos)`);
console.log(`  ahora: ${sum('ahora', 'ok')} bien · ${sum('ahora', 'bad')} mal · ${sum('ahora', 'miss')} faltan (acierto ${(100 * sum('ahora', 'ok') / Math.max(1, sum('ahora', 'ok') + sum('ahora', 'bad'))).toFixed(0)} % de los puestos)`);
if (arg('--ascii')) fs.writeFileSync(arg('--ascii'), ascii);
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(results, null, 1));
