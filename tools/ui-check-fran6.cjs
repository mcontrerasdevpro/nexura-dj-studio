// Informe FRAN6 (1.0.0-rc.11) con Electron contra `npm run web` (puerto 5180). Pistas de clics generadas en la página
// (bombo en cada beat, sin música real):
// 1. SYNC que respeta el ajuste fino: con SYNC, un bend (y un nudge del jog) mueve la fase y la nueva fase se queda
//    (también 30 s después); el botón SYNC y el medidor lo indican; Mayús+clic en SYNC realinea (desfase 0, sigue
//    con SYNC); re-sync lo borra.
// 2. Cada fuente recuerda su sitio: crate de 217 temas, bajar a la mitad, ordenar por BPM, seleccionar, ir a otra
//    crate y volver → mismo scroll (±1 fila), mismo orden, misma selección; la otra crate conserva su propio orden;
//    la lista se recarga en segundo plano (análisis que actualiza filas, temas que llegan) sin moverse.
// 3. Cues editables: menú del pad (clic derecho) con «Mover aquí», ◂ ▸ 1 beat, Renombrar, Color, Borrar y Deshacer;
//    arrastrar el marcador en la onda grande (con Q al beat; con Mayús, libre) y en la general; un automático movido
//    pasa a manual y conserva nombre y color; Ctrl+Z deshace; acción MIDI «Cue N: mover a la posición actual».
// Capturas a 1280×800 en .revision/capturas-fran6/ (o NEXURA_SHOTS). Uso: npx electron tools/ui-check-fran6.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = process.env.NEXURA_SHOTS || path.join(__dirname, '..', '..', 'nexura-dj-studio', '.revision', 'capturas-fran6');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, title, bpm, fb, extra = {}) => ({
  id, path: `web:${title}.wav:${bpm}`, source: 'local', title, artist: 'Prueba', album: '', genre: 'House', year: '2026', comment: '', rating: 0,
  bpm, firstBeat: fb, bpmLocked: false, gridV: 2, key: '', camelot: '8A', duration: 90, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 6, sections: [], ...extra
});
const KICKS = { a: [124, 0.1], b: [128, 0.23], c: [126, 0.15] };
const seed = () => {
  const cues = Array(8).fill(null);
  cues[0] = { t: 0.15 + 8 * 60 / 126 * 4 / 4 * 4, color: '#2ec4b6', name: '1 Beat', auto: true, autoV: 4 };
  cues[2] = { t: 0.15 + 64 * 60 / 126, color: '#ff3b47', name: '3 Principal', auto: true, autoV: 4 };
  const tracks = [track('a', 'Clic 124', 124, 0.1), track('b', 'Clic 128', 128, 0.23), track('c', 'Con cues 126', 126, 0.15, { cues })];
  // biblioteca grande para la memoria por fuente: 217 temas en VOCALES y 120 en MELODIAS
  for (let i = 0; i < 360; i++) tracks.push(track('t' + i, `Tema ${String(i).padStart(3, '0')}`, 118 + (i * 7) % 23 + (i % 10) / 10, 0.1, { artist: 'Artista ' + (i % 37) }));
  return tracks;
};
const CRATES = [
  { id: 'voc', name: 'VOCALES', ids: Array.from({ length: 217 }, (_, i) => 't' + i) },
  { id: 'mel', name: 'MELODIAS', ids: Array.from({ length: 120 }, (_, i) => 't' + (217 + i)) }
];
const SETTINGS = { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9', aiAutoCues: false };

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
async function point(win, sel) {
  const r = await js(win, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null; return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, t: b.top, w: b.width, h: b.height }; })()`);
  if (!r || r.error) throw new Error('no encuentro (o no se ve) ' + sel);
  return r;
}
function mouse(win, type, x, y, modifiers = [], button = 'left') { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button, clickCount: 1, modifiers }); }
async function click(win, sel, modifiers = []) {
  const p = await point(win, sel);
  mouse(win, 'mouseMove', p.x, p.y);
  mouse(win, 'mouseDown', p.x, p.y, modifiers); await wait(40);
  mouse(win, 'mouseUp', p.x, p.y, modifiers); await wait(250);
}
async function rightClick(win, sel) {
  const p = await point(win, sel);
  mouse(win, 'mouseMove', p.x, p.y);
  mouse(win, 'mouseDown', p.x, p.y, [], 'right'); await wait(30);
  mouse(win, 'mouseUp', p.x, p.y, [], 'right');
  win.webContents.sendInputEvent({ type: 'contextMenu', x: Math.round(p.x), y: Math.round(p.y) });
  await wait(300);
}
// clic en una opción del menú contextual por su texto
const menuClick = (win, re) => js(win, `(() => { const it = [...document.querySelectorAll('.ctx.root .ctx-item')].find(e => ${re}.test(e.textContent)); if (!it) return false; it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
const PREPARE = (kicks) => `(async () => {
  const A = nexuraApp, ctx = A.engine.ctx, sr = ctx.sampleRate, K = ${JSON.stringify(kicks)};
  const { computeWaveform } = await import('/js/analysis/analysis-core.js');
  for (const [id, [bpm, fb]] of Object.entries(K)) {
    const N = sr * 90, buf = ctx.createBuffer(2, N, sr), L = buf.getChannelData(0);
    for (let b = 0, x = fb; x < 89.5; b++, x = fb + b * 60 / bpm) {
      const i0 = Math.round(x * sr), acc = b % 4 ? 0.6 : 1;
      for (let k = 0; k < sr * 0.12 && i0 + k < N; k++) { const tt = k / sr; L[i0 + k] += acc * (0.55 * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 18) + (tt < 0.003 ? 0.5 * Math.sin(2 * Math.PI * 2000 * tt) : 0)); }
    }
    buf.getChannelData(1).set(L);
    const w = computeWaveform(L, sr);
    A.analyzer.waves.set(id, { data: w.data, rate: w.rate });
    A.bufferCache.set(id, buf);
  }
  A.decode = async (t) => A.bufferCache.get(t.id);
  A.engine.setMaster(0.15);
  return Object.keys(K);
})()`;

const report = { ok: true, errors: [] };
const check = (name, cond, extra) => { if (!cond) report.ok = false; console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 600) : ''}`); };

async function boot(win, settings) {
  await load(win);
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify({ version: 1, tracks: seed(), crates: CRATES, smart: [], history: [], prepare: [], ytPlaylists: [] }))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(settings))}); true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3 && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(message)) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  try {
    await boot(win, SETTINGS);
    const prep = await js(win, PREPARE(KICKS));
    check('Pistas de clics preparadas (sin música real)', Array.isArray(prep) && prep.length === 3, prep);

    // ================================================================ 1. SYNC que respeta el ajuste fino
    await js(win, `(async () => { const A = nexuraApp; A.settings.loadProtect = 'off'; A.settings.syncOnLoad = false; await A.loadToDeck('a', 0); await A.loadToDeck('b', 1); return true; })()`);
    await wait(800);
    await js(win, `(() => { const [A, B] = nexuraApp.decks; A.play(); setTimeout(() => B.play(), 300); return true; })()`);
    await wait(1200);
    await js(win, `nexuraApp.decks[1].setSync(true); true`);
    await wait(2500);
    const PH = `(() => { const B = nexuraApp.decks[1], i = B.phaseInfo(); return i ? { ms: +i.ms.toFixed(1), off: +i.offsetMs.toFixed(1), sync: B.sync, btnOffset: nexuraApp.deckUIs[1].syncBtn.classList.contains('offset'), mark: getComputedStyle(nexuraApp.deckUIs[1].phaseOffMark).display, bpmA: +nexuraApp.decks[0].currentBpm.toFixed(3), bpmB: +B.currentBpm.toFixed(3) } : null; })()`;
    let p0 = await js(win, PH);
    check('SYNC: en fase con el maestro al empezar (|fase| < 5 ms)', p0 && Math.abs(p0.ms) < 5 && p0.sync, p0);
    // bend con el botón + del deck 2 (mantener 1,2 s)
    await js(win, `(() => { const B = nexuraApp.decks[1]; B.bendDown(1); setTimeout(() => B.bendUp(), 1200); return true; })()`);
    await wait(2600);
    const p1 = await js(win, PH);
    check('Bend con SYNC: al soltar, la fase queda movida (> 5 ms) y sigue con SYNC', p1 && Math.abs(p1.ms) > 5 && p1.sync, p1);
    check('…el desfase se guarda como ajuste del DJ (botón SYNC marcado y marca en el medidor)', p1 && p1.btnOffset && p1.mark !== 'none' && Math.abs(p1.off - p1.ms) < 4, p1);
    await shot(win, 'fase-desfase-usuario-1280x800');
    await wait(8000);
    const p2 = await js(win, PH);
    check('…8 s después sigue igual (±3 ms): el sync no lo deshace; mismo BPM que el maestro', p2 && Math.abs(p2.ms - p1.ms) < 3 && Math.abs(p2.bpmA - p2.bpmB) < 0.01, { p1, p2 });
    // Mayús + clic en SYNC = realinear fase
    await click(win, '#deck1 .btn.sync', ['shift']);
    await wait(2500);
    const p3 = await js(win, PH);
    check('Mayús+clic en SYNC: realinea (|fase| < 5 ms), sigue con SYNC y sin marca de ajuste', p3 && Math.abs(p3.ms) < 5 && p3.sync && !p3.btnOffset, p3);
    // nudge con el jog (rueda sobre la onda no: el jog es el plato) → la fase queda movida
    await js(win, `(() => { const B = nexuraApp.decks[1]; for (let i = 0; i < 6; i++) setTimeout(() => B.jogTurn(60), i * 30); return true; })()`);
    await wait(2500);
    const p4 = await js(win, PH);
    await wait(5000);
    const p5 = await js(win, PH);
    check('Nudge del jog con SYNC: la fase queda movida y 5 s después igual (±3 ms)', p4 && Math.abs(p4.ms) > 5 && Math.abs(p5.ms - p4.ms) < 3, { p4, p5 });
    // re-sync (quitar y poner SYNC) → 0
    await click(win, '#deck1 .btn.sync'); await click(win, '#deck1 .btn.sync');
    await wait(2500);
    const p6 = await js(win, PH);
    check('Re-sync (pulsar SYNC otra vez): vuelve a 0 (< 5 ms)', p6 && Math.abs(p6.ms) < 5 && p6.sync, p6);
    const midi = await js(win, `({ realign: !!nexuraApp.actions['deck2.syncrealign'], move: !!nexuraApp.actions['deck1.hotcuemove3'], label: (nexuraApp.actions['deck1.hotcuemove3'] || {}).label || '' })`);
    check('Acciones MIDI: «Realinear fase» y «Cue N: mover a la posición actual»', midi.realign && midi.move && /mover a la posición actual/.test(midi.label), midi);
    await js(win, `(() => { for (const d of nexuraApp.decks) { if (d.playing) d.pause(); d.setSync(false); } return true; })()`);

    // ================================================================ 3. cues editables
    await js(win, `nexuraApp.loadToDeck('c', 0)`);
    await wait(900);
    const CU = `(() => { const d = nexuraApp.decks[0]; return d.track.cues.slice(0, 4).map(c => c && { t: +c.t.toFixed(3), name: c.name, color: c.color, auto: !!c.auto }); })()`;
    const beat = 60 / 126;
    let c0 = await js(win, CU);
    await rightClick(win, '#deck0 .pads .pad:nth-child(3)');
    const menu = await js(win, `[...document.querySelectorAll('.ctx.root > .ctx-item')].map(e => e.textContent.trim())`);
    check('Clic derecho en un pad con cue: menú con Mover aquí, ◂ ▸ 1 beat, Renombrar, Color, Borrar y Deshacer', Array.isArray(menu) && ['Mover aquí', '◂ 1 beat', '▸ 1 beat', 'Renombrar', 'Color', 'Borrar hot cue', 'Deshacer'].every(s => menu.some(m => m.includes(s))), menu);
    const tip = await js(win, `document.querySelector('#deck0 .pads .pad:nth-child(3)').title`);
    check('…y el pad lo explica en su tooltip', /Clic derecho/.test(tip), tip);
    await shot(win, 'menu-cue-1280x800');
    await menuClick(win, '/▸ 1 beat/');
    await wait(300);
    let c1 = await js(win, CU);
    check('«▸ 1 beat después»: el cue 3 avanza un beat (±2 ms), conserva nombre y color y pasa a manual', Math.abs(c1[2].t - (c0[2].t + beat)) < 0.002 && c1[2].name === c0[2].name && c1[2].color === c0[2].color && !c1[2].auto, { antes: c0[2], ahora: c1[2] });
    // Ctrl+Z deshace
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] });
    await wait(400);
    let c2 = await js(win, CU);
    check('Ctrl+Z: deshace el último cambio de cue (vuelve a su sitio y a automático)', Math.abs(c2[2].t - c0[2].t) < 0.002 && c2[2].auto, c2[2]);
    // Mover aquí: el deck en 20,1 s (parado), con Q → al beat más cercano
    await js(win, `nexuraApp.decks[0].seek(20.1); true`); await wait(300);
    await rightClick(win, '#deck0 .pads .pad:nth-child(3)');
    await menuClick(win, '/Mover aquí/');
    await wait(300);
    c1 = await js(win, CU);
    const nb = 0.15 + Math.round((20.1 - 0.15) / beat) * beat;
    check('«Mover aquí» con Q: el cue va al beat más cercano a lo que suena (±5 ms) y conserva su nombre', Math.abs(c1[2].t - nb) < 0.005 && c1[2].name === '3 Principal' && !c1[2].auto, { t: c1[2].t, want: +nb.toFixed(3) });
    // Renombrar desde el menú
    await rightClick(win, '#deck0 .pads .pad:nth-child(3)');
    await menuClick(win, '/Renombrar/');
    await wait(300);
    await js(win, `(() => { const i = document.querySelector('.modal-ov input'); i.value = 'Mi drop'; [...document.querySelectorAll('.modal-ov .modal-foot .btn')].pop().click(); return true; })()`);
    await wait(300);
    c1 = await js(win, CU);
    check('Renombrar: el cue se llama como dice el DJ', c1[2].name === 'Mi drop', c1[2]);
    // no se recalcula: los automáticos se rehacen, el movido se queda
    const kept = await js(win, `(() => { const A = nexuraApp, d = A.decks[0], t = d.track; const before = t.cues[2].t; A.ai.autoCues(t, { wave: A.analyzer.waves.get('c') }); const c = A.library.get('c').cues; return { same: c[2] && c[2].t === before && c[2].name === 'Mi drop' }; })()`);
    check('Tras moverlo, recalcular los cues automáticos no lo toca', kept && kept.same, kept);
    // arrastrar el marcador del cue 1 en la onda grande (el recálculo de antes ha rehecho el «1 Beat» automático)
    c0 = await js(win, CU);
    await js(win, `nexuraApp.decks[0].seek(${Math.max(0, c0[0].t + 1).toFixed(3)}); true`); await wait(600);
    const W = await js(win, `(() => { const c = document.querySelector('#wave0'); const w = nexuraApp.waves[0]; const b = c.getBoundingClientRect(), m = w._map, t = nexuraApp.decks[0].track.cues[0].t; return m ? { x: b.left + (t - m.t0) * m.pxPerSec, y: b.top + b.height - 6, pps: m.pxPerSec, top: b.top, h: b.height } : null; })()`);
    if (W && !W.error) {
      const dx = Math.round(beat * 2.3 * W.pps); // ~2,3 beats a la derecha → con Q, a 2 beats
      mouse(win, 'mouseMove', W.x, W.y);
      mouse(win, 'mouseDown', W.x, W.y); await wait(50);
      for (let k = 1; k <= 6; k++) { mouse(win, 'mouseMove', W.x + dx * k / 6, W.y); await wait(30); }
      await shot(win, 'cue-arrastrandose-1280x800');
      mouse(win, 'mouseUp', W.x + dx, W.y); await wait(300);
      c1 = await js(win, CU);
      const want = c0[0].t + 2 * beat;
      check('Arrastrar el marcador en la onda grande con Q: el cue 1 se pega al beat (+2 beats, ±5 ms), conserva nombre', Math.abs(c1[0].t - want) < 0.005 && c1[0].name === '1 Beat' && !c1[0].auto, { t: c1[0].t, want: +want.toFixed(3), dx });
      // con Mayús: libre
      const W2 = await js(win, `(() => { const c = document.querySelector('#wave0'); const w = nexuraApp.waves[0]; const b = c.getBoundingClientRect(), m = w._map, t = nexuraApp.decks[0].track.cues[0].t; return { x: b.left + (t - m.t0) * m.pxPerSec, y: b.top + b.height - 6, pps: m.pxPerSec }; })()`);
      const dx2 = Math.round(0.37 * beat * W2.pps);
      mouse(win, 'mouseMove', W2.x, W2.y);
      mouse(win, 'mouseDown', W2.x, W2.y, ['shift']); await wait(50);
      for (let k = 1; k <= 4; k++) { mouse(win, 'mouseMove', W2.x + dx2 * k / 4, W2.y, ['shift']); await wait(30); }
      mouse(win, 'mouseUp', W2.x + dx2, W2.y, ['shift']); await wait(300);
      const c3 = await js(win, CU);
      const off = (c3[0].t - c1[0].t) / beat;
      check('…con Mayús, libre (se queda entre beats, ~0,37 beat)', off > 0.25 && off < 0.5, { off: +off.toFixed(3) });
    } else check('Arrastrar el marcador en la onda grande', false, W);
    // vista general (overview): arrastrar el cue 3
    const O = await js(win, `(() => { const c = document.querySelector('#deck0 canvas.overview'); if (!c) return null; const b = c.getBoundingClientRect(), d = nexuraApp.decks[0]; return { x: b.left + d.track.cues[2].t / d.duration * b.width + 1, y: b.top + b.height / 2, w: b.width, dur: d.duration, t: d.track.cues[2].t, time: d.time }; })()`);
    if (O && !O.error) {
      const dx = Math.round(10 / O.dur * O.w); // ~10 s a la derecha
      mouse(win, 'mouseMove', O.x, O.y);
      mouse(win, 'mouseDown', O.x, O.y); await wait(50);
      for (let k = 1; k <= 5; k++) { mouse(win, 'mouseMove', O.x + dx * k / 5, O.y); await wait(30); }
      mouse(win, 'mouseUp', O.x + dx, O.y); await wait(300);
      c1 = await js(win, CU);
      const t1 = await js(win, `nexuraApp.decks[0].time`);
      const onBeat = Math.abs(((c1[2].t - 0.15) / beat) - Math.round((c1[2].t - 0.15) / beat)) < 0.02;
      check('Arrastrar el cue en la vista general: se mueve (~10 s), al beat con Q, y no mueve la reproducción', c1[2].t - O.t > 7 && c1[2].t - O.t < 13 && onBeat && Math.abs(t1 - O.time) < 0.05, { antes: O.t, ahora: c1[2].t, onBeat, time: [O.time, t1] });
    } else check('Arrastrar el cue en la vista general', false, O);
    // MIDI «Cue 1: mover a la posición actual»
    await js(win, `nexuraApp.decks[0].seek(40.02); true`); await wait(300);
    await js(win, `nexuraApp.actions['deck1.hotcuemove1'].fn(true); true`); await wait(300);
    c1 = await js(win, CU);
    const nb1 = 0.15 + Math.round((40.02 - 0.15) / beat) * beat;
    check('MIDI «Cue 1: mover a la posición actual»: va al beat de lo que suena (±5 ms)', Math.abs(c1[0].t - nb1) < 0.005, { t: c1[0].t, want: +nb1.toFixed(3) });
    // borrar desde el menú y deshacer (no se pierde el nombre)
    await rightClick(win, '#deck0 .pads .pad:nth-child(3)');
    await menuClick(win, '/Borrar hot cue/'); await wait(300);
    const del = await js(win, CU);
    await js(win, `nexuraApp.decks[0].undoCue()`); await wait(300);
    const und = await js(win, CU);
    check('Borrar y deshacer: el cue vuelve con su nombre', del[2] === null && und[2] && und[2].name === 'Mi drop', { del: del[2], und: und[2] });

    // ================================================================ 4 cues nuevos en la interfaz (pads con los nombres)
    await js(win, `(() => { const A = nexuraApp, t = A.library.get('a'); const cues = Array(8).fill(null); const C = ['#2ec4b6', '#9b5de5', '#ff3b47', '#ff9f1c']; ['1 Beat', '2 Subidón', '3 Principal', '4 Salida'].forEach((n, i) => { cues[i] = { t: 0.1 + [8, 24, 44, 64][i] * 4 * 60 / 124, color: C[i], name: n, auto: true, autoV: 4 }; }); A.library.update('a', { cues }); return true; })()`);
    await js(win, `nexuraApp.loadToDeck('a', 1)`); await wait(800);
    const pads = await js(win, `[...document.querySelectorAll('#deck1 .pads .pad .pad-label')].slice(0, 4).map(e => e.textContent)`);
    check('Pads con los 4 cues de DJ: 1 Beat, 2 Subidón, 3 Principal, 4 Salida', Array.isArray(pads) && pads.join('|') === '1 Beat|2 Subidón|3 Principal|4 Salida', pads);

    // ================================================================ 2. cada fuente recuerda su sitio
    await js(win, `nexuraApp.setScreenView('lib'); true`);
    await wait(1200);
    const LS = `(() => { const L = nexuraApp.libraryUI, s = L.scroller; return { view: L.viewId, row: +(s.scrollTop / L.rowH).toFixed(2), sort: L.sort.field + ':' + L.sort.dir, sel: [...L.sel], cur: L.cursor >= 0 && L.rows[L.cursor] ? L.rows[L.cursor].id : null, first: (L.rows[Math.floor(s.scrollTop / L.rowH)] || {}).id, n: L.rows.length, rowH: L.rowH }; })()`;
    await js(win, `nexuraApp.libraryUI.setView('crate:voc'); true`); await wait(500);
    // bajar a la mitad
    await js(win, `(() => { const L = nexuraApp.libraryUI; L.scroller.scrollTop = 100 * L.rowH; return true; })()`); await wait(300);
    // ordenar por BPM (clic en la cabecera)
    await click(win, '.lib-head .th[data-key="bpm"], .th[data-key="bpm"]');
    await wait(400);
    // sigue en la mitad tras ordenar? se vuelve a colocar en la mitad para la prueba
    await js(win, `(() => { const L = nexuraApp.libraryUI; L.scroller.scrollTop = 100 * L.rowH; return true; })()`); await wait(300);
    // seleccionar una fila visible
    await js(win, `(() => { const L = nexuraApp.libraryUI; L.selectOnly(105); return true; })()`); await wait(200);
    const v1 = await js(win, LS);
    check('VOCALES (217): a mitad de lista, ordenada por BPM y con una fila seleccionada', v1.n === 217 && v1.row > 95 && v1.sort === 'bpm:1' && v1.sel.length === 1, v1);
    await shot(win, 'biblioteca-vocales-mitad-1280x800');
    // a MELODIAS
    await js(win, `nexuraApp.libraryUI.setView('crate:mel'); true`); await wait(500);
    const m1 = await js(win, LS);
    check('MELODIAS: arriba y con su propio orden (sin el BPM de VOCALES)', m1.row < 0.5 && m1.sort !== 'bpm:1' && m1.n === 120, m1);
    await js(win, `(() => { const L = nexuraApp.libraryUI; L.scroller.scrollTop = 30 * L.rowH; return true; })()`); await wait(300);
    // volver a VOCALES
    await js(win, `nexuraApp.libraryUI.setView('crate:voc'); true`); await wait(600);
    const v2 = await js(win, LS);
    check('Volver a VOCALES: mismo scroll (±1 fila), mismo orden y misma selección', Math.abs(v2.row - v1.row) <= 1 && v2.sort === v1.sort && v2.sel.join() === v1.sel.join() && v2.cur === v1.cur && v2.first === v1.first, { v1, v2 });
    // recarga en segundo plano: el análisis actualiza filas (energía) y llegan temas nuevos a la crate
    await js(win, `(async () => { const A = nexuraApp, L = A.library; for (let i = 0; i < 40; i++) L.update('t' + i, { energy: 3 + (i % 5) }); const c = L.crate('voc'); for (let i = 340; i < 350; i++) L.addToCrate ? L.addToCrate('voc', ['t' + i]) : c.ids.push('t' + i); A.libraryUI.refresh(); return true; })()`);
    await wait(900);
    const v3 = await js(win, LS);
    check('Recarga en segundo plano (filas que cambian, temas que llegan): sigue en el mismo tema arriba y con la selección', v3.first === v1.first && v3.sel.join() === v1.sel.join() && v3.sort === v1.sort, { v1, v3 });
    // volver a MELODIAS: su scroll
    await js(win, `nexuraApp.libraryUI.setView('crate:mel'); true`); await wait(500);
    const m2 = await js(win, LS);
    check('…y MELODIAS también recuerda el suyo (fila 30 ±1)', Math.abs(m2.row - 30) <= 1, m2);
    // «Todas las pistas» y vuelta
    await js(win, `nexuraApp.libraryUI.setView('all'); true`); await wait(400);
    await js(win, `(() => { const L = nexuraApp.libraryUI; L.scroller.scrollTop = 200 * L.rowH; return true; })()`); await wait(300);
    await js(win, `nexuraApp.libraryUI.setView('crate:voc'); true`); await wait(400);
    await js(win, `nexuraApp.libraryUI.setView('all'); true`); await wait(500);
    const a2 = await js(win, LS);
    check('«Todas las pistas» también recuerda su sitio (fila 200 ±1)', Math.abs(a2.row - 200) <= 1, a2);
    const saved = await js(win, `JSON.stringify(nexuraApp.settings.libSortBy || {})`);
    check('El orden por fuente se guarda en los ajustes (VOCALES por BPM)', /"crate:voc":\{"field":"bpm","dir":1\}/.test(saved), saved);

    check('Sin errores en la consola', !report.errors.length, report.errors.slice(0, 5));
  } catch (e) {
    check('La prueba ha fallado', false, String(e && e.stack || e));
  }
  console.log(report.ok ? '\nui-check-fran6: todo correcto' : '\nui-check-fran6: hay fallos');
  app.exit(report.ok ? 0 : 1);
});
