// Franja de grabación de la vista Biblioteca (se abre con REC de la barra superior). Usa la grabación de
// siempre (engine.startRecording / app.toggleRecord): grabar o parar, nombre de la mezcla, carpeta donde se
// guarda, nivel del master y tiempo grabado.
import { el, fmtTime } from '../util.js';
import { btn } from './controls.js';
import { peakToMeter } from '../audio/engine.js';
import { isDesktop } from '../platform.js';

export class RecStripUI {
  constructor(app, root) {
    this.app = app; this.root = root;
    root.classList.add('recbar');
    const fold = btn('▲', { cls: 'micro strip-fold', title: 'Cerrar la franja de grabación', onClick: () => app.togglePanel('rec') });
    fold.setAttribute('aria-label', 'Cerrar la franja de grabación');
    this.recBtn = btn('● GRABAR', { cls: 'small rec rec-go', title: 'Grabar o parar la mezcla (F9)', onClick: () => app.toggleRecord() });
    this.name = el('input', { class: 'rec-name', type: 'text', maxlength: 60, spellcheck: 'false', placeholder: 'Nexura-set', value: app.settings.recName || '', 'aria-label': 'Nombre de la mezcla' });
    this.name.addEventListener('change', () => app.setSetting('recName', this.name.value.trim()));
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') this.name.blur(); });
    const dir = app.info?.recordings || '';
    this.where = el('span', { class: 'rec-where', title: dir ? 'Las grabaciones se guardan en ' + dir + ' (WAV, con la fecha y la hora en el nombre)' : '' }, dir || '—');
    this.openBtn = btn('Abrir carpeta', { cls: 'micro', title: 'Mostrar la última grabación (o la carpeta de grabaciones) en el explorador', onClick: () => app.platform.showItem(app.lastRecording || dir) });
    this.openBtn.hidden = !isDesktop;
    this.mL = el('i', { class: 'rec-lvl' }, el('b'));
    this.mR = el('i', { class: 'rec-lvl' }, el('b'));
    this.time = el('span', { class: 'rec-clock' }, '00:00');
    root.append(fold, el('span', { class: 'panel-title' }, 'GRABACIÓN'), this.recBtn,
      el('label', { class: 'rec-field' }, el('span', { class: 'lbl' }, 'MEZCLA'), this.name),
      el('span', { class: 'rec-field rec-dir' }, el('span', { class: 'lbl' }, 'SE GUARDA EN'), this.where, this.openBtn),
      el('span', { class: 'rec-field', title: 'Nivel del master (lo que se graba)' }, el('span', { class: 'lbl' }, 'NIVEL'), el('span', { class: 'rec-meters' }, this.mL, this.mR)),
      el('span', { class: 'rec-field' }, el('span', { class: 'lbl' }, 'TIEMPO'), this.time));
    app.engine.on('rec', () => this.refresh());
    this.refresh();
  }

  // nombre elegido (vacío = el de siempre); main.js quita los caracteres que no valen en un archivo
  mixName() { return (this.name.value || this.app.settings.recName || '').trim(); }

  refresh() {
    const on = !!this.app.engine.recording;
    this.recBtn.textContent = on ? '■ PARAR' : '● GRABAR';
    this.recBtn.classList.toggle('on', on);
    this.root.classList.toggle('recording', on);
    if (!on) this.time.textContent = '00:00';
  }

  // desde el bucle principal, solo con la franja visible
  frame(m) {
    if (this.root.hidden) return;
    const set = (bar, p) => { const v = Math.round(peakToMeter(p || 0) * 100), f = bar.firstChild; if (f._v !== v) { f._v = v; f.style.clipPath = `inset(0 ${100 - v}% 0 0)`; } };
    if (m) { set(this.mL, m.L); set(this.mR, m.R); }
    const eng = this.app.engine;
    if (eng.recording) { const s = fmtTime((performance.now() - eng.recStart) / 1000, false); if (this.time.textContent !== s) this.time.textContent = s; }
    if (this.recBtn.classList.contains('on') !== !!eng.recording) this.refresh();
  }
}
