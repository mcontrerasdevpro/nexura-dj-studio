// Nexura DJ Studio — aplicación principal
import { Emitter, el, $, toast, debounce, fmtTime, clamp } from './util.js';
import { platform, isDesktop } from './platform.js';
import { AudioEngine } from './audio/engine.js';
import { Deck } from './audio/deck.js';
import { FxUnit, EFFECTS, BEAT_VALUES } from './audio/fx.js';
import { Sampler } from './audio/sampler.js';
import { ExpansionManager } from './audio/expansions.js';
import { Analyzer } from './analysis/analyzer.js';
import { Library } from './library/library.js';
import { YouTubeService } from './youtube/youtube.js';
import { SpotifyService } from './spotify/spotify.js';
import { SpotifyImportUI } from './ui/spotify-ui.js';
import { MidiManager, buildActions } from './midi/midi.js';
import { DeckUI } from './ui/deck-ui.js';
import { MixerUI } from './ui/mixer-ui.js';
import { FxUnitUI } from './ui/fx-ui.js';
import { SamplerUI } from './ui/sampler-ui.js';
import { LibraryUI } from './ui/library-ui.js';
import { Assistant } from './ai/assistant.js';
import { Automix } from './ai/automix.js';
import { Autoplay } from './ai/autoplay.js';
import { AUTOPLAY_DEFAULTS, autoplayOptions } from './ai/autoplay-core.js';
import { AutoplayUI } from './ui/autoplay-ui.js';
import { StemsManager } from './audio/stems.js';
import { parseLibrary, mergeInto, parseM3u, parseVirtualFolder, decodePlaylist } from './library/import.js';
import { planRelocation, fileName } from './library/relocate.js';
import { splitListPath } from './library/crate-tree.js';
import { treeFiles } from './library/folder-crates.js';
import { readFileMarkers, parseCrate, id3Size } from './library/filemarkers.js';
import { normalize, dominantBpm } from './audio/grid.js';
import { planFxRouting } from './audio/fx-routing.js';
import { parseRequest, planSet } from './ai/prompt.js';
import { WaveDetail } from './ui/waveform.js';
import { SettingsUI } from './ui/settings-ui.js';
import { btn } from './ui/controls.js';
import { Feedback } from './ui/feedback.js';
import { UpdatesUI } from './ui/updates-ui.js';
import { Welcome } from './ui/welcome.js';
import { LegalUI } from './ui/legal-ui.js';
import { ReleaseNotes } from './ui/release-notes.js';
import { CleanupUI } from './ui/cleanup-ui.js';
import { applyTheme, themeId, DEFAULT_THEME } from './ui/theme.js';

const DEFAULTS = {
  outputMode: 'auto', masterDevice: '', cueDevice: '', latency: 'normal',
  pitchRange: 0.08, keylockDefault: false, quantize: true, cueLoops: true, aiAutoCues: true, aiEnergyMode: 'keep', automixBars: 16, autoplay: { ...AUTOPLAY_DEFAULTS }, ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: '', syncPhase: true, autoGain: true,
  minBpm: 85, maxBpm: 175, motorStart: 4, motorStop: 4, jogSensitivity: 1,
  invertPitch: false, mc4000PhonesMidi: false, midiProfiles: {}, xfCurve: 'smooth', waveZoom: 6,
  historyAfter: 30, loadOnPlaying: 'play', slipRelease: 0, stemSlipMode: 'mute', stemSlipBeats: 1,
  protectLibrary: false, libCols: null, libColsSame: true, libColsByView: {}, libArtSize: 'small', crateSort: 'custom', crateSubTracks: true, libRail: 'auto', libHistOpen: false, folderToCrates: true, cleanupTrash: true, cleanupWriteFiles: true, crateCollapsed: [], deckLayout: 'auto', stemsDir: '', stemsModel: 'htdemucs', stemsAuto: true, stemsBackground: true, autoAnalyze: true,
  expansions: { flip: false, fxPresets: false, laptop: false, video: false, dvs: false, pitchTime: false },
  ytApiKey: '', ytClientId: '', ytClientSecret: '', spotifyClientId: '',
  // 1.0: actualizaciones, contador anónimo (null = no se ha preguntado → no se envía) y bienvenida
  autoUpdate: true, prereleaseUpdates: false, statsEnabled: null, welcomeDone: false,
  // 1.0.0-rc.4: tema de color (grafito | carbon | azul); quien actualiza sin él también empieza en Grafito
  theme: DEFAULT_THEME,
  panels: { sampler: false }, midiMap: {}, libView: 'all', libSort: { field: null, dir: 1 }
};

class App extends Emitter {
  constructor() {
    super();
    this.settings = { ...DEFAULTS };
    this.platform = platform;
    this.bufferCache = new Map();
    this.toast = toast;
    this.saveSettingsSoon = debounce(() => platform.storeSet('settings', this.settings), 400);
    this.saveFxSoon = debounce(() => this.setSetting('fx', this.fxUnits.map(u => u.toJSON())), 400);
    this.saveSamplerSoon = debounce(() => this.setSetting('sampler', this.sampler.toJSON()), 400);
    this.saveMixerSoon = debounce(() => this.setSetting('mixer', {
      ch: this.engine.channels.map(c => ({ ...c.values })), master: this.engine.masterVol, cueMix: this.engine.cueMix,
      phones: this.engine.phonesVol, sampler: this.engine.samplerVol ?? 0.8, xf: this.engine.xfValue
    }), 800);
  }

  async start() {
    const saved = await platform.storeGet('settings');
    if (saved) this.settings = { ...DEFAULTS, ...saved, panels: { ...DEFAULTS.panels, ...(saved.panels || {}) } };
    this.settings.expansions = { ...DEFAULTS.expansions, ...(this.settings.expansions || {}) };
    this.settings.autoplay = autoplayOptions(this.settings.autoplay);
    this.settings.theme = applyTheme(this.settings.theme);
    this.info = await platform.info();
    this.feedback = new Feedback(this);
    this.feedback.log('INFO', 'app', `Inicio de la interfaz · ${this.info.version} · ${navigator.language} · ${innerWidth}×${innerHeight} @${devicePixelRatio}`);
    this.legal = new LegalUI(this);
    this.notes = new ReleaseNotes(this);
    this.welcome = new Welcome(this);
    document.title = 'Nexura DJ Studio' + (this.info.isBeta ? ` ${this.info.version}` : '');

    this.engine = await new AudioEngine().init({ latency: this.settings.latency });
    this.feedback.log('INFO', 'audio', `AudioContext ${this.engine.ctx.state} · ${this.engine.ctx.sampleRate} Hz · ${this.engine.ctx.destination.maxChannelCount} canales`);
    this.engine.ctx.addEventListener('statechange', () => this.feedback.log(this.engine.ctx.state === 'running' ? 'INFO' : 'WARN', 'audio', 'AudioContext ' + this.engine.ctx.state));
    this.engine.setXfCurve(this.settings.xfCurve);
    this.analyzer = new Analyzer();
    this.library = new Library();
    this.library.protected = !!this.settings.protectLibrary;
    this.library.subTracks = this.settings.crateSubTracks !== false;
    this.library.on('protected', (msg) => toast(msg, 'warn', 4500));
    await this.library.load();
    this.ai = new Assistant(this);
    this.youtube = new YouTubeService(() => this.settings);
    this.spotify = new SpotifyService(() => this.settings);
    this.spotifyUI = new SpotifyImportUI(this);
    this.sampler = new Sampler(this.engine);
    this.sampler.fromJSON(this.settings.sampler);
    this.fxUnits = [new FxUnit(this.engine.ctx, 0), new FxUnit(this.engine.ctx, 1)];
    (this.settings.fx || []).forEach((j, i) => this.fxUnits[i] && this.fxUnits[i].fromJSON(j));
    // Siempre 4 decks de audio; los 3 y 4 solo se muestran con una controladora de 4 decks
    this.decks = [0, 1, 2, 3].map(i => new Deck(this, i));
    this.deckCount = 2;
    this.layers = [0, 1]; // deck visible en el lado izquierdo (1 o 3) y derecho (2 o 4)
    this.expansions = new ExpansionManager(this);
    this.automix = new Automix(this);
    this.autoplay = new Autoplay(this);
    this.stems = new StemsManager(this);
    this.restoreMixer();
    this.rewireFx();

    this.buildUI();
    this.actions = buildActions(this);
    this.midi = new MidiManager(this);
    this.midi.on('devices', () => {
      this.updateStatus(); this.updateDeckMode();
      this.feedback.log('INFO', 'midi', `Dispositivos: ${this.midi.connectedNames.join(', ') || 'ninguno'} · controladora: ${this.midi.controllerName || 'ninguna'}`);
    });
    this.midi.on('profile', () => this.updateDeckMode());
    await this.midi.init();
    this.stems.refreshStatus().then(() => this.stems.syncBackground()).catch(e => console.warn('stems', e));
    this.library.on('change', () => this.stems.syncBackground());
    this.decks.forEach(d => d.on('track', () => this.stems.syncBackground()));
    this.updateDeckMode();
    setInterval(() => { if (this.pendingDeckMode) this.updateDeckMode(); }, 1000);
    await this.applyOutputs(true);
    this.bindKeyboard();
    this.engine.on('mixer', () => this.saveMixerSoon());
    this.engine.on('xf', () => this.saveMixerSoon());
    this.engine.on('rec', () => this.updateStatus());
    this.decks.forEach(d => d.on('track', (t) => { if (this.libraryUI) this.libraryUI.renderRows(); }));
    // Las sugerencias de IA se recalculan al cambiar la pista o el estado de los decks
    const aiRefresh = debounce(() => { if (this.libraryUI && this.libraryUI.viewId === 'ai:next') this.libraryUI.refresh(); }, 400);
    this.decks.forEach(d => { d.on('track', aiRefresh); d.on('state', aiRefresh); });
    this.sampler.on('change', () => this.saveSamplerSoon());

    if (this.engine.ctx.state !== 'running') this.showStartOverlay();
    setTimeout(() => { if (this.welcome.shouldShow()) this.welcome.open(); this.notes.check(); this.feedback.flushQueue(); }, 600);
    this.updatesUI = new UpdatesUI(this);
    this.statsTimer = setTimeout(() => this.sendStatsSoon(), 20000);
    requestAnimationFrame(() => this.frame());
    setInterval(() => this.decks.forEach(d => d.syncTick()), 250);
    setInterval(() => this.automix.tick().catch(e => console.error('automix', e)), 100);
    setInterval(() => { try { this.autoplay.tick(); } catch (e) { console.error('autoplay', e); } }, 100);
    this.updateStatus();
    window.addEventListener('beforeunload', () => { this.library.save(); platform.storeSet('settings', this.settings); });
  }

  // Contador anónimo (main/stats.js): solo si el usuario lo ha permitido y hay statsUrl; una vez al día
  sendStatsSoon() {
    if (this.settings.statsEnabled !== true) return;
    clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => platform.stats.send({ enabled: true, decks: this.deckCount, controller: !!this.midi?.controllerName }).catch(() => {}), 5000);
  }

  restoreMixer() {
    const m = this.settings.mixer;
    if (!m) { this.engine.setSamplerVol(0.8); return; }
    (m.ch || []).forEach((v, i) => { const ch = this.engine.channels[i]; if (!ch) return; for (const k of ['trim', 'high', 'mid', 'low', 'filter', 'fader', 'xfAssign']) if (v[k] != null) ch.set(k, v[k]); });
    this.engine.setMaster(m.master ?? 0.8);
    this.engine.setCueMix(m.cueMix ?? 0);
    this.engine.setPhonesVol(m.phones ?? 0.8);
    this.engine.setSamplerVol(m.sampler ?? 0.8);
    this.engine.setCrossfader(m.xf ?? 0.5);
  }

  setSetting(k, v) {
    this.settings[k] = v;
    if (k === 'theme') this.settings[k] = v = applyTheme(themeId(v));
    if (k === 'xfCurve') this.engine.setXfCurve(v);
    if (k === 'deckLayout') setTimeout(() => this.updateDeckMode(), 0);
    if (k === 'stemsBackground' && v && this.stems) this.stems.syncBackground();
    if (k === 'motorStart' || k === 'motorStop') this.decks.forEach(d => d.applyMotor());
    if (k === 'slipRelease') this.decks.forEach(d => d.applySlipRelease());
    if (k === 'protectLibrary' && this.library) this.library.protected = !!v;
    if (k === 'crateSubTracks' && this.library) { this.library.subTracks = v !== false; if (this.libraryUI) { this.libraryUI.renderSide(); this.libraryUI.refresh(); } }
    this.saveSettingsSoon();
    this.emit('settings', k, v);
  }

  async applyOutputs(silent = false) {
    const s = this.settings;
    this.engine.extDecks = this.deckCount;
    const mode = await this.engine.setOutputs({ mode: s.outputMode, masterDevice: s.masterDevice, cueDevice: s.cueDevice });
    const f = this.deckCount === 4;
    const ext = {
      '8ch': 'Mesa externa: Deck 1 → 1/2 · Deck 2 → 3/4 · Deck 3 → 5/6 · Deck 4 → 7/8',
      '4ch': 'Mesa externa: Deck 1 → salidas 1/2 · Deck 2 → 3/4',
      '4ch-pares': 'Mesa externa: Decks 1+3 → salidas 1/2 · Decks 2+4 → 3/4 (la tarjeta tiene 4 canales; con 8 cada deck iría por separado)',
      devices: f ? 'Mesa externa: Decks 1+3 y Decks 2+4 por dispositivos separados' : 'Mesa externa: Deck 1 y Deck 2 por dispositivos separados',
      mono: f ? 'Mesa externa: Decks 1+3 = izquierda (mono) · Decks 2+4 = derecha (mono)' : 'Mesa externa: Deck 1 = izquierda (mono) · Deck 2 = derecha (mono)'
    }[this.engine.extVariant];
    this.outputDesc = { '4ch': 'Salida 4 canales (Master 1/2 · Cue 3/4)', separate: 'Master y cue en dispositivos separados', stereo: 'Salida estéreo (sin cue)', external: ext }[mode];
    document.body.classList.toggle('external-mixer', mode === 'external');
    if (!silent) toast(this.outputDesc, 'ok');
    this.updateStatus();
  }

  // ------------------------------------------------------------------ UI
  buildUI() {
    const app = $('#app');
    this.waveLayout = this.settings.waveLayout === 'deck' ? 'deck' : 'serato';
    this.waveLayoutToggle = $('#wave-layout-toggle');
    this.waveLayoutToggle?.querySelectorAll('[data-wave-layout]').forEach((button) => {
      button.addEventListener('click', () => this.setWaveLayout(button.dataset.waveLayout));
    });
    this.setWaveLayout(this.waveLayout, false);
    this.topbarToggle = btn('☰', { cls: 'small topbar-menu-toggle', title: 'Mostrar u ocultar los efectos', onClick: () => document.body.classList.toggle('topbar-expanded') });
    $('#topbar').insertBefore(this.topbarToggle, $('#top-right'));
    this.fxUI = this.fxUnits.map((u, i) => new FxUnitUI(this, u, $('#fx' + (i + 1))));
    // contenedores y formas de onda de los decks 3 y 4 (ocultos hasta tener 4 decks)
    for (const i of [2, 3]) {
      if (!$('#deck' + i)) { const c = el('div', { id: 'deck' + i, hidden: true }); $('#deck' + (i - 2)).after(c); }
      if (!$('#wave' + i)) $('#waves').appendChild(el('canvas', { id: 'wave' + i, class: 'wave', hidden: true }));
    }
    this.deckUIs = this.decks.map((d, i) => new DeckUI(this, d, $('#deck' + i)));
    this.decks.forEach(d => d.on('state', () => this.deckUIs.forEach(u => u.refreshLayer())));
    const stemsRefresh = () => this.deckUIs.forEach(u => u.refreshStems());
    this.stems.on('busy', stemsRefresh);
    this.stems.on('event', stemsRefresh);
    this.mixerUI = new MixerUI(this, $('#mixer'));
    this.samplerUI = new SamplerUI(this, $('#sampler'));
    this.libraryUI = new LibraryUI(this, $('#library'));
    this.cleanupUI = new CleanupUI(this);
    this.waves = this.decks.map((d, i) => new WaveDetail($('#wave' + i), d, this));
    this.decks.forEach((d, i) => d.on('track', async (t) => {
      const w = t && !d.isYT ? await this.analyzer.getWave(t.id) : null;
      if (d.track === t) this.waves[i].setWave(w);
    }));
    this.settingsUI = new SettingsUI(this);
    // barra superior
    if (this.info.isBeta) $('#topbar .logo').appendChild(el('span', { class: 'beta-badge', title: 'Versión ' + this.info.version }, /-rc/i.test(this.info.version) ? 'RC' : 'BETA'));
    this.feedbackBtn = btn('💬 SUGERENCIAS', { cls: 'small feedback-btn', title: 'Enviar un informe de error o una sugerencia a NexuraIA', onClick: () => this.feedback.open() });
    this.helpBtn = btn('?', { cls: 'small icon help-btn', title: 'Ayuda', onClick: (e) => this.helpMenu(e) });
    this.helpBtn.setAttribute('aria-label', 'Ayuda');
    this.recBtn = btn('● REC', { cls: 'rec', onClick: () => this.toggleRecord(), title: 'Grabar la sesión (WAV)' });
    this.recTime = el('span', { class: 'rec-time' }, '');
    this.midiStatus = el('span', { class: 'status-pill' }, 'MIDI');
    this.outStatus = el('span', { class: 'status-pill' }, 'AUDIO');
    this.clock = el('span', { class: 'clock' });
    this.samplerToggle = btn('SAMPLER', { cls: 'small', onClick: () => this.togglePanel('sampler') });
    this.laptopToggle = btn('LAPTOP', { cls: 'small', title: 'Alternar modo solo laptop (F8)', onClick: () => this.toggleLaptopMode() });
    this.automixBtn = btn('✨ AUTOMIX', { cls: 'small automix-btn', title: 'La IA pincha sola: elige la siguiente pista (Prepare o sugerencia), sincroniza y mezcla en el outro (F7)', onClick: () => this.automix.toggle() });
    this.automix.on('change', () => this.automixBtn.classList.toggle('on', this.automix.enabled));
    this.autoplayUI = new AutoplayUI(this);
    $('#top-right').append(this.feedbackBtn, this.autoplayUI.ind, this.autoplayUI.topBtn, this.automixBtn, this.laptopToggle, this.samplerToggle, this.recBtn, this.recTime, this.outStatus, this.midiStatus,
      this.helpBtn, btn('⚙', { cls: 'small icon', title: 'Ajustes', onClick: () => this.settingsUI.open() }), this.clock);
    $('#wave-zoom').append(
      btn('−', { cls: 'micro', title: 'Alejar', onClick: () => this.waves.forEach(w => { w.zoom = Math.min(40, w.zoom * 1.25); }) }),
      btn('+', { cls: 'micro', title: 'Acercar', onClick: () => this.waves.forEach(w => { w.zoom = Math.max(1.5, w.zoom / 1.25); }) }));
    this.applyPanels();
    this.midiStatus.addEventListener('click', () => this.settingsUI.open('midi'));
    this.outStatus.addEventListener('click', () => this.settingsUI.open('audio'));
    document.addEventListener('click', () => this.engine.resume(), { once: true });
    document.addEventListener('pointerdown', () => this.closeMenus());
    // arrastrar archivos sobre cualquier parte → importar
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  // Menú de ayuda (botón ? de la barra superior)
  helpMenu(e) {
    const r = this.helpBtn.getBoundingClientRect();
    this.contextMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: 'Enviar informe o sugerencia…', fn: () => this.feedback.open() },
      { label: 'Novedades de esta versión', fn: () => this.notes.show() },
      { label: 'Ver bienvenida', fn: () => this.welcome.open() },
      { label: 'Atajos de teclado', fn: () => this.settingsUI.open('keys') },
      { label: 'Herramientas · Limpiar biblioteca…', fn: () => this.cleanupUI.open('all') },
      { label: 'Copias de seguridad de la biblioteca', fn: () => this.settingsUI.open('library') },
      { label: 'Licencia de uso', fn: () => this.legal.show('licencia') },
      { label: 'Política de privacidad', fn: () => this.legal.show('privacidad') },
      { label: 'Acerca de Nexura DJ Studio', fn: () => this.settingsUI.open('about') }
    ]);
    e && e.stopPropagation();
  }

  setWaveLayout(mode, persist = true) {
    if (!['deck', 'serato'].includes(mode)) return;
    this.waveLayout = mode;
    document.body.dataset.waveLayout = mode;
    this.waveLayoutToggle?.querySelectorAll('[data-wave-layout]').forEach((button) => {
      const active = button.dataset.waveLayout === mode;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (persist) this.setSetting('waveLayout', mode);
    // Canvas debe tomar las nuevas dimensiones del modo activo.
    requestAnimationFrame(() => this.waves?.forEach((wave) => wave.draw()));
  }

  showStartOverlay() {
    const ov = el('div', { class: 'start-overlay' },
      el('div', { class: 'start-card' },
        el('div', { class: 'logo big' }, el('b', {}, 'NEXURA'), ' DJ STUDIO'),
        btn('Iniciar audio', { cls: 'big primary', onClick: async () => { await this.engine.resume(); ov.remove(); } })));
    document.body.appendChild(ov);
  }

  togglePanel(name) {
    this.settings.panels[name] = !this.settings.panels[name];
    this.setSetting('panels', this.settings.panels);
    this.applyPanels();
  }
  toggleLaptopMode() {
    const enabled = !this.expansions.enabled('laptop');
    this.expansions.setEnabled('laptop', enabled);
    this.applyPanels();
  }
  applyPanels() {
    const p = this.settings.panels;
    $('#sampler').hidden = !p.sampler;
    this.samplerToggle.classList.toggle('on', !!p.sampler);
    document.body.classList.toggle('with-sampler', !!p.sampler);
    const laptop = this.expansions?.enabled('laptop') || false;
    document.body.classList.toggle('laptop-mode', laptop);
    this.laptopToggle?.classList.toggle('on', laptop);
  }

  updateStatus() {
    if (!this.midiStatus) return;
    const name = this.midi ? this.midi.controllerName : '';
    this.midiStatus.textContent = name ? '🎛 ' + name : (this.midi && this.midi.status === 'unsupported' ? 'MIDI no disponible' : 'Sin controlador');
    this.midiStatus.classList.toggle('ok', !!name);
    const mode = this.engine.outputMode;
    this.outStatus.textContent = mode === '4ch' ? '🔊 4 CH' : mode === 'separate' ? '🔊 2 SALIDAS' : mode === 'external' ? '🔊 MESA EXTERNA' : '🔊 ESTÉREO';
    this.outStatus.title = this.outputDesc || '';
    this.outStatus.classList.toggle('ok', mode !== 'stereo');
    this.recBtn.classList.toggle('on', !!this.engine.recording);
  }

  // ------------------------------------------------------------------ bucle principal
  frame() {
    requestAnimationFrame(() => this.frame());
    try {
      const master = this.masterDeck();
      this.decks.forEach((d, i) => { d.frame(); if (this.isDeckVisible(i)) this.deckUIs[i].frame(d === master); if (i < this.deckCount) this.waves[i].draw(); });
      this.expansions.tick();
      this.lastMeters = this.mixerUI.frame();
      if (this.midi) this.midi.frame();
      // BPM para los efectos
      for (const u of this.fxUnits) { const d = this.fxTargetDeck(u); u.setBpm(d && d.currentBpm ? d.currentBpm : (master && master.currentBpm) || 120); }
      const now = new Date();
      this.clock.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const amLabel = this.automix.enabled && this.automix.status().startsWith('AUTOMIX ·') ? '✨ ' + this.automix.status().replace('AUTOMIX · ', '') : '✨ AUTOMIX';
      if (this.automixBtn.textContent !== amLabel) this.automixBtn.textContent = amLabel;
      this.autoplayUI.frame();
      if (this.engine.recording) this.recTime.textContent = fmtTime((performance.now() - this.engine.recStart) / 1000, false);
    } catch (e) { console.error(e); }
  }

  // ------------------------------------------------------------------ 2 / 4 decks
  get activeDecks() { return this.decks.slice(0, this.deckCount); }
  isDeckVisible(i) { return i < this.deckCount && this.layers[i % 2] === i; }
  wantedDeckCount() {
    const l = this.settings.deckLayout || 'auto';
    if (l === '2') return 2;
    if (l === '4') return 4;
    return this.midi ? this.midi.deckCapacity : 2;
  }
  updateDeckMode() {
    let want = this.wantedDeckCount();
    // nunca ocultar un deck 3/4 que está sonando (p. ej. si se desconecta la controladora a mitad de sesión)
    this.pendingDeckMode = false;
    if (want === 2 && this.deckCount === 4 && (this.decks[2].playing || this.decks[3].playing)) { want = 4; this.pendingDeckMode = true; }
    if (want === this.deckCount && this._layoutDone) return;
    const prev = this.deckCount;
    this.deckCount = want;
    this._layoutDone = true;
    if (want === 2) this.layers = [0, 1];
    document.body.classList.toggle('four-decks', want === 4);
    for (const i of [2, 3]) { const w = $('#wave' + i); if (w) w.hidden = want !== 4; }
    this.applyLayers();
    if (this.mixerUI) this.mixerUI.setDeckCount(want);
    this.emit('decks', want);
    if (prev !== want && this.engine.outputMode === 'external') this.applyOutputs(true);
    if (prev !== want) {
      if (want === 4) this.toast(`4 decks activados (${this.midi && this.midi.controllerName ? this.midi.controllerName : 'Ajustes'}). Decks 1/3 a la izquierda y 2/4 a la derecha.`, 'ok', 5000);
      else this.toast('Vista de 2 decks');
      requestAnimationFrame(() => this.waves.forEach(w => w.draw()));
    }
  }
  // Muestra el deck idx en su lado (1/3 izquierda, 2/4 derecha)
  focusDeck(idx) {
    if (this.deckCount !== 4 || idx >= 4) return;
    const side = idx % 2;
    if (this.layers[side] === idx) return;
    this.layers[side] = idx;
    this.applyLayers();
  }
  applyLayers() {
    this.decks.forEach((d, i) => {
      const box = $('#deck' + i); if (!box) return;
      box.hidden = !this.isDeckVisible(i);
    });
    if (this.deckUIs) this.deckUIs.forEach((u, i) => { if (this.isDeckVisible(i)) u.refresh('state'); u.refreshLayer && u.refreshLayer(); });
    this.emit('layers', this.layers);
  }

  masterDeck() {
    const syncFollowers = this.decks.filter(d => d.sync && d.playing);
    for (const f of syncFollowers) { const m = f.syncMaster; if (m) return m; }
    const playing = this.decks.filter(d => d.playing && d.track);
    return playing.sort((a, b) => a.playStartedAt - b.playStartedAt)[0] || null;
  }

  // ------------------------------------------------------------------ carga de pistas
  freeDeckIndex() {
    // prioridad a los decks visibles
    const vis = this.activeDecks.filter(d => this.isDeckVisible(d.idx)), all = this.activeDecks;
    for (const list of [vis, all]) { const empty = list.find(d => !d.track); if (empty) return empty.idx; }
    for (const list of [vis, all]) { const stopped = list.find(d => !d.playing); if (stopped) return stopped.idx; }
    return this.layers[0];
  }
  loadSelected(idx) {
    const t = this.libraryUI.current();
    if (t) this.loadToDeck(t.id, idx);
  }

  async decode(track) {
    if (this.bufferCache.has(track.id)) return this.bufferCache.get(track.id);
    const bytes = await platform.readFile(track.path);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const buf = await this.engine.ctx.decodeAudioData(ab);
    this.bufferCache.set(track.id, buf);
    while (this.bufferCache.size > 4) this.bufferCache.delete(this.bufferCache.keys().next().value);
    return buf;
  }

  async loadToDeck(id, idx) {
    const t = this.library.get(id);
    const d = this.decks[idx];
    if (!t || !d) return;
    this.focusDeck(idx);
    // Cargar sobre un deck que suena: sustituir y seguir sonando (por defecto), sustituir en pausa o bloquear
    const mode = this.settings.loadOnPlaying || 'play';
    const wasPlaying = d.playing;
    if (wasPlaying && mode === 'block') {
      toast(`El deck ${idx + 1} está sonando. Páusalo antes de cargar otra pista (Ajustes → Reproducción).`, 'warn');
      return;
    }
    const resume = wasPlaying && mode === 'play';
    this.engine.resume();
    if (t.source === 'youtube') {
      try { await d.loadYouTube(t); if (resume && d.track === t) d.play(); } catch (e) { toast('No se pudo cargar el vídeo: ' + e.message, 'error'); }
      return;
    }
    const busy = toast(`Cargando «${t.title}»…`, 'info', 1500);
    let buf;
    try { buf = await this.decode(t); }
    catch (e) {
      const lost = (await platform.existsMany([t.path]))?.[0] === false;
      if (lost) this.libraryUI.markMissing(t.id, true);
      this.feedback.log('WARN', 'audio', `No se pudo cargar en el deck ${idx + 1}: ${lost ? 'archivo perdido' : (e && e.message) || e} · ${t.path}`);
      toast(lost ? `Archivo perdido: ${t.path}. Clic derecho → «Relocalizar archivos perdidos…»` : `No se pudo abrir el archivo: ${t.path}`, 'error', 7000);
      return;
    }
    await d.load(t, buf);
    if (resume && d.track === t) d.play(); // la nueva pista entra sonando, sin silencio
    // stems ya separados: se cargan en segundo plano (la pista suena mientras tanto)
    if (t.stems && this.settings.stemsAuto !== false) this.stems.loadForDeck(d).catch(e => console.warn('stems', e));
    let wave = await this.analyzer.getWave(t.id);
    if (!t.analyzed || !wave) {
      try {
        const meta = await this.analyzer.analyzeTrack(t, buf, { minBpm: this.settings.minBpm, maxBpm: this.settings.maxBpm });
        this.library.update(t.id, meta);
        this.applyAutoCues(t);
        wave = await this.analyzer.getWave(t.id);
      } catch (e) { console.error(e); toast('Error al analizar: ' + e.message, 'error'); }
    }
    if (d.track === t) {
      this.waves[idx].setWave(wave);
      this.deckUIs[idx].overview.setWave(wave);
      d.emit('track', t);
      if (d.sync) d.syncNow(true);
    }
  }

  // Importa bibliotecas y listas de otros programas DJ: colecciones XML / NML, listas .m3u/.m3u8,
  // carpetas virtuales .vdjfolder y crates .crate (varios archivos a la vez). Además puede leer los
  // cues, loops y beatgrids que otros programas guardan dentro de los propios archivos de audio.
  async importLibrary() {
    if (!this.library.guard('tags')) return;
    let files;
    try { files = await platform.openLibraryFile(); } catch (e) { return toast('No se pudo leer el archivo: ' + e.message, 'error'); }
    if (!files || !files.length) return;
    const tracks = new Map(), playlists = [], formats = new Set(), errors = [];
    const td = new TextDecoder('utf-8');
    for (const f of files) {
      try {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (ext === 'crate') { playlists.push(parseCrate(f.data, f.path)); formats.add('crates'); continue; }
        const text = td.decode(f.data).replace(/^\uFEFF/, '');
        if (ext === 'm3u' || ext === 'm3u8') { playlists.push(parseM3u(text, f.path)); formats.add('listas M3U'); continue; }
        if (ext === 'vdjfolder' || /<VirtualFolder/i.test(text.slice(0, 2000))) { playlists.push(parseVirtualFolder(text, f.path)); formats.add('carpetas virtuales'); continue; }
        const lib = parseLibrary(text);
        formats.add(lib.format);
        for (const t of lib.tracks) tracks.set(t.path, t);
        playlists.push(...lib.playlists);
      } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    // las pistas de las listas que no vienen en ninguna colección se importan sin datos
    for (const pl of playlists) for (const p of pl.paths) if (!tracks.has(p)) tracks.set(p, { path: p, cues: [], loops: [] });
    if (!tracks.size) return toast(errors.length ? errors.join(' · ') : 'Los archivos no contienen pistas', errors.length ? 'error' : 'warn', 8000);
    const list = [...tracks.values()];
    const withCues = list.filter(t => t.cues.length).length, withGrid = list.filter(t => t.bpm).length;
    const opt = { tags: true, grid: true, key: true, cues: true, crates: true, overwrite: false, fileMarkers: true };
    const chk = (k, label, sub) => {
      const c = el('input', { type: 'checkbox' }); c.checked = opt[k]; c.addEventListener('change', () => { opt[k] = c.checked; });
      return el('label', { class: 'imp-opt' }, c, el('span', {}, label, sub ? el('small', {}, sub) : null));
    };
    const body = el('div', { class: 'imp' },
      el('p', {}, `${[...formats].join(', ')}: ${list.length} pistas, ${playlists.length} listas · ${withGrid} con BPM, ${withCues} con hot cues.`),
      errors.length ? el('p', { class: 'set-note' }, 'No se pudieron leer: ' + errors.join(' · ')) : null,
      chk('fileMarkers', 'Leer cues, loops y beatgrid guardados en los archivos de audio', 'Algunos programas los guardan dentro del MP3 o FLAC; se usan cuando la colección no los trae'),
      chk('grid', 'BPM y beatgrid', 'Incluye beatgrids con BPM variable'), chk('key', 'Tonalidad'), chk('cues', 'Hot cues, Cue Loops y loops guardados'),
      chk('tags', 'Título, artista, género, valoración y reproducciones'), chk('crates', 'Listas → crates «Importado · …»', playlists.length ? '' : 'No hay listas'),
      chk('overwrite', 'Sobrescribir lo que ya tengo', 'Si no, solo se rellenan datos vacíos y se respetan tus hot cues y BPM fijados'));
    if (await this.modal('Importar biblioteca', body, ['Cancelar', 'Importar']) !== 1) return;
    const status = $('#lib-status');
    const paths = [...tracks.keys()], infos = [];
    for (let i = 0; i < paths.length; i += 200) {
      if (status) status.textContent = `Importando: buscando archivos ${Math.min(i + 200, paths.length)}/${paths.length}…`;
      infos.push(...await platform.infoForPaths(paths.slice(i, i + 200)));
    }
    const before = new Set(this.library.tracks.keys());
    const added = this.library.addFiles(infos);
    const byPath = new Map(added.map(t => [t.path.toLowerCase(), t]));
    const srcFor = (t) => tracks.get(t.path) || list.find(x => x.path.toLowerCase() === t.path.toLowerCase());
    // marcadores dentro de los archivos (solo donde la colección no trae cues o rejilla)
    let fromFiles = 0;
    if (opt.fileMarkers) {
      let k = 0;
      for (const t of added) {
        const s = srcFor(t); if (!s) continue;
        if (++k % 20 === 0 && status) status.textContent = `Importando: leyendo marcadores ${k}/${added.length}…`;
        try {
          let head = await platform.readHead(t.path, 1024 * 1024);
          const need = id3Size(head);
          if (need > head.length) head = await platform.readHead(t.path, need);
          const m = readFileMarkers(head);
          if (!m) continue;
          fromFiles++;
          if (!s.cues.length && m.cues.length) s.cues = m.cues;
          if (!s.loops.length && m.loops.length) s.loops = m.loops.map(l => ({ s: l.s, e: l.e }));
          if (!s.bpm && m.bpm) { s.bpm = m.grid ? dominantBpm(normalize(m.grid), s.duration || 0) : m.bpm; s.firstBeat = m.firstBeat; s.grid = m.grid ? normalize(m.grid) : null; if (s.grid && s.grid.length < 2) s.grid = null; }
        } catch (_) { /* archivo ilegible: se omite */ }
      }
    }
    let n = 0;
    for (const t of added) {
      const s = srcFor(t);
      if (!s) continue;
      const patch = mergeInto(t, s, opt);
      if (!t.duration && s.duration) patch.duration = s.duration;
      this.library.update(t.id, patch); n++;
    }
    let crates = 0;
    if (opt.crates) for (const pl of playlists) {
      const ids = pl.paths.map(p => byPath.get(p.toLowerCase())).filter(Boolean).map(t => t.id);
      if (!ids.length) continue;
      // listas dentro de carpetas («Dance / 2024», «Dance%%2024.crate») → subcrates anidados
      const segs = splitListPath(pl.name);
      if (!segs.length) continue;
      segs[0] = 'Importado · ' + segs[0];
      const c = this.library.ensureCratePath(segs);
      if (!c) continue;
      this.library.addToCrate(c.id, ids); crates++;
    }
    if (status) status.textContent = '';
    const missing = paths.length - infos.length, fresh = added.filter(t => !before.has(t.id));
    this.modal('Importación terminada', el('div', {},
      el('p', {}, `${n} pistas importadas (${fresh.length} nuevas en tu biblioteca) y ${crates} listas como crates.${opt.fileMarkers ? ` ${fromFiles} archivos tenían cues o beatgrid guardados.` : ''}`),
      missing ? el('p', { class: 'set-note' }, `${missing} archivos no se encontraron en este equipo (movidos, borrados o en otro disco); se han omitido.`) : null,
      fresh.length ? el('p', { class: 'set-note' }, 'Las pistas nuevas se analizarán para la forma de onda conservando el BPM, el beatgrid y la tonalidad importados.') : null));
    if (fresh.length && this.settings.autoAnalyze) this.analyzeMany(fresh);
    return { n, crates, missing, fromFiles };
  }

  // Lee los cues, loops y beatgrid guardados dentro de los archivos de las pistas indicadas
  async readMarkersFromFiles(sel) {
    if (!this.library.guard('grid')) return;
    const list = sel.filter(t => t.source === 'local');
    let n = 0;
    for (const t of list) {
      try {
        let head = await platform.readHead(t.path, 1024 * 1024);
        const need = id3Size(head);
        if (need > head.length) head = await platform.readHead(t.path, need);
        const m = readFileMarkers(head);
        if (!m) continue;
        const src = { cues: m.cues, loops: m.loops.map(l => ({ s: l.s, e: l.e })), bpm: m.bpm, firstBeat: m.firstBeat, grid: m.grid ? normalize(m.grid) : null };
        if (src.grid && src.grid.length < 2) src.grid = null;
        if (src.grid) src.bpm = dominantBpm(src.grid, t.duration);
        this.library.update(t.id, mergeInto(t, src, { tags: false, grid: true, key: false, cues: true, overwrite: false }));
        n++;
      } catch (_) { /* se omite */ }
    }
    this.decks.forEach(d => { if (d.track && list.includes(d.track)) d.emit('track', d.track); });
    toast(n ? `Cues/beatgrid leídos de ${n} archivo(s)` : 'Esos archivos no tienen cues ni beatgrid guardados', n ? 'ok' : 'info');
  }

  async analyzeMany(tracks, force = false) {
    // sin «force»: pistas sin analizar y las analizadas con una versión antigua (sin estructura/energía de la IA);
    // se respetan el BPM y la tonalidad bloqueados por el usuario
    // «Volver a analizar» desbloquea BPM y tonalidad: no se permite con la biblioteca protegida
    if (force && !this.library.guard('grid')) return;
    const list = tracks.filter(t => t.source === 'local' && (force || !t.analyzed || t.sections === undefined));
    if (!list.length) return toast('No hay pistas pendientes de análisis', 'info');
    if (this.analyzing) return toast('Ya hay un análisis en curso', 'warn');
    this.analyzing = true;
    const status = $('#lib-status');
    let n = 0;
    for (const t of list) {
      status.textContent = `Analizando ${++n}/${list.length}: ${t.title}`;
      try {
        if (force) this.library.update(t.id, { bpmLocked: false, keyLocked: false, grid: null });
        const bytes = await platform.readFile(t.path);
        const buf = await this.engine.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const meta = await this.analyzer.analyzeTrack(t, buf, { minBpm: this.settings.minBpm, maxBpm: this.settings.maxBpm });
        this.library.update(t.id, meta);
        this.applyAutoCues(t);
      } catch (e) { console.warn('análisis', t.path, e); }
    }
    status.textContent = '';
    this.analyzing = false;
    toast(`Análisis completado (${list.length} pistas)`, 'ok');
  }

  async addFiles(folder) {
    const crate = this.libraryUI.viewId.startsWith('crate:') ? this.libraryUI.viewId.slice(6) : null;
    // «+ Carpeta» con «Crear crates con la estructura de carpetas»: crate con el nombre de la carpeta (dentro
    // de la crate abierta, si la hay) y un subcrate por subcarpeta
    if (folder && this.settings.folderToCrates !== false) {
      const tree = await platform.openFolderTree();
      return tree ? this.importTree(tree, crate) : [];
    }
    const infos = folder ? await platform.openFolder() : await platform.openFiles();
    if (!infos || !infos.length) return [];
    const added = this.library.addFiles(infos, crate);
    toast(`${added.length} pistas añadidas`, 'ok');
    if (this.settings.autoAnalyze) this.analyzeMany(added);
    return added;
  }
  async importDropped(fileList, crateId = null) {
    const infos = await platform.filesFromDrop(fileList);
    if (!infos.length) { toast('No se encontraron archivos de audio compatibles', 'warn'); return []; }
    const added = this.library.addFiles(infos, crateId);
    toast(`${added.length} pistas añadidas`, 'ok');
    if (this.settings.autoAnalyze) this.analyzeMany(added);
    return added;
  }
  // Árbol de carpetas ({ files, dirs }, ver library/folder-crates.js) sobre «target»: undefined = solo a la
  // biblioteca; null = carpetas como crates en la raíz (los sueltos, solo a la biblioteca); id = archivos
  // sueltos a esa crate y carpetas como subcrates suyos. Devuelve las pistas añadidas.
  async importTree(tree, target) {
    const L = this.library;
    const n = treeFiles(tree).length;
    if (!n) { toast('No se encontraron archivos de audio compatibles', 'warn'); return []; }
    let res;
    if (target === undefined) res = { tracks: L.addFiles(treeFiles(tree)), created: [], top: [] };
    else res = L.addFolderTree(tree, target);
    const { tracks, created, top } = res;
    if (target && L.crate(target)) this.libraryUI.expandCrate(target);
    const where = top.length === 1 ? ` en «${this.libraryUI.crateLabel(top[0])}»` : '';
    toast(`${tracks.length} pistas añadidas${where}` + (created.length ? ` · ${created.length} crate(s) nuevas` : '') + (res.blocked ? ' (solo a la biblioteca: está protegida)' : ''), 'ok');
    if (this.settings.autoAnalyze) this.analyzeMany(tracks);
    return tracks;
  }

  // Listas .m3u / .m3u8 (botón de la barra lateral o arrastrar el archivo): una crate con el nombre del
  // archivo y las pistas que existen; se avisa de las que faltan. #EXTINF rellena artista/título/duración
  // de las pistas nuevas sin etiquetas.
  // parent: crate en la que se crean como subcrates («Importar M3U aquí» o soltar la lista sobre una crate)
  async importM3u(parent = null) {
    let files;
    try { files = await platform.openPlaylist(); } catch (e) { return toast('No se pudo leer la lista: ' + e.message, 'error'); }
    if (files && files.length) return this.importPlaylists(files, parent);
  }
  async importPlaylists(files, parent = null) {
    if (!files || !files.length || !this.library.guard('crate')) return null;
    const L = this.library, status = $('#lib-status'), fresh = [];
    let crate = null, found = 0, missing = 0;
    for (const f of files) {
      let pl;
      try { pl = parseM3u(decodePlaylist(f.data), f.path); } catch (e) { toast(`«${f.name}»: ${e.message}`, 'error'); continue; }
      if (!pl.entries.length) { toast(`«${f.name}» no contiene pistas`, 'warn'); continue; }
      const ids = [];
      if (isDesktop) {
        const infos = [];
        for (let i = 0; i < pl.entries.length; i += 200) {
          if (status) status.textContent = `Lista «${pl.name}»: buscando archivos ${Math.min(i + 200, pl.entries.length)}/${pl.entries.length}…`;
          infos.push(...await platform.infoForPaths(pl.entries.slice(i, i + 200).map(e => e.path)));
        }
        const byP = new Map(infos.map(x => [x.path.toLowerCase(), x]));
        const before = new Set(L.tracks.keys());
        L.addFiles(infos);
        for (const e of pl.entries) {
          const info = byP.get(e.path.toLowerCase());
          const t = info && L.byPath(info.path);
          if (!t) { missing++; continue; }
          if (!before.has(t.id)) {
            const patch = {};
            if (e.title && !info.artist && e.artist) { patch.title = e.title; patch.artist = e.artist; }
            if (e.duration && !t.duration) patch.duration = e.duration;
            if (Object.keys(patch).length) L.update(t.id, patch);
            if (!fresh.includes(t)) fresh.push(t);
          }
          ids.push(t.id);
        }
      } else {
        // navegador: sin acceso a rutas; se buscan por nombre de archivo entre las pistas ya añadidas
        const web = [...L.tracks.values()].filter(t => t.path.startsWith('web:'));
        for (const e of pl.entries) {
          const name = fileName(e.path).toLowerCase();
          const t = web.find(x => x.path.slice(4).toLowerCase().startsWith(name + ':'));
          if (t) ids.push(t.id); else missing++;
        }
      }
      found += ids.length;
      if (!ids.length) continue;
      crate = L.ensureCratePath([pl.name], parent && L.crate(parent) ? parent : null);
      if (crate) L.addToCrate(crate.id, [...new Set(ids)]);
    }
    if (status) status.textContent = '';
    if (crate) { this.libraryUI.expandCrate(crate.id); this.libraryUI.setView('crate:' + crate.id); }
    const msg = `${found} pista(s) importadas${crate ? ` en la crate «${this.libraryUI.crateLabel(crate)}»` : ''}` + (missing ? ` · ${missing} no se encontraron en este equipo` : '');
    toast(msg, missing ? 'warn' : 'ok', missing ? 7000 : 4000);
    if (fresh.length && this.settings.autoAnalyze) this.analyzeMany(fresh);
    return { found, missing, crate };
  }

  // Relocalizar archivos perdidos: se busca por nombre (y tamaño si hay empate) en la carpeta elegida y
  // se cambia la ruta conservando el id, así no se pierden cues, beatgrid, valoración ni crates
  async relocateMissing(tracks) {
    const pool = (tracks && tracks.length ? tracks : [...this.library.tracks.values()]).filter(t => t.source === 'local');
    const ex = await platform.existsMany(pool.map(t => t.path));
    if (!ex) return toast('Relocalizar archivos solo está disponible en la app de escritorio', 'warn');
    const lost = pool.filter((t, i) => !ex[i]);
    pool.forEach((t, i) => this.libraryUI.markMissing(t.id, !ex[i]));
    if (!lost.length) return toast('No hay archivos perdidos: todas las pistas están en su sitio', 'ok');
    if (await this.modal('Relocalizar archivos perdidos', el('div', {},
      el('p', {}, `${lost.length} pista(s) no están donde se añadieron.`),
      el('p', { class: 'hint' }, 'Elige la carpeta (o el disco) donde están ahora: se buscarán por nombre de archivo en todas sus subcarpetas y, si hay varios con el mismo nombre, por tamaño. Se conservan cues, beatgrid, valoración, crates e historial.')), ['Cancelar', 'Elegir carpeta…']) !== 1) return;
    const st = $('#lib-status');
    if (st) st.textContent = 'Buscando archivos perdidos…';
    let res;
    try { res = await platform.findFiles([...new Set(lost.map(t => fileName(t.path)))]); }
    catch (e) { if (st) st.textContent = ''; return toast(e.message, 'error'); }
    if (st) st.textContent = '';
    if (!res) return;
    const lostIds = new Set(lost.map(t => t.id));
    const taken = new Set([...this.library.tracks.values()].filter(t => !lostIds.has(t.id) && t.path).map(t => t.path.toLowerCase()));
    const plan = planRelocation(lost, res.files, taken);
    const size = new Map(res.files.map(f => [f.path, f.size]));
    const n = this.library.relocate(plan.moves.map(m => ({ ...m, size: size.get(m.path) })));
    for (const m of plan.moves) { this.libraryUI.markMissing(m.id, false); this.bufferCache.delete(m.id); }
    this.modal('Relocalización terminada', el('div', {},
      el('p', {}, `${n} de ${lost.length} archivo(s) relocalizados en ${res.dir}.`),
      plan.notFound.length ? el('p', { class: 'set-note' }, `${plan.notFound.length} no se encontraron en esa carpeta.`) : null,
      plan.ambiguous.length ? el('p', { class: 'set-note' }, `${plan.ambiguous.length} tienen varios archivos con el mismo nombre y tamaño: relocalízalos eligiendo una carpeta más concreta.`) : null,
      plan.duplicate.length ? el('p', { class: 'set-note' }, `${plan.duplicate.length} ya estaban en la biblioteca con la ruta nueva (se han dejado como estaban).`) : null));
    return { ...plan, n };
  }

  // ------------------------------------------------------------------ efectos
  fxTargetDeck(u) {
    const m = /^deck([0-3])$/.exec(u.target);
    if (m) return this.decks[+m[1]];
    return this.masterDeck();
  }
  rewireFx() {
    // las unidades usadas para Stems FX solo procesan los stems enviados de su deck (fx-routing.js)
    const plan = planFxRouting(this.fxUnits, this.decks || []);
    // dos pasadas: primero desconectar todo, después conectar
    this.engine.channels.forEach(ch => { ch.setInserts([]); ch.setStemInserts([]); });
    this.engine.setMasterInserts([]);
    this.sampler.setInserts([]);
    this.engine.channels.forEach((ch, i) => { ch.setInserts(plan.deck[i]); ch.setStemInserts(plan.stem[i]); });
    this.engine.setMasterInserts(plan.master);
    this.sampler.setInserts(plan.sampler);
    (this.decks || []).forEach((d, i) => d.applyStemSend(plan.sends[i]));
  }
  // Stems FX activado/desactivado en un stem: la unidad pasa a seguir a ese deck y, si no tenía ningún
  // efecto encendido, se enciende la primera ranura para que se oiga algo
  stemFxChanged(deck, k, on) {
    const u = this.fxUnits[deck.stemFxUnit];
    if (on && u) {
      u.target = 'deck' + deck.idx;
      if (!u.anyOn()) u.slots[0].setEnabled(true);
    }
    this.rewireFx();
    this.saveFxSoon(); this.emit('fx');
    const st = ['Voz', 'Batería', 'Bajo', 'Melodía'][k];
    if (on && u) toast(`Stems FX: ${st} (deck ${deck.idx + 1}) → FX ${u.idx + 1} · ${u.slots.filter(x => x.enabled).map(x => x.name).join(' + ')}`);
    else toast(`Stems FX: ${st} (deck ${deck.idx + 1}) sin efecto`);
  }
  fxBeats(u, dir) {
    const i = clamp(BEAT_VALUES.indexOf(u.beats) + dir, 0, BEAT_VALUES.length - 1);
    u.setBeats(BEAT_VALUES[i]);
    this.saveFxSoon();
    this.emit('fx');
  }
  nextEffect(slot) {
    const i = EFFECTS.findIndex(e => e.id === slot.fxId);
    slot.setEffect(EFFECTS[(i + 1) % EFFECTS.length].id);
    this.saveFxSoon();
    this.emit('fx');
    toast(`FX ${slot.unit.idx + 1}.${slot.idx + 1}: ${slot.name}`);
  }

  // ------------------------------------------------------------------ grabación
  async toggleRecord() {
    if (!this.engine.recording) {
      this.engine.startRecording();
      toast('Grabando la sesión…', 'ok');
    } else {
      const wav = await this.engine.stopRecording();
      this.recTime.textContent = '';
      const name = 'Nexura-set-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const file = await platform.saveRecording(wav, name);
      toast('Grabación guardada: ' + file, 'ok', 7000);
      if (isDesktop) platform.showItem(file);
    }
    this.updateStatus();
  }

  // ------------------------------------------------------------------ IA
  // Cues automáticos tras analizar, solo si la pista no tiene ningún hot cue
  applyAutoCues(t) {
    if (!this.settings.aiAutoCues || !t || (t.cues || []).some(Boolean)) return;
    if (this.ai.autoCues(t)) this.decks.forEach(d => { if (d.track === t) d.emit('cues'); });
  }
  async aiAutoCues(tracks) {
    const list = tracks.filter(t => t.source === 'local');
    if (!list.length) return toast('Los cues automáticos necesitan archivos locales (no YouTube)', 'warn');
    let total = 0, n = 0;
    const status = $('#lib-status');
    for (const t of list) {
      if (!t.sections) {
        status.textContent = `IA: analizando estructura ${++n}/${list.length}: ${t.title}`;
        try {
          const buf = await this.decode(t);
          const meta = await this.analyzer.analyzeTrack(t, buf, { minBpm: this.settings.minBpm, maxBpm: this.settings.maxBpm });
          this.library.update(t.id, meta);
        } catch (e) { console.warn('IA cues', t.path, e); continue; }
      }
      total += this.ai.autoCues(t);
      this.decks.forEach(d => { if (d.track === t) d.emit('cues'); });
    }
    status.textContent = '';
    toast(total ? `IA: ${total} cues creados (intro, drops, breaks y outro)` : 'IA: no había huecos libres o no se detectaron secciones', total ? 'ok' : 'info');
  }
  async aiBuildSet(start) {
    if (!start) return;
    const count = el('input', { type: 'number', min: 3, max: 60, value: 15, class: 'num-in' });
    const curve = el('select', {}, ...Object.entries({ up: 'Subir energía (warm-up → pico)', wave: 'Ola (subir y bajar al final)', keep: 'Mantener energía', down: 'Bajar energía (cierre)' }).map(([k, v]) => el('option', { value: k }, v)));
    const scope = el('select', {}, el('option', { value: 'local' }, 'Solo archivos locales'), el('option', { value: 'all' }, 'Locales y YouTube'));
    const body = el('div', { class: 'form' },
      el('p', {}, `Empieza con «${start.title}». La IA encadena pistas compatibles por tonalidad, BPM y energía.`),
      el('label', { class: 'frm' }, el('span', {}, 'Número de pistas'), count),
      el('label', { class: 'frm' }, el('span', {}, 'Curva de energía'), curve),
      el('label', { class: 'frm' }, el('span', {}, 'Pistas a usar'), scope));
    if (await this.modal('Crear set con IA', body, ['Cancelar', 'Crear set']) !== 1) return;
    const pool = this.ai.candidates().filter(t => scope.value === 'all' || t.source === 'local');
    const set = this.ai.buildSet(start, clamp(parseInt(count.value, 10) || 15, 3, 60), curve.value, pool);
    if (set.length < 2) return toast('No hay suficientes pistas analizadas y compatibles para crear el set', 'warn');
    const crate = this.library.createCrate(`Set IA · ${start.title}`.slice(0, 60));
    if (!crate) return;
    this.library.addToCrate(crate.id, set.map(t => t.id));
    this.showInSetOrder();
    this.libraryUI.setView('crate:' + crate.id);
    toast(`Set creado: ${set.length} pistas en la crate «${crate.name}»`, 'ok');
  }

  // Los sets de la IA tienen orden: quitar el orden por columna para verlos tal cual
  showInSetOrder() {
    this.libraryUI.sort = { field: null, dir: 1 };
    this.setSetting('libSort', this.libraryUI.sort);
  }

  // Pedir un set por texto (Ollama local o intérprete de reglas)
  async aiPromptDialog() {
    const ta = el('textarea', { class: 'ai-prompt', rows: 3, placeholder: 'Ej.: hazme 1 hora de house a 122-126 BPM subiendo la energía' });
    const ex = ['1 hora de house 122-126 subiendo', '20 temas tranquilos para una cena', '45 minutos cañeros a 128 BPM', 'set de 2 horas que suba y baje al final'];
    const chips = el('div', { class: 'ai-chips' }, ...ex.map(t => btn(t, { cls: 'micro', onClick: () => { ta.value = t; ta.focus(); } })));
    const toPrepare = el('input', { type: 'checkbox', class: 'switch' }); toPrepare.checked = true;
    const yt = el('input', { type: 'checkbox', class: 'switch' });
    const engine = this.settings.ollamaModel ? `Ollama · ${this.settings.ollamaModel}` : 'intérprete de reglas (configura Ollama en Ajustes → IA)';
    const body = el('div', { class: 'form' },
      el('p', {}, 'Describe el set que quieres. La IA filtra tu biblioteca por estilo, BPM y energía y encadena pistas que mezclan bien.'),
      ta, chips,
      el('label', { class: 'frm' }, el('span', {}, 'Enviar a Prepare (para el Automix)'), toPrepare),
      el('label', { class: 'frm' }, el('span', {}, 'Incluir vídeos de YouTube'), yt),
      el('small', {}, 'Motor: ' + engine));
    setTimeout(() => ta.focus(), 50);
    if (await this.modal('✨ Pedir un set a la IA', body, ['Cancelar', 'Crear set']) !== 1) return;
    const text = ta.value.trim();
    if (!text) return;
    const tracks = [...this.library.tracks.values()];
    const genres = [...new Set(tracks.map(t => (t.genre || '').trim()).filter(Boolean))];
    const st = $('#lib-status'); st.textContent = '✨ La IA está preparando el set…';
    let req;
    try { req = await parseRequest(text, { genres, url: this.settings.ollamaUrl, model: this.settings.ollamaModel }); }
    finally { st.textContent = ''; }
    const plan = planSet(this.ai, tracks, req, { includeYT: yt.checked });
    if (plan.set.length < 2) {
      return toast(`No encuentro suficientes pistas analizadas para «${text}» (${plan.pool.length} encajan con los filtros). Prueba a ampliar BPM o estilo, o analiza más música.`, 'warn', 7000);
    }
    const crate = this.library.createCrate(('Set IA · ' + text).slice(0, 60));
    if (!crate) { if (toPrepare.checked) { this.library.addToPrepare(plan.set.map(t => t.id)); this.libraryUI.setView('prepare'); toast(`Set de ${plan.set.length} pistas enviado a Prepare (la biblioteca está protegida: no se crea la crate)`, 'ok', 6000); } return; }
    this.library.addToCrate(crate.id, plan.set.map(t => t.id));
    if (toPrepare.checked) this.library.addToPrepare(plan.set.map(t => t.id));
    this.showInSetOrder();
    this.libraryUI.setView('crate:' + crate.id);
    const mins = Math.round(plan.set.reduce((s, t) => s + (t.duration || 300) * 0.7, 0) / 60);
    const f = [req.minBpm != null ? `${req.minBpm}-${req.maxBpm} BPM` : '', req.genres?.length ? req.genres.join(', ') : '', { up: 'subiendo', wave: 'en ola', keep: 'estable', down: 'bajando' }[plan.curve]].filter(Boolean).join(' · ');
    toast(`Set creado: ${plan.set.length} pistas (~${mins} min) · ${f} · ${req.engine}`, 'ok', 7000);
  }

  exportHistory(id) {
    const csv = this.library.historyCsv(id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'historial-nexura.csv';
    a.click();
  }

  async samplerLoadDialog(i) {
    const p = await platform.openSample();
    if (p) { await this.sampler.loadSlot(i, p); this.saveSamplerSoon(); }
  }

  // ------------------------------------------------------------------ YouTube
  async ytImportDialog() {
    const input = await this.prompt('Importar lista de YouTube', '', 'Pega la URL de una lista de reproducción (con «list=») o de un vídeo');
    if (input) this.ytImport(input);
  }
  async ytImport(input) {
    const status = $('#lib-status');
    status.textContent = 'Leyendo la lista de YouTube…';
    try {
      const { playlist, items, warning } = await this.youtube.importPlaylist(input, (n) => { status.textContent = `Importando de YouTube… ${n}`; });
      if (warning) toast('No se pudo leer la lista completa (' + warning + '). Se ha importado solo el vídeo.', 'warn', 7000);
      const ids = this.library.addYouTubeItems(items, playlist);
      const pl = playlist && this.library.ytPlaylists.find(p => p.playlistId === playlist.playlistId);
      this.libraryUI.setView(pl ? 'yt:' + pl.id : 'yt-all');
      toast(`${ids.length} vídeos importados de YouTube`, 'ok');
    } catch (e) { toast(e.message, 'error', 7000); }
    status.textContent = '';
  }
  async ytMyPlaylists() {
    try {
      const lists = await this.youtube.myPlaylists();
      if (!lists.length) return toast('Tu cuenta no tiene listas de reproducción', 'info');
      const box = el('div', { class: 'yt-lists' });
      let pick = null;
      const done = this.modal('Mis listas de YouTube', box, ['Cerrar']);
      for (const l of lists) {
        const row = el('div', { class: 'yt-list-row' }, l.thumb ? el('img', { src: l.thumb }) : el('span'), el('div', {}, el('b', {}, l.title), el('small', {}, `${l.count} vídeos`)),
          btn('Importar', { cls: 'small', onClick: () => { pick = l; this.closeModal(); } }));
        box.appendChild(row);
      }
      await done;
      if (pick) this.ytImport(pick.playlistId);
    } catch (e) { toast(e.message, 'error', 7000); }
  }
  async ytSearchDialog() {
    const { MSG, GUIDE } = await platform.yt.texts();
    const guide = { label: 'Ver la guía', fn: () => platform.openExternal(GUIDE) };
    if (!(await this.youtube.canSearch())) {
      toast(MSG.none, 'warn', 10000, guide);
      return this.settingsUI.open('youtube');
    }
    const q = await this.prompt('Buscar en YouTube', '', 'Artista, canción…');
    if (!q) return;
    try {
      const items = await this.youtube.search(q);
      if (!items.length) return toast('YouTube no ha encontrado ningún vídeo para «' + q + '»', 'warn', 5000);
      const ids = this.library.addYouTubeItems(items, null);
      this.libraryUI.setView('yt-all');
      this.libraryUI.searchIn.value = '';
      this.libraryUI.search = '';
      this.libraryUI.refresh();
      toast(`${ids.length} resultados añadidos a YouTube`, 'ok');
    } catch (e) {
      // límite diario del servicio gratuito: aviso (no es un fallo) con acceso directo a Ajustes → YouTube
      if (e.code === 'limit') toast(e.message, 'warn', 12000, { label: 'Poner mi clave', fn: () => this.settingsUI.open('youtube') });
      else if (e.code === 'none') toast(e.message, 'warn', 10000, guide);
      else toast(e.message, 'error', 8000);
    }
  }

  // ------------------------------------------------------------------ Spotify (solo metadatos)
  // «+ Spotify»: pegar un enlace, leer la lista y convertirla en crate (spotify-ui.js)
  spotifyImportDialog(input = '') {
    if (!platform.spotify.available) return toast('La importación de listas de Spotify solo está disponible en la app de escritorio', 'warn', 6000);
    this.spotifyUI.open({ input });
  }
  // Crates importadas de Spotify: revisar la importación guardada o volver a leer la lista
  spotifyCrate(crateId, refetch) {
    if (refetch && !platform.spotify.available) return toast('Actualizar desde Spotify solo está disponible en la app de escritorio', 'warn');
    this.spotifyUI.open({ crateId, refetch });
  }

  // ------------------------------------------------------------------ diálogos
  modal(title, body, buttons = ['Aceptar']) {
    this.closeModal();
    return new Promise((resolve) => {
      const close = (v) => { ov.remove(); this._modal = null; document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(-1); }
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && buttons.length > 1) { e.stopPropagation(); close(buttons.length - 1); }
      };
      const ov = el('div', { class: 'modal-ov' },
        el('div', { class: 'modal' },
          el('div', { class: 'modal-head' }, el('h2', {}, title), btn('✕', { cls: 'micro', onClick: () => close(-1) })),
          el('div', { class: 'modal-body' }, body),
          el('div', { class: 'modal-foot' }, ...buttons.map((b, i) => btn(b, { cls: i === buttons.length - 1 && buttons.length > 1 ? 'primary' : '', onClick: () => close(i) })))));
      ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(-1); });
      document.body.appendChild(ov);
      document.addEventListener('keydown', key, true);
      this._modal = { close };
      const f = ov.querySelector('input,select,textarea');
      if (f) setTimeout(() => f.focus(), 30);
    });
  }
  closeModal() { if (this._modal) this._modal.close(-1); }
  async prompt(title, value = '', hint = '') {
    const inp = el('input', { value, class: 'wide' });
    const ok = await this.modal(title, el('div', { class: 'form' }, hint ? el('p', { class: 'hint' }, hint) : null, inp), ['Cancelar', 'Aceptar']);
    return ok === 1 ? inp.value.trim() : null;
  }
  async confirm(msg) { return (await this.modal('Confirmar', el('p', {}, msg), ['Cancelar', 'Aceptar'])) === 1; }

  contextMenu(e, items) {
    this.closeMenus();
    const build = (list) => el('div', { class: 'ctx' }, ...list.map(it => {
      const row = el('div', { class: 'ctx-item' + (it.danger ? ' danger' : '') + (it.sub ? ' has-sub' : '') },
        it.color ? el('span', { class: 'swatch', style: { background: it.color } }) : null, it.label || '',
        it.key ? el('span', { class: 'ctx-key' }, it.key) : null);
      if (it.sub) row.appendChild(build(it.sub));
      else row.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.closeMenus(); it.fn && it.fn(); });
      row.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      return row;
    }));
    const m = build(items);
    m.classList.add('root');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
    this._menu = m;
  }
  closeMenus() { if (this._menu) { this._menu.remove(); this._menu = null; } }

  // ------------------------------------------------------------------ teclado
  bindKeyboard() {
    const held = new Set();
    const A = 'Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8'.split(' ');
    const B = 'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI'.split(' ');
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || this._modal || this.welcome?.isOpen || this.cleanupUI?.isOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); this.libraryUI.searchIn.focus(); return; }
      // Supr = quitar de la vista (crate, Prepare) o de la biblioteca, con el foco en la tabla;
      // Ctrl+Supr = eliminar de la biblioteca al instante (sin confirmar), con pistas seleccionadas y el foco
      // en cualquier parte de la biblioteca (los campos de texto y los diálogos ya han salido arriba)
      const hard = e.ctrlKey || e.metaKey;
      // con el foco en una lista de YouTube de la barra lateral (o en «todos los vídeos»), Supr / Ctrl+Supr
      // la borra (con confirmación) en lugar de actuar sobre las pistas seleccionadas
      if (e.key === 'Delete' && !e.altKey && !e.shiftKey && this.libraryUI.sideDeleteTarget()) {
        e.preventDefault();
        if (!e.repeat) { this.closeMenus(); this.libraryUI.sideDeleteKey(); }
        return;
      }
      if (e.key === 'Delete' && !e.altKey && !e.shiftKey && (hard ? this.libraryUI.hardDeleteReady() : this.libraryUI.tableFocused())) {
        e.preventDefault();
        if (!e.repeat) { this.closeMenus(); this.libraryUI.deleteKey(hard); }
        return;
      }
      // Ctrl+Z = deshacer lo último que se ha quitado con Supr / Ctrl+Supr
      if (hard && e.code === 'KeyZ' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!e.repeat) this.libraryUI.undoLast();
        return;
      }
      // Ctrl+→ = Autoplay: siguiente pista
      if ((e.ctrlKey || e.metaKey) && e.code === 'ArrowRight' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!e.repeat) this.autoplay.skip();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (held.has(e.code)) { e.preventDefault(); return; }
      held.add(e.code);
      const [d0, d1] = this.decks;
      const ia = A.indexOf(e.code), ib = B.indexOf(e.code);
      if (ia >= 0) { e.preventDefault(); d0.padDown(ia, e.shiftKey); return; }
      if (ib >= 0) { e.preventDefault(); d1.padDown(ib, e.shiftKey); return; }
      switch (e.code) {
        case 'KeyZ': d0.cueDown(); break;
        case 'KeyX': d0.togglePlay(); break;
        case 'KeyC': d0.toggleSync(); break;
        case 'KeyV': d0.autoLoop(); break;
        case 'KeyA': d0.bendDown(-1); break;
        case 'KeyS': d0.bendDown(1); break;
        case 'KeyN': d1.cueDown(); break;
        case 'KeyM': d1.togglePlay(); break;
        case 'Comma': d1.toggleSync(); break;
        case 'Period': d1.autoLoop(); break;
        case 'KeyK': d1.bendDown(-1); break;
        case 'KeyL': d1.bendDown(1); break;
        case 'ArrowUp': this.libraryUI.move(-1, false); break;
        case 'ArrowDown': this.libraryUI.move(1, false); break;
        case 'PageUp': this.libraryUI.move(-15, false); break;
        case 'PageDown': this.libraryUI.move(15, false); break;
        case 'ArrowLeft': if (e.shiftKey) this.loadSelected(this.layers[0]); else if (!this.libraryUI.sideKey(-1, false)) this.libraryUI.toggleFocus('side'); break;
        case 'ArrowRight': if (e.shiftKey) this.loadSelected(this.layers[1]); else if (!this.libraryUI.sideKey(1, false)) this.libraryUI.toggleFocus('table'); break;
        case 'Tab': this.libraryUI.toggleFocus(); break;
        case 'F9': this.toggleRecord(); break;
        case 'F6': this.engine.setSplit(!this.engine.split); break;
        case 'F8': this.toggleLaptopMode(); break;
        case 'F7': if (e.shiftKey) this.autoplay.toggle(); else this.automix.toggle(); break;
        default: held.delete(e.code); return;
      }
      e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      held.delete(e.code);
      const [d0, d1] = this.decks;
      const ia = A.indexOf(e.code), ib = B.indexOf(e.code);
      if (ia >= 0) return d0.padUp(ia);
      if (ib >= 0) return d1.padUp(ib);
      switch (e.code) {
        case 'KeyZ': d0.cueUp(); break;
        case 'KeyN': d1.cueUp(); break;
        case 'KeyA': case 'KeyS': d0.bendUp(); break;
        case 'KeyK': case 'KeyL': d1.bendUp(); break;
      }
    });
    window.addEventListener('blur', () => held.clear());
  }
}

const app = new App();
window.nexuraApp = app;
app.start().catch((e) => {
  console.error(e);
  document.body.appendChild(el('div', { class: 'fatal' }, el('h2', {}, 'No se pudo iniciar Nexura DJ Studio'), el('pre', {}, String(e && e.stack || e))));
});
