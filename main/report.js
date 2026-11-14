// Informe de errores y sugerencias: arma lo que se envía (y lo que se enseña antes de enviarlo).
// Sin dependencias de Electron (se prueba en Node: tools/test-informe.mjs).
'use strict';
const { anonymize } = require('../src/js/shared/anonymize.js');

const KINDS = { error: 'Error', idea: 'Sugerencia', other: 'Otro' };
const LOG_LINES = 200;

// «Windows 11» / «Windows 10» a partir de os.release() (10.0.22000 o superior = Windows 11)
function windowsLabel(platform, release) {
  if (platform !== 'win32') return platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : String(platform || 'desconocido');
  const build = Number(String(release || '').split('.')[2]) || 0;
  return build >= 22000 ? 'Windows 11' : 'Windows 10';
}

const validEmail = (s) => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(String(s || '').trim());

// Parte técnica (solo si se marca «Adjuntar registro técnico»): versión, sistema, controladora y las
// últimas líneas del registro, sin rutas, canciones, artistas ni correos.
function technical({ version, os, controller, decks, log = [], known = [], user = '', home = '', perf = null }) {
  const ctl = String(controller || '').slice(0, 80);
  const t = {
    version: String(version || ''),
    os: String(os || ''),
    controller: ctl ? anonymize(ctl, { known, user, home }) : 'ninguna',
    decks: [2, 4].includes(Number(decks)) ? Number(decks) : 2,
    log: (log || []).slice(-LOG_LINES).map(l => anonymize(l, { known, user, home }))
  };
  if (perf) t.perf = perfInfo(perf, { known, user, home });
  return t;
}

// Diagnóstico de rendimiento: solo números, modelos de procesador y tarjeta gráfica y ajustes de la app
// (nada de rutas, nombres de pistas ni datos personales). system: lo del proceso principal (main.js →
// systemPerf); app: lo que mide la interfaz (src/js/ui/perf-diag.js → snapshot)
const num = (v, max = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-max, Math.min(max, Math.round(n * 10) / 10)) : null; };
const txt = (v, n = 80) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, n);
function perfInfo(perf, anon = {}) {
  const s = perf.system || {}, a = perf.app || {};
  const clean = (v, n) => anonymize(txt(v, n), anon);
  const gs = s.gpuStatus || {};
  return {
    cpu: clean(s.cpu, 100), threads: num(s.threads, 1024), mhz: num(s.mhz, 1e5), ramGB: num(s.ramGB, 1e5),
    gpus: (Array.isArray(s.gpus) ? s.gpus : []).slice(0, 4).map(g => ({ vendor: clean(g.vendor, 30), device: clean(g.device, 12), driver: clean(g.driver, 40), active: !!g.active })),
    gpuStatus: { compositing: !!gs.compositing, canvas2d: !!gs.canvas2d, raster: !!gs.raster },
    gpuSetting: s.gpuSetting === 'off' ? 'off' : 'auto', electron: clean(s.electron, 20),
    tracks: num(a.tracks), perfMode: !!a.perfMode, fpsTarget: num(a.fpsTarget, 1000), layout: clean(a.layout, 12),
    windowMin: num(a.windowMin, 1e4), fps: num(a.fps, 1000), fpsPlaying: num(a.fpsPlaying, 1000),
    longTasks: num(a.longTasks), longMaxMs: num(a.longMaxMs), stalls: num(a.stalls), stallMaxMs: num(a.stallMaxMs),
    freezes: (Array.isArray(a.freezes) ? a.freezes : []).slice(-10).map(f => ({ minAgo: num(f.minAgo, 1e5), ms: num(f.ms, 1e7), kind: f.kind === 'gpu' ? 'gpu' : 'hilo', gpu: !!f.gpu }))
  };
}
function perfText(p) {
  if (!p) return [];
  const yes = (b) => (b ? 'sí' : 'no');
  return [
    `Procesador: ${p.cpu || '?'} · ${p.threads} hilos · ${p.mhz} MHz · RAM ${p.ramGB} GB`,
    `Tarjeta gráfica: ${p.gpus.map(g => `${g.vendor} ${g.device} (controlador ${g.driver || '?'})${g.active ? ' activa' : ''}`).join(' · ') || '?'}`,
    `Aceleración por GPU: ${p.gpuSetting === 'off' ? 'desactivada por el usuario' : 'automática'} · composición ${yes(p.gpuStatus.compositing)} · canvas ${yes(p.gpuStatus.canvas2d)} · rasterización ${yes(p.gpuStatus.raster)} · Electron ${p.electron}`,
    `Biblioteca: ${p.tracks} pistas · modo rendimiento ${yes(p.perfMode)} (objetivo ${p.fpsTarget} fps) · vista de onda ${p.layout}`,
    `Últimos ${p.windowMin} min: onda ${p.fps} fps de media (${p.fpsPlaying} fps sonando) · tareas largas ${p.longTasks} (máx. ${p.longMaxMs} ms) · bloqueos de más de 100 ms ${p.stalls} (máx. ${p.stallMaxMs} ms)`,
    `Congelaciones de la onda: ${p.freezes.length ? p.freezes.map(f => `hace ${f.minAgo} min, ${f.ms} ms (${f.kind === 'gpu' ? 'sin dibujar con el hilo libre' : 'hilo ocupado'}${f.gpu ? ', GPU activa' : ''})`).join(' · ') : 'ninguna'}`
  ];
}

// Texto legible del informe (vista previa del diálogo y archivo .txt de respaldo)
function reportText({ kind, text, email, tech }) {
  const out = [
    `Nexura DJ Studio — ${KINDS[kind] || 'Otro'}`,
    `Fecha: ${new Date().toISOString()}`,
    email ? `Contacto: ${email}` : 'Contacto: (no indicado)',
    '', String(text || '').trim(), ''
  ];
  if (tech) {
    out.push('--- Registro técnico ---', `Versión: ${tech.version}`, `Sistema: ${tech.os}`, `Controladora MIDI: ${tech.controller}`, `Decks: ${tech.decks}`);
    if (tech.perf) out.push('--- Diagnóstico de rendimiento ---', ...perfText(tech.perf));
    out.push(`Últimas ${tech.log.length} líneas del registro:`, ...tech.log);
  }
  return out.join('\n');
}

// JSON que se envía al endpoint. Incluye los campos del flujo de sugerencias de la beta (subject,
// category, message, contact, system, errors) para que el webhook ya existente siga funcionando.
function buildPayload({ kind, text, email, attach, tech, version }) {
  const k = KINDS[kind] ? kind : 'other';
  const msg = String(text || '').trim().slice(0, 8000);
  const contact = validEmail(email) ? String(email).trim() : '';
  const first = msg.split('\n')[0].slice(0, 60);
  const p = {
    app: 'Nexura DJ Studio', type: k, category: KINDS[k], message: msg, email: contact, contact,
    version: String(version || ''), date: new Date().toISOString(),
    subject: `[Nexura DJ Studio ${version || ''}] ${KINDS[k]}${first ? ': ' + first : ''}`
  };
  if (attach && tech) {
    p.technical = tech;
    p.system = `Versión: ${tech.version}\nSistema: ${tech.os}\nControladora MIDI: ${tech.controller}\nDecks: ${tech.decks}` + (tech.perf ? '\n' + perfText(tech.perf).join('\n') : '');
    p.errors = tech.log.join('\n');
  }
  return p;
}

// mailto: con el texto (el registro va en el .txt guardado: los mailto largos no abren en Windows)
function mailtoUrl({ kind, text, email, file }) {
  const subject = `Nexura DJ Studio · ${KINDS[kind] || 'Otro'}`;
  let body = String(text || '').trim().slice(0, 1200);
  if (email) body += `\n\nContacto: ${email}`;
  if (file) body += `\n\nHe guardado el informe completo en: ${file}\n(Adjúntalo a este correo, por favor.)`;
  return 'mailto:contacto@nexuraia.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

module.exports = { KINDS, LOG_LINES, windowsLabel, validEmail, technical, perfInfo, perfText, reportText, buildPayload, mailtoUrl };
