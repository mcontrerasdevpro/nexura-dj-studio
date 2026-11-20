// Capturas de la fase 2 (grid con cambios de tempo, Stems FX y lista de efectos) con Electron contra `npm run web`.
// Guarda PNG e informe en .revision/fase2/. Uso: npx electron tools/ui-check-fase2.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'fase2');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1496, 885], [1024, 700]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now();
  const mk = (i, artist, title, bpm, camelot) => ({
    id: 't' + i, path: `web:${artist} - ${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: '', genre: 'House', year: '2024', comment: '', rating: 3,
    bpm, firstBeat: 0.3, key: '', camelot, duration: 120, size: 1000 + i, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
    added: now - i * 86400000, plays: 0, lastPlayed: 0, analyzed: true, energy: 6, sections: [{ t: 0.3, type: 'intro', label: 'Intro' }, { t: 32.3, type: 'drop', label: 'Drop' }]
  });
  return {
    library: { version: 1, tracks: [mk(0, 'Directo', 'Tempo variable', 123, '8A'), mk(1, 'Estudio', 'Tempo fijo', 124, '9A')], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] },
    settings: { libView: 'all', waveLayout: 'serato' }
  };
}

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(700);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('captura', name);
}

// En la página: pista de 120 s con salto 120 → 126 a los 60 s (bombo sintético), forma de onda real y stems simulados
const PREPARE = `(async () => {
  const app = nexuraApp, d = app.decks[0], t = app.library.get('t0');
  const { computeWaveform } = await import('/js/analysis/analysis-core.js');
  const ctx = app.engine.ctx, sr = ctx.sampleRate, N = sr * 120;
  const buf = ctx.createBuffer(2, N, sr), L = buf.getChannelData(0);
  const beats = []; for (let x = 0.3; x < 119.5; x += 60 / (x < 60.3 ? 120 : 126)) beats.push(x);
  for (const b of beats) { const i0 = Math.round(b * sr); for (let i = 0; i < sr * 0.2 && i0 + i < N; i++) { const tt = i / sr; L[i0 + i] += 0.7 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12); } }
  for (let i = 0; i < N; i++) L[i] += 0.08 * Math.sin(2 * Math.PI * 220 * i / sr) * (0.5 + 0.5 * Math.sin(i / sr));
  buf.getChannelData(1).set(L);
  const w = computeWaveform(L, sr);
  app.analyzer.waves.set(t.id, { data: w.data, rate: w.rate });
  app.library.update(t.id, { bpm: 120, firstBeat: 0.3, grid: [{ t: 0.3, bpm: 120 }, { t: 60.3, bpm: 126 }], stems: true });
  await d.load(t, buf);
  return { marcas: t.grid.length, bpmTramo1: d.bpm };
})()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {} };
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    const tag = `${w}x${h}`;
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);
    const c = report.checks[tag] = {};
    c.preparar = await js(win, PREPARE);

    // 1) edición del grid: cabezal justo antes del cambio de tempo, editor abierto
    c.grid = await js(win, `(async () => {
      const app = nexuraApp, d = app.decks[0], ui = app.deckUIs[0];
      d.toggleGridEdit(true);
      d.seek(58.6); await new Promise(r => setTimeout(r, 150));
      const antes = d.bpm;
      d.seek(61); await new Promise(r => setTimeout(r, 150));
      const despues = d.bpm, cur = +d.currentBpm.toFixed(2);
      // beat jump de 8 beats cruzando el cambio usa el grid variable
      d.seek(58); await new Promise(r => setTimeout(r, 100));
      const b0 = d.beatAt(d.time); d.beatJump(8); await new Promise(r => setTimeout(r, 100));
      const salto = +(d.beatAt(d.time) - b0).toFixed(3);
      // «Cambio de BPM aquí» a 90 s y deshacer
      d.seek(90.1); await new Promise(r => setTimeout(r, 100));
      d.editGrid('tempo', { bpm: 128, level: 'bar' });
      const conCambio = d.track.grid.map(m => m.bpm);
      d.undoGrid();
      const tras = d.track.grid.map(m => m.bpm);
      d.seek(59.2); await new Promise(r => setTimeout(r, 150));
      return { bpmAntes: antes, bpmDespues: despues, currentBpm: cur, beatJump8: salto, conCambio, trasDeshacer: tras, filas: document.querySelectorAll('#deck0 .row.grid-edit:not(.hidden)').length };
    })()`);
    await js(win, `document.querySelector('#deck0').scrollIntoView({ block: 'start' }); window.scrollTo(0, 0); true`);
    await shot(win, `${tag}-01-grid-cambio-bpm`);

    // 2) modo de pads Stems con Stems FX (stems simulados: 4 tonos)
    c.stems = await js(win, `(async () => {
      const app = nexuraApp, d = app.decks[0], ui = app.deckUIs[0];
      d.toggleGridEdit(false);
      Object.defineProperty(app.stems, 'available', { get: () => true, configurable: true }); // en el navegador no hay motor de stems
      const sr = app.engine.ctx.sampleRate, n = Math.round(d.duration * sr);
      const st = [440, 110, 55, 880].map(f => { const L = new Int16Array(n); for (let i = 0; i < n; i++) L[i] = Math.round(6000 * Math.sin(2 * Math.PI * f * i / sr)); return { L, R: L.slice() }; });
      d.setStems(st, 0);
      d.setPadMode('stems');
      d.padDown(0, true); d.padUp(0);   // Mayús + pad 1 → Stems FX en la voz
      d.padDown(3, true); d.padUp(3);   // Mayús + pad 4 → melodía
      d.toggleSlip();
      await new Promise(r => setTimeout(r, 200));
      const u = app.fxUnits[d.stemFxUnit];
      return { stemFx: d.stemFx, unidad: d.stemFxUnit + 1, destino: u.target, encendidos: u.slots.map(s => s.enabled), enStems: app.engine.channels[0].stemInserts.length, enCanal: app.engine.channels[0].inserts.length,
        envio: d._stemSend, midiLed: app.actions['deck1.stemfx1'].led(), etiquetaPad: d.padState(0).label, aviso: document.querySelector('#deck0 .pad-hint').textContent, etiquetaFx: document.querySelector('#fx1 .fx-stemtag').textContent };
    })()`);
    await shot(win, `${tag}-02-stems-fx`);
    c.stemSlip = await js(win, `(async () => {
      const d = nexuraApp.decks[0];
      d.padDown(1); const silenciado = d.stemGains[1]; const led = nexuraApp.actions['deck1.stemslip2'].led();
      d.padUp(1); const vuelve = d.stemGains[1];
      d.toggleSlip();
      // pista sin stems: aviso y sin romper nada
      const d2 = nexuraApp.decks[1]; await d2.load(nexuraApp.library.get('t1'), nexuraApp.engine.ctx.createBuffer(2, 48000, 48000));
      const toasts0 = document.querySelectorAll('.toast').length; d2.toggleStemFx(0); d2.stemSlipDown(0);
      await new Promise(r => setTimeout(r, 100));
      return { silenciadoMientrasPulsa: silenciado, ledSlip: led, alSoltar: vuelve, sinStems: { stemFx: d2.stemFx, aviso: [...document.querySelectorAll('.toast')].slice(toasts0).map(t => t.textContent).pop() || '' } };
    })()`);

    // 3) lista de efectos (desplegada como lista para la captura) en la unidad FX 1
    c.efectos = await js(win, `(() => {
      document.body.classList.add('topbar-expanded');
      const sel = document.querySelector('#fx1 .fx-sel');
      sel.value = 'reverbdrop'; sel.dispatchEvent(new Event('change'));
      sel.size = 22; sel.style.position = 'fixed'; sel.style.zIndex = 50; sel.style.left = '12px'; sel.style.top = '60px'; sel.style.width = '210px'; sel.style.height = 'auto'; sel.style.maxHeight = (innerHeight - 80) + 'px'; sel.style.fontSize = '12px';
      return { opciones: sel.options.length, grupos: [...sel.querySelectorAll('optgroup')].map(g => g.label + ' (' + g.children.length + ')'), presets: [...document.querySelectorAll('#fx1 .fx-side select optgroup')].map(g => g.label + ': ' + [...g.children].map(o => o.textContent).join(', ')) };
    })()`);
    await shot(win, `${tag}-03-lista-efectos`);
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'ui-check-fase2.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
});
