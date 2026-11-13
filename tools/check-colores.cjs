// Colores de la interfaz (rc.4, «hay mucho color azul»):
//  1) busca colores azulados en app.css, index.html y los .js de la interfaz; fuera del bloque del tema
//     «Azul noche (clásico)» solo se admiten los del Deck 1 y los marcados con «colores-ok: motivo»;
//  2) contraste WCAG de los textos sobre sus fondos en cada tema, con las variables de app.css
//     (Grafito y Carbón deben dar ≥ 4,5:1; Azul noche es la paleta antigua tal cual y solo se informa).
// Uso: node tools/check-colores.cjs [--todos] (también lo ejecuta tools/test-todo.cjs)   (--todos lista también los justificados)
// Sale con código 1 si queda algún azul sin justificar o algún contraste por debajo de 4,5:1.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = 'src/css/app.css';
const FILES = [
  CSS,
  'src/index.html',
  'src/js/app.js', 'src/js/util.js',
  ...fs.readdirSync(path.join(ROOT, 'src/js/ui')).filter(f => f.endsWith('.js')).map(f => 'src/js/ui/' + f),
  ...['src/js/library', 'src/js/ai', 'src/js/spotify', 'src/js/youtube', 'src/js/midi']
    .flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js')).map(f => d + '/' + f)),
];

// Azules permitidos fuera del tema clásico y por qué
const ALLOWED = {
  '#2f9bff': 'Deck 1 (identidad: número, borde superior, onda, canal del mezclador, play)',
  '#8cc8ff': 'Deck 1 claro (BPM · tonalidad sobre su forma de onda)',
};

function rgb(c) {
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length <= 4) h = h.split('').map(x => x + x).join('');
    return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
  }
  const n = c.match(/[\d.]+/g);
  return n && n.length >= 3 ? n.map(Number).slice(0, 3) : [NaN, NaN, NaN];
}
// Azulado: tono entre cian y azul (190°-255°, sin los morados de FX/IA) con croma apreciable
// (los grises neutros tienen r≈g≈b y croma < 10)
function hueChroma([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (!c) return [0, 0];
  let h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, c];
}
function bluish(col) {
  const v = rgb(col);
  if (v.some(x => Number.isNaN(x))) return false;
  const [h, c] = hueChroma(v);
  return c >= 12 && h >= 190 && h <= 255;
}

// ---- 1) azules que quedan
const all = process.argv.includes('--todos');
const RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
let bad = 0, ok = 0, themed = 0;
console.log('Colores azulados fuera del tema «Azul noche (clásico)»:');
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inTheme = false;
  lines.forEach((line, i) => {
    if (/\[data-theme="azul"\]\s*\{/.test(line)) inTheme = true;
    for (const m of line.match(RE) || []) {
      const c = m.toLowerCase().replace(/\s+/g, '');
      if (/^#[0-9a-f]+$/.test(c) && ![3, 4, 6, 8].includes(c.length - 1)) continue;
      if (!bluish(c)) continue;
      const key = Object.keys(ALLOWED).find(k => c.startsWith(k));
      const where = `${rel}:${i + 1}`;
      const why = (line.match(/colores-ok:?\s*([^*]*)/) || [])[1];
      if (inTheme) { themed++; if (all) console.log(`  tema azul  ${c.padEnd(24)} ${where}`); }
      else if (key) { ok++; if (all) console.log(`  permitido  ${c.padEnd(24)} ${where}  → ${ALLOWED[key]}`); }
      else if (why != null) { ok++; if (all) console.log(`  permitido  ${c.padEnd(24)} ${where}  → ${why.trim()}`); }
      else { bad++; console.log(`  AZUL       ${c.padEnd(24)} ${where}   ${line.trim().slice(0, 110)}`); }
    }
    if (inTheme && /^\}/.test(line.trim())) inTheme = false;
  });
}
console.log(`  → sin justificar: ${bad} · justificados (Deck 1 / significado): ${ok} · del tema «Azul noche»: ${themed}\n`);

// ---- 2) contraste de los textos en cada tema
const css = fs.readFileSync(path.join(ROOT, CSS), 'utf8');
function block(sel) {
  const i = css.indexOf(sel + ' {');
  if (i < 0) throw new Error('No encuentro ' + sel);
  const body = css.slice(i, css.indexOf('\n}', i));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
const base = block(':root');
const THEMES = {
  Grafito: base,
  'Carbón': { ...base, ...block(':root[data-theme="carbon"]') },
  'Azul noche': { ...base, ...block(':root[data-theme="azul"]') },
};
const lum = (c) => rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// mezcla rgba(…, a) sobre un fondo opaco
function over(c, bg) {
  const m = /rgba\(([^)]+)\)/.exec(c);
  if (!m) return c;
  const [r, g, b, a] = m[1].split(',').map(Number), B = rgb(bg);
  return '#' + [r, g, b].map((v, i) => Math.round(v * a + B[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
// [texto, fondo, qué es]
const PAIRS = [
  ...['bg', 'panel', 'panel2', 'panel3', 'field', 'lib'].flatMap(bg => [
    ['text', bg, 'texto principal'], ['muted', bg, 'texto secundario'], ['dim', bg, 'texto terciario']]),
  ['btn-text', 'btn-top', 'botón'], ['btn-text', 'btn-hover-top', 'botón (hover)'],
  ['on-text', 'on-bg', 'botón activo'], ['on-solid-text', 'on-solid', 'pestaña activa (EN DECK/SUPERIOR, pads)'],
  ['th', 'panel2', 'cabecera de la tabla'], ['c-artist', 'lib', 'artista en la tabla'], ['played', 'lib', 'pista ya tocada'],
  ['side-text', 'side-bg', 'barra lateral'], ['side-text2', 'side-bg', 'barra de iconos'], ['side-muted', 'side-field', 'buscador de la barra lateral'],
  ['side-muted', 'side-bg', 'contador de la barra lateral'], ['text', 'hover', 'menú contextual (hover)'], ['muted', 'panel3', 'menú / aviso'],
  ['fx-title', 'panel', 'título FX'], ['smp-title', 'panel', 'título SAMPLER'], ['tempo-color', 'panel', 'tempo del deck'],
  ['platter-label', 'platter-hub', 'plato: DECK · JOG'], ['wave-text', 'wave-bg', 'onda: «Analizando…»'], ['wave-label', 'wave-bg', 'onda: vídeo de YouTube'],
  ['link', 'panel', 'enlace'], ['head', 'panel', 'títulos de Ajustes'], ['code', 'panel', 'claves MIDI'],
  ['sel-text', 'sel@lib', 'fila seleccionada (ámbar)'],
];
let low = 0;
const report = [];
for (const [name, v] of Object.entries(THEMES)) {
  const strict = name !== 'Azul noche';
  const get = (k) => { if (k === 'sel@lib') return over(v.sel, get('lib')); const x = v[k]; return x && /^var\(/.test(x) ? get(x.slice(6, -1)) : x; };
  const rows = [];
  for (const [t, b, what] of PAIRS) {
    const tc = get(t), bc = get(b);
    if (!tc || !bc || !/^#/.test(tc) || !/^#/.test(bc)) continue; // «initial» = color del deck: no es un texto fijo
    const r = ratio(tc, bc);
    const fail = r < 4.5;
    if (fail && strict) low++;
    rows.push(`  ${fail ? (strict ? 'BAJO ' : 'bajo ') : 'ok   '} ${r.toFixed(2).padStart(5)}:1  ${what.padEnd(40)} ${t} ${tc} sobre ${b} ${bc}`);
  }
  report.push(`Contraste · ${name}${strict ? '' : ' (paleta antigua, solo informativo)'}:`, ...rows, '');
}
console.log(report.join('\n'));
console.log(`Resultado: ${bad} azules sin justificar · ${low} contrastes < 4,5:1 en Grafito/Carbón`);
process.exit(bad || low ? 1 : 0);
