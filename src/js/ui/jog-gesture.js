// Gestos del ratón sobre el plato y la forma de onda de detalle (sin DOM: deck-ui.js y waveform.js les pasan
// las coordenadas, y tools/test-plato.mjs los prueba con el deck y el worklet reales).
// - Un clic sin arrastrar no mueve la reproducción: el plato no se «toca» (scratch) hasta pasar la zona muerta.
// - En el plato cuenta la distancia recorrida en tangente, no el ángulo: cerca del centro un par de píxeles
//   eran media vuelta (0,9 s, casi 2 beats a 125 BPM).
// - Rueda: parado, 1/16 de beat como mucho; sonando, un nudge de ~15 ms (20 ms como mucho).
import { clamp } from '../util.js';

export const DEAD_ZONE_PX = 3;
export const PLATTER_SENS = { low: 0.5, normal: 1, high: 1.6 };
const REF_TICKS = 605;               // ticks por vuelta con los que trabaja Deck.jogTurn
const WHEEL_NUDGE_SEC = 0.015, WHEEL_NUDGE_MAX = 0.02;

// factor del ajuste «Sensibilidad del plato y de la onda»
export function platterSens(app) { return PLATTER_SENS[app?.settings?.platterSensitivity] ?? 1; }

// Plato en pantalla: p = { x, y, cx, cy, R } (puntero, centro y radio del plato, en px CSS)
export class PlatterGesture {
  constructor(deck, app) { this.deck = deck; this.app = app; this.down = false; this.armed = false; this.last = null; this.start = null; }
  press(p) {
    if (!this.deck.track) return;
    this.down = true; this.armed = false; this.start = p; this.last = p;
  }
  move(p) {
    if (!this.down) return;
    const d = this.deck;
    if (!this.armed) {
      if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < DEAD_ZONE_PX) return;
      // fuera de la zona muerta: ahora sí se toca el plato (scratch en VINYL); se cuenta desde aquí, sin salto
      this.armed = true; this.last = p;
      d.jogTouch(true);
      return;
    }
    const ax = this.last.x - p.cx, ay = this.last.y - p.cy, bx = p.x - p.cx, by = p.y - p.cy;
    const ra = Math.hypot(ax, ay), rb = Math.hypot(bx, by);
    this.last = p;
    if (ra < 1e-6 || rb < 1e-6) return;
    // desplazamiento en tangente (px): ángulo × radio, con el radio limitado al del plato
    let da = Math.atan2(by, bx) - Math.atan2(ay, ax);
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    const tang = da * Math.min((ra + rb) / 2, p.R);
    const revs = tang / (2 * Math.PI * p.R) * platterSens(this.app);
    if (revs) d.jogTurn(revs * REF_TICKS, REF_TICKS);
  }
  release() {
    if (!this.down) return;
    this.down = false;
    if (this.armed) this.deck.jogTouch(false);
    this.armed = false;
  }
  // un paso de rueda (dir = +1 adelante, −1 atrás)
  wheel(dir) {
    const d = this.deck;
    if (!d.track || !dir) return;
    const s = platterSens(this.app);
    if (d.isYT) { if (!d.playing) d.seek(d.time + dir * 0.03 * Math.min(1, s)); return; }
    if (d.playing) d.nudgeBy(dir * Math.min(WHEEL_NUDGE_MAX, WHEEL_NUDGE_SEC * s));
    else d.seek(d.time + dir * (d.beatLen ? d.beatLen / 16 : 0.03) * Math.min(1, s));
  }
}

// Rueda del ratón: un paso por cada «clic» de la rueda (100 px en Chrome); los paneles táctiles mandan
// muchos eventos pequeños, que se acumulan
export class WheelSteps {
  constructor() { this.acc = 0; }
  push(e) {
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.acc += dy;
    if (Math.abs(this.acc) < 50) return 0;
    const dir = this.acc < 0 ? 1 : -1; // rueda hacia arriba = adelante
    this.acc = 0;
    return dir;
  }
}

// Forma de onda de detalle: x en px CSS; secPerPx = segundos de pista por píxel con el zoom actual
export class WaveGesture {
  constructor(deck, app) { this.deck = deck; this.app = app; this.dragging = false; this.armed = false; this.x0 = 0; this.lastX = 0; }
  press(x) {
    if (!this.deck.track) return;
    this.dragging = true; this.armed = false; this.x0 = x; this.lastX = x;
  }
  move(x, secPerPx) {
    if (!this.dragging) return;
    const d = this.deck;
    if (!this.armed) {
      if (Math.abs(x - this.x0) < DEAD_ZONE_PX) return;
      this.armed = true; this.lastX = x;
      // sonando: scratch temporal en modo vinilo mientras se arrastra
      if (d.playing) { d.vinylTemp = d.vinyl; d.vinyl = true; d.jogTouch(true); }
      return;
    }
    const dx = x - this.lastX; this.lastX = x;
    const sec = -dx * secPerPx * platterSens(this.app);
    if (!sec) return;
    if (d.scratching) d.scratchBySeconds(sec);
    else d.seek(clamp(d.time + sec, 0, d.duration));
  }
  release() {
    if (!this.dragging) return;
    this.dragging = false; this.armed = false;
    const d = this.deck;
    if (d.scratching) d.jogTouch(false);
    if (d.vinylTemp != null) { d.vinyl = d.vinylTemp; d.vinylTemp = null; }
  }
}
