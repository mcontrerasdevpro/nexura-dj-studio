// Temas de color (Ajustes → General → Apariencia). Los colores están en las variables CSS de app.css
// (`:root` = Grafito, `:root[data-theme=…]` = el resto); aquí se elige el tema y se copian a `TC` los que
// se dibujan en canvas (formas de onda y plato), que no pueden usar var().
import { DECK_COLORS, DECK_LIGHT } from '../util.js';

export const THEMES = {
  grafito: 'Grafito (recomendado)',
  carbon: 'Carbón',
  azul: 'Azul noche (clásico)'
};
export const DEFAULT_THEME = 'grafito';

// Colores de canvas del tema activo (nombre de la variable CSS sin «--»)
const CANVAS_VARS = ['wave-bg', 'wave-chip', 'wave-empty', 'wave-text', 'wave-label', 'wave-track', 'overview-bg', 'overview-empty',
  'platter-in', 'platter-out', 'platter-hub', 'platter-label', 'platter-time', 'muted'];
export const TC = {};

export function themeId(id) { return Object.hasOwn(THEMES, id) ? id : DEFAULT_THEME; }

export function applyTheme(id) {
  id = themeId(id);
  const root = document.documentElement;
  if (id === DEFAULT_THEME) delete root.dataset.theme; else root.dataset.theme = id;
  const cs = getComputedStyle(root), v = (k) => cs.getPropertyValue('--' + k).trim();
  for (const k of CANVAS_VARS) TC[k] = v(k);
  // los arrays se cambian en su sitio: los importan waveform.js, deck-ui.js…
  DECK_COLORS[0] = v('deck0'); DECK_COLORS[1] = v('deck1');
  DECK_LIGHT[0] = v('deck-light0'); DECK_LIGHT[1] = v('deck-light1');
  return id;
}
