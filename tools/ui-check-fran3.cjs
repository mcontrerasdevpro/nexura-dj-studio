// Informe FRAN3 con Electron contra `npm run web` (puerto 5180):
// - «Siguiente pista (IA)» con house a 126 BPM sonando: ninguna pop a 100 BPM en las sugerencias, el top 10 es
//   house / tech house dentro del rango de BPM y cada fila lleva su explicación corta («mismo género · 126 BPM · 8A→9A»).
// - «Enviar informe o sugerencia»: sin dirección del servicio (reason 'no-url') el diálogo dice que esta versión no
//   puede enviar informes y que se adjunte el archivo por correo (no «sin conexión»); si el servicio responde, «Enviado».
// - Ajustes → General con una versión de prueba instalada: «Recibir versiones de prueba» activado, fijo y con nota.
// Capturas a 1280 px y 375 px en .revision/capturas-fran3/. Uso: npx electron tools/ui-check-fran3.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'capturas-fran3');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

let n = 0;
const KEYS = ['8A', '9A', '7A', '8B', '3B', '11A'];
const track = (title, genre, bpm, camelot = KEYS[n % KEYS.length]) => ({
  id: 't' + (n++), path: `web:${title}.wav:${bpm}`, source: 'local', title, artist: 'Prueba ' + n, album: '', genre, year: '2026', comment: '', rating: 0,
  bpm, firstBeat: 0.1, bpmLocked: true, key: '', camelot, duration: 200, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 5 + (n % 3), sections: []
});
const seed = () => {
  const tracks = [track('Ahora suena', 'House', 126, '8A')];
  for (let i = 0; i < 25; i++) tracks.push(track(`Pop lento ${i + 1}`, 'Pop', 100));
  for (let i = 0; i < 8; i++) tracks.push(track(`House ${i + 1}`, i % 2 ? 'House Music' : 'House', 123 + (i % 6)));
  for (let i = 0; i < 6; i++) tracks.push(track(`Tech ${i + 1}`, 'Tech-House', 124 + (i % 5)));
  for (let i = 0; i < 4; i++) tracks.push(track(`Pop rápido ${i + 1}`, 'Pop', 126));
  return {
    library: { version: 1, tracks, crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] },
    settings: { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, libView: 'all', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9' }
  };
};

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}

const report = { ok: true, errors: [] };
const check = (name, cond, extra) => { if (!cond) report.ok = false; console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 500) : ''}`); };

const SUGGEST = `(async () => {
  const A = nexuraApp, ctx = A.engine.ctx;
  const t = A.library.get('t0');
  await A.decks[0].load(t, ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate));
  A.libraryUI.setView('ai:next');
  await new Promise(r => setTimeout(r, 600));
  const rows = [...document.querySelectorAll('#library .row-t')].map(r => ({ title: (r.querySelector('.c-title') || {}).firstChild?.textContent || '', why: (r.querySelector('.ai-why') || {}).textContent || '' }));
  const lib = A.ai.suggest(80).map(x => ({ title: x.title, genre: x.genre, bpm: x.bpm, why: A.ai.scores.get(x.id).why }));
  return { rows, lib };
})()`;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3 && !/favicon|ERR_FILE_NOT_FOUND|404/.test(msg)) report.errors.push(msg); });
  await load(win);
  const data = seed();
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(data.settings))}); true`);
  await load(win);
  await wait(1500);

  // ---- sugerencias de IA
  const s = await js(win, SUGGEST);
  const top10 = (s.lib || []).slice(0, 10);
  check('IA: hay sugerencias con house a 126 BPM sonando', top10.length === 10, s);
  check('IA: ninguna pop a 100 BPM en toda la lista', !(s.lib || []).some(x => x.genre === 'Pop' && x.bpm === 100), s.lib);
  check('IA: el top 10 es house / tech house dentro de ±6 %', top10.every(x => /house/i.test(x.genre) && Math.abs(x.bpm - 126) / 126 <= 0.06), top10);
  check('IA: salen house y tech house', top10.some(x => x.genre === 'Tech-House') && top10.some(x => /^House/.test(x.genre)), top10);
  check('IA: la pop a 126 BPM queda detrás del house', (s.lib || []).findIndex(x => x.genre === 'Pop') >= 14, s.lib && s.lib.map(x => x.genre));
  check('IA: cada fila de la tabla lleva su explicación corta', s.rows && s.rows.length >= 10 && s.rows.slice(0, 10).every(r => /\d+ BPM · 8A→\d+[AB]/.test(r.why) && /mismo género|género afín/.test(r.why)), s.rows && s.rows.slice(0, 3));
  await shot(win, 'ia-1280');
  win.setContentSize(375, 800); await wait(600);
  const narrow = await js(win, `(() => { const r = document.querySelector('#library .row-t .ai-why'); return r ? { w: document.documentElement.scrollWidth } : null; })()`);
  await shot(win, 'ia-375');
  check('IA a 375 px: la explicación sigue en la fila y la página no se desborda a lo ancho', narrow && narrow.w <= 380, narrow);
  win.setContentSize(1280, 800); await wait(400);

  // ---- envío de sugerencias
  const send = async (mock) => {
    await js(win, `window.__nexuraReportMock = { send: async () => (${JSON.stringify(mock)}) }; nexuraApp.feedback.open('idea'); true`);
    await wait(500);
    await js(win, `document.querySelector('#fb-text').value = 'Prueba FRAN3'; [...document.querySelectorAll('.modal-foot button')].pop().click(); true`);
    await wait(700);
  };
  await send({ ok: false, via: 'mail', file: 'C:\\informes\\informe.txt', reason: 'no-url' });
  const noUrl = await js(win, `(() => ({ why: (document.querySelector('#fb-why') || {}).textContent || '', title: (document.querySelector('.modal-head h2') || {}).textContent || '', body: (document.querySelector('.modal-body') || {}).textContent || '' }))()`);
  check('Sugerencias sin URL: «esta versión no puede enviar informes» y adjuntar el archivo por correo', /no puede enviar informes/.test(noUrl.why) && /correo/.test(noUrl.why) && /adjunta/i.test(noUrl.why), noUrl);
  check('Sugerencias sin URL: no dice «sin conexión o servicio no disponible»', !/sin conexión|servicio no disponible/.test(noUrl.body), noUrl);
  await shot(win, 'sugerencias-sin-url-1280');
  win.setContentSize(375, 800); await wait(500); await shot(win, 'sugerencias-sin-url-375'); win.setContentSize(1280, 800); await wait(300);
  await js(win, `nexuraApp.closeModal(); true`);
  await send({ ok: false, via: 'mail', file: 'C:\\informes\\informe.txt', reason: 'network' });
  const net = await js(win, `(document.querySelector('#fb-why') || {}).textContent || ''`);
  check('Sugerencias sin red: «sin conexión o servicio no disponible»', /sin conexión/.test(net), net);
  await js(win, `nexuraApp.closeModal(); true`);
  await send({ ok: true, via: 'web' });
  const sent = await js(win, `[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent)`);
  check('Sugerencias con el servicio respondiendo: «Enviado»', Array.isArray(sent) && sent.some(t => /^Enviado/.test(t)), sent);
  check('Sugerencias con el servicio respondiendo: no se abre el diálogo de correo', !(await js(win, `!!document.querySelector('#fb-why')`)));

  // ---- Ajustes → General con una versión de prueba
  await js(win, `nexuraApp.info = { ...(nexuraApp.info || {}), version: '1.0.0-rc.7' }; nexuraApp.setSetting('prereleaseUpdates', false); nexuraApp.settingsUI.open('general'); true`);
  await wait(600);
  const pre = await js(win, `(() => { const t = document.querySelector('#set-prerelease'); const row = t && t.closest('.set-row, .row, label, div'); return t ? { checked: t.checked, disabled: t.disabled, text: (t.closest('.modal-body') || document.body).textContent } : null; })()`);
  check('Ajustes con una rc: «Recibir versiones de prueba» activado y sin poder desactivarlo', pre && pre.checked && pre.disabled, pre && { checked: pre.checked, disabled: pre.disabled });
  check('Ajustes con una rc: nota que lo explica', pre && /Siempre activado: tienes instalada una versión de prueba \(1\.0\.0-rc\.7\)/.test(pre.text));
  await shot(win, 'ajustes-rc-1280');
  win.setContentSize(375, 800); await wait(500); await shot(win, 'ajustes-rc-375'); win.setContentSize(1280, 800); await wait(300);
  await js(win, `nexuraApp.closeModal(); nexuraApp.info = { ...nexuraApp.info, version: '1.0.0' }; nexuraApp.settingsUI.open('general'); true`);
  await wait(500);
  const stable = await js(win, `(() => { const t = document.querySelector('#set-prerelease'); return t ? { checked: t.checked, disabled: t.disabled } : null; })()`);
  check('Ajustes con una estable: el ajuste se puede cambiar y respeta lo elegido (desactivado)', stable && !stable.checked && !stable.disabled, stable);
  await js(win, `nexuraApp.closeModal(); true`);

  check('Sin errores en la consola', !report.errors.length, { errors: report.errors.slice(0, 5) });
  console.log(report.ok ? '\nFRAN3: todo correcto' : '\nFRAN3: hay fallos');
  app.exit(report.ok ? 0 : 1);
});
