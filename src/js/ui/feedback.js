// Informe de errores y sugerencias + registro técnico de la interfaz.
// - Registro: errores de JS no capturados, promesas rechazadas, console.error/warn (audio, MIDI, análisis,
//   stems…) y avisos de la app van al registro local rotativo del proceso principal (<datos>\logs).
// - «Enviar informe o sugerencia»: tipo, texto, email opcional y «Adjuntar registro técnico» (enseña antes
//   exactamente qué se envía: versión, Windows, controladora, decks, diagnóstico de rendimiento (ui/perf-diag.js
//   y main.js → systemPerf) y las últimas 200 líneas del registro, sin rutas ni canciones). Lo envía el proceso principal a «feedbackUrl» de src/config/servicios.json;
//   si está vacío o falla, abre el correo a contacto@nexuraia.com y guarda el informe en un .txt.
import { el, toast } from '../util.js';
import { select } from './controls.js';
import { platform } from '../platform.js';

export const FEEDBACK_EMAIL = 'contacto@nexuraia.com';
const KINDS = { error: 'Error', idea: 'Sugerencia', other: 'Otro' };

export class Feedback {
  constructor(app) {
    this.app = app;
    this.pending = [];
    this.flushSoon = null;
    window.addEventListener('error', (e) => this.log('ERROR', 'js', (e.message || 'Error') + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno}:${e.colno})` : '') + (e.error && e.error.stack ? ' ' + String(e.error.stack).split('\n').slice(1, 4).join(' ') : '')));
    window.addEventListener('unhandledrejection', (e) => this.log('ERROR', 'promesa', 'Promesa rechazada: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason || '')));
    // console.error / console.warn de toda la app (automix, análisis, stems, MIDI, audio…) también al registro
    for (const [fn, level] of [['error', 'ERROR'], ['warn', 'WARN']]) {
      const orig = console[fn].bind(console);
      console[fn] = (...args) => { orig(...args); this.log(level, 'consola', args.map(a => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? safeJson(a) : String(a))).join(' ')); };
    }
  }

  // Línea del registro (se envían por lotes al proceso principal)
  log(level, source, msg) {
    this.pending.push({ level, source, msg: String(msg).slice(0, 2000) });
    if (this.pending.length > 100) this.pending.splice(0, this.pending.length - 100);
    if (!this.flushSoon) this.flushSoon = setTimeout(() => { this.flushSoon = null; const l = this.pending.splice(0); if (l.length) platform.log(l); }, 500);
  }

  // Sugerencias que quedaron en cola en la beta (sin conexión): se intentan enviar una vez y se olvidan
  async flushQueue() {
    const q = (this.app.settings.feedbackQueue || []).slice();
    if (!q.length) return;
    let sent = 0;
    for (const p of q) { try { if ((await platform.report.send({ legacy: p })).ok) sent++; } catch (_) { /* sin red: silencio */ } }
    this.app.setSetting('feedbackQueue', []);
    if (sent) toast(`Se han enviado ${sent} sugerencia(s) pendiente(s). ¡Gracias!`, 'ok', 5000);
  }

  // Lo que la app sabe de la sesión (sin datos personales)
  context() {
    const a = this.app;
    return { controller: a.midi?.controllerName || '', decks: a.deckCount === 4 ? 4 : 2, perf: a.perfDiag ? a.perfDiag.snapshot() : null };
  }
  // Títulos, artistas, nombres de archivo y de crates: se quitan del registro antes de enviarlo
  knownNames() {
    const L = this.app.library, out = [];
    if (!L) return out;
    for (const t of L.tracks.values()) {
      out.push(t.title, t.artist, t.album);
      const f = String(t.path || '').split(/[\\/]/).pop();
      if (f && t.source !== 'youtube') out.push(f, f.replace(/\.[^.]+$/, ''));
    }
    for (const c of L.crates) out.push(c.name);
    for (const p of L.ytPlaylists || []) out.push(p.title || p.name);
    return out.filter(x => x && String(x).length >= 4).slice(0, 60000);
  }

  techText(t) {
    return [`Versión: ${t.version}`, `Sistema: ${t.os}`, `Controladora MIDI: ${t.controller}`, `Decks: ${t.decks}`,
      ...(t.perfLines && t.perfLines.length ? ['Diagnóstico de rendimiento:', ...t.perfLines] : []),
      `Últimas ${t.log.length} líneas del registro:`, ...(t.log.length ? t.log : ['(vacío)'])].join('\n');
  }

  async open(preset = 'idea') {
    const app = this.app;
    const kind = select(KINDS, KINDS[preset] ? preset : 'idea', () => {}, 'wide');
    kind.id = 'fb-kind';
    const text = el('textarea', { id: 'fb-text', class: 'wide fb-text', rows: 7, placeholder: 'Cuéntanos qué pasó o qué te gustaría. Si es un error: qué estabas haciendo, qué esperabas y qué ocurrió.' });
    const email = el('input', { id: 'fb-email', class: 'wide', type: 'email', autocomplete: 'email', placeholder: 'tu@email.com (opcional, solo para responderte)' });
    const attach = el('input', { id: 'fb-attach', type: 'checkbox', class: 'switch' });
    attach.checked = true;
    const preview = el('pre', { class: 'fb-preview', id: 'fb-preview', tabindex: 0 }, 'Preparando…');
    const known = this.knownNames();
    const ctx = this.context();
    const loadPreview = async () => {
      try { preview.textContent = this.techText(await platform.report.preview({ ...ctx, known })); }
      catch (e) { preview.textContent = 'No se pudo leer el registro: ' + e.message; }
    };
    loadPreview();
    const box = el('div', { class: 'fb-attach-box' },
      el('label', { class: 'fb-check', for: 'fb-attach' }, attach, el('span', {}, 'Adjuntar registro técnico')),
      el('p', { class: 'hint' }, 'Se adjunta exactamente lo que ves abajo: versión, Windows, controladora MIDI conectada, un diagnóstico de rendimiento (procesador, memoria, tarjeta gráfica, número de pistas, ajustes de rendimiento y fluidez de la forma de onda en los últimos minutos) y las últimas 200 líneas del registro de la app. Las rutas de archivos, los nombres de canciones, artistas y crates y los correos se sustituyen por <ruta>, <pista>, «…» o <email>.'),
      preview);
    attach.addEventListener('change', () => { preview.hidden = !attach.checked; });
    const body = el('div', { class: 'form fb-form' },
      el('label', { class: 'frm', for: 'fb-kind' }, el('span', {}, 'Tipo'), kind),
      el('label', { class: 'frm', for: 'fb-text' }, el('span', {}, 'Mensaje'), text),
      el('label', { class: 'frm', for: 'fb-email' }, el('span', {}, 'Email (opcional)'), email),
      box,
      el('p', { class: 'hint' }, `Lo recibe el equipo de NexuraIA (${FEEDBACK_EMAIL}). Más información en Ajustes → Acerca de → Privacidad.`));

    const choice = await app.modal('Enviar informe o sugerencia', body, ['Cancelar', 'Enviar']);
    if (choice !== 1) return null;
    const msg = text.value.trim();
    if (!msg) { toast('Escribe un mensaje antes de enviarlo.', 'warn'); return this.open(kind.value); }
    const mail = email.value.trim();
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) toast('El email no parece válido: se envía sin él.', 'warn', 4000);
    toast('Enviando…', 'info', 2000);
    let r;
    try { r = await platform.report.send({ kind: kind.value, text: msg, email: mail, attach: attach.checked, ...ctx, known }); }
    catch (e) { r = { ok: false, via: 'error', error: e.message }; }
    if (r && r.ok) { toast('¡Gracias! Tu mensaje ha llegado a NexuraIA.', 'ok', 5000); return r; }
    const info = el('div', { class: 'form fb-form' },
      el('p', {}, 'No se ha podido enviar directamente (sin conexión o servicio no disponible).'),
      el('p', {}, `Se ha abierto tu programa de correo con el mensaje para ${FEEDBACK_EMAIL}. Si no se abre, escríbenos a esa dirección.`),
      r && r.file ? el('p', { class: 'hint' }, 'El informe completo, con el registro técnico, está guardado en este archivo. Adjúntalo al correo, por favor:') : null,
      r && r.file ? el('pre', { class: 'fb-preview fb-path' }, r.file) : null);
    const c = await app.modal('Enviar por correo', info, r && r.file ? ['Cerrar', 'Mostrar el archivo'] : ['Cerrar']);
    if (c === 1 && r.file) platform.showItem(r.file);
    return r;
  }
}

function safeJson(o) { try { return JSON.stringify(o).slice(0, 500); } catch (_) { return String(o); } }
