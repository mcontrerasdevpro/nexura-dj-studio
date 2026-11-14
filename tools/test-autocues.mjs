// Cues automáticos con temas sintéticos y el análisis real (analysis-core.js: BPM, beatgrid y forma de onda)
// más ai/autocues-core.js. Tema principal de 128 BPM: 2 s de silencio, intro de 32 compases (bombo y charles),
// drop de 32 (bajo y acordes), break de 16 (solo pad), segundo drop de 32 (más fuerte) y outro de 16 (bombo y
// charles). Los cues tienen que caer en esos sitios (±1 beat), ser 5 o menos, estar cuadrados a frase y con
// al menos 16 compases entre ellos. También: un tema plano (solo el Inicio), los cues del usuario no se tocan
// y los automáticos antiguos se reemplazan.
// Uso: node tools/test-autocues.mjs [--verbose]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const { analyze } = await import(pathToFileURL(path.join(root, 'src/js/analysis/analysis-core.js')));
const AC = await import(pathToFileURL(path.join(root, 'src/js/ai/autocues-core.js')));

const SR = 22050, BPM = 128, BEAT = 60 / BPM, BAR = BEAT * 4, LEAD = 2;
let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;

// partes: [compases, { kick, hat, bass, lead, pad }] (niveles 0..1)
function song(parts) {
  const bars = parts.reduce((s, p) => s + p[0], 0);
  const dur = LEAD + bars * BAR + 2, x = new Float32Array(Math.ceil(dur * SR));
  let bar0 = 0;
  for (const [n, p] of parts) {
    for (let b = bar0 * 4; b < (bar0 + n) * 4; b++) {
      const t = LEAD + b * BEAT, i0 = Math.round(t * SR), len = Math.round(BEAT * SR);
      for (let i = 0; i < len && i0 + i < x.length; i++) {
        const tt = i / SR;
        let v = 0;
        if (p.kick) v += p.kick * 0.7 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12);
        if (p.hat && tt >= BEAT / 2 && tt < BEAT / 2 + 0.04) v += p.hat * 0.2 * rnd() * Math.exp(-(tt - BEAT / 2) * 80);
        if (p.bass && tt > 0.08) v += p.bass * 0.35 * Math.sin(2 * Math.PI * 55 * (i0 + i) / SR);
        if (p.lead) v += p.lead * 0.12 * (Math.sin(2 * Math.PI * 440 * (i0 + i) / SR) + Math.sin(2 * Math.PI * 554 * (i0 + i) / SR) + 0.5 * Math.sin(2 * Math.PI * 3520 * (i0 + i) / SR));
        if (p.pad) v += p.pad * 0.1 * (Math.sin(2 * Math.PI * 220 * (i0 + i) / SR) + Math.sin(2 * Math.PI * 277 * (i0 + i) / SR));
        x[i0 + i] += v;
      }
    }
    bar0 += n;
  }
  return x;
}

let failed = 0, total = 0;
function check(name, ok, data) {
  total++; if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok || VERBOSE ? ' ' + JSON.stringify(data) : ''}`);
}
const COLORS = { start: '#0f0', entry: '#0f0', drop: '#f00', break: '#a0f', outro: '#fa0' };
function cuesFor(x) {
  const r = analyze(x, SR, { minBpm: 85, maxBpm: 175 });
  const track = { bpm: r.bpm, firstBeat: r.firstBeat, grid: null, duration: x.length / SR, energyCurve: r.energyCurve };
  const wave = { data: r.wave, rate: r.waveRate };
  return { r, track, wave, pts: AC.autoCuePoints(track, { energy: AC.waveEnergy(wave), onset: AC.waveOnset(wave) }) };
}

// ---------------------------------------------------------------- tema principal
const INTRO = { kick: 1, hat: 1 }, DROP = { kick: 1, hat: 1, bass: 1, lead: 1 }, DROP2 = { kick: 1, hat: 1, bass: 1.15, lead: 1.25 };
const x = song([[32, INTRO], [32, DROP], [16, { pad: 1 }], [32, DROP2], [16, INTRO]]);
const { r, track, wave, pts } = cuesFor(x);
check('BPM detectado (128)', Math.abs(r.bpm - BPM) < 0.1, { bpm: r.bpm });
const want = { start: 0, entry: 32, drop: 80, break: 64, outro: 112 }; // compás de cada parte
const at = (bar) => LEAD + bar * BAR;
console.log('  Cues:', pts.map(p => `${p.name} ${p.t.toFixed(2)} s (compás ${p.bar})`).join(' · '));
check('5 cues o menos', pts.length <= 5 && pts.length >= 3, { n: pts.length });
for (const [type, bar] of Object.entries(want)) {
  const p = pts.find(q => q.type === type);
  check(`${AC.AUTO_CUE_NAMES[type]} en el compás ${bar} (${at(bar).toFixed(2)} s, ±1 beat)`, p && Math.abs(p.t - at(bar)) <= BEAT, p ? { t: +p.t.toFixed(3), err_beats: +((p.t - at(bar)) / BEAT).toFixed(2) } : 'no detectado');
}
check('Inicio en el primer downbeat (no en 0 s con silencio delante)', pts[0] && pts[0].type === 'start' && pts[0].t > 1.5, pts[0]);
check('Cuadrados a frase: múltiplo de 4 compases desde el Inicio (8 salvo que no encaje)', pts.every(p => p.bar % 4 === 0), pts.map(p => p.bar));
const bars = pts.map(p => p.bar).sort((a, b) => a - b);
check('Al menos 16 compases entre un cue y otro', bars.every((b, i) => !i || b - bars[i - 1] >= 16), bars);
check('Orden de los pads: Inicio, Entrada, Drop, Break, Outro', pts.every((p, i) => !i || AC.AUTO_CUE_SLOTS.indexOf(p.type) > AC.AUTO_CUE_SLOTS.indexOf(pts[i - 1].type)), pts.map(p => p.type));

// sin forma de onda: con la curva de energía por frases del análisis
const pc = AC.autoCuePoints(track, { energy: AC.curveEnergy(track), onset: 0 });
check('Sin forma de onda (curva por frases): 5 o menos, sin cues sin sentido', pc.length <= 5 && pc.every(p => p.bar % 4 === 0), pc.map(p => `${p.name}@${p.bar}`));

// lo que hacía la versión anterior con el mismo tema: un hot cue por cada sección del análisis (hasta 8)
console.log('  Antes (secciones del análisis → hasta 8 cues):', r.sections.map(s => `${s.label} ${s.t.toFixed(2)} s`).join(' · '));

// ---------------------------------------------------------------- cambios que no caen en múltiplos de 8
// intro de 20 compases (frase de 4 tras el Inicio): la Entrada va al compás 20 (múltiplo de 4)
const x4 = song([[20, INTRO], [32, DROP], [16, { pad: 1 }], [32, DROP2], [16, INTRO]]);
const p4 = cuesFor(x4).pts, e4 = p4.find(p => p.type === 'entry'), d4 = p4.find(p => p.type === 'drop');
console.log('  Intro de 20 compases:', p4.map(p => `${p.name} compás ${p.bar}`).join(' · '));
check('Intro de 20 compases: Entrada en el compás 20 y Drop en el 68 (cuadrados a 4 compases)', e4 && e4.bar === 20 && d4 && d4.bar === 68, p4.map(p => `${p.name}@${p.bar}`));

// ---------------------------------------------------------------- sin break: intro → drop → outro
const xn = song([[32, INTRO], [48, DROP], [16, INTRO]]);
const pn = cuesFor(xn).pts;
console.log('  Sin break:', pn.map(p => `${p.name} compás ${p.bar}`).join(' · '));
check('Sin break: no se inventa un Break y el drop sale una sola vez', !pn.some(p => p.type === 'break') && pn.filter(p => p.bar === 32).length === 1 && pn.length <= 4, pn.map(p => `${p.name}@${p.bar}`));

// ---------------------------------------------------------------- tema plano: no hay partes claras
const flat = song([[96, DROP]]);
const f = cuesFor(flat);
check('Tema plano: solo el Inicio (no se inventan drops ni breaks)', f.pts.length === 1 && f.pts[0].type === 'start', f.pts.map(p => p.name));

// ---------------------------------------------------------------- pads: usuario y automáticos antiguos
const user = { t: 10, color: '#fff', name: 'Mío' };
const old = Array(8).fill(null).map((_, i) => ({ t: 20 + i * 15, color: '#888', name: 'Viejo ' + i, auto: true }));
old[2] = user; old[6] = { t: at(80) + 0.5, color: '#fff', name: 'Mi drop' };
const m = AC.mergeAutoCues(old, pts, COLORS);
check('Los cues del usuario no se tocan', m.cues[2] === user && m.cues[6] === old[6], { pad3: m.cues[2], pad7: m.cues[6] });
check('Los automáticos antiguos se reemplazan', m.cues.filter(c => c && c.auto).every(c => c.autoV === AC.AUTO_CUE_VERSION), m.cues.map(c => c && c.name));
check('Un punto con un cue del usuario cerca no se duplica (el Drop del usuario)', !m.cues.some(c => c && c.auto && c.name === 'Drop'), m.cues.map(c => c && c.name));
check('El Inicio va al pad 1', m.cues[0] && m.cues[0].name === 'Inicio', m.cues[0]);

console.log(failed ? `\n${failed}/${total} comprobaciones fallidas` : `\n${total}/${total} comprobaciones correctas`);
process.exitCode = failed ? 1 : 0;
