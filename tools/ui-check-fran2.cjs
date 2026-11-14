// Informe FRAN2 con Electron contra `npm run web`: posición del cabezal y clics que no mueven la pista.
// - Ajustes → Reproducción «Posición del cabezal» (Izquierda 25 % / Un tercio 33 % / Centro 50 %, por defecto
//   a la izquierda): la línea blanca de lo que suena se busca en los píxeles de la onda de detalle (arriba y en el
//   deck) y un hot cue 1 s por delante cae a 1 s de ella; se aplica al momento y se recuerda al recargar.
// - Un clic de verdad (ratón abajo y arriba sin moverse, 120 ms) en la onda y en el plato no mueve la
//   reproducción, sonando y parado: se compara lo que avanza la pista con lo que avanza el reloj de audio.
// - «Sensibilidad del plato y de la onda» en Ajustes → Reproducción.
// Capturas en .revision/capturas-fran2/. Uso: npx electron tools/ui-check-fran2.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'capturas-fran2');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, title, bpm, firstBeat) => ({
  id, path: `web:${title}.wav:${bpm}`, source: 'local', title, artist: 'Prueba', album: '', genre: 'House', year: '2026', comment: '', rating: 0,
  bpm, firstBeat, bpmLocked: true, key: '', camelot: '8A', duration: 90, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 6, sections: []
});
const seed = () => ({
  library: { version: 1, tracks: [track('c125', 'Clic 125', 125, 0.1), track('c128', 'Clic 128', 128, 0.23)], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] },
  settings: { welcomeDone: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9' }
});

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
const center = (win, sel, fx = 0.5, fy = 0.5) => js(win, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width * ${fx}), y: Math.round(b.top + b.height * ${fy}) }; })()`);
// clic sin mover el ratón, con 120 ms pulsado (lo que dura un clic normal)
async function clickHold(win, p) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await wait(120);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}

const PREPARE = `(async () => {
  const A = nexuraApp, ctx = A.engine.ctx, sr = ctx.sampleRate;
  const { computeWaveform } = await import('/js/analysis/analysis-core.js');
  for (const [i, id] of [[0, 'c125'], [1, 'c128']]) {
    const t = A.library.get(id), N = sr * 90, buf = ctx.createBuffer(2, N, sr), L = buf.getChannelData(0);
    for (let b = 0, x = t.firstBeat; x < 89.5; b++, x = t.firstBeat + b * 60 / t.bpm) {
      const i0 = Math.round(x * sr), acc = b % 4 ? 0.6 : 1;
      for (let k = 0; k < sr * 0.12 && i0 + k < N; k++) { const tt = k / sr; L[i0 + k] += acc * (0.55 * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 18) + (tt < 0.003 ? 0.5 * Math.sin(2 * Math.PI * 2000 * tt) : 0)); }
    }
    buf.getChannelData(1).set(L);
    const w = computeWaveform(L, sr);
    A.analyzer.waves.set(id, { data: w.data, rate: w.rate });
    await A.decks[i].load(t, buf);
    A.waves[i].setWave(A.analyzer.waves.get(id)); A.deckUIs[i].overview.setWave(A.analyzer.waves.get(id)); A.deckUIs[i].waveDetail.setWave(A.analyzer.waves.get(id));
  }
  A.engine.setMaster(0.15);
  return A.decks.slice(0, 2).map(d => d.track && d.track.id);
})()`;

// Cabezal y hot cue en los píxeles de un lienzo de onda de detalle: columnas blancas puras en 4 alturas
// (el cabezal es el único trazo #ffffff de arriba abajo) y la columna magenta del hot cue 1
const SCAN = (sel) => `(async () => {
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return null;
  const g = c.getContext('2d'), W = c.width, H = c.height, dpr = W / c.clientWidth;
  const rows = [0.2, 0.4, 0.6, 0.8].map(f => g.getImageData(0, Math.floor(H * f), W, 1).data);
  const white = [], mag = [];
  for (let x = 0; x < W; x++) {
    if (rows.every(d => d[x * 4] === 255 && d[x * 4 + 1] === 255 && d[x * 4 + 2] === 255)) white.push(x);
    const d = rows[1]; if (d[x * 4] === 255 && d[x * 4 + 1] === 0 && d[x * 4 + 2] === 255) mag.push(x);
  }
  const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length / dpr : null;
  return { w: c.clientWidth, head: avg(white), cue: avg(mag), frac: avg(white) / c.clientWidth };
})()`;
// avance de la pista frente al reloj de audio (ms) entre dos informes del worklet
const POS = `(() => { const d = nexuraApp.decks[0]; return { pos: d.st.pos, f: d.st.f, sr: nexuraApp.engine.ctx.sampleRate, playing: d.playing }; })()`;
async function displacement(win, action) {
  const a = await js(win, POS);
  await action();
  await wait(600);
  const b = await js(win, POS);
  if (a.f == null || b.f == null) return { ms: NaN, a, b };
  const ms = ((b.pos - a.pos) - (a.playing ? (b.f - a.f) / a.sr : 0)) * 1000;
  return { ms: +ms.toFixed(2) };
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  const check = (name, cond, data) => { report.checks[name] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', name, JSON.stringify(data)); } else console.log('✓', name); };

  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  await load(win);
  const data = seed();
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(data.settings))}); true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
  const prep = await js(win, PREPARE);
  check('Pistas de clics de 125 y 128 BPM cargadas en los decks 1 y 2', JSON.stringify(prep) === '["c125","c128"]', { prep });
  // hot cue 1 (magenta) 1 s por delante de donde está la pista; zoom de 6 s
  await js(win, `(() => { const A = nexuraApp, d = A.decks[0]; d.seek(20); d.track.cues[0] = { t: 21, color: '#ff00ff', name: '' }; d.emit('cues'); A.setSetting('waveZoom', 6); A.applyWaveZoom(); return true; })()`);
  await wait(400);

  // ---------------------------------------------------------------- cabezal
  const def = await js(win, `nexuraApp.settings.playheadPos`);
  check('Por defecto, el cabezal está a la izquierda (25 %)', def === 'left', { def });
  await js(win, `nexuraApp.settingsUI.open('play'); true`);
  await wait(500);
  const opts = await js(win, `(() => { const p = document.querySelector('#set-playhead'), s = document.querySelector('#set-platter-sens'); return { p: p && [...p.options].map(o => o.textContent), pv: p && p.value, s: s && [...s.options].map(o => o.textContent), sv: s && s.value }; })()`);
  check('Ajustes → Reproducción: «Posición del cabezal» Izquierda (25 %) / Un tercio (33 %) / Centro (50 %), en «Izquierda (25 %)»',
    JSON.stringify(opts.p) === JSON.stringify(['Izquierda (25 %)', 'Un tercio (33 %)', 'Centro (50 %)']) && opts.pv === 'left', opts);
  check('Ajustes → Reproducción: «Sensibilidad del plato y de la onda» Baja / Normal / Alta, en «Normal»',
    JSON.stringify(opts.s) === JSON.stringify(['Baja', 'Normal', 'Alta']) && opts.sv === 'normal', opts);
  await shot(win, '1280x800-00-ajustes');
  const FR = { left: 0.25, third: 1 / 3, center: 0.5 };
  for (const [pos, label] of [['left', '25'], ['third', '33'], ['center', '50']]) {
    // como en la app: Ajustes → Reproducción, cambiar el desplegable y cerrar
    await js(win, `nexuraApp.settingsUI.open('play'); true`);
    await wait(300);
    await js(win, `(() => { const s = document.querySelector('#set-playhead'); s.value = '${pos}'; s.dispatchEvent(new Event('change')); nexuraApp.closeModal(); return true; })()`);
    await wait(300);
    for (const [where, sel] of [['arriba', '#wave0'], ['arriba (Deck 2)', '#wave1']]) {
      const sc = await js(win, SCAN(sel));
      const pxPerSec = sc.w / 6;
      check(`Cabezal ${label} % ${where}: la línea de lo que suena está al ${label} % del ancho`, sc.head != null && Math.abs(sc.head - sc.w * FR[pos]) <= 2, sc);
      if (sel === '#wave0') check(`Cabezal ${label} %: el hot cue 1 s por delante cae a 1 s del cabezal (sigue en su sitio)`, sc.cue != null && Math.abs(sc.cue - sc.head - pxPerSec) <= 3, { ...sc, pxPerSec });
    }
    if (pos !== 'center') await shot(win, `1280x800-cabezal-${label}`);
  }
  // también en la vista «en deck»
  await js(win, `nexuraApp.setSetting('playheadPos', 'left'); nexuraApp.setWaveLayout('deck'); true`);
  await wait(600);
  const sd = await js(win, SCAN('#deck0 .deck-detail-wave'));
  check('EN DECK, cabezal 25 %: la línea está al 25 % de la onda del deck', sd && sd.head != null && Math.abs(sd.head - sd.w * 0.25) <= 2, sd);
  await shot(win, '1280x800-cabezal-25-en-deck');
  await js(win, `nexuraApp.setWaveLayout('serato'); nexuraApp.setSetting('playheadPos', 'third'); true`);
  await wait(900);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
  const kept = await js(win, `nexuraApp.settings.playheadPos`);
  check('Al recargar se recuerda la posición del cabezal', kept === 'third', { kept });
  await js(win, PREPARE);
  win.setContentSize(375, 812);
  await wait(900);
  await shot(win, '375x812-cabezal-33');
  win.setContentSize(1280, 800);
  await wait(700);

  // ---------------------------------------------------------------- clics que no mueven la pista
  await js(win, `(() => { const d = nexuraApp.decks[0]; d.seek(20); d.play(); return true; })()`);
  await wait(800);
  const pWave = await center(win, '#wave0', 0.6), pPlat = await center(win, '#deck0 .platter', 0.85, 0.5);
  const vinyl = await js(win, `nexuraApp.decks[0].vinyl`);
  // control: tocar el plato 120 ms (lo que hacía un clic antes, en VINYL) sí retrasa la pista; si la medición
  // no lo viera, las comprobaciones de abajo no valdrían
  let r = await displacement(win, async () => { await js(win, `nexuraApp.decks[0].jogTouch(true); true`); await wait(120); await js(win, `nexuraApp.decks[0].jogTouch(false); true`); });
  check('Control: tocar el plato 120 ms sonando (como un clic antes) retrasa la pista unos 120 ms', r.ms < -80 && r.ms > -200, r);
  r = await displacement(win, () => clickHold(win, pWave));
  check('Clic sin mover en la onda, sonando: la pista no se mueve (< 2 ms)', Math.abs(r.ms) < 2, r);
  r = await displacement(win, () => clickHold(win, pPlat));
  check(`Clic sin mover en el plato (VINYL ${vinyl ? 'activado' : 'apagado'}), sonando: la pista no se mueve (< 2 ms)`, Math.abs(r.ms) < 2, r);
  await js(win, `nexuraApp.decks[0].pause(); true`);
  await wait(600);
  r = await displacement(win, () => clickHold(win, pWave));
  check('Clic sin mover en la onda, parado: la pista no se mueve', Math.abs(r.ms) < 0.5, r);
  r = await displacement(win, () => clickHold(win, pPlat));
  check('Clic sin mover en el plato, parado: la pista no se mueve', Math.abs(r.ms) < 0.5, r);
  // y arrastrar sí mueve (zona muerta de 3 px superada): 30 px en la onda, parado
  r = await displacement(win, async () => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: pWave.x, y: pWave.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: pWave.x, y: pWave.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 30; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: pWave.x - k, y: pWave.y, modifiers: ['leftButtonDown'] }); await wait(8); }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: pWave.x - 30, y: pWave.y, button: 'left', clickCount: 1 });
  });
  const expMs = 27 * 6000 / (await js(win, `document.querySelector('#wave0').clientWidth`));
  check('Arrastrar 30 px la onda parado sí mueve la pista, proporcional (27 px tras la zona muerta)', Math.abs(r.ms - expMs) < expMs * 0.15, { ...r, esperado: +expMs.toFixed(1) });

  report.errors = report.errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND|youtube/i.test(e));
  check('Sin errores en la consola', !report.errors.length, { errors: report.errors.slice(0, 5) });
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  const n = Object.values(report.checks), bad = n.filter(c => !c.ok).length;
  console.log(bad ? `${bad}/${n.length} comprobaciones fallidas` : `${n.length}/${n.length} comprobaciones de FRAN2 correctas`);
  app.exit(report.ok ? 0 : 1);
});
