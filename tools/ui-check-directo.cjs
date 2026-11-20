// Encargo DIRECTO (1.0.0-rc.10) con Electron contra `npm run web` (puerto 5180). Pistas de clics simuladas por un
// preload de prueba (tools/ui-directo-preload.cjs: siguen «en el disco» al recargar la página).
// - Modo sesión en directo: se activa con un deck al aire; avisos de fondo aplazados (y los críticos, no); aviso de
//   actualización oculto y sin descarga; análisis automático en pausa; al terminar, salen los avisos; botón a mano.
// - Estado para el proceso principal (suena música / sesión): la confirmación al cerrar se prueba en
//   ui-check-cierre-escritorio.cjs con la app de escritorio.
// - Recuperación: cierre sin la marca → aviso; «Recuperar» = mismos temas, en pausa, en su posición; pista que ya no
//   existe; «Descartar».
// - Latencia: Baja / Equilibrada / Segura; cambio sin música (se vuelve a montar sin perder posición) y con música
//   (se espera a pararla).
// - Medidor de carga: carga real del worklet (con «burn», que ocupa el hilo de audio), cortes simulados → aviso con
//   «Subir latencia a Segura» y ondas a menos fps; vuelve a la normalidad al pasar el pico.
// Capturas a 1920×1080 y 1280×800 en .revision/capturas-directo/ (o NEXURA_SHOTS). Uso: npx electron tools/ui-check-directo.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = process.env.NEXURA_SHOTS || path.join(__dirname, '..', '..', 'nexura-dj-studio', '.revision', 'capturas-directo');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, title, bpm, extra = {}) => ({
  id, path: `web:${title}.wav:${bpm}`, source: 'local', title, artist: 'Prueba', album: '', genre: 'House', year: '2026', comment: '', rating: 0,
  bpm, firstBeat: 0.1, bpmLocked: true, gridV: 2, key: 'Am', camelot: '8A', keyTonic: 9, keyMinor: true, keyV: 2, keyLocked: false, duration: 40, size: 1, rmsDb: -10,
  cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 6, sections: [], ...extra
});
const seed = () => [track('a', 'Clic 124', 124), track('b', 'Clic 128', 128), track('c', 'Clic 126', 126)];
const SETTINGS = { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9', aiAutoCues: false, stemsBackground: false };

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(600);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
const report = { ok: true, errors: [] };
const check = (name, cond, extra) => { if (!cond) report.ok = false; console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 700) : ''}`); };
const waitFor = async (win, code, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await js(win, code); if (v && !v.error) return v; await wait(200); } return js(win, code); };
// arranque limpio con la biblioteca y los ajustes de prueba
async function boot(win, settings = SETTINGS, keepSession = false) {
  await load(win);
  await js(win, `(() => { const s = localStorage.getItem('nexura_sesion'); localStorage.clear(); ${keepSession ? "if (s) localStorage.setItem('nexura_sesion', s);" : ''}
    localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify({ version: 1, tracks: seed(), crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }))});
    localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(settings))}); return true; })()`);
  await reload(win);
}
// recarga sin «cierre limpio» (como si la app se hubiera cerrado de golpe) o normal
async function reload(win, crash = false) {
  if (crash) await js(win, `nexuraApp._reloading = true; true`);
  await load(win);
  await waitFor(win, `window.nexuraApp && nexuraApp.session && nexuraApp.sessionReady ? nexuraApp.sessionReady.then(() => true) : null`, 15000);
  await wait(800);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
}
// la app se recarga sola para aplicar la latencia: se espera a que vuelva con la latencia nueva
async function selfReload(win, lat) {
  await waitFor(win, `window.nexuraApp && nexuraApp.engine && nexuraApp.engine.latency === '${lat}' && nexuraApp.sessionReady ? nexuraApp.sessionReady.then(() => true) : null`, 20000);
  await wait(1500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); nexuraApp.engine.resume(); true`);
}
const ST = `(() => { const A = nexuraApp; return A.decks.slice(0, 2).map(d => ({ id: d.track && d.track.id, playing: d.playing, time: +d.time.toFixed(3), cue: +d.cuePoint.toFixed(3), pitch: +d.pitch.toFixed(3), keylock: d.keylock, sync: d.sync, loop: d.loop.on ? [+d.loop.s.toFixed(2), +d.loop.e.toFixed(2)] : null })); })()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false, offscreen: true, contextIsolation: false, preload: path.join(__dirname, 'ui-directo-preload.cjs') } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3 && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(message)) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  try {
    // ------------------------------------------------------------------ modo sesión en directo
    await boot(win);
    let v = await js(win, `({ btn: !!document.querySelector('#live-btn'), on: document.body.classList.contains('live-on'), pill: (document.querySelector('#load-pill') || {}).textContent, mode: nexuraApp.settings.liveMode, lat: nexuraApp.settings.latency })`);
    check('Barra superior: botón «EN DIRECTO» apagado y medidor «CPU», ajustes por defecto Automático y Equilibrada', v.btn && !v.on && /^CPU/.test(v.pill) && v.mode === 'auto' && v.lat === 'normal', v);
    await js(win, `(async () => { const A = nexuraApp; await A.loadToDeck('a', 0); A.engine.setMaster(0.1); A.decks[0].play(); return true; })()`);
    v = await waitFor(win, `nexuraApp.live.active ? { on: document.body.classList.contains('live-on'), btn: document.querySelector('#live-btn').classList.contains('on'), state: window.__nexuraLiveState } : null`);
    check('Un deck sonando al aire → «EN DIRECTO» encendido solo', v && v.on && v.btn, v);
    check('Estado para el proceso principal: suena música y hay sesión (confirmación al cerrar, actualizador en pausa)', v && v.state && v.state.playing && v.state.live, v);
    v = await js(win, `(async () => { const { toast } = await import('/js/util.js'); toast('Aviso de fondo de prueba', 'ok', 4000, null, { kind: 'bg' }); toast('Aviso crítico de prueba', 'error', 4000, null, { kind: 'critical' });
      await new Promise(r => setTimeout(r, 300)); const t = [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent); return { bg: t.some(x => /fondo de prueba/.test(x)), crit: t.some(x => /crítico de prueba/.test(x)), q: nexuraApp.live.queue.size, btn: document.querySelector('#live-btn').textContent }; })()`);
    check('En directo: el aviso de fondo no sale (se guarda) y el crítico sí', !v.bg && v.crit && v.q >= 1 && /EN DIRECTO · \d/.test(v.btn), v);
    v = await js(win, `(async () => { const U = nexuraApp.updatesUI; U.onEvent({ state: 'available', version: '9.9.9', notes: ['Prueba'] }); const r = await U.download(); return { ind: U.ind.hidden, top: U.topBtn.hidden, dl: r, state: U.state.state }; })()`);
    check('En directo: el aviso de actualización no se ve y no se descarga nada', v.ind && v.top && v.dl === false && v.state === 'available', v);
    v = await js(win, `({ auto: nexuraApp.analysisHold(true), user: nexuraApp.analysisHold(false), stems: nexuraApp.live.holdBackground() })`);
    check('En directo: el análisis automático (tras importar) y los stems en segundo plano esperan; el que pides tú, no', v.auto && !v.user && v.stems, v);
    v = await js(win, `(() => { nexuraApp.onControllerDetected({ name: 'Controladora X', info: { type: 'ninguno', custom: 0 } }); return { box: !!document.querySelector('.ctl-notice'), q: nexuraApp.live.queue.size }; })()`);
    check('En directo: el aviso de controladora nueva espera al final de la sesión', !v.box && v.q >= 2, v);
    await shot(win, 'en-directo-1920x1080');
    // termina: deck en pausa y (para la prueba) fin de sesión a los 1,5 s en vez de 2 min
    await js(win, `nexuraApp.live.state.endAfter = 1500; nexuraApp.decks[0].pause(); true`);
    v = await waitFor(win, `!nexuraApp.live.active ? true : null`, 6000);
    await wait(1500);
    v = await js(win, `({ on: nexuraApp.live.active, bg: [...document.querySelectorAll('#toasts .toast')].some(x => /fondo de prueba/.test(x.textContent)), upd: !nexuraApp.updatesUI.ind.hidden, ctl: !!document.querySelector('.ctl-notice'), q: nexuraApp.live.queue.size })`);
    check('Al terminar la sesión (sin nada al aire) salen los avisos aplazados, el de actualización y el de la controladora', !v.on && v.bg && v.upd && v.ctl && v.q === 0, v);
    await js(win, `document.querySelectorAll('.ctl-notice').forEach(e => e.remove()); nexuraApp.updatesUI.later(); nexuraApp.live.state.endAfter = 120000; true`);
    await js(win, `document.querySelector('#live-btn').click(); true`); await wait(300);
    v = await js(win, `({ on: nexuraApp.live.active, cls: document.querySelector('#live-btn').classList.contains('on'), title: document.querySelector('#live-btn').title })`);
    check('Botón a mano: lo activa sin música (con tooltip)', v.on && v.cls && /Sesión en directo/.test(v.title), v);
    await js(win, `document.querySelector('#live-btn').click(); true`); await wait(300);
    check('Botón a mano: lo desactiva', !(await js(win, `nexuraApp.live.active`)));
    await js(win, `nexuraApp.setSetting('liveMode', 'off'); nexuraApp.decks[0].play(); true`); await wait(1200);
    check('Ajuste «Desactivado»: con música sonando no se activa', !(await js(win, `nexuraApp.live.active`)));
    await js(win, `nexuraApp.setSetting('liveMode', 'on'); nexuraApp.decks[0].pause(); true`); await wait(800);
    check('Ajuste «Siempre activado»: activo aunque no suene nada', await js(win, `nexuraApp.live.active`));
    await js(win, `nexuraApp.setSetting('liveMode', 'auto'); true`);

    // ------------------------------------------------------------------ recuperación
    await js(win, `(async () => { const A = nexuraApp; await A.loadToDeck('b', 1); const d0 = A.decks[0], d1 = A.decks[1];
      d0.seek(20.5); d0.setPitchFader(0.25); if (!d0.keylock) d0.toggleKeylock(); d1.seek(31.25); d1.setLoop(32, 34, true); d0.play(); d1.play(); return true; })()`);
    await wait(2600); // la instantánea se guarda cada 2 s
    const before = await js(win, ST);
    await reload(win, true); // cierre de golpe: sin la marca de cierre limpio
    v = await waitFor(win, `document.querySelector('#recover-card') ? { text: document.querySelector('#recover-card').textContent, tracks: nexuraApp.decks.filter(d => d.track).length } : null`);
    check('Tras un cierre inesperado: «La última sesión se cerró de forma inesperada. ¿Recuperarla?» (sin cargar nada aún)', v && /se cerró de forma inesperada/.test(v.text) && /2 temas en los decks 1 y 2/.test(v.text) && v.tracks === 0, v);
    await shot(win, 'recuperar-1920x1080');
    await js(win, `document.querySelector('#recover-card .rec-yes').click(); true`);
    await waitFor(win, `nexuraApp.decks[0].track && nexuraApp.decks[1].track ? true : null`, 15000); await wait(1500);
    v = await js(win, ST);
    check(`«Recuperar»: mismos temas en sus decks y en su posición (${before[0].time} → ${v && v[0].time} · ${before[1].time} → ${v && v[1].time})`, v && v[0].id === 'a' && v[1].id === 'b' && Math.abs(v[0].time - before[0].time) < 3 && Math.abs(v[1].time - before[1].time) < 3, { before, v });
    check('«Recuperar»: EN PAUSA (no suena nada solo), con pitch, key lock y loop', v && !v[0].playing && !v[1].playing && Math.abs(v[0].pitch - 0.25) < 0.01 && v[0].keylock && v[1].loop && v[1].loop[0] === 32, v);
    await wait(1500);
    check('…y siguen en pausa al cabo de un rato', (await js(win, `nexuraApp.decks.every(d => !d.playing)`)) === true);
    // pista que ya no existe: se borra de la biblioteca antes de «arrancar»
    await wait(2300);
    await reload(win, true);
    await js(win, `(() => { const L = nexuraApp.library; L.tracks.delete('b'); return true; })()`);
    v = await waitFor(win, `document.querySelector('#recover-card') ? document.querySelector('#recover-card').textContent : null`);
    await js(win, `document.querySelector('#recover-card .rec-yes').click(); true`);
    const lost = await waitFor(win, `(() => { const t = [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent).join(' | '); return nexuraApp.decks[0].track && /No se ha podido recuperar el deck 2/.test(t) ? { t, d0: nexuraApp.decks[0].track.id, d1: nexuraApp.decks[1].track } : null; })()`, 15000);
    check('Pista que ya no existe: se indica y el resto se recupera igual', lost && lost.d0 === 'a' && !lost.d1, { v, lost });
    // «Descartar»
    await wait(2300);
    await reload(win, true);
    v = await waitFor(win, `document.querySelector('#recover-card') ? true : null`);
    await js(win, `document.querySelector('#recover-card .rec-no').click(); true`);
    await wait(1500);
    v = await js(win, `({ card: !!document.querySelector('#recover-card'), tracks: nexuraApp.decks.filter(d => d.track).length })`);
    check('«Descartar»: no se recupera nada', !v.card && v.tracks === 0, v);
    await reload(win, true);
    await wait(1200);
    check('Y al volver a arrancar ya no se ofrece (no había temas)', !(await js(win, `!!document.querySelector('#recover-card')`)));
    // cierre limpio: no se ofrece
    await js(win, `(async () => { await nexuraApp.loadToDeck('a', 0); return true; })()`); await wait(2300);
    await reload(win, false);
    check('Cierre normal (marca de cierre limpio): no se ofrece recuperar', !(await js(win, `!!document.querySelector('#recover-card')`)));

    // ------------------------------------------------------------------ latencia
    await js(win, `(async () => { const A = nexuraApp; if (!A.decks[0].track) await A.loadToDeck('a', 0); A.decks[0].seek(15.5); return true; })()`);
    await wait(300);
    const lat0 = await js(win, `({ lat: nexuraApp.engine.latency, real: nexuraApp.engine.ctx.baseLatency })`);
    await js(win, `nexuraApp.setLatency('safe'); true`);
    await selfReload(win, 'safe');
    v = await waitFor(win, `nexuraApp.decks[0].track ? { lat: nexuraApp.engine.latency, set: nexuraApp.settings.latency, base: nexuraApp.engine.ctx.baseLatency, t: +nexuraApp.decks[0].time.toFixed(2), playing: nexuraApp.decks[0].playing, card: !!document.querySelector('#recover-card') } : null`, 15000);
    check(`Latencia «Segura» sin música: se aplica al momento (base ${lat0.real} → ${v && v.base} s) y el deck sigue en su sitio (15,5 → ${v && v.t}), en pausa, sin preguntar`, v && v.lat === 'safe' && v.set === 'safe' && v.base > lat0.real && Math.abs(v.t - 15.5) < 0.1 && !v.playing && !v.card, { lat0, v });
    // con música: no corta; se aplica al pararla
    await js(win, `nexuraApp.decks[0].play(); true`); await wait(500);
    v = await js(win, `(async () => { const r = await nexuraApp.setLatency('low'); return { r, lat: nexuraApp.engine.latency, t: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent).join(' | ') }; })()`);
    check('Latencia con música sonando: no corta, avisa y espera («se aplicará cuando pares la música»)', v.r === 'pending' && v.lat === 'safe' && /cuando pares la música/.test(v.t), v);
    await js(win, `nexuraApp.decks[0].pause(); nexuraApp.decks[0].seek(22); true`);
    await selfReload(win, 'low');
    v = await waitFor(win, `nexuraApp.decks[0].track ? { lat: nexuraApp.engine.latency, t: +nexuraApp.decks[0].time.toFixed(2) } : null`, 15000);
    check(`…al pararla se aplica (Baja) sin perder la posición (22 → ${v && v.t})`, v && v.lat === 'low' && Math.abs(v.t - 22) < 0.2, v);
    await js(win, `nexuraApp.setLatency('normal'); true`); await selfReload(win, 'normal');
    v = await waitFor(win, `nexuraApp.engine.latency === 'normal' ? true : null`, 15000);
    check('Latencia «Equilibrada» otra vez', v === true);
    await js(win, `nexuraApp.settingsUI.open('audio'); true`); await wait(1200);
    v = await js(win, `({ sel: document.querySelector('#set-latency') && [...document.querySelector('#set-latency').options].map(o => o.textContent), real: (document.querySelector('#set-latency-real') || {}).textContent })`);
    check('Ajustes → Audio → Latencia: Baja, Equilibrada y Segura con la latencia real medida', v.sel && v.sel.length === 3 && /Baja/.test(v.sel[0]) && /Equilibrada/.test(v.sel[1]) && /Segura/.test(v.sel[2]) && /latencia real medida: \d/.test(v.real), v);
    await js(win, `document.querySelector('#set-latency').scrollIntoView({ block: 'center' }); true`);
    await shot(win, 'ajuste-latencia-1920x1080');
    await js(win, `nexuraApp.closeModal(); true`); await wait(400);

    // ------------------------------------------------------------------ medidor de carga y cortes
    await js(win, `(async () => { const A = nexuraApp; if (!A.decks[1].track) await A.loadToDeck('b', 1); A.decks[0].play(); A.decks[1].play(); return true; })()`);
    await wait(2500);
    const idle = await js(win, `({ load: nexuraApp.loadMeter.load, pill: document.querySelector('#load-pill').textContent, glitches: nexuraApp.loadMeter.glitches.length })`);
    check(`Medidor con dos decks sonando: ${idle.pill} (carga real del worklet > 0)`, idle.load > 0 && /CPU (<1|\d+) %/.test(idle.pill), idle);
    // carga alta de verdad en el hilo de audio (burn: cada bloque tarda más)
    const blockMs = await js(win, `128 / nexuraApp.engine.ctx.sampleRate * 1000`);
    await js(win, `nexuraApp.decks[0].send({ t: 'burn', v: ${(blockMs * 0.42).toFixed(3)} }); nexuraApp.decks[1].send({ t: 'burn', v: ${(blockMs * 0.42).toFixed(3)} }); true`);
    v = await waitFor(win, `nexuraApp.loadMeter.overloaded && nexuraApp.loadMeter.load > 0.7 ? { load: nexuraApp.loadMeter.load, cls: document.querySelector('#load-pill').className, pill: document.querySelector('#load-pill').textContent, notice: (document.querySelector('#load-notice') || {}).textContent, reduced: nexuraApp.loadReduced, hold: nexuraApp.analysisHold(false) } : null`, 15000);
    if (!v || v.error) console.log('  carga medida:', JSON.stringify(await js(win, `({ load: nexuraApp.loadMeter.load, decks: [...nexuraApp.loadMeter.decks.entries()] })`)));
    check(`Carga del audio > 70 % (${v && v.pill}): medidor en rojo, aviso con «Subir latencia a Segura», ondas a menos fps y análisis en pausa`, v && v.load > 0.7 && /red/.test(v.cls) && /Subir latencia a Segura/.test(v.notice) && v.reduced && v.hold, v);
    await js(win, `(() => { const p = document.querySelector('#load-pill'); p.dispatchEvent(new MouseEvent('mouseenter')); return true; })()`);
    await wait(700);
    v = await js(win, `({ pop: !document.querySelector('#load-pop').hidden, text: document.querySelector('#load-pop').textContent })`);
    check('Tooltip del medidor: carga del audio, cortes, fps de la interfaz y latencia real', v.pop && /Carga del audio/.test(v.text) && /Cortes de audio/.test(v.text) && /fps/.test(v.text) && /real \d/.test(v.text), v);
    await shot(win, 'medidor-tooltip-aviso-1920x1080');
    await js(win, `document.querySelector('#load-pill').dispatchEvent(new MouseEvent('mouseleave')); nexuraApp.decks.forEach(d => d.send({ t: 'burn', v: 0 })); true`);
    v = await waitFor(win, `!nexuraApp.loadMeter.overloaded && !/red/.test(document.querySelector('#load-pill').className) ? { reduced: nexuraApp.loadReduced, pill: document.querySelector('#load-pill').className } : null`, 50000);
    check('Al pasar el pico (15 s tranquilo) todo vuelve a la normalidad', v && !v.reduced && !/red/.test(v.pill), v);
    // cortes simulados (el reloj del audio se queda atrás)
    v = await js(win, `(() => { nexuraApp.loadUI.simulateGlitch(60); nexuraApp.loadUI.tick(); return { g: nexuraApp.loadMeter.glitches.length, over: nexuraApp.loadMeter.overloaded, notice: (document.querySelector('#load-notice') || {}).textContent, reduced: nexuraApp.loadReduced }; })()`);
    check('Corte simulado: se cuenta, avisa («Cortes de audio») y baja los fps', v.g >= 1 && v.over && /Cortes de audio/.test(v.notice) && v.reduced, v);
    v = await js(win, `nexuraApp.perfDiag.snapshot().audio`);
    check('Diagnóstico del informe: latencia elegida y real, carga máxima y cortes con cuándo', v && v.latency === 'normal' && v.realMs > 0 && v.load && v.load.peakPct > 70 && v.load.glitches >= 1 && v.load.glitchTimes.length >= 1, v);
    await shot(win, 'aviso-cortes-1920x1080');
    // 1280×800
    win.setContentSize(1280, 800); await wait(1200);
    await shot(win, 'aviso-cortes-1280x800');
    await js(win, `document.querySelector('#load-pill').dispatchEvent(new MouseEvent('mouseenter')); true`); await wait(500);
    await shot(win, 'medidor-tooltip-1280x800');
    await js(win, `document.querySelector('#load-pill').dispatchEvent(new MouseEvent('mouseleave')); true`);
    v = await js(win, `(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; const tb = document.querySelector('#topbar').getBoundingClientRect(); return { live: r('#live-btn'), pill: r('#load-pill'), topbarH: Math.round(tb.height), over: document.querySelector('#top-right').scrollWidth > document.querySelector('#top-right').clientWidth + 1, right: Math.round(Math.max(...[...document.querySelectorAll('#top-right > *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().right))) }; })()`);
    check('1280×800: «EN DIRECTO» y «CPU» se ven en la barra superior sin desbordarla', v.live && v.pill && v.live[2] <= 1280 && v.pill[2] <= 1280 && v.right <= 1280, v);
    await js(win, `if (!nexuraApp.live.active) document.querySelector('#live-btn').click(); true`); await wait(400);
    check('1280×800: «● DIRECTO» encendido', await js(win, `nexuraApp.live.active && document.querySelector('#live-btn').classList.contains('on')`));
    await shot(win, 'en-directo-1280x800');
    await js(win, `nexuraApp.decks.forEach(d => d.pause()); true`);
    await wait(2300);
    await reload(win, true);
    await waitFor(win, `document.querySelector('#recover-card') ? true : null`);
    await shot(win, 'recuperar-1280x800');
    await js(win, `document.querySelector('#recover-card .rec-no').click(); nexuraApp.settingsUI.open('audio'); true`); await wait(1200);
    await js(win, `document.querySelector('#set-latency').scrollIntoView({ block: 'center' }); true`);
    await shot(win, 'ajuste-latencia-1280x800');
    await js(win, `nexuraApp.closeModal(); nexuraApp.settingsUI.open('play'); true`); await wait(1000);
    v = await js(win, `({ sel: document.querySelector('#set-live-mode') && [...document.querySelector('#set-live-mode').options].map(o => o.textContent) })`);
    check('Ajustes → Reproducción: «Modo sesión en directo» Automático / Siempre activado / Desactivado', v.sel && v.sel.join('|') === 'Automático|Siempre activado|Desactivado', v);
    await shot(win, 'ajuste-modo-directo-1280x800');
    await js(win, `nexuraApp.closeModal(); true`);
  } catch (e) { check('la prueba ha terminado sin excepciones', false, String(e && e.stack || e)); }
  const errs = report.errors.filter(e => !/AbortError|play\(\) request/.test(e));
  check('Sin errores en la consola', errs.length === 0, errs.slice(0, 8));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS');
  app.exit(report.ok ? 0 : 1);
});
