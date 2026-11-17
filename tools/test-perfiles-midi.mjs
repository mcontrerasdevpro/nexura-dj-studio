// Perfiles MIDI incluidos (src/js/midi/profiles): con el código real de midi.js y profile-loader.js y una app
// simulada que anota cada llamada (decks, mezclador, FX, biblioteca), comprueba para cada perfil que:
// - el JSON carga sin errores (formato, acciones existentes, tipos de control) y cita su fuente;
// - su patrón de nombre reconoce sus modelos y no se solapa con el de otro modelo (ni con la MC4000 nativa);
// - los mensajes de entrada de los controles clave (play, cue, jog, faders, pitch, crossfader) llegan a la
//   acción correcta del deck simulado, y todos los demás hacen algo;
// - el jog usa una codificación relativa declarada (complemento a dos o 64 = centro) y ticksPerRev → escala;
// - las salidas de LED y vúmetros tienen formato MIDI válido (3 bytes, estado de nota/CC, valores 0-127).
// Uso: node tools/test-perfiles-midi.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { getElementById: () => null };
let nowMs = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => nowMs }, configurable: true, writable: true });

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src', 'js', 'midi', 'profiles');
const { buildActions, MidiManager, normalizeDeviceProfile, REL_DECODERS } = await import('../src/js/midi/midi.js');
const { profileErrors, REF_TICKS_PER_REV } = await import('../src/js/midi/profile-loader.js');

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const section = (t) => console.log('\n' + t);

// ---------------------------------------------------------------- app simulada
let log = [];
// objeto que anota cualquier método que se le llame; fields = propiedades fijas
const rec = (name, fields = {}) => new Proxy(fields, {
  get(t, p) {
    if (p in t) return t[p];
    if (typeof p === 'symbol' || p === 'then') return undefined;
    return (...args) => { log.push({ who: name, fn: String(p), args }); return undefined; };
  }
});
const deck = (i) => rec(`deck${i + 1}`, { idx: i, playing: false, track: { cues: [], cueLoops: [] }, padMode: 'hotcue', padBank: 0, sync: false, keylock: false, slip: false, vinyl: true, loop: { on: false }, time: 0, cuePoint: 0, jumpBeats: 4, stemsOn: false, stemGains: [1, 1, 1, 1], stemFx: [], stemSlipHeld: [], padState: () => ({ on: false }) });
const channel = (i) => ({ values: { pfl: false }, set: (k, v) => log.push({ who: `ch${i + 1}`, fn: 'set', args: [k, v] }) });
const fxUnit = (u) => ({ idx: u, slots: [0, 1, 2].map(k => ({ enabled: false, setEnabled: (v) => log.push({ who: `fx${u + 1}`, fn: 'on' + (k + 1), args: [v] }), setParam: (v) => log.push({ who: `fx${u + 1}`, fn: 'param' + (k + 1), args: [v] }) })), setMix: (v) => log.push({ who: `fx${u + 1}`, fn: 'mix', args: [v] }) });
const app = {
  decks: [0, 1, 2, 3].map(deck),
  engine: rec('engine', { channels: [0, 1, 2, 3].map(channel), split: false, recording: false }),
  sampler: rec('sampler', { isPlaying: () => false }),
  libraryUI: rec('library', { sideKey: () => false, current: () => null }),
  library: rec('libraryData'),
  autoplay: rec('autoplay', { enabled: false }),
  fxUnits: [fxUnit(0), fxUnit(1)],
  settings: { quantize: false, midiProfiles: {}, midiBuiltIn: {} },
  setSetting(k, v) { this.settings[k] = v; log.push({ who: 'app', fn: 'setSetting', args: [k] }); },
  emit() {}, focusDeck() {}, toast() {},
  nextEffect: (s) => log.push({ who: 'app', fn: 'nextEffect', args: [] }),
  fxBeats: (u, d) => log.push({ who: 'app', fn: 'fxBeats', args: [d] }),
  fxTargetDeck: () => app.decks[0],
  loadSelected: (i) => log.push({ who: 'app', fn: 'loadSelected', args: [i] }),
  togglePanel: () => log.push({ who: 'app', fn: 'togglePanel', args: [] }),
  toggleRecord: () => log.push({ who: 'app', fn: 'toggleRecord', args: [] }),
  lastMeters: null
};
app.actions = buildActions(app);
const midi = new MidiManager(app);
app.midi = midi;

// ---------------------------------------------------------------- carga
section('Carga de los perfiles');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
ok(onDisk.every(f => index.includes(f)) && index.every(f => onDisk.includes(f)), 'index.json lista exactamente los perfiles de la carpeta', { onDisk, index });
const raw = Object.fromEntries(index.map(f => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));
for (const [f, p] of Object.entries(raw)) {
  const errs = profileErrors(p, app.actions);
  ok(!errs.length, `${f}: formato y acciones correctos`, errs);
  if (!p.generic && p.origin === 'comunidad') {
    // aportado por un usuario con el asistente: lo dice en «//» y en source, sin nombre ni email
    ok(/^comunidad:/.test(p.source || '') && /asistente/.test(p.source) && /aportado por un usuario/i.test(p['//'] || '') && /no sale de documentación del fabricante/i.test(p['//']), `${f}: perfil de la comunidad, lo indica en «//» y en source`, p.source);
    ok(!/@|user-|fran/i.test(JSON.stringify([p['//'], p.source, p.sourceTitle, p.id, p.name])), `${f}: sin datos del usuario que lo aportó`);
    ok(!/mixxx|serato|rekordbox|traktor|virtualdj/i.test(p.source), `${f}: la fuente no es de Mixxx ni de un programa comercial`, p.source);
    ok(Array.isArray(p.models) && p.models.length && Array.isArray(p.missing), `${f}: lista sus modelos y lo que falta`);
  } else if (!p.generic) {
    ok(/^https:\/\//.test(p.source || '') && typeof p['//'] === 'string' && /oficial/.test(p['//']), `${f}: cita la documentación oficial del fabricante`, p.source);
    ok(!/mixxx|serato|rekordbox|traktor|virtualdj/i.test(p.source), `${f}: la fuente no es de Mixxx ni de un programa comercial`, p.source);
    ok(Array.isArray(p.models) && p.models.length && Array.isArray(p.missing), `${f}: lista sus modelos y lo no documentado`);
  }
}
await midi.catalog.load(async (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
ok(midi.catalog.profiles.length === index.length && !midi.catalog.failed.length, `profile-loader carga los ${index.length} perfiles sin fallos`, midi.catalog.failed);
const models = midi.catalog.models;
ok(models.length >= 8, `${models.length} perfiles de modelo (con controles)`, models.map(p => p.id));
const ids = midi.catalog.profiles.map(p => p.id);
ok(new Set(ids).size === ids.length, 'ids únicos', ids);

// ---------------------------------------------------------------- patrones de nombre
section('Reconocimiento por el nombre del puerto');
const variants = (m) => [m, m.toUpperCase(), `MIDIIN2 (${m})`, `${m} MIDI 1`, `Pioneer ${m}`, `Hercules ${m}`, `Reloop ${m}`].filter((v, i, a) => a.indexOf(v) === i);
for (const p of models) {
  for (const m of p.models) for (const name of variants(m)) {
    const hits = models.filter(q => q.matchers.some(re => re.test(name))).map(q => q.id);
    ok(hits.length === 1 && hits[0] === p.id && midi.catalog.match(name)?.id === p.id, `«${name}» → solo ${p.id}`, hits);
  }
  ok(!p.matchers.some(re => re.test('DENON DJ MC4000')), `${p.id} no reconoce la MC4000 (perfil nativo)`);
}
const others = {
  'DENON DJ MC4000': null, 'DDJ-4000': null, 'DDJ-FLX6': null, 'DDJ-SB2': null,
  'DJControl Inpulse 300 MK2': null, 'DJControl Inpulse 200 MK2': null, 'Reloop Mixtour Pro': null, 'Reloop Mixon 8 Pro': null,
  'Numark Mixtrack Pro 3': null, 'Numark Party Mix Live': null, 'Traktor Kontrol S2 MK3': null, 'Arduino Leonardo': null
};
for (const [name, want] of Object.entries(others)) {
  const got = midi.catalog.match(name)?.id || null;
  ok(got === want, `«${name}» → ${want || 'sin perfil de modelo'}`, got);
}
const fam = { 'Numark Mixtrack Pro 3': 'numark-generic', 'Numark Party Mix Live': 'numark-generic', 'DJControl Inpulse 300 MK2': 'hercules-generic', 'Reloop Mixtour Pro': 'reloop-generic', 'Traktor Kontrol S2 MK3': 'native-instruments-generic', 'DDJ-FLX6': 'pioneer-ddj-generic', 'DENON DJ MC7000': 'denon-generic', 'Arduino Leonardo': null };
for (const [name, want] of Object.entries(fam)) ok((midi.catalog.genericMatch(name)?.id || null) === want, `«${name}»: familia ${want || 'ninguna'}`, midi.catalog.genericMatch(name)?.id);

// ---------------------------------------------------------------- entradas → acciones del deck simulado
section('Mensajes de entrada → acciones');
const bytesFor = (key, v) => {
  const [, t, ch, num] = /^([ncp])(\d+):(\d+)$/.exec(key);
  if (t === 'n') return [0x90 | +ch, +num, v ?? 0x7F];
  if (t === 'c') return [0xB0 | +ch, +num, v ?? 0x7F];
  return [0xE0 | +ch, 0, v ?? 0x7F];
};
const FWD = { twos: 0x01, offset: 0x41, sign: 0x01 };
let devN = 0;
function device(p) {
  const id = 'dev' + (++devN), name = p.models[0];
  const sent = [];
  const ds = { id, name, stats: {}, msb: {}, lsb: {}, hires: new Set(), ledCache: new Map(), ledList: null, native: false, builtIn: p, prof: normalizeDeviceProfile(null), output: { send: (b) => sent.push(b) } };
  midi.devState.set(id, ds);
  return { input: { id, name }, ds, sent };
}
const send = (dev, bytes) => { log = []; midi.onMessage(dev.input, bytes); return log; };
for (const p of models) {
  const dev = device(p);
  const map = Object.fromEntries(p.mappings.map(m => [m.action, m]));
  const has = (a) => !!map[a];
  const decks = p.decks === 4 ? [1, 2, 3, 4] : [1, 2];
  for (const d of decks) {
    const di = d - 1, P = `deck${d}.`;
    if (has(P + 'play')) { const l = send(dev, bytesFor(map[P + 'play'].key)); ok(l.some(x => x.who === `deck${d}` && x.fn === 'togglePlay'), `${p.id}: PLAY ${d} → togglePlay del deck ${d}`, l); }
    else ok(p.id === 'reloop-mixtour', `${p.id}: tiene PLAY del deck ${d}`);
    if (has(P + 'cue')) {
      let l = send(dev, bytesFor(map[P + 'cue'].key));
      ok(l.some(x => x.who === `deck${d}` && x.fn === 'cueDown'), `${p.id}: CUE ${d} pulsado → cueDown`, l);
      const off = bytesFor(map[P + 'cue'].key, 0); l = send(dev, off);
      ok(l.some(x => x.who === `deck${d}` && x.fn === 'cueUp'), `${p.id}: CUE ${d} soltado → cueUp`, l);
    }
    const jogs = p.mappings.filter(m => m.action === P + 'jog');
    for (const j of jogs) {
      ok(REL_DECODERS[j.enc], `${p.id}: jog ${d} (${j.key}) declara su codificación relativa`, j.enc);
      const l = send(dev, bytesFor(j.key, FWD[j.enc]));
      const call = l.find(x => x.who === `deck${d}` && x.fn === 'jogTurn');
      const want = (j.inv ? -1 : 1) * (j.scale || 1);
      ok(call && Math.abs(call.args[0] - want) < 1e-9 && call.args[1] === REF_TICKS_PER_REV, `${p.id}: jog ${d} (${j.key}) un paso adelante → jogTurn(${want}, ${REF_TICKS_PER_REV})`, call);
      const back = send(dev, bytesFor(j.key, j.enc === 'offset' ? 0x3F : 0x7F)).find(x => x.fn === 'jogTurn');
      ok(back && back.args[0] < 0 === !j.inv, `${p.id}: jog ${d} (${j.key}) un paso atrás → negativo`, back);
    }
    if (decks.length === 2 || d <= 2) ok(jogs.length || p.id === 'reloop-mixtour', `${p.id}: tiene jog en el deck ${d}`);
    if (has(P + 'jogtouch')) { const l = send(dev, bytesFor(map[P + 'jogtouch'].key)); ok(l.some(x => x.who === `deck${d}` && x.fn === 'jogTouch' && x.args[0] === true), `${p.id}: toque del plato ${d} → jogTouch(true)`, l); }
    if (has(P + 'fader')) {
      const l = send(dev, bytesFor(map[P + 'fader'].key, 64));
      const c = l.find(x => x.who === `ch${d}` && x.args[0] === 'fader');
      ok(c && Math.abs(c.args[1] - 64 / 127) < 1e-6, `${p.id}: fader ${d} a la mitad → canal ${d} fader 0,50`, l);
    } else ok(false, `${p.id}: tiene fader del canal ${d}`);
    if (has(P + 'pitch')) {
      const m = map[P + 'pitch'], key = m.key;
      const l = send(dev, key[0] === 'p' ? [0xE0 | +key.slice(1).split(':')[0], 0x7F, 0x7F] : bytesFor(key, 127));
      const c = l.find(x => x.who === `deck${d}` && x.fn === 'setPitchFader');
      ok(c && Math.abs(Math.abs(c.args[0]) - 1) < 0.01 && (m.inv ? c.args[0] > 0 : c.args[0] < 0), `${p.id}: pitch ${d} al máximo → setPitchFader(${m.inv ? '+1, invertido' : '−1'})`, c);
    }
    for (const k of ['trim', 'high', 'low']) if (has(P + k)) { const l = send(dev, bytesFor(map[P + k].key, 127)); ok(l.some(x => x.who === `ch${d}` && x.args[0] === k && x.args[1] === 1), `${p.id}: ${k} ${d} → canal ${d}`, l); }
  }
  if (has('xfader')) { const l = send(dev, bytesFor(map.xfader.key, 0)); ok(l.some(x => x.who === 'engine' && x.fn === 'setCrossfader' && x.args[0] === 0), `${p.id}: crossfader → setCrossfader`, l); }
  else ok(false, `${p.id}: tiene crossfader`);
  if (has('browse')) { const l = send(dev, bytesFor(map.browse.key, 0x01)); ok(l.some(x => x.who === 'library' && x.fn === 'move' && x.args[0] === 1), `${p.id}: encoder de navegación → biblioteca +1`, l); }
  // todos los demás controles hacen algo (ninguno queda mudo por un error de tipo o de acción)
  const mute = [];
  for (const m of p.mappings) {
    const v = m.kind === 'rel' ? FWD[m.enc || 'twos'] : 0x7F;
    const bytes = m.key[0] === 'p' ? [0xE0 | +m.key.slice(1).split(':')[0], 0, 0x40] : bytesFor(m.key, v);
    if (!send(dev, bytes).length) mute.push(`${m.key} → ${m.action}`);
  }
  ok(!mute.length, `${p.id}: los ${p.mappings.length} controles llegan a una acción`, mute);
  // las asignaciones del usuario mandan sobre el perfil incluido
  const first = p.mappings.find(m => m.kind === 'button');
  dev.ds.prof = normalizeDeviceProfile({ map: { [first.key]: 'record' }, opts: {} });
  const l = send(dev, bytesFor(first.key));
  ok(l.some(x => x.fn === 'toggleRecord') && !l.some(x => x.who.startsWith('deck')), `${p.id}: una asignación propia sustituye al control del perfil`, l);
  dev.ds.prof = normalizeDeviceProfile(null);
}

// ---------------------------------------------------------------- salidas: LEDs y vúmetros
section('Salidas: LEDs y vúmetros');
const validOut = (b) => Array.isArray(b) && b.length === 3 && [0x90, 0xB0].includes(b[0] & 0xF0) && b[1] >= 0 && b[1] <= 127 && b[2] >= 0 && b[2] <= 127;
for (const p of models) {
  const dev = device(p);
  dev.ds.ledList = null;
  const list = midi.buildLedList(dev.ds);
  ok(list.length === p.leds.length, `${p.id}: ${p.leds.length} LEDs en la lista`, list.length);
  ok(list.every(l => validOut([l.st, l.d1, l.on]) && validOut([l.st, l.d1, l.off]) && l.on !== l.off), `${p.id}: LEDs con estado de nota/CC y valores encendido ≠ apagado (0-127)`, list.slice(0, 3));
  // los de la comunidad (asistente) no saben qué notas encienden los LEDs: no se inventan
  if (p.origin !== 'comunidad') {
    for (const a of ['play', 'cue', 'sync']) {
      const want = p.mappings.some(m => m.action === `deck1.${a}`);
      if (want) ok(p.leds.some(l => l.action === `deck1.${a}`), `${p.id}: LED de ${a.toUpperCase()} del deck 1`);
    }
    if (p.mappings.some(m => /^deck1\.pad1$/.test(m.action))) ok(p.leds.some(l => l.action === 'deck1.pad1'), `${p.id}: LED de los pads`);
  } else ok(!p.leds.length && p.missing.some(x => /LED/.test(x)), `${p.id}: sin LEDs inventados (anotado en missing)`);
  // un frame con niveles: los LEDs se envían y los vúmetros reflejan el nivel
  app.lastMeters = { ch: [1, 0.05, 1, 0.05], L: 1, R: 0.0005 };
  app.decks[0].playing = true;
  nowMs += 1000; midi.lastLed = 0;
  dev.sent.length = 0;
  midi.frame();
  ok(dev.sent.length >= list.length && dev.sent.every(validOut), `${p.id}: el primer frame envía ${dev.sent.length} mensajes de salida válidos`, dev.sent.filter(b => !validOut(b)).slice(0, 3));
  const playLed = p.leds.find(l => l.action === 'deck1.play');
  if (playLed) {
    const k = /^([nc])(\d+):(\d+)$/.exec(playLed.key);
    const st = (k[1] === 'n' ? 0x90 : 0xB0) | +k[2];
    ok(dev.sent.some(b => b[0] === st && b[1] === +k[3] && b[2] === (playLed.on ?? 0x7F)), `${p.id}: LED de PLAY 1 encendido con el deck sonando`, playLed);
  }
  if (p.vu.length) {
    const vuOut = (v) => { const k = /^([nc])(\d+):(\d+)$/.exec(v.key); const st = (k[1] === 'n' ? 0x90 : 0xB0) | +k[2]; return dev.sent.filter(b => b[0] === st && b[1] === +k[3]).pop(); };
    const byS = Object.fromEntries(p.vu.map(v => [v.source, vuOut(v)]));
    ok(p.vu.every(v => byS[v.source] && byS[v.source][2] >= v.min && byS[v.source][2] <= v.max), `${p.id}: ${p.vu.length} vúmetros enviados dentro de su rango`, byS);
    if (byS.deck1 && byS.deck2) ok(byS.deck1[2] > byS.deck2[2], `${p.id}: vúmetro del deck 1 (nivel alto) > deck 2 (bajo)`, byS);
    // 0 dBFS = 94 % de la escala (el mezclador llega hasta +3 dB)
    if (byS.masterL && byS.masterR) ok(byS.masterL[2] >= 0.9 * p.vu.find(v => v.source === 'masterL').max && byS.masterR[2] <= 0x10, `${p.id}: vúmetro master L a 0 dBFS (casi arriba) y R casi apagado`, byS);
  }
  app.decks[0].playing = false;
  midi.devState.delete(dev.input.id);
}
ok(MidiManager.vuValue(0) === 0 && MidiManager.vuValue(1) > 0x70 && MidiManager.vuValue(1.5) === 0x7F && MidiManager.vuValue(0.5, 0, 100) <= 100, 'escala de vúmetro: silencio 0, 0 dBFS casi al máximo y sin pasarse del rango');

// ---------------------------------------------------------------- THE NEXT BEAT (perfil de la comunidad)
section('THE NEXT BEAT (aportado por un usuario con el asistente)');
{
  const tnb = models.find(p => p.id === 'the-next-beat');
  ok(!!tnb && tnb.origin === 'comunidad', 'perfil incluido the-next-beat con procedencia «comunidad»');
  for (const name of ['THE NEXT BEAT', 'THE NEXT BEAT In', 'The Next Beat', 'MIDIIN2 (THE NEXT BEAT)', 'THE NEXT BEAT MIDI 1', 'TheNextBeat', 'THE-NEXT-BEAT']) {
    const hits = models.filter(q => q.matchers.some(re => re.test(name))).map(q => q.id);
    ok(hits.length === 1 && hits[0] === 'the-next-beat', `«${name}» → solo the-next-beat`, hits);
  }
  ok(!models.filter(q => q.id !== 'the-next-beat').some(q => q.matchers.some(re => re.test('THE NEXT BEAT'))), 'ningún otro perfil reconoce «THE NEXT BEAT»');
  ok(tnb.mappings.length === 59 && new Set(tnb.mappings.map(m => m.key)).size === 59, 'conserva los 59 controles que configuró el usuario');
  const dev = device(tnb);
  const go = (bytes) => send(dev, bytes);
  ok(go([0x90, 0, 0x7F]).some(x => x.who === 'deck1' && x.fn === 'togglePlay') && go([0x91, 0, 0x7F]).some(x => x.who === 'deck2' && x.fn === 'togglePlay'), 'PLAY: nota 0 en el canal 1 → deck 1 y en el canal 2 → deck 2');
  ok(go([0x90, 1, 0x7F]).some(x => x.who === 'deck1' && x.fn === 'cueDown') && go([0x80, 1, 0]).some(x => x.who === 'deck1' && x.fn === 'cueUp'), 'CUE 1: pulsar → cueDown; soltar (Note Off) → cueUp');
  ok(go([0x91, 1, 0x7F]).some(x => x.who === 'deck2' && x.fn === 'cueDown'), 'CUE 2 → cueDown del deck 2');
  let j = go([0xB0, 6, 0x01]).find(x => x.who === 'deck1' && x.fn === 'jogTurn');
  ok(j && Math.abs(j.args[0] - 3.288) < 1e-9 && j.args[1] === REF_TICKS_PER_REV, 'jog 1 (CC 6, complemento a dos) un paso adelante → jogTurn(+3,288)', j);
  j = go([0xB0, 6, 0x7F]).find(x => x.fn === 'jogTurn');
  ok(j && Math.abs(j.args[0] + 3.288) < 1e-9, 'jog 1 un paso atrás → jogTurn(−3,288)', j);
  j = go([0xB1, 6, 0x02]).find(x => x.who === 'deck2' && x.fn === 'jogTurn');
  ok(j && Math.abs(j.args[0] - 2 * 3.3425) < 1e-9, 'jog 2 (calibrado por el usuario) dos pasos → jogTurn(+6,685)', j);
  ok(go([0x90, 6, 0x7F]).some(x => x.who === 'deck1' && x.fn === 'jogTouch' && x.args[0] === true), 'tocar el plato 1 → jogTouch(true)');
  const p1 = go([0xB0, 10, 127]).find(x => x.who === 'deck1' && x.fn === 'setPitchFader');
  ok(p1 && p1.args[0] > 0.99, 'pitch 1 invertido, como lo dejó el usuario', p1);
  midi.devState.delete(dev.input.id);
}

// ---------------------------------------------------------------- tipo de perfil por dispositivo
section('Tipo de perfil');
const info = (n) => midi.profileInfo(n).type;
ok(info('DENON DJ MC4000') === 'incluido', 'MC4000 → incluido (nativo)');
ok(info('DDJ-FLX4') === 'incluido' && midi.profileInfo('DDJ-FLX4').model === 'Pioneer DJ DDJ-FLX4', 'DDJ-FLX4 → incluido: Pioneer DJ DDJ-FLX4');
ok(info('Numark Mixtrack Pro 3') === 'ninguno' && midi.profileInfo('Numark Mixtrack Pro 3').family === 'Numark', 'Mixtrack Pro 3 → ninguno (marca Numark)');
app.settings.midiProfiles = { 'Numark Mixtrack Pro 3': { map: { 'n0:1': 'deck1.play' }, source: 'mixxx' }, 'Mi mesa': { map: { 'n0:1': 'deck1.play' }, source: 'asistente' } };
ok(info('Numark Mixtrack Pro 3') === 'importado' && info('Mi mesa') === 'asistente', 'con mapeo de Mixxx → importado; con el asistente → asistente');
app.settings.midiBuiltIn = { 'DDJ-FLX4': 'none', 'Mi mesa': 'pioneer-ddj-400' };
ok(info('DDJ-FLX4') === 'ninguno' && midi.profileInfo('Mi mesa').model === 'Pioneer DJ DDJ-400', 'perfil elegido a mano: «Ninguno» o otro modelo incluido');

console.log(`\n${pass}/${pass + fail} comprobaciones de los perfiles MIDI correctas`);
process.exit(fail ? 1 : 0);
