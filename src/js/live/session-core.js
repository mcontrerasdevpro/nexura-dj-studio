// Recuperación tras un cierre inesperado (rc.10): lógica pura (sin interfaz).
//
// La app guarda cada ~2 s, y al cargar, dar a play o pausa o cambiar cue, loop o sync, una instantánea ligera de
// la sesión (data/sesion.json, escritura atómica en el proceso principal): por deck, la pista (su id, no la ruta),
// posición, play/pausa, pitch, key lock, sync, master, loop y quantize; los volúmenes de la mezcla (faders,
// crossfader, EQ y filtro) y la vista. Al salir bien se marca «cierre limpio» (clean: true).
// Al arrancar, si la marca no está y la instantánea es de menos de 24 h con algún tema cargado, la app se cerró de
// golpe: se ofrece recuperarla (los mismos temas, en sus decks, en su posición y SIEMPRE EN PAUSA).
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_MAX_AGE = 24 * 60 * 60 * 1000;
export const SNAPSHOT_EVERY_MS = 2000;

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const r3 = (v) => Math.round(num(v) * 1000) / 1000;

// Estado de un deck (objeto Deck de la app o uno con la misma forma) → lo que se guarda
export function deckSnapshot(d, { master = false, quantize = true } = {}) {
  if (!d || !d.track) return null;
  return {
    id: String(d.track.id), yt: !!d.isYT, pos: r3(d.time), playing: !!d.playing,
    pitch: r3(d.pitch), range: num(d.range, 0.08), tempo: Math.round(num(d.tempo, 1) * 1e5) / 1e5,
    keylock: !!d.keylock, sync: !!d.sync, master: !!master, cue: r3(d.cuePoint),
    loop: d.loop && d.loop.on ? { s: r3(d.loop.s), e: r3(d.loop.e) } : null, quantize: !!quantize
  };
}

// Instantánea completa. app-ish: { decks, deckCount, engine: { channels, xfValue }, settings, screenView, syncMaster }
export function buildSnapshot(app, now = Date.now()) {
  const q = app.settings ? app.settings.quantize !== false : true;
  const master = app.syncMaster || null;
  return {
    v: SNAPSHOT_VERSION, at: now, clean: false,
    decks: (app.decks || []).map(d => deckSnapshot(d, { master: d === master, quantize: q })),
    deckCount: app.deckCount === 4 ? 4 : 2,
    mixer: app.engine ? {
      ch: (app.engine.channels || []).map(c => {
        const v = c.values || {};
        return { fader: num(v.fader, 1), trim: num(v.trim, 0.5), high: num(v.high, 0.5), mid: num(v.mid, 0.5), low: num(v.low, 0.5), filter: num(v.filter, 0.5) };
      }),
      xf: num(app.engine.xfValue, 0.5)
    } : null,
    view: app.screenView === 'lib' ? 'lib' : 'mix'
  };
}

// Firma de lo importante (para guardar enseguida si cambia: carga, play/pausa, cue, loop, sync…; la posición no)
export function snapshotKey(s) {
  if (!s) return '';
  return JSON.stringify((s.decks || []).map(d => d && [d.id, d.playing, d.cue, d.loop, d.sync, d.master, d.keylock, d.quantize]));
}

// ¿Hay que ofrecer la recuperación? → { offer, reason, loaded, ageMin }
export function shouldOffer(s, now = Date.now()) {
  if (!s || typeof s !== 'object' || s.v !== SNAPSHOT_VERSION) return { offer: false, reason: 'sin-instantanea' };
  if (s.clean) return { offer: false, reason: 'cierre-limpio' };
  const age = now - num(s.at, 0);
  if (!(age >= 0) || age > SNAPSHOT_MAX_AGE) return { offer: false, reason: 'antigua' };
  const loaded = (s.decks || []).filter(Boolean).length;
  if (!loaded) return { offer: false, reason: 'sin-temas' };
  return { offer: true, reason: 'cierre-inesperado', loaded, ageMin: Math.round(age / 60000) };
}

// Plan de recuperación: por deck { idx, id, status: 'ok' | 'youtube' | 'missing', track, state }.
// lookup(id) → pista de la biblioteca (o null). Las de YouTube se cargan si siguen en la biblioteca (en pausa y en su
// sitio, si el reproductor lo permite) y se indica que se vuelven a cargar desde internet; las que ya no existen
// se indican y el resto se recupera igual.
export function planRestore(s, lookup) {
  const out = [];
  (s && s.decks || []).forEach((d, idx) => {
    if (!d) return;
    const t = lookup(d.id);
    let status = 'ok';
    if (!t) status = 'missing';
    else if (d.yt || t.source === 'youtube') status = 'youtube';
    out.push({ idx, id: d.id, status, track: t || null, state: d });
  });
  return out;
}

// Resumen para el aviso: «2 temas en los decks 1 y 2» / «1 tema ya no está en la biblioteca»
export function describePlan(plan) {
  const ok = plan.filter(p => p.status !== 'missing'), lost = plan.filter(p => p.status === 'missing');
  const decks = (l) => l.map(p => p.idx + 1).join(l.length === 2 ? ' y ' : ', ').replace(/, (\d)$/, ' y $1');
  const parts = [];
  if (ok.length) parts.push(`${ok.length === 1 ? '1 tema' : ok.length + ' temas'} en ${ok.length === 1 ? 'el deck' : 'los decks'} ${decks(ok)}`);
  if (lost.length) parts.push(`${lost.length === 1 ? '1 tema ya no está' : lost.length + ' temas ya no están'} en la biblioteca (deck ${decks(lost)})`);
  return parts.join(' · ');
}
