// Pruebas de la lógica de actualizaciones (main/updater.js) con un autoUpdater simulado.
// node tools/test-actualizaciones.mjs
import { createRequire } from 'module';
import { EventEmitter } from 'events';
const require = createRequire(import.meta.url);
const { createUpdater, notesText, isPrerelease, allowPrereleaseFor, EVERY } = require('../main/updater.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const tick = () => new Promise(r => setTimeout(r, 5));

function fake(result) {
  const u = new EventEmitter();
  u.calls = { check: 0, download: 0, quit: 0 };
  u.checkForUpdates = async () => {
    u.calls.check++;
    u.lastPrerelease = u.allowPrerelease;
    const r = typeof result === 'function' ? result(u) : result;
    if (r === 'offline') { u.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')); throw new Error('net'); }
    if (r === 'none') u.emit('update-not-available', {});
    if (r && r.version) u.emit('update-available', r);
  };
  u.downloadUpdate = async () => { u.calls.download++; u.emit('download-progress', { percent: 42.4 }); u.emit('update-downloaded', { version: '1.0.1' }); };
  u.quitAndInstall = () => { u.calls.quit++; };
  return u;
}
function setup(result) {
  const events = [], timers = [], repeats = [], backups = [];
  const au = fake(result);
  const up = createUpdater({
    autoUpdater: au, send: (e) => events.push(e), log: () => {},
    beforeInstall: async (r) => backups.push(r),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return 0; }, setRepeat: (fn, ms) => { repeats.push({ fn, ms }); return 0; }
  });
  return { au, up, events, timers, repeats, backups };
}

console.log('Comprobación en segundo plano');
let s = setup('none');
s.up.configure({ auto: true, prerelease: false });
ok(s.au.autoDownload === false && s.au.autoInstallOnAppQuit === true, 'no descarga sola; si queda descargada se instala al cerrar');
ok(s.timers.length === 1 && s.timers[0].ms === 15000, 'primera comprobación 15 s después de arrancar');
ok(s.repeats.length === 1 && s.repeats[0].ms === EVERY && EVERY === 6 * 3600e3, 'y cada 6 horas');
await s.timers[0].fn(); await tick();
ok(s.au.calls.check === 1 && s.events.length === 0, 'sin novedades: no se muestra nada');

s = setup('none');
s.up.configure({ auto: false });
ok(s.timers.length === 0, 'con «Buscar actualizaciones automáticamente» desactivado no comprueba al arrancar');
s.repeats[0].fn(); await tick();
ok(s.au.calls.check === 0, 'ni cada 6 horas');
await s.up.check(true); await tick();
ok(s.au.calls.check === 1 && s.events.some(e => e.state === 'none'), '«Buscar ahora» sí comprueba y dice que no hay novedades');

console.log('Sin red o sin releases');
s = setup('offline');
s.up.configure({ auto: true });
await s.timers[0].fn(); await tick();
ok(s.events.length === 0 && s.up.status().state === 'idle', 'comprobación automática sin red: silencio total');
await s.up.check(true); await tick();
ok(s.events.some(e => e.state === 'error' && /conexión/.test(e.message)), '«Buscar ahora» sin red: mensaje amable');

s = setup((u) => { u.emit('error', new Error('No published versions on GitHub')); });
s.up.configure({ auto: true });
await s.timers[0].fn(); await tick();
ok(s.events.length === 0, 'sin releases publicadas: silencio');
await s.up.check(true); await tick();
ok(s.events.at(-1).state === 'none', 'sin releases, «Buscar ahora»: «tienes la última versión»');

console.log('Versión nueva');
s = setup({ version: '1.0.1' });
s.up.configure({ auto: true });
await s.timers[0].fn(); await tick();
ok(s.events.at(-1).state === 'available' && s.events.at(-1).version === '1.0.1', 'aviso «Nexura 1.0.1 disponible»');
ok(s.au.calls.download === 0, 'no descarga hasta que el usuario lo pide');
await s.up.download(); await tick();
ok(s.events.some(e => e.state === 'downloading' && e.percent === 42), 'progreso de descarga');
ok(s.events.at(-1).state === 'downloaded' && s.backups.length === 1, 'descargada → copia de seguridad antes de instalar');
ok(s.au.calls.quit === 0, 'no reinicia por su cuenta');
await s.up.install();
ok(s.backups.length === 1, 'no repite la copia al instalar');
// el reinicio va en un temporizador (para que la interfaz termine de guardar)
s.timers.at(-1).fn();
ok(s.au.calls.quit === 1, '«Reiniciar para actualizar» instala');

console.log('Novedades en el aviso');
s = setup({ version: '1.0.2', releaseNotes: '<h2>Novedades</h2><ul><li><strong>Aviso</strong> abajo a la izquierda</li><li>Arreglos &amp; mejoras</li><li>Tres</li><li>Cuatro</li></ul>' });
s.up.configure({ auto: true });
await s.timers[0].fn(); await tick();
ok(JSON.stringify(s.events.at(-1).notes) === JSON.stringify(['Aviso abajo a la izquierda', 'Arreglos & mejoras', 'Tres']), 'notas HTML de la release → 3 líneas de texto plano');
ok(JSON.stringify(notesText('## 1.0.2\n- **Uno**\n- Dos')) === JSON.stringify(['1.0.2', 'Uno', 'Dos']), 'Markdown → texto sin marcas');
ok(notesText(null).length === 0 && notesText([{ version: '1', note: '<p>A</p>' }])[0] === 'A' && notesText('x'.repeat(300))[0].length === 140, 'sin notas → []; lista de versiones; líneas largas recortadas');

console.log('Canal de versiones de prueba');
s = setup('none');
s.up.configure({ auto: true, prerelease: false });
await s.timers[0].fn();
ok(s.au.lastPrerelease === false && s.au.allowDowngrade === false, 'por defecto solo versiones estables');
s.up.configure({ auto: true, prerelease: true }); await tick();
ok(s.au.calls.check === 2 && s.au.lastPrerelease === true && s.au.allowDowngrade === false, 'al activar «Recibir versiones de prueba» comprueba con -rc/-beta y sin bajar de versión');

console.log('Versión de prueba instalada (todas las publicadas son -rc)');
ok(isPrerelease('1.0.0-rc.7') && isPrerelease('2.0.0-beta.1') && isPrerelease('1.1.0-alpha') && !isPrerelease('1.0.0') && !isPrerelease(''), 'detecta -rc, -beta y -alpha');
ok(allowPrereleaseFor('1.0.0-rc.6', false) === true && allowPrereleaseFor('1.0.0-rc.6', true) === true, 'con una rc: allowPrerelease siempre true, aunque el ajuste esté desactivado');
ok(allowPrereleaseFor('1.0.0', false) === false && allowPrereleaseFor('1.0.0', true) === true, 'con una estable: se respeta el ajuste');
const withVersion = (version, result) => {
  const au = fake(result), timers = [], events = [];
  const up = createUpdater({ autoUpdater: au, version, send: (e) => events.push(e), setTimer: (fn, ms) => { timers.push({ fn, ms }); return 0; }, setRepeat: () => 0 });
  return { au, up, timers, events };
};
let r = withVersion('1.0.0-rc.6', 'none');
r.up.configure({ auto: true, prerelease: false });
await r.timers[0].fn();
ok(r.au.lastPrerelease === true && r.au.allowDowngrade === false, 'rc.6 con el ajuste desactivado comprueba con allowPrerelease = true (y sin bajar de versión)');
r.up.configure({ auto: true, prerelease: true }); await tick();
ok(r.au.calls.check === 1, 'con una rc, cambiar el ajuste no cambia el canal: no repite la comprobación');
// Simulación de GitHub: solo hay releases -rc; sin allowPrerelease electron-updater busca «latest» y no la encuentra
const github = (u) => { if (!u.allowPrerelease) { u.emit('error', new Error('No published versions on GitHub')); return null; } return { version: '1.0.0-rc.7' }; };
r = withVersion('1.0.0-rc.6', github);
r.up.configure({ auto: true, prerelease: false });
await r.timers[0].fn(); await tick();
ok(r.events.at(-1)?.state === 'available' && r.events.at(-1).version === '1.0.0-rc.7', 'tester con rc.6 y el ajuste desactivado: le llega la rc.7');
r = withVersion('1.0.0', github);
r.up.configure({ auto: true, prerelease: false });
await r.up.check(true); await tick();
ok(r.au.lastPrerelease === false && r.events.at(-1).state === 'none', 'con una estable y el ajuste desactivado no se ofrecen rc; «No published versions» → «Tienes la última versión»');
r = withVersion('1.0.0', github);
r.up.configure({ auto: true, prerelease: true });
await r.timers[0].fn(); await tick();
ok(r.au.lastPrerelease === true && r.events.at(-1)?.state === 'available', 'con una estable y el ajuste activado sí se ofrecen');

console.log('Desactivado (npm start, Microsoft Store)');
const ev = [];
const off = createUpdater({ autoUpdater: null, enabled: false, send: (e) => ev.push(e) });
off.configure({ auto: true });
await off.check(false);
ok(ev.length === 0 && off.status().state === 'disabled', 'sin actualizador: no hace nada');
await off.check(true);
ok(ev.at(-1).state === 'unsupported', '«Buscar ahora» explica que no está disponible');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
