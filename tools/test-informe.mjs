// Pruebas del informe de errores: anonimización, registro rotativo y contenido de lo que se envía.
// node tools/test-informe.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const { anonymize } = require('../src/js/shared/anonymize.js');
const report = require('../main/report.js');
const { createLogger } = require('../main/logger.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

console.log('Anonimización');
const home = 'C:\\Users\\Miguel';
const known = ['Daft Punk', 'One More Time', 'Titanium', 'David Guetta', 'Mi crate secreta'];
const opt = { known, user: 'Miguel', home };
const cases = [
  'No se pudo abrir el archivo: C:\\Users\\Miguel\\Music\\Daft Punk - One More Time (Radio Edit).mp3 (código 5)',
  'análisis D:\\Música\\House 2024\\Tim Berg - Seek Bromance.flac Error: decode',
  'Archivo perdido: \\\\NAS\\musica\\pop\\Titanium.wav',
  'Cargando «Titanium» en el deck 1',
  'stems /home/miguel/Música/David Guetta - Titanium.mp3 falló',
  'Promesa rechazada: fetch file:///C:/Users/Miguel/Music/track.mp3',
  'Contacto mcontrerasjaen@gmail.com y vídeo yt_dQw4w9WgXcQ',
  'web:Daft Punk - One More Time.mp3:123456 no disponible',
  'crate Mi crate secreta borrada por Miguel'
];
const out = cases.map(c => anonymize(c, opt));
out.forEach((o, i) => console.log('    ', o));
const leaks = ['Daft', 'Punk', 'One More Time', 'Titanium', 'Guetta', 'Seek Bromance', 'Tim Berg', 'Miguel', 'miguel', 'Música', 'Music\\', 'NAS', 'gmail', 'dQw4w9WgXcQ', '.mp3', '.flac', '.wav', 'secreta'];
for (const w of leaks) ok(!out.some(o => o.includes(w)), `no aparece «${w}»`);
ok(out[0].includes('(código 5)'), 'conserva el texto técnico que sigue a la ruta');
ok(out[1].includes('Error: decode'), 'conserva el error tras una ruta con espacios');
ok(anonymize('AudioContext: sampleRate 48000, estado running', opt) === 'AudioContext: sampleRate 48000, estado running', 'no toca texto técnico sin datos personales');
ok(anonymize('MIDI: DDJ-400 conectada', { known: [] }) === 'MIDI: DDJ-400 conectada', 'deja el nombre de la controladora');

console.log('Registro rotativo');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-log-'));
let t = Date.parse('2026-11-10T10:00:00Z');
const lg = createLogger(dir, { maxSize: 2000, maxFiles: 5, perMinute: 1e9, now: () => (t += 1000) });
for (let i = 0; i < 400; i++) lg.error('ui:test', `línea ${i} ` + 'x'.repeat(40));
const files = fs.readdirSync(dir).sort();
ok(files.length === 5, `5 archivos como mucho (${files.join(', ')})`);
ok(files.every(f => fs.statSync(path.join(dir, f)).size <= 2000), 'ninguno supera el tamaño máximo');
const tail = lg.tail(200);
ok(tail.length > 0 && /línea 399/.test(tail[tail.length - 1]), 'tail termina en la última línea');
ok(tail.length <= 200, 'tail devuelve como mucho 200 líneas');
for (let i = 0; i < 50; i++) lg.error('ui:test', 'mismo error');
lg.info('ui:test', 'otro');
const last = lg.tail(3).join('\n');
ok(/repitió 49 veces/.test(last), 'los errores repetidos se resumen en una línea');
const lg2 = createLogger(fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-log-')), { perMinute: 10, now: () => t });
for (let i = 0; i < 30; i++) lg2.warn('x', 'msg ' + i);
ok(lg2.tail(100).length === 10, 'límite de líneas por minuto (inundaciones)');

console.log('Contenido del informe');
const tech = report.technical({ version: '1.0.0-rc.1', os: 'Windows 11 (10.0.26100, x64)', controller: 'DDJ-400', decks: 4, log: cases, known, user: 'Miguel', home });
ok(tech.log.length === cases.length && !tech.log.join('\n').includes('Titanium'), 'registro anonimizado en la parte técnica');
ok(tech.controller === 'DDJ-400' && tech.decks === 4, 'controladora y decks');
const big = report.technical({ version: 'x', os: 'y', log: Array.from({ length: 500 }, (_, i) => 'l' + i) });
ok(big.log.length === 200 && big.log[199] === 'l499', 'solo las últimas 200 líneas');
const p1 = report.buildPayload({ kind: 'error', text: 'Se para el audio', email: 'no-es-un-email', attach: false, tech, version: '1.0.0-rc.1' });
ok(!('technical' in p1) && !p1.errors && !p1.system, 'sin «Adjuntar registro» no se envía nada técnico');
ok(p1.email === '' && p1.type === 'error' && p1.category === 'Error', 'email no válido se descarta; tipo correcto');
const p2 = report.buildPayload({ kind: 'idea', text: 'Más efectos', email: 'dj@example.com', attach: true, tech, version: '1.0.0-rc.1' });
ok(p2.technical && p2.errors.split('\n').length === cases.length && p2.contact === 'dj@example.com', 'con registro: parte técnica + campos de la beta');
ok(!JSON.stringify(p2).includes('Titanium') && !JSON.stringify(p2).includes('C:\\\\Users'), 'el JSON enviado no lleva canciones ni rutas');
ok(report.windowsLabel('win32', '10.0.22631') === 'Windows 11' && report.windowsLabel('win32', '10.0.19045') === 'Windows 10', 'Windows 10/11 por número de compilación');
// controladoras conectadas (puerto MIDI + tipo de perfil de una lista cerrada) y «¿Qué controladora usas?»
const tc = report.technical({ version: '1', os: 'W', controller: 'DDJ-400', decks: 2, known, user: 'Miguel', home,
  controllers: [{ port: 'DDJ-400', type: 'incluido', model: 'Pioneer DJ DDJ-400' }, { port: 'Mesa de Miguel', type: 'hackeado', model: 'x' }, { port: '' }] });
ok(tc.controllers.length === 2 && tc.controllers[0].type === 'incluido' && tc.controllers[1].type === 'ninguno' && !JSON.stringify(tc.controllers).includes('Miguel'), 'controladoras: tipo de perfil de la lista cerrada y nombre del usuario fuera del puerto');
ok(report.controllersText(tc.controllers) === 'DDJ-400 (perfil incluido: Pioneer DJ DDJ-400) · Mesa de <usuario> (sin perfil)', 'texto de las controladoras conectadas');
const p6 = report.buildPayload({ kind: 'idea', text: 'Más perfiles', email: '', userController: '  Numark Mixtrack Pro 3\n', attach: true, tech: tc, version: '1' });
ok(p6.controllerUser === 'Numark Mixtrack Pro 3' && /— Controladora: Numark Mixtrack Pro 3$/.test(p6.message) && /Controladoras conectadas: DDJ-400 \(perfil incluido/.test(p6.system), '«¿Qué controladora usas?» va en el JSON y al final del mensaje; el sistema lista las conectadas');
const p7 = report.buildPayload({ kind: 'idea', text: 'Hola', email: '', attach: false, tech: tc, version: '1' });
ok(!('controllerUser' in p7) && p7.message === 'Hola', 'sin controladora escrita, el mensaje no cambia');
ok(/Controladora \(según el usuario\): DDJ-FLX4/.test(report.reportText({ kind: 'idea', text: 'x', email: '', userController: 'DDJ-FLX4', tech: tc })), 'el .txt de respaldo lleva la controladora escrita');
const mail = report.mailtoUrl({ kind: 'error', text: 'Hola', email: '', file: 'C:\\x\\informe.txt' });
ok(mail.startsWith('mailto:contacto@nexuraia.com?subject=') && mail.length < 2000, 'mailto a contacto@nexuraia.com y corto');

console.log('Diagnóstico de rendimiento');
const perf = {
  system: { cpu: 'Intel(R) Xeon(R) CPU E5-2640 v4 @ 2.40GHz', threads: 20, mhz: 2400, ramGB: 64, gpus: [{ vendor: 'AMD', device: '0x731f', driver: '31.0.24033.1003', active: true }], gpuStatus: { compositing: true, canvas2d: true, raster: true }, gpuSetting: 'auto', electron: '33.4.11', extra: 'C:\\Users\\Miguel\\secreto' },
  app: { tracks: 3120, perfMode: true, fpsTarget: 30, layout: 'serato', windowMin: 5, fps: 29.6, fpsPlaying: 29.8, longTasks: 4, longMaxMs: 88.4, stalls: 1, stallMaxMs: 140, freezes: [{ minAgo: 2.5, ms: 2400, kind: 'gpu', gpu: true }], ruta: 'C:\\Users\\Miguel\\Music\\Titanium.mp3', titulo: 'Titanium' }
};
const tp = report.technical({ version: '1.0.0-rc.5', os: 'Windows 11', controller: '', decks: 2, log: [], known, user: 'Miguel', home, perf });
const lines = report.perfText(tp.perf).join('\n');
console.log(lines.split('\n').map(l => '     ' + l).join('\n'));
ok(/Xeon\(R\) CPU E5-2640 v4.*20 hilos.*RAM 64 GB/.test(lines), 'procesador, hilos y RAM');
ok(/AMD 0x731f \(controlador 31\.0\.24033\.1003\) activa/.test(lines) && /Aceleración por GPU: automática · composición sí · canvas sí/.test(lines), 'tarjeta gráfica, controlador y aceleración');
ok(/Biblioteca: 3120 pistas · modo rendimiento sí \(objetivo 30 fps\)/.test(lines) && /onda 29\.6 fps.*tareas largas 4 \(máx\. 88\.4 ms\).*bloqueos de más de 100 ms 1/.test(lines), 'pistas, ajustes de rendimiento, fps y tareas largas');
ok(/hace 2\.5 min, 2400 ms \(sin dibujar con el hilo libre, GPU activa\)/.test(lines), 'congelaciones detectadas por el vigilante');
ok(!JSON.stringify(tp.perf).includes('Miguel') && !JSON.stringify(tp.perf).includes('Titanium') && !('ruta' in tp.perf) && !('extra' in tp.perf), 'solo los campos conocidos: sin rutas ni nombres');
const p3 = report.buildPayload({ kind: 'error', text: 'Se congela la onda', email: '', attach: true, tech: tp, version: '1.0.0-rc.5' });
ok(p3.technical.perf && /Procesador: /.test(p3.system) && /Diagnóstico de rendimiento/.test(report.reportText({ kind: 'error', text: 'x', email: '', tech: tp })), 'va en el JSON enviado, en «system» y en el .txt de respaldo');
const p4 = report.buildPayload({ kind: 'error', text: 'x', email: '', attach: false, tech: tp, version: '1' });
ok(!p4.technical && !p4.system, 'sin «Adjuntar registro técnico» tampoco va el diagnóstico');
// arranque: MIDI que no responde y pasos lentos (solo valores de listas cerradas; nada de rutas)
const perf2 = { system: perf.system, app: { ...perf.app, startup: { midi: 'timeout', midiMs: null, midiTimeouts: 2, outputs: 'ok', slow: [{ step: 'library', ms: 6200, done: true }, { step: 'C:\\Users\\Miguel\\Music', ms: 1, done: true }], dir: 'C:\\Users\\Miguel\\Music' } } };
const tp2 = report.technical({ version: '1', os: 'Windows 11', controller: '', decks: 2, log: [], known, user: 'Miguel', home, perf: perf2 });
const l2 = report.perfText(tp2.perf).join('\n');
ok(/Arranque: MIDI no responde · sin respuesta en 5 s 2 veces · salidas de audio aplicadas · pasos de más de 5 s: biblioteca 6200 ms/.test(l2), 'arranque: MIDI sin respuesta y pasos lentos en el diagnóstico');
ok(!JSON.stringify(tp2.perf).includes('Miguel') && tp2.perf.startup.slow.length === 1 && !('dir' in tp2.perf.startup), 'arranque: sin rutas ni campos desconocidos');
const p5 = report.technical({ version: '1', os: 'W', controller: '', decks: 2, log: [], known, user: 'Miguel', home, perf: { system: perf.system, app: { ...perf.app, startup: { midi: 'ok', midiMs: 12, midiTimeouts: 0, outputs: 'ok', slow: [] } } } });
ok(/Arranque: MIDI conectado \(respondió en 12 ms\) · salidas de audio aplicadas · pasos de más de 5 s: ninguno/.test(report.perfText(p5.perf).join('\n')), 'arranque normal');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
