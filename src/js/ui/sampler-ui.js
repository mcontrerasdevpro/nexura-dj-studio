// Panel del sampler (4 bancos × 8 ranuras)
import { el } from '../util.js';
import { btn, select } from './controls.js';
import { SAMPLER_MODES } from '../audio/sampler.js';

export class SamplerUI {
  constructor(app, root) {
    this.app = app; this.root = root;
    const s = app.sampler;
    root.classList.add('sampler-panel');
    this.bankTabs = el('div', { class: 'bank-tabs' }, ...['A', 'B', 'C', 'D'].map((b, i) => {
      const t = el('button', { class: 'bank-tab' }, 'Banco ' + b);
      t.addEventListener('click', () => { s.bank = i; app.saveSamplerSoon(); this.render(); app.decks.forEach(d => d.emit('pads')); });
      return t;
    }));
    this.pflBtn = btn('CUE', { cls: 'micro', onClick: () => { app.engine.setSamplerPfl(!app.engine.samplerPflOn); this.pflBtn.classList.toggle('on', app.engine.samplerPflOn); }, title: 'Escuchar el sampler en auriculares' });
    this.grid = el('div', { class: 'sampler-grid' });
    root.append(el('div', { class: 'sampler-head' }, el('span', { class: 'panel-title' }, 'SAMPLER'), this.bankTabs, this.pflBtn,
      btn('STOP', { cls: 'micro', onClick: () => s.stopAll() })), this.grid);
    s.on('change', () => this.render());
    s.on('voices', () => this.refreshVoices());
    this.render();
  }
  render() {
    const s = this.app.sampler;
    [...this.bankTabs.children].forEach((t, i) => t.classList.toggle('on', i === s.bank));
    this.grid.innerHTML = '';
    this.cells = [];
    for (let i = 0; i < 8; i++) {
      const slot = s.slot(i);
      const name = el('div', { class: 'smp-name' }, slot.name || 'Vacío — arrastra un audio');
      const play = el('div', { class: 'smp-play' + (slot.path ? '' : ' empty') }, el('span', { class: 'smp-num' }, String(i + 1)), name);
      play.addEventListener('pointerdown', (e) => { if (e.button) return; e.preventDefault(); play.setPointerCapture(e.pointerId); s.press(i); });
      play.addEventListener('pointerup', () => s.release(i));
      play.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.app.contextMenu(e, [
          { label: 'Cargar muestra…', fn: () => this.app.samplerLoadDialog(i) },
          { label: 'Vaciar ranura', fn: () => s.clearSlot(i) }
        ]);
      });
      const mode = select(SAMPLER_MODES, slot.mode, (v) => { slot.mode = v; this.app.saveSamplerSoon(); }, 'tiny-sel');
      const loop = btn('⟲', { cls: 'micro' + (slot.loop ? ' on' : ''), title: 'Bucle', onClick: () => { slot.loop = !slot.loop; loop.classList.toggle('on', slot.loop); this.app.saveSamplerSoon(); } });
      const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: slot.gain, class: 'smp-vol', title: 'Volumen' });
      vol.addEventListener('input', () => { s.setGain(i, parseFloat(vol.value)); this.app.saveSamplerSoon(); });
      const cell = el('div', { class: 'smp-cell' }, play, el('div', { class: 'smp-ctl' }, mode, loop, vol));
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', async (e) => {
        e.preventDefault(); cell.classList.remove('drop');
        const id = e.dataTransfer.getData('text/nexura-track');
        if (id) { const t = this.app.library.getAny(id.split(',')[0]); if (t && t.source === 'local') await s.loadSlot(i, t.path, t.title); }
        else if (e.dataTransfer.files.length) {
          const infos = await this.app.platform.filesFromDrop(e.dataTransfer.files);
          if (infos[0]) await s.loadSlot(i, infos[0].path, infos[0].title);
        }
        this.app.saveSamplerSoon();
      });
      this.cells.push(play);
      this.grid.appendChild(cell);
    }
    this.refreshVoices();
  }
  refreshVoices() {
    const s = this.app.sampler;
    (this.cells || []).forEach((c, i) => c.classList.toggle('playing', s.isPlaying(i)));
  }
}
