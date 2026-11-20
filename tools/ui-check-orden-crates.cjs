// Botón ⇅ «Ordenar crates» de la cabecera CRATES, con Electron contra `npm run web`: se ve a 1280 y 375 px
// junto a «+ Nuevo» (mismo alto), aria-label y tooltip con el orden actual, abre el menú con ✓ en el actual
// y cada opción cambia el orden del árbol. Capturas e informe en .revision/orden-crates/.
// Uso: npx electron tools/ui-check-orden-crates.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'orden-crates');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// orden del array (personalizado) ≠ por nombre ≠ por fecha de creación
function seed() {
  const now = Date.now();
  return {
    library: { version: 1, tracks: [], smart: [], history: [], prepare: [], ytPlaylists: [], crates: [
      { id: 'm', name: 'Medio', ids: [], created: now - 2000 },
      { id: 'z', name: 'Zeta', ids: [], created: now - 3000 },
      { id: 'a', name: 'Alfa', ids: [], created: now - 1000 }] },
    settings: { libView: 'all', crateSort: 'custom', waveLayout: 'serato', libSideW: 230 }
  };
}
const EXPECT = { custom: 'Medio,Zeta,Alfa', alpha: 'Alfa,Medio,Zeta', created: 'Zeta,Medio,Alfa' };
const LABEL = { created: 'Como se crearon', alpha: 'Por nombre (A → Z)', custom: 'Personalizado (arrastrar)' };

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(400);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
const state = `(() => {
  const b = document.querySelector('[data-sec="crates"] .sec-ico'), n = document.querySelector('[data-sec="crates"] .sec-btn:not(.sec-ico)');
  const r = b && b.getBoundingClientRect(), rn = n && n.getBoundingClientRect();
  return { hay: !!b, visible: !!r && r.width > 0 && r.height > 0 && r.right <= innerWidth, w: r && Math.round(r.width), h: r && Math.round(r.height), hNuevo: rn && Math.round(rn.height),
    junto: !!(r && rn) && Math.abs(r.top - rn.top) < 2 && r.left - rn.right < 12 && r.left > rn.right - 1,
    aria: b && b.getAttribute('aria-label'), title: b && b.title,
    orden: [...document.querySelectorAll('[data-sec="crates"] .side-item')].map(x => x.querySelector('.si-label').textContent).join(','),
    ajuste: nexuraApp.settings.crateSort }; })()`;
const menu = `[...document.querySelectorAll('.ctx.root .ctx-item')].map(x => x.textContent.trim())`;
const choose = (label) => `(() => { const it = [...document.querySelectorAll('.ctx.root .ctx-item')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (!it) return false; it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const check = (name, cond, data) => { report.checks[`${tag} · ${name}`] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', tag, name, JSON.stringify(data)); } else console.log('✓', tag, name); };
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${tag} ${message} (${path.basename(src || '')}:${line})`); });
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    // en 375 px el árbol está oculto: ☰ lo muestra
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove());
      const ui = nexuraApp.libraryUI; if (!ui.side.offsetWidth) ui.sideToggle.click();
      document.querySelector('#library').scrollIntoView({ block: 'end' }); document.querySelector('[data-sec="crates"]').scrollIntoView({ block: 'center' }); true`);
    await wait(300);
    let s = await js(win, state);
    await shot(win, `${tag}-01-boton`);
    check('Botón ⇅ visible junto a «+ Nuevo», mismo alto', s.hay && s.visible && s.junto && s.h === s.hNuevo && s.w === s.h, s);
    check('aria-label «Ordenar crates» y tooltip con el orden actual', s.aria === 'Ordenar crates' && s.title.includes(LABEL.custom), { aria: s.aria, title: s.title });
    check('Orden inicial personalizado', s.orden === EXPECT.custom, { orden: s.orden });

    for (const k of ['alpha', 'created', 'custom']) {
      await js(win, `document.querySelector('[data-sec="crates"] .sec-ico').click(); true`);
      await wait(200);
      const items = await js(win, menu);
      if (k === 'alpha') {
        await shot(win, `${tag}-02-menu`);
        check('Menú con los 3 textos y ✓ en el actual', Array.isArray(items) && items.length === 3 && items[0].includes(LABEL.created) && items[1].includes(LABEL.alpha) && items[2].includes(LABEL.custom) && items.filter(x => x.startsWith('✓')).length === 1 && items[2].startsWith('✓'), { items });
      }
      const ok = await js(win, choose(LABEL[k]));
      await wait(250);
      await js(win, `nexuraApp.closeMenus?.(); true`);
      s = await js(win, state);
      check(`«${LABEL[k]}» cambia el orden`, ok && s.ajuste === k && s.orden === EXPECT[k] && s.title.includes(LABEL[k]), { ok, ajuste: s.ajuste, orden: s.orden, title: s.title });
      if (k === 'alpha') await shot(win, `${tag}-03-por-nombre`);
    }
    win.destroy();
  }
  if (report.errors.length) report.ok = false;
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? 'TODO OK' : 'HAY FALLOS', report.errors.length ? report.errors : '');
  app.exit(report.ok ? 0 : 1);
});
