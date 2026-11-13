// 1.0.0-rc.2 en la interfaz, con Electron contra `npm run web` (1280×800 y 375×812):
// Ajustes → YouTube con la clave y el Client secret ocultos («AIza••••••••»), 👁, «Comprobar clave» (Google
// simulado en la página: correcta y cuota agotada), que todo quepa; novedades (menú «?» → «Novedades de esta
// versión»); en el navegador no sale el aviso de actualización (versión «web»).
// Capturas e informe en .revision/rc2/. Uso: npx electron tools/ui-check-rc2.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'rc2');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const KEY = 'AIzaSyPRUEBA-no-es-real-123';
const SETTINGS = { welcomeDone: true, statsEnabled: false, ytApiKey: KEY, ytClientSecret: 'GOCSPX-secreto-de-prueba', lastVersion: '1.0.0-rc.1' };

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(400);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
const fits = `(() => { const m = [...document.querySelectorAll('.modal')].pop(); if (!m) return null; const r = m.getBoundingClientRect(); const b = m.querySelector('.modal-body') || m;
  const s = [...m.querySelectorAll('.secret-box')].map(x => x.getBoundingClientRect().right);
  return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, sw: document.documentElement.scrollWidth, inner: Math.max(m.scrollWidth - m.clientWidth, b.scrollWidth - b.clientWidth), secret: Math.round(Math.max(0, ...s)) }; })()`;
const ok = (o) => o && o.left >= 0 && o.right <= o.vw && o.sw <= o.vw && o.inner <= 1 && o.secret <= o.right;

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
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(SETTINGS))}); true`);
    await load(win);
    await wait(2200);
    await js(win, `document.querySelector('.start-overlay')?.remove(); true`);

    let s = await js(win, `[...document.querySelectorAll('.toast')].map(t => t.textContent)`);
    check('Modo navegador: sin aviso «se ha actualizado» (versión «web»)', Array.isArray(s) && !s.some(t => /se ha actualizado/.test(t)), { s });

    // Google simulado en la página (las peticiones del navegador van con fetch)
    await js(win, `(() => { const real = window.fetch; window.__gk = []; window.fetch = async (u, o) => { const url = String(u); if (!url.startsWith('https://www.googleapis.com/')) return real(u, o);
      const k = new URL(url).searchParams.get('key'); window.__gk.push(k);
      if (k === 'AIzaCUOTA') return new Response(JSON.stringify({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 });
      return new Response(JSON.stringify({ items: [] }), { status: 200 }); }; return true; })()`);
    await js(win, `nexuraApp.settingsUI.open('youtube'); true`);
    await wait(600);
    s = await js(win, `(() => { const f = [...document.querySelectorAll('.secret-box input.secret')]; return { k: f[0]?.value, c: f[1]?.value, leak: document.querySelector('.set-page').outerHTML.includes(${JSON.stringify(KEY)}) || [...document.querySelectorAll('input')].some(i => i.value === ${JSON.stringify(KEY)}) }; })()`);
    check('Clave y Client secret ocultos («AIza••••••••», «GOCS••••••••»)', s.k === 'AIza••••••••' && s.c === 'GOCS••••••••' && !s.leak, s);
    s = await js(win, fits);
    check('Ajustes → YouTube cabe en la pantalla (campo de clave incluido)', ok(s), s);
    await shot(win, `11-web-ajustes-youtube-${tag}`);
    await js(win, `document.querySelector('.secret-box .eye').click(); true`);
    await wait(150);
    s = await js(win, `document.querySelector('.secret-box input.secret').value`);
    check('👁 enseña la clave', s === KEY, { s });
    await shot(win, `12-web-clave-visible-${tag}`);
    await js(win, `document.querySelector('.secret-box .eye').click(); true`);
    s = await js(win, `document.querySelector('.secret-box input.secret').value`);
    check('👁 otra vez la oculta en el acto', s === 'AIza••••••••', { s });

    await js(win, `[...document.querySelectorAll('.set-page button')].find(b => b.textContent === 'Comprobar clave').click(); true`);
    await wait(400);
    s = await js(win, `({ msg: document.querySelector('.key-check').textContent, gk: window.__gk })`);
    check('Comprobar clave (correcta) con la clave guardada', s.msg === '✓ Clave correcta' && s.gk[s.gk.length - 1] === KEY, s);
    await js(win, `(() => { const k = document.querySelector('.secret-box input.secret'); k.dispatchEvent(new Event('focus')); k.value = 'AIzaCUOTA'; k.dispatchEvent(new Event('blur')); return true; })()`);
    await js(win, `[...document.querySelectorAll('.set-page button')].find(b => b.textContent === 'Comprobar clave').click(); true`);
    await wait(400);
    s = await js(win, `({ msg: document.querySelector('.key-check').textContent, saved: nexuraApp.settings.ytApiKey })`);
    check('Comprobar clave (cuota agotada): mensaje claro', /gastado toda su cuota/.test(s.msg) && s.saved === 'AIzaCUOTA', s);
    s = await js(win, fits);
    check('Con el mensaje largo sigue cabiendo', ok(s), s);
    await shot(win, `13-web-clave-cuota-${tag}`);
    await js(win, `nexuraApp.closeModal(); true`);

    // Novedades desde el menú «?»
    await js(win, `document.querySelector('.help-btn').click(); true`);
    await wait(300);
    s = await js(win, `(() => { const b = [...document.querySelectorAll('.ctx-item')].find(x => x.textContent.trim() === 'Novedades de esta versión'); if (!b) return false; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
    await wait(700);
    const notes = await js(win, `(() => { const n = document.querySelector('.notes'); return n ? { h3: n.querySelectorAll('h3').length, li: n.querySelectorAll('li').length } : null; })()`);
    check('Menú «?» → «Novedades de esta versión» abre las notas', s === true && notes && notes.h3 >= 1 && notes.li >= 1, { s, notes });
    // el contenido de la rc.2 se comprueba en su propia sección, buscada por su versión (no la primera del archivo)
    await js(win, `nexuraApp.closeModal(); nexuraApp.notes.show('1.0.0-rc.2'); true`);
    await wait(700);
    const rc2 = await js(win, `(() => { const m = [...document.querySelectorAll('.modal')].pop(); const n = m && m.querySelector('.notes'); return n ? { text: m.textContent, h3: n.querySelectorAll('h3').length, li: n.querySelectorAll('li').length } : null; })()`);
    check('Notas de la 1.0.0-rc.2 (por su versión): apartados, puntos y «Comprobar clave»', rc2 && rc2.text.includes('1.0.0-rc.2') && rc2.h3 >= 3 && rc2.li >= 8 && /Comprobar clave/.test(rc2.text), rc2 && { h3: rc2.h3, li: rc2.li });
    s = await js(win, fits);
    check('Novedades caben en la pantalla', ok(s), s);
    await shot(win, `14-web-novedades-${tag}`);
    win.destroy();
  }
  report.errors = report.errors.filter(e => !/favicon|iframe_api|youtube\.com/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.writeFileSync(path.join(OUT, 'informe-web.json'), JSON.stringify(report, null, 2));
  const n = Object.values(report.checks);
  console.log(`\n${n.filter(c => c.ok).length}/${n.length} comprobaciones · ${report.ok ? 'TODO OK' : 'HAY FALLOS'} · informe en .revision/rc2/informe-web.json`);
  app.exit(report.ok ? 0 : 1);
});
