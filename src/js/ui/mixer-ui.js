// Interfaz del mezclador
import { el } from '../util.js';
import { Knob, Fader, btn, select } from './controls.js';
import { XF_CURVES, peakToMeter } from '../audio/engine.js';

const dbFmt = (v) => { const db = (v - 0.5) * 24; return (db >= 0 ? '+' : '') + db.toFixed(1); };

export class MixerUI {
  constructor(app, root) {
    this.app = app; this.root = root;
    const eng = app.engine;
    root.classList.add('mixer');
    this.strips = eng.channels.map((ch, i) => this.buildStrip(ch, i));
    // centro
    this.masterKnob = new Knob({ label: 'MASTER', value: eng.masterVol, def: 0.8, color: '#ffffff', size: 32, onChange: (v) => eng.setMaster(v) });
    this.cueMixKnob = new Knob({ label: 'CUE MIX', value: eng.cueMix, def: 0.5, bipolar: true, size: 32, onChange: (v) => eng.setCueMix(v) });
    this.phonesKnob = new Knob({ label: 'PHONES', value: eng.phonesVol, def: 0.8, size: 32, onChange: (v) => eng.setPhonesVol(v) });
    this.samplerKnob = new Knob({ label: 'SAMPLER', value: 0.8, def: 0.8, color: '#ff4fa8', size: 32, onChange: (v) => eng.setSamplerVol(v) });
    this.splitBtn = btn('SPLIT', { cls: 'micro', onClick: () => eng.setSplit(!eng.split), title: 'Auriculares: cue a la izquierda, master a la derecha' });
    this.cueRoute = el('div', { class: 'cue-route' });
    this.curve = select(XF_CURVES, app.settings.xfCurve || 'smooth', (v) => app.setSetting('xfCurve', v), 'tiny-sel');
    this.mL = el('div', { class: 'meter tall' }, el('div', { class: 'meter-fill' }));
    this.mR = el('div', { class: 'meter tall' }, el('div', { class: 'meter-fill' }));
    this.clip = el('div', { class: 'clip' }, 'CLIP');
    const center = el('div', { class: 'mix-center' },
      this.masterKnob.el,
      el('div', { class: 'master-meters' }, this.mL, this.mR),
      this.clip,
      this.cueMixKnob.el, this.phonesKnob.el, this.splitBtn,
      this.samplerKnob.el, el('div', { class: 'xf-curve' }, el('span', {}, 'CURVA'), this.curve));
    this.xf = new Fader({ vertical: false, value: eng.xfValue, def: 0.5, length: 250, notch: 0.5, cls: 'xfader', onChange: (v) => eng.setCrossfader(v) });
    // orden de cabina de 4 canales: 3 · 1 · centro · 2 · 4 (los 3 y 4 solo con 4 decks)
    const top = el('div', { class: 'mix-top' }, this.strips[2].el, this.strips[0].el, center, this.strips[1].el, this.strips[3].el);
    this.setDeckCount(app.deckCount || 2);
    root.append(top, this.cueRoute, el('div', { class: 'xf-row' }, el('span', { class: 'lbl' }, 'A'), this.xf.el, el('span', { class: 'lbl' }, 'B')));

    eng.on('mixer', (i, name, v) => this.syncStrip(i, name, v));
    eng.on('xf', (v) => this.xf.set(v, true));
    eng.on('master', (v) => this.masterKnob.set(v, true));
    eng.on('cuemix', (v) => this.cueMixKnob.set(v, true));
    eng.on('phones', (v) => this.phonesKnob.set(v, true));
    eng.on('samplervol', (v) => this.samplerKnob.set(v, true));
    eng.on('split', (on) => { this.splitBtn.classList.toggle('on', on); this.updateCueRoute(); });
    eng.on('outputs', () => this.updateCueRoute());
    this.updateCueRoute();
  }

  setDeckCount(n) {
    this.strips.forEach((s, i) => { s.el.hidden = i >= n; });
    this.root.classList.toggle('four', n === 4);
  }

  updateCueRoute() {
    const eng = this.app.engine;
    this.root.classList.toggle('external', eng.outputMode === 'external');
    if (eng.outputMode === 'external') {
      this.cueRoute.textContent = 'MESA EXTERNA · EQ, faders y crossfader en tu mezclador';
      this.cueRoute.classList.remove('warn');
      return;
    }
    const hasCueOutput = eng.outputMode === '4ch' || (eng.outputMode === 'separate' && !!this.app.settings.cueDevice);
    if (eng.split) {
      this.cueRoute.textContent = hasCueOutput
        ? 'SPLIT · L CUE / R MASTER'
        : 'SPLIT · SALIDA COMPARTIDA · L CUE / R MASTER';
    } else {
      this.cueRoute.textContent = hasCueOutput
        ? 'CUE MIX · mezcla previa / master'
        : 'SIN SALIDA CUE: PFL no audible · activa SPLIT';
    }
    this.cueRoute.classList.toggle('warn', !hasCueOutput && !eng.split);
    this.splitBtn.title = eng.outputMode === 'stereo'
      ? 'Split Cue usa izquierda para CUE y derecha para MASTER en la salida estéreo seleccionada'
      : 'Auriculares: cue a la izquierda, master a la derecha';
  }

  buildStrip(ch, i) {
    const s = {};
    const set = (n) => (v) => ch.set(n, v);
    // los knobs del canal en el color de su deck (variable CSS: cambia al instante con el tema)
    const dc = `var(--deck${i})`;
    s.trim = new Knob({ label: 'GAIN', value: ch.values.trim, def: 0.5, bipolar: true, size: 32, color: dc, onChange: set('trim') });
    s.high = new Knob({ label: 'HI', value: ch.values.high, def: 0.5, bipolar: true, size: 32, color: dc, onChange: set('high') });
    s.mid = new Knob({ label: 'MID', value: ch.values.mid, def: 0.5, bipolar: true, size: 32, color: dc, onChange: set('mid') });
    s.low = new Knob({ label: 'LOW', value: ch.values.low, def: 0.5, bipolar: true, size: 32, color: dc, onChange: set('low') });
    s.filter = new Knob({ label: 'FILTER', value: ch.values.filter, def: 0.5, bipolar: true, color: '#ffa31a', size: 32, onChange: set('filter') });
    s.cue = btn('CUE', { cls: 'pfl', onClick: () => ch.set('pfl', !ch.values.pfl), title: 'Escucha previa en auriculares' });
    s.fader = new Fader({ vertical: true, value: ch.values.fader, def: 1, length: 112, cls: 'chfader', onChange: set('fader') });
    s.meter = el('div', { class: 'meter' }, el('div', { class: 'meter-fill' }));
    // "kill" rápido con clic derecho en los EQ
    for (const k of ['high', 'mid', 'low']) {
      s[k].el.addEventListener('contextmenu', (e) => { e.preventDefault(); ch.set(k, ch.values[k] < 0.05 ? 0.5 : 0); });
    }
    for (const k of ['high', 'mid', 'low', 'filter']) s[k].el.classList.add('ext-off');
    s.fader.el.classList.add('ext-off'); s.cue.classList.add('ext-off');
    s.el = el('div', { class: 'strip s' + i },
      el('div', { class: 'strip-num' }, String(i + 1)),
      s.trim.el, s.high.el, s.mid.el, s.low.el, s.filter.el, s.cue,
      el('div', { class: 'fader-meter' }, i % 2 === 0 ? s.meter : s.fader.el, i % 2 === 0 ? s.fader.el : s.meter));
    return s;
  }

  syncStrip(i, name, v) {
    const s = this.strips[i];
    if (!s) return;
    if (name === 'pfl') s.cue.classList.toggle('on', !!v);
    else if (s[name] && s[name].set) s[name].set(v, true);
  }

  // Vúmetros: la barra recorta su parte de arriba (clip-path, sin recalcular la maquetación como con `height`)
  // y solo se toca si el nivel cambia al menos un 1 %
  frame() {
    const m = this.app.engine.meters();
    const set = (meter, p) => {
      const v = Math.round(peakToMeter(p) * 100), f = meter.firstChild;
      if (f._v !== v) { f._v = v; f.style.clipPath = `inset(${100 - v}% 0 0 0)`; }
    };
    m.ch.forEach((p, i) => { if (this.strips[i]) set(this.strips[i].meter, p); });
    set(this.mL, m.L); set(this.mR, m.R);
    const clip = Math.max(m.L, m.R) >= 0.99;
    if (clip) this.clipUntil = performance.now() + 600;
    this.clip.classList.toggle('on', performance.now() < (this.clipUntil || 0));
    return m;
  }
}
