// Pruebas de la «Siguiente pista (IA)» (src/js/ai/suggest-core.js) con una biblioteca sintética.
// Informe de un tester: «estaba pinchando house y me sugiere pop; es imposible de mezclar».
// node tools/test-sugerencias-ia.mjs
import { rankSuggestions, transitionScore, genreRelation, genreFamilies, normGenre, bpmInRange } from '../src/js/ai/suggest-core.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

// Generador determinista
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const KEYS = Array.from({ length: 12 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat();
let n = 0;
const track = (genre, bpm, camelot = pick(KEYS), energy = 1 + Math.floor(rnd() * 10)) => ({ id: 't' + (n++), title: `${genre} ${bpm}`, genre, bpm, camelot, energy, source: 'local' });

console.log('Géneros: normalización y familias');
ok(normGenre('Deep-House') === 'deep house' && normGenre('House Music') === 'house' && normGenre('  TECH  HOUSE ') === 'tech house', '«Deep-House», «House Music», «TECH HOUSE»');
ok(normGenre('Électro') === 'electro' && normGenre('Hip-Hop') === 'hip hop' && normGenre('Drum & Bass') === 'drum and bass' && normGenre('R&B') === 'rnb', 'acentos, Hip-Hop, Drum & Bass, R&B');
ok(genreFamilies('Tech House').includes('house') && genreFamilies('Tech House').includes('techno'), 'tech house es house y techno');
ok(genreFamilies('Dance Pop').includes('pop') && genreFamilies('Dance Pop').includes('dance'), 'dance pop es pop y dance');
ok(genreRelation('House', 'house music').same, 'House = House Music');
ok(genreRelation('House', 'Deep-House').score >= 0.85 && genreRelation('Deep House', 'Tech House').score >= 0.85, 'house ↔ deep house ↔ tech house');
ok(genreRelation('Techno', 'Tech House').score >= 0.85, 'techno ↔ tech house');
ok(genreRelation('Pop', 'Dance Pop').score >= 0.85, 'pop ↔ dance pop');
ok(genreRelation('House', 'Pop').score < 0.3 && genreRelation('Techno', 'Reggaeton').score < 0.3, 'house ↔ pop y techno ↔ reggaeton: incompatibles');
ok(genreRelation('House; Funky House', 'Nu Disco').score >= 0.5, 'varios géneros en una etiqueta («House; Funky House»)');
ok(genreRelation('', 'Pop').known === false, 'sin género: neutro');

console.log('BPM: rango de mezcla');
ok(bpmInRange(126, 126) && bpmInRange(126, 132) && !bpmInRange(126, 134.5), '±6 %: 132 sí, 134,5 no');
ok(bpmInRange(126, 63) && bpmInRange(126, 250) && !bpmInRange(126, 100), 'el doble y la mitad sí; 100 no');

console.log('Biblioteca sintética: house a 126 BPM sonando');
const lib = [];
for (let i = 0; i < 40; i++) lib.push(track('Pop', 100));                       // la queja: pop a 100 BPM
for (let i = 0; i < 20; i++) lib.push(track('Pop', 124 + Math.floor(rnd() * 4)));  // pop con BPM compatible
for (let i = 0; i < 20; i++) lib.push(track('Reggaeton', 95));
for (let i = 0; i < 15; i++) lib.push(track(pick(['House', 'house music', 'HOUSE']), 122 + Math.floor(rnd() * 9)));
for (let i = 0; i < 15; i++) lib.push(track(pick(['Tech House', 'Tech-House']), 123 + Math.floor(rnd() * 7)));
for (let i = 0; i < 10; i++) lib.push(track('Deep House', 120 + Math.floor(rnd() * 6)));
for (let i = 0; i < 10; i++) lib.push(track('House', 140 + Math.floor(rnd() * 10)));   // house fuera de rango
for (let i = 0; i < 30; i++) lib.push({ id: 'u' + i, title: 'sin analizar', genre: 'House', source: 'local' });  // sin BPM ni tonalidad
for (let i = 0; i < 10; i++) lib.push({ ...track('House', 126), camelot: '' });  // BPM sin tonalidad
const playing = { id: 'now', title: 'Ahora', genre: 'House', bpm: 126, camelot: '8A', energy: 6, source: 'local' };
const top = rankSuggestions(playing, lib, { refBpm: 126, refKey: '8A', limit: 60 });
const top10 = top.slice(0, 10);
ok(top10.length === 10, 'hay 10 sugerencias');
ok(!top10.some(s => /pop/i.test(s.track.genre) && Math.abs(s.track.bpm - 100) < 1), 'ninguna pop a 100 BPM en el top 10');
ok(!top.some(s => s.track.bpm === 100 || s.track.bpm === 95), 'ni en toda la lista: fuera de rango de BPM se descarta');
ok(!top10.some(s => /pop|reggaeton/i.test(s.track.genre)), 'tampoco pop ni reggaeton a BPM compatible en el top 10');
ok(top10.every(s => /house/i.test(s.track.genre) && bpmInRange(126, s.track.bpm)), 'el top 10 es house / tech house / deep house dentro del BPM');
ok(top10.some(s => /tech/i.test(s.track.genre)) && top10.some(s => /^house/i.test(normGenre(s.track.genre))), 'salen house y tech house');
ok(!top.some(s => s.track.bpm >= 140), 'house a 140+ BPM: fuera');
ok(top10.every(s => s.track.camelot), 'las analizadas (BPM + tonalidad) van delante');
const firstNoKey = top.findIndex(s => !s.track.camelot), lastKey = top.map(s => !!s.track.camelot).lastIndexOf(true);
ok(firstNoKey === -1 || firstNoKey > lastKey, 'las de BPM sin tonalidad, detrás de todas las analizadas');
ok(!top.some(s => !s.track.bpm) || top.findIndex(s => !s.track.bpm) > top.map(s => !!s.track.bpm).lastIndexOf(true), 'las sin BPM, al final del todo');
const popLate = rankSuggestions(playing, lib, { refBpm: 126, refKey: '8A', limit: 500 });
const iPop = popLate.findIndex(s => /pop/i.test(s.track.genre)), iHouse = popLate.map(s => /house/i.test(s.track.genre) && s.track.camelot && s.track.bpm).lastIndexOf(true);
ok(iPop === -1 || iPop > iHouse, 'el pop a BPM compatible queda detrás de todo el house analizado');

console.log('Explicación');
const s0 = top[0];
ok(/^mismo género|género afín/.test(s0.why) && /\d+ BPM/.test(s0.why) && /8A→\d+[AB]/.test(s0.why), `explicación corta: «${s0.why}»`);
const ex = transitionScore(playing, { genre: 'House', bpm: 126, camelot: '9A', energy: 6 }, { refBpm: 126, refKey: '8A' });
ok(ex.why === 'mismo género · 126 BPM · 8A→9A', `«${ex.why}»`);
ok(transitionScore(playing, { genre: 'Tech House', bpm: 127, camelot: '8A' }, { refBpm: 126, refKey: '8A' }).why.startsWith('género afín: Tech House'), 'tech house: «género afín»');

console.log('Pista que suena sin género o sin BPM');
const noGenre = rankSuggestions({ ...playing, genre: '' }, lib, { refBpm: 126, refKey: '8A', limit: 10 });
ok(noGenre.length === 10 && noGenre.every(s => bpmInRange(126, s.track.bpm)), 'sin género: manda el BPM');
const noBpm = rankSuggestions({ ...playing, bpm: 0 }, lib, { refBpm: 0, refKey: '8A', limit: 10 });
ok(noBpm.length === 10, 'sin BPM de referencia: se sugiere igualmente');

console.log('Rendimiento: 28.000 pistas');
const big = [];
const GEN = ['House', 'Tech House', 'Deep House', 'Techno', 'Pop', 'Dance Pop', 'Reggaeton', 'Hip-Hop', 'Rock', 'Drum & Bass', 'Trance', 'Nu Disco', '', 'Latin', 'Funk'];
for (let i = 0; i < 28000; i++) {
  const analyzed = rnd() > 0.35;
  big.push(analyzed ? track(pick(GEN), 70 + Math.floor(rnd() * 110)) : { id: 'x' + i, title: 'x', genre: pick(GEN), source: 'local' });
}
rankSuggestions(playing, big, { refBpm: 126, refKey: '8A', limit: 80 }); // calentar
const t0 = performance.now();
let res;
for (let i = 0; i < 5; i++) res = rankSuggestions(playing, big, { refBpm: 126, refKey: '8A', limit: 80, exclude: new Set(['t1', 't2']) });
const ms = (performance.now() - t0) / 5;
ok(ms < 60, `sugerir con 28.000 pistas: ${ms.toFixed(1)} ms (< 60 ms)`);
ok(res.length === 80 && res.slice(0, 10).every(s => /house|techno/i.test(s.track.genre)), 'y el top 10 sigue siendo house / techno');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
