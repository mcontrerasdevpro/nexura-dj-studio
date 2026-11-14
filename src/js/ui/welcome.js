// Bienvenida (la primera vez y desde Ajustes → General → «Ver bienvenida»): 4 pasos cortos.
// 1 Qué es Nexura (gratis) · 2 Añadir música (carpeta → crates) · 3 Controladora (asistente MIDI) ·
// 4 Estadísticas anónimas (casilla marcada, visible y explicada) y actualizaciones. «Saltar» en todos.
// Si se salta, las estadísticas quedan desactivadas (no se ha visto la explicación).
import { el } from '../util.js';
import { btn } from './controls.js';
import { STATS_FIELDS_TEXT } from './legal-ui.js';

export class Welcome {
  constructor(app) { this.app = app; }

  shouldShow() { return !this.app.settings.welcomeDone; }
  get isOpen() { return !!(this.ov && this.ov.isConnected); }

  open(step = 0) {
    const app = this.app;
    this.close();
    this.step = step;
    const stats = el('input', { type: 'checkbox', class: 'switch', id: 'wl-stats' });
    stats.checked = app.settings.statsEnabled !== false;
    const upd = el('input', { type: 'checkbox', class: 'switch', id: 'wl-updates' });
    upd.checked = app.settings.autoUpdate !== false;
    const ctl = app.midi?.controllerName;
    const steps = [
      {
        title: 'Bienvenido a Nexura DJ Studio',
        body: [
          el('p', { class: 'wl-lead' }, 'Software DJ de NexuraIA para Windows: decks con sync y key lock, hot cues, loops, efectos, sampler, stems con IA, Automix y compatibilidad con controladoras MIDI.'),
          el('p', { class: 'wl-free' }, el('b', {}, 'Es gratis'), ' durante la fase de lanzamiento. No necesitas cuenta ni registrarte.'),
          el('p', { class: 'hint' }, 'Tu música y tu biblioteca se quedan en tu ordenador.')
        ]
      },
      {
        title: 'Añade tu música',
        body: [
          el('p', {}, 'Elige la carpeta donde tienes la música (MP3, WAV, FLAC…). Cada subcarpeta se convierte en un crate: Música › House › 2024.'),
          el('div', { class: 'wl-actions' }, btn('Elegir carpeta…', { cls: 'primary', onClick: () => app.addFiles(true) })),
          el('p', { class: 'hint' }, 'También puedes arrastrar carpetas o archivos a la biblioteca, o usar «+ Añadir música» en la barra lateral. Las pistas se analizan solas (BPM, tonalidad y forma de onda).')
        ]
      },
      {
        title: 'Conecta tu controladora',
        body: [
          el('p', {}, 'Funciona con cualquier controladora MIDI por USB. Algunos modelos (Denon DJ MC4000, Pioneer DJ DDJ-400, FLX4 y SB3, Hercules Inpulse 200/300/500, Reloop Mixtour y Mixon 4) se reconocen solos; con cualquier otra, el asistente te guía control a control (botones, faders, platos y pads) o importas su mapeo de Mixxx.'),
          el('p', { class: 'hint' + (ctl ? ' ok' : '') }, ctl ? `Controladora detectada: ${ctl} (${app.midi.profileInfo(ctl).label})` : 'Ahora mismo no hay ninguna controladora MIDI conectada. También puedes pinchar con teclado y ratón.'),
          el('div', { class: 'wl-actions' }, btn('Abrir el asistente MIDI', { onClick: () => app.settingsUI.open('midi') }))
        ]
      },
      {
        title: 'Privacidad y actualizaciones',
        body: [
          el('label', { class: 'wl-opt', for: 'wl-stats' }, stats, el('span', {}, el('b', {}, 'Enviar estadísticas anónimas de uso'),
            el('small', {}, 'Nos ayuda a saber cuánta gente usa Nexura. Como mucho una vez al día y solo esto: ' + STATS_FIELDS_TEXT + ' Nunca tu música, tus archivos ni datos personales.'))),
          el('label', { class: 'wl-opt', for: 'wl-updates' }, upd, el('span', {}, el('b', {}, 'Buscar actualizaciones automáticamente'),
            el('small', {}, 'Te avisamos cuando haya una versión nueva; tú decides cuándo descargarla. Nunca se reinicia con música sonando.'))),
          el('p', { class: 'hint' }, 'Puedes cambiarlo cuando quieras en Ajustes → General. ', el('button', { class: 'link', type: 'button', onclick: () => app.legal.show('privacidad') }, 'Política de privacidad'))
        ]
      }
    ];
    this.inputs = { stats, upd };
    const page = el('div', { class: 'wl-page' });
    const dots = el('div', { class: 'wl-dots', 'aria-hidden': 'true' }, ...steps.map(() => el('i')));
    const back = btn('Atrás', { onClick: () => go(this.step - 1) });
    const next = btn('Siguiente', { cls: 'primary', onClick: () => (this.step < steps.length - 1 ? go(this.step + 1) : this.finish(false)) });
    const skip = btn('Saltar', { cls: 'wl-skip', onClick: () => this.finish(true) });
    const title = el('h2', { id: 'wl-title' });
    const counter = el('span', { class: 'wl-count' });
    const go = (i) => {
      this.step = Math.max(0, Math.min(steps.length - 1, i));
      const s = steps[this.step];
      title.textContent = s.title;
      counter.textContent = `Paso ${this.step + 1} de ${steps.length}`;
      page.replaceChildren(...s.body);
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === this.step));
      back.hidden = this.step === 0;
      next.textContent = this.step === steps.length - 1 ? 'Empezar' : 'Siguiente';
      skip.hidden = this.step === steps.length - 1;
      ov.dataset.step = this.step;
      next.focus();
    };
    const ov = el('div', { class: 'modal-ov welcome-ov', id: 'welcome' },
      el('div', { class: 'modal welcome', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wl-title' },
        el('div', { class: 'wl-head' }, el('div', { class: 'logo' }, el('span', { class: 'logo-mark' }), el('b', {}, 'NEXURA'), ' DJ STUDIO'), counter),
        title, page,
        el('div', { class: 'wl-foot' }, skip, dots, el('span', { class: 'wl-nav' }, back, next))));
    this.key = (e) => {
      if (app._modal) return; // un diálogo abierto encima (p. ej. la política de privacidad)
      if (e.key === 'Escape') { e.stopPropagation(); this.finish(true); }
      else if (e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') { e.stopPropagation(); if (this.step < steps.length - 1) go(this.step + 1); }
      else if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') { e.stopPropagation(); go(this.step - 1); }
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', this.key, true);
    document.body.appendChild(ov);
    this.ov = ov;
    go(step);
    return new Promise((res) => { this.resolve = res; });
  }

  // skipped = «Saltar» / Esc / cerrar: no se activan las estadísticas si no se ha llegado a verlas
  finish(skipped) {
    const app = this.app;
    if (!this.ov) return;
    if (!skipped || this.step === 3) {
      app.setSetting('statsEnabled', this.inputs.stats.checked);
      app.setSetting('autoUpdate', this.inputs.upd.checked);
    } else if (app.settings.statsEnabled == null) app.setSetting('statsEnabled', false);
    app.setSetting('welcomeDone', true);
    this.close();
    if (!skipped) app.sendStatsSoon?.();
  }

  close() {
    if (!this.ov) return;
    document.removeEventListener('keydown', this.key, true);
    this.ov.remove();
    this.ov = null;
    if (this.resolve) { this.resolve(); this.resolve = null; }
  }
}

