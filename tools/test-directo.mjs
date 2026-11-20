// Encargo DIRECTO (1.0.0-rc.10), lógica sin interfaz:
// - Modo sesión en directo (src/js/live/live-core.js): cuándo se activa y termina, a mano, Siempre/Desactivado y
//   la cola de avisos aplazados.
// - Recuperación (src/js/live/session-core.js): instantánea, cierre limpio, < 24 h, plan con pistas que ya no están.
// - Medidor de carga (src/js/live/load-core.js): carga del worklet, cortes por el reloj de audio, «al límite» y vuelta.
// - Proceso principal (main/live-main.js): confirmación al cerrar con música; recarga tras caída o cuelgue.
// - Actualizador (main/updater.js): no descarga ni instala durante la sesión.
// - Informe (main/report.js): latencia, carga máxima y cortes en el diagnóstico.
// Uso: node tools/test-directo.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const imp = (p) => import(pathToFileURL(path.join(root, p)));
const { LiveState, NoticeQueue, noticePolicy, END_AFTER_MS } = await imp('src/js/live/live-core.js');
const S = await imp('src/js/live/session-core.js');
const { LoadMeter, LATENCY, latencyHintFor, realLatencyMs } = await imp('src/js/live/load-core.js');
const { createLiveGuard, createCrashGuard, CLOSE_MSG } = require(path.join(root, 'main/live-main.js'));
const { createUpdater } = require(path.join(root, 'main/updater.js'));
const report = require(path.join(root, 'main/report.js'));

let failed = 0, total = 0;
const check = (name, ok, data) => { total++; if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && data !== undefined ? ' ' + JSON.stringify(data) : ''}`); };

// ------------------------------------------------------------------ modo sesión en directo
{
  const s = new LiveState('auto');
  let t = 1000;
  check('Automático: sin nada sonando, apagado', !s.update({ busy: false }, t).active);
  let r = s.update({ busy: true }, t += 500);
  check('Automático: un deck al aire → empieza la sesión', r.active && r.started && r.reason === 'sonando', r);
  r = s.update({ busy: false }, t += 60000);
  check('Deja de sonar: sigue 2 min (no se cierra al pasar de un tema a otro)', r.active && !r.ended && s.endsIn(t) > 50000, { r, left: s.endsIn(t) });
  r = s.update({ busy: true }, t += 30000);
  r = s.update({ busy: false }, t += END_AFTER_MS - 1);
  check('Vuelve a sonar antes de 2 min: la cuenta empieza de nuevo', r.active, r);
  r = s.update({ busy: false }, t += 2);
  check('2 min sin nada al aire → termina la sesión (ended)', !r.active && r.ended, r);
  // a mano
  r = s.toggle(t += 1000);
  check('Botón: activar a mano sin música', r.active && s.manual === 'on', r);
  r = s.update({ busy: false }, t += END_AFTER_MS * 3);
  check('Activado a mano: no termina solo', r.active);
  r = s.toggle(t += 1000);
  check('Botón: desactivar a mano → termina ya', !r.active && r.ended, r);
  r = s.update({ busy: true }, t += 1000);
  check('Desactivado a mano con música: no se vuelve a activar en esta sesión', !r.active, r);
  r = s.update({ busy: false }, t += 1000);
  r = s.update({ busy: true }, t += 1000);
  check('…ni si se para un momento y vuelve a sonar', !r.active, r);
  r = s.update({ busy: false }, t += 1000);
  r = s.update({ busy: false }, t += 61000);
  check('Tras 1 min sin nada al aire no se activa sola (espera a que suene algo)', !r.active, r);
  r = s.update({ busy: true }, t += 1000);
  check('…y sí en la siguiente sesión, al sonar algo al aire', r.active && r.started, r);
  const on2 = new LiveState('on'); on2.update({ busy: false }, 1);
  check('Siempre activado: el botón también la apaga', !on2.toggle(2).active);
  const on = new LiveState('on');
  check('Siempre activado: activo sin música', on.update({ busy: false }, 5).active);
  const off = new LiveState('off');
  check('Desactivado: nunca se activa solo', !off.update({ busy: true }, 5).active);
  check('Desactivado: pero el botón lo activa a mano', off.toggle(6).active);
  const st = new LiveState('auto'); st.endAfter = 1000;
  st.update({ busy: true }, 0);
  check('endAfter configurable (pruebas de interfaz)', st.update({ busy: false }, 500).active && !st.update({ busy: false }, 1600).active);
  // cola
  const q = new NoticeQueue(3);
  q.push({ key: 'a', n: 1 }); q.push({ key: 'b' }); q.push({ key: 'a', n: 2 });
  check('Cola: sin repetidos (gana el último)', q.size === 2 && q.items[1].n === 2, q.items);
  q.push({ key: 'c' }); q.push({ key: 'd' });
  check('Cola: como mucho N avisos', q.size === 3);
  check('Cola: drain saca todo y la vacía', q.drain().length === 3 && q.size === 0);
  check('Política: fuera de la sesión, todo se ve', noticePolicy(false, { kind: 'bg' }) === 'show');
  check('Política: en directo, lo de fondo se aplaza', noticePolicy(true, { kind: 'bg' }) === 'queue');
  check('Política: en directo, lo crítico y las respuestas a acciones se ven', noticePolicy(true, { kind: 'critical' }) === 'show' && noticePolicy(true, {}) === 'show');
}

// ------------------------------------------------------------------ recuperación
{
  const deck = (id, extra = {}) => ({ track: id ? { id, source: 'local' } : null, time: 61.23456, playing: true, pitch: 0.25, range: 0.08, tempo: 1.02, keylock: true, sync: false, cuePoint: 12.5, loop: { on: true, s: 64, e: 66 }, isYT: false, ...extra });
  const app = { decks: [deck('a'), deck('b', { sync: true, loop: { on: false } }), deck(null), deck(null)], deckCount: 2, engine: { channels: [{ values: { fader: 0.8, trim: 0.5, high: 0.4, mid: 0.5, low: 0.1, filter: 0.6 } }, { values: { fader: 0.2 } }], xfValue: 0.3 }, settings: { quantize: true }, screenView: 'lib' };
  app.syncMaster = app.decks[0];
  const s = S.buildSnapshot(app, 1000);
  check('Instantánea: id, posición, play, pitch, key lock, sync, master, loop y quantize por deck', s.decks[0].id === 'a' && s.decks[0].pos === 61.235 && s.decks[0].playing && s.decks[0].pitch === 0.25 && s.decks[0].keylock && s.decks[0].master && s.decks[0].loop.s === 64 && s.decks[0].quantize && s.decks[1].sync && !s.decks[1].loop, s.decks);
  check('Instantánea: decks vacíos = null', s.decks[2] === null && s.decks[3] === null);
  check('Instantánea: mezcla (faders, EQ, filtro, crossfader) y vista', s.mixer.ch[0].low === 0.1 && s.mixer.ch[0].filter === 0.6 && s.mixer.ch[1].fader === 0.2 && s.mixer.xf === 0.3 && s.view === 'lib', s.mixer);
  check('Instantánea: sin rutas de archivos', !JSON.stringify(s).includes('path'));
  const k1 = S.snapshotKey(s);
  app.decks[0].time = 70;
  check('La firma no cambia solo con la posición (se guarda cada 2 s)', S.snapshotKey(S.buildSnapshot(app, 2000)) === k1);
  app.decks[0].playing = false;
  check('…y sí al pausar (se guarda enseguida)', S.snapshotKey(S.buildSnapshot(app, 2000)) !== k1);
  check('Cierre limpio → no se ofrece', !S.shouldOffer({ ...s, clean: true }, 2000).offer);
  const o = S.shouldOffer(s, 1000 + 5 * 60000);
  check('Sin la marca y reciente → se ofrece (hace 5 min, 2 decks)', o.offer && o.ageMin === 5 && o.loaded === 2, o);
  check('Más de 24 h → no se ofrece', !S.shouldOffer(s, 1000 + 25 * 3600000).offer);
  check('Sin temas cargados → no se ofrece', !S.shouldOffer({ ...s, decks: [null, null] }, 2000).offer);
  check('Sin instantánea o de otra versión → no se ofrece', !S.shouldOffer(null).offer && !S.shouldOffer({ ...s, v: 99 }).offer);
  const lib = { a: { id: 'a', source: 'local' }, y: { id: 'y', source: 'youtube' } };
  const snap = { ...s, decks: [s.decks[0], { ...s.decks[1], id: 'borrada' }, { ...s.decks[0], id: 'y', yt: true }, null] };
  const plan = S.planRestore(snap, (id) => lib[id] || null);
  check('Plan: la que existe ok, la borrada «missing», la de YouTube indicada', plan.length === 3 && plan[0].status === 'ok' && plan[1].status === 'missing' && plan[2].status === 'youtube', plan.map(p => p.status));
  const txt = S.describePlan(plan);
  check(`Resumen del aviso: «${txt}»`, /2 temas en los decks 1 y 3/.test(txt) && /1 tema ya no está en la biblioteca \(deck 2\)/.test(txt), txt);
}

// ------------------------------------------------------------------ medidor de carga y cortes
{
  const m = new LoadMeter();
  let t = 0;
  m.deckReport(0, 50, 500, t); m.deckReport(1, 60, 500, t);
  m.tick(t);
  check(`Carga = suma de los decks (10 % + 12 % = ${Math.round(m.load * 100)} %), verde`, Math.round(m.load * 100) === 22 && m.level(t) === 'green', m.load);
  for (let i = 0; i < 12; i++) { t += 500; m.deckReport(0, 200, 500, t); m.deckReport(1, 190, 500, t); m.tick(t); }
  check(`Carga alta sostenida (${Math.round(m.load * 100)} %): roja y «al límite» tras 2 s`, m.level(t) === 'red' && m.overloaded, { load: m.load, over: m.overloaded });
  check('Pico guardado', m.peak > 0.75);
  for (let i = 0; i < 20; i++) { t += 500; m.deckReport(0, 150, 500, t); m.deckReport(1, 150, 500, t); m.tick(t); }
  check(`Entre 55 y 70 % (${Math.round(m.load * 100)} %): ámbar y sigue al límite (la vuelta pide < 55 %)`, m.level(t) === 'amber' && m.overloaded);
  let changed = null;
  for (let i = 0; i < 40; i++) { t += 500; m.deckReport(0, 40, 500, t); m.deckReport(1, 40, 500, t); const r = m.tick(t); if (r.changed) changed = { i, over: r.overloaded }; }
  check('Pasa el pico: vuelve a la normalidad tras 15 s tranquilo', !m.overloaded && changed && !changed.over && changed.i >= 28, changed);
  check('Informes de un deck de hace más de 2 s no cuentan', new LoadMeter().instant(5000) === 0);
  // cortes: el reloj de audio se queda atrás
  const g = new LoadMeter();
  let ctx = 0, perf = 1000; const now0 = 1e6;
  for (let i = 0; i < 20; i++) { ctx += 500; perf += 500; g.clockPair(ctx, perf + (i % 3) * 3, now0 + i * 500, 10); }
  check('Vaivén normal del reloj (±6 ms): sin cortes', g.glitches.length === 0, g.glitches);
  ctx += 500; perf += 540;
  const g1 = g.clockPair(ctx, perf, now0 + 10500, 10);
  ctx += 500; perf += 500;
  const gl = g.clockPair(ctx, perf, now0 + 11000, 10);
  check(`Audio 40 ms tarde (y sigue tarde en la muestra siguiente): corte detectado (${gl} ms)`, g1 === null && gl >= 30 && g.glitches.length === 1, { g1, gl });
  { const h = new LoadMeter(); let c = 0, p = 0; for (let i = 0; i < 10; i++) { c += 500; p += 500; h.clockPair(c, p, i, 10); } h.clockPair(c + 500, p + 560, 11, 10); h.clockPair(c + 1000, p + 1000, 12, 10);
    check('Una marca de tiempo suelta que llega tarde (y la siguiente no) no es un corte', h.glitches.length === 0, h.glitches); }
  { const h = new LoadMeter(); h.clockPair(0, 0, 0, 10); h.clockPair(500, 560, 1, 10); h.clockPair(1000, 1060, 2, 10);
    check('Al arrancar el audio (3 s) los saltos del reloj no cuentan', h.glitches.length === 0); }
  for (let i = 0; i < 5; i++) { ctx += 500; perf += 500; g.clockPair(ctx, perf, now0 + 11000 + i * 500, 10); }
  check('Tras el corte, el reloj sigue estable: no cuenta más cortes', g.glitches.length === 1);
  const r = g.tick(now0 + 13000);
  check('Un corte reciente → «al límite» al momento y nivel rojo', r.overloaded && r.level === 'red' && r.changed, r);
  ctx += 500; perf += 520;
  check('Con búfer grande (45 ms, Segura) un retraso de 20 ms no es corte', g.clockPair(ctx, perf, now0 + 14000, 45) === null);
  const u = new LoadMeter(); u.underruns(3, 1); u.underruns(5, 2);
  check('Estadísticas del navegador (underrunEvents): 2 cortes nuevos', u.glitches.length === 2);
  const snap = g.snapshot(now0 + 20000);
  check('Diagnóstico: carga, pico, número de cortes y cuándo', snap.glitches === 1 && snap.glitchTimes.length === 1 && snap.glitchTimes[0].ms >= 30 && snap.events.length === 1 && snap.events[0].cause === 'cortes', snap);
  check('Latencia: tres opciones (Baja interactive · Equilibrada 20 ms · Segura 45 ms)', latencyHintFor('low') === 'interactive' && latencyHintFor('normal') === 0.02 && latencyHintFor('safe') === 0.045 && latencyHintFor('x') === 0.02 && Object.keys(LATENCY).length === 3);
  check('Latencia real = baseLatency + outputLatency (ms)', realLatencyMs({ baseLatency: 0.01, outputLatency: 0.0213 }) === 31.3);
}

// ------------------------------------------------------------------ proceso principal
{
  const asked = [];
  const dialog = { showMessageBox: async (_w, o) => { asked.push(o); return { response: dialog.answer }; }, answer: 0 };
  const g = createLiveGuard({ dialog });
  check('Cerrar sin música: sin preguntar', await g.confirmClose(null) === true && asked.length === 0);
  g.setState({ playing: true, live: true });
  dialog.answer = 0;
  check(`Cerrar con música: pregunta «${CLOSE_MSG}» y «Seguir pinchando» no cierra`, await g.confirmClose(null) === false && asked[0].message === CLOSE_MSG && asked[0].buttons[0] === 'Seguir pinchando');
  dialog.answer = 1;
  check('…«Cerrar» cierra', await g.confirmClose(null) === true);
  // caídas y cuelgues
  let reloads = 0, crashes = 0, errors = 0, now = 0; const timers = [];
  const cg = createCrashGuard({ reload: () => reloads++, crash: () => crashes++, showError: () => errors++, now: () => now, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
  check('Interfaz caída (crashed) → se recarga', cg.gone({ reason: 'crashed', exitCode: 1 }) === 'reload' && reloads === 1);
  check('Cierre normal (clean-exit) o la app cerrándose → nada', cg.gone({ reason: 'clean-exit' }) === 'ignored' && cg.gone({ reason: 'killed' }, true) === 'ignored' && reloads === 1);
  cg.unresponsive();
  check('No responde: espera 10 s antes de hacer nada', timers.length === 1 && timers[0].ms === 10000 && crashes === 0);
  check('Vuelve a responder antes: no se toca', cg.responsive() === 'recovered' && timers.length === 0);
  cg.unresponsive(); timers[0].fn();
  check('Sigue colgada a los 10 s: se cierra a la fuerza (y luego se recarga)', crashes === 1);
  now = 1000; cg.gone({ reason: 'killed' }); now = 2000; cg.gone({ reason: 'oom' });
  check('Más de 3 caídas en un minuto: deja de recargar y avisa una vez', cg.gone({ reason: 'crashed' }) === 'gave-up' && errors === 1 && cg.gone({ reason: 'crashed' }) === 'gave-up' && errors === 1, { reloads, errors });
}

// ------------------------------------------------------------------ actualizador en directo
{
  const ev = {};
  const au = { on: (k, f) => { ev[k] = f; }, checkForUpdates: async () => { ev['update-available']({ version: '9.0.0' }); }, downloadUpdate: async () => { au.downloads = (au.downloads || 0) + 1; }, quitAndInstall: () => { au.installs = (au.installs || 0) + 1; } };
  const sent = [];
  const up = createUpdater({ autoUpdater: au, version: '1.0.0-rc.10', send: (e) => sent.push(e), setTimer: (fn) => fn(), setRepeat: () => 0 });
  up.setLive(true);
  await up.check(false);
  check('En directo: se sigue comprobando en silencio', up.status().state === 'available' && up.status().version === '9.0.0');
  check('En directo: no descarga', await up.download() === false && !au.downloads);
  up.setLive(false);
  check('Fin de la sesión: ya descarga', await up.download() === true && au.downloads === 1);
  await ev['update-downloaded']({ version: '9.0.0' });
  up.setLive(true);
  check('En directo: no instala', await up.install() === false && !au.installs);
  up.setLive(false);
  check('Fin de la sesión: ya instala', await up.install() === true && au.installs === 1);
}

// ------------------------------------------------------------------ informe
{
  const p = report.perfInfo ? report.perfInfo({ system: {}, app: { audio: { latency: 'safe', realMs: 52.3, sampleRate: 48000, live: true, load: { loadPct: 41, peakPct: 83, peakMinAgo: 2.5, glitches: 2, glitchesLastMin: 1, glitchTimes: [{ minAgo: 3, ms: 40 }, { minAgo: 0.5, ms: null }], events: [{ minAgo: 3, on: true, load: 83, cause: 'cortes' }] } } } }) : null;
  const lines = p && report.perfText ? report.perfText(p) : [];
  const txt = lines.join('\n');
  check('Informe: latencia elegida y real, carga máxima y cortes con cuándo', /latencia Segura · real 52\.3 ms/.test(txt) && /máxima 83 %/.test(txt) && /cortes detectados: 2 \(hace 3 min, 40 ms · hace 0\.5 min\)/.test(txt) && /al límite hace 3 min \(cortes, 83 %\)/.test(txt), lines.slice(-3));
}

console.log(`\n${total - failed}/${total} comprobaciones del encargo DIRECTO correctas`);
process.exit(failed ? 1 : 0);
