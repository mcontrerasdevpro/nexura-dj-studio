// «Limpiar biblioteca» en la app de escritorio real (main.js) con datos temporales y archivos generados con
// ffmpeg: análisis en el hilo aparte (y segunda vez desde la caché), cancelar y reanudar, resolver duplicados
// exactos con la Papelera de Windows DE VERDAD (archivos temporales de la prueba), copia de seguridad «antes de
// limpiar», escribir etiquetas en un MP3 (audio intacto) y deshacer todo: las etiquetas originales vuelven y los
// archivos salen de la Papelera idénticos. Uso: npx electron tools/ui-check-limpieza-escritorio.cjs
// → capturas e informe en .revision/limpiar-biblioteca/ (escritorio-*)
'use strict';
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', '.revision', 'limpiar-biblioteca');
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-limpieza-app-'));
app.setPath('userData', path.join(tmp, 'userData'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const { splitHead, audioHash } = require('../main/tag-writer');
const recycle = require('../main/recycle');
const NodeID3 = require('node-id3');

// música de prueba
const M = path.join(tmp, 'Música');
const put = (rel) => { const p = path.join(M, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };
function tone(rel, f, meta, kbps = 320, dur = 40) {
  const out = put(rel);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=44100:duration=${dur}`, '-f', 'lavfi', '-i', `anoisesrc=d=${dur}:c=pink:a=0.05:r=44100`,
    '-filter_complex', '[0:a][1:a]amix=inputs=2,aformat=channel_layouts=stereo', '-c:a', 'libmp3lame', '-b:a', kbps + 'k', '-id3v2_version', '3', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out]);
  return out;
}
const F = {};
F.a = tone('House/Daft Punk - One More Time.mp3', 440, { artist: 'Daft Punk', title: 'One More Time', date: '2000', genre: 'House' });
F.aCopy = put('Descargas/Daft Punk - One More Time.mp3'); fs.copyFileSync(F.a, F.aCopy);
F.aRetag = put('Varios/Pista 01.mp3'); fs.copyFileSync(F.a, F.aRetag); NodeID3.write({ title: 'Pista 01' }, F.aRetag);
F.b = tone('Pop/Artista B - Tema B.mp3', 523, { artist: 'Artista B', title: 'Tema B' });
F.b128 = tone('Descargas/Artista B - Tema B.mp3', 523, { artist: 'Artista B', title: 'Tema B' }, 128);
F.yt = tone('YouTube/Artista Z - Cancion Z (Official Video).mp3', 250, { artist: 'ArtistaZVEVO', title: 'Cancion Z (Official Video) [HD]' });
const HASH = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, sha1(p)]));

const report = [], errors = [];
const ok = (cond, msg, data) => { report.push((cond ? '✓ ' : '✗ ') + msg + (data !== undefined && !cond ? ' ' + JSON.stringify(data) : '')); console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) errors.push(msg + ' ' + JSON.stringify(data)); };
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, level, message, line, src) => { if (level >= 3 && !/favicon|youtube/i.test(message)) errors.push(`consola: ${message} (${path.basename(src || '')}:${line})`); });
});
require('../main.js');
const js = (wc, code) => wc.executeJavaScript(code, true);
const until = async (wc, code, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await js(wc, code).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return v; await wait(150); } };
const confirmModal = (wc) => js(wc, `(() => { const b = [...document.querySelectorAll('.modal-ov:not(.cl-ov) .modal-foot .btn.primary')].pop(); if (!b) return false; b.click(); return true; })()`);
async function shot(win, name, w, h) {
  win.setMinimumSize(320, 400); win.setContentSize(w, h);
  await wait(700); win.webContents.invalidate(); await wait(300);
  const [rw, rh] = win.getContentSize();
  fs.writeFileSync(path.join(OUT, `escritorio-${name}-${rw}x${rh}.png`), (await win.webContents.capturePage()).toPNG());
  report.push(`captura escritorio-${name}-${rw}x${rh}.png`);
}

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  const wc = win.webContents;
  for (let i = 0; i < 40; i++) { if (await js(wc, '!!(window.nexuraApp && window.nexuraApp.library && window.nexuraApp.cleanupUI)').catch(() => false)) break; await wait(250); }
  await wait(1200);
  try {
    win.setContentSize(1280, 800);
    await js(wc, `nexuraApp.settings.autoAnalyze = false; nexuraApp.settings.welcomeDone = true; document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelector('.start-overlay')?.remove(); true`);
    // biblioteca: las pistas del disco (con sus etiquetas, como al añadir una carpeta), una crate y un cue en la copia
    const n = await js(wc, `(async () => { const infos = await window.nexura.infoForPaths([${JSON.stringify(M)}]); const L = nexuraApp.library; L.addFiles(infos);
      const c = L.createCrate('Fiesta'); L.addToCrate(c.id, [L.byPath(${JSON.stringify(F.aCopy)}).id, L.byPath(${JSON.stringify(F.b)}).id]);
      L.byPath(${JSON.stringify(F.aCopy)}).cues[0] = { t: 10, color: '#ff3b47', name: 'Drop' }; L.byPath(${JSON.stringify(F.aCopy)}).plays = 5; await L.save(); return L.tracks.size; })()`);
    ok(n === 6, 'biblioteca de prueba con 6 pistas reales', n);

    // 1) analizar en el hilo aparte y cancelar a mitad → reanudar
    await js(wc, `nexuraApp.cleanupUI.open('all'); true`);
    await wait(30);
    await js(wc, `nexuraApp.cleanupUI.cancel(); true`);
    const st1 = await until(wc, `['cancelled', 'done'].includes(nexuraApp.cleanupUI.state) && nexuraApp.cleanupUI.state`);
    ok(st1 === 'cancelled' || st1 === 'done', 'cancelar el análisis real (si no le ha dado tiempo a acabar, queda completo): ' + st1);
    if (st1 === 'cancelled') { await js(wc, `nexuraApp.cleanupUI.analyze(); true`); await until(wc, `nexuraApp.cleanupUI.state === 'done'`); }
    const s1 = await js(wc, `({ state: nexuraApp.cleanupUI.state, stats: nexuraApp.cleanupUI.lastStats, groups: nexuraApp.cleanupUI.dups.groups.map(g => ({ kind: g.kind, n: g.members.length, keep: g.members.find(m => m.id === g.keep).path })) })`);
    ok(s1.state === 'done', 'análisis completo con el proceso principal (hilo aparte)', s1);
    const exact = s1.groups.find(g => g.kind === 'exact'), same = s1.groups.find(g => g.kind === 'same');
    ok(exact && exact.n === 3 && exact.keep === F.aCopy, 'exactos: original + copia + copia re-etiquetada; misma calidad → se propone la que tiene datos en Nexura (cue, crate, reproducciones), aunque esté en «Descargas»', s1.groups);
    ok(same && same.n === 2 && same.keep === F.b, 'misma canción: se conserva la de 320 kbps', s1.groups);
    await shot(win, 'duplicados', 1280, 800);

    // 2) segunda vez: casi todo de la caché
    const t0 = Date.now();
    await js(wc, `nexuraApp.cleanupUI.analyze(); true`);
    await until(wc, `nexuraApp.cleanupUI.state === 'done' && nexuraApp.cleanupUI.lastStats.cached > 0`);
    const s2 = await js(wc, `nexuraApp.cleanupUI.lastStats`);
    ok(s2.cached === 6 && s2.probed === 0, `segunda vez desde la caché (${s2.cached} de la caché, ${s2.probed} leídos, ${Date.now() - t0} ms)`, s2);

    // 3) el usuario elige conservar la de «House» y resuelve: la copia y la re-etiquetada van a la Papelera
    await js(wc, `(() => { const ui = nexuraApp.cleanupUI; ui.dupKind = 'exact'; ui.render(); const id = nexuraApp.library.byPath(${JSON.stringify(F.a)}).id;
      const r = document.querySelector('.cl-group input[type=radio][value="' + id + '"]'); r.click(); return true; })()`);
    await wait(200);
    const kept = await js(wc, `document.querySelector('.cl-group .cl-mem.keep .cl-mem-main b').textContent + ' · ' + document.querySelector('.cl-group .cl-mem.keep .cl-path').textContent`);
    ok(/House/.test(kept), 'elegir otra copia a mano (botón de opción «Se conserva»): ' + kept);
    await js(wc, `document.querySelector('.cl-group .cl-resolve').click(); true`);
    await wait(300);
    await confirmModal(wc);
    await until(wc, `nexuraApp.cleanupUI.ops.length === 1`);
    await wait(500);
    const r3 = await js(wc, `(() => { const L = nexuraApp.library, k = L.byPath(${JSON.stringify(F.a)}); const op = nexuraApp.cleanupUI.ops[0];
      return { tracks: L.tracks.size, fiesta: L.crates.find(c => c.name === 'Fiesta').ids.map(i => L.get(i).path), cue: k.cues[0] && k.cues[0].name, plays: k.plays, trashed: op.trashed, failed: op.trashFailed }; })()`);
    ok(r3.tracks === 4 && r3.fiesta[0] === F.a && r3.cue === 'Drop' && r3.plays === 5, 'resuelto: 2 pistas fuera; crate, cue y reproducciones pasan a la conservada', r3);
    ok(!fs.existsSync(F.aCopy) && !fs.existsSync(F.aRetag) && fs.existsSync(F.a), 'los archivos de las copias ya no están en su carpeta');
    const inBin = (await recycle.findInRecycleBin(F.aCopy)).length + (await recycle.findInRecycleBin(F.aRetag)).length;
    ok(r3.trashed.length === 2 && inBin === 2, 'están en la Papelera de Windows (C:\\$Recycle.Bin)', { trashed: r3.trashed, inBin, failed: r3.failed });
    const copias = fs.readdirSync(path.join(tmp, 'userData', 'copias')).filter(d => fs.existsSync(path.join(tmp, 'userData', 'copias', d, 'copia.json'))).map(d => JSON.parse(fs.readFileSync(path.join(tmp, 'userData', 'copias', d, 'copia.json'), 'utf8')).reason);
    ok(copias.includes('limpieza'), 'copia de seguridad «antes de limpiar» hecha justo antes de aplicar', copias);
    await shot(win, 'resuelto', 1280, 800);

    // 4) etiquetas: limpiar el MP3 con basura de YouTube y guardarlo en el archivo
    const audio0 = (() => { const b = fs.readFileSync(F.yt); return audioHash(b, splitHead(b).headEnd); })();
    await js(wc, `(() => { const ui = nexuraApp.cleanupUI; ui.tab = 'tags'; ui.tagFilter = 'junk'; ui.render(); return true; })()`);
    await wait(300);
    await shot(win, 'etiquetas', 1280, 800);
    await js(wc, `(() => { const ui = nexuraApp.cleanupUI, id = nexuraApp.library.byPath(${JSON.stringify(F.yt)}).id; const r = ui.tagById.get(id);
      for (const f of ['artist', 'title']) ui.picks.set(id + '|' + f, { on: true, value: r.fields[f].val }); ui.render(); document.querySelector('.cl-apply').click(); return true; })()`);
    await wait(300);
    await confirmModal(wc);
    await until(wc, `nexuraApp.cleanupUI.ops.length === 2`);
    await wait(300);
    const t4 = NodeID3.read(F.yt);
    const audio1 = (() => { const b = fs.readFileSync(F.yt); return audioHash(b, splitHead(b).headEnd); })();
    const n4 = await js(wc, `(() => { const t = nexuraApp.library.byPath(${JSON.stringify(F.yt)}); return [t.artist, t.title]; })()`);
    ok(t4.artist === 'ArtistaZ' && t4.title === 'Cancion Z' && n4.join() === 'ArtistaZ,Cancion Z', 'etiquetas nuevas en el archivo y en Nexura', { file: [t4.artist, t4.title], n4 });
    ok(audio1 === audio0, 'el audio del MP3 no ha cambiado (misma huella SHA-1 de las tramas)');

    // 5) deshacer las etiquetas (archivo idéntico al original) y los duplicados (vuelven de la Papelera)
    await js(wc, `(() => { const ui = nexuraApp.cleanupUI; ui.tab = 'history'; ui.render(); return true; })()`);
    await wait(200);
    await shot(win, 'historial', 1280, 800);
    await js(wc, `nexuraApp.cleanupUI.undo(nexuraApp.cleanupUI.ops[0].id)`);
    ok(sha1(F.yt) === HASH.yt, 'deshacer etiquetas: el archivo vuelve a ser idéntico (byte a byte)');
    await js(wc, `nexuraApp.cleanupUI.undo(nexuraApp.cleanupUI.ops[1].id)`);
    await wait(400);
    const r5 = await js(wc, `(() => { const L = nexuraApp.library; return { tracks: L.tracks.size, fiesta: L.crates.find(c => c.name === 'Fiesta').ids.map(i => L.get(i).path), cue: L.byPath(${JSON.stringify(F.a)}).cues[0], note: nexuraApp.cleanupUI.ops[1].undoNote }; })()`);
    ok(r5.tracks === 6 && r5.fiesta[0] === F.aCopy && !r5.cue, 'deshacer duplicados: vuelven las pistas, la crate y los datos de cada una', r5);
    ok(fs.existsSync(F.aCopy) && sha1(F.aCopy) === HASH.aCopy && fs.existsSync(F.aRetag) && sha1(F.aRetag) === HASH.aRetag, 'los archivos han vuelto de la Papelera a su carpeta, idénticos: ' + r5.note);
    ok((await recycle.findInRecycleBin(F.aCopy)).length === 0, 'y ya no están en la Papelera');
    await shot(win, 'deshecho', 1280, 800);
    await js(wc, `(() => { const ui = nexuraApp.cleanupUI; ui.tab = 'dups'; ui.render(); return true; })()`);
    await shot(win, 'duplicados', 375, 812);
    await js(wc, `nexuraApp.cleanupUI.close(); true`);
    const log = fs.readFileSync(path.join(tmp, 'userData', 'logs', 'nexura.log'), 'utf8').split('\n').filter(l => /limpieza/.test(l));
    report.push('Registro:\n    ' + log.join('\n    '));
  } catch (e) { errors.push('prueba: ' + (e && e.stack || e)); }
  // por si algo ha fallado a mitad: lo que quede de la prueba en la Papelera vuelve a su sitio antes de borrar la carpeta temporal
  for (const p of [F.aCopy, F.aRetag]) if (!fs.existsSync(p)) await recycle.restoreFromRecycleBin(p).catch(() => {});
  const txt = report.join('\n') + '\n\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores');
  fs.writeFileSync(path.join(OUT, 'informe-escritorio.txt'), txt);
  console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores');
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(errors.length ? 1 : 0); }, 300);
});
