// Pruebas en Node del guardado agrupado y diferido de la biblioteca (Library.saveSoon / save / flush):
// - los cambios seguidos se agrupan en un solo guardado, que llega 1,5 s después del último (como mucho 8 s);
// - lo guardado es la biblioteca entera y es igual que el formato de antes (JSON válido con todos los campos);
// - flush() guarda ya lo pendiente (cerrar la app) y gana a un guardado a trozos que estaba a medias;
// - sin cambios, flush() no escribe nada.
// node tools/test-guardado.mjs
import assert from 'node:assert/strict';

const store = new Map(), writes = [];
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); writes.push({ k, at: Date.now(), len: v.length }); } };
const { Library } = await import('../src/js/library/library.js');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const saved = () => JSON.parse(store.get('nexura_library'));
const libWrites = () => writes.filter(w => w.k === 'nexura_library').length;

function make(count = 1200) {
  const lib = new Library();
  lib.addFiles(Array.from({ length: count }, (_, i) => ({ path: `E:\\Música\\Pista ${i}.mp3`, title: 'Pista ' + i, artist: 'Artista ' + (i % 50) })));
  const c = lib.createCrate('Boda');
  lib.addToCrate(c.id, [...lib.tracks.keys()].slice(0, 10));
  lib.addToPrepare([...lib.tracks.keys()].slice(5, 8));
  return lib;
}

await test('Muchos cambios seguidos → un solo guardado, 1,5 s después del último', async () => {
  const lib = make();
  await lib.flush();
  const before = libWrites();
  const ids = [...lib.tracks.keys()];
  for (let i = 0; i < 40; i++) { lib.update(ids[i], { bpm: 120 + i, analyzed: true }); await wait(10); }
  await wait(700);
  assert.equal(libWrites(), before, 'todavía no se ha guardado (espera 1,5 s tras el último cambio)');
  await wait(1300);
  assert.equal(libWrites(), before + 1, 'un único guardado para los 40 cambios');
  const s = saved();
  assert.equal(s.tracks.length, 1200);
  assert.equal(s.tracks.find(t => t.id === ids[39]).bpm, 159);
  assert.equal(lib.savePending, false);
});

await test('Cambios continuos: se guarda como mucho 8 s después del primero', async () => {
  const lib = make(50);
  await lib.flush();
  const before = libWrites(), t0 = Date.now();
  const id = [...lib.tracks.keys()][0];
  while (libWrites() === before && Date.now() - t0 < 11000) { lib.update(id, { plays: (lib.get(id).plays || 0) + 1 }); await wait(300); }
  const dt = Date.now() - t0;
  assert.ok(libWrites() > before && dt >= 7500 && dt < 10000, `guardado a los ${dt} ms`);
  await lib.flush();
});

await test('Lo guardado es la biblioteca entera, con el mismo formato de siempre', async () => {
  const lib = make(900);
  lib.update([...lib.tracks.keys()][3], { cues: [{ t: 1.5, color: '#fff', name: 'Drop «1»\n"comillas"' }, null, null, null, null, null, null, null] });
  await lib.flush();
  const s = saved();
  const expected = JSON.parse(JSON.stringify({ version: 1, tracks: [...lib.tracks.values()], crates: lib.crates, smart: lib.smart, history: lib.history.slice(-200), prepare: lib.prepare, ytPlaylists: lib.ytPlaylists }));
  assert.deepEqual(s, expected);
  // y se vuelve a cargar igual
  const lib2 = new Library();
  await lib2.load();
  assert.equal(lib2.tracks.size, 900);
  assert.equal(lib2.crates[0].ids.length, 10);
  assert.equal(lib2.get([...lib.tracks.keys()][3]).cues[0].name, 'Drop «1»\n"comillas"');
});

await test('Cerrar (flush) justo después de un cambio: no se pierde nada', async () => {
  const lib = make(300);
  await lib.flush();
  const id = [...lib.tracks.keys()][42];
  lib.update(id, { rating: 5, comment: 'última' });
  lib.createCrate('Creada al final');
  assert.equal(lib.savePending, true);
  await lib.flush();                 // lo que hace la app al cerrar (main.js lo pide antes de cerrar la ventana)
  const s = saved();
  assert.equal(s.tracks.find(t => t.id === id).comment, 'última');
  assert.ok(s.crates.some(c => c.name === 'Creada al final'));
  assert.equal(lib.savePending, false);
});

await test('flush() durante un guardado a trozos: gana lo más reciente', async () => {
  const lib = make(3000);
  await lib.flush();
  const id = [...lib.tracks.keys()][2999];
  lib.update(id, { title: 'A' });
  const p = lib.save();              // guardado a trozos (cede el hilo entre trozos)
  lib.update(id, { title: 'B' });    // cambio mientras se guarda
  await lib.flush();
  await p;
  await wait(50);
  assert.equal(saved().tracks.find(t => t.id === id).title, 'B');
  await wait(2000);                  // ningún guardado posterior pisa lo último con algo viejo
  assert.equal(saved().tracks.find(t => t.id === id).title, 'B');
});

await test('Sin cambios pendientes, flush() no escribe', async () => {
  const lib = make(20);
  await lib.flush();
  const before = libWrites();
  await lib.flush();
  assert.equal(libWrites(), before);
});

console.log(`\n${n} pruebas del guardado diferido superadas`);
process.exit(0);
