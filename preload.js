// Nexura DJ Studio — puente seguro entre la interfaz y el sistema
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Los errores de ipcMain.handle llegan como «Error invoking remote method 'x': Error: …»: se deja solo el mensaje
const plain = (p) => p.catch((e) => { throw new Error(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); });

contextBridge.exposeInMainWorld('nexura', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFolderTree: () => ipcRenderer.invoke('dialog:openFolderTree'),
  listAudioTree: (paths) => ipcRenderer.invoke('fs:listAudioTree', paths),
  openSample: () => ipcRenderer.invoke('dialog:openSample'),
  openLibraryFile: () => ipcRenderer.invoke('dialog:openLibraryFile'),
  readHead: (p, n) => ipcRenderer.invoke('fs:readHead', p, n),
  infoForPaths: (paths) => ipcRenderer.invoke('fs:infoForPaths', paths),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  existsMany: (paths) => ipcRenderer.invoke('fs:existsMany', paths),
  openPlaylist: () => ipcRenderer.invoke('dialog:openPlaylist'),
  findFiles: (names) => ipcRenderer.invoke('dialog:findFiles', names),
  artGet: (id, p) => ipcRenderer.invoke('art:get', id, p),
  storeGet: (name) => ipcRenderer.invoke('store:get', name),
  storeSet: (name, data) => ipcRenderer.invoke('store:set', name, data),
  analyzeFile: (job) => plain(ipcRenderer.invoke('analysis:run', job)),
  onFlush: (fn) => ipcRenderer.on('app:flush', async (_e, id) => { try { await fn(); } catch (_) { /* se cierra igualmente */ } ipcRenderer.send('app:flushed', id); }),
  gpu: {
    get: () => ipcRenderer.invoke('gpu:get'),
    set: (v) => ipcRenderer.invoke('gpu:set', v),
    relaunch: () => ipcRenderer.invoke('app:relaunch')
  },
  waveGet: (id) => ipcRenderer.invoke('wave:get', id),
  waveSet: (id, data) => ipcRenderer.invoke('wave:set', id, data),
  saveRecording: (data, name) => ipcRenderer.invoke('rec:save', data, name),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  log: (lines) => ipcRenderer.send('log:write', lines),
  openLogFolder: () => ipcRenderer.invoke('log:openFolder'),
  report: {
    preview: (info) => ipcRenderer.invoke('report:preview', info),
    send: (info) => ipcRenderer.invoke('report:send', info)
  },
  backup: {
    list: () => ipcRenderer.invoke('backup:list'),
    create: (reason) => ipcRenderer.invoke('backup:create', reason),
    restore: (name) => ipcRenderer.invoke('backup:restore', name),
    openFolder: () => ipcRenderer.invoke('backup:openFolder')
  },
  stats: {
    send: (info) => ipcRenderer.invoke('stats:send', info),
    preview: (info) => ipcRenderer.invoke('stats:preview', info)
  },
  updates: {
    configure: (cfg) => ipcRenderer.invoke('update:configure', cfg),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    status: () => ipcRenderer.invoke('update:status'),
    onEvent: (fn) => { const h = (_e, ev) => fn(ev); ipcRenderer.on('update:event', h); return () => ipcRenderer.removeListener('update:event', h); }
  },
  cleanup: {
    scan: (entries) => plain(ipcRenderer.invoke('cleanup:scan', entries)),
    cancel: () => ipcRenderer.invoke('cleanup:cancel'),
    priority: (v) => ipcRenderer.invoke('cleanup:priority', v),
    lookup: (queries) => plain(ipcRenderer.invoke('cleanup:lookup', queries)),
    cover: (releaseId) => ipcRenderer.invoke('cleanup:cover', releaseId),
    trash: (paths) => plain(ipcRenderer.invoke('cleanup:trash', paths)),
    restoreTrash: (paths) => plain(ipcRenderer.invoke('cleanup:restoreTrash', paths)),
    writeTags: (opId, writes) => plain(ipcRenderer.invoke('cleanup:writeTags', opId, writes)),
    restoreTags: (items) => plain(ipcRenderer.invoke('cleanup:restoreTags', items)),
    onEvent: (fn) => { const h = (_e, ev) => fn(ev); ipcRenderer.on('cleanup:event', h); return () => ipcRenderer.removeListener('cleanup:event', h); }
  },
  stems: {
    info: (dir) => ipcRenderer.invoke('stems:info', dir),
    status: (ids, dir) => ipcRenderer.invoke('stems:status', ids, dir),
    read: (id, dir) => ipcRenderer.invoke('stems:read', id, dir),
    remove: (id, dir) => ipcRenderer.invoke('stems:delete', id, dir),
    install: () => ipcRenderer.invoke('stems:install'),
    separate: (jobs, dir, model) => ipcRenderer.invoke('stems:separate', jobs, dir, model),
    cancel: () => ipcRenderer.invoke('stems:cancel'),
    onEvent: (fn) => { const h = (_e, ev) => fn(ev); ipcRenderer.on('stems:event', h); return () => ipcRenderer.removeListener('stems:event', h); }
  },
  spotify: {
    embed: (type, id) => ipcRenderer.invoke('spotify:embed', type, id),
    api: (url) => ipcRenderer.invoke('spotify:api', url),
    login: (clientId) => ipcRenderer.invoke('spotify:login', clientId),
    logout: () => ipcRenderer.invoke('spotify:logout'),
    status: () => ipcRenderer.invoke('spotify:status')
  },
  yt: {
    oembed: (id) => ipcRenderer.invoke('yt:oembed', id),
    api: (endpoint, params, apiKey) => plain(ipcRenderer.invoke('yt:api', endpoint, params, apiKey)),
    search: (q, max) => ipcRenderer.invoke('yt:search', q, max),
    checkKey: (key) => ipcRenderer.invoke('yt:checkKey', key),
    login: (clientId, clientSecret) => ipcRenderer.invoke('yt:login', clientId, clientSecret),
    logout: () => ipcRenderer.invoke('yt:logout'),
    status: () => ipcRenderer.invoke('yt:status')
  }
});
