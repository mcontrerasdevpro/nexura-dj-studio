// Comprueba que la app tiene dirección para el envío de informes y sugerencias (sin imprimirla nunca).
// La dirección sale de src/config/servicios.json → feedbackUrl o, si está vacía, de config.local.json →
// feedbackWebhook (main.js). config.local.json no está en git: en GitHub Actions lo escribe el workflow
// publicar.yml con el secreto NEXURA_FEEDBACK_WEBHOOK.
//
// Uso:
//   node tools/check-url-sugerencias.cjs                 → prueba de la lógica (siempre; la lanza test-todo.cjs)
//   node tools/check-url-sugerencias.cjs --fuente        → falla si el código fuente (servicios.json + config.local.json) no tiene URL
//   node tools/check-url-sugerencias.cjs --asar <app.asar> → falla si el asar del instalador no tiene URL
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const webUrl = (u) => (/^https?:\/\/\S+/.test(String(u || '')) ? String(u) : '');
const parse = (txt) => { try { return JSON.parse(String(txt || '').replace(/^﻿/, '')); } catch (_) { return {}; } };
// Igual que main.js: feedbackUrl de servicios.json y, si está vacía, feedbackWebhook de config.local.json
const feedbackUrl = (servicios, local) => webUrl(parse(servicios).feedbackUrl) || webUrl(parse(local).feedbackWebhook);

function fromSource() {
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch (_) { return ''; } };
  return feedbackUrl(read('src/config/servicios.json'), read('config.local.json'));
}
function fromAsar(file) {
  const asar = require('@electron/asar');
  const list = new Set(asar.listPackage(file).map(f => f.replace(/\\/g, '/').replace(/^\//, '')));
  const get = (f) => (list.has(f) ? asar.extractFile(file, f.split('/').join(path.sep)).toString('utf8') : '');
  if (!list.has('main.js')) throw new Error('El asar no contiene main.js: ¿es el de la app?');
  return feedbackUrl(get('src/config/servicios.json'), get('config.local.json'));
}

const args = process.argv.slice(2);
if (args[0] === '--fuente' || args[0] === '--asar') {
  const where = args[0] === '--asar' ? args[1] : 'código fuente';
  if (args[0] === '--asar' && !(where && fs.existsSync(where))) { console.error(`✗ No existe el asar: ${where || '(falta la ruta)'}`); process.exit(1); }
  const url = args[0] === '--asar' ? fromAsar(where) : fromSource();
  if (!url) {
    console.error(`✗ Sin dirección para las sugerencias en ${where}: el instalador no podría enviar informes. Revisa el secreto NEXURA_FEEDBACK_WEBHOOK.`);
    process.exit(1);
  }
  console.log(`✓ ${where}: hay dirección de sugerencias (${new URL(url).protocol}//…, ${url.length} caracteres)`);
  process.exit(0);
}

// Prueba de la lógica
let ok = 0, bad = 0;
const check = (cond, msg) => { if (cond) { ok++; console.log('✓', msg); } else { bad++; console.log('✗', msg); } };
check(feedbackUrl('{"feedbackUrl":""}', '{"feedbackWebhook":"https://x.test/webhook/a"}') === 'https://x.test/webhook/a', 'sin feedbackUrl se usa feedbackWebhook de config.local.json');
check(feedbackUrl('{"feedbackUrl":"https://y.test/a"}', '{"feedbackWebhook":"https://x.test/b"}') === 'https://y.test/a', 'feedbackUrl tiene prioridad');
check(feedbackUrl('{"feedbackUrl":""}', '') === '', 'sin config.local.json no hay URL');
check(feedbackUrl('{"feedbackUrl":""}', '{"feedbackWebhook":""}') === '', 'secreto vacío → sin URL');
check(feedbackUrl('{"feedbackUrl":""}', '﻿{"feedbackWebhook":"https://x.test/c"}') === 'https://x.test/c', 'admite BOM');
check(feedbackUrl('{"feedbackUrl":""}', '{"feedbackWebhook":"no-es-url"}') === '', 'rechaza lo que no es http(s)');
const pkg = require(path.join(root, 'package.json'));
check((pkg.build.files || []).includes('config.local.json'), 'package.json → build.files incluye config.local.json');
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'publicar.yml'), 'utf8');
check(/NEXURA_FEEDBACK_WEBHOOK/.test(wf) && /check-url-sugerencias\.cjs --fuente/.test(wf) && /check-url-sugerencias\.cjs --asar/.test(wf), 'publicar.yml escribe config.local.json y comprueba la URL antes y después de construir');
check(wf.indexOf('check-url-sugerencias.cjs --fuente') < wf.indexOf('npm run release'), 'la comprobación va antes de generar el instalador');
console.log(`\n${ok}/${ok + bad} comprobaciones de la URL de sugerencias`);
process.exit(bad ? 1 : 0);
