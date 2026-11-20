// Aviso de actualización (updates-ui.js), con Electron contra `npm run web` y estados simulados
// (`updatesUI.onEvent`): ventana de alerta ámbar abajo a la IZQUIERDA (~360 px) «Hay una versión nueva de Nexura»,
// versión actual → nueva, hasta 3 líneas de novedades y «Descargar ahora» / «Más tarde», con pulso los primeros 30 s
// y botón «⬆ Actualizar» junto a «?»; «Más tarde» la cierra hasta el siguiente arranque (otra comprobación en la
// misma sesión no la reabre; al recargar vuelve); descargando 45 % (barra ámbar), lista (verde con pulso) y
// «Se instalará al cerrar Nexura» con un deck sonando, todo en la misma ventana; contraste ≥ 4,5:1; no tapa decks,
// mezclador, crossfader, efectos, sampler ni formas de onda; sin animación con prefers-reduced-motion.
// Tamaños 1280×720, 1496×885 y 1280×720 en modo laptop. Capturas e informe en .revision/aviso-actualizacion/.
// Uso: npx electron tools/ui-check-aviso-actualizacion.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'aviso-actualizacion');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 720, false], [1496, 885, false], [1280, 720, true]];
const NOTES = ['Aviso de actualización abajo a la izquierda con las novedades', 'Arreglos en la barra lateral de la biblioteca', 'Mejoras de rendimiento en el análisis de BPM'];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(400);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}

// Lee en la página: rectángulo de la ventana, colores (contraste WCAG de texto y botones), animación y solapes
const PROBE = `(() => {
  const rgb = (c) => c.match(/[\\d.]+/g).map(Number);
  const lum = (c) => { const m = rgb(c); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(2); };
  const ind = document.querySelector('#upd-ind'), top = document.querySelector('#upd-top'), help = document.querySelector('#top-right .help-btn');
  const cs = getComputedStyle(ind), tcs = getComputedStyle(top);
  const btnC = (b) => { if (!b) return null; const s = getComputedStyle(b); const bg = rgb(s.backgroundColor)[3] === 0 ? cs.backgroundColor : s.backgroundColor; return ratio(s.color, bg); };
  const act = ind.querySelector('.upd-act'), later = ind.querySelector('.upd-later');
  const r = ind.getBoundingClientRect(), vis = !ind.hidden && r.width > 0;
  const over = (sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).filter(e => { const b = e.getBoundingClientRect();
    return b.width && b.height && !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom); }).map(e => e.className || e.tagName).slice(0, 5);
  const side = document.querySelector('#library .lib-side'), sb = side && side.offsetParent ? side.getBoundingClientRect() : null;
  const lib = document.querySelector('#library').getBoundingClientRect();
  return { vis, cls: ind.className, text: ind.textContent, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], w: Math.round(r.width), vw: innerWidth, vh: innerHeight,
    title: ind.querySelector('.upd-title')?.textContent || '', ver: ind.querySelector('.upd-ver')?.textContent || '', notes: [...ind.querySelectorAll('.upd-notes li')].map(l => l.textContent), notesVis: [...ind.querySelectorAll('.upd-notes li')].filter(l => l.offsetParent).length, tight: ind.classList.contains('tight'),
    btns: [...ind.querySelectorAll('button')].map(b => b.textContent),
    font: parseFloat(cs.fontSize), anim: cs.animationName, bg: cs.backgroundColor, fg: cs.color, cText: ratio(cs.color, cs.backgroundColor),
    cAct: btnC(act), cLater: btnC(later),
    top: { vis: !top.hidden && !!top.offsetParent, text: top.textContent, cls: top.className, anim: tcs.animationName, beforeHelp: top.nextElementSibling === help, c: ratio(tcs.color, tcs.backgroundColor) },
    bar: ind.querySelector('.upd-bar i')?.style.width || null,
    overControls: vis ? over('#dj-layout .deck .btn, #dj-layout .knob, #dj-layout .fader, .xfader, #mixer .btn, #fxbar .btn, #fxbar .knob, #fxbar select, #sampler .btn, #sampler button, #topbar .btn, #waves canvas') : [],
    onSide: !!sb && vis && r.left < sb.right && r.left <= 20, libTop: Math.round(lib.top), side: sb && [Math.round(sb.left), Math.round(sb.top), Math.round(sb.right), Math.round(sb.bottom)],
    aboveStatus: vis && r.bottom <= innerHeight - 18 + 1, laptop: document.body.classList.contains('laptop-mode') };
})()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const report = { errors: [], checks: {}, ok: true };
  let first = true;
  for (const [w, h, laptop] of SIZES) {
    const tag = `${w}x${h}${laptop ? '-laptop' : ''}`;
    const check = (name, cond, data) => { report.checks[`${tag} · ${name}`] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', tag, name, JSON.stringify(data)); } else console.log('✓', tag, name); };
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${tag} ${message} (${path.basename(src || '')}:${line})`); });
    const boot = async () => {
      await load(win);
      await wait(2200);
      await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
      const isLaptop = await js(win, `document.body.classList.contains('laptop-mode')`);
      if (isLaptop !== laptop) { await js(win, `nexuraApp.toggleLaptopMode(); true`); await wait(300); }
    };
    await load(win);
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_settings', JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, statsEnabled: false, lastVersion: '1.0.0-rc.2' })); true`);
    await boot();
    const U = 'nexuraApp.updatesUI';
    const cur = '1.0.0-rc.2'; // en modo navegador la versión es «web»: se simula la instalada
    const avail = `nexuraApp.info = { ...(nexuraApp.info || {}), version: '${cur}' }; ${U}.onEvent({ state: 'available', version: '1.0.0-rc.3', percent: 0, notes: ${JSON.stringify(NOTES)} }); true`;
    let s = await js(win, PROBE);
    check('Sin actualización: ni ventana ni botón', !s.vis && !s.top.vis, { s: { vis: s.vis, top: s.top.vis } });

    // ---- disponible
    await js(win, avail);
    await wait(1100); // mitad del pulso: halo visible en la captura
    s = await js(win, PROBE);
    await shot(win, `${tag}-01-disponible`);
    check('Disponible: título «Hay una versión nueva de Nexura»', s.vis && s.title === 'Hay una versión nueva de Nexura', { title: s.title });
    check('Disponible: versión actual → nueva', cur && s.ver.replace(/\s+/g, ' ').trim() === `${cur} → 1.0.0-rc.3`, { ver: s.ver, cur });
    check('Disponible: novedades de la release (3 líneas; con poco alto, las que caben)', s.notes.length === 3 && s.notes[0] === NOTES[0] && (h < 800 || s.notesVis === 3), { notes: s.notes, visibles: s.notesVis, tight: s.tight });
    check('Disponible: botones «Descargar ahora» (principal) y «Más tarde»', s.btns.join('|') === 'Descargar ahora|Más tarde', { btns: s.btns });
    check('Disponible: abajo a la izquierda, ~360 px, por encima de la barra de estado', s.rect[0] >= 8 && s.rect[0] <= 20 && s.w >= 340 && s.w <= 380 && s.aboveStatus, { rect: s.rect, w: s.w });
    check('Disponible: fondo ámbar, texto ≥ 14 px', s.bg === 'rgb(255, 163, 26)' && s.font >= 14, { bg: s.bg, font: s.font });
    check('Disponible: contraste texto y botones ≥ 4,5:1', s.cText >= 4.5 && s.cAct >= 4.5 && s.cLater >= 4.5, { cText: s.cText, cAct: s.cAct, cLater: s.cLater });
    check('Disponible: late (pulso) al aparecer', /pulse/.test(s.cls) && s.anim === 'upd-pulse' && s.top.anim === 'upd-pulse', { cls: s.cls, anim: s.anim, top: s.top.anim });
    check('Botón «⬆ Actualizar» en la barra superior, justo antes de «?», contraste ≥ 4,5:1', s.top.vis && /⬆ Actualizar/.test(s.top.text) && s.top.beforeHelp && s.top.c >= 4.5, s.top);
    check('No tapa decks, mezclador, crossfader, efectos, sampler ni formas de onda', s.vis && !s.overControls.length, { rect: s.rect, over: s.overControls });
    check('Queda encima de la barra lateral, sin subir por encima de la biblioteca', s.onSide && s.rect[1] >= s.libTop, { rect: s.rect, side: s.side, libTop: s.libTop, visibles: s.notesVis, tight: s.tight });

    // ---- reduced motion: sin animación
    const dbg = win.webContents.debugger;
    try { dbg.attach('1.3'); } catch (_) { /* ya enganchado */ }
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(200);
    s = await js(win, PROBE);
    check('prefers-reduced-motion: sin animación (ventana y botón)', s.anim === 'none' && s.top.anim === 'none', { anim: s.anim, top: s.top.anim });
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

    // ---- «Más tarde»: se cierra, el botón de arriba sigue y otra comprobación en la misma sesión no la reabre
    await js(win, `document.querySelector('#upd-later').click(); true`);
    await wait(150);
    s = await js(win, PROBE);
    await shot(win, `${tag}-02-mas-tarde-boton-arriba`);
    check('«Más tarde» la cierra y el botón de arriba sigue', !s.vis && s.top.vis, { vis: s.vis, top: s.top.vis });
    await js(win, avail); // comprobación de cada 6 h
    await wait(150);
    s = await js(win, PROBE);
    check('Otra comprobación en la misma sesión no la vuelve a abrir', !s.vis && s.top.vis, { vis: s.vis });
    if (first) {
      await boot(); // siguiente arranque
      await js(win, avail);
      await wait(200);
      s = await js(win, PROBE);
      check('En el siguiente arranque vuelve a salir', s.vis && s.title === 'Hay una versión nueva de Nexura', { vis: s.vis });
      await js(win, `document.querySelector('#upd-later').click(); true`);
      await wait(100);
    }
    await js(win, `window.__dl = 0; ${U}.download = function () { window.__dl++; }; document.querySelector('#upd-top').click(); true`);
    await wait(150);
    s = await js(win, PROBE);
    const dl = await js(win, `window.__dl`);
    check('El botón de arriba vuelve a abrir la ventana y descarga (como «Descargar ahora»)', s.vis && dl === 1, { vis: s.vis, dl });
    await js(win, `delete ${U}.download; true`);

    // ---- sin novedades en la release: sin lista
    await js(win, `${U}.onEvent({ state: 'available', version: '1.0.0-rc.3', percent: 0, notes: [] }); true`);
    await wait(100);
    s = await js(win, PROBE);
    check('Sin novedades en la release: sin lista, mismos botones', s.vis && !s.notes.length && s.btns.join('|') === 'Descargar ahora|Más tarde', { notes: s.notes, btns: s.btns });
    await js(win, avail);

    // ---- descargando
    await js(win, `${U}.onEvent({ state: 'downloading', version: '1.0.0-rc.3', percent: 45 }); true`);
    await wait(150);
    s = await js(win, PROBE);
    await shot(win, `${tag}-03-descargando`);
    check('Descargando: en la misma ventana, «Descargando… 45 %» con barra ámbar al 45 %', s.vis && s.rect[0] <= 20 && /^Descargando la versión nueva… 45 %$/.test(s.title) && /1\.0\.0-rc\.3/.test(s.ver) && s.bar === '45%' && /downloading/.test(s.cls) && s.rect[1] >= s.libTop && !s.overControls.length, { title: s.title, bar: s.bar, rect: s.rect, libTop: s.libTop });
    check('Descargando: sin pulso, contraste ≥ 4,5:1, botón «⬇ 45 %»', s.anim === 'none' && s.cText >= 4.5 && /⬇ 45 %/.test(s.top.text), { anim: s.anim, c: s.cText, top: s.top.text });

    // ---- lista
    await js(win, `${U}.onEvent({ state: 'downloaded', version: '1.0.0-rc.3', percent: 100 }); true`);
    await wait(1100);
    s = await js(win, PROBE);
    await shot(win, `${tag}-04-lista`);
    check('Lista: verde con «Reiniciar para actualizar», «Más tarde» y pulso', s.vis && s.bg === 'rgb(63, 214, 164)' && /lista para instalar/.test(s.title) && s.btns.join('|') === 'Reiniciar para actualizar|Más tarde' && s.anim === 'upd-pulse', { bg: s.bg, title: s.title, btns: s.btns, anim: s.anim });
    check('Lista: contraste texto y botones ≥ 4,5:1 (también el de arriba)', s.cText >= 4.5 && s.cAct >= 4.5 && s.cLater >= 4.5 && s.top.c >= 4.5 && /⬆ Actualizar/.test(s.top.text), { cText: s.cText, cAct: s.cAct, cLater: s.cLater, top: s.top.c });
    check('Lista: no tapa controles ni sube por encima de la biblioteca', !s.overControls.length && s.aboveStatus && s.rect[0] <= 20 && s.rect[1] >= s.libTop, { rect: s.rect, over: s.overControls, libTop: s.libTop });

    // ---- al cerrar (un deck sonando: no reinicia)
    await js(win, `nexuraApp.decks[0].playing = true; true`);
    await js(win, `document.querySelector('#upd-install').click(); true`);
    await wait(250);
    s = await js(win, PROBE);
    const toasts = await js(win, `[...document.querySelectorAll('.toast')].map(t => t.textContent)`);
    await shot(win, `${tag}-05-al-cerrar`);
    check('Con música: «Se instalará al cerrar Nexura» en la misma ventana y aviso', s.vis && s.rect[0] <= 20 && /Se instalará al cerrar Nexura/.test(s.title) && /deferred/.test(s.cls) && toasts.some(t => /cuando cierres/.test(t)) && s.rect[1] >= s.libTop && !s.overControls.length, { title: s.title, toasts, rect: s.rect, libTop: s.libTop });
    check('Al cerrar: contraste ≥ 4,5:1 y sin pulso', s.cText >= 4.5 && s.cAct >= 4.5 && s.anim === 'none', { c: s.cText, cAct: s.cAct, anim: s.anim });
    const tb = await js(win, `(() => { const c = document.querySelector('#upd-ind').getBoundingClientRect();
      return [...document.querySelectorAll('.toast')].some(t => { const b = t.getBoundingClientRect(); return !(b.right <= c.left || b.left >= c.right || b.bottom <= c.top || b.top >= c.bottom); }); })()`);
    check('Los avisos (toasts) no tapan la ventana', tb === false, { tb });
    await js(win, `nexuraApp.decks[0].playing = false; true`);

    // ---- el pulso se para a los 30 s (solo una vez: espera real)
    if (first) {
      first = false;
      await js(win, `${U}.deferred = false; ${U}.onEvent({ state: 'available', version: '1.0.0-rc.4', percent: 0, notes: ${JSON.stringify(NOTES.slice(0, 2))} }); true`);
      await wait(300);
      s = await js(win, PROBE);
      const t0 = Date.now();
      check('Nueva versión: vuelve a latir', s.anim === 'upd-pulse', { anim: s.anim });
      await wait(30800);
      s = await js(win, PROBE);
      await shot(win, `${tag}-06-fija-tras-30s`);
      check('Tras 30 s queda fija en ámbar, sin parpadear', s.vis && s.anim === 'none' && !/pulse/.test(s.cls) && s.top.anim === 'none' && s.bg === 'rgb(255, 163, 26)', { anim: s.anim, cls: s.cls, ms: Date.now() - t0 });
    }
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  const n = Object.keys(report.checks).length, ok = Object.values(report.checks).filter(c => c.ok).length;
  if (report.errors.length) console.log('errores de consola:', report.errors.slice(0, 10));
  console.log(`${ok}/${n} comprobaciones correctas${report.errors.length ? ` · ${report.errors.length} errores de consola` : ''}`);
  app.exit(report.ok ? 0 : 1);
});
