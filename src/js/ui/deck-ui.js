// Interfaz de un deck
import { el, fmtTime, CUE_COLORS, clamp, keyColor, DECK_COLORS } from '../util.js';
import { TC } from './theme.js';
import { btn, Fader } from './controls.js';
import { WaveDetail, WaveOverview, isShown } from './waveform.js';
import { PAD_MODES, PAD_MODE_NAMES, fmtBeats, RANGES } from '../audio/deck.js';
import { STEMS } from '../audio/stems.js';

// cambia el texto solo si es distinto (asignar el mismo texto también invalida la maquetación)
const setText = (node, s) => { if (node._t !== s) { node._t = s; node.textContent = s; } };

export class DeckUI {
  constructor(app, deck, root) {
    this.app = app; this.deck = deck; this.root = root;
    // d0/d1 = lado (izquierda: decks 1 y 3; derecha: 2 y 4); n0..n3 = color del deck
    root.classList.add('deck', 'd' + (deck.idx % 2), 'n' + deck.idx);
    this.build();
    for (const ev of ['state', 'tempo', 'track', 'cues', 'loop', 'pads', 'stems', 'grid']) deck.on(ev, () => this.refresh(ev));
    // último deck tocado: el zoom independiente de los botones y del teclado se aplica a ese deck
    root.addEventListener('pointerdown', () => { app.lastDeckTouched = deck.idx; }, true);
    app.on('settings', () => this.refresh('state'));
    app.on('expansions', () => this.refresh('state'));
    app.sampler.on('voices', () => this.refreshPads());
    app.sampler.on('change', () => this.refreshPads());
    this.refresh('track');
  }

  build() {
    const d = this.deck, app = this.app;
    const n = d.idx + 1;
    this.title = el('div', { class: 'd-title' }, '—');
    this.artist = el('div', { class: 'd-artist' }, '');
    this.keyEl = el('div', { class: 'd-key', title: 'Tonalidad (Camelot)' });
    this.bpmEl = el('div', { class: 'd-bpm', title: 'Doble clic para editar el BPM' }, el('b', {}, '—'), el('small', {}, 'BPM'));
    this.bpmEl.addEventListener('dblclick', () => this.editBpm());
    this.tempoEl = el('div', { class: 'd-tempo' });
    // medidor de fase respecto al maestro: punto en el centro = en fase (verde); a los lados, por delante o por detrás
    this.phaseDot = el('b', { class: 'pm-dot' });
    this.phaseMeter = el('div', { class: 'phase-meter off', title: 'Fase respecto al deck maestro' }, el('i', { class: 'pm-c' }), this.phaseDot);
    this.elapsed = el('span', { class: 'elapsed' }, '00:00.0');
    this.remain = el('span', { class: 'remain' }, '-00:00.0');
    this.elapsedClock = el('div', { class: 'deck-clock elapsed-clock' }, el('small', {}, 'ELAPSED'), this.elapsed);
    this.remainClock = el('div', { class: 'deck-clock remain-clock' }, el('small', {}, 'REMAIN'), this.remain);
    this.ytBadge = el('span', { class: 'yt-badge' }, 'YouTube');
    // selector de capa (solo con 4 decks): 1|3 a la izquierda, 2|4 a la derecha
    const pair = [d.idx % 2, d.idx % 2 + 2];
    this.layerTabs = el('div', { class: 'layer-tabs', title: 'Deck visible en este lado' },
      ...pair.map(i => { const b = btn(String(i + 1), { cls: 'micro layer-tab', onClick: () => app.focusDeck(i) }); b.style.setProperty('--lc', `var(--deck${i})`); b.dataset.deck = i; return b; }));
    const head = el('div', { class: 'deck-head' },
      el('div', { class: 'deck-num' }, String(n)), this.layerTabs,
      el('div', { class: 'deck-meta' }, this.title, el('div', { class: 'd-sub' }, this.ytBadge, this.artist)),
      el('div', { class: 'deck-stats' },
        this.keyEl,
        el('div', { class: 'd-bpmbox' }, this.bpmEl, this.tempoEl, this.phaseMeter)));

      this.wavePanel = el('div', { class: 'deck-wave-panel' }, this.elapsedClock, this.detailCanvas = el('canvas', { class: 'wave deck-detail-wave' }), this.remainClock);
      this.overviewPanel = el('div', { class: 'deck-overview-panel' }, this.ovCanvas = el('canvas', { class: 'overview' }));
    this.overview = new WaveOverview(this.ovCanvas, d);

    // --- plato / vídeo
    this.platter = el('canvas', { class: 'platter', width: 360, height: 360 });
    this.ytBox = el('div', { class: 'yt-box' });
    d.ytContainer = this.ytBox;
    const platWrap = el('div', { class: 'platter-wrap' }, this.platter, this.ytBox);
    this.bindPlatter();

    this.cueBtn = btn('CUE', { cls: 'big cue', onDown: () => d.cueDown(), onUp: () => d.cueUp(), title: 'Cue (Mayús+clic: ir al inicio)' });
    this.playBtn = btn('▶︎❚❚', { cls: 'big play', onDown: (e) => (e.shiftKey ? d.stutter() : d.togglePlay()), title: 'Play / Pausa (Mayús: stutter)' });
    
    const platCol = el('div', { class: 'platter-col' }, platWrap);

    // --- botones de rendimiento
    this.syncBtn = btn('SYNC', { cls: 'sync', onClick: () => d.toggleSync(), title: 'Sincroniza el tempo y la fase con el deck maestro (MASTER) y los mantiene' });
    this.masterEl = btn('MASTER', { cls: 'micro master-ind', onClick: () => app.syncMgr.setMaster(d),
      title: 'Deck maestro del sync: los decks con SYNC siguen su tempo y su fase. Por defecto es el primero que suena; pulsa para que sea este' });
    this.keylockBtn = btn('KEY LOCK', { cls: 'small', onClick: () => d.toggleKeylock(), title: 'Mantiene la tonalidad al cambiar el tempo' });
    this.slipBtn = btn('SLIP', { cls: 'small', onClick: () => d.toggleSlip() });
    this.vinylBtn = btn('VINYL', { cls: 'small', onClick: () => d.toggleVinyl(), title: 'Plato en modo vinilo (scratch) o nudge' });
    this.censorBtn = btn('CENSOR', { cls: 'small', onDown: () => d.censor(true), onUp: () => d.censor(false), title: 'Reproduce al revés mientras se mantiene' });
    this.qBtn = btn('Q', { cls: 'small q', onClick: () => app.setSetting('quantize', !app.settings.quantize), title: 'Cuantización (global)' });
    const transport = el('div', { class: 'transport' }, this.cueBtn, this.playBtn, this.syncBtn);
    platCol.appendChild(transport);
    const perfRow = el('div', { class: 'row perf' }, this.masterEl, this.keylockBtn, this.slipBtn, this.vinylBtn, this.censorBtn, this.qBtn);

    // --- stems (IA): voz, batería, bajo, melodía
    this.stemBtns = STEMS.map((st, k) => {
      const b = btn(st.short, { cls: 'small stem', title: `${st.name}: activar/silenciar · Mayús+clic: solo`, onClick: (e) => {
        if (e && e.shiftKey && d.stemsOn) { const g = [0, 0, 0, 0]; g[k] = 1; d.setStemGains(g); }
        else d.toggleStem(k);
      } });
      b.style.setProperty('--stem', st.color);
      return b;
    });
    this.stemSepBtn = btn('✨ SEPARAR', { cls: 'small stem-sep', title: 'Separar esta pista en stems con IA (Demucs, en tu GPU)', onClick: () => { if (d.track) app.stems.separate([d.track]); } });
    // unidad que procesa los Stems FX de este deck (Mayús + pad en el modo Stems)
    this.stemFxUnitBtn = btn('FX1', { cls: 'micro stem-fxu', title: 'Unidad de efectos para Stems FX (clic: cambiar)', onClick: () => d.setStemFxUnit(d.stemFxUnit ? 0 : 1) });
    this.stemsRow = el('div', { class: 'row stems-row' }, el('span', { class: 'lbl' }, 'STEMS'), ...this.stemBtns, this.stemFxUnitBtn, this.stemSepBtn);

    this.tabs = el('div', { class: 'pad-tabs' });
    for (const m of PAD_MODES) {
      const t = el('button', { class: 'pad-tab', dataset: { mode: m } }, PAD_MODE_NAMES[m]);
      t.addEventListener('click', () => d.setPadMode(m));
      this.tabs.appendChild(t);
    }
    this.padsEl = el('div', { class: 'pads' });
    this.pads = [];
    for (let i = 0; i < 8; i++) {
      const p = el('div', { class: 'pad' }, el('span', { class: 'pad-label' }, String(i + 1)));
      p.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); p.setPointerCapture(e.pointerId); d.padDown(i, e.shiftKey || e.altKey); });
      const up = () => d.padUp(i);
      p.addEventListener('pointerup', up);
      p.addEventListener('pointercancel', up);
      p.addEventListener('contextmenu', (e) => { e.preventDefault(); this.padMenu(i, e); });
      this.pads.push(p);
      this.padsEl.appendChild(p);
    }

    // --- loops
    this.loopSize = el('span', { class: 'val' }, '4');
    this.autoBtn = btn('LOOP', { cls: 'loop', onClick: () => d.autoLoop(), title: 'Auto loop' });
    const loopRow = el('div', { class: 'row loops' },
      btn('◀', { cls: 'tiny', onClick: () => d.loopHalve(), title: 'Loop ½' }), this.loopSize,
      btn('▶', { cls: 'tiny', onClick: () => d.loopDouble(), title: 'Loop ×2' }),
      this.autoBtn,
      btn('IN', { cls: 'small', onClick: () => d.loopIn() }),
      btn('OUT', { cls: 'small', onClick: () => d.loopOut() }),
      this.reloopBtn = btn('RELOOP', { cls: 'small', onClick: () => d.reloop(), title: 'Activar/salir del último loop' }),
      btn('◁', { cls: 'tiny', onClick: () => d.loopMove(-1), title: 'Mover loop 1 beat atrás' }),
      btn('▷', { cls: 'tiny', onClick: () => d.loopMove(1), title: 'Mover loop 1 beat adelante' }));

    this.jumpSize = el('span', { class: 'val' }, '4');
    this.semisEl = el('span', { class: 'val' }, '0');
    const jumpRow = el('div', { class: 'row jump' },
      el('span', { class: 'lbl' }, 'JUMP'),
      // « y »: ⏪/⏩ salen en Windows como emoji azul (también con el selector de texto U+FE0E)
      btn('«', { cls: 'tiny', title: 'Saltar atrás', onClick: () => d.beatJump(-d.jumpBeats) }),
      el('span', { class: 'sizepick' },
        btn('−', { cls: 'micro', onClick: () => d.setJumpSize(-1) }), this.jumpSize, btn('+', { cls: 'micro', onClick: () => d.setJumpSize(1) })),
      btn('»', { cls: 'tiny', title: 'Saltar adelante', onClick: () => d.beatJump(d.jumpBeats) }),
      el('span', { class: 'sep' }),
      el('span', { class: 'lbl' }, 'KEY'),
      btn('−', { cls: 'tiny', onClick: () => d.keyShift(-1) }), this.semisEl,
      btn('+', { cls: 'tiny', onClick: () => d.keyShift(1) }),
      btn('0', { cls: 'tiny', onClick: () => d.keyReset(), title: 'Tonalidad original' }),
      btn('SYNC', { cls: 'small', onClick: () => d.keySync(), title: 'Ajustar tonalidad a la del otro deck' }));

    const gridRow = el('div', { class: 'row grid' },
      el('span', { class: 'lbl' }, 'GRID'),
      btn('TAP', { cls: 'small', onClick: () => d.tap(), title: 'Tap tempo (4 pulsaciones)' }),
      btn('×2', { cls: 'tiny', onClick: () => d.bpmScale(2) }),
      btn('½', { cls: 'tiny', onClick: () => d.bpmScale(0.5) }),
      btn('◂', { cls: 'tiny', onClick: () => d.gridShift(-5), title: 'Desplazar grid −5 ms' }),
      btn('▸', { cls: 'tiny', onClick: () => d.gridShift(5), title: 'Desplazar grid +5 ms' }),
      btn('1 AQUÍ', { cls: 'small', onClick: () => d.downbeatHere(), title: 'Compás aquí: el primer tiempo de compás cae en la posición actual' }),
      this.gridEditBtn = btn('✎', { cls: 'tiny', title: 'Editor de beatgrid (marcas y BPM variable)', onClick: () => { this.gridEdit = !this.gridEdit; this.refresh('grid'); } }),
      el('span', { class: 'sep' }),
      btn('EJECT', { cls: 'small', onClick: () => d.eject() }));

    // editor de beatgrid: marcas en la posición del cabezal y BPM del tramo actual
    this.gridBpmEl = el('span', { class: 'val grid-bpm', title: 'BPM del tramo actual (clic para escribirlo)' }, '—');
    this.gridBpmEl.addEventListener('click', async () => {
      if (!d.bpm) return;
      const v = await app.prompt('BPM exacto del tramo actual', d.bpm.toFixed(3));
      const n = parseFloat(String(v || '').replace(',', '.'));
      if (n > 20 && n < 300) d.setBpm(n);
    });
    this.gridCount = el('span', { class: 'lbl grid-count' }, '');
    this.gridEditRow = el('div', { class: 'row grid-edit hidden' },
      el('span', { class: 'lbl' }, 'MARCAS'),
      btn('+', { cls: 'tiny', title: 'Añadir marca de grid aquí: coloca el cabezal sobre el golpe (pausa y ajusta con el plato) y pulsa', onClick: () => d.addGridMarker() }),
      btn('−', { cls: 'tiny', title: 'Quitar la marca más cercana', onClick: () => d.removeGridMarker() }),
      this.gridCount,
      el('span', { class: 'sep' }),
      el('span', { class: 'lbl' }, 'BPM'),
      btn('−', { cls: 'micro', title: '−0,01 BPM en el tramo actual', onClick: () => d.bpmNudge(-0.01) }),
      this.gridBpmEl,
      btn('+', { cls: 'micro', title: '+0,01 BPM en el tramo actual', onClick: () => d.bpmNudge(0.01) }),
      btn('FIJO', { cls: 'small', title: 'Quitar todas las marcas (BPM fijo)', onClick: () => d.clearGridMarkers() }));
    // edición en la posición del cabezal (pausa y coloca el cabezal sobre el golpe)
    this.gridUndoBtn = btn('↶', { cls: 'tiny', title: 'Deshacer el último cambio del grid', onClick: () => d.undoGrid() });
    this.gridHereRow = el('div', { class: 'row grid-edit grid-here hidden' },
      el('span', { class: 'lbl' }, 'AQUÍ'),
      btn('INICIO', { cls: 'small', title: 'Inicio del grid aquí: el primer beat pasa a la posición actual', onClick: () => d.editGrid('start') }),
      btn('BEAT', { cls: 'small', title: 'Beat aquí: el beat más cercano cae en la posición actual y se reajusta el BPM del tramo', onClick: () => d.editGrid('beat') }),
      btn('COMPÁS', { cls: 'small', title: 'Compás aquí: la posición actual pasa a ser el primer tiempo de un compás', onClick: () => d.downbeatHere() }),
      btn('BPM…', { cls: 'small', title: 'Cambio de BPM aquí (en el compás o beat más cercano)', onClick: () => this.tempoChangeDialog() }),
      el('span', { class: 'sep' }),
      this.gridUndoBtn);

    const perfCol = el('div', { class: 'perf-col' }, perfRow, this.stemsRow, this.tabs, this.padsEl, this.padHint = el('div', { class: 'pad-hint hidden' }), loopRow, jumpRow, gridRow, this.gridEditRow, this.gridHereRow);

    this.flipSlot = el('select', { class: 'sel tiny-sel flip-slot', title: 'Ranura Flip (máximo 6)' },
      ...Array.from({ length: 6 }, (_, i) => el('option', { value: i }, `F${i + 1}`)));
    this.flipRecordBtn = btn('● FLIP REC', { cls: 'micro rec', onClick: () => {
      if (app.expansions.state(d).recording) app.expansions.stopFlipRecord(d);
      else app.expansions.startFlipRecord(d, Number(this.flipSlot.value));
      this.refresh('state');
    } });
    this.flipPlayBtn = btn('▶ FLIP', { cls: 'micro', onClick: () => {
      if (app.expansions.state(d).playing) app.expansions.stopFlip(d);
      else if (!app.expansions.playFlip(d, Number(this.flipSlot.value))) app.toast('No hay un Flip válido en esa ranura', 'warn');
      this.refresh('state');
    } });
    const flipRow = el('div', { class: 'row flip-row' }, el('span', { class: 'lbl' }, 'FLIP'), this.flipSlot, this.flipRecordBtn, this.flipPlayBtn,
      btn('✎', { cls: 'micro', title: 'Nombrar Flip', onClick: async () => {
        const flips = app.expansions.flipList(d).slice(), i = Number(this.flipSlot.value), flip = flips[i];
        if (!flip) return app.toast('Graba primero una secuencia Flip', 'info');
        const name = await app.prompt('Nombre del Flip', flip.name || `Flip ${i + 1}`);
        if (name) { flips[i] = { ...flip, name }; app.expansions.saveFlipList(d, flips); }
      } }));
    perfCol.appendChild(flipRow);

    // --- pitch
    this.rangeBtn = btn('±8%', { cls: 'small', onClick: () => d.cycleRange(), title: 'Rango del pitch' });
    this.pitchFader = new Fader({ vertical: true, value: 0.5, def: 0.5, length: 196, notch: 0.5, cls: 'pitch', reversed: true,
      onChange: (v) => d.setPitchFader(v * 2 - 1) });
    this.pitchPct = el('div', { class: 'pitch-pct' }, '0.00%');
    const pitchCol = el('div', { class: 'pitch-col' },
      this.rangeBtn, this.pitchFader.el, this.pitchPct,
      el('div', { class: 'bend' },
        btn('−', { cls: 'tiny', onDown: (e) => d.bendDown(-1, e.shiftKey), onUp: () => d.bendUp(), title: 'Pitch bend −' }),
        btn('+', { cls: 'tiny', onDown: (e) => d.bendDown(1, e.shiftKey), onUp: () => d.bendUp(), title: 'Pitch bend +' })),
      btn('RESET', { cls: 'micro', onClick: () => { d.resetTempo(); this.pitchFader.set(0.5, true); } }));

    const body = el('div', { class: 'deck-body' }, pitchCol, platCol, perfCol);
    this.root.append(head, this.wavePanel, this.overviewPanel, body);
    this.waveDetail = new WaveDetail(this.detailCanvas, d, app);
    this.waveDetail.setWave(this.overview.wave);

    // soltar pistas
    this.root.addEventListener('dragover', (e) => { e.preventDefault(); this.root.classList.add('drop'); });
    this.root.addEventListener('dragleave', () => this.root.classList.remove('drop'));
    this.root.addEventListener('drop', async (e) => {
      e.preventDefault(); this.root.classList.remove('drop');
      const id = e.dataTransfer.getData('text/nexura-track');
      if (id) return app.loadToDeck(id.split(',')[0], d.idx);
      if (e.dataTransfer.files.length) {
        const added = await app.importDropped(e.dataTransfer.files);
        if (added[0]) app.loadToDeck(added[0].id, d.idx);
      }
    });
  }

  bindPlatter() {
    const c = this.platter, d = this.deck;
    let lastA = null, down = false;
    const ang = (e) => { const r = c.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    c.addEventListener('pointerdown', (e) => {
      if (!d.track) return;
      down = true; lastA = ang(e); c.setPointerCapture(e.pointerId);
      d.jogTouch(true);
    });
    c.addEventListener('pointermove', (e) => {
      if (!down) return;
      const a = ang(e);
      let da = a - lastA;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      lastA = a;
      d.jogTurn((da / (2 * Math.PI)) * 605, 605);
    });
    const up = () => { if (!down) return; down = false; d.jogTouch(false); };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); d.jogTurn(-Math.sign(e.deltaY) * 12, 605); }, { passive: false });
  }

  async editBpm() {
    const d = this.deck;
    if (!d.track) return;
    const v = await this.app.prompt('BPM de la pista', d.bpm ? String(d.bpm) : '', 'Introduce el BPM (p. ej. 124 o 87.5)');
    const n = parseFloat(String(v || '').replace(',', '.'));
    if (n > 20 && n < 400) d.setBpm(n);
  }

  // «Cambio de BPM aquí»: BPM nuevo y si el cambio cae en el compás o en el beat más cercano
  async tempoChangeDialog() {
    const d = this.deck, app = this.app;
    if (!d.track || !d.bpm) return app.toast('Primero analiza la pista o fija su BPM', 'warn');
    if (!d.gridEditable()) return;
    const inp = el('input', { class: 'wide', type: 'text', value: d.bpm.toFixed(2), inputmode: 'decimal' });
    const lvl = el('select', { class: 'sel wide' }, el('option', { value: 'bar' }, 'En el compás más cercano'), el('option', { value: 'beat' }, 'En el beat más cercano'));
    const ok = await app.modal('Cambio de BPM aquí', el('div', { class: 'form' },
      el('p', { class: 'hint' }, 'BPM nuevo desde aquí'), inp,
      el('p', { class: 'hint' }, 'Dónde empieza el tramo nuevo'), lvl,
      el('p', { class: 'set-note' }, 'Las marcas siguientes se desplazan para conservar sus beats. Se puede deshacer con ↶.')),
    ['Cancelar', 'Aplicar']);
    if (ok !== 1) return;
    const bpm = parseFloat(String(inp.value).replace(',', '.'));
    if (!(bpm > 20 && bpm < 400)) return app.toast('BPM no válido', 'warn');
    d.editGrid('tempo', { bpm: Math.round(bpm * 1000) / 1000, level: lvl.value });
  }

  padMenu(i, e) {
    const d = this.deck;
    if (d.padMode === 'hotcue' && d.track && d.track.cues[i]) {
      this.app.contextMenu(e, [
        { label: 'Renombrar…', fn: async () => { const n = await this.app.prompt('Nombre del cue', d.track.cues[i].name || ''); if (n != null) d.setCueName(i, n); } },
        { label: 'Color', sub: CUE_COLORS.map(c => ({ label: '●', color: c, fn: () => d.setCueColor(i, c) })) },
        d.track.cues[i].le
          ? { label: 'Convertir en hot cue normal', fn: () => d.cueToggleLoop(i) }
          : { label: d.loop.e > d.loop.s ? 'Convertir en Cue Loop (loop actual)' : 'Convertir en Cue Loop', fn: () => d.cueToggleLoop(i) },
        { label: 'Borrar hot cue', fn: () => d.deleteCue(i) }
      ]);
    } else if (d.padMode === 'cueloop' && d.track && d.track.cueLoops && d.track.cueLoops[i]) {
      this.app.contextMenu(e, [
        { label: 'Renombrar…', fn: async () => { const n = await this.app.prompt('Nombre del Cue Loop', d.track.cueLoops[i].name || ''); if (n != null) d.setCueLoopName(i, n); } },
        { label: 'Color', sub: CUE_COLORS.map(c => ({ label: '●', color: c, fn: () => d.setCueLoopColor(i, c) })) },
        { label: 'Borrar Cue Loop (Mayús/Alt + pad)', fn: () => d.deleteCueLoop(i) }
      ]);
    } else if (d.padMode === 'savedloop' && d.track && d.track.loops[i]) {
      this.app.contextMenu(e, [
        { label: 'Pasar a hot cue (Cue Loop)', fn: () => d.savedLoopToCue(i) },
        { label: 'Borrar loop guardado', fn: () => d.deleteSavedLoop(i) }
      ]);
    } else if (d.padMode === 'sampler') {
      this.app.contextMenu(e, [
        { label: 'Cargar muestra…', fn: () => this.app.samplerLoadDialog(i) },
        { label: 'Vaciar ranura', fn: () => this.app.sampler.clearSlot(i) }
      ]);
    }
  }

  refreshPads() {
    const d = this.deck;
    for (const t of this.tabs.children) t.classList.toggle('on', t.dataset.mode === d.padMode);
    this.pads.forEach((p, i) => {
      const s = d.padState(i);
      p.querySelector('.pad-label').textContent = s.label || '';
      p.classList.toggle('lit', !!s.on);
      p.style.setProperty('--pad', s.on ? (s.color || 'var(--pad-on)') : (s.dim || 'transparent'));
      p.classList.toggle('dim', !s.on && !!s.dim);
      p.classList.toggle('cueloop', !!s.loop);
      p.classList.toggle('active', !!s.active);
      p.classList.toggle('stemfx', !!s.fx);
    });
    const stemsMode = d.padMode === 'stems' && !!d.track && !d.isYT;
    this.padHint.classList.toggle('hidden', !stemsMode);
    if (stemsMode) {
      this.padHint.textContent = !d.stemsOn ? 'Esta pista no tiene stems cargados: sepáralos con ✨ SEPARAR'
        : `Mayús + pad 1-4: Stems FX (FX ${d.stemFxUnit + 1}) · ${d.slip ? 'SLIP: mantener el pad silencia el stem' + (this.app.settings.stemSlipMode === 'loop' ? ' (en loop)' : '') : 'con SLIP, mantener = Stem Slip'}`;
    }
  }

  refresh(ev) {
    const d = this.deck, t = d.track, s = this.app.settings;
    if (ev === 'track') {
      this.title.textContent = t ? t.title || '(sin título)' : 'Sin pista';
      this.artist.textContent = t ? t.artist || '' : 'Arrastra una pista desde la biblioteca';
      this.root.classList.toggle('yt', !!(t && d.isYT));
      this.root.classList.toggle('empty', !t);
      const flipState = this.app.expansions.state(d);
      this.flipRecordBtn.disabled = !this.app.expansions.enabled('flip');
      this.flipPlayBtn.disabled = !this.app.expansions.enabled('flip');
      this.flipSlot.disabled = !this.app.expansions.enabled('flip');
      this.flipRecordBtn.classList.toggle('on', flipState.recording);
      this.flipRecordBtn.textContent = flipState.recording ? '■ FLIP STOP' : '● FLIP REC';
      this.flipPlayBtn.classList.toggle('on', flipState.playing);
      const flip = flipState.flips[Number(this.flipSlot.value)];
      this.flipPlayBtn.title = flip ? `${flip.name || 'Flip'} · ${flip.events?.length || 0} acciones` : 'Ranura vacía';
      // (si mientras tanto se ha cargado otra pista o un vídeo, la forma de onda ya no es de este deck)
      if (t && !d.isYT) this.app.analyzer.getWave(t.id).then(w => { if (d.track !== t || d.isYT) return; this.overview.setWave(w); this.waveDetail.setWave(w); });
      else { this.overview.setWave(null); this.waveDetail.setWave(null); }
    }
    this.playBtn.classList.toggle('on', d.playing);
    this.cueBtn.classList.toggle('on', !d.playing && !!t && Math.abs(d.time - d.cuePoint) < 0.03);
    this.syncBtn.classList.toggle('on', d.sync);
    this.keylockBtn.classList.toggle('on', d.keylock);
    this.refreshStems();
    this.refreshGrid();
    this.refreshLayer();
    this.slipBtn.classList.toggle('on', d.slip);
    this.vinylBtn.classList.toggle('on', d.vinyl);
    this.censorBtn.classList.toggle('on', !!d.censoring);
    this.qBtn.classList.toggle('on', !!s.quantize);
    this.rangeBtn.textContent = '±' + Math.round(d.range * 100) + '%';
    this.loopSize.textContent = fmtBeats(d.loopBeats);
    this.jumpSize.textContent = fmtBeats(d.jumpBeats);
    this.autoBtn.classList.toggle('on', d.loop.on);
    this.reloopBtn.classList.toggle('on', d.loop.on);
    this.semisEl.textContent = (d.semis > 0 ? '+' : '') + d.semis;
    if (ev === 'tempo' && (!d.sync || d.isSyncMaster)) this.pitchFader.set((d.pitch + 1) / 2, true);
    this.refreshPads();
  }

  refreshLayer() {
    const four = this.app.deckCount === 4;
    this.layerTabs.hidden = !four;
    if (!four) return;
    for (const b of this.layerTabs.children) {
      const i = +b.dataset.deck, dk = this.app.decks[i];
      b.classList.toggle('on', this.app.layers[i % 2] === i);
      b.classList.toggle('playing', !!(dk && dk.playing));
    }
  }

  refreshGrid() {
    const d = this.deck, ok = !!(d.track && !d.isYT);
    this.gridEditRow.classList.toggle('hidden', !(this.gridEdit && ok));
    this.gridHereRow.classList.toggle('hidden', !(this.gridEdit && ok));
    this.gridEditBtn.classList.toggle('on', !!this.gridEdit);
    if (!this.gridEdit || !ok) return;
    this.gridUndoBtn.disabled = !d.canUndoGrid();
    const n = d.hasGridMarkers ? d.track.grid.length : (d.bpm ? 1 : 0);
    this.gridCount.textContent = n > 1 ? `${n} · tramo ${Math.max(1, d.track.grid.filter(m => m.t <= d.time + 1e-3).length)}` : (n ? 'fijo' : '—');
    this.gridBpmEl.textContent = d.bpm ? d.bpm.toFixed(2) : '—';
  }

  refreshStems() {
    const d = this.deck, t = d.track;
    const show = !!(t && !d.isYT && this.app.stems && this.app.stems.available);
    this.stemsRow.classList.toggle('hidden', !show);
    if (!show) return;
    this.stemsRow.classList.toggle('loaded', d.stemsOn);
    this.stemBtns.forEach((b, k) => { b.disabled = !d.stemsOn && !t.stems; b.classList.toggle('on', d.stemsOn && d.stemGains[k] > 0.5); b.classList.toggle('fx', d.stemsOn && d.stemFx[k]); });
    this.stemFxUnitBtn.textContent = 'FX' + (d.stemFxUnit + 1);
    this.stemFxUnitBtn.classList.toggle('on', d.stemsOn && d.stemFx.some(Boolean));
    this.stemFxUnitBtn.classList.toggle('hidden', !t.stems);
    const S = this.app.stems, queued = S.bgQueue.includes(t.id);
    this.stemSepBtn.classList.toggle('hidden', !!t.stems);
    this.stemSepBtn.disabled = S.busy && !S.bgRunning;
    this.stemSepBtn.textContent = queued ? (S.busy ? '⏳ EN COLA / SEPARANDO' : '⏳ EN COLA') : (S.busy && !S.bgRunning ? '⏳ SEPARANDO…' : '✨ SEPARAR');
  }

  // actualización por frame: solo se toca el DOM si el texto o la clase cambian (cada cambio obliga al
  // navegador a recalcular estilos y maquetación)
  frame(isMaster) {
    const d = this.deck, t = d.track;
    const time = d.time;
    setText(this.elapsed, fmtTime(time));
    if (this.gridEdit && d.hasGridMarkers && (this._gf = (this._gf || 0) + 1) % 6 === 0) this.refreshGrid();
    // vídeo de YouTube cuya duración aún no ha dado el reproductor: «--:--» en vez de un 0 engañoso
    setText(this.remain, t && !d.duration ? '--:--.-' : '-' + fmtTime(Math.max(0, d.duration - time)));
    this.remain.classList.toggle('warn', d.playing && d.duration > 0 && d.duration - time < 30);
    const bpm = d.currentBpm;
    setText(this.bpmEl.firstChild, bpm ? bpm.toFixed(1) : '—');
    const pct = (d.tempo - 1) * 100, pctS = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    setText(this.tempoEl, pctS);
    setText(this.pitchPct, pctS);
    const key = d.displayKey;
    setText(this.keyEl, key || '—');
    const kc = d.semis !== 0 ? '' : keyColor(key);
    if (this._kc !== kc) { this._kc = kc; this.keyEl.style.color = kc; }
    this.keyEl.classList.toggle('shifted', d.semis !== 0);
    this.masterEl.classList.toggle('on', isMaster);
    this.cueBtn.classList.toggle('on', !d.playing && !!t && Math.abs(time - d.cuePoint) < 0.03);
    this.playBtn.classList.toggle('on', d.playing);
    this.syncBtn.classList.toggle('on', d.sync);
    if (d.padMode === 'slicer' || d.padMode === 'roll' || d.padMode === 'sampler') {
      if (!this._padTick || performance.now() - this._padTick > 120) { this._padTick = performance.now(); this.refreshPads(); }
    }
    this.framePhase();
    this.overview.draw();
    this.waveDetail.draw();
    this.drawPlatter(time);
  }

  // Medidor de fase: ±½ beat a lo ancho; verde = en fase (≤ 10 ms), ámbar = poco desfase, rojo = desfasado.
  // Oculto si no hay un maestro sonando o si este deck es el maestro.
  framePhase() {
    const d = this.deck, info = d.phaseInfo();
    const off = !info;
    if (this._pmOff !== off) { this._pmOff = off; this.phaseMeter.classList.toggle('off', off); }
    if (off) return;
    const ms = info.ms, abs = Math.abs(ms);
    const cls = abs <= 10 ? 'ok' : abs <= 30 ? 'warn' : 'bad';
    const x = Math.round(clamp(info.beat, -0.5, 0.5) * 2 * 30); // ±30 px
    if (x !== this._pmX) { this._pmX = x; this.phaseDot.style.transform = `translateX(${x}px)`; }
    if (cls !== this._pmCls) { this._pmCls = cls; this.phaseMeter.dataset.state = cls; }
    const now = performance.now();
    if (now - (this._pmT || 0) > 300) {
      this._pmT = now;
      const s = abs <= 10 ? `En fase con el Deck ${info.master.idx + 1}` : `${ms > 0 ? 'Por detrás' : 'Por delante'} del Deck ${info.master.idx + 1}: ${Math.round(abs)} ms`;
      if (this.phaseMeter.title !== s) this.phaseMeter.title = s;
    }
  }

  // Plato: el fondo (degradado, surcos, círculo central) se pinta una vez; en cada frame solo lo que se mueve.
  // Si no se ve (pantallas pequeñas, deck de YouTube) o nada ha cambiado, no se dibuja.
  drawPlatter(time) {
    const c = this.platter, d = this.deck;
    if (!isShown(c) || d.isYT) return;
    const accent = DECK_COLORS[d.idx];
    // el tema entra en la clave: al cambiarlo se redibuja (y el fondo se rehace con sus colores)
    const theme = `${TC['platter-in']}|${TC['platter-out']}|${TC['platter-hub']}|${accent}`;
    const key = `${Math.round(time * 120)}|${d.currentBpm.toFixed(2)}|${d.tempo}|${d.scratching}|${d.vinyl}|${d.playing}|${d.duration}|${theme}`;
    if (key === this._platKey) return;
    this._platKey = key;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height, r = w / 2 - 6;
    if (!this._platBg || this._platBgTheme !== theme) {
      const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
      const b = bg.getContext('2d');
      b.translate(w / 2, h / 2);
      const g = b.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      g.addColorStop(0, TC['platter-in']); g.addColorStop(1, TC['platter-out']);
      b.fillStyle = g;
      b.beginPath(); b.arc(0, 0, r, 0, Math.PI * 2); b.fill();
      b.strokeStyle = 'rgba(255,255,255,0.035)';
      for (let rr = r * 0.4; rr < r * 0.95; rr += 7) { b.beginPath(); b.arc(0, 0, rr, 0, Math.PI * 2); b.stroke(); }
      b.strokeStyle = 'rgba(255,255,255,0.08)'; b.lineWidth = 6;
      b.beginPath(); b.arc(0, 0, r - 4, 0, Math.PI * 2); b.stroke();
      this._platBg = bg; this._platBgTheme = theme;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this._platBg, 0, 0);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    // progreso
    if (d.duration) {
      const p = clamp(time / d.duration, 0, 1);
      ctx.lineWidth = 6;
      ctx.strokeStyle = d.duration - time < 30 && d.playing ? '#ffa31a' : accent;
      ctx.beginPath(); ctx.arc(0, 0, r - 4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
    }
    // marcador giratorio (33⅓ rpm)
    const a = (time / 1.8) * Math.PI * 2 - Math.PI / 2;
    ctx.rotate(a);
    ctx.fillStyle = d.scratching ? '#ffffff' : accent;
    ctx.fillRect(-3, -(r - 12), 6, r * 0.35);
    ctx.restore();
    // centro: BPM, pitch y tiempos (como en las cabinas digitales)
    const cx = w / 2, cy = h / 2, ri = r * 0.66;
    ctx.fillStyle = TC['platter-hub'];
    ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = TC['platter-label']; ctx.font = '700 17px Inter, sans-serif';
    ctx.fillText(`DECK ${d.idx + 1} · ${d.vinyl ? 'VINYL' : 'JOG'}`, cx, cy - ri * 0.62);
    const bpm = d.currentBpm;
    ctx.fillStyle = '#ffffff'; ctx.font = '700 58px "Cascadia Mono", Consolas, monospace';
    ctx.fillText(bpm ? bpm.toFixed(2) : '—', cx, cy - ri * 0.2);
    const pct = (d.tempo - 1) * 100;
    ctx.fillStyle = accent; ctx.font = '700 22px "Cascadia Mono", Consolas, monospace';
    ctx.fillText((pct >= 0 ? '+' : '') + pct.toFixed(1) + '%', cx, cy + ri * 0.17);
    if (d.track) {
      ctx.fillStyle = TC['platter-time']; ctx.font = '600 20px "Cascadia Mono", Consolas, monospace';
      ctx.fillText(fmtTime(time), cx, cy + ri * 0.45);
      const rem = Math.max(0, d.duration - time);
      ctx.fillStyle = rem < 30 && d.playing ? '#ffa31a' : TC['platter-label'];
      ctx.fillText('-' + fmtTime(rem), cx, cy + ri * 0.7);
    }
  }
}
