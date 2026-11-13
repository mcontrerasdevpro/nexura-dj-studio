// «Limpiar biblioteca» en la interfaz, con Electron contra `npm run web` y el análisis simulado
// (window.__nexuraCleanupMock): abrir desde la biblioteca y desde «?», las 4 pestañas, progreso, cancelar y
// reanudar, resolver un grupo (fusión de crates/cues y Papelera), buscar en internet, aplicar etiquetas, crear
// una crate desde Calidad, deshacer desde el historial, biblioteca protegida y Esc. A 1280×800 y 375×812.
// Tema: en cada pestaña comprueba que ningún color calculado del diálogo sea azulado (mismo criterio que
// tools/check-colores.cjs; el tema por defecto es Grafito).
// Uso: npx electron tools/ui-check-limpieza.cjs → capturas e informe en .revision/limpiar-biblioteca/
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'limpiar-biblioteca');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const D = 'E:\\Música\\';

// Biblioteca: duplicados exactos (A), misma canción en otra calidad (B), FLAC/MP3 (C), versiones (D) y etiquetas
function seed() {
  const now = Date.now();
  const mk = (id, rel, o = {}) => ({ id, path: D + rel, source: 'local', title: '', artist: '', album: '', genre: '', year: '', comment: '', rating: 0, bpm: 124, firstBeat: 0, key: '', camelot: '8A', duration: 200, size: 1000, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now, plays: 0, lastPlayed: 0, analyzed: true, ...o });
  const tracks = [
    mk('a1', 'House\\Daft Punk - One More Time.mp3', { artist: 'Daft Punk', title: 'One More Time', year: '2000', genre: 'House' }),
    mk('a2', 'Descargas\\Daft Punk - One More Time.mp3', { artist: 'Daft Punk', title: 'One More Time', plays: 4 }),
    mk('b1', 'Pop\\Artista B - Tema B.mp3', { artist: 'Artista B', title: 'Tema B' }),
    mk('b2', 'Descargas\\Artista B - Tema B.mp3', { artist: 'Artista B', title: 'Tema B (Official Video)', rating: 4, plays: 2 }),
    mk('c1', 'Lossless\\Artista C - Tema C.flac', { artist: 'Artista C', title: 'Tema C' }),
    mk('c2', 'Techno\\Artista C - Tema C.mp3', { artist: 'Artista C', title: 'Tema C' }),
    mk('d1', 'Dance\\Artista D - Tema D.mp3', { artist: 'Artista D', title: 'Tema D' }),
    mk('d2', 'Dance\\Artista D - Tema D (Extended Mix).mp3', { artist: 'Artista D', title: 'Tema D (Extended Mix)', duration: 320 }),
    mk('e1', 'Varios\\Pista 01.mp3', { title: 'Pista 01' }),
    mk('e2', 'YouTube\\Artista Z - Cancion Z.mp3', { artist: 'ArtistaZVEVO', title: 'Cancion Z (Official Video) [HD]' }),
    mk('e3', 'Latino\\BAILANDO.mp3', { artist: 'LOS DEL MAR', title: 'BAILANDO EN LA PLAYA' }),
    mk('e4', 'Wav\\Artista G - Tema G.wav', { artist: 'Artista G', title: 'Tema G' }),
    mk('q1', 'Viejas\\Artista E - Tema E.mp3', { artist: 'Artista E', title: 'Tema E', year: '1999', genre: 'Pop' }),
    mk('q2', 'Perdidos\\No existe.mp3', { artist: 'Nadie', title: 'No existe' })
  ];
  tracks[3].cues[0] = { t: 30, color: '#ff3b47', name: 'Drop' };
  return {
    library: { version: 1, tracks, crates: [{ id: 'fav', name: 'Favoritas', ids: ['b2', 'd1'], created: now - 1000 }], smart: [], history: [{ id: 'h1', date: now - 3600000, entries: [{ id: 'b2', title: 'Tema B', time: now - 3600000 }] }], prepare: ['b2'], ytPlaylists: [] },
    settings: { libView: 'all', welcomeDone: true, waveLayout: 'serato', crateSort: 'custom' }
  };
}

// Lo que «leería» el proceso principal de cada archivo
const MOCK = `(() => {
  const D = ${JSON.stringify(D)};
  const tag = (artist, title, year = '', genre = '', cover = false) => ({ artist, title, year, genre, album: '', cover });
  const R = {
    'House\\\\Daft Punk - One More Time.mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 200, full: 'HA', tags: tag('Daft Punk', 'One More Time', '2000', 'House', true) },
    'Descargas\\\\Daft Punk - One More Time.mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 200, full: 'HA', tags: tag('Daft Punk', 'One More Time') },
    'Pop\\\\Artista B - Tema B.mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 200, full: 'HB1', tags: tag('Artista B', 'Tema B', '2015', 'Pop', true) },
    'Descargas\\\\Artista B - Tema B.mp3': { fmt: 'mp3', br: 128, sr: 44100, dur: 201, tags: tag('Artista B', 'Tema B (Official Video)') },
    'Lossless\\\\Artista C - Tema C.flac': { fmt: 'flac', lossless: true, bits: 16, br: 900, sr: 44100, dur: 200, tags: tag('Artista C', 'Tema C', '2010', 'Techno', true) },
    'Techno\\\\Artista C - Tema C.mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 200.4, tags: tag('Artista C', 'Tema C', '2010', 'Techno', true) },
    'Dance\\\\Artista D - Tema D.mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 200, tags: tag('Artista D', 'Tema D', '2012', 'Dance', true) },
    'Dance\\\\Artista D - Tema D (Extended Mix).mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 320, tags: tag('Artista D', 'Tema D (Extended Mix)', '2012', 'Dance', true) },
    'Varios\\\\Pista 01.mp3': { fmt: 'mp3', br: 256, sr: 44100, dur: 200, tags: tag('', 'Pista 01') },
    'YouTube\\\\Artista Z - Cancion Z.mp3': { fmt: 'mp3', br: 160, sr: 44100, dur: 210, tags: tag('ArtistaZVEVO', 'Cancion Z (Official Video) [HD]') },
    'Latino\\\\BAILANDO.mp3': { fmt: 'mp3', br: 320, sr: 44100, dur: 190, tags: tag('LOS DEL MAR', 'BAILANDO EN LA PLAYA') },
    'Wav\\\\Artista G - Tema G.wav': { fmt: 'wav', lossless: true, bits: 16, br: 1411, sr: 44100, dur: 240, tags: null },
    'Viejas\\\\Artista E - Tema E.mp3': { fmt: 'mp3', br: 96, sr: 44100, dur: 220, tags: tag('Artista E', 'Tema E', '1999', 'Pop', true) },
    'Perdidos\\\\No existe.mp3': { missing: true }
  };
  const ok = (v) => Promise.resolve(v);
  const m = window.__nexuraCleanupMock = {
    calls: [], cancelled: false, steps: 12, stepMs: 140,
    async scan(entries) {
      m.calls.push(['scan', entries.length]); m.cancelled = false;
      const ui = nexuraApp.cleanupUI;
      for (let i = 1; i <= m.steps; i++) {
        await new Promise(r => setTimeout(r, m.stepMs));
        ui.onEvent({ t: 'progress', phase: i < m.steps * 0.7 ? 'leer' : 'huella', done: Math.round(entries.length * i / m.steps), total: entries.length, cached: 0 });
        if (m.cancelled) {
          const half = entries.slice(0, Math.ceil(entries.length / 2));
          return { records: half.map(e => ({ id: e.id, path: e.path, ...(R[e.path.slice(D.length)] || { missing: true }) })), cancelled: true, stats: { cached: 0, probed: half.length, ms: 900 } };
        }
      }
      return { records: entries.map(e => ({ id: e.id, path: e.path, ...(R[e.path.slice(D.length)] || { missing: true }) })), cancelled: false, stats: { cached: 3, probed: entries.length - 3, ms: 1700 } };
    },
    cancel() { m.calls.push(['cancel']); m.cancelled = true; return ok(true); },
    priority(v) { m.calls.push(['priority', v]); return ok(v); },
    async lookup(queries) {
      m.calls.push(['lookup', queries.map(q => q.artist + ' / ' + q.title)]);
      const results = {};
      for (const q of queries) {
        await new Promise(r => setTimeout(r, 60));
        nexuraApp.cleanupUI.onEvent({ t: 'online', done: Object.keys(results).length + 1, total: queries.length });
        results[q.key] = /cancion z/i.test(q.title) ? { items: [{ id: 'r1', score: 100, title: 'Canción Z', artist: 'ArtistaZ', length: 210000, date: '2018-05-01', releases: [{ id: '0f0f0f0f-0000-1111-2222-333333333333', date: '2018-05-01', status: 'Official', type: 'Single' }], tags: [{ name: 'reggaeton', count: 4 }] }] }
          : /bailando/i.test(q.title) ? { items: [{ id: 'r2', score: 98, title: 'Bailando en la Playa', artist: 'Los del Mar', length: 190000, date: '1996', releases: [{ id: '1e1e1e1e-0000-1111-2222-333333333333', date: '1996', status: 'Official', type: 'Album' }], tags: [{ name: 'latin pop', count: 2 }] }] } : { items: [] };
      }
      return { results, offline: false, done: queries.length };
    },
    cover(id) { m.calls.push(['cover', id]); const c = document.createElement('canvas'); c.width = c.height = 56; const g = c.getContext('2d'); g.fillStyle = '#ffa31a'; g.fillRect(0, 0, 56, 56); g.fillStyle = '#000'; g.fillText('CD', 20, 32); return ok(c.toDataURL()); },
    trash(paths) { m.calls.push(['trash', paths]); return ok(paths.map(p => ({ path: p, ok: true }))); },
    restoreTrash(paths) { m.calls.push(['restoreTrash', paths]); return ok(paths.map(p => ({ path: p, ok: true, how: 'restored' }))); },
    writeTags(opId, writes) { m.calls.push(['writeTags', writes.map(w => ({ path: w.path, fields: w.fields, cover: w.cover }))]); return ok(writes.map((w, i) => ({ id: w.id, path: w.path, ok: true, size: 2000, backup: opId + '/' + (i + 1), cover: !!w.cover }))); },
    restoreTags(items) { m.calls.push(['restoreTags', items.map(i => i.path)]); return ok(items.map(i => ({ id: i.id, path: i.path, ok: true, size: 1000 }))); }
  };
  return true;
})()`;

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) { win.webContents.invalidate(); await wait(350); fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG()); console.log('captura', name); }
const click = (win, sel) => js(win, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
const clickText = (win, sel, text) => js(win, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
const confirmModal = (win) => js(win, `(() => { const b = [...document.querySelectorAll('.modal-ov:not(.cl-ov) .modal-foot .btn.primary')].pop(); if (!b) return false; b.click(); return true; })()`);
// Colores azulados (tono 190-255°, croma ≥ 12) en el diálogo de limpieza y en sus confirmaciones
const BLUE = `(() => { const bl = (c) => { const m = String(c).match(/[d.]+/g); if (!m || m.length < 3) return false; const [r, g, b, a = 1] = m.map(Number); if (!a) return false;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn; if (ch < 12) return false; let h = mx === r ? ((g - b) / ch) % 6 : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4; h *= 60; if (h < 0) h += 360; return h >= 190 && h <= 255; };
  const out = []; for (const e of document.querySelectorAll('.modal.cleanup, .modal.cleanup *, .modal-ov:not(.cl-ov) .modal, .modal-ov:not(.cl-ov) .modal *')) { const s = getComputedStyle(e);
    for (const k of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor', 'accentColor', 'boxShadow']) if (bl(s[k])) out.push((e.className || e.tagName) + ' · ' + k + ' ' + s[k]); }
  return { theme: document.documentElement.dataset.theme || 'grafito', blue: out.slice(0, 8), n: out.length }; })()`;
const until = async (win, code, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = await js(win, code); if (v && !v.error) return v; if (Date.now() - t0 > ms) return v; await wait(100); } };

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const check = (name, cond, data) => { report.checks[`${tag} · ${name}`] = { ok: !!cond, ...(data || {}) }; if (!cond) { report.ok = false; console.log('✗', tag, name, JSON.stringify(data)); } else console.log('✓', tag, name); };
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${tag} ${message} (${path.basename(src || '')}:${line})`); });
    await load(win);
    const tones = [];
    const tone = async (where) => { const r = await js(win, BLUE); tones.push({ where, ...r }); };
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(data.settings))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
    await js(win, MOCK);

    // 0) acceso: botón en la cabecera de «Todas las pistas», menú ≡ y «?»
    const acc = await js(win, `(() => { const b = document.querySelector('.lib-clean'); const vis = !!b && getComputedStyle(b).display !== 'none';
      nexuraApp.helpMenu(); const help = [...document.querySelectorAll('.ctx-item')].map(x => x.textContent); nexuraApp.closeMenus();
      document.querySelector('.lib-menu-btn').click(); const lib = [...document.querySelectorAll('.ctx-item')].map(x => x.textContent); nexuraApp.closeMenus();
      return { vis, help: help.find(t => /Limpiar biblioteca/.test(t)), lib: lib.find(t => /Limpiar biblioteca/.test(t)) }; })()`);
    check('Acceso: botón «🧹 Limpiar» en «Todas las pistas», menú ≡ y «?» → Herramientas', acc.vis && acc.help && acc.lib, acc);

    // 1) abrir: el análisis empieza solo y muestra el progreso; cancelar → resultados parciales → reanudar
    await js(win, `__nexuraCleanupMock.steps = 14; __nexuraCleanupMock.stepMs = 160; true`);
    await click(win, '.lib-clean');
    await wait(900);
    const prog = await js(win, `({ open: !!document.querySelector('.modal.cleanup'), txt: document.querySelector('.cl-status').textContent, bar: !!document.querySelector('.cl-bar.on'), tabs: [...document.querySelectorAll('.cl-tab')].map(t => t.textContent) })`);
    check('Se abre y analiza con barra de progreso; 4 pestañas', prog.open && /Leyendo los archivos/.test(prog.txt) && prog.bar && prog.tabs.length === 4 && /Historial de cambios/.test(prog.tabs[3]), prog);
    await shot(win, `${tag}-01-analizando`);
    await clickText(win, '.cl-status .btn', 'Cancelar');
    const canc = await until(win, `document.querySelector('.cl-status').textContent.includes('Análisis detenido') && document.querySelector('.cl-status').textContent`);
    check('Cancelar: resultados parciales y botón «Reanudar»', /resultados parciales/.test(canc) && /Reanudar/.test(canc), { canc });
    await shot(win, `${tag}-02-cancelado`);
    await js(win, `__nexuraCleanupMock.steps = 4; __nexuraCleanupMock.stepMs = 60; true`);
    await clickText(win, '.cl-status .btn', 'Reanudar');
    const done = await until(win, `/pistas revisadas/.test(document.querySelector('.cl-status').textContent) && document.querySelector('.cl-status').textContent`);
    check('Reanudar: análisis completo', /14 pistas revisadas en 1,7 s \(3 sin cambios/.test(done), { done });

    // 2) Duplicados
    const dup = await js(win, `({ chips: [...document.querySelectorAll('.cl-chip')].map(c => c.textContent), groups: document.querySelectorAll('.cl-group').length, keep: document.querySelector('.cl-mem.keep .cl-mem-main b')?.textContent, why: document.querySelector('.cl-g-title small')?.textContent })`);
    check('Duplicados: 1 exacto, 2 en otra calidad, 1 de versiones', /Exactos1/.test(dup.chips[0]) && /calidad2/.test(dup.chips[1]) && /Versiones.*1/.test(dup.chips[2]) && dup.groups === 1, dup);
    await shot(win, `${tag}-03-duplicados-exactos`);
    await tone("Duplicados");
    await clickText(win, '.cl-chip', 'Misma canción');
    const same = await js(win, `[...document.querySelectorAll('.cl-group')].map(g => ({ t: g.querySelector('.cl-g-title b').textContent, keep: g.querySelector('.cl-mem.keep .cl-mem-main b').textContent, why: g.querySelector('.cl-g-title small').textContent }))`);
    check('Otra calidad: conserva la de 320 kbps y el FLAC', same.length === 2 && same.some(g => /Tema B/.test(g.t) && /Pop|Tema B\.mp3/.test(g.keep)) && same.some(g => /Tema C/.test(g.t) && /\.flac$/.test(g.keep)), { same });
    await shot(win, `${tag}-04-duplicados-calidad`);
    // resolver el grupo B (la de 128 kbps tiene valoración, cues, crate, Prepare e historial)
    await js(win, `(() => { const g = [...document.querySelectorAll('.cl-group')].find(x => /Tema B/.test(x.textContent)); g.querySelector('.cl-resolve').click(); return true; })()`);
    await wait(300);
    const conf = await js(win, `document.querySelector('.modal-ov:not(.cl-ov) .modal-body')?.textContent || ''`);
    check('Resolver pide confirmación (y avisa de la Papelera)', /Papelera de Windows/.test(conf), { conf });
    await shot(win, `${tag}-05-confirmar-resolver`);
    await tone("Confirmar resolver");
    await confirmModal(win);
    await wait(600);
    const res = await js(win, `(() => { const L = nexuraApp.library, b1 = L.get('b1'); return { b2: !!L.get('b2'), fav: L.crate('fav').ids, prepare: L.prepare, hist: L.history[0].entries[0].id, rating: b1.rating, plays: b1.plays, cue: b1.cues[0] && b1.cues[0].name,
      trash: __nexuraCleanupMock.calls.filter(c => c[0] === 'trash').map(c => c[1]), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '), groups: document.querySelectorAll('.cl-group').length }; })()`);
    check('Resuelto: se quita la copia, fusiona crates/Prepare/historial/valoración/cues y la manda a la Papelera', !res.b2 && res.fav.join() === 'b1,d1' && res.prepare.join() === 'b1' && res.hist === 'b1' && res.rating === 4 && res.plays === 2 && res.cue === 'Drop' && res.trash.length === 1 && /Artista B - Tema B/.test(res.trash[0][0]) && res.groups === 1 && /Deshacer/.test(res.toast), res);
    await shot(win, `${tag}-06-resuelto`);
    await js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);

    // 3) Etiquetas: buscar en internet, marcar las de confianza alta y aplicar
    await clickText(win, '.cl-tab', 'Etiquetas');
    const tg = await js(win, `({ chips: [...document.querySelectorAll('.cl-chip')].map(c => c.textContent), cards: document.querySelectorAll('.cl-tag').length, junk: [...document.querySelectorAll('.cl-tag')].find(c => /Cancion Z/.test(c.textContent))?.querySelector('.cl-val')?.value })`);
    check('Etiquetas: propuestas (basura, MAYÚSCULAS, «Pista 01»…)', tg.cards >= 3 && tg.chips.some(c => /Basura/.test(c)) && tg.chips.some(c => /MAYÚSCULAS/.test(c)) && tg.chips.some(c => /genérico/.test(c)), tg);
    await shot(win, `${tag}-07-etiquetas`);
    await tone("Etiquetas");
    await click(win, '.cl-online');
    await until(win, `__nexuraCleanupMock.calls.some(c => c[0] === 'lookup') && !nexuraApp.cleanupUI.onlineBusy`);
    await wait(400);
    const on = await js(win, `(() => { const c = [...document.querySelectorAll('.cl-tag')].find(x => /Cancion Z/.test(x.textContent)); return { lookup: __nexuraCleanupMock.calls.find(c => c[0] === 'lookup')[1], cover: !!c && !!c.querySelector('img.cl-cover'), conf: c && [...c.querySelectorAll('.cl-conf')].map(x => x.textContent), high: document.querySelector('.cl-high').textContent }; })()`);
    check('Buscar en internet: añade año, género y carátula con su confianza', on.lookup.length >= 2 && on.cover && on.conf.some(x => /internet/.test(x)), on);
    await shot(win, `${tag}-08-etiquetas-internet`);
    await tone("Etiquetas con internet");
    await click(win, '.cl-high');
    await wait(200);
    const nsel = await js(win, `document.querySelector('.cl-apply').textContent`);
    await click(win, '.cl-apply');
    await wait(300);
    await shot(win, `${tag}-09-confirmar-etiquetas`);
    await tone("Confirmar etiquetas");
    await confirmModal(win);
    await wait(700);
    const ap = await js(win, `(() => { const L = nexuraApp.library; const w = __nexuraCleanupMock.calls.find(c => c[0] === 'writeTags'); return { e2: [L.get('e2').artist, L.get('e2').title], year: L.get('e2').year, writes: w ? w[1] : null, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }; })()`);
    check('Aplicar: cambia Nexura y escribe solo MP3/FLAC (con carátula)', ap.e2[0] === 'ArtistaZ' && ap.e2[1] === 'Cancion Z' && ap.writes && ap.writes.every(x => /\.(mp3|flac)$/i.test(x.path)) && ap.writes.some(x => x.cover) && /Deshacer/.test(ap.toast), { ...ap, nsel });
    await js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);

    // 4) Calidad: filtros y crear una crate
    await clickText(win, '.cl-tab', 'Calidad');
    const q = await js(win, `({ chips: [...document.querySelectorAll('.cl-chip')].map(c => c.textContent), rows: document.querySelectorAll('.cl-qrow').length, hint: document.querySelector('.cl-qhint')?.textContent })`);
    check('Calidad: < 128 kbps, entre 128 y 191 y archivos que no existen', q.chips.some(c => /Menos de 128/.test(c)) && q.chips.some(c => /no existe/.test(c)) && q.rows >= 1, q);
    await shot(win, `${tag}-10-calidad`);
    await tone("Calidad");
    await clickText(win, '.cl-chip', 'no existe');
    const relo = await js(win, `[...document.querySelectorAll('.cl-actions .btn')].map(b => b.textContent)`);
    check('«El archivo no existe» enlaza con «Relocalizar…»', relo.some(t => /Relocalizar/.test(t)), { relo });
    await clickText(win, '.cl-chip', 'Menos de 128');
    await click(win, '.cl-crate');
    await wait(300);
    const cr = await js(win, `(() => { const c = nexuraApp.library.crates.find(c => /Revisar/.test(c.name)); return c && { name: c.name, ids: c.ids }; })()`);
    check('«Crear crate con estas pistas»', cr && cr.ids.join() === 'q1', cr || {});

    // 5) Historial: deshacer las etiquetas y la resolución de duplicados
    await clickText(win, '.cl-tab', 'Historial');
    const hi = await js(win, `[...document.querySelectorAll('.cl-op')].map(o => o.textContent)`);
    check('Historial con las 2 operaciones', hi.length === 2 && /Etiquetas cambiadas/.test(hi[0]) && /Duplicados resueltos/.test(hi[1]), { hi });
    await shot(win, `${tag}-11-historial`);
    await tone("Historial");
    await js(win, `document.querySelector('.cl-op .cl-undo').click(); true`);
    await wait(500);
    const u1 = await js(win, `({ e2: [nexuraApp.library.get('e2').artist, nexuraApp.library.get('e2').title], rt: __nexuraCleanupMock.calls.some(c => c[0] === 'restoreTags') })`);
    check('Deshacer etiquetas: vuelven en Nexura y en los archivos', u1.e2[0] === 'ArtistaZVEVO' && /Official Video/.test(u1.e2[1]) && u1.rt, u1);
    await js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); [...document.querySelectorAll('.cl-op')][1].querySelector('.cl-undo').click(); true`);
    await wait(500);
    const u2 = await js(win, `(() => { const L = nexuraApp.library; return { b2: !!L.get('b2'), fav: L.crate('fav').ids, prepare: L.prepare, hist: L.history[0].entries[0].id, rating: L.get('b1').rating, cue: L.get('b1').cues[0], rest: __nexuraCleanupMock.calls.find(c => c[0] === 'restoreTrash'), ops: [...document.querySelectorAll('.cl-op')].map(o => o.textContent) }; })()`);
    check('Deshacer duplicados: vuelve la pista, sus crates/Prepare/historial y el archivo desde la Papelera', u2.b2 && u2.fav.join() === 'b2,d1' && u2.prepare.join() === 'b2' && u2.hist === 'b2' && u2.rating === 0 && !u2.cue && u2.rest && u2.ops.every(o => /Deshecho/.test(o)), u2);
    await shot(win, `${tag}-12-deshecho`);
    await tone('Historial deshecho');
    check('Tema Grafito: ningún azul en el diálogo (4 pestañas y confirmaciones)', tones.every(t => t.theme === 'grafito' && !t.error && t.n === 0), { tones: tones.filter(t => t.n || t.error) });

    // 6) biblioteca protegida: no se aplica nada y avisa
    await js(win, `nexuraApp.setSetting('protectLibrary', true); document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
    await clickText(win, '.cl-tab', 'Duplicados');
    await wait(400);
    await clickText(win, '.cl-chip', 'Misma canción');
    await js(win, `(() => { const g = [...document.querySelectorAll('.cl-group')].find(x => /Tema B/.test(x.textContent)); g.querySelector('.cl-resolve').click(); return true; })()`);
    await wait(300);
    const pr = await js(win, `({ modal: !!document.querySelector('.modal-ov:not(.cl-ov)'), b2: !!nexuraApp.library.get('b2'), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') })`);
    check('Protegida: no se resuelve, sin diálogo, con aviso', !pr.modal && pr.b2 && /protegida/.test(pr.toast), pr);
    await js(win, `nexuraApp.setSetting('protectLibrary', false); true`);

    // 7) los atajos del DJ no actúan con el diálogo abierto; Esc lo cierra
    win.focus(); win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(300);
    check('Esc cierra el diálogo', await js(win, `!document.querySelector('.modal.cleanup') && !nexuraApp.cleanupUI.isOpen`));
    const prio = await js(win, `__nexuraCleanupMock.calls.filter(c => c[0] === 'priority').map(c => c[1])`);
    check('Prioridad del análisis: normal sin música', prio.includes('normal'), { prio });
    win.destroy();
  }
  report.errors = report.errors.filter(e => !/favicon|ERR_|youtube|Failed to load resource/i.test(e));
  if (report.errors.length) report.ok = false;
  const lines = Object.entries(report.checks).map(([k, v]) => `${v.ok ? '✓' : '✗'} ${k}`);
  fs.writeFileSync(path.join(OUT, 'informe-web.txt'), lines.join('\n') + '\n\n' + (report.errors.length ? 'Errores de consola:\n' + report.errors.join('\n') : 'Sin errores de consola') + '\n\n' + JSON.stringify(report.checks, null, 1));
  console.log(report.errors.length ? 'Errores de consola:\n' + report.errors.join('\n') : 'Sin errores de consola');
  console.log(`${Object.values(report.checks).filter(c => c.ok).length}/${Object.keys(report.checks).length} comprobaciones correctas`);
  app.exit(report.ok ? 0 : 1);
});
