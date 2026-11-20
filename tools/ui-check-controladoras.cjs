// Controladoras al conectar (encargo CONTROLADORAS), con Electron contra `node tools/serve.js` (5180).
// navigator.requestMIDIAccess se sustituye por uno falso en el que se «enchufan» y «desenchufan» puertos
// (window.__midi.plug / unplug, que avisan con onstatechange como el navegador). Se comprueba:
// - al arrancar con una DDJ-FLX4: «Controladora Pioneer DJ DDJ-FLX4 detectada: perfil cargado», su perfil
//   traduce los controles y la app le envía LEDs y vúmetros;
// - al conectar en caliente un dispositivo sin perfil: aviso con «Configurar con el asistente», «Importar un
//   mapeo de Mixxx» (con el enlace a la lista oficial de Mixxx) y «Ahora no»; el asistente se abre; «Ahora no»
//   se recuerda (al reconectarlo no vuelve a salir) y se puede volver a abrir desde Ajustes → MIDI;
// - Ajustes → MIDI: cada controladora con su tipo de perfil, el selector de perfil y la lista de modelos;
// - el informe de errores lleva las controladoras (puerto y tipo de perfil) y el campo «¿Qué controladora usas?»;
// - capturas a 375 px y 1280 px en .revision/controladoras; sin errores en la consola.
// Uso: npx electron tools/ui-check-controladoras.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const URL = (process.argv.find(a => a.startsWith('--url=')) || '').slice(6) || process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SHOTS = path.join(__dirname, '..', '.revision', 'controladoras');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-ctl-'));
const preload = path.join(tmp, 'midi-falso.js');
fs.writeFileSync(preload, `
  window.__midiOut = []; window.__toasts = [];
  const access = { inputs: new Map(), outputs: new Map(), onstatechange: null, sysexEnabled: true };
  const port = (kind, name) => ({ id: kind + ':' + name, name, manufacturer: '', state: 'connected', type: kind, onmidimessage: null,
    send(b) { window.__midiOut.push({ name, b: Array.from(b) }); } });
  window.__midi = {
    access,
    plug(name) { access.inputs.set('input:' + name, port('input', name)); access.outputs.set('output:' + name, port('output', name)); if (access.onstatechange) access.onstatechange({ port: access.inputs.get('input:' + name) }); return true; },
    unplug(name) { access.inputs.delete('input:' + name); access.outputs.delete('output:' + name); if (access.onstatechange) access.onstatechange({}); return true; },
    msg(name, bytes) { const i = access.inputs.get('input:' + name); if (i && i.onmidimessage) i.onmidimessage({ data: new Uint8Array(bytes) }); return true; }
  };
  window.__midi.plug('DDJ-FLX4');
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, value: () => Promise.resolve(access) });
  // avisos (toasts): se guardan al aparecer, porque se van solos
  new MutationObserver(() => { for (const t of document.querySelectorAll('#toasts .toast')) if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent); } })
    .observe(document, { childList: true, subtree: true });
`);

const LIB = { version: 1, tracks: [], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] };
const SETTINGS = { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, libView: 'all', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9' };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function until(win, code, ms = 5000) {
  const t0 = Date.now(); let v;
  while (Date.now() - t0 < ms) { v = await js(win, code); if (v && !v.error) return v; await wait(100); }
  return v;
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let pass = 0, fail = 0;
  const check = (name, ok, data) => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && data !== undefined ? ' → ' + JSON.stringify(data).slice(0, 600) : ''}`); };
  const errors = [];
  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true, contextIsolation: false, preload } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  const shot = async (name) => { fs.mkdirSync(SHOTS, { recursive: true }); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  try {
    await win.loadURL(URL);
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(LIB))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(SETTINGS))}); true`);
    await win.loadURL(URL);
    await until(win, `window.nexuraApp && nexuraApp.midi && nexuraApp.midi.catalogLoaded && nexuraApp.midi.devState.size ? true : null`, 8000);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);

    // ---- 1. dispositivo con perfil incluido (conectado al arrancar)
    let t = await until(win, `window.__toasts.find(x => /detectada/.test(x)) || null`, 4000);
    check('Al arrancar con una DDJ-FLX4: «Controladora Pioneer DJ DDJ-FLX4 detectada: perfil cargado»', t === 'Controladora Pioneer DJ DDJ-FLX4 detectada: perfil cargado', { t, all: await js(win, 'window.__toasts') });
    let s = await js(win, `(() => { const m = nexuraApp.midi; return { info: m.profileInfo('DDJ-FLX4'), play: m.describeMapping('DDJ-FLX4', 'n0:11'), jog: m.describeMapping('DDJ-FLX4', 'c0:34'), notice: !!document.querySelector('.ctl-notice') }; })()`);
    check('…perfil incluido: PLAY (nota 0Bh, canal 1) → Play/Pausa del Deck 1 y jog (CC 22h) → jog del Deck 1, sin aviso de configuración', s.info.type === 'incluido' && /Play\/Pausa \(Deck 1\)/.test(s.play) && /Jog .*\(Deck 1\)/.test(s.jog) && !s.notice, s);
    // un mensaje real por el puerto: el crossfader se mueve
    const xf0 = await js(win, `nexuraApp.engine.xfValue`);
    await js(win, `window.__midi.msg('DDJ-FLX4', [0xB6, 0x1F, 0x7F]); true`);
    const xf1 = await js(win, `nexuraApp.engine.xfValue`);
    await js(win, `window.__midi.msg('DDJ-FLX4', [0xB6, 0x1F, 0x40]); true`);
    check('…un mensaje del crossfader (CC 1Fh, canal 7) mueve el crossfader de la app', xf1 === 1 && Math.abs(await js(win, `nexuraApp.engine.xfValue`) - 64 / 127) < 1e-6, { xf0, xf1 });
    await wait(400);
    s = await js(win, `(() => { const o = window.__midiOut.filter(x => x.name === 'DDJ-FLX4').map(x => x.b); return { n: o.length, vinyl: o.some(b => b[0] === 0x90 && b[1] === 0x17), play: o.some(b => b[0] === 0x90 && b[1] === 0x0B), vu: o.some(b => b[0] === 0xB0 && b[1] === 0x02), bad: o.filter(b => b.length !== 3 || b.some(x => x < 0 || x > 255) || b[1] > 127 || b[2] > 127).length }; })()`);
    check(`…la app le envía LEDs (PLAY, VINYL) y el vúmetro (CC 02h), con mensajes válidos (${s.n})`, s.vinyl && s.play && s.vu && !s.bad, s);

    // ---- 2. dispositivo sin perfil (en caliente): aviso con tres opciones
    await js(win, `window.__toasts.length = 0; window.__midi.plug('Arturia BeatStep'); true`);
    s = await until(win, `(() => { const n = [...document.querySelectorAll('.ctl-notice')].find(x => /Arturia BeatStep/.test(x.textContent)); return n ? { text: n.textContent, btns: [...n.querySelectorAll('button')].map(b => b.textContent) } : null; })()`, 3000);
    check('Al conectar un dispositivo desconocido: aviso «Controladora Arturia BeatStep detectada» con las tres opciones', s && /No hay un perfil incluido/.test(s.text) && JSON.stringify(s.btns) === JSON.stringify(['Configurar con el asistente', 'Importar un mapeo de Mixxx', 'Ahora no']), s);
    await win.setContentSize(375, 812); await wait(300); await shot('375-aviso-sin-perfil');
    s = await js(win, `(() => { const r = document.querySelector('.ctl-notice').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; })()`);
    check('…a 375 px el aviso cabe en la pantalla', s.l >= 0 && s.r <= s.w, s);
    await win.setContentSize(1280, 800); await wait(300); await shot('1280-aviso-sin-perfil');
    // asistente
    await js(win, `document.querySelector('.ctl-notice .ctl-wizard').click(); true`);
    s = await until(win, `(() => { const m = document.querySelector('.modal'); return m && m.querySelector('.wizard') ? { title: m.querySelector('h2').textContent, dev: m.querySelector('select') && m.querySelector('select').value, notice: !!document.querySelector('.ctl-notice') } : null; })()`, 3000);
    check('«Configurar con el asistente» abre el asistente con ese dispositivo y cierra el aviso', s && s.title === 'Añadir controladora' && s.dev === 'Arturia BeatStep' && !s.notice, s);
    await js(win, `nexuraApp.closeModal(); true`); await wait(200);
    // reconectar: vuelve a salir (no dijo «Ahora no»); Mixxx
    await js(win, `window.__midi.unplug('Arturia BeatStep'); window.__midi.plug('Arturia BeatStep'); true`);
    s = await until(win, `document.querySelector('.ctl-notice .ctl-mixxx') ? true : null`, 3000);
    check('Al reconectarlo sin haber dicho «Ahora no», el aviso vuelve a salir', s === true, s);
    await js(win, `document.querySelector('.ctl-notice .ctl-mixxx').click(); true`);
    s = await until(win, `(() => { const m = document.querySelector('.modal'); return m && /Importar un mapeo de Mixxx/.test(m.querySelector('h2').textContent) ? { link: !!m.querySelector('.mixxx-link'), linkText: m.querySelector('.mixxx-link')?.textContent, btns: [...m.querySelectorAll('.modal-foot button')].map(b => b.textContent) } : null; })()`, 3000);
    check('«Importar un mapeo de Mixxx» explica de dónde sacarlo, con el enlace a la página oficial y «Elegir archivo…»', s && s.link && /Mixxx/.test(s.linkText) && s.btns.includes('Elegir archivo…'), s);
    s = await js(win, `(async () => { let url = null; const o = nexuraApp.platform.openExternal; nexuraApp.platform.openExternal = (u) => { url = u; }; document.querySelector('.mixxx-link').click(); nexuraApp.platform.openExternal = o; return url; })()`);
    check('…el enlace abre la lista oficial de controladoras del manual de Mixxx', s === 'https://manual.mixxx.org/latest/en/hardware/manuals', s);
    // «Elegir archivo…» abre el selector (input type=file)
    s = await js(win, `(() => { let clicked = null; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') clicked = this.accept; else orig.call(this); }; [...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Elegir archivo…').click(); return new Promise(r => setTimeout(() => { HTMLInputElement.prototype.click = orig; r(clicked); }, 100)); })()`);
    check('…y «Elegir archivo…» abre el selector de archivos .midi.xml que ya existía', /\.midi\.xml/.test(s || ''), s);
    // un mapeo de Mixxx de prueba (escrito aquí, no copiado de Mixxx): queda como «importado»
    s = await js(win, `(async () => {
      const { parseMixxxMapping } = await import('./js/midi/mixxx-import.js');
      const xml = '<MixxxControllerPreset><info><name>Prueba</name></info><controller><controls><control><group>[Channel1]</group><key>play</key><status>0x90</status><midino>0x01</midino></control></controls></controller></MixxxControllerPreset>';
      nexuraApp.midi.applyProfile('Arturia BeatStep', parseMixxxMapping(xml, nexuraApp.actions), true);
      const r = nexuraApp.midi.profileInfo('Arturia BeatStep').type; nexuraApp.midi.clearDevice('Arturia BeatStep'); return r; })()`);
    check('Con un mapeo de Mixxx aplicado, el tipo de perfil es «importado»', s === 'importado', s);
    // «Ahora no»: se recuerda
    await js(win, `window.__midi.unplug('Arturia BeatStep'); window.__midi.plug('Arturia BeatStep'); true`);
    await until(win, `document.querySelector('.ctl-notice .ctl-later') ? true : null`, 3000);
    await js(win, `document.querySelector('.ctl-notice .ctl-later').click(); true`);
    s = await js(win, `({ notice: !!document.querySelector('.ctl-notice'), dismissed: nexuraApp.settings.midiDismissed, saved: JSON.parse(localStorage.getItem('nexura_settings') || '{}').midiDismissed })`);
    check('«Ahora no» cierra el aviso y lo recuerda para ese dispositivo', !s.notice && (s.dismissed || []).includes('Arturia BeatStep'), s);
    await js(win, `window.__midi.unplug('Arturia BeatStep'); window.__midi.plug('Arturia BeatStep'); true`);
    await wait(800);
    s = await js(win, `!!document.querySelector('.ctl-notice')`);
    check('…al reconectarlo, el aviso ya no sale', s === false, s);

    // ---- 3. Ajustes → MIDI
    await js(win, `nexuraApp.settingsUI.open('midi'); true`);
    s = await until(win, `(() => { const li = [...document.querySelectorAll('.dev-list li.ctl-dev')]; return li.length ? { devs: li.map(l => ({ dev: l.dataset.dev, type: l.dataset.type, text: l.querySelector('.ctl-type').textContent, select: !!l.querySelector('select.ctl-profile'), reopen: !!l.querySelector('.ctl-reopen'), btns: [...l.querySelectorAll('button')].map(b => b.textContent) })), models: [...document.querySelectorAll('.ctl-models li')].map(x => x.querySelector('b').textContent) } : null; })()`, 3000);
    const flx = s && s.devs.find(d => d.dev === 'DDJ-FLX4'), art = s && s.devs.find(d => d.dev === 'Arturia BeatStep');
    check('Ajustes → MIDI: la DDJ-FLX4 con «perfil incluido: Pioneer DJ DDJ-FLX4» y selector de perfil', flx && flx.type === 'incluido' && /perfil incluido: Pioneer DJ DDJ-FLX4/.test(flx.text) && flx.select, flx);
    check('…el dispositivo desconocido como «sin perfil», con asistente, Mixxx y «Mostrar el aviso de configuración»', art && art.type === 'ninguno' && /sin perfil/.test(art.text) && art.reopen && art.btns.some(b => /asistente/.test(b)) && art.btns.some(b => /Mixxx/.test(b)), art);
    check(`…lista de modelos con perfil incluido (${s && s.models.length})`, s && s.models.length >= 9 && ['Denon DJ MC4000', 'Pioneer DJ DDJ-400', 'Pioneer DJ DDJ-FLX4', 'Pioneer DJ DDJ-SB3', 'Hercules DJControl Inpulse 300', 'Reloop Mixon 4'].every(n => s.models.includes(n)), s && s.models);
    await shot('1280-ajustes-midi');
    await win.setContentSize(375, 812); await wait(300); await shot('375-ajustes-midi');
    s = await js(win, `(() => { const m = document.querySelector('.modal'); const r = m.getBoundingClientRect(); const over = [...m.querySelectorAll('.dev-list button, .dev-list select')].filter(b => b.getBoundingClientRect().right > innerWidth + 1).length; return { w: innerWidth, right: r.right, over }; })()`);
    check('…a 375 px los botones de cada controladora no se salen de la pantalla', s.over === 0, s);
    await win.setContentSize(1280, 800); await wait(200);
    // cambiar el perfil a «Ninguno» y volver a Automático
    s = await js(win, `(() => { const sel = document.querySelector('li.ctl-dev[data-dev="DDJ-FLX4"] select.ctl-profile'); sel.value = 'none'; sel.dispatchEvent(new Event('change')); const a = nexuraApp.midi.profileInfo('DDJ-FLX4').type; const b = nexuraApp.midi.describeMapping('DDJ-FLX4', 'n0:11'); const s2 = document.querySelector('li.ctl-dev[data-dev="DDJ-FLX4"] select.ctl-profile'); s2.value = ''; s2.dispatchEvent(new Event('change')); return { a, b, c: nexuraApp.midi.profileInfo('DDJ-FLX4').type }; })()`);
    check('…el selector cambia el perfil («Ninguno» lo desactiva; «Automático» lo recupera)', s.a === 'ninguno' && s.b === '' && s.c === 'incluido', s);
    // volver a abrir el aviso desde Ajustes
    await js(win, `document.querySelector('li.ctl-dev[data-dev="Arturia BeatStep"] .ctl-reopen').click(); true`);
    s = await until(win, `(() => { const n = document.querySelector('.ctl-notice'); return n ? { text: n.textContent, dismissed: nexuraApp.settings.midiDismissed, modal: !!document.querySelector('.modal') } : null; })()`, 2000);
    check('«Mostrar el aviso de configuración» vuelve a abrir el aviso y olvida el «Ahora no»', s && /Arturia BeatStep/.test(s.text) && !(s.dismissed || []).includes('Arturia BeatStep'), s);
    await js(win, `document.querySelector('.ctl-notice .ctl-later').click(); true`);

    // ---- 4. informe de errores
    s = await js(win, `JSON.stringify(nexuraApp.feedback.context().controllers)`);
    check('Diagnóstico: controladoras conectadas con su tipo de perfil', /"port":"DDJ-FLX4","type":"incluido","model":"Pioneer DJ DDJ-FLX4"/.test(s) && /"port":"Arturia BeatStep","type":"ninguno"/.test(s), s);
    await js(win, `nexuraApp.feedback.open('error'); true`);
    s = await until(win, `(() => { const p = document.querySelector('#fb-preview'); const c = document.querySelector('#fb-controller'); return p && /Controladoras conectadas/.test(p.textContent) ? { prev: p.textContent.split('\\n').find(l => /Controladoras conectadas/.test(l)), field: c && c.value, label: c && c.closest('label').textContent } : null; })()`, 3000);
    check('El registro técnico del informe enseña «Controladoras conectadas: DDJ-FLX4 (perfil incluido: …) · Arturia BeatStep (sin perfil)»', s && /DDJ-FLX4 \(perfil incluido: Pioneer DJ DDJ-FLX4\)/.test(s.prev) && /Arturia BeatStep \(sin perfil\)/.test(s.prev), s);
    check('…y el formulario tiene «¿Qué controladora usas? (opcional)», rellenado con la conectada', s && /¿Qué controladora usas\?/.test(s.label) && s.field === 'DDJ-FLX4', s);
    await win.setContentSize(375, 812); await wait(300); await shot('375-informe');
    await win.setContentSize(1280, 800); await wait(200);
    s = await js(win, `(async () => { let sent = null; window.__nexuraReportMock = { send: (i) => { sent = i; return { ok: true }; } }; document.querySelector('#fb-text').value = 'Prueba'; document.querySelector('#fb-controller').value = 'Numark Mixtrack Pro 3'; [...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Enviar').click(); await new Promise(r => setTimeout(r, 300)); return sent && { uc: sent.userController, ctl: sent.controllers }; })()`);
    check('…lo escrito en «¿Qué controladora usas?» se envía con el informe', s && s.uc === 'Numark Mixtrack Pro 3' && s.ctl.length === 2, s);
  } catch (e) { check('la prueba ha fallado', false, String(e && e.stack || e)); }
  const errs = errors.filter(e => !/favicon|ERR_/i.test(e));
  check('Sin errores en la consola', !errs.length, errs);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ }
  console.log(`\n${pass}/${pass + fail} comprobaciones de controladoras correctas`);
  app.exit(fail ? 1 : 0);
});
