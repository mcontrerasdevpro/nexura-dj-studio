// Beatgrid con marcadores (BPM variable). Sin marcadores la pista usa una rejilla fija
// { bpm, firstBeat }; con `track.grid = [{t, bpm}, ...]` (ordenado, ≥ 2 marcas) cada tramo usa su
// BPM hasta la marca siguiente. Entre marcas siempre cabe un número entero de beats (como en las
// cabinas profesionales): al mover o añadir una marca se reajusta el BPM del tramo anterior.

export function markers(track) {
  if (!track || !track.bpm) return [];
  if (Array.isArray(track.grid) && track.grid.length >= 2) return track.grid;
  return [{ t: track.firstBeat || 0, bpm: track.bpm }];
}

// beats acumulados al inicio de cada marca (enteros salvo el primero, que es 0)
function cumBeats(g) {
  const B = [0];
  for (let i = 1; i < g.length; i++) B.push(B[i - 1] + Math.round((g[i].t - g[i - 1].t) * g[i - 1].bpm / 60));
  return B;
}

function segAt(g, t) { let i = 0; while (i + 1 < g.length && g[i + 1].t <= t) i++; return i; }

export function beatAt(track, t) {
  const g = markers(track); if (!g.length) return 0;
  if (g.length === 1) return (t - g[0].t) * g[0].bpm / 60;
  const B = cumBeats(g), i = segAt(g, t);
  return B[i] + (t - g[i].t) * g[i].bpm / 60;
}

export function beatTime(track, b) {
  const g = markers(track); if (!g.length) return 0;
  if (g.length === 1) return g[0].t + b * 60 / g[0].bpm;
  const B = cumBeats(g);
  let i = 0; while (i + 1 < g.length && B[i + 1] <= b) i++;
  return g[i].t + (b - B[i]) * 60 / g[i].bpm;
}

export function bpmAt(track, t) {
  const g = markers(track); if (!g.length) return 0;
  return g[segAt(g, t)].bpm;
}

export function markerIndexAt(track, t) { const g = markers(track); return g.length ? segAt(g, t) : -1; }

// Ajusta los BPM para que entre marcas quepa un número entero de beats y quita marcas duplicadas
export function normalize(grid) {
  const g = grid.filter(m => m && isFinite(m.t) && m.bpm > 20).sort((a, b) => a.t - b.t);
  const out = [];
  for (const m of g) {
    const prev = out[out.length - 1];
    if (prev && m.t - prev.t < 60 / prev.bpm * 0.75) continue; // menos de un beat: se descarta
    out.push({ t: m.t, bpm: m.bpm });
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const span = out[i + 1].t - out[i].t;
    const n = Math.max(1, Math.round(span * out[i].bpm / 60));
    out[i].bpm = Math.round(60 * n / span * 1000) / 1000;
  }
  return out;
}

// BPM dominante (el que más dura) para la biblioteca, el asistente y la ordenación
export function dominantBpm(grid, duration) {
  const w = new Map();
  grid.forEach((m, i) => {
    const end = i + 1 < grid.length ? grid[i + 1].t : Math.max(m.t + 1, duration || m.t + 1);
    const k = Math.round(m.bpm * 10) / 10;
    w.set(k, (w.get(k) || 0) + (end - m.t));
  });
  let best = grid[0].bpm, bw = -1;
  for (const [k, v] of w) if (v > bw) { bw = v; best = k; }
  return best;
}

// Campos a guardar en la pista para una rejilla dada
export function gridUpdate(grid, duration) {
  const g = normalize(grid);
  if (g.length <= 1) return { grid: null, bpm: g[0] ? Math.round(g[0].bpm * 10000) / 10000 : undefined, firstBeat: g[0] ? g[0].t : 0, bpmLocked: true };
  return { grid: g, bpm: dominantBpm(g, duration), firstBeat: g[0].t, bpmLocked: true };
}

// Marcas con su beat acumulado [{beat, t, bpm}] (la pista guarda solo {t, bpm}: el beat se deduce)
export function markersWithBeats(track) {
  const g = markers(track), B = cumBeats(g);
  return g.map((m, i) => ({ beat: B[i], t: m.t, bpm: m.bpm }));
}

// Segundos que ocupan `beats` beats a partir de `from` siguiendo el grid (con BPM variable cada beat dura lo suyo)
export function beatSpan(track, from, beats) {
  if (!track || !track.bpm) return beats * 0.5;
  return beatTime(track, beatAt(track, from) + beats) - from;
}

// Cambios de tempo para dibujar: marcas cuyo BPM difiere del tramo anterior (> 0,005)
export function tempoChanges(track) {
  const g = markers(track);
  return g.filter((m, i) => i > 0 && Math.abs(m.bpm - g[i - 1].bpm) > 0.005);
}

// ---- edición (funciones puras: devuelven la lista de marcas nueva, sin normalizar; null si no aplica)
const copy = (track) => markers(track).map(m => ({ t: m.t, bpm: m.bpm }));
const beatSec = (g, i) => 60 / g[i].bpm;

// «Inicio del grid aquí»: el primer beat (y compás) pasa a estar en t; las marcas anteriores se descartan
export function editStartHere(track, t) {
  const g = copy(track); if (!g.length) return null;
  const bpm = bpmAt(track, t);
  return [{ t, bpm }, ...g.filter(m => m.t > t + 0.75 * 60 / bpm)];
}

// «Beat aquí»: el beat más cercano a t pasa a caer en t. Si está a ≥ 4 beats de la marca del tramo se
// reajusta el BPM del tramo (las marcas siguientes se desplazan para conservar sus beats); si está cerca
// de la marca, se mueve la marca.
export function editBeatHere(track, t) {
  const g = copy(track); if (!g.length) return null;
  const B = cumBeats(g), i = segAt(g, t);
  const b = Math.round(beatAt(track, t)), k = b - B[i];
  if (k >= 4 && t > g[i].t) {
    const bpm = 60 * k / (t - g[i].t);
    if (!(bpm > 20 && bpm < 400)) return null;
    if (i + 1 < g.length) {
      const delta = g[i].t + (B[i + 1] - B[i]) * 60 / bpm - g[i + 1].t;
      for (let j = i + 1; j < g.length; j++) g[j].t += delta;
    }
    g[i].bpm = bpm;
  } else {
    const d = t - beatTime(track, b);
    g[i].t += d;
    if (g.length === 1) return g;
    if (i > 0 && g[i].t <= g[i - 1].t + beatSec(g, i - 1)) return null;
  }
  return g;
}

// «Compás aquí»: t pasa a ser el primer tiempo de un compás (el BPM no cambia; se mueve la marca del tramo)
export function editBarHere(track, t) {
  const g = copy(track); if (!g.length) return null;
  const i = segAt(g, t), bar = 4 * beatSec(g, i);
  const k = Math.round((t - g[i].t) / bar);
  g[i].t = t - k * bar;
  if (i > 0 && g[i].t <= g[i - 1].t) g[i].t += bar;
  return g;
}

// «Cambio de BPM aquí»: marca nueva en el compás (o beat) más cercano a t con el BPM indicado; las marcas
// siguientes se desplazan para conservar sus beats. Si ya hay una marca en ese punto, se cambia su BPM.
export function editTempoChange(track, t, bpm, level = 'bar') {
  if (!(bpm > 20 && bpm < 400)) return null;
  const g = copy(track); if (!g.length) return null;
  const div = level === 'beat' ? 1 : 4;
  const tb = beatTime(track, Math.round(beatAt(track, t) / div) * div);
  const B = cumBeats(g);
  let i = g.findIndex(m => Math.abs(m.t - tb) < 0.75 * 60 / bpmAt(track, tb));
  if (i < 0) {
    if (tb < g[0].t) { g.unshift({ t: tb, bpm }); return g; }
    const s = segAt(g, tb);
    g.splice(s + 1, 0, { t: tb, bpm: g[s].bpm });
    B.splice(s + 1, 0, B[s] + Math.round((tb - g[s].t) * g[s].bpm / 60));
    i = s + 1;
  }
  if (i + 1 < g.length) {
    const delta = g[i].t + (B[i + 1] - B[i]) * 60 / bpm - g[i + 1].t;
    for (let j = i + 1; j < g.length; j++) g[j].t += delta;
  }
  g[i].bpm = bpm;
  return g;
}
