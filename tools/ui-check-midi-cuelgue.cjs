// Arranque con una controladora que no responde (encargo BIBLIOTECA2), con Electron contra `node tools/serve.js`
// (5180). Se sustituye navigator.requestMIDIAccess por uno que no responde nunca (lo que pasaba a veces con la
// MC4000 conectada) y se comprueba:
// - el arranque termina sin esperar a MIDI: el teclado responde y el bucle de dibujo está en marcha (relojes y
//   onda del deck que suena avanzan);
// - tras el tiempo máximo (5 s) sale el aviso «La controladora no responde…» con «Reintentar», la píldora MIDI lo
//   indica y queda anotado en el registro técnico y en el diagnóstico de rendimiento;
// - «Reintentar» vuelve a pedir el acceso; si el navegador responde tarde, se acepta y el aviso desaparece;
// - sin errores en la consola.
// Uso: npx electron tools/ui-check-midi-cuelgue.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// --url=… (o NEXURA_URL): probar otro servidor, p. ej. el código anterior para comparar
const URL = (process.argv.find(a => a.startsWith('--url=')) || '').slice(6) || process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// requestMIDIAccess que no responde: cada llamada queda pendiente (y se cuenta). __midiAnswer() las responde
// todas con un MIDIAccess vacío (respuesta tardía)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-midi-'));
const preload = path.join(tmp, 'midi-colgado.js');
fs.writeFileSync(preload, `
  window.__midiCalls = 0; window.__midiPending = [];
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, value: function () {
    window.__midiCalls++;
    return new Promise((resolve) => window.__midiPending.push(resolve));
  } });
  window.__midiAnswer = () => { const a = { inputs: new Map(), outputs: new Map(), onstatechange: null, sysexEnabled: true }; window.__midiPending.splice(0).forEach(r => r(a)); return true; };
`);

const track = { id: 'p1', path: 'web:prueba.wav:1', source: 'local', title: 'Prueba MIDI', artist: 'Nexura', album: '', genre: 'House', year: '', comment: '', rating: 0, bpm: 124, firstBeat: 0, key: '', camelot: '8A', duration: 60, size: 1, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: 1, plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: [] };
const LIB = { version: 1, tracks: [track], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] };
const SETTINGS = { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9' };

const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function key(win, keyCode) {
  await js(win, `document.activeElement && document.activeElement.blur && document.activeElement.blur(); true`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await wait(350);
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let pass = 0, fail = 0;
  const check = (name, ok, data) => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && data !== undefined ? ' → ' + JSON.stringify(data).slice(0, 500) : ''}`); };
  const errors = [];
  const win = new BrowserWindow({ width: 1366, height: 768, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true, contextIsolation: false, preload } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  try {
    await win.loadURL(URL);
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(LIB))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(SETTINGS))}); true`);
    const t0 = Date.now();
    await win.loadURL(URL);
    // el arranque termina enseguida (antes del tiempo máximo de MIDI)
    let st = null;
    for (let i = 0; i < 60; i++) { st = await js(win, `({ started: !!(window.nexuraApp && typeof nexuraApp.flushAll === 'function'), midi: window.nexuraApp && nexuraApp.midi && nexuraApp.midi.status, calls: window.__midiCalls })`); if (st.started) break; await wait(100); }
    const bootMs = Date.now() - t0;
    check(`Arranque completo sin esperar a MIDI (${bootMs} ms; requestMIDIAccess pedido y sin respuesta)`, st.started && st.midi === 'waiting' && st.calls >= 1 && bootMs < 4500, { st, bootMs });
    // registro: se captura desde aquí (el aviso de MIDI llega a los 5 s)
    await js(win, `window.__log = []; const f = nexuraApp.feedback.log.bind(nexuraApp.feedback); nexuraApp.feedback.log = (l, s, m) => { window.__log.push(l + ' ' + s + ' ' + m); return f(l, s, m); }; document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
    // bucle de dibujo en marcha: cuenta de frames del diagnóstico (antes del arreglo se quedaba en 0; la ventana
    // fuera de pantalla entrega menos frames que una normal)
    const f1 = await js(win, `nexuraApp.perfDiag.frameNo`);
    await wait(1000);
    const f2 = await js(win, `nexuraApp.perfDiag.frameNo`);
    check(`El bucle de dibujo está en marcha mientras MIDI no responde (${f2 - f1} frames en 1 s)`, f2 - f1 >= 8, { f1, f2 });
    // una pista en el Deck 1 (tono de 60 s) y X (play del Deck 1) desde el teclado
    await js(win, `(async () => { const A = nexuraApp, ctx = A.engine.ctx, sr = ctx.sampleRate, N = sr * 60, buf = ctx.createBuffer(2, N, sr);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < N; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / sr); }
      A.engine.setMaster(0.05); await A.decks[0].load(A.library.get('p1'), buf); return true; })()`);
    await wait(300);
    await key(win, 'X');
    const c1 = await js(win, `({ playing: nexuraApp.decks[0].playing, elapsed: document.querySelector('#deck0 .elapsed')?.textContent, status: nexuraApp.midi.status })`);
    await wait(1300);
    const c2 = await js(win, `({ playing: nexuraApp.decks[0].playing, elapsed: document.querySelector('#deck0 .elapsed')?.textContent, status: nexuraApp.midi.status })`);
    check('Teclado: X pone a sonar el Deck 1 con MIDI todavía sin responder', c1.playing && c1.status === 'waiting', c1);
    check('…y el reloj del deck avanza en pantalla (el bucle dibuja)', c2.playing && c1.elapsed !== c2.elapsed, { c1, c2 });
    // tras el tiempo máximo: aviso con «Reintentar»
    while (Date.now() - t0 < 5800) await wait(100);
    let n = await js(win, `(() => { const b = document.querySelector('.midi-notice'); const r = b && b.getBoundingClientRect(); return { status: nexuraApp.midi.status, visible: !!(b && !b.hidden && r.width > 0), text: b && b.textContent, retry: !!(b && b.querySelector('.midi-retry')), pill: nexuraApp.midiStatus.textContent, warn: nexuraApp.midiStatus.classList.contains('warn') }; })()`);
    check('A los 5 s: aviso «La controladora no responde; reconéctala o pulsa Reintentar» con botón Reintentar', n.status === 'timeout' && n.visible && /La controladora no responde; reconéctala o pulsa Reintentar/.test(n.text) && n.retry, n);
    check('…la píldora MIDI de la barra superior dice «MIDI no responde»', n.pill === 'MIDI no responde' && n.warn, n);
    const diag = await js(win, `({ log: window.__log.filter(l => /midi/.test(l)), snap: nexuraApp.perfDiag.snapshot().startup })`);
    check('…anotado en el registro técnico', diag.log.some(l => /^WARN midi requestMIDIAccess no ha respondido en 5 s/.test(l)), diag.log);
    check('…y en el diagnóstico de rendimiento (arranque: MIDI «timeout», 1 vez)', diag.snap && diag.snap.midi === 'timeout' && diag.snap.midiTimeouts === 1, diag.snap);
    const c3 = await js(win, `({ playing: nexuraApp.decks[0].playing, elapsed: document.querySelector('#deck0 .elapsed')?.textContent })`);
    await key(win, 'X');
    const c4 = await js(win, `({ playing: nexuraApp.decks[0].playing })`);
    check('El teclado sigue funcionando con el aviso (X pausa el Deck 1)', c3.playing && !c4.playing && c3.elapsed !== c2.elapsed, { c3, c4 });
    // Reintentar: otra petición de acceso
    const before = await js(win, `window.__midiCalls`);
    await js(win, `document.querySelector('.midi-notice .midi-retry').click(); true`);
    await wait(300);
    const after = await js(win, `({ calls: window.__midiCalls, btn: document.querySelector('.midi-notice .midi-retry')?.textContent, log: window.__log.some(l => /Reintentar MIDI/.test(l)) })`);
    check('«Reintentar» vuelve a pedir el acceso MIDI', after.calls === before + 1 && after.btn === 'Reintentando…' && after.log, { before, after });
    // respuesta tardía: se acepta, el aviso desaparece y queda anotado
    await js(win, `window.__midiAnswer()`);
    await wait(500);
    n = await js(win, `({ status: nexuraApp.midi.status, notice: !!document.querySelector('.midi-notice'), pill: nexuraApp.midiStatus.textContent, access: !!nexuraApp.midi.access, log: window.__log.filter(l => /MIDI ha respondido tarde/.test(l)).length, snap: nexuraApp.perfDiag.snapshot().startup.midi, stateHandler: typeof nexuraApp.midi.access.onstatechange })`);
    check('Si MIDI responde tarde, se acepta: aviso fuera, estado «ok», onstatechange enlazado y anotado', n.status === 'ok' && !n.notice && n.access && n.log === 1 && n.snap === 'ok' && n.stateHandler === 'function' && n.pill === 'Sin controlador', n);
  } catch (e) { check('la prueba ha fallado', false, String(e && e.stack || e)); }
  const errs = errors.filter(e => !/favicon|ERR_/i.test(e));
  check('Sin errores en la consola', !errs.length, errs);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ }
  console.log(`\n${pass}/${pass + fail} comprobaciones del arranque con MIDI colgado correctas`);
  app.exit(fail ? 1 : 0);
});
