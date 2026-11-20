// Informe FRAN5 (1.0.0-rc.9) con Electron contra `npm run web` (puerto 5180). Pistas de clics generadas en la página
// (bombo en cada beat, sin música real):
// - Vista inicial: instalación nueva → Biblioteca; ajustes antiguos (Mezcla sin la marca) → Biblioteca una vez y
//   después se recuerda la elegida.
// - Aviso de carga: deck sonando al aire → no carga y avisa («Cargar igualmente», repetir en 2 s, MIDI); con el fader
//   bajado carga sin aviso; «Solo avisar», «Desactivado» y las cargas del Automix/Autoplay.
// - Al cargar: en pausa en el primer cue (por defecto) o «Empieza a sonar».
// - Sincronizar al cargar: SYNC encendido con el deck que suena, mismo tempo, en fase al dar a play; rango ampliado.
// - Editar grid: modo visible, arrastrar la rejilla con el ratón, ◂ ▸ de 1 ms / 10 ms (Mayús) / ½ beat (Ctrl),
//   «1 aquí», BPM ±0,01 / ±0,1, queda como manual (no se recalcula), deshacer y volver al análisis.
// - Cues con Q: al golpe si está a < 30 ms de la línea, a la línea si no; Mayús + pad vacío y la acción MIDI «Cues
//   sin cuantizar»: justo donde está.
// - Pitch bend: mantener pulsado con el ratón y con el dedo (táctil), soltar = vuelve a su tempo; MIDI; rueda sobre
//   el plato sonando = nudge.
// - Salida de audio en caliente con un dispositivo simulado (setSinkId falso que para el audio): vuelve a sonar sin
//   reiniciar y los decks siguen donde estaban; sin salidas duplicadas; «Automático» con 4 / 8 canales; dispositivo
//   que se desconecta y vuelve; salidas abiertas en el registro técnico.
// - Pestañas de los modos de pad sin texto recortado.
// Capturas a 1920×1080 y 1280×800 en .revision/capturas-fran5/ (o NEXURA_SHOTS). Uso: npx electron tools/ui-check-fran5.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = process.env.NEXURA_SHOTS || path.join(__dirname, '..', '.revision', 'capturas-fran5');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// fb = primer beat del grid guardado; kick = dónde están de verdad los bombos (grid desplazado si no coinciden)
const track = (id, title, bpm, fb, extra = {}) => ({
  id, path: `web:${title}.wav:${bpm}`, source: 'local', title, artist: 'Prueba', album: '', genre: 'House', year: '2026', comment: '', rating: 0,
  bpm, firstBeat: fb, bpmLocked: false, gridV: 2, key: '', camelot: '8A', duration: 90, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 6, sections: [], ...extra
});
const KICKS = { a: [124, 0.1], b: [128, 0.23], c: [126, 0.15], d: [100, 0.2], g: [125, 0.5], h: [125, 0.5] };
const seed = () => {
  const cues = Array(8).fill(null); cues[2] = { t: 8.0, color: '#ffd21a', name: 'Entrada' }; cues[0] = { t: 12.5, color: '#ff3b47', name: '' };
  return [
    track('a', 'Clic 124', 124, 0.1), track('b', 'Clic 128', 128, 0.23), track('c', 'Con cues 126', 126, 0.15, { cues }), track('d', 'Lento 100', 100, 0.2),
    // g: grid del análisis 20 ms por delante del bombo real · h: 45 ms por delante
    track('g', 'Grid desplazado', 125, 0.48), track('h', 'Grid muy desplazado', 125, 0.455)
  ];
};
const SETTINGS = { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9' };

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
async function point(win, sel) {
  const r = await js(win, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null; return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  if (!r || r.error) throw new Error('no encuentro (o no se ve) ' + sel);
  return r;
}
async function mouse(win, type, x, y, modifiers = []) { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers }); }
async function click(win, sel, modifiers = []) {
  const p = await point(win, sel);
  await mouse(win, 'mouseMove', p.x, p.y);
  await mouse(win, 'mouseDown', p.x, p.y, modifiers); await wait(40);
  await mouse(win, 'mouseUp', p.x, p.y, modifiers); await wait(250);
}
// Pistas de clics y su forma de onda; el AudioBuffer va a la caché de la app (loadToDeck no lee archivos)
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
  A.bufferCache.size; // (la app guarda 4; aquí se fija el tamaño para que no se vacíe)
  A.decode = async (t) => A.bufferCache.get(t.id);
  A.engine.setMaster(0.15);
  return Object.keys(K);
})()`;
const ST = `(() => { const A = nexuraApp; return A.decks.slice(0, 2).map((d, i) => ({ id: d.track && d.track.id, playing: d.playing, time: +d.time.toFixed(3), cue: +d.cuePoint.toFixed(3), sync: d.sync,
  bpm: +d.currentBpm.toFixed(3), range: d.range, syncBtn: A.deckUIs[i].syncBtn.classList.contains('on'), guard: (document.querySelector('#deck' + i + ' .load-guard') || {}).textContent || '' })); })()`;

const report = { ok: true, errors: [] };
const check = (name, cond, extra) => { if (!cond) report.ok = false; console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 600) : ''}`); };

async function boot(win, settings, withLib = true) {
  await load(win);
  await js(win, `localStorage.clear(); ${withLib ? `localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify({ version: 1, tracks: seed(), crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }))});` : ''} ${settings ? `localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(settings))});` : ''} true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
}
const reset = `(async () => { const A = nexuraApp; for (const d of A.decks) { if (d.playing) d.pause(); d.setSync(false); d.toggleGridEdit(false); }
  for (const d of A.decks) { d.eject(); d.setRange(0.08); d.resetTempo(); }
  A.engine.channels.forEach(c => c.set('fader', 1)); A.engine.setCrossfader(0.5); A._loadGuard = null;
  A.settings.loadProtect = 'block'; A.settings.loadStart = 'cue'; A.settings.syncOnLoad = true; A.settings.quantize = true;
  document.querySelectorAll('.load-guard').forEach(e => e.remove()); return true; })()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3 && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(message)) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });

  // ---------------------------------------------------------------- vista inicial
  await boot(win, null);
  let v = await js(win, `({ lib: document.body.classList.contains('view-lib'), view: nexuraApp.screenView })`);
  check('Instalación nueva (sin ajustes): arranca en la vista Biblioteca', v.lib && v.view === 'lib', v);
  await boot(win, { welcomeDone: true, screenView: 'mix', libView: 'all', lastVersion: '9.9.9' });
  v = await js(win, `({ lib: document.body.classList.contains('view-lib'), flag: nexuraApp.settings.viewDefaultV2 })`);
  check('Ajustes de antes (Mezcla guardada sin la marca): arranca en Biblioteca una vez', v.lib && v.flag === true, v);
  await js(win, `nexuraApp.setScreenView('mix'); true`);
  await wait(1200);
  await load(win); await wait(2500);
  v = await js(win, `({ lib: document.body.classList.contains('view-lib'), view: nexuraApp.screenView })`);
  check('…y si el usuario elige Mezcla, al volver a abrir se respeta su elección', !v.lib && v.view === 'mix', v);

  // ---------------------------------------------------------------- escenario principal (1920×1080, vista Mezcla)
  await boot(win, SETTINGS);
  const prep = await js(win, PREPARE(KICKS));
  check('Pistas de clics preparadas (sin música real)', Array.isArray(prep) && prep.length === 6, prep);
  await js(win, reset);

  // 2) al cargar: en pausa en el primer cue
  await js(win, `nexuraApp.loadToDeck('c', 0)`);
  await wait(500);
  let s = await js(win, ST);
  check('Al cargar (por defecto): no arranca y queda en pausa en el primer cue (8,0 s, el hot cue más temprano)', !s[0].playing && Math.abs(s[0].time - 8) < 0.02 && Math.abs(s[0].cue - 8) < 0.001, s[0]);
  await js(win, `nexuraApp.loadToDeck('a', 0)`);
  await wait(400);
  s = await js(win, ST);
  check('Tema sin cues: en pausa al principio', !s[0].playing && s[0].time < 0.02 && s[0].id === 'a', s[0]);

  // 1) aviso de carga: deck 1 sonando al aire
  await js(win, `nexuraApp.decks[0].play(); true`);
  await wait(500);
  const r1 = await js(win, `nexuraApp.loadToDeck('b', 0)`);
  await wait(300);
  s = await js(win, ST);
  check('Deck 1 sonando al aire: la carga se bloquea, sigue sonando el mismo tema', r1 === 'blocked' && s[0].id === 'a' && s[0].playing, { r1, s: s[0] });
  check('…y avisa: «El deck 1 está sonando al aire. Para cargar, pausa el deck o baja su fader»', /El deck 1 está sonando al aire\./.test(s[0].guard) && /pausa el deck o baja su fader/.test(s[0].guard), s[0].guard);
  await shot(win, 'aviso-carga-1920x1080');
  await click(win, '#deck0 .load-guard .lg-force');
  await wait(500);
  s = await js(win, ST);
  check('«Cargar igualmente»: carga el tema (y el aviso desaparece)', s[0].id === 'b' && !s[0].guard, s[0]);
  // repetir la carga antes de 2 s
  await js(win, `nexuraApp.decks[0].play(); true`); await wait(300);
  const r2 = await js(win, `nexuraApp.loadToDeck('a', 0)`);
  const r3 = await js(win, `nexuraApp.loadToDeck('a', 0)`);
  await wait(400);
  s = await js(win, ST);
  check('Repetir la carga antes de 2 s la fuerza', r2 === 'blocked' && r3 !== 'blocked' && s[0].id === 'a', { r2, r3, id: s[0].id });
  // MIDI: «Cargar pista seleccionada» dos veces
  await js(win, `nexuraApp.decks[0].play(); nexuraApp._loadGuard = null; nexuraApp.libraryUI.current = () => nexuraApp.library.get('b'); true`); await wait(300);
  await js(win, `nexuraApp.actions['deck1.load'].fn(true); true`); await wait(300);
  s = await js(win, ST);
  const midiBlocked = s[0].id === 'a' && /al aire/.test(s[0].guard);
  await js(win, `nexuraApp.actions['deck1.load'].fn(true); true`); await wait(500);
  s = await js(win, ST);
  check('Desde la controladora (MIDI «Cargar»): la 1.ª pulsación avisa y la 2.ª en 2 s carga', midiBlocked && s[0].id === 'b', { midiBlocked, id: s[0].id });
  // fader bajado o crossfader cerrado: carga sin aviso
  await js(win, `nexuraApp.decks[0].play(); nexuraApp._loadGuard = null; nexuraApp.engine.channels[0].set('fader', 0); true`); await wait(300);
  const r4 = await js(win, `nexuraApp.loadToDeck('a', 0)`); await wait(400);
  s = await js(win, ST);
  check('Con el fader del deck bajado se carga sin aviso (y no arranca solo)', r4 !== 'blocked' && s[0].id === 'a' && !s[0].playing && !s[0].guard, { r4, s: s[0] });
  await js(win, `nexuraApp.engine.channels[0].set('fader', 1); nexuraApp.engine.setCrossfader(1); nexuraApp.decks[0].play(); true`); await wait(300);
  const r5 = await js(win, `nexuraApp.loadToDeck('b', 0)`); await wait(400);
  s = await js(win, ST);
  check('Con el crossfader cerrado en su lado se carga sin aviso', r5 !== 'blocked' && s[0].id === 'b', { r5, id: s[0].id });
  await js(win, `nexuraApp.engine.setCrossfader(0.5); nexuraApp.settings.loadProtect = 'warn'; nexuraApp.decks[0].play(); true`); await wait(300);
  const r6 = await js(win, `nexuraApp.loadToDeck('a', 0)`); await wait(400);
  s = await js(win, ST);
  const toastWarn = await js(win, `[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`);
  check('«Solo avisar»: carga y avisa con un mensaje', r6 !== 'blocked' && s[0].id === 'a' && /sonaba al aire/.test(toastWarn), { r6, id: s[0].id, toastWarn });
  await js(win, `nexuraApp.settings.loadProtect = 'off'; nexuraApp.decks[0].play(); true`); await wait(300);
  const r7 = await js(win, `nexuraApp.loadToDeck('b', 0)`); await wait(400);
  s = await js(win, ST);
  check('«Desactivado»: carga sin aviso', r7 !== 'blocked' && s[0].id === 'b' && !s[0].guard, { r7, id: s[0].id });
  await js(win, `nexuraApp.settings.loadProtect = 'block'; nexuraApp.decks[0].play(); true`); await wait(300);
  const r8 = await js(win, `nexuraApp.loadToDeck('a', 0, { auto: true })`); await wait(400);
  s = await js(win, ST);
  check('Las cargas del Automix / Autoplay (auto) no se bloquean a sí mismas', r8 !== 'blocked' && s[0].id === 'a', { r8, id: s[0].id });
  // «Empieza a sonar»
  await js(win, `nexuraApp.settings.loadStart = 'play'; nexuraApp.engine.channels[0].set('fader', 0); nexuraApp.decks[0].play(); true`); await wait(300);
  await js(win, `nexuraApp.loadToDeck('b', 0)`); await wait(500);
  s = await js(win, ST);
  check('«Al cargar un tema: Empieza a sonar» (deck que sonaba con el fader bajado): entra sonando', s[0].id === 'b' && s[0].playing, s[0]);

  // 3) sincronizar al cargar
  await js(win, reset);
  await js(win, `nexuraApp.loadToDeck('a', 0)`); await wait(400);
  await js(win, `nexuraApp.loadToDeck('b', 1)`); await wait(400);
  s = await js(win, ST);
  check('Sin nada sonando, cargar no activa SYNC', !s[1].sync, s[1]);
  await js(win, `nexuraApp.decks[0].play(); true`); await wait(400);
  await js(win, `nexuraApp.loadToDeck('c', 1)`); await wait(600);
  s = await js(win, ST);
  check('Con el deck 1 sonando, el tema cargado en el deck 2 queda en SYNC (botón encendido) al mismo tempo (124)', s[1].sync && s[1].syncBtn && Math.abs(s[1].bpm - 124) < 0.01 && !s[1].playing, s[1]);
  await js(win, `nexuraApp.decks[1].play(); true`); await wait(1200);
  const ph = await js(win, `(() => { const p = nexuraApp.decks[1].phaseInfo(); return p ? +p.ms.toFixed(2) : null; })()`);
  check('…y al darle a play entra en fase (|desfase| < 5 ms)', ph != null && Math.abs(ph) < 5, { ph });
  await js(win, `nexuraApp.decks[1].pause(); nexuraApp.decks[1].setSync(false); true`);
  await js(win, `nexuraApp.loadToDeck('d', 1)`); await wait(600);
  s = await js(win, ST);
  check('Tema de 100 BPM con el maestro a 124 (24 %): el rango del pitch se amplía a ±50 % y queda en SYNC', s[1].sync && s[1].range === 0.5 && Math.abs(s[1].bpm - 124) < 0.01, s[1]);
  const bpmLock = await js(win, `(async () => { const A = nexuraApp; A.decks[1].setSync(false); A.library.update('b', { bpm: 130, bpmLocked: true }); await A.loadToDeck('b', 1); await new Promise(r => setTimeout(r, 400)); const d = A.decks[1]; return { sync: d.sync, trackBpm: d.track.bpm, tempo: +d.tempo.toFixed(4) }; })()`);
  check('Respeta el BPM fijado por el usuario (130 → tempo 124/130)', bpmLock.sync && bpmLock.trackBpm === 130 && Math.abs(bpmLock.tempo - 124 / 130) < 1e-3, bpmLock);
  await js(win, `nexuraApp.library.update('b', { bpm: 128, bpmLocked: false }); true`);

  // 7) pitch bend: ratón (mantener y soltar)
  await js(win, reset);
  await js(win, `nexuraApp.loadToDeck('a', 0)`); await wait(300);
  await js(win, `nexuraApp.decks[0].play(); true`); await wait(300);
  const bp = await point(win, '#deck0 .bend-mix .bend-plus');
  check('Botones BEND (− / +) visibles junto al pitch en la vista Mezcla', bp.w >= 20 && bp.h >= 22, bp);
  await mouse(win, 'mouseMove', bp.x, bp.y); await mouse(win, 'mouseDown', bp.x, bp.y);
  await wait(250);
  const b1 = await js(win, `nexuraApp.decks[0].bend`);
  await wait(1500);
  const b2 = await js(win, `nexuraApp.decks[0].bend`);
  await shot(win, 'bend-pulsado-1920x1080');
  await mouse(win, 'mouseUp', bp.x, bp.y); await wait(200);
  const b3 = await js(win, `({ bend: nexuraApp.decks[0].bend, tempo: nexuraApp.decks[0].tempo })`);
  check('Mantener BEND + con el ratón: acelera suave (≈ +1 %) y sube hasta +4 % en 1,5 s', b1 > 0.009 && b1 < 0.02 && Math.abs(b2 - 0.04) < 0.002, { b1, b2 });
  check('Al soltar vuelve a su tempo (bend 0, tempo sin cambiar)', b3.bend === 0 && b3.tempo === 1, b3);
  // táctil (CDP: toques de verdad)
  const bm = await point(win, '#deck0 .bend-mix .bend-minus');
  let touch = null;
  try {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bm.x, y: bm.y }] });
    await wait(700);
    const t1 = await js(win, `nexuraApp.decks[0].bend`);
    const menu = await js(win, `!!document.querySelector('.ctx.root')`);
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(200);
    const t2 = await js(win, `nexuraApp.decks[0].bend`);
    touch = { t1, t2, menu };
    await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    win.webContents.debugger.detach();
  } catch (e) { touch = { error: String(e.message || e) }; }
  check('Pantalla táctil: mantener BEND − con el dedo frena (y al levantarlo vuelve)', touch && touch.t1 < -0.009 && touch.t2 === 0 && !touch.menu, touch);
  const midiBend = await js(win, `(async () => { const A = nexuraApp, a = A.actions; a['deck1.bendplus'].fn(true); await new Promise(r => setTimeout(r, 200)); const on = A.decks[0].bend; a['deck1.bendplus'].fn(false); return { on, off: A.decks[0].bend, label: a['deck1.bendminus'].label + ' / ' + a['deck1.bendplus'].label }; })()`);
  check('MIDI «Pitch bend −» / «Pitch bend +»: mantener y soltar', midiBend.on > 0 && midiBend.off === 0 && /Pitch bend − \/ Pitch bend \+/.test(midiBend.label), midiBend);
  const keyBend = await js(win, `(async () => { const o = (code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); const u = (code) => document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    document.activeElement && document.activeElement.blur(); o('KeyA'); await new Promise(r => setTimeout(r, 150)); const on = nexuraApp.decks[0].bend; u('KeyA'); return { on, off: nexuraApp.decks[0].bend }; })()`);
  check('Teclado (A en el deck 1): bend − mientras se mantiene', keyBend.on < 0 && keyBend.off === 0, keyBend);
  // rueda del ratón sobre el plato sonando = nudge suave
  const nud = await js(win, `(() => { const d = nexuraApp.decks[0], sent = []; const o = d.send.bind(d); d.send = (m, tr) => { if (m.t === 'nudgeBy' || m.t === 'nudge') sent.push(m.t + ':' + (m.v / (m.t === 'nudgeBy' ? d.sr : 1)).toFixed(3)); return o(m, tr); };
    const c = document.querySelector('#deck0 .platter'), b = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: b.left + 50, clientY: b.top + 50, bubbles: true, cancelable: true }));
    d.jogTurn(20, 605); d.send = o; return sent; })()`);
  check('Rueda del ratón sobre el plato y jog con la música sonando: nudge suave', nud.some(x => /^nudgeBy:0\.01/.test(x)) && nud.some(x => /^nudge:/.test(x)), nud);

  // 4) editar grid (deck 2)
  await js(win, reset);
  await js(win, `nexuraApp.loadToDeck('g', 1)`); await wait(500);
  await click(win, '#deck1 .grid-edit-btn');
  await wait(300);
  let ge = await js(win, `(() => { const d = nexuraApp.decks[1]; return { on: !!d.gridEditing, cls: document.querySelector('#deck1').classList.contains('grid-editing'), rows: document.querySelectorAll('#deck1 .row.grid-edit:not(.hidden)').length, title: document.querySelector('#deck1 .grid-edit-btn').title, fb: d.track.firstBeat, locked: !!d.track.bpmLocked }; })()`);
  check('Botón «✎ EDITAR» (tooltip «Editar grid»): activa el modo de edición con sus dos filas', ge.on && ge.cls && ge.rows === 2 && /Editar grid/.test(ge.title), ge);
  await js(win, `nexuraApp.decks[1].seek(20.02); true`); await wait(300);
  await shot(win, 'editar-grid-1920x1080');
  // arrastrar la rejilla 12 px a la derecha sobre la onda de arriba del deck 2
  const wv = await point(win, '#wave1');
  const spp = await js(win, `(() => { const w = nexuraApp.waves[1]; return w.zoom * 1 / document.querySelector('#wave1').clientWidth; })()`);
  await mouse(win, 'mouseMove', wv.x, wv.y); await mouse(win, 'mouseDown', wv.x, wv.y);
  for (let k = 1; k <= 4; k++) { await mouse(win, 'mouseMove', wv.x + k * 3, wv.y); await wait(30); }
  await mouse(win, 'mouseUp', wv.x + 12, wv.y); await wait(300);
  const dr = await js(win, `(() => { const d = nexuraApp.decks[1]; return { fb: d.track.firstBeat, locked: !!d.track.bpmLocked, time: +d.time.toFixed(3), undo: d.gridUndo ? d.gridUndo.stack.length : 0, auto: d.track.gridAuto }; })()`);
  const moved = (((dr.fb - ge.fb) % (240 / 125)) + 240 / 125) % (240 / 125);
  check('Arrastrar la rejilla con el ratón: el grid se mueve lo arrastrado (12 px ≈ ' + (12 * spp * 1000).toFixed(1) + ' ms), la reproducción no', Math.abs(moved - 12 * spp) < 0.0015 && Math.abs(dr.time - 20.02) < 0.01 && dr.undo === 1, { moved, want: 12 * spp, dr });
  check('Lo editado queda como manual (bpmLocked) y se guarda el grid del análisis para volver a él', dr.locked && dr.auto && Math.abs(dr.auto.firstBeat - 0.48) < 1e-6, dr);
  // ◂ ▸: 1 ms, Mayús 10 ms, Ctrl ½ beat
  const fb0 = await js(win, `nexuraApp.decks[1].track.firstBeat`);
  await click(win, '#deck1 .row.grid-edit:not(.grid-here) .btn:nth-last-child(1)');
  const fb1 = await js(win, `nexuraApp.decks[1].track.firstBeat`);
  await click(win, '#deck1 .row.grid-edit:not(.grid-here) .btn:nth-last-child(1)', ['shift']);
  const fb2 = await js(win, `nexuraApp.decks[1].track.firstBeat`);
  await click(win, '#deck1 .row.grid-edit:not(.grid-here) .btn:nth-last-child(2)', ['control']);
  const fb3 = await js(win, `nexuraApp.decks[1].track.firstBeat`);
  const bar = 240 / 125, dif = (a, b) => { let x = (b - a) % bar; if (x > bar / 2) x -= bar; if (x < -bar / 2) x += bar; return x; };
  check('▸ = +1 ms exacto; Mayús+▸ = +10 ms; Ctrl+◂ = −½ beat', Math.abs(dif(fb0, fb1) - 0.001) < 1e-6 && Math.abs(dif(fb1, fb2) - 0.010) < 1e-6 && Math.abs(dif(fb2, fb3) + 0.24) < 1e-6, { d1: dif(fb0, fb1), d2: dif(fb1, fb2), d3: dif(fb2, fb3) });
  // BPM ±0,01 y ±0,1
  const bpms = await js(win, `(async () => { const d = nexuraApp.decks[1], out = [d.track.bpm]; const rows = document.querySelectorAll('#deck1 .row.grid-edit:not(.grid-here) .micro');
    for (const i of [3, 2, 0, 1]) { rows[i].click(); out.push(d.track.bpm); } return out; })()`);
  check('BPM del grid: +.1, +.01, −.1, −.01 (vuelve a 125)', JSON.stringify(bpms) === JSON.stringify([125, 125.1, 125.11, 125.01, 125]), bpms);
  // «1 aquí»: el beat 1 del compás en el cabezal
  await js(win, `nexuraApp.decks[1].seek(30.5); true`); await wait(200);
  await click(win, '#deck1 .grid-here .btn.primary');
  const one = await js(win, `(() => { const d = nexuraApp.decks[1], b = d.beatAt(30.5); return { b: +b.toFixed(6), mod4: ((Math.round(b) % 4) + 4) % 4, locked: d.track.bpmLocked }; })()`);
  check('«1 AQUÍ»: el beat 1 del compás cae justo en el cabezal (30,5 s)', Math.abs(one.b - Math.round(one.b)) < 1e-6 && one.mod4 === 0 && one.locked, one);
  const nr = await js(win, `(async () => { const { needsGrid } = await import('/js/analysis/analyzer.js'); const t = nexuraApp.decks[1].track; return { now: needsGrid(t), oldVersion: needsGrid({ ...t, gridV: 1 }) }; })()`);
  check('Un grid editado a mano nunca se recalcula solo (ni con un análisis de versión antigua)', nr.now === false && nr.oldVersion === false, nr);
  const un = await js(win, `(() => { const d = nexuraApp.decks[1], n = d.gridUndo.stack.length; d.undoGrid(); return { n, after: d.gridUndo.stack.length, fb: d.track.firstBeat }; })()`);
  check('Deshacer (↶) quita el último cambio', un.after === un.n - 1 && Math.abs(dif(fb3, un.fb)) < 1e-6, un);
  // volver al análisis (con confirmación)
  await js(win, `nexuraApp.restoreAnalysisGrid(nexuraApp.decks[1]); true`); await wait(300);
  await click(win, '.modal-foot .btn.primary'); await wait(400);
  const back = await js(win, `(() => { const t = nexuraApp.decks[1].track; return { fb: t.firstBeat, bpm: t.bpm, locked: !!t.bpmLocked }; })()`);
  check('«ANÁLISIS» (volver al análisis): grid del análisis (125 BPM, 0,48 s) y deja de estar fijado a mano', Math.abs(back.fb - 0.48) < 1e-9 && back.bpm === 125 && !back.locked, back);
  await click(win, '#deck1 .ge-done');
  ge = await js(win, `({ on: !!nexuraApp.decks[1].gridEditing, rows: document.querySelectorAll('#deck1 .row.grid-edit:not(.hidden)').length })`);
  check('✓ termina la edición del grid', !ge.on && ge.rows === 0, ge);

  // 4b) cues con Q y Mayús (grid 20 ms por delante del bombo: el cue va al bombo; 45 ms: a la línea)
  const cq = await js(win, `(async () => { const A = nexuraApp, d = A.decks[1], kick = (fb, b) => fb + b * 60 / 125;
    A.settings.quantize = true; d.setPadMode('hotcue');
    d.seek(kick(0.5, 16) + 0.08); await new Promise(r => setTimeout(r, 150));
    d.padDown(4); d.padUp(4); const q1 = d.track.cues[4].t;
    d.seek(kick(0.5, 32) + 0.08); await new Promise(r => setTimeout(r, 150));
    d.padDown(5, true); d.padUp(5); const free = d.track.cues[5].t, at = d.time;
    A.actions['deck2.cuefree'].fn(true); d.seek(kick(0.5, 40) + 0.05); await new Promise(r => setTimeout(r, 150)); d.padDown(6); d.padUp(6); A.actions['deck2.cuefree'].fn(false);
    const midi = d.track.cues[6].t, at2 = d.time;
    d.padDown(6, true); d.padUp(6); const deleted = !d.track.cues[6];
    await A.loadToDeck('h', 1); await new Promise(r => setTimeout(r, 300));
    const dh = A.decks[1]; dh.seek(kick(0.5, 16) + 0.08); await new Promise(r => setTimeout(r, 150));
    dh.padDown(4); dh.padUp(4); const q2 = dh.track.cues[4].t;
    A.settings.quantize = false; dh.seek(kick(0.5, 20) + 0.03); await new Promise(r => setTimeout(r, 150)); dh.padDown(5); dh.padUp(5); const noq = dh.track.cues[5].t, at3 = dh.time;
    A.settings.quantize = true;
    return { q1, kick16: kick(0.5, 16), line16: kick(0.48, 16), free, at, midi, at2, deleted, q2, line16h: kick(0.455, 16), noq, at3 }; })()`);
  check('Q activo, grid 20 ms desplazado: el cue se pega al ataque real del bombo (no a la línea del grid)', Math.abs(cq.q1 - cq.kick16) < 0.003, { cue: cq.q1, bombo: cq.kick16, linea: cq.line16 });
  check('Q activo, grid 45 ms desplazado (más de 30 ms): el cue va a la línea del grid', Math.abs(cq.q2 - cq.line16h) < 1e-6, { cue: cq.q2, linea: cq.line16h });
  check('Mayús + pad vacío con Q: el cue va justo donde está, sin cuantizar', Math.abs(cq.free - cq.at) < 0.002, cq);
  check('Acción MIDI «Cues sin cuantizar» (mantener): el cue va justo donde está', Math.abs(cq.midi - cq.at2) < 0.002, cq);
  check('Mayús + pad con cue: lo borra (como antes)', cq.deleted, cq);
  check('Sin Q: el cue va justo donde está', Math.abs(cq.noq - cq.at3) < 0.002, cq);
  const qt = await js(win, `document.querySelector('#deck0 .btn.q').title`);
  check('Tooltip de Q: explica el pegado al golpe (30 ms) y Mayús/Alt', /30 ms/.test(qt) && /Mayús o Alt/.test(qt), qt);

  // 5) salida de audio en caliente (dispositivo simulado)
  await js(win, reset);
  await js(win, `nexuraApp.loadToDeck('a', 0)`); await wait(300);
  await js(win, `nexuraApp.decks[0].play(); const F = nexuraApp.feedback, o = F.log.bind(F); nexuraApp.__logs = []; F.log = (l, s, m) => { nexuraApp.__logs.push(l + ' ' + s + ' ' + m); return o(l, s, m); }; true`); await wait(800);
  const sw = await js(win, `(async () => {
    const A = nexuraApp, E = A.engine, ctx = E.ctx, d = A.decks[0], calls = [];
    let fake = '';
    Object.defineProperty(ctx, 'sinkId', { configurable: true, get: () => fake });
    // dispositivo nuevo que deja el audio parado (como el fallo de Fran: silencio hasta reiniciar)
    ctx.setSinkId = async (id) => { calls.push(id); await new Promise(r => setTimeout(r, 120)); fake = id; await ctx.suspend(); };
    const t0 = d.time;
    A.settings.outputMode = 'stereo'; A.settings.masterDevice = 'altavoces-usb';
    await A.applyOutputs(true);
    await new Promise(r => setTimeout(r, 1500));
    const t1 = d.time, c0 = ctx.currentTime; await new Promise(r => setTimeout(r, 500));
    return { calls, state: ctx.state, advancing: ctx.currentTime > c0 + 0.3, playing: d.playing, t0: +t0.toFixed(2), t1: +t1.toFixed(2), mode: E.outputMode, sinks: E.sinkReport() };
  })()`);
  check('Cambiar de salida con la música sonando: se elige el dispositivo nuevo sin reiniciar', JSON.stringify(sw.calls) === '["altavoces-usb"]' && sw.mode === 'stereo', sw);
  check('…el audio vuelve a avanzar aunque el dispositivo lo parase (sin silencio permanente)', sw.state === 'running' && sw.advancing, sw);
  check('…y el deck sigue sonando desde donde iba (sin volver al principio)', sw.playing && sw.t1 > sw.t0 + 1, sw);
  const dup = await js(win, `(async () => {
    const A = nexuraApp, E = A.engine;
    // auriculares en el mismo dispositivo que el master → ni <audio> ni modo «separados»
    A.settings.outputMode = 'separate'; A.settings.cueDevice = 'altavoces-usb';
    await A.applyOutputs(true);
    const same = { mode: E.outputMode, side: E.sideSinks.size };
    A.settings.cueDevice = 'default'; A.settings.masterDevice = '';
    await A.applyOutputs(true);
    const def = { mode: E.outputMode, side: E.sideSinks.size };
    // dos montajes a la vez con auriculares en otro dispositivo: un solo <audio> abierto
    A.settings.cueDevice = 'cascos'; A.settings.masterDevice = 'altavoces-usb';
    await Promise.all([A.applyOutputs(true), A.applyOutputs(true), A.applyOutputs(true)]);
    await new Promise(r => setTimeout(r, 300));
    const sep = { mode: E.outputMode, side: E.sideSinks.size, report: E.sinkReport() };
    // «Automático»: 8 canales (tarjeta 7.1 / auriculares envolventes) → estéreo; 4 canales (controladora) → 4 canales
    A.settings.cueDevice = ''; A.settings.outputMode = 'auto';
    Object.defineProperty(E.ctx.destination, 'maxChannelCount', { configurable: true, get: () => 8 });
    await A.applyOutputs(true); const auto8 = E.outputMode;
    Object.defineProperty(E.ctx.destination, 'maxChannelCount', { configurable: true, get: () => 4 });
    let auto4; try { await A.applyOutputs(true); auto4 = E.outputMode; } catch (e) { auto4 = 'error: ' + e.message; }
    delete E.ctx.destination.maxChannelCount;
    A.settings.outputMode = 'stereo'; await A.applyOutputs(true);
    return { same, def, sep, auto8, auto4 };
  })()`);
  check('Auriculares en el mismo dispositivo que el master: no se abre otra salida (sin eco)', dup.same.mode === 'stereo' && dup.same.side === 0 && dup.def.mode === 'stereo' && dup.def.side === 0, dup);
  check('Varios cambios de salida a la vez: queda un solo <audio> de auriculares (antes podían quedar dos sonando)', dup.sep.mode === 'separate' && dup.sep.side === 1, dup.sep);
  const no4 = await js(win, `nexuraApp.__logs.some(l => /no admite 4/.test(l))`);
  check('«Automático» con un dispositivo de 8 canales (7.1 / envolvente): solo master en estéreo', dup.auto8 === 'stereo', { auto8: dup.auto8 });
  check('Un dispositivo que dice tener 4 canales pero no los admite: estéreo sin quedarse a medio montar (antes: silencio)', dup.auto4 === 'stereo' && no4, { auto4: dup.auto4, no4 });
  const dev = await js(win, `(async () => {
    const A = nexuraApp, E = A.engine, calls = []; const o = E.ctx.setSinkId; E.ctx.setSinkId = async (id) => { calls.push(id); return o(id); };
    const d = A.decks[0]; if (!d.playing) d.play();
    const lost = await E.onDevicesChanged([{ id: 'default', label: 'Predeterminado' }]);
    await new Promise(r => setTimeout(r, 2200));
    const mid = { sink: E.currentSink(), playing: d.playing, state: E.ctx.state };
    const back = await E.onDevicesChanged([{ id: 'default', label: 'Predeterminado' }, { id: 'altavoces-usb', label: 'Altavoces USB' }]);
    await new Promise(r => setTimeout(r, 2200));
    const t0 = d.time; await new Promise(r => setTimeout(r, 500));
    return { lost, back, calls, mid, end: { sink: E.currentSink(), playing: d.playing, state: E.ctx.state, advancing: d.time > t0 + 0.3 }, setting: A.settings.masterDevice };
  })()`);
  check('Dispositivo desconectado: sigue sonando por el predeterminado; al volver, vuelve a él (sin reiniciar)', dev.lost === 'lost' && dev.back === 'back' && JSON.stringify(dev.calls) === '["","altavoces-usb"]' && dev.mid.playing && dev.end.sink === 'altavoces-usb' && dev.end.advancing && dev.setting === 'altavoces-usb', dev);
  const logTxt = await js(win, `nexuraApp.__logs.join('\\n')`);
  check('Registro técnico: anota las salidas abiertas («Salidas abiertas: AudioContext → …»), el cambio y la desconexión', /Salidas abiertas: AudioContext/.test(logTxt) && /<audio> auriculares/.test(logTxt) && /desconectado/.test(logTxt), String(logTxt).slice(0, 600));
  await js(win, `nexuraApp.decks[0].pause(); true`);
  await js(win, `nexuraApp.loadToDeck('g', 1)`); await wait(300);

  // 8) pestañas de los modos de pad y capturas de cada vista
  for (const [w, h] of [[1920, 1080], [1280, 800]]) {
    const tag = `${w}x${h}`;
    win.setContentSize(w, h); await wait(600);
    if (w === 1280) {
      // capturas del aviso y del modo de edición también a 1280×800
      await js(win, reset);
      await js(win, `nexuraApp.loadToDeck('a', 0)`); await js(win, `nexuraApp.loadToDeck('g', 1)`); await wait(400);
      await js(win, `nexuraApp.decks[0].play(); true`); await wait(300);
      await js(win, `nexuraApp.loadToDeck('b', 0)`); await wait(400);
      await shot(win, `aviso-carga-${tag}`);
      await js(win, `document.querySelectorAll('.load-guard').forEach(e => e.remove()); nexuraApp.decks[0].pause(); nexuraApp.decks[1].toggleGridEdit(true); nexuraApp.decks[1].seek(20.02); true`); await wait(400);
      await shot(win, `editar-grid-${tag}`);
      const fit = await js(win, `[...document.querySelectorAll('#deck1 .row.grid-edit:not(.hidden), #deck1 .row.grid')].map(r => ({ over: r.scrollWidth - r.clientWidth, h: Math.round(r.getBoundingClientRect().height) }))`);
      check(`${tag} · filas del modo Editar grid sin desbordar`, fit.every(r => r.over <= 1), fit);
      await js(win, `nexuraApp.decks[1].toggleGridEdit(false); true`);
      const bpx = await point(win, '#deck0 .bend-mix .bend-plus');
      await mouse(win, 'mouseMove', bpx.x, bpx.y); await mouse(win, 'mouseDown', bpx.x, bpx.y); await wait(400);
      await shot(win, `bend-pulsado-${tag}`);
      await mouse(win, 'mouseUp', bpx.x, bpx.y); await wait(200);
    }
    for (const view of ['mix', 'lib']) {
      await js(win, `nexuraApp.setScreenView('${view}', false); true`); await wait(500);
      const tabs = await js(win, `[...document.querySelectorAll('#deck0 .pad-tab, #deck1 .pad-tab')].map(t => { const s = [...t.children].find(c => getComputedStyle(c).display !== 'none'); return { txt: s ? s.textContent : '', over: t.scrollWidth - t.clientWidth, w: Math.round(t.clientWidth), title: t.title }; })`);
      check(`${tag} · ${view === 'mix' ? 'Mezcla' : 'Biblioteca'} · pestañas de pad legibles, sin cortar («Saved Lo…», «Pitch P…») y con el nombre completo en el tooltip`, tabs.length === 18 && tabs.every(t => t.over <= 0 && t.txt && /Modo de pads: /.test(t.title)), tabs.filter(t => t.over > 0 || !t.txt));
      if (view === 'lib') {
        const bl = await js(win, `(() => { const b = document.querySelector('#deck0 .bend-lib .bend-plus').getBoundingClientRect(); const g = document.querySelector('#deck0 .grid-head-btn').getBoundingClientRect(); return { bw: Math.round(b.width), bh: Math.round(b.height), gw: Math.round(g.width), bottom: b.bottom <= innerHeight }; })()`);
        check(`${tag} · vista Biblioteca: BEND − / + junto a CUE · PLAY · SYNC y botón «✎ GRID» junto al BPM`, bl.bw >= 20 && bl.bh >= 22 && bl.gw > 20 && bl.bottom, bl);
        await shot(win, `pestanas-bend-biblioteca-${tag}`);
        await js(win, `nexuraApp.decks[1].toggleGridEdit(true); true`); await wait(300);
        const libFit = await js(win, `[...document.querySelectorAll('#deck1 .row.grid-edit:not(.hidden)')].map(r => ({ over: r.scrollWidth - r.clientWidth, vis: r.getBoundingClientRect().height > 0 }))`);
        check(`${tag} · vista Biblioteca: el modo Editar grid se ve en el deck (en lugar de los pads)`, libFit.length === 2 && libFit.every(r => r.vis && r.over <= 1), libFit);
        await shot(win, `editar-grid-biblioteca-${tag}`);
        await js(win, `nexuraApp.decks[1].toggleGridEdit(false); true`);
      } else await shot(win, `pestanas-bend-mezcla-${tag}`);
    }
    await js(win, `nexuraApp.setScreenView('mix', false); true`);
    // ajustes nuevos (Reproducción → Al cargar un tema)
    await js(win, `nexuraApp.settingsUI.open('play'); true`); await wait(500);
    const sets = await js(win, `({ p: !!document.querySelector('#set-load-protect'), s: !!document.querySelector('#set-load-start'), y: !!document.querySelector('#set-sync-load'),
      opts: [...document.querySelectorAll('#set-load-protect option, #set-load-start option')].map(o => o.textContent), def: [document.querySelector('#set-load-protect').value, document.querySelector('#set-load-start').value, document.querySelector('#set-sync-load').checked] })`);
    if (w === 1920) check('Ajustes → Reproducción: «Proteger el deck que suena al cargar», «Al cargar un tema» y «Sincronizar al cargar»', sets.p && sets.s && sets.y && sets.opts.join('|') === 'Bloquear y avisar (recomendado)|Solo avisar|Desactivado|Queda en pausa en el primer cue|Empieza a sonar', sets);
    await shot(win, `ajustes-al-cargar-${tag}`);
    await js(win, `nexuraApp.closeModal(); true`);
  }
  const defs = await js(win, `(async () => { localStorage.removeItem('nexura_settings'); return true; })()`);
  await boot(win, null);
  const d0 = await js(win, `({ p: nexuraApp.settings.loadProtect, s: nexuraApp.settings.loadStart, y: nexuraApp.settings.syncOnLoad })`);
  check('Valores por defecto: Bloquear y avisar · En pausa en el primer cue · Sincronizar al cargar activado', defs && d0.p === 'block' && d0.s === 'cue' && d0.y === true, d0);

  if (report.errors.length) console.log('Errores de consola:', report.errors.slice(0, 10).join(' | '));
  check('Sin errores en la consola', report.errors.length === 0, report.errors.slice(0, 5));
  console.log(report.ok ? 'FRAN5: todo correcto' : 'FRAN5: hay fallos');
  app.exit(report.ok ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
