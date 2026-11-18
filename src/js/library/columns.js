// Columnas de la tabla de la biblioteca (sin DOM: se prueba en Node)
// prio: al estrechar la pantalla se ocultan primero las de prioridad más baja (el CSS fija en
// --lib-max cuántas columnas caben en cada tamaño). fixed: no se pueden ocultar. def: visible por defecto.
export const COLUMNS = [
  { key: 'status', label: '', menu: 'Estado', w: '30px', min: 24, prio: 100, fixed: true, nosort: true },
  { key: 'art', label: '', menu: 'Carátula', w: 'var(--art-w, 30px)', min: 24, prio: 15, def: false, nosort: true },
  { key: 'title', label: 'Título', w: 'minmax(var(--col-min-title, 140px), 2.2fr)', prio: 99, fixed: true },
  { key: 'artist', label: 'Artista', w: 'minmax(var(--col-min-text, 100px), 1.5fr)', prio: 90 },
  // solo en el panel Archivos (subcarpeta de cada pista dentro de la carpeta abierta): no sale en el menú
  { key: 'folder', label: 'Carpeta', w: 'minmax(90px, 1.1fr)', prio: 85, def: false, files: true },
  { key: 'bpm', label: 'BPM', w: '62px', min: 40, prio: 80 },
  { key: 'camelot', label: 'Key', w: '52px', min: 38, prio: 70 },
  { key: 'duration', label: 'Duración', w: '70px', min: 50, prio: 60 },
  { key: 'rating', label: 'Valoración', w: '84px', min: 70, prio: 45 },
  { key: 'genre', label: 'Género', w: '96px', prio: 40 },
  { key: 'album', label: 'Álbum', w: 'minmax(80px, 1fr)', prio: 30 },
  { key: 'explicit', label: 'E', menu: 'Explicit', w: '30px', min: 24, prio: 22, def: false },
  { key: 'plays', label: 'Repr.', w: '48px', min: 36, prio: 25 },
  { key: 'year', label: 'Año', w: '52px', min: 40, prio: 12, def: false },
  { key: 'energy', label: 'Energía', w: '62px', min: 44, prio: 11, def: false },
  { key: 'comment', label: 'Comentario', w: 'minmax(90px, 1fr)', prio: 8, def: false },
  { key: 'added', label: 'Añadida', w: '88px', min: 60, prio: 10 }
];
export const COL_BY_KEY = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
export const DEFAULT_COLS = COLUMNS.filter(c => c.def !== false).map(c => c.key);
// las que se pueden elegir con clic derecho en la cabecera
export const MENU_COLS = COLUMNS.filter(c => !c.fixed && !c.files);

// Columnas que se muestran: las elegidas por el usuario (siempre con las fijas), en el orden del
// catálogo, y como mucho «max» (se quitan las de menor prioridad)
export function visibleColumns(keys, max = Infinity) {
  const want = new Set(Array.isArray(keys) ? keys : DEFAULT_COLS);
  let cols = COLUMNS.filter(c => c.fixed || want.has(c.key));
  const n = Math.max(2, Math.floor(Number(max) || Infinity));
  if (cols.length > n) {
    const keep = new Set(cols.slice().sort((a, b) => b.prio - a.prio).slice(0, n).map(c => c.key));
    cols = cols.filter(c => keep.has(c.key));
  }
  return cols;
}

// Plantilla de grid (valor de --lib-cols) para esas columnas; «widths» = anchos fijados por el usuario
// en px ({clave: px}). Si todas quedan fijas, la última absorbe el espacio sobrante.
export function columnTemplate(cols, widths = {}) {
  const tracks = cols.map(c => (widths && widths[c.key] > 0 ? Math.round(widths[c.key]) + 'px' : c.w));
  const flexible = tracks.some(t => /fr\b/.test(t));
  if (!flexible && tracks.length) tracks[tracks.length - 1] = `minmax(${tracks[tracks.length - 1]}, 1fr)`;
  return tracks.join(' ');
}

// Claves elegidas para una vista: globales («Mismas columnas en todos los crates») o por vista
export function columnsFor(settings, viewId) {
  const s = settings || {};
  if (s.libColsSame === false && s.libColsByView && Array.isArray(s.libColsByView[viewId])) return s.libColsByView[viewId];
  return Array.isArray(s.libCols) ? s.libCols : DEFAULT_COLS;
}
