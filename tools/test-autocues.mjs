// Cues automáticos (versión 4, fran6: 1 Beat · 2 Subidón · 3 Principal · 4 Salida) con temas sintéticos y el análisis
// real (analysis-core.js: BPM, beatgrid y forma de onda) más ai/autocues-core.js. Tema principal de 128 BPM: 2 s de
// silencio, 8 compases sin bombo, 24 con bombo, subidón de 32 (bajo y acordes), break de 16 (solo pad), subidón
// principal de 32 (más fuerte) y salida de 16. Los cues tienen que caer ahí (±1 beat), en el downbeat, cuadrados a
// frase, con 8+ compases entre ellos y nunca en los últimos 25 s. También: tres subidones, sin break, tema plano,
// tema corto, los cues del usuario (y los movidos) no se tocan y los nombres de antes se reconocen.
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
const COLORS = { beat: '#0f0', rise: '#a0f', main: '#f00', exit: '#fa0' };
function cuesFor(x) {
  const r = analyze(x, SR, { minBpm: 85, maxBpm: 175 });
  const track = { bpm: r.bpm, firstBeat: r.firstBeat, grid: null, duration: x.length / SR, energyCurve: r.energyCurve };
  const wave = { data: r.wave, rate: r.waveRate };
  // con la forma de onda (lo normal): por compases (bombo, bajos y energía)
  return { r, track, wave, pts: AC.autoCuePoints(track, { energy: AC.waveEnergy(wave), onset: AC.waveOnset(wave), wave }) };
}
const tag = (ps) => ps.map(p => `${p.type}:${p.bar}`);

// ---------------------------------------------------------------- tema principal
const INTRO0 = { hat: 1, pad: 0.6 }, INTRO = { kick: 1, hat: 1 }, DROP = { kick: 1, hat: 1, bass: 1, lead: 1 }, DROP2 = { kick: 1, hat: 1, bass: 1.15, lead: 1.25 };
const x = song([[8, INTRO0], [24, INTRO], [32, DROP], [16, { pad: 1 }], [32, DROP2], [16, INTRO]]);
const { r, track, pts } = cuesFor(x);
check('BPM detectado (128)', Math.abs(r.bpm - BPM) < 0.1, { bpm: r.bpm });
// 1 Beat = entra el bombo · 2 Subidón = primera parte llena · 3 Principal = vuelta tras el break · 4 Salida = se vacía
const want = { beat: 8, rise: 32, main: 80, exit: 112 }; // compás de cada cue
const at = (bar) => LEAD + bar * BAR;
console.log('  Cues:', pts.map(p => `${p.name} ${p.t.toFixed(2)} s (compás ${p.bar})`).join(' · '));
check('4 cues como mucho (versión 4)', AC.AUTO_CUE_VERSION === 4 && pts.length <= 4 && pts.length >= 3, { n: pts.length, v: AC.AUTO_CUE_VERSION });
for (const [type, bar] of Object.entries(want)) {
  const p = pts.find(q => q.type === type);
  check(`${AC.AUTO_CUE_NAMES[type]} en el compás ${bar} (${at(bar).toFixed(2)} s, ±1 beat)`, p && Math.abs(p.t - at(bar)) <= BEAT, p ? { t: +p.t.toFixed(3), err_beats: +((p.t - at(bar)) / BEAT).toFixed(2) } : 'no detectado');
}
check('Nombres: «1 Beat», «2 Subidón», «3 Principal», «4 Salida» (sin «Inicio» ni «Outro»)', pts.map(p => p.name).join('|') === '1 Beat|2 Subidón|3 Principal|4 Salida', pts.map(p => p.name));
check('Siempre en el primer beat del compás (a ±0,1 beat de un downbeat)', pts.every(p => Math.abs((p.t - LEAD) / BAR - Math.round((p.t - LEAD) / BAR)) < 0.025), pts.map(p => ((p.t - LEAD) / BAR).toFixed(3)));
check('Cuadrados a frase: múltiplo de 2 compases (8 beats) desde el Principal', pts.every(p => (p.bar - 80) % 2 === 0), pts.map(p => p.bar));
const bars = pts.map(p => p.bar).sort((a, b) => a - b);
check('Al menos 8 compases entre un cue y otro', bars.every((b, i) => !i || b - bars[i - 1] >= 8), bars);
check('Ninguno en los últimos 25 s', pts.every(p => p.t <= track.duration - 25), pts.map(p => +(track.duration - p.t).toFixed(1)));
check('Orden de los pads: 1 Beat, 2 Subidón, 3 Principal, 4 Salida', pts.every((p, i) => !i || AC.AUTO_CUE_SLOTS.indexOf(p.type) > AC.AUTO_CUE_SLOTS.indexOf(pts[i - 1].type)), pts.map(p => p.type));
// con bombo desde el primer compás, el Beat es el primer compás
const p0 = cuesFor(song([[32, INTRO], [32, DROP], [16, { pad: 1 }], [32, DROP2], [16, INTRO]])).pts;
check('Con bombo desde el principio: Beat en el compás 0, Subidón 32, Principal 80, Salida 112', ['beat:0', 'rise:32', 'main:80', 'exit:112'].every(s => tag(p0).includes(s)), tag(p0));

// tres subidones (a ~15 %, ~35 % y ~70 %): el principal es el del medio (el más largo), Salida el último; el bajo
// entra 16 compases después del bombo → el Beat va ahí (el beat fuerte con el bajo)
const x3 = song([[16, INTRO], [16, DROP], [8, { pad: 1 }], [32, DROP2], [8, { pad: 1 }], [16, DROP], [24, INTRO]]);
const p3 = cuesFor(x3).pts;
console.log('  Tres subidones:', p3.map(p => `${p.name} compás ${p.bar}`).join(' · '));
check('Tres subidones: Beat 16 (bombo + bajo), Principal 40 (el largo, en la mitad) y Salida 80 (el último)', ['beat:16', 'main:40', 'exit:80'].every(s => tag(p3).includes(s)), tag(p3));
// cuatro partes llenas con breaks: Subidón el primero, Principal el más largo del medio, Salida el último
const x5 = song([[32, INTRO], [16, DROP], [8, { pad: 1 }], [32, DROP2], [8, { pad: 1 }], [16, DROP], [24, INTRO]]);
const p5 = cuesFor(x5).pts;
console.log('  Intro de mezcla larga + tres subidones:', p5.map(p => `${p.name} compás ${p.bar}`).join(' · '));
check('Intro de bombo larga (32) y tres subidones: Beat 0, Subidón 32, Principal 56, Salida 96', ['beat:0', 'rise:32', 'main:56', 'exit:96'].every(s => tag(p5).includes(s)), tag(p5));
// bombo solo 8 compases y entra el bajo: el Beat es la entrada del bajo
const x6 = song([[8, INTRO], [32, DROP], [16, { pad: 1 }], [32, DROP2], [24, INTRO]]);
const p6 = cuesFor(x6).pts;
check('Bombo solo 8 compases y luego el bajo: 1 Beat en el 8 (el beat fuerte con el bajo), Principal en el 56', tag(p6).includes('beat:8') && tag(p6).includes('main:56'), tag(p6));

// sin forma de onda: con la curva de energía por frases del análisis
const pc = AC.autoCuePoints(track, { energy: AC.curveEnergy(track), onset: 0 });
check('Sin forma de onda (curva por frases): 4 o menos, en compás, de los tipos nuevos', pc.length <= 4 && pc.every(p => p.bar % 4 === 0 && AC.AUTO_CUE_SLOTS.includes(p.type)), pc.map(p => `${p.name}@${p.bar}`));
const xo = song([[32, INTRO], [32, DROP], [16, { pad: 1 }], [32, DROP2], [16, INTRO]]), co = cuesFor(xo);
const po = AC.autoCuePoints(co.track, { energy: AC.waveEnergy(co.wave), onset: AC.waveOnset(co.wave) });
check('Sin forma de onda (método por energía): Beat 32, Principal 80, Salida 112', ['beat:32', 'main:80', 'exit:112'].every(s => tag(po).includes(s)), tag(po));

// ---------------------------------------------------------------- cambios que no caen en múltiplos de 8
const x4 = song([[20, INTRO0], [32, DROP], [16, { pad: 1 }], [32, DROP2], [16, INTRO]]);
const p4 = cuesFor(x4).pts;
console.log('  Intro de 20 compases:', p4.map(p => `${p.name} compás ${p.bar}`).join(' · '));
check('Intro de 20 compases sin bombo: Beat en el 20 y Principal en el 68', tag(p4).includes('beat:20') && tag(p4).includes('main:68'), tag(p4));

// ---------------------------------------------------------------- sin break: intro → parte llena → salida
const xn = song([[32, INTRO], [48, DROP], [16, INTRO]]);
const pn = cuesFor(xn).pts;
console.log('  Sin break:', pn.map(p => `${p.name} compás ${p.bar}`).join(' · '));
check('Sin break: Beat 0, la entrada del bajo (32) y Salida en el 80; nada inventado', tag(pn).includes('beat:0') && pn.some(p => p.bar === 32) && tag(pn).includes('exit:80') && pn.length <= 3, tag(pn));

// ---------------------------------------------------------------- tema plano: no hay partes claras
const flat = song([[96, DROP]]);
const f = cuesFor(flat);
check('Tema plano: solo el 1 Beat (no se inventan subidones)', f.pts.length === 1 && f.pts[0].type === 'beat', f.pts.map(p => p.name));
// tema corto con la salida pegada al final: no hay cues en los últimos 25 s
const xs = song([[16, INTRO], [16, DROP], [8, { pad: 1 }], [16, DROP2], [6, INTRO]]);
const ps = cuesFor(xs);
check('Tema corto: ningún cue en los últimos 25 s', ps.pts.every(p => p.t <= ps.track.duration - 25), ps.pts.map(p => `${p.name}@${(ps.track.duration - p.t).toFixed(1)} s del final`));

// ---------------------------------------------------------------- pads: usuario y automáticos antiguos
const user = { t: 10, color: '#fff', name: 'Mío' };
const old = Array(8).fill(null).map((_, i) => ({ t: 20 + i * 15, color: '#888', name: 'Viejo ' + i, auto: true }));
old[2] = user; old[6] = { t: at(80) + 0.5, color: '#fff', name: 'Mi drop' };
const m = AC.mergeAutoCues(old, pts, COLORS);
check('Los cues del usuario no se tocan', m.cues[2] === user && m.cues[6] === old[6], { pad3: m.cues[2], pad7: m.cues[6] });
check('Los automáticos antiguos se reemplazan', m.cues.filter(c => c && c.auto).every(c => c.autoV === AC.AUTO_CUE_VERSION), m.cues.map(c => c && c.name));
check('Un punto con un cue del usuario cerca no se duplica (el drop del usuario)', !m.cues.some(c => c && c.auto && c.name === '3 Principal'), m.cues.map(c => c && c.name));
check('El 1 Beat va al pad 1', m.cues[0] && m.cues[0].name === '1 Beat', m.cues[0]);
// un cue automático movido o renombrado por el DJ (ya sin `auto`) no se recalcula
const moved = Array(8).fill(null); moved[0] = { t: 33.3, color: '#0f0', name: '1 Beat', edited: true };
const mm = AC.mergeAutoCues(moved, pts, COLORS);
check('Un cue automático movido por el DJ (ya manual) se queda donde lo dejó', mm.cues[0] === moved[0] && mm.cues[0].t === 33.3, mm.cues[0]);
// los nombres de antes siguen reconociéndose (sugerencias, informes)
check('Nombres de antes reconocidos: Drop → Principal, Outro → Salida, Entrada/Inicio → Beat', AC.autoCueType({ name: 'Drop' }) === 'main' && AC.autoCueType({ name: 'Outro' }) === 'exit' && AC.autoCueType({ name: 'Entrada' }) === 'beat' && AC.autoCueType({ name: 'Inicio' }) === 'beat' && AC.autoCueType({ name: '3 Principal' }) === 'main', null);

console.log(failed ? `\n${failed}/${total} comprobaciones fallidas` : `\n${total}/${total} comprobaciones correctas`);
process.exitCode = failed ? 1 : 0;
