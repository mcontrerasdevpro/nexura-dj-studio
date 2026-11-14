// Novedades de la versión (src/js/ui/release-notes-core.js + src/legal/NOVEDADES.md). Uso: node tools/test-novedades.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareVersions, shouldAnnounce, parseNotes, notesFor } from '../src/js/ui/release-notes-core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('✓', name); } else { fail++; console.log('✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

const order = ['0.9.0-beta.8', '1.0.0-beta.2', '1.0.0-rc.1', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0', '1.0.1', '1.1.0-beta.1', '1.1.0', '2.0.0'];
let sorted = true;
for (let i = 0; i < order.length - 1; i++) if (!(compareVersions(order[i], order[i + 1]) < 0 && compareVersions(order[i + 1], order[i]) > 0)) { sorted = false; console.log('  orden mal:', order[i], order[i + 1]); }
ok(sorted, 'orden de versiones (beta < rc < estable; rc.2 < rc.10)');
ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.2') === 0 && compareVersions('v1.0.0', '1.0.0') === 0, 'iguales (con y sin «v»)');

ok(shouldAnnounce('1.0.0-rc.1', '1.0.0-rc.2', true), 'rc.1 → rc.2: avisa');
ok(shouldAnnounce(undefined, '1.0.0-rc.2', true), 'desde la rc1 (sin lastVersion, bienvenida vista): avisa');
ok(!shouldAnnounce(undefined, '1.0.0-rc.2', false), 'instalación nueva: no avisa');
ok(!shouldAnnounce('1.0.0-rc.2', '1.0.0-rc.2', true), 'misma versión: no avisa');
ok(!shouldAnnounce('1.0.1', '1.0.0', true), 'versión anterior (se volvió atrás): no avisa');
ok(!shouldAnnounce('1.0.0-rc.1', 'web', true), 'modo navegador: no avisa');

const md = fs.readFileSync(path.join(root, 'src', 'legal', 'NOVEDADES.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const list = parseNotes(md);
const cur = notesFor(list, pkg.version);
// Delante puede ir la próxima versión «en preparación» (posterior a la del package.json); al publicarla se le
// quita esa marca y entonces tiene que coincidir con el package.json
const head = list.filter(n => !/en preparación/i.test(n.title));
const draft = list.slice(0, list.indexOf(head[0]));
// (el borrador puede no tener número aún: «## Próxima versión · en preparación»)
ok(head.length >= 2 && head[0].version === pkg.version && draft.every(n => !n.version || compareVersions(n.version, pkg.version) > 0),
  `NOVEDADES.md empieza por la versión del package.json (${pkg.version}), o por una posterior «en preparación»`, list.map(n => n.title));
ok(cur && cur.version === pkg.version && cur.blocks.some(b => b.type === 'ul'), 'notas de la versión actual con puntos', cur && cur.blocks.length);
const rc2 = list.find(n => n.version === '1.0.0-rc.2');
ok(rc2 && rc2.blocks.some(b => b.type === 'h') && rc2.blocks.filter(b => b.type === 'ul').reduce((n, b) => n + b.items.length, 0) >= 8, 'notas de la rc.2 con apartados y puntos', rc2 && rc2.blocks.length);
const text = JSON.stringify(rc2);
ok(/YouTube/.test(text) && /Comprobar clave/.test(text) && /AIza/.test(text) && /30 búsquedas/.test(text) && /barra de progreso/.test(text), 'cuentan la búsqueda, las claves y la barra de YouTube');
ok(notesFor(list, '9.9.9') === head[0], 'versión sin notas → las más recientes publicadas (no las «en preparación»)');
const dl = parseNotes('## 2.0.0 · en preparación\n- b\n## 1.0.0 · x\n- a');
ok(notesFor(dl, 'web').version === '1.0.0' && notesFor(dl, '2.0.0').version === '2.0.0', 'la sección «en preparación» solo se muestra a su propia versión');
const p = parseNotes('## 2.0.0 · x\n### A\n- uno\n- dos\ntexto\n- tres');
ok(p[0].version === '2.0.0' && p[0].blocks.map(b => b.type).join() === 'h,ul,p,ul' && p[0].blocks[1].items.length === 2, 'formato: apartados, listas y párrafos', p[0].blocks);

console.log(`\n${pass}/${pass + fail} comprobaciones de las novedades correctas`);
process.exit(fail ? 1 : 0);
