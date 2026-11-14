// Genera las notas de una versión para GitHub Release a partir de src/legal/NOVEDADES.md.
// Uso: node tools/notas-version.cjs [versión] > notas.md   (por defecto, la de package.json)
// Sale con código 1 si NOVEDADES.md no tiene una sección para esa versión.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = process.argv[2] || require(path.join(root, 'package.json')).version;
const text = fs.readFileSync(path.join(root, 'src', 'legal', 'NOVEDADES.md'), 'utf8').replace(/\r\n/g, '\n');

const lines = text.split('\n');
const start = lines.findIndex(l => l.startsWith('## ') && l.slice(3).trim().split(/\s/)[0] === version);
if (start < 0) {
  console.error(`NOVEDADES.md no tiene una sección «## ${version} · …»`);
  process.exit(1);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('## ')) { end = i; break; }
const body = lines.slice(start + 1, end).join('\n').trim()
  .replace(/^### /gm, '#### '); // los apartados, un nivel por debajo del título de la versión

const prueba = /-(rc|beta|alpha)/i.test(version);
const out = [
  `${prueba ? 'Versión de prueba' : 'Versión'} **${version}** de **Nexura DJ Studio**, gratis para Windows 10/11.`,
  '',
  '### Novedades',
  '',
  body,
  '',
  '---',
  '',
  prueba
    ? 'Si tienes una versión anterior con «Recibir versiones de prueba» activado, se actualiza sola.'
    : 'Si tienes una versión anterior, se actualiza sola.',
  'Windows puede mostrar «Windows protegió su PC» porque la app aún no está firmada: pulsa «Más información» y después «Ejecutar de todas formas».',
  '',
  'Gracias a quienes nos enviáis sugerencias desde «💬 Enviar informe o sugerencia».',
  '',
  'Contacto: contacto@nexuraia.com',
  '',
].join('\n');
process.stdout.write(out);
