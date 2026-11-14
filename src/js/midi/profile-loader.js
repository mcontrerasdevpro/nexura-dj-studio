// Carga y valida perfiles MIDI declarativos servidos como JSON local (src/js/midi/profiles).
// Formato de un perfil incluido (ver profiles/LEEME.md):
//   { id, name, manufacturer, models: [..], match: [regex], source: URL del manual, decks: 2|4,
//     mappings: [{ key: 'n0:11', action: 'deck1.play', kind?: 'button'|'abs'|'rel', enc?, inv?, ticksPerRev? }],
//     leds: [{ key, action, on?, off? }], vu: [{ key: 'c0:2', source: 'deck1'|'masterL'|'masterR', min?, max? }],
//     generic?: true (familia sin controles: solo da nombre), missing: [lo no documentado] }
// key = n (nota) / c (CC) / p (pitch bend) + canal 0-15 + ':' + número decimal (igual que midiKey en midi.js).
const BUILTIN_INDEX = new URL('./profiles/index.json', import.meta.url);
// Pasos del jog de la MC4000 por vuelta: escala de referencia del motor de scratch (deck.jogTurn)
export const REF_TICKS_PER_REV = 605;
export const KEY_RE = /^([ncp])(\d|1[0-5]):(\d{1,3})$/;
export const VU_SOURCES = ['deck1', 'deck2', 'deck3', 'deck4', 'masterL', 'masterR', 'master'];
const KINDS = ['button', 'abs', 'rel'];
const ENCS = ['twos', 'offset', 'sign'];

const validKey = (k) => { const m = KEY_RE.exec(k || ''); return !!m && +m[3] <= 127 && (m[1] !== 'p' || m[3] === '0'); };
const byte = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 127 ? v : d);
// Mensaje que se envía al conectar (p. ej. pedir la posición de los controles): canal de voz de 3 bytes o SysEx
const validInit = (m) => Array.isArray(m) && m.length >= 2 && m.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) &&
  (m[0] === 0xF0 ? m[m.length - 1] === 0xF7 && m.slice(1, -1).every((b) => b < 0x80) : m[0] >= 0x80 && m[0] < 0xF0 && m.length === 3 && m[1] < 0x80 && m[2] < 0x80);

// Errores de formato de un perfil (lista vacía = correcto). actions: acciones de la app para comprobar los nombres
export function profileErrors(raw, actions = null) {
  const err = [];
  if (!raw || typeof raw !== 'object') return ['no es un objeto'];
  if (typeof raw.id !== 'string' || !raw.id) err.push('sin id');
  if (typeof raw.name !== 'string' || !raw.name) err.push('sin nombre');
  if (!Array.isArray(raw.mappings)) err.push('sin mappings');
  for (const s of raw.match || []) { try { new RegExp(s, 'i'); } catch (_) { err.push(`patrón no válido: ${s}`); } }
  const seen = new Set();
  for (const m of raw.mappings || []) {
    const where = `${m && m.key} → ${m && m.action}`;
    if (!m || !validKey(m.key)) { err.push(`clave no válida: ${where}`); continue; }
    if (typeof m.action !== 'string') { err.push(`sin acción: ${where}`); continue; }
    if (seen.has(m.key)) err.push(`clave repetida: ${m.key}`);
    seen.add(m.key);
    if (m.kind && !KINDS.includes(m.kind)) err.push(`tipo no válido: ${where}`);
    if (m.enc && !ENCS.includes(m.enc)) err.push(`codificación no válida: ${where}`);
    if (m.ticksPerRev != null && !(m.ticksPerRev > 0)) err.push(`ticksPerRev no válido: ${where}`);
    if (actions && !actions[m.action]) err.push(`acción desconocida: ${where}`);
    else if (actions && (m.kind || actions[m.action].kind) !== actions[m.action].kind) err.push(`tipo distinto del de la acción: ${where}`);
  }
  for (const l of raw.leds || []) {
    if (!l || !validKey(l.key) || l.key[0] === 'p') err.push(`LED con clave no válida: ${l && l.key}`);
    else if (actions && !(actions[l.action] && actions[l.action].led)) err.push(`LED sin estado: ${l.key} → ${l.action}`);
  }
  for (const msg of raw.init || []) if (!validInit(msg)) err.push(`mensaje de inicio no válido: ${JSON.stringify(msg)}`);
  for (const v of raw.vu || []) {
    if (!v || !validKey(v.key) || v.key[0] === 'p') err.push(`vúmetro con clave no válida: ${v && v.key}`);
    if (v && !VU_SOURCES.includes(v.source)) err.push(`vúmetro con fuente no válida: ${v.key} → ${v.source}`);
  }
  return err;
}

export function normalizeProfile(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.mappings)) return null;
  const mappings = raw.mappings.filter((m) =>
    m && typeof m.key === 'string' && typeof m.action === 'string' && KINDS.includes(m.kind || 'button')
  ).map((m) => {
    const o = { ...(m.options || {}) };
    for (const k of ['enc', 'inv', 'scale']) if (m[k] != null) o[k] = m[k];
    // pasos por vuelta del plato → factor sobre la escala de referencia
    if (m.ticksPerRev > 0 && !(o.scale > 0)) o.scale = Math.round((REF_TICKS_PER_REV / m.ticksPerRev) * 10000) / 10000;
    return { key: m.key, action: m.action, kind: m.kind || 'button', ...o };
  });
  let matchers = [];
  try { matchers = (raw.match || []).map((s) => new RegExp(s, 'i')); } catch (_) { return null; }
  const byKey = new Map(mappings.map((m) => [m.key, m]));
  const leds = (Array.isArray(raw.leds) ? raw.leds : []).filter((l) => l && validKey(l.key) && l.key[0] !== 'p' && typeof l.action === 'string')
    .map((l) => ({ key: l.key, action: l.action, on: byte(l.on, 0x7F), off: byte(l.off, 0) }));
  const vu = (Array.isArray(raw.vu) ? raw.vu : []).filter((v) => v && validKey(v.key) && v.key[0] !== 'p' && VU_SOURCES.includes(v.source))
    .map((v) => ({ key: v.key, source: v.source, min: byte(v.min, 0), max: byte(v.max, 0x7F) }));
  const init = (Array.isArray(raw.init) ? raw.init : []).filter(validInit);
  return { ...raw, mappings, byKey, leds, vu, init, matchers, generic: !!raw.generic || !mappings.length };
}

export class MidiProfileCatalog {
  constructor() { this.profiles = []; this.failed = []; }

  // read(nombre) → objeto JSON del archivo; por defecto, fetch junto a este módulo (en Node se pasa un lector)
  async load(read = null) {
    const get = read || (async (file) => {
      const res = await fetch(file === 'index.json' ? BUILTIN_INDEX : new URL(`./profiles/${encodeURIComponent(file)}`, import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    let files;
    try { files = await get('index.json'); } catch (e) { throw new Error(`No se pudo cargar índice MIDI (${e.message})`); }
    this.failed = [];
    const loaded = await Promise.all(files.map(async (file) => {
      try {
        const p = normalizeProfile(await get(file));
        if (!p) this.failed.push(file);
        return p ? { ...p, file } : null;
      } catch (_) { this.failed.push(file); return null; }
    }));
    this.profiles = loaded.filter(Boolean);
    if (this.failed.length) console.warn('Perfiles MIDI no válidos:', this.failed.join(', '));
    return this.profiles;
  }

  // Perfil de un modelo concreto (con controles); los de familia no cuentan
  match(name) {
    const n = String(name || '');
    return this.profiles.find((profile) => !profile.generic && profile.matchers.some((re) => re.test(n))) || null;
  }

  // Familia (marca) reconocida, aunque no haya perfil del modelo: solo para dar nombre
  genericMatch(name) {
    const n = String(name || '');
    return this.profiles.find((profile) => profile.generic && profile.matchers.some((re) => re.test(n))) || null;
  }

  byId(id) { return this.profiles.find((p) => p.id === id) || null; }
  // Perfiles con controles (lista de Ajustes → MIDI y selector «Perfil»)
  get models() { return this.profiles.filter((p) => !p.generic); }

  // prof: { map, opts, leds } (o un objeto plano {clave: acción} de versiones anteriores)
  exportUserProfile(name, prof, id = '') {
    const safe = String(name || 'Controlador MIDI').trim().slice(0, 80);
    const map = prof && prof.map ? prof.map : (prof || {});
    const opts = (prof && prof.opts) || {};
    return {
      schema: 'nexura-midi-profile', version: 1,
      id: id || `user-${safe.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: safe, match: [],
      mappings: Object.entries(map).map(([key, action]) => ({ key, action, ...(opts[key] || {}) })),
      ...(prof && prof.leds && prof.leds.length ? { leds: prof.leds } : {}),
      ...(prof && prof.ledsOff ? { ledsOff: true } : {})
    };
  }

  validateUserProfile(raw) {
    if (!raw || raw.schema !== 'nexura-midi-profile' || raw.version !== 1 || !Array.isArray(raw.mappings)) return null;
    const p = normalizeProfile(raw);
    return p && p.mappings.length === raw.mappings.length ? p : null;
  }
}
