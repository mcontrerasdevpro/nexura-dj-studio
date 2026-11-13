// Pruebas en Node de «Limpiar biblioteca» con archivos reales generados con ffmpeg (MP3 320/128/96, FLAC, WAV,
// M4A, OGG, WMA, dañados), una papelera de Windows simulada y un MusicBrainz simulado (servidor HTTP local):
// lectura técnica (comparada con ffprobe), caché, huellas, duplicados y qué copia conservar, fusión de crates,
// cues e historial con deshacer, etiquetas (propuestas, escritura MP3/FLAC con el audio intacto y vuelta atrás),
// internet (con y sin red) y rendimiento con 40.000 entradas. Uso: node tools/test-limpieza.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { probeFile } = require(path.join(ROOT, 'main/audio-probe.js'));
const { scanEntries, createCache } = require(path.join(ROOT, 'main/cleanup-scan.js'));
const { writeTags, restoreTags, splitHead, audioHash } = require(path.join(ROOT, 'main/tag-writer.js'));
const recycle = require(path.join(ROOT, 'main/recycle.js'));
const { createMb } = require(path.join(ROOT, 'main/musicbrainz.js'));
const NodeID3 = require(path.join(ROOT, 'node_modules/node-id3'));
const Metaflac = require(path.join(ROOT, 'node_modules/metaflac-js'));

// entorno mínimo para library.js / cleanup-ui.js (platform.js usa window / localStorage)
const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const C = await import('../src/js/library/cleanup-core.js');
const { Library } = await import('../src/js/library/library.js');
const { compactUndo } = await import('../src/js/ui/cleanup-ui.js');

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('✓', name); } catch (e) { console.log('✗', name); throw e; } };
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const sha1File = (f) => sha1(fs.readFileSync(f));

// ------------------------------------------------------------------ archivos de prueba
// Sin ffmpeg (p. ej. en el CI de GitHub) se hacen solo las pruebas que no necesitan archivos de audio generados
const HAS_FF = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-limpieza-'));
if (!HAS_FF) {
  await testNombres(); await testPapelera(); await testSinRed(); await testRendimiento();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('⚠ ffmpeg/ffprobe no están en el PATH: se omiten las pruebas con archivos de audio reales (lectura, huellas, duplicados, escritura de etiquetas…)');
  console.log(`\n${n} pruebas de «Limpiar biblioteca» correctas (sin ffmpeg)`);
  process.exit(0);
}
const M = path.join(TMP, 'Música');
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const ffprobe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8' }));
const decodes = (f) => spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim();
const put = (rel) => { const p = path.join(M, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };
// audio: dos tonos (distintos por canción) + un poco de ruido para que el bitrate sea realista
function tone(rel, { f = 440, dur = 40, codec = ['-c:a', 'libmp3lame', '-b:a', '320k'], meta = {}, extra = [] } = {}) {
  const out = put(rel);
  const md = Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=44100:duration=${dur}`, '-f', 'lavfi', '-i', `anoisesrc=d=${dur}:c=pink:a=0.05:r=44100`,
    '-filter_complex', `[0:a][1:a]amix=inputs=2,aformat=channel_layouts=stereo`, ...codec, ...md, ...extra, out]);
  return out;
}
const mp3 = (kbps) => ['-c:a', 'libmp3lame', '-b:a', kbps + 'k'];
const FX = {};
// Canción A: 320 kbps + copia exacta (otra carpeta) + mismo audio con otras etiquetas
FX.a320 = tone('House/Daft Punk - One More Time.mp3', { f: 440, meta: { artist: 'Daft Punk', title: 'One More Time', date: '2000', genre: 'House' }, extra: ['-id3v2_version', '3'] });
FX.aCopy = put('Descargas/Daft Punk - One More Time.mp3'); fs.copyFileSync(FX.a320, FX.aCopy);
FX.aRetag = put('Varios/Pista 01.mp3'); fs.copyFileSync(FX.a320, FX.aRetag); NodeID3.write({ title: 'Pista 01', artist: '' }, FX.aRetag);
// Canción B: 320 y 128 kbps (misma canción en otra calidad)
FX.b320 = tone('Pop/Artista B - Tema B.mp3', { f: 523, meta: { artist: 'Artista B', title: 'Tema B' } });
FX.b128 = tone('Descargas/Artista B - Tema B.mp3', { f: 523, codec: mp3(128), meta: { artist: 'Artista B', title: 'Tema B (Official Video)' } });
// Canción C: FLAC y MP3
FX.cFlac = tone('Lossless/Artista C - Tema C.flac', { f: 330, codec: ['-c:a', 'flac'], meta: { ARTIST: 'Artista C', TITLE: 'Tema C', DATE: '2010', GENRE: 'Techno' } });
FX.cMp3 = tone('Techno/Artista C - Tema C.mp3', { f: 330, meta: { artist: 'Artista C', title: 'Tema C' } });
// Canción D: original, extended y remix (versiones, no duplicados)
FX.dOrig = tone('Dance/Artista D - Tema D.mp3', { f: 600, dur: 40, meta: { artist: 'Artista D', title: 'Tema D' } });
FX.dExt = tone('Dance/Artista D - Tema D (Extended Mix).mp3', { f: 600, dur: 60, meta: { artist: 'Artista D', title: 'Tema D (Extended Mix)' } });
FX.dRmx = tone('Dance/Artista D - Tema D (Otro Remix).mp3', { f: 700, dur: 45, meta: { artist: 'Artista D', title: 'Tema D (Otro Remix)' } });
// Etiquetas: basura de YouTube, MAYÚSCULAS, guiones bajos, sin etiquetas en una carpeta de álbum, no coincide
FX.yt = tone('YouTube/Artista Z - Cancion Z (Official Video).mp3', { f: 250, meta: { artist: 'ArtistaZVEVO', title: 'Cancion Z (Official Video) [HD]' } });
FX.caps = tone('Latino/BAILANDO EN LA PLAYA.mp3', { f: 270, meta: { artist: 'LOS DEL MAR', title: 'BAILANDO EN LA PLAYA' } });
FX.under = tone('Otros/03_Alguien_-_Algo_Bonito.mp3', { f: 290, extra: ['-id3v2_version', '0', '-write_xing', '1'] });
FX.album = tone('Artista Y/Grandes Exitos (1999)/Pista 07.flac', { f: 310, codec: ['-c:a', 'flac'] });
FX.mismatch = tone('Rock/Adriano Celentano - Buonasera dottore.mp3', { f: 350, meta: { artist: 'Eminem', title: 'Lose Yourself' } });
// Calidad: 96 kbps, WMA, WAV, M4A, OGG, corta, dañados
FX.low = tone('Viejas/Artista E - Tema E.mp3', { f: 380, codec: mp3(96), meta: { artist: 'Artista E', title: 'Tema E' } });
FX.wma = tone('Viejas/Artista F - Tema F.wma', { f: 390, codec: ['-c:a', 'wmav2', '-b:a', '128k'], meta: { artist: 'Artista F', title: 'Tema F' } });
FX.wav = tone('Wav/Artista G - Tema G.wav', { f: 410, dur: 35, codec: ['-c:a', 'pcm_s16le'] });
FX.m4a = tone('M4a/Artista H - Tema H.m4a', { f: 420, codec: ['-c:a', 'aac', '-b:a', '256k'], meta: { artist: 'Artista H', title: 'Tema H' } });
FX.ogg = tone('Ogg/Artista I - Tema I.ogg', { f: 430, codec: ['-c:a', 'libvorbis', '-q:a', '5'], meta: { ARTIST: 'Artista I', TITLE: 'Tema I' } });
FX.short = tone('Samples/Golpe.mp3', { f: 900, dur: 4 });
FX.cut = put('Rotos/Artista J - Cortado.mp3'); { const b = fs.readFileSync(tone('Rotos/tmp.mp3', { f: 450, meta: { artist: 'Artista J', title: 'Cortado' } })); fs.writeFileSync(FX.cut, b.subarray(0, Math.floor(b.length * 0.4))); fs.unlinkSync(path.join(M, 'Rotos/tmp.mp3')); }
FX.junk = put('Rotos/basura.mp3'); fs.writeFileSync(FX.junk, crypto.randomBytes(300 * 1024).map(v => (v === 0xff ? 0 : v)));
FX.gone = path.join(M, 'Perdidos', 'No existe.mp3');
console.log('Archivos de prueba en', M);

// ------------------------------------------------------------------ 1. lectura técnica
await test('Lectura técnica: duración, bitrate, frecuencia y formato coinciden con ffprobe', async () => {
  for (const k of ['a320', 'b128', 'cFlac', 'low', 'wav', 'm4a', 'ogg', 'wma', 'dExt']) {
    const r = await probeFile(FX[k]), p = ffprobe(FX[k]);
    const dur = parseFloat(p.format.duration), sr = +p.streams[0].sample_rate;
    assert.ok(!r.damaged, `${k} no está dañado (${r.damaged})`);
    if (k !== 'wma') {
      assert.ok(Math.abs(r.dur - dur) < 0.2, `${k}: duración ${r.dur} ≈ ${dur}`);
      assert.equal(r.sr, sr, `${k}: frecuencia`);
    }
    if (k === 'a320') assert.equal(Math.round(r.br), 320);
    if (k === 'b128') assert.equal(Math.round(r.br), 128);
    if (k === 'low') assert.equal(Math.round(r.br), 96);
    if (k === 'm4a' || k === 'cFlac' || k === 'wav') { const pb = (+p.streams[0].bit_rate || +p.format.bit_rate) / 1000; assert.ok(Math.abs(r.br - pb) / pb < 0.1, `${k}: ${r.br} kbps ≈ ${pb} (ffprobe)`); }
  }
  const f = await probeFile(FX.cFlac);
  assert.equal(f.fmt, 'flac'); assert.ok(f.lossless); assert.equal(f.bits, +ffprobe(FX.cFlac).streams[0].bits_per_raw_sample);
  assert.equal((await probeFile(FX.wma)).fmt, 'wma');
  assert.equal((await probeFile(FX.wav)).fmt, 'wav');
});
await test('Etiquetas del archivo: ID3v2.3/2.4, Vorbis (FLAC/OGG), MP4; carátula', async () => {
  const a = await probeFile(FX.a320);
  assert.deepEqual([a.tags.artist, a.tags.title, a.tags.year, a.tags.genre], ['Daft Punk', 'One More Time', '2000', 'House']);
  assert.equal(a.tags.cover, false);
  assert.equal(a.tagKind, 'ID3v2.3');
  const b = await probeFile(FX.b320);
  assert.equal(b.tagKind, 'ID3v2.4');
  assert.equal(b.tags.title, 'Tema B');
  const c = await probeFile(FX.cFlac);
  assert.deepEqual([c.tags.artist, c.tags.title, c.tags.year, c.tags.genre], ['Artista C', 'Tema C', '2010', 'Techno']);
  assert.equal((await probeFile(FX.m4a)).tags.title, 'Tema H');
  assert.equal((await probeFile(FX.ogg)).tags.artist, 'Artista I');
  const u = await probeFile(FX.under);
  assert.ok(!u.tags || !u.tags.title, 'sin etiquetas');
});
await test('Dañados: archivo cortado, basura y archivo que no existe', async () => {
  assert.match((await probeFile(FX.cut)).damaged || '', /incompleto/);
  assert.ok((await probeFile(FX.junk)).damaged);
  assert.equal((await probeFile(FX.gone)).missing, true);
});

// ------------------------------------------------------------------ 2. análisis con caché y huellas
const lib = new Library();
const paths = Object.values(FX);
const tracks = lib.addFiles(paths.map(p => ({ path: p, size: fs.existsSync(p) ? fs.statSync(p).size : 0, title: '', artist: '' })));
// los datos de Nexura salen de las etiquetas (como al añadir los archivos)
for (const t of tracks) { const r = await probeFile(t.path); if (r.tags) Object.assign(t, { artist: r.tags.artist || '', title: r.tags.title || path.basename(t.path).replace(/\.[^.]+$/, ''), year: r.tags.year || '', genre: r.tags.genre || '' }); else t.title = path.basename(t.path).replace(/\.[^.]+$/, ''); t.duration = r.dur || 0; }
const T = Object.fromEntries(Object.entries(FX).map(([k, p]) => [k, lib.byPath(p)]));
const cacheFile = path.join(TMP, 'archivos.ndjson');
let scan1;
await test('Análisis: lee todo la primera vez, huellas solo de lo que hace falta; la segunda vez todo sale de la caché', async () => {
  const entries = tracks.map(t => ({ id: t.id, path: t.path }));
  const ev = [];
  scan1 = await scanEntries(entries, { cache: createCache(cacheFile), onProgress: (e) => ev.push(e) });
  assert.equal(scan1.stats.probed, paths.length - 1);
  assert.equal(scan1.stats.missing, 1);
  assert.ok(ev.some(e => e.phase === 'leer') && ev.some(e => e.phase === 'huella'), 'progreso por fases');
  const rec = (k) => scan1.records.find(r => r.id === T[k].id);
  assert.ok(rec('a320').full && rec('a320').full === rec('aCopy').full && rec('aCopy').full === rec('aRetag').full, 'copia exacta y re-etiquetada: misma huella de audio');
  assert.notEqual(rec('a320').size, rec('aRetag').size, '(el archivo re-etiquetado mide distinto)');
  assert.ok(!rec('b128').part, 'el 128 kbps no comparte tamaño de audio con nadie: sin huella');
  const t0 = Date.now();
  const scan2 = await scanEntries(entries, { cache: createCache(cacheFile) });
  assert.equal(scan2.stats.probed, 0); assert.equal(scan2.stats.cached, paths.length - 1); assert.equal(scan2.stats.partial + scan2.stats.full, 0);
  assert.ok(Date.now() - t0 < 1000, 'segunda vez casi instantánea: ' + (Date.now() - t0) + ' ms');
  assert.equal(scan2.records.find(r => r.id === T.a320.id).full, rec('a320').full);
});
await test('Cancelar y reanudar: lo hecho queda en la caché', async () => {
  const cf = path.join(TMP, 'cancel.ndjson');
  const entries = tracks.map(t => ({ id: t.id, path: t.path }));
  let k = 0;
  const r1 = await scanEntries(entries, { cache: createCache(cf), concurrency: 1, cancelled: () => ++k > 6 });
  assert.equal(r1.cancelled, true);
  const r2 = await scanEntries(entries, { cache: createCache(cf) });
  assert.equal(r2.cancelled, false);
  assert.ok(r2.stats.cached >= 4 && r2.stats.probed < paths.length - 1, `reanuda: ${r2.stats.cached} de la caché, ${r2.stats.probed} leídos`);
});

// ------------------------------------------------------------------ 3. duplicados
let dups;
const items = () => [...lib.tracks.values()].map(t => ({ track: t, rec: scan1.records.find(r => r.id === t.id) }));
await test('Duplicados: exactos (también con otras etiquetas), misma canción en otra calidad y versiones aparte', async () => {
  dups = C.findDuplicates(items(), {});
  const ids = (g) => g.members.map(m => m.id).sort().join();
  const exact = dups.groups.filter(g => g.kind === 'exact'), same = dups.groups.filter(g => g.kind === 'same');
  assert.equal(exact.length, 1); assert.equal(ids(exact[0]), [T.a320.id, T.aCopy.id, T.aRetag.id].sort().join());
  assert.equal(same.length, 2, 'B (320/128) y C (FLAC/MP3): ' + same.map(g => g.title).join(' | '));
  const gb = same.find(g => g.members.some(m => m.id === T.b128.id)), gc = same.find(g => g.members.some(m => m.id === T.cFlac.id));
  assert.equal(ids(gb), [T.b320.id, T.b128.id].sort().join());
  assert.equal(gb.keep, T.b320.id, 'B: se conserva la de 320 kbps');
  assert.match(gb.why, /Mejor calidad/);
  assert.equal(gc.keep, T.cFlac.id, 'C: se conserva el FLAC');
  assert.ok(!dups.groups.some(g => g.members.some(m => [T.dOrig.id, T.dExt.id, T.dRmx.id].includes(m.id))), 'D: las versiones no son duplicados');
  const v = dups.versions.find(x => x.members.some(m => m.id === T.dExt.id));
  assert.ok(v && v.members.length === 3, 'D: grupo de versiones con original, extended y remix');
  assert.deepEqual(v.members.map(m => m.label).sort(), ['Extended Mix', 'Original', 'Otro Remix']);
});
await test('Qué conservar: calidad → datos en Nexura → ruta más ordenada', async () => {
  const g = dups.groups.find(x => x.kind === 'exact');
  assert.equal(g.keep, T.a320.id, 'sin datos: la de la carpeta «House» (no «Descargas» ni «Varios/Pista 01»)');
  T.aCopy.cues[0] = { t: 12, color: '#ff0000', name: 'Drop' };
  const g2 = C.findDuplicates(items(), { crateCount: (id) => (id === T.aCopy.id ? 1 : 0) }).groups.find(x => x.kind === 'exact');
  assert.equal(g2.keep, T.aCopy.id, 'con cues y crate, gana la copia de Descargas');
  assert.match(g2.why, /datos en Nexura/);
  T.aCopy.cues[0] = null;
});

// ------------------------------------------------------------------ 4. resolver: fusión y deshacer
await test('Resolver: crates, Prepare, historial, reproducciones, valoración y cues pasan a la conservada; deshacer lo deja igual', async () => {
  const dance = lib.createCrate('Dance'), fav = lib.createCrate('Favoritas');
  lib.addToCrate(dance.id, [T.dOrig.id, T.aCopy.id, T.dExt.id]);
  lib.addToCrate(fav.id, [T.a320.id, T.aRetag.id]);
  lib.addToPrepare([T.aRetag.id, T.b320.id]);
  T.aCopy.cues[2] = { t: 33, color: '#00ff00', name: 'Voz' }; T.aCopy.loops[0] = { t: 10, le: 14 };
  T.aCopy.plays = 3; T.aRetag.plays = 2; T.a320.plays = 1; T.aRetag.rating = 4;
  lib.logPlay(T.aCopy, 0); lib.logPlay(T.b128, 1);
  const before = JSON.stringify({ tracks: [...lib.tracks.values()], crates: lib.crates, prepare: lib.prepare, history: lib.history, order: [...lib.tracks.keys()] });
  const undo = lib.mergeDuplicates([{ keep: T.a320.id, drop: [T.aCopy.id, T.aRetag.id] }, { keep: T.b320.id, drop: [T.b128.id] }]);
  assert.ok(undo);
  assert.ok(!lib.get(T.aCopy.id) && !lib.get(T.aRetag.id) && !lib.get(T.b128.id), 'las otras copias ya no están');
  assert.deepEqual(lib.crate(dance.id).ids, [T.dOrig.id, T.a320.id, T.dExt.id], 'en «Dance», la conservada ocupa el sitio de la copia');
  assert.deepEqual(lib.crate(fav.id).ids, [T.a320.id], 'en «Favoritas» no se repite');
  assert.deepEqual(lib.prepare, [T.a320.id, T.b320.id]);
  assert.equal(T.a320.plays, 1 + 3 + 2 + 1, 'reproducciones sumadas (la de logPlay incluida)');
  assert.equal(T.a320.rating, 4);
  assert.equal(T.a320.cues[2].name, 'Voz', 'hot cues de la copia (la conservada no tenía)');
  assert.equal(T.a320.loops[0].le, 14);
  const ses = lib.history[lib.history.length - 1];
  assert.deepEqual(ses.entries.map(e => e.id), [T.a320.id, T.b320.id], 'historial apunta a la conservada');
  // como se guarda en el historial de cambios (JSON y sin el orden completo)
  const saved = JSON.parse(JSON.stringify(compactUndo(undo)));
  assert.equal(saved.removed.order, null); assert.ok(saved.removed.prev);
  lib.addToCrate(dance.id, [T.cMp3.id]);   // un cambio posterior se conserva al deshacer
  assert.ok(lib.undoMerge(saved));
  const after = { tracks: [...lib.tracks.values()], crates: lib.crates.map(c => ({ ...c })), prepare: lib.prepare, history: lib.history, order: [...lib.tracks.keys()] };
  const b = JSON.parse(before);
  assert.deepEqual(after.order, b.order, 'mismo orden de pistas');
  assert.deepEqual(JSON.parse(JSON.stringify(after.tracks)), b.tracks, 'pistas con todos sus datos (cues, plays, valoración…)');
  assert.deepEqual(lib.crate(dance.id).ids, [T.dOrig.id, T.aCopy.id, T.dExt.id, T.cMp3.id], 'crate como antes + lo añadido después');
  assert.deepEqual(lib.crate(fav.id).ids, b.crates.find(c => c.name === 'Favoritas').ids);
  assert.deepEqual(lib.prepare, b.prepare);
  assert.deepEqual(JSON.parse(JSON.stringify(lib.history)), b.history);
  for (const k of ['aCopy', 'aRetag', 'b128']) T[k] = lib.byPath(FX[k]);
});
await test('Biblioteca protegida: no se resuelve ni se cambian etiquetas (y avisa)', async () => {
  const msgs = [];
  lib.on('protected', (m) => msgs.push(m));
  lib.protected = true;
  assert.equal(lib.mergeDuplicates([{ keep: T.a320.id, drop: [T.aCopy.id] }]), false);
  assert.equal(lib.applyTagEdits([{ id: T.a320.id, patch: { title: 'X' } }]), false);
  assert.ok(lib.get(T.aCopy.id) && T.a320.title === 'One More Time');
  assert.ok(msgs.length >= 2 && /protegida/.test(msgs[0]));
  lib.protected = false;
});

// ------------------------------------------------------------------ 5. papelera simulada
await testPapelera();
async function testPapelera() { await test('Papelera: los archivos van a la Papelera (simulada) y vuelven a su sitio; los que no están se avisan', async () => {
  const bin = path.join(TMP, '$Recycle.Bin'), sid = path.join(bin, 'S-1-5-21-123');
  fs.mkdirSync(sid, { recursive: true });
  const victim = path.join(TMP, 'Papelera', 'Copia - Tema.mp3');
  fs.mkdirSync(path.dirname(victim), { recursive: true });
  fs.writeFileSync(victim, crypto.randomBytes(50000));
  const original = sha1File(victim);
  let k = 0;
  const trashItem = async (p) => { const id = 'ABC' + (++k); const ext = path.extname(p); fs.writeFileSync(path.join(sid, '$I' + id + ext), recycle.buildInfo(p, fs.statSync(p).size)); fs.renameSync(p, path.join(sid, '$R' + id + ext)); };
  // unidad sin Papelera (red, USB, Papelera desactivada): trashItem borra del todo → no se mueve nada
  const nuke = async (p) => fs.unlinkSync(p);
  const rn = await recycle.trashFiles([victim], { trashItem: nuke, root: bin });
  assert.equal(rn[0].ok, false);
  assert.match(rn[0].error, /no tiene Papelera/);
  assert.ok(fs.existsSync(victim) && sha1File(victim) === original, 'sin Papelera el archivo se queda intacto');
  assert.deepEqual(fs.readdirSync(path.dirname(victim)), ['Copia - Tema.mp3'], 'no queda el archivo de prueba');
  assert.equal((await recycle.trashFiles(['\\\\servidor\\musica\\Tema.mp3'], { trashItem })).every(x => !x.ok), true, 'rutas de red: nunca');
  const r = await recycle.trashFiles([victim, path.join(TMP, 'Papelera', 'No existe.mp3')], { trashItem, root: bin });
  assert.deepEqual(r.map(x => x.ok), [true, false]);
  assert.ok(!fs.existsSync(victim));
  const hits = await recycle.findInRecycleBin(victim, { root: bin });
  assert.equal(hits.length, 1);
  const back = await recycle.restoreFromRecycleBin(victim, { root: bin });
  assert.equal(back.how, 'restored');
  assert.equal(sha1File(victim), original, 'el archivo vuelve idéntico');
  assert.equal(fs.readdirSync(sid).length, 0, 'la papelera queda vacía');
  assert.equal((await recycle.restoreFromRecycleBin(victim, { root: bin })).how, 'exists');
  assert.equal((await recycle.restoreFromRecycleBin(path.join(TMP, 'nunca.mp3'), { root: bin })).how, 'notfound');
}); }

// ------------------------------------------------------------------ 6. etiquetas: propuestas
const review = (k) => C.reviewTrack(T[k], scan1.records.find(r => r.id === T[k].id), { genres: C.artistGenres([...lib.tracks.values()]), spellings: C.artistSpellings([...lib.tracks.values()]) });
await test('Etiquetas: «Pista 01», basura de YouTube, MAYÚSCULAS, guiones bajos, carpeta con año, no coincide', async () => {
  const r1 = review('aRetag');
  assert.ok(r1.issues.includes('generic') && r1.issues.includes('noArtist'));
  const yt = review('yt');
  assert.ok(yt.issues.includes('junk'));
  assert.equal(yt.fields.title.val, 'Cancion Z'); assert.equal(yt.fields.title.conf, 'alta');
  assert.equal(yt.fields.artist.val, 'ArtistaZ');
  const cap = review('caps');
  assert.ok(cap.issues.includes('shouting'));
  assert.equal(cap.fields.title.val, 'Bailando en la Playa'); assert.equal(cap.fields.artist.val, 'Los del Mar'); assert.equal(cap.fields.title.conf, 'media');
  const un = review('under');
  assert.equal(un.fields.artist.val, 'Alguien'); assert.equal(un.fields.title.val, 'Algo Bonito'); assert.equal(un.fields.artist.conf, 'alta');
  const al = review('album');
  assert.ok(al.issues.includes('generic'));
  assert.equal(al.fields.year.val, '1999'); assert.equal(al.fields.year.src, 'carpeta');
  const mm = review('mismatch');
  assert.ok(mm.issues.includes('mismatch'));
  assert.equal(mm.fields.artist.val, 'Adriano Celentano'); assert.equal(mm.fields.artist.conf, 'baja');
  assert.ok(review('a320').issues.includes('noCover'));
  assert.ok(!review('cFlac').issues.includes('noYear'));
  const b128 = review('b128');
  assert.equal(b128.fields.title.val, 'Tema B');
});
await testNombres();
async function testNombres() { await test('Nombres de archivo y versiones (reglas del informe de la música)', () => {
  assert.deepEqual(C.fromFileName('01 - Rosalía - Noche de Verano'), { artist: 'Rosalía', title: 'Noche de Verano' });
  assert.deepEqual(C.fromFileName('01 - Artista - Título'), { artist: '', title: 'Artista - Título' }, '«Artista» y «Título» son genéricos');
  assert.deepEqual(C.fromFileName('3 Doors Down - Kryptonite'), { artist: '3 Doors Down', title: 'Kryptonite' });
  assert.deepEqual(C.fromFileName('105-jam_feat._amon_-_reason'), { artist: 'jam feat. amon', title: 'reason' });
  assert.equal(C.fromFileName('Track 05').title, '');
  assert.equal(C.parseVersion('Tema (feat. X) [Y Remix] - Radio Edit').vkey, 'radio edit+y remix');
  assert.equal(C.parseVersion('Tema (Original Mix)').vkey, '');
  assert.equal(C.parseVersion('Tema - Remastered 2011').vkey, '');
  assert.equal(C.artistKey('B & A feat. C'), C.artistKey('A, B'));
  assert.equal(C.fixMojibake('PequeÃ±a'), 'Pequeña');
  assert.equal(C.stripJunk('Canción [Lyrics] (www.web.com)'), 'Canción');
  assert.equal(C.cleanArtist('Artista - Topic'), 'Artista');
}); }

// ------------------------------------------------------------------ 7. escritura de etiquetas
// MP3 con un tag ID3v2.3 que lleva marcos de otros programas (GEOB de cues, PRIV, TXXX) que no se deben perder
function id3v23(frames) {
  const body = Buffer.concat(frames.map(([id, data]) => { const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(data.length, 4); return Buffer.concat([h, data]); }));
  const pad = Buffer.alloc(256), h = Buffer.alloc(10), sz = body.length + pad.length;
  h.write('ID3', 0, 'latin1'); h[3] = 3; h[6] = (sz >> 21) & 0x7f; h[7] = (sz >> 14) & 0x7f; h[8] = (sz >> 7) & 0x7f; h[9] = sz & 0x7f;
  return Buffer.concat([h, body, pad]);
}
const text = (s) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const GEOB = Buffer.concat([Buffer.from([0]), Buffer.from('application/octet-stream\0', 'latin1'), Buffer.from('\0', 'latin1'), Buffer.from('Serato Markers2\0', 'latin1'), crypto.randomBytes(470)]);
const PRIV = Buffer.concat([Buffer.from('www.otroprograma.com\0', 'latin1'), crypto.randomBytes(64)]);
const JPEG = (() => { const f = path.join(TMP, 'portada.jpg'); ffmpeg(['-f', 'lavfi', '-i', 'color=c=orange:s=300x300', '-frames:v', '1', f]); return fs.readFileSync(f); })();
await test('Escribir MP3 (ID3v2.3): cambia título/artista/año/género y añade la carátula; los demás marcos y el audio quedan idénticos', async () => {
  const raw = put('Escribir/raw.mp3');
  ffmpeg(['-i', FX.under, '-c', 'copy', '-id3v2_version', '0', '-write_xing', '1', raw]);
  const f = put('Escribir/Artista K - Tema K.mp3');
  const audio = fs.readFileSync(raw);
  fs.writeFileSync(f, Buffer.concat([id3v23([['TIT2', text('TEMA K (OFFICIAL VIDEO)')], ['TPE1', text('ArtistaKVEVO')], ['GEOB', GEOB], ['PRIV', PRIV], ['TXXX', Buffer.concat([Buffer.from([0]), Buffer.from('SERATO_PLAYCOUNT\x003', 'latin1')])]]), audio]));
  const orig = fs.readFileSync(f), origHash = sha1File(f);
  const s0 = splitHead(orig), audio0 = audioHash(orig, s0.headEnd);
  const res = await writeTags(f, { title: 'Tema K', artist: 'Artista K', year: '2019', genre: 'House' }, { cover: { data: JPEG, mime: 'image/jpeg' }, backupBase: path.join(TMP, 'copias-etiquetas', 'op1', '1') });
  assert.ok(res.ok, res.error);
  const now = fs.readFileSync(f), s1 = splitHead(now);
  assert.equal(audioHash(now, s1.headEnd), audio0, 'mismos datos de audio (huella SHA-1 de las tramas)');
  assert.equal(now[3], 3, 'sigue siendo ID3v2.3');
  const t = NodeID3.read(f);
  assert.equal(t.title, 'Tema K'); assert.equal(t.artist, 'Artista K'); assert.equal(t.year, '2019'); assert.equal(t.genre, 'House');
  assert.equal(t.image.imageBuffer.length, JPEG.length, 'carátula');
  const p = await probeFile(f);
  assert.equal(p.tags.title, 'Tema K'); assert.equal(p.tags.cover, true);
  assert.ok(now.includes(GEOB) && now.includes(PRIV) && now.includes(Buffer.from('SERATO_PLAYCOUNT', 'latin1')), 'GEOB, PRIV y TXXX copiados byte a byte');
  assert.equal(decodes(f), '', 'ffmpeg lo decodifica sin errores');
  assert.ok(Math.abs(parseFloat(ffprobe(f).format.duration) - parseFloat(ffprobe(raw).format.duration)) < 0.05, 'misma duración');
  // deshacer: el archivo vuelve a ser idéntico al original
  const back = await restoreTags(f, path.join(TMP, 'copias-etiquetas', 'op1', '1'));
  assert.ok(back.ok, back.error);
  assert.equal(sha1File(f), origHash, 'deshacer deja el archivo byte a byte como estaba');
});
await test('Escribir MP3 ID3v2.4 (año en TDRC) y MP3 sin etiquetas (se crea ID3v2.3)', async () => {
  const f = put('Escribir/v24.mp3'); fs.copyFileSync(FX.b320, f);
  const a0 = audioHash(fs.readFileSync(f), splitHead(fs.readFileSync(f)).headEnd);
  const r = await writeTags(f, { year: '2021', title: 'Tema B' }, { backupBase: path.join(TMP, 'copias-etiquetas', 'op2', '1') });
  assert.ok(r.ok, r.error);
  const b = fs.readFileSync(f);
  assert.equal(b[3], 4); assert.ok(b.includes(Buffer.from('TDRC')) && !b.includes(Buffer.from('TYER')));
  assert.equal((await probeFile(f)).tags.year, '2021');
  assert.equal(audioHash(b, splitHead(b).headEnd), a0);
  const g = put('Escribir/sin-tag.mp3'); fs.copyFileSync(FX.under, g);
  const gh = sha1File(g);
  const r2 = await writeTags(g, { artist: 'Alguien', title: 'Algo Bonito' }, { backupBase: path.join(TMP, 'copias-etiquetas', 'op2', '2') });
  assert.ok(r2.ok, r2.error);
  assert.equal(fs.readFileSync(g)[3], 3);
  assert.equal((await probeFile(g)).tags.artist, 'Alguien');
  assert.equal(decodes(g), '');
  await restoreTags(g, path.join(TMP, 'copias-etiquetas', 'op2', '2'));
  assert.equal(sha1File(g), gh);
});
await test('Escribir FLAC: Vorbis comments y carátula; tramas de audio y MD5 de STREAMINFO intactos; deshacer exacto', async () => {
  const f = put('Escribir/Artista L - Tema L.flac'); fs.copyFileSync(FX.album, f);
  const orig = sha1File(f), b0 = fs.readFileSync(f), mf0 = new Metaflac(b0);
  const frames0 = sha1(b0.subarray(mf0.framesOffset)), md50 = mf0.getMd5sum();
  const r = await writeTags(f, { artist: 'Artista L', title: 'Tema L', year: '1999', genre: 'Pop' }, { cover: { data: JPEG }, backupBase: path.join(TMP, 'copias-etiquetas', 'op3', '1') });
  assert.ok(r.ok, r.error);
  const b1 = fs.readFileSync(f), mf1 = new Metaflac(b1);
  assert.equal(sha1(b1.subarray(mf1.framesOffset)), frames0, 'mismas tramas de audio');
  assert.equal(mf1.getMd5sum(), md50, 'mismo MD5 del audio');
  assert.equal(mf1.getTag('ARTIST'), 'ARTIST=Artista L'); assert.equal(mf1.getTag('DATE'), 'DATE=1999');
  assert.equal(mf1.getPicturesSpecs().length, 1);
  const p = await probeFile(f);
  assert.deepEqual([p.tags.artist, p.tags.title, p.tags.genre, p.tags.cover], ['Artista L', 'Tema L', 'Pop', true]);
  assert.equal(decodes(f), '');
  const back = await restoreTags(f, path.join(TMP, 'copias-etiquetas', 'op3', '1'));
  assert.ok(back.ok);
  assert.equal(sha1File(f), orig);
});
await test('Otros formatos y audio cambiado: no se escribe (solo en Nexura) y deshacer no toca un audio distinto', async () => {
  assert.equal((await writeTags(FX.wav, { title: 'X' })).ok, false);
  assert.equal((await writeTags(FX.m4a, { title: 'X' })).ok, false);
  const f = put('Escribir/cambia.mp3'); fs.copyFileSync(FX.a320, f);
  assert.ok((await writeTags(f, { title: 'Nuevo' }, { backupBase: path.join(TMP, 'copias-etiquetas', 'op4', '1') })).ok);
  fs.appendFileSync(f, Buffer.alloc(1000, 7));   // el audio cambia después (otro programa lo ha tocado)
  const r = await restoreTags(f, path.join(TMP, 'copias-etiquetas', 'op4', '1'));
  assert.equal(r.ok, false); assert.match(r.error, /audio/);
});

// ------------------------------------------------------------------ 8. internet simulado
const MBID = '11111111-2222-3333-4444-555555555555', REL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ART = '99999999-8888-7777-6666-555555555555';
let hits = [];
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, ua: req.headers['user-agent'], t: Date.now() });
  if (req.url.startsWith('/ws/2/recording/')) {
    const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('query'));
    const items = /One More Time/i.test(q) ? [{ id: MBID, score: 100, title: 'One More Time', length: 40000, 'first-release-date': '2000-11-13', 'artist-credit': [{ name: 'Daft Punk', artist: { id: ART, name: 'Daft Punk' } }], releases: [{ id: REL, title: 'Discovery', date: '2001-03-12', status: 'Official', 'release-group': { 'primary-type': 'Album' } }] }] : [];
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ recordings: items }));
  } else if (req.url.startsWith('/ws/2/artist/')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ genres: [{ name: 'french house', count: 9 }, { name: 'house', count: 5 }], tags: [{ name: 'electronic', count: 3 }] }));
  } else if (req.url === `/release/${REL}/front-500`) { res.writeHead(307, { location: '/img/cover.jpg' }); res.end(); }
  else if (req.url === '/img/cover.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPEG); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
await test('MusicBrainz simulado: User-Agent, 1 petición por intervalo, caché, mejor coincidencia y carátula', async () => {
  const mb = createMb({ cacheDir: path.join(TMP, 'mb'), userAgent: 'NexuraDJStudio/1.0.0-rc.4 (contacto@nexuraia.com)', base: base + '/ws/2', caa: base, gap: 120 });
  const r = await mb.lookupMany([{ key: 'a', artist: 'Daft Punk', title: 'One More Time' }, { key: 'b', artist: 'Nadie', title: 'Nada' }]);
  assert.equal(r.offline, false);
  assert.ok(hits.every(h => h.ua === 'NexuraDJStudio/1.0.0-rc.4 (contacto@nexuraia.com)'), 'User-Agent con nombre, versión y contacto');
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i].t - hits[i - 1].t >= 110, 'separación entre peticiones');
  assert.ok(hits.some(h => h.url.startsWith('/ws/2/artist/')), 'sin estilos en la grabación: se piden los del artista');
  const best = C.bestOnline(r.results.a.items, { artist: 'Daft Punk', title: 'One More Time', dur: 40 }, r.results.a.artistTags);
  assert.deepEqual([best.artist, best.title, best.year, best.genre, best.releaseId, best.conf], ['Daft Punk', 'One More Time', '2000', 'House', REL, 'alta']);
  assert.equal(C.bestOnline(r.results.b.items, { artist: 'Nadie', title: 'Nada' }), null);
  const n0 = hits.length;
  const again = await mb.lookupMany([{ key: 'a', artist: 'Daft Punk', title: 'One More Time' }]);
  assert.equal(hits.length, n0, 'la grabación y los estilos del artista salen de la caché');
  assert.equal(again.results.a.items[0].id, MBID);
  const img = await mb.cover(REL);
  assert.ok(img && img.equals(JPEG), 'carátula (siguiendo la redirección)');
  const n1 = hits.length;
  await mb.cover(REL);
  assert.equal(hits.length, n1, 'carátula de la caché');
  // la propuesta de internet entra en la revisión con su confianza
  const rv = C.reviewTrack(T.aRetag, scan1.records.find(x => x.id === T.aRetag.id), { online: { ...best } });
  assert.equal(rv.fields.title.val, 'One More Time'); assert.equal(rv.fields.title.src, 'internet'); assert.equal(rv.fields.title.conf, 'alta');
  assert.ok(rv.cover && rv.cover.releaseId === REL);
});
await testSinRed();
async function testSinRed() { await test('Sin red: se para sin errores y solo quedan las propuestas locales', async () => {
  const mb = createMb({ cacheDir: path.join(TMP, 'mb2'), userAgent: 'NexuraDJStudio/test (contacto@nexuraia.com)', base: 'http://127.0.0.1:9/ws/2', caa: 'http://127.0.0.1:9', gap: 10, timeout: 2000 });
  const r = await mb.lookupMany([1, 2, 3, 4, 5].map(i => ({ key: 'k' + i, artist: 'A' + i, title: 'T' + i })));
  assert.equal(r.offline, true); assert.ok(r.done <= 3);
  assert.equal(await mb.cover('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').catch(() => 'error'), 'error');   // la interfaz lo trata como «sin carátula»
}); }
server.close();

// ------------------------------------------------------------------ 9. calidad
await test('Calidad: < 128 kbps, formatos a convertir, dañados, perdidos y duraciones raras', () => {
  const q = new Map(C.reviewQuality(items()).map(r => [r.id, r.issues]));
  assert.deepEqual(q.get(T.low.id), ['lt128']);
  assert.deepEqual(q.get(T.b128.id), ['lt192']);
  assert.ok(q.get(T.wma.id).includes('convert'));
  assert.ok(q.get(T.cut.id).includes('damaged') && q.get(T.junk.id).includes('damaged'));
  assert.deepEqual(q.get(T.gone.id), ['missing']);
  assert.deepEqual(q.get(T.short.id), ['short']);
  assert.ok(!q.has(T.a320.id) && !q.has(T.cFlac.id));
  const long = C.qualityIssues({ path: 'x.mp3', duration: 0 }, { fmt: 'mp3', br: 320, dur: 3600 });
  assert.deepEqual(long, ['long']);
});

// ------------------------------------------------------------------ 10. rendimiento con 40.000 entradas
await testRendimiento();
async function testRendimiento() { await test('Rendimiento: 40.000 entradas (análisis con caché en disco y cálculo de duplicados/etiquetas/calidad)', async () => {
  const N = 40000, entries = [];
  for (let i = 0; i < N; i++) entries.push({ id: 'p' + i, path: `E:\\Música\\Carpeta ${i % 300}\\Artista ${i % 2500} - Tema ${i}.mp3` });
  const fake = {
    stat: async (p) => ({ size: 5_000_000 + (parseInt(/Tema (\d+)/.exec(p)[1], 10) % 9000) * 7, mtimeMs: 1700000000000, isDirectory: () => false }),
    probe: async (p) => { const i = parseInt(/Tema (\d+)/.exec(p)[1], 10); return { fmt: 'mp3', codec: 'mp3', lossless: false, br: i % 7 ? 320 : 128, sr: 44100, dur: 180 + (i % 50), audioStart: 1000, audioEnd: 5_000_000 + (i % 9000) * 7 - 128, tags: { artist: 'Artista ' + (i % 2500), title: 'Tema ' + (i % 30000), year: '', genre: '', cover: false } }; },
    hashPart: async (p, a, b) => 'h' + (b - a) + (parseInt(/Tema (\d+)/.exec(p)[1], 10) % 3 ? 'x' : 'y'),
    hashFull: async (p, a, b) => 'f' + (b - a)
  };
  const cf = path.join(TMP, 'grande.ndjson');
  let t0 = Date.now();
  const r1 = await scanEntries(entries, { cache: createCache(cf), deps: fake });
  const first = Date.now() - t0;
  assert.equal(r1.stats.probed, N);
  t0 = Date.now();
  const r2 = await scanEntries(entries, { cache: createCache(cf), deps: { ...fake, probe: async () => { throw new Error('no debería leer'); } } });
  const second = Date.now() - t0;
  assert.equal(r2.stats.cached, N); assert.equal(r2.stats.probed, 0); assert.equal(r2.stats.partial + r2.stats.full, 0);
  t0 = Date.now();
  const its = r2.records.map((rec, i) => ({ track: { id: rec.id, path: entries[i].path, source: 'local', artist: rec.tags.artist, title: rec.tags.title, cues: [], loops: [], duration: rec.dur }, rec }));
  const d = C.findDuplicates(its, {});
  const tg = C.reviewTags(its, {});
  const q = C.reviewQuality(its);
  const calc = Date.now() - t0;
  console.log(`    40.000 entradas: primera vez ${first} ms · segunda (caché) ${second} ms · cálculo ${calc} ms · ${d.groups.length} grupos, ${tg.length} con etiquetas por revisar, ${q.length} de calidad`);
  assert.ok(second < 8000, 'segunda vez con caché < 8 s');
  assert.ok(calc < 10000, 'cálculo < 10 s');
  assert.ok(d.groups.length > 1000);
}); }

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} pruebas de «Limpiar biblioteca» correctas`);
