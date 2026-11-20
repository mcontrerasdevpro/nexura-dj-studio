// Prueba de interfaz de «+ Spotify» con Electron contra `npm run web`, en modo simulado: la página de
// inserción devuelve el fixture tools/fixtures/spotify-embed-playlist.html, la «cuenta» y la API de
// Spotify son falsas y la búsqueda de YouTube está simulada (no hay credenciales ni se descarga nada).
// Guarda capturas e informe en .revision/spotify/. Uso: npx electron tools/ui-check-spotify.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'spotify');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812], [1496, 885]];
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'spotify-embed-playlist.html'), 'utf8');
const LOCAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'spotify-local-library.json'), 'utf8'));
const LIST_URL = 'https://open.spotify.com/intl-es/playlist/5NxFixturePlaylist0001?si=prueba';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now();
  const tracks = LOCAL.map((t, i) => ({
    id: t.id, path: `web:${t.artist ? t.artist + ' - ' : ''}${t.title}.mp3:${1000 + i}`, source: 'local', title: t.title, artist: t.artist, album: '', genre: 'House', year: '', comment: '', rating: 0, isrc: t.isrc || '',
    bpm: 124, firstBeat: 0, key: '', camelot: '8A', duration: t.duration, size: 1000 + i, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
    added: now - i * 86400000, plays: 0, lastPlayed: 0, analyzed: true
  }));
  return { library: { version: 1, tracks, crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }, settings: { libView: 'all' } };
}

// Simulación de Spotify y YouTube dentro de la página
const MOCK = (fixture) => `(() => {
  const fixture = ${JSON.stringify(fixture)};
  const m = window.__nexuraSpotifyMock = {
    connected: false, html: fixture, calls: [],
    async embed(type, id) { m.calls.push('embed:' + type + ':' + id); return m.html; },
    async api(url) {
      m.calls.push('api:' + url);
      // lista de 130 pistas en 3 páginas de /items (la API se usa solo con la «cuenta» conectada)
      const u = new URL(url, 'https://api.spotify.com');
      if (/\\/v1\\/playlists\\/[^/]+$/.test(u.pathname)) return { ok: true, status: 200, data: { name: 'Lista larga (API)', owner: { display_name: 'Prueba' }, images: [], items: { total: 130 } } };
      if (/\\/items$/.test(u.pathname)) {
        const off = +(u.searchParams.get('offset') || 0), lim = 50;
        const items = Array.from({ length: Math.min(lim, 130 - off) }, (_, i) => ({ item: { type: 'track', name: 'Pista ' + (off + i + 1), artists: [{ name: 'Artista API' }], duration_ms: 200000, uri: 'spotify:track:' + String(off + i).padStart(22, '0'), external_ids: { isrc: '' } } }));
        return { ok: true, status: 200, data: { items, total: 130, next: off + lim < 130 ? 'https://api.spotify.com' + u.pathname + '?limit=50&offset=' + (off + lim) : null } };
      }
      if (u.pathname === '/v1/me/playlists') return { ok: true, status: 200, data: { items: [{ id: '5NxFixturePlaylist0001', name: 'Nexura · Prueba DJ', owner: { display_name: 'Prueba' }, items: { total: 16 }, images: [] }], next: null } };
      return { ok: false, status: 404, data: null };
    },
    async login() { m.connected = true; return { ok: true, user: 'Prueba' }; },
    async logout() { m.connected = false; return true; },
    async status() { return { connected: m.connected, user: m.connected ? 'Prueba' : '', redirectUri: 'http://127.0.0.1:43827/callback' }; }
  };
  const app = nexuraApp;
  window.__opened = [];
  app.platform.openExternal = (u) => { window.__opened.push(u); };
  app.youtube.canUseApi = async () => true;
  app.youtube.search = async (q) => /inedita|desconocido/i.test(q) ? [] : [
    { videoId: ('v' + Math.abs([...q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)).padEnd(11, 'x').slice(0, 11), title: q + ' (Official Audio)', channel: 'Artista - Topic', duration: 0, thumb: '' },
    { videoId: 'karaokexxxx', title: q + ' (Karaoke Version)', channel: 'Karaoke', duration: 0, thumb: '' }
  ];
  return true;
})()`;

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
const until = async (win, cond, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(win, `!!(${cond})`) === true) return true; await wait(150); } return false; };
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(600);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('captura', name);
}
const counts = `Object.fromEntries([...document.querySelectorAll('.sp-count')].map(e => [e.className.split(' ').pop(), parseInt(e.textContent.replace(/^\\D+/, ''), 10)]))`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {} };
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    const tag = `${w}x${h}`;
    const full = w >= 1280;
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);
    await js(win, MOCK(FIXTURE));
    const c = report.checks[tag] = {};

    // 1) «+ Importar» de LISTAS ONLINE en la barra lateral (menú → «Lista de Spotify…»)
    if (w < 760) await js(win, `document.querySelector('#library').classList.add('tree-toggled'); true`);
    c.boton = await js(win, `(() => { const b = document.querySelector('.lib-side [data-sec=online] .sec-btn'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { texto: b.textContent, visible: r.width > 0 && r.height > 0 }; })()`);
    await js(win, `document.querySelector('#library').scrollIntoView({ block: 'end' }); true`);
    if (full) await shot(win, `${tag}-01-barra-lateral`);

    // 2) pegar el enlace en el diálogo y leer la lista (página pública simulada)
    await js(win, `document.querySelector('.lib-side [data-sec=online] .sec-btn').click(); const it = [...document.querySelectorAll('.ctx.root .ctx-item')].find(x => x.textContent.startsWith('Lista de Spotify')); it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
    await until(win, `document.querySelector('.sp-url')`);
    await js(win, `(() => { const i = document.querySelector('.sp-url'); i.value = ${JSON.stringify(LIST_URL)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await until(win, `document.querySelectorAll('.sp-row').length >= 16`);
    c.lectura = await js(win, `({ filas: document.querySelectorAll('.sp-row').length, recuentos: ${counts}, titulo: document.querySelector('.sp-meta b')?.textContent, llamadas: __nexuraSpotifyMock.calls.slice(), aviso: document.querySelector('.sp-status').textContent,
      revisar: [...document.querySelectorAll('.sp-row.review b')].map(b => b.textContent), modalAbierto: !!document.querySelector('.sp-import'),
      // sin scroll horizontal: elementos que se salen de la tabla
      desborda: (() => { const box = document.querySelector('.sp-rows'), r = box.getBoundingClientRect(), mb = document.querySelector('.modal-body'); return { scroll: box.scrollWidth - box.clientWidth, dialogo: mb.scrollWidth - mb.clientWidth, fuera: [...box.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > r.right + 1).slice(0, 4).map(e => e.className + ' ' + Math.round(e.getBoundingClientRect().right - r.right)) }; })() })`);
    await shot(win, `${tag}-02-resultado`);

    // 3) «Comprar» abre el menú con las tres tiendas
    c.comprar = await js(win, `(() => {
      const row = [...document.querySelectorAll('.sp-row')].find(r => r.textContent.includes('Inédita'));
      const b = [...row.querySelectorAll('button')].find(x => x.textContent === '🛒'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 600, clientY: 300 }));
      const items = [...document.querySelectorAll('.ctx.root .ctx-item')].map(x => x.textContent);
      return { items };
    })()`);
    if (full) await shot(win, `${tag}-03-comprar`);
    c.comprar.abre = await js(win, `(() => { document.querySelector('.ctx.root .ctx-item').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return window.__opened.slice(); })()`);

    // 4) buscar en YouTube las que faltan (búsqueda simulada; se evita el karaoke)
    await js(win, `[...document.querySelectorAll('.sp-tools button')].find(b => b.textContent.includes('YouTube')).click(); true`);
    await until(win, `!document.querySelector('.sp-tools button')?.textContent.includes('Detener') && document.querySelectorAll('.sp-row.yt').length`);
    c.youtube = await js(win, `({ recuentos: ${counts}, videos: [...document.querySelectorAll('.sp-row.yt .sp-yt')].map(e => e.textContent), estado: document.querySelector('.sp-status').textContent })`);
    await shot(win, `${tag}-04-youtube`);

    // 5) aceptar las dudosas y crear la crate en el orden de la lista
    await js(win, `[...document.querySelectorAll('.sp-tools button')].find(b => b.textContent.includes('dudosas')).click(); true`);
    await wait(200);
    c.crate = await js(win, `(() => {
      const main = document.querySelector('.sp-foot .btn.primary'); const texto = main.textContent; main.click();
      const L = nexuraApp.library, cr = L.crates.find(x => x.spotify);
      return { boton: texto, nombre: cr && cr.name, pistas: cr && cr.ids.length, primeras: cr && cr.ids.slice(0, 6), vista: nexuraApp.libraryUI.viewId, guardado: cr && cr.spotify.items.length, clave: cr && cr.spotify.key, modalCerrado: !document.querySelector('.sp-import') };
    })()`);
    await wait(400);
    await shot(win, `${tag}-05-crate`);

    // 6) reimportar la misma lista (con una pista menos y otra nueva) actualiza la crate
    await js(win, `__nexuraSpotifyMock.html = __nexuraSpotifyMock.html.replace('"title":"Losing It"', '"title":"Pista Nueva Que No Está"'); true`);
    await js(win, `(() => { const s = nexuraApp.libraryUI.searchIn; s.value = 'spotify:playlist:5NxFixturePlaylist0001'; s.dispatchEvent(new Event('input')); return true; })()`);
    await until(win, `document.querySelectorAll('.sp-row').length >= 16`);
    c.reimportar = await js(win, `(() => {
      const main = document.querySelector('.sp-foot .btn.primary'); const texto = main.textContent; main.click();
      const L = nexuraApp.library;
      return { boton: texto, crates: L.crates.length, pistas: L.crates[0].ids.length, sinLosingIt: !L.crates[0].ids.includes('l17'), dudosasRecordadas: L.crates[0].ids.includes('l19') };
    })()`);

    // 7) biblioteca protegida: no se crean ni cambian crates → se ofrece Prepare
    await js(win, `nexuraApp.setSetting('protectLibrary', true); nexuraApp.library.protected = true; nexuraApp.spotifyImportDialog(${JSON.stringify(LIST_URL)}); true`);
    await until(win, `document.querySelectorAll('.sp-row').length >= 16`);
    c.protegida = await js(win, `({ boton: document.querySelector('.sp-foot .btn.primary').textContent, aviso: document.querySelector('.sp-foot .set-note')?.textContent || '' })`);
    await shot(win, `${tag}-06-protegida`);
    c.protegida.tras = await js(win, `(() => { document.querySelector('.sp-foot .btn.primary').click(); const L = nexuraApp.library; return { prepare: L.prepare.length, crates: L.crates.length, vista: nexuraApp.libraryUI.viewId }; })()`);
    await js(win, `nexuraApp.setSetting('protectLibrary', false); nexuraApp.library.protected = false; true`);

    // 8) con la «cuenta» conectada: lista de 130 pistas por la API (3 páginas) y «Mis listas»
    c.api = await js(win, `(async () => {
      __nexuraSpotifyMock.connected = true; __nexuraSpotifyMock.calls = [];
      const r = await nexuraApp.spotify.importList('https://open.spotify.com/playlist/5NxApiLongPlaylist0001');
      const mine = await nexuraApp.spotify.myPlaylists();
      return { origen: r.source, nombre: r.name, pistas: r.tracks.length, ultima: r.tracks[r.tracks.length - 1].title, paginas: __nexuraSpotifyMock.calls.filter(x => x.includes('/items')).length, misListas: mine.map(x => x.name + ' (' + x.count + ')') };
    })()`);
    // si la API no deja leer una lista (404), se usa la página pública
    c.respaldo = await js(win, `(async () => {
      const r = await nexuraApp.spotify.importList('spotify:album:5NxFixtureAlbum0000001');
      return { origen: r.source, pistas: r.tracks.length, aviso: r.warning };
    })()`);

    // 9) Ajustes → Spotify (instrucciones y redirect URI)
    await js(win, `nexuraApp.settingsUI.open('spotify'); true`);
    await until(win, `document.querySelector('.sp-redirect code')`);
    c.ajustes = await js(win, `({ redirect: document.querySelector('.sp-redirect code').textContent, pasos: document.querySelectorAll('.sp-steps li').length, estado: document.querySelector('.set-page .status-pill').textContent })`);
    await shot(win, `${tag}-07-ajustes`);
    await js(win, `nexuraApp.closeModal(); true`);
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'ui-check-spotify.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
});
