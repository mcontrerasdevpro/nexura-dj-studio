// Gestor MIDI: dispositivos, acciones asignables, MIDI learn por controladora,
// codificadores relativos universales, 14 bits, LEDs genéricos, monitor y perfiles
import { Emitter, clamp } from '../util.js';
import { MC4000Profile } from './mc4000.js';
import { MidiProfileCatalog, REF_TICKS_PER_REV } from './profile-loader.js';
import { PAD_MODES, PAD_MODE_NAMES } from '../audio/deck.js';
import { STEMS, STEM_PRESETS } from '../audio/stems.js';

// Clave de un control: n = nota, c = CC, p = pitch bend (un solo control por canal)
export const midiKey = (st, d1) => {
  const t = st & 0xF0, ch = st & 0x0F;
  if (t === 0xE0) return `p${ch}:0`;
  const type = t === 0x80 || t === 0x90 ? 'n' : t === 0xB0 ? 'c' : 'x';
  return `${type}${ch}:${d1}`;
};
export const parseKey = (k) => {
  const m = /^([ncp])(\d+):(\d+)$/.exec(k || '');
  return m ? { type: m[1], ch: +m[2], num: +m[3] } : null;
};
export const describeKey = (k) => {
  const m = parseKey(k);
  if (!m) return k;
  if (m.type === 'p') return `Pitch bend · canal ${m.ch + 1}`;
  const type = { n: 'Nota', c: 'CC' }[m.type];
  return `${type} ${m.num.toString(16).toUpperCase().padStart(2, '0')}h · canal ${m.ch + 1}`;
};

// Codificaciones de los controles relativos (jog, encoders):
//  twos   = complemento a dos (1…63 adelante, 127…65 atrás) — Denon, Numark, Hercules
//  offset = desplazamiento 64 (65… adelante, 63… atrás) — Pioneer, Reloop, Traktor
//  sign   = bit de signo (1…63 adelante, 65…127 atrás) — algunos Behringer/Allen & Heath
export const REL_DECODERS = {
  twos: (v) => (v < 64 ? v : v - 128),
  offset: (v) => v - 64,
  sign: (v) => (v & 64 ? -(v & 63) : v & 63)
};
export const REL_NAMES = { twos: 'complemento a dos', offset: 'desplazamiento 64', sign: 'bit de signo' };
// Estadística de valores recibidos para deducir la codificación de un control relativo
export const newRelStats = () => ({ zero: 0, a: 0, b: 0, c: 0, d: 0, n: 0 });
export function addRelStat(st, v) {
  st.n++;
  if (v === 0) st.zero++;
  else if (v < 34) st.a++;
  else if (v < 64) st.b++;
  else if (v === 64) { /* reposo en offset 64 */ }
  else if (v < 95) st.c++;
  else st.d++;
  return st;
}
export function guessRelEncoding(st) {
  if (!st || !st.n) return 'twos';
  if (st.b > 0 && !st.zero && st.b + st.c >= st.a + st.d) return 'offset'; // valores alrededor de 64
  if (st.d > 0) return 'twos';                                            // 127, 126… = pasos atrás
  if (st.a > 0 && st.c > 0) return 'sign';                                 // 1… y 65… sin 127…
  if (st.c > 0 && !st.a) return 'offset';                                  // 65, 66… = adelante
  return 'twos';
}
const rel = REL_DECODERS.twos;
// Pasos del jog de la MC4000 por vuelta: escala de referencia del motor de scratch (en profile-loader.js)
export { REF_TICKS_PER_REV };

// Perfil de dispositivo guardado en settings.midiProfiles[nombre]
// { map: {clave: acción}, opts: {clave: {enc, inv, scale}}, leds: [{key, action, on, off}], ledsOff }
// (formato antiguo: objeto plano {clave: acción})
export function normalizeDeviceProfile(raw) {
  if (!raw || typeof raw !== 'object') return { map: {}, opts: {}, leds: [], ledsOff: false };
  if (raw.map && typeof raw.map === 'object') {
    return { map: { ...raw.map }, opts: { ...(raw.opts || {}) }, leds: Array.isArray(raw.leds) ? raw.leds.slice() : [], ledsOff: !!raw.ledsOff, source: raw.source || '' };
  }
  const map = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') map[k] = v;
  return { map, opts: {}, leds: [], ledsOff: false };
}

// Empareja la salida MIDI de un dispositivo con su entrada
// (Windows: «MIDIIN2 (DDJ-400)» ↔ «MIDIOUT2 (DDJ-400)»; macOS: mismo nombre)
const normPort = (n) => String(n || '').replace(/MIDI\s*(IN|OUT)\s*\d*/gi, '').replace(/\b(IN|OUT|INPUT|OUTPUT)\b/gi, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
export function findOutputFor(outputs, name) {
  return outputs.find(o => o.name === name && o.state === 'connected') ||
    outputs.find(o => normPort(o.name) && normPort(o.name) === normPort(name) && o.state === 'connected') || null;
}

// Registro de acciones asignables por MIDI learn
export function buildActions(app) {
  const A = {};
  // led: función opcional que devuelve el estado (encendido/apagado) para el LED del control
  const add = (id, label, kind, fn, group, led) => { A[id] = { id, label, kind, fn, group, led }; };
  for (const d of app.decks) {
    const n = d.idx + 1, g = 'Deck ' + n, p = `deck${n}.`;
    const press = (fn) => (on) => { if (on) fn(); };
    add(p + 'play', 'Play/Pausa', 'button', press(() => d.togglePlay()), g, () => d.playing || (!!d.track && Math.floor(performance.now() / 300) % 2 === 0));
    add(p + 'cue', 'Cue', 'button', (on) => (on ? d.cueDown() : d.cueUp()), g, () => !!d.track && (d.playing || Math.abs(d.time - d.cuePoint) < 0.03));
    add(p + 'stutter', 'Stutter (play desde cue)', 'button', press(() => d.stutter()), g);
    add(p + 'start', 'Ir al inicio', 'button', press(() => d.toStart()), g);
    add(p + 'sync', 'Sync', 'button', press(() => d.toggleSync()), g, () => d.sync);
    add(p + 'syncoff', 'Sync off', 'button', press(() => d.setSync(false)), g);
    add(p + 'keylock', 'Key lock', 'button', press(() => d.toggleKeylock()), g, () => d.keylock);
    add(p + 'range', 'Rango de pitch', 'button', press(() => d.cycleRange()), g);
    add(p + 'slip', 'Slip', 'button', press(() => d.toggleSlip()), g, () => d.slip);
    add(p + 'vinyl', 'Vinyl', 'button', press(() => d.toggleVinyl()), g, () => d.vinyl);
    add(p + 'censor', 'Censor (mantener)', 'button', (on) => d.censor(on), g);
    add(p + 'bendminus', 'Pitch bend −', 'button', (on) => (on ? d.bendDown(-1) : d.bendUp()), g);
    add(p + 'bendplus', 'Pitch bend +', 'button', (on) => (on ? d.bendDown(1) : d.bendUp()), g);
    add(p + 'pitchfineminus', 'Pitch fino −0,01 BPM', 'button', press(() => d.pitchFine(-0.01)), g);
    add(p + 'pitchfineplus', 'Pitch fino +0,01 BPM', 'button', press(() => d.pitchFine(0.01)), g);
    add(p + 'pitch', 'Fader de pitch', 'abs', (v) => d.setPitchFader((app.settings.invertPitch ? 1 : -1) * (v * 2 - 1)), g);
    add(p + 'jog', 'Jog / plato (relativo)', 'rel', (v) => d.jogTurn(v, REF_TICKS_PER_REV), g);
    add(p + 'jogtouch', 'Toque del plato', 'button', (on) => d.jogTouch(on), g);
    for (let i = 0; i < 8; i++) {
      add(p + 'pad' + (i + 1), `Pad ${i + 1}`, 'button', (on) => (on ? d.padDown(i) : d.padUp(i)), g, () => !!d.track && !!d.padState(i)?.on);
      add(p + 'padshift' + (i + 1), `Pad ${i + 1} (borrar)`, 'button', (on) => { if (on) d.padDown(i, true); }, g);
    }
    for (let i = 0; i < 8; i++) {
      add(p + 'hotcue' + (i + 1), `Hot cue ${i + 1}`, 'button', (on) => (on ? d.hotcue(i) : d.hotcueRelease(i)), g, () => !!d.track?.cues?.[i]);
      add(p + 'hotcueclear' + (i + 1), `Borrar hot cue ${i + 1}`, 'button', press(() => d.deleteCue(i)), g);
    }
    for (let i = 0; i < 8; i++) {
      add(p + 'cueloop' + (i + 1), `Cue Loop ${i + 1}`, 'button', press(() => d.cueLoop(i)), g, () => !!d.track?.cueLoops?.[i]);
      add(p + 'cueloopclear' + (i + 1), `Borrar Cue Loop ${i + 1}`, 'button', press(() => d.deleteCueLoop(i)), g);
    }
    for (const m of PAD_MODES) add(p + 'mode.' + m, 'Modo de pads: ' + PAD_MODE_NAMES[m], 'button', press(() => d.setPadMode(m)), g, () => d.padMode === m);
    STEMS.forEach((st, k) => add(p + 'stem.' + st.key, 'Stem ' + st.name + ' (activar/silenciar)', 'button', press(() => d.toggleStem(k)), g, () => d.stemsOn && d.stemGains[k] > 0.5));
    STEMS.forEach((st, k) => add(p + 'stemlevel.' + st.key, 'Nivel del stem ' + st.name, 'abs', (v) => d.setStemLevel(k, v), g));
    for (const [k, pr] of Object.entries(STEM_PRESETS)) add(p + 'stempreset.' + k, 'Stems: ' + pr.name, 'button', press(() => d.stemPreset(k)), g);
    // Stems FX (1 = voz, 2 = batería, 3 = bajo, 4 = melodía) y Stem Slip (mantener)
    STEMS.forEach((st, k) => {
      add(p + 'stemfx' + (k + 1), `Stems FX: ${st.name}`, 'button', press(() => d.toggleStemFx(k)), g, () => d.stemsOn && !!d.stemFx[k]);
      add(p + 'stemslip' + (k + 1), `Stem Slip: ${st.name} (mantener)`, 'button', (on) => (on ? d.stemSlipDown(k) : d.stemSlipUp(k)), g, () => !!d.stemSlipHeld[k]);
    });
    add(p + 'modehold', 'PAD MODE (mantener + pad)', 'button', (on) => app.midi.setPadModeHold(d.idx, on), g);
    add(p + 'loop', 'Auto loop', 'button', press(() => d.autoLoop()), g, () => !!d.loop?.on);
    add(p + 'loophalve', 'Loop ½', 'button', press(() => d.loopHalve()), g);
    add(p + 'loopdouble', 'Loop ×2', 'button', press(() => d.loopDouble()), g);
    add(p + 'loopin', 'Loop in', 'button', press(() => d.loopIn()), g);
    add(p + 'loopout', 'Loop out', 'button', press(() => d.loopOut()), g);
    add(p + 'reloop', 'Reloop / salir', 'button', press(() => d.reloop()), g, () => !!d.loop?.on);
    add(p + 'jumpback', 'Beat jump atrás', 'button', press(() => d.beatJump(-d.jumpBeats)), g);
    add(p + 'jumpfwd', 'Beat jump adelante', 'button', press(() => d.beatJump(d.jumpBeats)), g);
    add(p + 'keyup', 'Tonalidad +', 'button', press(() => d.keyShift(1)), g);
    add(p + 'keydown', 'Tonalidad −', 'button', press(() => d.keyShift(-1)), g);
    add(p + 'keyreset', 'Tonalidad original', 'button', press(() => d.keyReset()), g);
    add(p + 'tap', 'Tap tempo', 'button', press(() => d.tap()), g);
    add(p + 'gridmarker', 'Beatgrid: añadir marca aquí', 'button', press(() => d.addGridMarker()), g);
    add(p + 'gridunmark', 'Beatgrid: quitar marca cercana', 'button', press(() => d.removeGridMarker()), g);
    add(p + 'gridleft', 'Beatgrid: mover −5 ms', 'button', press(() => d.gridShift(-5)), g);
    add(p + 'gridright', 'Beatgrid: mover +5 ms', 'button', press(() => d.gridShift(5)), g);
    add(p + 'gridstart', 'Beatgrid: inicio del grid aquí', 'button', press(() => d.editGrid('start')), g);
    add(p + 'gridbeat', 'Beatgrid: beat aquí', 'button', press(() => d.editGrid('beat')), g);
    add(p + 'gridbar', 'Beatgrid: compás aquí', 'button', press(() => d.downbeatHere()), g);
    add(p + 'gridundo', 'Beatgrid: deshacer', 'button', press(() => d.undoGrid()), g);
    add(p + 'load', 'Cargar pista seleccionada', 'button', press(() => app.loadSelected(d.idx)), g);
    add(p + 'eject', 'Expulsar', 'button', press(() => d.eject()), g);
    const ch = app.engine.channels[d.idx];
    add(p + 'pfl', 'Cue de auriculares ' + n, 'button', press(() => ch.set('pfl', !ch.values.pfl)), 'Mezclador', () => !!ch.values.pfl);
    for (const [k, l] of [['trim', 'Gain'], ['high', 'EQ agudos'], ['mid', 'EQ medios'], ['low', 'EQ graves'], ['filter', 'Filtro'], ['fader', 'Fader de canal']]) {
      add(p + k, `${l} ${n}`, 'abs', (v) => ch.set(k, k === 'fader' ? v : (Math.abs(v - 0.5) < 0.01 ? 0.5 : v)), 'Mezclador');
    }
  }
  const eng = app.engine;
  add('xfader', 'Crossfader', 'abs', (v) => eng.setCrossfader(v), 'Mezclador');
  add('master', 'Volumen master', 'abs', (v) => eng.setMaster(v), 'Mezclador');
  add('cuemix', 'Mezcla cue/master', 'abs', (v) => eng.setCueMix(v), 'Mezclador');
  add('phones', 'Volumen auriculares', 'abs', (v) => eng.setPhonesVol(v), 'Mezclador');
  add('split', 'Split de auriculares (interruptor)', 'button', (on) => eng.setSplit(!!on), 'Mezclador', () => !!eng.split);
  add('samplervol', 'Volumen sampler', 'abs', (v) => eng.setSamplerVol(v), 'Sampler');
  for (let i = 0; i < 8; i++) {
    add('sampler' + (i + 1), `Disparar muestra ${i + 1}`, 'button', (on) => (on ? app.sampler.press(i) : app.sampler.release(i)), 'Sampler', () => !!app.sampler.isPlaying?.(i));
    add('samplerstop' + (i + 1), `Parar muestra ${i + 1}`, 'button', (on) => { if (on) app.sampler.stop(i); }, 'Sampler');
  }
  add('browse', 'Navegar biblioteca', 'rel', (v) => app.libraryUI.move(Math.sign(v) * Math.min(4, Math.abs(v))), 'Biblioteca');
  add('browsefast', 'Navegar rápido', 'rel', (v) => app.libraryUI.move(v * 10), 'Biblioteca');
  add('browseup', 'Pista anterior', 'button', (on) => { if (on) app.libraryUI.move(-1); }, 'Biblioteca');
  add('browsedown', 'Pista siguiente', 'button', (on) => { if (on) app.libraryUI.move(1); }, 'Biblioteca');
  add('browsepush', 'Pulsar encoder (cambiar panel)', 'button', (on) => { if (on) app.libraryUI.toggleFocus(); }, 'Biblioteca');
  add('back', 'Back (ir a la barra lateral; en ella, plegar subcrates)', 'button', (on) => { if (on && !app.libraryUI.sideKey(-1)) app.libraryUI.toggleFocus('side'); }, 'Biblioteca');
  // en la barra lateral, ← / → pliegan y despliegan los subcrates
  add('browseleft', '← Plegar subcrates / ir a la barra lateral', 'button', (on) => { if (on && !app.libraryUI.sideKey(-1)) app.libraryUI.toggleFocus('side'); }, 'Biblioteca');
  add('browseright', '→ Desplegar subcrates / ir a la tabla', 'button', (on) => { if (on && !app.libraryUI.sideKey(1)) app.libraryUI.toggleFocus('table'); }, 'Biblioteca');
  add('panel', 'Mostrar/ocultar sampler', 'button', (on) => { if (on) app.togglePanel('sampler'); }, 'Biblioteca');
  add('prepare', 'Añadir a Prepare', 'button', (on) => { if (on) { const t = app.libraryUI.current(); if (t) app.library.addToPrepare([t.id]); } }, 'Biblioteca');
  add('openprepare', 'Abrir Prepare', 'button', (on) => { if (on) app.libraryUI.setView('prepare'); }, 'Biblioteca');
  add('autoplay', 'Autoplay del crate abierto (empezar/parar)', 'button', (on) => { if (on) app.autoplay.toggle(); }, 'Global', () => !!app.autoplay?.enabled);
  add('autoplaynext', 'Autoplay: siguiente pista', 'button', (on) => { if (on) app.autoplay.skip(); }, 'Global');
  add('quantize', 'Cuantización', 'button', (on) => { if (on) app.setSetting('quantize', !app.settings.quantize); }, 'Global', () => !!app.settings.quantize);
  add('record', 'Grabar', 'button', (on) => { if (on) app.toggleRecord(); }, 'Global', () => !!eng.recording);
  for (const u of app.fxUnits) {
    const g = 'FX ' + (u.idx + 1), p = `fx${u.idx + 1}.`;
    u.slots.forEach((s, i) => {
      add(p + 'on' + (i + 1), `Efecto ${i + 1} on/off`, 'button', (on) => { if (on) { s.setEnabled(!s.enabled); app.emit('fx'); } }, g, () => !!s.enabled);
      add(p + 'param' + (i + 1), `Efecto ${i + 1} cantidad`, 'abs', (v) => { s.setParam(v); app.emit('fx'); }, g);
      add(p + 'next' + (i + 1), `Efecto ${i + 1} siguiente`, 'button', (on) => { if (on) { app.nextEffect(s); } }, g);
    });
    add(p + 'mix', 'Wet/dry', 'abs', (v) => { u.setMix(v); app.emit('fx'); }, g);
    add(p + 'beats', 'Beats (relativo)', 'rel', (v) => app.fxBeats(u, Math.sign(v)), g);
    add(p + 'tap', 'Tap', 'button', (on) => { if (on) { const d = app.fxTargetDeck(u); if (d) d.tap(); } }, g);
  }
  // Con 4 decks, tocar un control de un deck lo muestra en su lado (capa 1/3 o 2/4)
  for (const a of Object.values(A)) {
    const m = /^deck([1-4])\./.exec(a.id);
    if (!m) continue;
    const idx = +m[1] - 1, fn = a.fn;
    a.fn = (...args) => { if (app.focusDeck) app.focusDeck(idx); return fn(...args); };
  }
  return A;
}

// Modelos de controladora MIDI con control de 4 decks (capas 1/3 y 2/4)
export const FOUR_DECK_MODELS = /DDJ[- ]?(SX|SZ|RZ|RX|1000|FLX ?6|FLX ?10)|\bNS ?6|\bNS ?7|Mixtrack Platinum|\bMC ?6000|\bMC ?7000|MCX ?8000|PRIME ?4|SC ?LIVE ?4|Mixon ?[48]|Terminal Mix ?[48]|Beatmix ?4|\bDJ-?808|Rane ?Four/i;

export class MidiManager extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.access = null;
    this.status = 'init';
    this.devices = [];
    this.profiles = [];          // perfiles nativos (MC4000)
    this.catalog = new MidiProfileCatalog();
    this.devState = new Map();   // input.id → estado del dispositivo (perfil, salida, 14 bits, estadísticas)
    this.learning = null;
    this.learnDevice = null;
    this.capture = null;         // asistente: recibe todos los mensajes mientras está abierto
    this.monitor = [];
    this.padModeHeld = [false, false];
    this.lastLed = 0;
    this.timeouts = 0;           // veces que requestMIDIAccess no ha respondido a tiempo (diagnóstico)
    this.waitMs = null;          // lo que tardó en responder (diagnóstico)
  }
  static INIT_TIMEOUT_MS = 5000;
  static RETRY_MS = 20000;

  // Con cualquier controladora (recién conectada o abierta en otro programa; se vio con la MC4000) el navegador
  // puede tardar mucho en responder a requestMIDIAccess, o no responder nunca. El arranque de la app no espera
  // a MIDI (app.start) y aquí se espera como mucho INIT_TIMEOUT_MS: después status = 'timeout' (evento
  // 'status'; la app avisa con «Reintentar») y se sigue intentando cada RETRY_MS. Si la respuesta llega tarde se
  // acepta igual. Estados: init → waiting → ok | denied | unsupported | timeout
  async init() {
    // los perfiles JSON no deben retrasar la conexión: si llegan después, se vuelve a mirar los dispositivos
    // (y entonces se avisa de lo detectado: hasta tener el catálogo no se sabe si hay perfil)
    this.catalogReady = this.catalog.load().catch(e => console.warn('No se pudieron cargar perfiles MIDI JSON', e));
    this.catalogReady.then(() => { this.catalogLoaded = true; if (this.access) this.scan(); });
    this.timeouts = 0;
    return this.connect();
  }

  // Un intento de conexión: resuelve con el estado cuando responde el navegador o al pasar el tiempo máximo
  connect() {
    if (!navigator.requestMIDIAccess) { this.setStatus('unsupported'); this.emit('devices'); return Promise.resolve(this.status); }
    if (this.access) return Promise.resolve(this.status);
    const t0 = performance.now();
    this.lastTry = Date.now();
    if (this.status !== 'timeout') this.setStatus('waiting');
    const req = (async () => {
      try { return await navigator.requestMIDIAccess({ sysex: true }); }
      catch (_) { return navigator.requestMIDIAccess({ sysex: false }); }
    })();
    const answered = req.then((access) => { this.onAccess(access, t0); return true; }, () => {
      if (!this.access) { this.waitMs = Math.round(performance.now() - t0); this.setStatus('denied'); this.emit('devices'); }
      return true;
    });
    return Promise.race([answered, new Promise(r => setTimeout(() => r(false), MidiManager.INIT_TIMEOUT_MS))]).then((ok) => {
      if (!ok && !this.access && this.status !== 'denied') {
        this.timeouts++;
        this.setStatus('timeout');
        this.emit('devices');
        this.scheduleRetry();
      }
      return this.status;
    });
  }
  // Reintentar (botón del aviso o automático): un intento nuevo; el anterior sigue valiendo si responde
  retry() { clearTimeout(this.retryTimer); return this.connect(); }
  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (!this.access && this.status === 'timeout') this.connect(); }, MidiManager.RETRY_MS);
  }
  setStatus(s) {
    if (this.status === s) return;
    const prev = this.status;
    this.status = s;
    this.emit('status', s, prev);
  }
  onAccess(access, t0) {
    if (this.access) return; // ya respondió otro intento
    clearTimeout(this.retryTimer);
    this.access = access;
    this.waitMs = Math.round(performance.now() - t0);
    this.access.onstatechange = () => this.scan();
    this.setStatus('ok');
    this.scan();
  }

  // Asignaciones globales antiguas (versiones anteriores): se siguen leyendo
  get map() { return this.app.settings.midiMap || {}; }
  get actions() { return this.app.actions; }
  get savedProfiles() { return this.app.settings.midiProfiles || {}; }

  getProfile(name) { return normalizeDeviceProfile(this.savedProfiles[name]); }
  setProfile(name, prof) {
    const p = normalizeDeviceProfile(prof);
    const all = { ...this.savedProfiles };
    if (!Object.keys(p.map).length && !p.leds.length) delete all[name];
    else all[name] = { map: p.map, opts: p.opts, leds: p.leds, ledsOff: p.ledsOff, source: p.source };
    this.app.setSetting('midiProfiles', all);
    for (const ds of this.devState.values()) if (ds.name === name) { ds.prof = p; ds.ledList = null; ds.ledCache.clear(); }
    this.emit('profile', name);
  }

  isNative(name) { return MC4000Profile.match(name); }

  // Perfil incluido elegido a mano en Ajustes → MIDI (settings.midiBuiltIn[nombre] = id | 'none'); si no, el
  // que reconoce el nombre del puerto
  builtInFor(name) {
    const pick = (this.app.settings.midiBuiltIn || {})[name];
    if (pick === 'none') return null;
    return (pick && this.catalog.byId(pick)) || this.catalog.match(name);
  }
  setBuiltIn(name, id) {
    const all = { ...(this.app.settings.midiBuiltIn || {}) };
    if (id) all[name] = id; else delete all[name];
    this.app.setSetting('midiBuiltIn', all);
    for (const ds of this.devState.values()) if (ds.name === name) { ds.builtIn = ds.native ? null : this.builtInFor(name); ds.ledList = null; ds.ledCache.clear(); }
    this.emit('profile', name);
    this.emit('devices');
  }

  // Qué perfil usa un dispositivo: type = incluido | asistente | importado | ninguno (lista cerrada: va al
  // diagnóstico del informe de errores), label = texto para la interfaz, custom = controles propios del usuario
  profileInfo(name) {
    const prof = this.getProfile(name), custom = Object.keys(prof.map).length;
    if (this.isNative(name)) return { type: 'incluido', label: 'perfil incluido (nativo, con LEDs y vúmetros)', model: 'Denon DJ MC4000', custom };
    const b = this.builtInFor(name);
    if (b) return { type: 'incluido', label: `perfil incluido: ${b.name}`, model: b.name, id: b.id, custom };
    if (custom) {
      const src = prof.source;
      if (src === 'mixxx') return { type: 'importado', label: 'mapeo de Mixxx importado', custom };
      if (src === 'json') return { type: 'importado', label: 'perfil JSON importado', custom };
      return { type: 'asistente', label: src === 'asistente' ? 'configurada con el asistente' : 'configurada con MIDI Learn', custom };
    }
    const fam = this.catalog.genericMatch(name);
    return { type: 'ninguno', label: 'sin perfil', family: fam ? fam.manufacturer || fam.name : '', custom: 0 };
  }
  // Para el diagnóstico: [{ port, type }] de las controladoras conectadas
  get controllerSummary() {
    return this.connectedNames.map(n => ({ port: n, type: this.profileInfo(n).type, model: this.profileInfo(n).model || '' }));
  }
  get connectedNames() { return this.devices.filter(d => d.state === 'connected').map(d => d.name); }
  // Dispositivos configurables (todos menos los que solo tienen perfil nativo, que también admiten ajustes)
  get configurableNames() { return this.connectedNames; }

  scan() {
    if (!this.access) return;
    const inputs = [...this.access.inputs.values()];
    const outputs = [...this.access.outputs.values()];
    const prev = this.profiles;
    const connectedIds = new Set(inputs.filter(i => i.state === 'connected').map(i => i.id));
    for (const id of [...this.devState.keys()]) if (!connectedIds.has(id)) this.devState.delete(id);
    this.profiles = [];
    this.devices = inputs.map(i => ({ id: i.id, name: i.name, state: i.state, native: this.isNative(i.name) }));
    for (const input of inputs) {
      input.onmidimessage = (e) => this.onMessage(input, e.data);
      if (input.state !== 'connected') continue;
      const native = this.isNative(input.name);
      if (native) {
        const out = outputs.find(o => MC4000Profile.match(o.name) && o.state === 'connected');
        const old = prev.find(p => p.input === input);
        const prof = old || new MC4000Profile(this.app, this, input, out);
        if (old) prof.output = out;
        this.profiles.push(prof);
        if (!old) prof.init();
      }
      let ds = this.devState.get(input.id);
      if (ds && ds.name !== input.name) ds = null; // otro dispositivo con el mismo id
      if (!ds) ds = { id: input.id, name: input.name, stats: {}, msb: {}, lsb: {}, hires: new Set(), ledCache: new Map(), ledList: null, vuLast: 0 };
      ds.native = native;
      ds.builtIn = native ? null : this.builtInFor(input.name);
      ds.prof = this.getProfile(input.name);
      ds.output = native ? null : findOutputFor(outputs, input.name);
      ds.ledList = null; ds.ledCache.clear();
      this.devState.set(input.id, ds);
      // mensajes de inicio del perfil incluido (los SysEx solo si el navegador ha dado permiso)
      if (ds.builtIn && ds.output && ds.initFor !== ds.builtIn.id) {
        ds.initFor = ds.builtIn.id;
        for (const msg of ds.builtIn.init || []) {
          if (msg[0] === 0xF0 && !this.access.sysexEnabled) continue;
          try { ds.output.send(msg); } catch (_) { /* puerto cerrado */ }
        }
      }
      // aviso al conectar (una vez por conexión), cuando ya se sabe si hay perfil: lo muestra la app
      if (!ds.announced && (this.catalogLoaded || native)) {
        ds.announced = true;
        this.emit('detected', { name: input.name, info: this.profileInfo(input.name) });
      }
    }
    this.emit('devices');
  }

  // Decks que admite la controladora conectada: 4 si su modelo es de 4 decks o si su perfil
  // (MIDI Learn, asistente o mapeo importado) usa controles de los decks 3/4; si no, 2.
  get deckCapacity() {
    let cap = 0;
    for (const ds of this.devState.values()) {
      if (ds.native) { cap = Math.max(cap, 2); continue; }
      const acts = Object.values(ds.prof.map || {});
      const uses34 = acts.some(a => /^deck[34]\./.test(a));
      const builtIn4 = ds.builtIn && (ds.builtIn.decks === 4 || (ds.builtIn.mappings || []).some(m => /^deck[34]\./.test(m.action)));
      cap = Math.max(cap, uses34 || builtIn4 || FOUR_DECK_MODELS.test(ds.name) ? 4 : 2);
    }
    for (const p of this.profiles) if (p.input && p.input.state === 'connected') cap = Math.max(cap, 2);
    return cap || 2;
  }

  get controllerName() {
    if (this.profiles.length) return this.profiles[0].input.name;
    const conf = [...this.devState.values()].find(d => Object.keys(d.prof.map).length);
    if (conf) return conf.name;
    const c = this.devices.find(d => d.state === 'connected');
    return c ? c.name : '';
  }

  // ---------------------------------------------------------------- perfiles
  // Copia al dispositivo las asignaciones globales de versiones anteriores
  saveDeviceProfile(deviceName) {
    if (!this.devices.some(d => d.name === deviceName)) return false;
    const prof = this.getProfile(deviceName);
    Object.assign(prof.map, this.map);
    this.setProfile(deviceName, prof);
    this.app.setSetting('midiMap', {});
    return true;
  }

  exportDeviceProfile(deviceName) {
    const prof = this.getProfile(deviceName);
    if (!Object.keys(prof.map).length && Object.keys(this.map).length) Object.assign(prof.map, this.map);
    return this.catalog.exportUserProfile(deviceName, prof);
  }

  importDeviceProfile(deviceName, raw) {
    const profile = this.catalog.validateUserProfile(raw);
    if (!profile) throw new Error('El archivo no es un perfil Nexura MIDI compatible.');
    const map = {}, opts = {};
    for (const m of profile.mappings) {
      if (!this.actions[m.action]) throw new Error(`Acción MIDI desconocida: ${m.action}`);
      map[m.key] = m.action;
      const o = {};
      if (m.enc && REL_DECODERS[m.enc]) o.enc = m.enc;
      if (m.inv) o.inv = true;
      if (m.scale > 0) o.scale = m.scale;
      if (Object.keys(o).length) opts[m.key] = o;
    }
    const leds = (raw.leds || []).filter(l => l && parseKey(l.key) && this.actions[l.action]);
    this.setProfile(deviceName, { map, opts, leds, ledsOff: !!raw.ledsOff, source: 'json' });
    return profile;
  }

  // Aplica un perfil traducido (p. ej. de Mixxx); merge = conservar lo ya asignado en otras teclas
  applyProfile(deviceName, imported, merge = true) {
    const base = merge ? this.getProfile(deviceName) : normalizeDeviceProfile(null);
    const takenActions = new Set(Object.values(imported.map));
    for (const [k, a] of Object.entries(base.map)) if (takenActions.has(a) && !imported.map[k]) { /* se sustituye */ delete base.map[k]; delete base.opts[k]; }
    Object.assign(base.map, imported.map);
    for (const k of Object.keys(imported.map)) { if (imported.opts?.[k]) base.opts[k] = imported.opts[k]; else delete base.opts[k]; }
    if (imported.leds?.length) base.leds = imported.leds;
    base.source = imported.source || base.source;
    this.setProfile(deviceName, base);
  }

  clearDevice(deviceName) { this.setProfile(deviceName, null); }
  keysFor(deviceName, actionId) {
    const keys = Object.entries(this.getProfile(deviceName).map).filter(([, a]) => a === actionId).map(([k]) => k);
    if (!keys.length) for (const [k, a] of Object.entries(this.map)) if (a === actionId) keys.push(k);
    return keys;
  }
  setLedsEnabled(deviceName, on) { const p = this.getProfile(deviceName); p.ledsOff = !on; this.setProfile(deviceName, p); }

  // ---------------------------------------------------------------- MIDI learn (por controladora)
  learn(actionId, deviceName = null) { this.learning = actionId; this.learnDevice = deviceName; this.emit('learn', actionId); }
  cancelLearn() { this.learning = null; this.learnDevice = null; this.emit('learn', null); }

  assignDevice(deviceName, key, actionId, { replace = true, opts = null } = {}) {
    const prof = this.getProfile(deviceName);
    if (actionId && replace) for (const k of Object.keys(prof.map)) if (prof.map[k] === actionId) { delete prof.map[k]; delete prof.opts[k]; }
    if (actionId) { prof.map[key] = actionId; if (opts && Object.keys(opts).length) prof.opts[key] = opts; else delete prof.opts[key]; }
    else { delete prof.map[key]; delete prof.opts[key]; }
    prof.leds = prof.leds.filter(l => l.key !== key || l.action === actionId);
    this.setProfile(deviceName, prof);
    // las asignaciones globales antiguas no deben pisar la nueva
    const g = this.map;
    if (Object.keys(g).some(k => k === key || (actionId && g[k] === actionId))) {
      const ng = { ...g };
      for (const k of Object.keys(ng)) if (k === key || (actionId && ng[k] === actionId)) delete ng[k];
      this.app.setSetting('midiMap', ng);
    }
  }
  unassignAction(deviceName, actionId) {
    const prof = this.getProfile(deviceName);
    for (const k of Object.keys(prof.map)) if (prof.map[k] === actionId) { delete prof.map[k]; delete prof.opts[k]; }
    this.setProfile(deviceName, prof);
    const ng = { ...this.map };
    let changed = false;
    for (const k of Object.keys(ng)) if (ng[k] === actionId) { delete ng[k]; changed = true; }
    if (changed) this.app.setSetting('midiMap', ng);
  }
  // compatibilidad: asignación global
  assign(key, actionId) {
    const map = { ...this.map };
    for (const k of Object.keys(map)) if (map[k] === actionId) delete map[k];
    if (actionId) map[key] = actionId; else delete map[key];
    this.app.setSetting('midiMap', map);
  }
  clearUserMap() { this.app.setSetting('midiMap', {}); }

  setPadModeHold(deck, on) { this.padModeHeld[deck] = !!on; }

  // ---------------------------------------------------------------- mensajes
  lookup(ds, key) {
    if (ds) {
      const a = ds.prof.map[key];
      if (a && this.actions[a]) return { id: a, opt: ds.prof.opts[key] || {} };
    }
    const g = this.map[key];
    if (g && this.actions[g]) return { id: g, opt: {} };
    if (ds && ds.builtIn) {
      const m = ds.builtIn.byKey ? ds.builtIn.byKey.get(key) : ds.builtIn.mappings.find(x => x.key === key);
      if (m && this.actions[m.action]) return { id: m.action, opt: { enc: m.enc, inv: m.inv, scale: m.scale } };
    }
    return null;
  }

  describeMapping(deviceName, key) {
    const ds = [...this.devState.values()].find(d => d.name === deviceName);
    const hit = this.lookup(ds, key);
    return hit ? this.actions[hit.id].label + ' (' + this.actions[hit.id].group + ')' : '';
  }

  onMessage(input, data) {
    const st = data[0];
    if (st >= 0xF0) return;
    const t = st & 0xF0, ch = st & 0x0F;
    if (t === 0xA0 || t === 0xC0 || t === 0xD0) return; // aftertouch / program change
    const d1 = data[1] ?? 0, d2 = data[2] ?? 0;
    const key = midiKey(st, d1);
    const isNote = t === 0x80 || t === 0x90;
    const pressed = t === 0x90 && d2 > 0;
    const ds = this.devState.get(input.id);

    this.monitor.push({ time: performance.now(), dev: input.name, st, d1, d2, key });
    if (this.monitor.length > 200) this.monitor.shift();
    this.emit('msg', { dev: input.name, st, d1, d2, key });

    if (this.capture) { try { this.capture({ input, name: input.name, st, t, ch, d1, d2, key, isNote, pressed }); } catch (e) { console.error(e); } return; }

    if (this.learning) {
      if (this.learnDevice && this.learnDevice !== input.name) return;
      const act = this.actions[this.learning];
      if (!act) return this.cancelLearn();
      if (act.kind === 'button') { if (isNote ? !pressed : (t !== 0xB0 || d2 < 64)) return; }
      else if (isNote) return; // un knob/jog necesita un CC o pitch bend
      if (act.kind === 'rel' && t === 0xE0) return;
      if (t === 0xB0 && d1 >= 32 && d1 < 64 && ds && ds.hires.has(`c${ch}:${d1 - 32}`)) return; // LSB de 14 bits
      this.assignDevice(input.name, key, this.learning);
      this.app.toast(`Asignado en ${input.name}: ${act.label} → ${describeKey(key)}`, 'ok');
      this.cancelLearn();
      return;
    }

    // Control de 14 bits: CC n (MSB) + CC n+32 (LSB)
    if (t === 0xB0 && d1 >= 32 && d1 < 64 && ds) {
      const mk = `c${ch}:${d1 - 32}`;
      if (!this.lookup(ds, key)) {
        const hit = this.lookup(ds, mk);
        if (hit && this.actions[hit.id].kind === 'abs') {
          ds.hires.add(mk); ds.lsb[mk] = d2;
          this.run(this.actions[hit.id], { on: false, v: (((ds.msb[mk] ?? 0) << 7) | d2) / 16383, r: 0 }, hit.opt);
          return;
        }
      }
    }

    const hit = this.lookup(ds, key);
    if (hit) {
      const act = this.actions[hit.id];
      const ev = { on: false, v: 0, r: 0 };
      if (isNote) { ev.on = pressed; ev.v = pressed ? 1 : 0; }
      else if (t === 0xE0) { ev.v = ((d2 << 7) | d1) / 16383; ev.on = ev.v > 0.5; }
      else {
        ev.on = d2 > 63;
        if (ds) ds.msb[key] = d2;
        if (ds && ds.hires.has(key)) ev.v = ((d2 << 7) | (ds.lsb[key] ?? 0)) / 16383;
        else ev.v = d2 / 127;
        if (act.kind === 'rel') {
          let enc = hit.opt.enc;
          if (!enc && ds) enc = guessRelEncoding(addRelStat(ds.stats[key] || (ds.stats[key] = newRelStats()), d2));
          ev.r = (REL_DECODERS[enc] || rel)(d2);
        }
      }
      if (act.kind === 'rel' && isNote) return;
      this.run(act, ev, hit.opt);
      return;
    }
    // perfil nativo del controlador
    for (const p of this.profiles) if (p.input === input && p.handle(st, d1, d2)) return;
  }

  run(act, ev, opt = {}) {
    try {
      if (act.kind === 'button') act.fn(!!ev.on);
      else if (act.kind === 'abs') act.fn(clamp(opt.inv ? 1 - ev.v : ev.v, 0, 1));
      else if (act.kind === 'rel') {
        let r = opt.inv ? -ev.r : ev.r;
        if (opt.scale > 0) r *= opt.scale;
        if (r) act.fn(r);
      }
    } catch (e) { console.error(e); }
  }

  // ---------------------------------------------------------------- LEDs genéricos
  // Se encienden con el mismo número MIDI que el botón (nota → nota, CC → CC), valor 127/0.
  // Los perfiles importados (Mixxx) pueden traer su lista propia de LEDs y valores; los incluidos, los LEDs
  // que documenta el fabricante (si el usuario reasigna ese botón, manda su asignación).
  buildLedList(ds) {
    if (ds.prof.ledsOff) return [];
    const list = [], seen = new Set();
    const push = (key, action, on = 0x7F, off = 0) => {
      const k = parseKey(key);
      if (!k || k.type === 'p' || seen.has(key) || !this.actions[action]?.led) return;
      seen.add(key);
      list.push({ st: (k.type === 'n' ? 0x90 : 0xB0) | k.ch, d1: k.num, action, on, off });
    };
    for (const l of ds.prof.leds) push(l.key, l.action, l.on ?? 0x7F, l.off ?? 0);
    for (const [k, a] of Object.entries(ds.prof.map)) if (this.actions[a]?.kind === 'button') push(k, a);
    if (ds.builtIn) for (const l of ds.builtIn.leds || []) if (!ds.prof.map[l.key]) push(l.key, l.action, l.on, l.off);
    return list;
  }

  // Vúmetros de un perfil incluido: nivel de pico de la app (app.lastMeters) en la escala del fabricante
  static vuValue(p, min = 0, max = 0x7F) {
    const m = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(p || 0, 1e-6)) + 48) / 51)); // −48…+3 dB, como el mezclador
    return Math.round(min + m * (max - min));
  }
  vuLevel(source, meters) {
    if (!meters) return 0;
    if (source === 'masterL') return meters.L;
    if (source === 'masterR') return meters.R;
    if (source === 'master') return Math.max(meters.L || 0, meters.R || 0);
    const i = +source.slice(4) - 1;
    return (meters.ch || [])[i] || 0;
  }

  frame() {
    for (const p of this.profiles) p.frame();
    const now = performance.now();
    if (now - this.lastLed < 40) return;
    this.lastLed = now;
    for (const ds of this.devState.values()) {
      if (ds.native || !ds.output) continue;
      const list = ds.ledList || (ds.ledList = this.buildLedList(ds));
      const send = (st, d1, v) => {
        const k = (st << 8) | d1;
        if (ds.ledCache.get(k) === v) return;
        ds.ledCache.set(k, v);
        try { ds.output.send([st, d1, v]); } catch (_) { /* puerto cerrado */ }
      };
      for (const l of list) {
        let on = false;
        try { on = !!this.actions[l.action].led(); } catch (_) {}
        send(l.st, l.d1, on ? l.on : l.off);
      }
      // vúmetros (~12 Hz: los LEDs ya se refrescan cada 40 ms; basta uno de cada dos)
      const vu = !ds.prof.ledsOff && ds.builtIn && ds.builtIn.vu;
      if (vu && vu.length && now - (ds.vuLast || 0) > 75) {
        ds.vuLast = now;
        for (const v of vu) {
          const k = parseKey(v.key);
          send((k.type === 'n' ? 0x90 : 0xB0) | k.ch, k.num, MidiManager.vuValue(this.vuLevel(v.source, this.app.lastMeters), v.min, v.max));
        }
      }
    }
  }
}
