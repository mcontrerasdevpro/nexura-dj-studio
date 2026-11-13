// Hilo de trabajo de «Limpiar biblioteca»: lee los archivos y calcula las huellas sin frenar el proceso
// principal. Mensajes: { t: 'scan', entries, cacheFile } · { t: 'cancel' } · { t: 'priority', v: 'low'|'normal' }.
// Responde { t: 'progress', … } mientras trabaja y { t: 'done', result } o { t: 'error', message } al acabar.
'use strict';
const { parentPort } = require('worker_threads');
const { scanEntries, createCache } = require('./cleanup-scan');

let cancel = false, prio = 'normal', busy = false;
parentPort.on('message', async (m) => {
  if (!m) return;
  if (m.t === 'cancel') { cancel = true; return; }
  if (m.t === 'priority') { prio = m.v === 'low' ? 'low' : 'normal'; return; }
  if (m.t !== 'scan' || busy) return;
  busy = true; cancel = false;
  if (m.priority) prio = m.priority;
  try {
    const result = await scanEntries(m.entries || [], {
      cache: createCache(m.cacheFile), cancelled: () => cancel, priority: () => prio,
      onProgress: (ev) => parentPort.postMessage(ev)
    });
    parentPort.postMessage({ t: 'done', result });
  } catch (e) {
    parentPort.postMessage({ t: 'error', message: String((e && e.message) || e) });
  } finally { busy = false; }
});
