// Papelera de Windows para «Limpiar biblioteca» (sin Electron; se prueba en Node con una papelera simulada:
// tools/test-limpieza.mjs). Nunca se borra nada de forma definitiva:
//   · trashFiles(rutas, { trashItem }) → envía cada archivo a la Papelera (en la app, shell.trashItem), solo en
//     unidades donde se ha comprobado que la Papelera funciona (recycleWorks)
//   · restoreFromRecycleBin(ruta) → lo devuelve a su sitio. Windows guarda cada archivo borrado como
//     <unidad>\$Recycle.Bin\<SID>\$Rxxxxxx.ext junto a un $Ixxxxxx.ext con la ruta original; se busca el $I de
//     esa ruta (el más reciente), se mueve el $R a la ruta original y se quita el $I (lo mismo que «Restaurar»).
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// shell.trashItem BORRA DEL TODO, sin avisar, lo que no puede ir a la Papelera (unidades de red, USB sin
// Papelera, Papelera desactivada en esa unidad). Por eso, antes de mover nada, se prueba cada unidad con un
// archivo propio de 6 bytes en la misma carpeta: solo si aparece en $Recycle.Bin se mueven los de esa unidad
// (y la prueba se quita de la Papelera). Las unidades que funcionan se recuerdan durante la sesión.
const recycleOk = new Set();
async function recycleWorks(file, { trashItem, root = binRootFor(file) }) {
  if (!root) return false;                          // \\servidor\… y rutas sin letra de unidad: nunca
  const key = root.toLowerCase();
  if (recycleOk.has(key)) return true;
  const probe = path.join(path.dirname(file), `.nexura-prueba-papelera-${process.pid}-${Date.now()}.tmp`);
  try {
    await fsp.writeFile(probe, 'nexura');
    await trashItem(probe);
    if (fs.existsSync(probe)) return false;
    const hits = await findInRecycleBin(probe, { root });
    if (!hits.length) return false;                 // se ha borrado del todo: esta unidad no tiene Papelera
    for (const h of hits) { await fsp.unlink(h.r).catch(() => {}); await fsp.unlink(h.i).catch(() => {}); }
    recycleOk.add(key);
    return true;
  } catch (_) { return false; }
  finally { await fsp.unlink(probe).catch(() => {}); }
}

async function trashFiles(paths, { trashItem, root } = {}) {
  const out = [];
  const drive = new Map();                          // unidad → ¿tiene Papelera? (una prueba por unidad)
  for (const p of paths) {
    try {
      await fsp.access(p);
      const r = root || binRootFor(p) || '';
      if (!drive.has(r)) drive.set(r, await recycleWorks(p, { trashItem, root: root || binRootFor(p) }));
      if (!drive.get(r)) { out.push({ path: p, ok: false, error: 'esta unidad no tiene Papelera de Windows: el archivo se queda en su carpeta' }); continue; }
      await trashItem(p);
      out.push({ path: p, ok: true });
    } catch (e) { out.push({ path: p, ok: false, error: e.code === 'ENOENT' ? 'el archivo ya no existía' : String(e.message || e) }); }
  }
  return out;
}

// $I: versión 1 (Vista/7/8: ruta de 260 caracteres fija) o 2 (Windows 10/11: longitud + ruta)
function parseInfo(b) {
  if (b.length < 28) return null;
  const ver = Number(b.readBigInt64LE(0));
  const size = Number(b.readBigInt64LE(8));
  const ft = b.readBigInt64LE(16);
  const date = new Date(Number(ft / 10000n) - 11644473600000);
  let name;
  if (ver === 2) { const n = b.readUInt32LE(24); name = b.toString('utf16le', 28, 28 + n * 2); }
  else if (ver === 1) name = b.toString('utf16le', 24, Math.min(b.length, 24 + 520));
  else return null;
  return { ver, size, date, path: name.replace(/\u0000.*$/s, '') };
}
// Escribe un $I (para la papelera simulada de las pruebas)
function buildInfo(original, size, date = new Date()) {
  const name = Buffer.from(original + '\u0000', 'utf16le');
  const b = Buffer.alloc(28 + name.length);
  b.writeBigInt64LE(2n, 0); b.writeBigInt64LE(BigInt(size), 8);
  b.writeBigInt64LE((BigInt(date.getTime()) + 11644473600000n) * 10000n, 16);
  b.writeUInt32LE(name.length / 2, 24); name.copy(b, 28);
  return b;
}

// Carpeta de la papelera de la unidad de un archivo (C:\$Recycle.Bin)
const binRootFor = (p) => { const m = /^([a-z]:)[\\/]/i.exec(p); return m ? m[1].toUpperCase() + '\\$Recycle.Bin' : null; };

// Busca en la papelera los archivos con esa ruta original → [{ info, r, i, date }] (el más reciente primero)
async function findInRecycleBin(original, { root = binRootFor(original) } = {}) {
  if (!root) return [];
  const want = path.resolve(original).toLowerCase();
  const found = [];
  let sids = [];
  try { sids = (await fsp.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => path.join(root, e.name)); } catch (_) { return []; }
  for (const dir of sids) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch (_) { continue; }   // papeleras de otros usuarios: sin permiso
    for (const n of names) {
      if (!/^\$I/i.test(n)) continue;
      try {
        const info = parseInfo(await fsp.readFile(path.join(dir, n)));
        if (!info || path.resolve(info.path).toLowerCase() !== want) continue;
        const r = path.join(dir, '$R' + n.slice(2));
        if (fs.existsSync(r)) found.push({ info, i: path.join(dir, n), r, date: info.date });
      } catch (_) { /* $I ilegible */ }
    }
  }
  return found.sort((a, b) => b.date - a.date);
}

// → { path, ok, how: 'restored' | 'exists' | 'notfound' | 'error', error? }
async function restoreFromRecycleBin(original, opts = {}) {
  if (fs.existsSync(original)) return { path: original, ok: true, how: 'exists' };
  const hits = await findInRecycleBin(original, opts);
  if (!hits.length) return { path: original, ok: false, how: 'notfound' };
  try {
    await fsp.mkdir(path.dirname(original), { recursive: true });
    await fsp.rename(hits[0].r, original);
    await fsp.unlink(hits[0].i).catch(() => {});
    return { path: original, ok: true, how: 'restored' };
  } catch (e) { return { path: original, ok: false, how: 'error', error: String(e.message || e) }; }
}

module.exports = { trashFiles, findInRecycleBin, restoreFromRecycleBin, parseInfo, buildInfo, binRootFor };
