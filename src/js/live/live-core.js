// Modo «sesión en directo» (rc.10): lógica pura (sin interfaz), para la app (ui/live-ui.js) y las pruebas.
//
// Cuándo está activo:
//  - mode 'on' (Siempre activado): siempre. 'off' (Desactivado): nunca.
//  - mode 'auto' (por defecto): mientras algo suena al aire (un deck sonando con el fader y el crossfader abiertos:
//    engine.onAir / app.deckOnAir de rc.9), está activo el Automix, el Autoplay, la grabación o el micrófono, y
//    hasta 2 minutos después de que deje de sonar todo (el final de la sesión).
//  - A mano (botón «EN DIRECTO» de la barra superior): encenderlo lo deja activo hasta que se apague a mano;
//    apagarlo termina la sesión ahora (aunque siga sonando algo) y no vuelve a activarse solo hasta que todo lleve
//    1 minuto parado y algo vuelva a sonar al aire (la próxima sesión).
// Mientras está activo, los avisos que no son urgentes se guardan en una cola y salen al terminar la sesión.
export const END_AFTER_MS = 2 * 60 * 1000;
export const REARM_MS = 60 * 1000;
export const LIVE_MODES = { auto: 'Automático', on: 'Siempre activado', off: 'Desactivado' };

export class LiveState {
  constructor(mode = 'auto') {
    this.mode = LIVE_MODES[mode] ? mode : 'auto';
    this.manual = null;        // null | 'on' | 'off' (lo último que se ha pulsado en el botón)
    this.lastBusyAt = -Infinity;
    this.endAfter = END_AFTER_MS;
    this.active = this.mode === 'on';
    this.since = this.active ? 0 : null;
  }
  setMode(mode) { this.mode = LIVE_MODES[mode] ? mode : 'auto'; this.manual = null; }
  // Botón de la barra superior
  toggle(now) {
    if (this.active) { this.manual = 'off'; this.offAt = now; }
    else { this.manual = 'on'; }
    return this.update({ busy: !!this.lastBusy }, now, true);
  }
  // busy = ¿algo al aire o Automix/Autoplay/REC/micro? → { active, changed, ended, started, reason }
  update({ busy = false } = {}, now = Date.now(), forced = false) {
    this.lastBusy = busy;
    if (busy) this.lastBusyAt = now;
    // el «apagado a mano» dura hasta que no suene nada durante 1 min (la próxima sesión vuelve a activarse sola,
    // cuando algo vuelva a sonar al aire)
    if (this.manual === 'off' && !busy && now - Math.max(this.lastBusyAt, this.offAt ?? -Infinity) >= REARM_MS) { this.manual = null; this.lastBusyAt = -Infinity; }
    let want;
    if (this.mode === 'on') want = this.manual !== 'off';
    else if (this.mode === 'off') want = this.manual === 'on';
    else if (this.manual === 'on') want = true;
    else if (this.manual === 'off') want = false;
    else want = busy || now - this.lastBusyAt < this.endAfter;
    const prev = this.active;
    this.active = want;
    if (want && !prev) this.since = now;
    const reason = !want ? '' : this.mode === 'on' ? 'siempre' : this.manual === 'on' ? 'manual' : busy ? 'sonando' : 'espera';
    const out = { active: want, changed: want !== prev, started: want && !prev, ended: !want && prev, reason, forced };
    if (out.ended) this.since = null;
    return out;
  }
  // ms que quedan para que termine sola la sesión (solo en Automático, cuando ya no suena nada)
  endsIn(now = Date.now()) {
    if (!this.active || this.mode !== 'auto' || this.manual === 'on') return null;
    const left = this.endAfter - (now - this.lastBusyAt);
    return left > 0 && now - this.lastBusyAt > 1000 ? left : null;
  }
}

// Cola de avisos aplazados (sin repetidos por clave). Al terminar la sesión se sacan todos, en orden de llegada
export class NoticeQueue {
  constructor(max = 30) { this.items = []; this.max = max; }
  push(item) {
    if (item.key) this.items = this.items.filter(x => x.key !== item.key);
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
    return this.items.length;
  }
  get size() { return this.items.length; }
  drain() { const out = this.items; this.items = []; return out; }
}

// ¿Qué hacer con un aviso (toast) mientras la sesión está en directo?
//  - 'show': se muestra (avisos críticos y respuestas a lo que acaba de hacer el DJ), en la versión discreta
//  - 'queue': se guarda para el final de la sesión (avisos de fondo: análisis terminado, novedades, envíos…)
// kind: 'critical' | 'bg' | undefined (respuesta a una acción)
export function noticePolicy(active, { kind } = {}) {
  if (!active) return 'show';
  if (kind === 'critical') return 'show';
  if (kind === 'bg') return 'queue';
  // sin clasificar: lo que es un error o un aviso se ve (suele ser la respuesta a lo que se acaba de pulsar)
  return 'show';
}
