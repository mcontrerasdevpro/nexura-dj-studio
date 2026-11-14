// Nexura DJ Studio — puente de la ventana oculta de análisis (src/analysis.html): recibe trabajos y devuelve
// resultados al proceso principal (main.js → analysisWindow), que los reenvía a la interfaz
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexuraAnalysis', {
  onJob: (fn) => ipcRenderer.on('analysis:job', (_e, job) => fn(job)),
  done: (msg) => ipcRenderer.send('analysis:done', msg)
});
