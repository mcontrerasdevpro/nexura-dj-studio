// Ventana de ajustes
import { el, toast } from '../util.js';
import { btn, select } from './controls.js';
import { describeKey, REL_NAMES } from '../midi/midi.js';
import { parseMixxxMapping } from '../midi/mixxx-import.js';
import { MidiWizard } from './midi-wizard.js';
import { platform } from '../platform.js';
import { STATS_FIELDS_TEXT } from './legal-ui.js';
import { CRATE_SORTS } from '../library/library.js';
import { THEMES } from './theme.js';

const TABS = { general: 'General', audio: 'Audio', ai: '✨ IA', play: 'Reproducción', library: 'Biblioteca', midi: 'MIDI / Controladores', expansions: 'Expansiones', youtube: 'YouTube', spotify: 'Spotify', keys: 'Atajos', about: 'Acerca de' };
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const BACKUP_REASONS = { auto: 'Automática', manual: 'Manual', actualizacion: 'Antes de actualizar', 'antes-de-restaurar': 'Antes de restaurar' };

export class SettingsUI {
  constructor(app) { this.app = app; this.tab = 'general'; }

  open(tab) {
    if (tab) this.tab = tab;
    this.body = el('div', { class: 'settings' });
    this.render();
    this.app.modal('Ajustes', this.body, ['Cerrar']).then(() => {
      this.app.midi.cancelLearn();
      if (this.offMsg) this.offMsg();
      this.body = null;
    });
  }

  render() {
    if (this.offMsg) { this.offMsg(); this.offMsg = null; }
    if (!this.body) return;
    this.body.innerHTML = '';
    const nav = el('div', { class: 'set-nav' }, ...Object.entries(TABS).map(([k, l]) => {
      const b = el('button', { class: 'set-tab' + (k === this.tab ? ' on' : '') }, l);
      b.addEventListener('click', () => { this.tab = k; if (this.offMsg) { this.offMsg(); this.offMsg = null; } this.render(); });
      return b;
    }));
    const page = el('div', { class: 'set-page' });
    this.body.append(nav, page);
    this['page_' + this.tab](page);
  }

  row(label, control, hint) {
    return el('div', { class: 'set-row' }, el('div', { class: 'set-label' }, label, hint ? el('small', {}, hint) : null), el('div', { class: 'set-ctl' }, control));
  }
  // Campo para claves y secretos: muestra solo el principio («AIza••••••••»); al entrar se pega una nueva
  // (tipo contraseña; vacío = se queda la actual) y 👁 la enseña 5 s. Devuelve { box, input, value, commit }.
  secretField(value, placeholder, save, mask) {
    let real = String(value || ''), editing = false, shown = 0;
    const input = el('input', { class: 'wide secret', type: 'text', spellcheck: 'false', autocomplete: 'off' });
    const eye = el('button', { class: 'btn micro eye', type: 'button', title: 'Ver un momento', 'aria-label': 'Ver un momento' }, '👁');
    const del = btn('Quitar', { cls: 'micro', title: 'Borrar la clave guardada' });
    const idle = () => {
      clearTimeout(shown); shown = 0; editing = false;
      input.type = 'text'; input.readOnly = false;
      input.value = mask(real);
      input.placeholder = placeholder;
      eye.disabled = !real; del.hidden = !real;
      eye.classList.remove('on');
    };
    const f = {
      box: el('div', { class: 'secret-box' }, input, eye, del), input,
      get value() { return real; },
      // guarda lo escrito (nunca la máscara) y vuelve a ocultar
      commit() {
        if (shown) return;
        const v = input.value.trim();
        if (v && !v.includes('•') && v !== real) { real = v; save(v); }
        idle();
      }
    };
    input.addEventListener('focus', () => {
      if (shown || editing) return;
      editing = true;
      input.type = 'password'; input.value = '';
      input.placeholder = real ? 'Pega una nueva (vacío = mantener la actual)' : placeholder;
    });
    input.addEventListener('blur', () => f.commit());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.commit(); input.blur(); } else if (e.key === 'Escape' && editing) { e.stopPropagation(); idle(); input.blur(); } });
    eye.addEventListener('mousedown', (e) => e.preventDefault());
    eye.addEventListener('click', () => {
      if (shown) return idle();
      f.commit();
      if (!real) return;
      input.type = 'text'; input.readOnly = true; input.value = real;
      eye.classList.add('on');
      shown = setTimeout(idle, 5000);
    });
    del.addEventListener('click', () => { real = ''; save(''); idle(); });
    idle();
    return f;
  }
  toggle(key, onChange) {
    const s = this.app.settings;
    const t = el('input', { type: 'checkbox', class: 'switch' });
    t.checked = !!s[key];
    t.addEventListener('change', () => { this.app.setSetting(key, t.checked); onChange && onChange(t.checked); });
    return t;
  }
  number(key, min, max, step = 1) {
    const i = el('input', { type: 'number', min, max, step, value: this.app.settings[key], class: 'num-in' });
    i.addEventListener('change', () => this.app.setSetting(key, parseFloat(i.value)));
    return i;
  }

  page_general(p) {
    const app = this.app, s = app.settings, info = app.info || {};
    const updState = el('small', { id: 'set-upd-state' }, app.updatesUI?.available ? `Versión instalada: ${info.version}` : 'Solo en la app instalada con el instalador (no en la Microsoft Store, que actualiza ella misma, ni en modo navegador).');
    const checkNow = btn('Buscar ahora', { cls: 'small', onClick: () => app.updatesUI.checkNow((msg) => { updState.textContent = msg; }) });
    checkNow.id = 'set-upd-check';
    const statsT = el('input', { type: 'checkbox', class: 'switch', id: 'set-stats' });
    statsT.checked = s.statsEnabled === true;
    statsT.addEventListener('change', () => { app.setSetting('statsEnabled', statsT.checked); if (statsT.checked) app.sendStatsSoon(); });
    const preview = el('pre', { class: 'fb-preview', id: 'set-stats-preview' }, '…');
    platform.stats.preview({ decks: app.deckCount, controller: !!app.midi?.controllerName })
      .then(j => { preview.textContent = JSON.stringify({ ...j, id: '(identificador aleatorio de esta instalación)' }, null, 2); })
      .catch(() => { preview.textContent = '—'; });
    const themeSel = select(THEMES, s.theme, (v) => app.setSetting('theme', v));
    themeSel.id = 'set-theme';
    p.append(...[
      el('h3', {}, 'Apariencia'),
      this.row('Tema de color', themeSel, 'Grafito: gris oscuro neutro, el color solo marca lo importante (Deck 1 azul, Deck 2 rojo, selección ámbar). Carbón: aún más oscuro. Azul noche: la paleta azul de las versiones anteriores. Se aplica al momento'),
      el('h3', {}, 'Actualizaciones'),
      this.row('Buscar actualizaciones automáticamente', this.toggle('autoUpdate'), 'Al abrir la app y cada 6 horas, en segundo plano. Si hay una versión nueva verás un aviso abajo; tú decides cuándo descargarla. Nunca se reinicia con música sonando: en ese caso se instala al cerrar'),
      this.row('Recibir versiones de prueba', this.toggle('prereleaseUpdates'), 'Ofrece también versiones -rc y -beta (pueden tener errores)'),
      this.row(checkNow, updState),
      el('h3', {}, 'Estadísticas anónimas'),
      this.row('Enviar estadísticas anónimas de uso', statsT, 'Como mucho una vez al día y solo esto: ' + STATS_FIELDS_TEXT + ' Nunca tu música, tus archivos ni datos personales'),
      el('p', { class: 'hint' }, 'Esto es exactamente lo que se envía:'), preview,
      info.services && !info.services.stats ? el('p', { class: 'set-note' }, 'En esta versión el contador todavía no tiene servidor: aunque lo actives, no se envía nada.') : null,
      el('h3', {}, 'Bienvenida'),
      this.row('Pantalla de bienvenida', btn('Ver bienvenida', { cls: 'small', onClick: () => { this.app.closeModal(); this.app.welcome.open(); } }), 'Los primeros pasos: añadir música, conectar la controladora y privacidad')].filter(Boolean));
  }

  async page_audio(p) {
    const app = this.app, s = app.settings;
    const outs = await app.engine.listOutputs();
    const opts = { '': 'Predeterminado del sistema', ...Object.fromEntries(outs.filter(o => o.id !== 'default' && o.id !== 'communications').map(o => [o.id, o.label])) };
    p.append(...[
      el('h3', {}, 'Salida de audio'),
      el('p', { class: 'hint' }, 'Conecta tu controladora o interfaz de audio por USB y selecciónala como dispositivo master. Si tiene 4 canales, en modo automático el master sale por 1/2 y los auriculares por 3/4.'),
      el('p', { class: 'hint' }, 'Si solo tienes una salida estéreo (por ejemplo, un portátil sin interfaz DJ), activa SPLIT en el mezclador: izquierda = CUE/PFL y derecha = MASTER. Conecta los auriculares a esa salida; es una escucha dividida, no una mezcla estéreo convencional. Sin Split ni salida cue independiente, la salida estéreo reproduce solo el master.'),
      this.row('Modo de salida', select({ auto: 'Automático', '4ch': '4 canales (Master 1/2 · Cue 3/4)', separate: 'Master y cue en dispositivos separados', stereo: 'Solo master estéreo', external: 'Mesa de mezclas externa (un deck por canal)' }, s.outputMode, (v) => { app.setSetting('outputMode', v); app.applyOutputs().then(() => this.render()); })),
      s.outputMode === 'external' ? el('p', { class: 'hint ok' }, 'Mesa externa: cada deck sale sin mezclar a su propio canal de tu mesa. Con una interfaz de 4 salidas: Deck 1 (y el sampler) → salidas 1/2 y Deck 2 → salidas 3/4. Con dos tarjetas: Deck 1 por el «dispositivo master» y Deck 2 por el «segundo dispositivo». Con una sola salida estéreo: Deck 1 por la izquierda y Deck 2 por la derecha (en mono, con un cable en Y). El EQ, el filtro, los faders, el crossfader y el cue se manejan en la mesa; los efectos, el pitch y los loops siguen funcionando aquí. Las pistas de YouTube y la grabación interna no pasan por este modo.') : null,
      this.row('Dispositivo master', select(opts, s.masterDevice, (v) => { app.setSetting('masterDevice', v); app.applyOutputs(); }), s.outputMode === 'external' ? 'Deck 1' : null),
      this.row(s.outputMode === 'external' ? 'Segundo dispositivo (Deck 2)' : 'Dispositivo de auriculares', select(opts, s.cueDevice, (v) => { app.setSetting('cueDevice', v); app.applyOutputs(); }), s.outputMode === 'external' ? 'Solo si no usas una interfaz de 4 salidas' : 'Solo para el modo «dispositivos separados»'),
      this.row('Latencia', select({ low: 'Baja (5 ms)', normal: 'Normal', safe: 'Segura' }, s.latency, (v) => { app.setSetting('latency', v); toast('Reinicia la aplicación para aplicar la latencia', 'info'); })),
      el('p', { class: 'hint' }, `Modo actual: ${app.outputDesc || '—'} · Canales del dispositivo: ${app.engine.ctx.destination.maxChannelCount} · Frecuencia: ${app.engine.ctx.sampleRate} Hz · Latencia: ${Math.round((app.engine.ctx.baseLatency + (app.engine.ctx.outputLatency || 0)) * 1000)} ms`),
      el('h3', {}, 'Grabación'),
      el('p', { class: 'hint' }, `Las grabaciones (WAV) se guardan en: ${app.info.recordings}`),
      btn('Probar salida (tono 1 s)', { cls: 'small', onClick: () => this.testTone() })].filter(Boolean));
  }
  testTone() {
    const ctx = this.app.engine.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0.15; o.frequency.value = 440;
    o.connect(g).connect(this.app.engine.masterBus);
    o.start(); o.stop(ctx.currentTime + 1);
  }

  async page_ai(p) {
    const app = this.app, s = app.settings;
    const url = el('input', { value: s.ollamaUrl || 'http://127.0.0.1:11434', class: 'wide' });
    url.addEventListener('change', () => { app.setSetting('ollamaUrl', url.value.trim()); this.render(); });
    const modelSel = el('select', { class: 'sel' }, el('option', { value: '' }, 'Sin Ollama (intérprete de reglas)'));
    const st = el('small', {}, 'Comprobando Ollama…');
    modelSel.addEventListener('change', () => { app.setSetting('ollamaModel', modelSel.value); app.setSetting('ollamaModelChosen', true); });
    p.append(
      el('h3', {}, 'Asistente IA'),
      el('p', { class: 'set-note' }, 'Todo funciona en tu ordenador: ningún dato ni pista sale de él.'),
      this.row('Cues automáticos al analizar', this.toggle('aiAutoCues'), 'Marca intro, drops, breaks y outro en pistas sin hot cues'),
      this.row('Compases de transición del Automix', this.number('automixBars', 4, 64, 4), 'Duración del fundido entre pistas (16 = transición larga clásica)'),
      ...this.stemsRows(),
      el('h3', {}, 'Pedir sets por texto (Ollama)'),
      this.row('Dirección de Ollama', url),
      this.row('Modelo', modelSel, st));
    try {
      const { ollamaModels } = await import('../ai/prompt.js');
      const models = await ollamaModels(url.value);
      for (const m of models) modelSel.appendChild(el('option', { value: m }, m));
      // primera vez con Ollama conectado: elegir un modelo automáticamente (preferir gemma/qwen/llama)
      if (s.ollamaModel == null || (s.ollamaModel === '' && !s.ollamaModelChosen && models.length)) {
        const pick = models.find(m => /gemma|qwen|llama|mistral/i.test(m) && !/embed/i.test(m)) || models[0];
        if (pick) app.setSetting('ollamaModel', pick);
      }
      modelSel.value = models.includes(app.settings.ollamaModel) ? app.settings.ollamaModel : '';
      st.textContent = models.length ? `Ollama conectado · ${models.length} modelo(s)` : 'Ollama conectado, pero sin modelos';
    } catch (e) {
      st.textContent = 'Ollama no responde: se usará el intérprete de reglas (funciona igual para peticiones sencillas)';
    }
  }

  stemsRows() {
    const app = this.app, s = app.settings;
    if (!app.stems || !app.stems.available) return [el('h3', {}, 'Stems (IA)'), el('p', { class: 'set-note' }, 'La separación en stems solo está disponible en la app de escritorio.')];
    const dir = el('input', { value: s.stemsDir || '', class: 'wide', placeholder: 'Por defecto: E:\\IA\\stems' });
    dir.addEventListener('change', () => { app.setSetting('stemsDir', dir.value.trim()); app.stems.refreshStatus(); this.render(); });
    const st = el('small', {}, 'Comprobando el motor…');
    const inst = btn('Instalar motor', { cls: 'small', onClick: async () => { inst.disabled = true; await app.stems.install(); this.render(); } });
    app.stems.getInfo().then(i => {
      st.textContent = i.installed ? `Instalado · stems en ${i.dir}` : `No instalado · los stems se guardarán en ${i.dir}`;
      inst.textContent = i.installed ? 'Reinstalar / actualizar' : 'Instalar motor (≈3 GB)';
    }).catch(e => { st.textContent = 'Error: ' + e.message; });
    return [
      el('h3', {}, 'Stems (IA)'),
      el('p', { class: 'set-note' }, 'Separa cada pista en voz, batería, bajo y melodía con Demucs (Meta, licencia MIT) en tu GPU. Se separa una vez y se guarda; después los stems se cargan solos.'),
      this.row('Motor de separación', inst, st),
      this.row('Carpeta de stems', dir, 'Unos 40 MB por pista (FLAC). Déjalo vacío para usar la carpeta por defecto'),
      this.row('Calidad', select({ htdemucs: 'Normal (rápido)', htdemucs_ft: 'Alta (4× más lento)' }, s.stemsModel || 'htdemucs', (v) => app.setSetting('stemsModel', v))),
      this.row('Cargar stems al cargar la pista', this.toggle('stemsAuto'), 'Usa algo más de memoria por deck'),
      this.row('Separar en segundo plano', this.toggle('stemsBackground'), 'Separa sola las pistas de Prepare y las cargadas en los decks (con el motor ya instalado), de tres en tres')
    ];
  }

  page_play(p) {
    const app = this.app, s = app.settings;
    p.append(
      el('h3', {}, 'Decks'),
      this.row('Decks en pantalla', select({ auto: 'Automático (según la controladora)', 2: '2 decks', 4: '4 decks' }, String(s.deckLayout || 'auto'), (v) => app.setSetting('deckLayout', v)),
        `Ahora: ${app.deckCount} decks. Con una controladora de 4 decks (o un perfil MIDI que use los decks 3 y 4) aparecen los decks 3 y 4; con una de 2, no.`),
      this.row('Rango de pitch por defecto', select({ 0.08: '±8 %', 0.16: '±16 %', 0.5: '±50 %' }, String(s.pitchRange), (v) => { app.setSetting('pitchRange', parseFloat(v)); app.decks.forEach(d => d.setRange(parseFloat(v))); })),
      this.row('Key lock activado al cargar', this.toggle('keylockDefault')),
      this.row('Cuantización (Q)', this.toggle('quantize'), 'Hot cues, loops y saltos se ajustan al beat'),
      this.row('Cue Loops', this.toggle('cueLoops'), 'Con un loop activo, un hot cue vacío guarda el loop; al pulsarlo salta y lo activa. Hay además un modo de pads «Cue Loop» con 8 cues con loop propios'),
      this.row('Retorno del slip (ms)', this.number('slipRelease', 0, 1000, 10), 'Al soltar el slip (scratch, roll, censor o loop), fundido hasta la posición en la que iría la pista. 0 = salto inmediato'),
      this.row('Stem Slip', select({ mute: 'Silenciar el stem mientras se mantiene', loop: 'Repetir el stem en loop mientras se mantiene' }, s.stemSlipMode || 'mute', (v) => app.setSetting('stemSlipMode', v)), 'Modo de pads Stems con SLIP activado (o acciones MIDI «Stem Slip»): al soltar, el stem vuelve en su sitio'),
      this.row('Beats del loop de Stem Slip', select({ 0.25: '1/4', 0.5: '1/2', 1: '1', 2: '2' }, String(s.stemSlipBeats || 1), (v) => app.setSetting('stemSlipBeats', Number(v)))),
      this.row('Sync con alineación de fase', this.toggle('syncPhase')),
      this.row('Auto-gain al cargar', this.toggle('autoGain'), 'Iguala el volumen según el análisis'),
      this.row('Al cargar sobre un deck que está sonando', select({ play: 'Sustituir y seguir sonando', pause: 'Sustituir y dejar en pausa', block: 'No permitir (proteger en directo)' }, s.loadOnPlaying || 'play', (v) => app.setSetting('loadOnPlaying', v)), 'Para directo puedes protegerlo y evitar cambiar por error la pista que suena'),
      this.row('Arranque del motor (ms)', this.number('motorStart', 2, 3000, 10), 'Tiempo hasta velocidad completa al pulsar play'),
      this.row('Frenado del motor (ms)', this.number('motorStop', 2, 3000, 10), 'Efecto «brake» al pausar'),
      this.row('Registrar en historial tras (s)', this.number('historyAfter', 5, 300, 5)),
      el('h3', {}, 'Análisis'),
      this.row('Analizar al importar', this.toggle('autoAnalyze')),
      this.row('Rango de BPM mínimo', this.number('minBpm', 50, 120, 1)),
      this.row('Rango de BPM máximo', this.number('maxBpm', 100, 220, 1), 'Los BPM detectados se ajustan a este rango (× ½ / × 2)'));
  }

  page_library(p) {
    const app = this.app, s = app.settings;
    p.append(
      el('h3', {}, 'Biblioteca'),
      this.row('Proteger biblioteca', this.toggle('protectLibrary'), 'No se pueden borrar ni renombrar pistas, crates ni smart crates, ni editar etiquetas, valoraciones, BPM o beatgrid, ni mover pistas entre crates. Sí se puede cargar, buscar, ordenar, analizar pistas nuevas y usar Prepare e Historial. También con el candado 🔒 de la biblioteca'),
      this.row('Mismas columnas en todos los crates', this.toggle('libColsSame'), 'Si lo desactivas, cada crate recuerda sus columnas (clic derecho en la cabecera de la tabla para elegirlas)'),
      this.row('Tamaño de la carátula', select({ small: 'Pequeña', medium: 'Mediana' }, s.libArtSize || 'small', (v) => app.setSetting('libArtSize', v)), 'La columna «Carátula» está oculta por defecto'),
      this.row('Barra de iconos en la biblioteca', select({ auto: 'Automática', on: 'Siempre', off: 'Nunca' }, s.libRail || 'auto', (v) => app.setSetting('libRail', v)), 'Columna de iconos (Todas, IA, Prepare, Crates, Smart, YouTube, Spotify, Historial) junto al árbol. Automática: en modo laptop y con la ventana de 1100 px de ancho o menos. También con el botón pequeño junto al buscador de la barra lateral'),
      this.row('Orden de las crates', select(CRATE_SORTS, s.crateSort || 'custom', (v) => { app.setSetting('crateSort', v); app.libraryUI.renderSide(); }), 'Se aplica dentro de cada nivel de subcrates'),
      this.row('Mostrar pistas de los subcrates en el crate padre', this.toggle('crateSubTracks'), 'Al abrir «Dance» se ven también las pistas de «Dance › 2024», «Dance › Tech House»… sin repetir. El contador y la búsqueda siguen la misma regla'),
      this.row('Crear crates con la estructura de carpetas', this.toggle('folderToCrates'), '«+ Añadir música» → «Carpeta…» crea una crate con el nombre de la carpeta (dentro de la crate abierta, si la hay) y un subcrate por cada subcarpeta con música. Soltar carpetas sobre una crate o sobre «CRATES» lo hace siempre'),
      this.row('Archivos perdidos', btn('Relocalizar archivos perdidos…', { cls: 'small', onClick: () => { app.closeModal(); app.relocateMissing(); } }), 'Busca en una carpeta las pistas que se han movido y conserva cues, beatgrid, valoración y crates'),
      ...this.backupRows());
  }

  // Copias de seguridad de la biblioteca (main/backup.js): pistas, cues, beatgrid, crates, Prepare,
  // historial y ajustes. Automática al abrir la app (una al día) y antes de cada actualización; 14 últimas.
  backupRows() {
    const app = this.app;
    const head = el('h3', {}, 'Copias de seguridad');
    if (!platform.backup.available) return [head, el('p', { class: 'set-note' }, 'Las copias de seguridad solo están disponibles en la app de escritorio.')];
    const list = el('div', { class: 'bk-list', id: 'bk-list', role: 'list' }, el('p', { class: 'hint' }, 'Cargando…'));
    const fill = async () => {
      let r;
      try { r = await platform.backup.list(); } catch (e) { list.replaceChildren(el('p', { class: 'set-note' }, e.message)); return; }
      if (!r.list.length) { list.replaceChildren(el('p', { class: 'hint' }, 'Todavía no hay copias. Se hace una al abrir la app cada día; también puedes hacerla ahora.')); return; }
      list.replaceChildren(...r.list.map(b => {
        const d = b.date ? new Date(b.date) : null;
        const when = d ? d.toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : b.name;
        return el('div', { class: 'bk-row' + (b.ok ? '' : ' bad'), role: 'listitem' },
          el('span', { class: 'bk-date' }, when),
          el('span', { class: 'bk-meta' }, [BACKUP_REASONS[b.reason] || b.reason, b.tracks != null ? `${b.tracks} pistas` : '', fmtSize(b.size), b.ok ? '' : 'dañada'].filter(Boolean).join(' · ')),
          b.ok ? btn('Restaurar…', { cls: 'micro', onClick: () => this.restoreBackup(b, when) }) : el('span'));
      }));
    };
    fill();
    return [
      head,
      el('p', { class: 'hint' }, 'Se copia tu biblioteca (pistas, cues, beatgrid, crates, Prepare, historial) y los ajustes al abrir la app (como mucho una vez al día) y antes de cada actualización. Se guardan las 14 últimas. Tu música no se copia.'),
      el('div', { class: 'row' },
        btn('Hacer copia ahora', { cls: 'small primary', onClick: async () => {
          try { const r = await platform.backup.create(); toast(`Copia hecha (${r.tracks ?? 0} pistas, ${fmtSize(r.size)})`, 'ok'); fill(); }
          catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 7000); }
        } }),
        btn('Abrir carpeta', { cls: 'small', onClick: () => platform.backup.openFolder() })),
      list
    ];
  }

  async restoreBackup(b, when) {
    const app = this.app;
    const body = el('div', { class: 'form' },
      el('p', {}, `¿Restaurar la copia del ${when}${b.tracks != null ? ` (${b.tracks} pistas)` : ''}?`),
      el('p', { class: 'hint' }, 'Tu biblioteca y tus ajustes volverán a como estaban entonces. Antes se hace una copia del estado actual, así que puedes deshacerlo restaurando esa copia. La app se reiniciará.'),
      app.decks.some(d => d.playing) ? el('p', { class: 'set-note' }, 'Hay música sonando: se cortará al reiniciar.') : null);
    if (await app.modal('Restaurar copia de seguridad', body, ['Cancelar', 'Restaurar y reiniciar']) !== 1) return;
    try { await platform.backup.restore(b.name); toast('Copia restaurada. Reiniciando…', 'ok', 5000); }
    catch (e) { toast('No se pudo restaurar: ' + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 8000); }
  }

  page_midi(p) {
    const app = this.app, m = app.midi;
    const names = m.connectedNames;
    if (!this.midiDev || !names.includes(this.midiDev)) this.midiDev = names.find(n => !m.isNative(n)) || names[0] || '';
    const dev = this.midiDev;
    const prof = dev ? m.getProfile(dev) : null;
    const nMapped = prof ? Object.keys(prof.map).length : 0;
    const wizard = () => { this.wizard = this.wizard || new MidiWizard(app); this.wizard.open(dev); };

    const devs = m.devices.length ? m.devices.filter(d => d.state === 'connected').map(d => {
      const p2 = m.getProfile(d.name), n = Object.keys(p2.map).length;
      const detected = m.catalog.match(d.name) || m.catalog.genericMatch(d.name);
      const txt = d.native ? `reconocida automáticamente${n ? ` + ${n} controles personalizados` : ''}` :
        n ? `${n} controles configurados${p2.source === 'mixxx' ? ' (importado de Mixxx)' : ''}` :
        `sin configurar${detected ? ` · familia ${detected.name}` : ''} — usa «Añadir controladora»`;
      return el('li', { class: n || d.native ? 'ok' : '' }, el('b', {}, d.name), ' — ' + txt);
    }) : [];
    if (!devs.length) devs.push(el('li', {}, m.status === 'unsupported' ? 'Web MIDI no disponible' : 'No hay dispositivos MIDI conectados. Conecta la controladora por USB.'));

    const monitor = el('div', { class: 'midi-monitor' });
    const renderMon = () => {
      monitor.innerHTML = '';
      for (const e of m.monitor.slice(-14).reverse()) {
        const act = m.describeMapping(e.dev, e.key);
        monitor.appendChild(el('div', {}, `${e.st.toString(16).toUpperCase()} ${e.d1.toString(16).toUpperCase().padStart(2, '0')} ${e.d2.toString(16).toUpperCase().padStart(2, '0')}`,
          el('span', {}, `${e.dev} · ${describeKey(e.key)}${act ? ' → ' + act : ''}`)));
      }
    };
    renderMon();
    const offMsg = m.on('msg', renderMon);

    const filter = el('input', { type: 'search', placeholder: 'Filtrar acciones…', class: 'wide' });
    const list = el('div', { class: 'learn-list' });
    const renderList = () => {
      list.innerHTML = '';
      const pr = dev ? m.getProfile(dev) : { map: {}, opts: {} };
      const q = filter.value.toLowerCase();
      let group = '';
      for (const a of Object.values(app.actions)) {
        if (q && !(a.label + ' ' + a.group).toLowerCase().includes(q)) continue;
        const keys = dev ? m.keysFor(dev, a.id) : [];
        if (a.group !== group) { group = a.group; list.appendChild(el('div', { class: 'learn-group' }, group)); }
        const learning = m.learning === a.id;
        const keyTxt = keys.map(k => {
          const o = pr.opts[k] || {};
          const extra = [o.enc ? REL_NAMES[o.enc] : '', o.inv ? 'invertido' : '', o.scale ? `${Math.round(605 / o.scale)} pasos/vuelta` : ''].filter(Boolean).join(', ');
          return describeKey(k) + (extra ? ` (${extra})` : '');
        }).join(' + ');
        const inv = keys.length && a.kind !== 'button' ? btn('⇅', { cls: 'micro', title: 'Invertir dirección', onClick: () => {
          const pp = m.getProfile(dev);
          for (const k of keys) if (pp.map[k]) { pp.opts[k] = { ...(pp.opts[k] || {}) }; if (pp.opts[k].inv) delete pp.opts[k].inv; else pp.opts[k].inv = true; }
          m.setProfile(dev, pp); renderList();
        } }) : el('span');
        list.appendChild(el('div', { class: 'learn-row' + (learning ? ' learning' : '') },
          el('span', {}, a.label), el('span', { class: 'learn-key' }, keyTxt || (learning ? 'Mueve un control…' : '')),
          btn(learning ? 'Cancelar' : 'Aprender', { cls: 'micro', onClick: () => { if (!dev) return toast('Conecta una controladora MIDI primero', 'warn'); learning ? m.cancelLearn() : m.learn(a.id, dev); renderList(); } }),
          inv,
          keys.length ? btn('✕', { cls: 'micro', title: 'Quitar asignación', onClick: () => { m.unassignAction(dev, a.id); renderList(); } }) : el('span')));
      }
    };
    filter.addEventListener('input', renderList);
    const offLearn = m.on('learn', renderList);
    this.offMsg = () => { offMsg(); offLearn(); };
    renderList();

    const pickFile = (accept, cb) => {
      const file = document.createElement('input'); file.type = 'file'; file.accept = accept;
      file.onchange = async () => { try { await cb(await file.files[0].text(), file.files[0].name); } catch (e) { toast(e.message, 'error', 7000); } };
      file.click();
    };
    const importMixxx = () => {
      if (!dev) return toast('Conecta la controladora de destino primero', 'warn');
      pickFile('.xml,.midi.xml,text/xml', async (text) => {
        const r = parseMixxxMapping(text, app.actions);
        const n = Object.keys(r.map).length;
        if (!n) throw new Error('No se encontró ningún control traducible en ese mapeo de Mixxx.');
        m.applyProfile(dev, r, true);
        this.render();
        const rp = r.report;
        const body = el('div', { class: 'form' },
          el('p', {}, `«${r.name}»${r.author ? ' de ' + r.author : ''} aplicado a ${dev}.`),
          el('ul', { class: 'fb-list' },
            el('li', {}, `${n} controles importados (${rp.mappedActions} funciones) y ${rp.leds} LEDs.`),
            rp.scripted ? el('li', {}, `${rp.scripted} controles usan scripts de Mixxx y no se pueden traducir automáticamente${rp.scriptedNames.length ? ' (p. ej. ' + rp.scriptedNames.slice(0, 5).join(', ') + ')' : ''}.`) : null,
            rp.unsupported.length ? el('li', {}, `${rp.unsupported.length} controles de funciones que esta app no tiene o de los decks 3/4.`) : null,
            !rp.hasJog ? el('li', {}, 'El jog no venía en el mapeo (en Mixxx suele ir por script): configúralo con el asistente.') : null),
          el('p', { class: 'hint' }, 'Con «Añadir controladora» puedes completar lo que falte; marca «Conservar las asignaciones» y salta los controles que ya funcionen.'));
        const c = await app.modal('Mapeo de Mixxx importado', body, ['Cerrar', 'Abrir el asistente']);
        if (c === 1) wizard(); else app.settingsUI.open('midi');
      });
    };

    p.append(...[
      el('h3', {}, 'Dispositivos conectados'), el('ul', { class: 'dev-list' }, ...devs),
      el('p', { class: 'hint' }, 'Funciona con cualquier controladora o mesa de mezclas que use MIDI por USB (Pioneer, Numark, Hercules, Reloop, Denon, Traktor, Behringer, Allen & Heath…). Algunos modelos se reconocen automáticamente; para los demás, usa el asistente o importa el mapeo de Mixxx de tu modelo. Las controladoras que funcionan solo por HID (sin MIDI) no son compatibles.'),
      names.length > 1 ? this.row('Configurar', select(Object.fromEntries(names.map(n => [n, n])), dev, (v) => { this.midiDev = v; m.cancelLearn(); this.render(); })) : null,
      el('div', { class: 'row' },
        btn('➕ Añadir controladora (asistente)', { cls: 'small primary', onClick: () => { if (!dev) return toast('Conecta la controladora por USB primero', 'warn'); wizard(); } }),
        btn('Importar mapeo de Mixxx (.midi.xml)', { cls: 'small', onClick: importMixxx })),
      el('p', { class: 'hint' }, 'Los mapeos de Mixxx están en la carpeta «controllers» de Mixxx o en su web (github.com/mixxxdj/mixxx/tree/main/res/controllers). Se traducen los controles directos; lo que dependa de scripts se completa con el asistente.'),
      dev && !m.isNative(dev) ? this.row('LEDs de la controladora', (() => {
        const t = el('input', { type: 'checkbox', class: 'switch' }); t.checked = !prof.ledsOff;
        t.addEventListener('change', () => m.setLedsEnabled(dev, t.checked)); return t;
      })(), 'Enciende los botones asignados (play, cue, sync, pads…) con el mismo número MIDI. Desactívalo si se encienden luces que no corresponden.') : null,
      this.row('Invertir fader de pitch (todas)', this.toggle('invertPitch')),
      m.profiles.length ? this.row('Volumen de auriculares desde la controladora', this.toggle('mc4000PhonesMidi'), 'Desactívalo si tu controladora ya regula los auriculares por hardware') : null,
      this.row('Sensibilidad del jog (nudge)', this.number('jogSensitivity', 0.2, 4, 0.1)),
      el('h3', {}, 'Monitor MIDI'), monitor,
      el('h3', {}, dev ? `Asignaciones de ${dev}${nMapped ? ` (${nMapped})` : ''}` : 'Asignaciones'),
      el('p', { class: 'hint' }, 'Pulsa «Aprender» y mueve un control: queda guardado para esta controladora. ⇅ invierte la dirección de faders, knobs y platos.'),
      filter, list,
      el('div', { class: 'row' },
        btn('Exportar perfil JSON', { cls: 'small', onClick: () => {
          if (!dev) return toast('Conecta una controladora MIDI primero', 'warn');
          const profile = m.exportDeviceProfile(dev);
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })); a.download = `${profile.id}.json`; a.click(); URL.revokeObjectURL(a.href);
        } }),
        btn('Importar perfil JSON', { cls: 'small', onClick: () => {
          if (!dev) return toast('Conecta la controladora de destino primero', 'warn');
          pickFile('.json,application/json', (text) => { m.importDeviceProfile(dev, JSON.parse(text)); toast(`Perfil aplicado a ${dev}`, 'ok'); this.render(); });
        } }),
        Object.keys(m.map).length && dev ? btn('Pasar asignaciones antiguas a esta controladora', { cls: 'small', onClick: () => { m.saveDeviceProfile(dev); toast('Asignaciones copiadas', 'ok'); this.render(); } }) : null,
        btn('Borrar configuración de esta controladora', { cls: 'small', onClick: async () => {
          if (!dev) return;
          if (await app.confirm(`¿Borrar todas las asignaciones de ${dev}?`)) { m.clearDevice(dev); m.clearUserMap(); }
          app.settingsUI.open('midi');
        } }))].filter(Boolean));
  }

  page_expansions(p) {
    const app = this.app;
    const entries = [
      ['flip', 'Flip (beta)', 'Secuencias cuantizadas de hot cues y Censor; hasta 6 por pista.', true],
      ['fxPresets', 'Presets de FX', 'Guarda y carga las 2 unidades de efectos.', true],
      ['laptop', 'Modo solo laptop', 'Activa una vista compacta, accesos rápidos de teclado y manejo directo de Split Cue.', true],
      ['video', 'Salida de video', 'Ventana secundaria, formatos video y FX visuales. Pendiente de integración audiovisual.', false],
      ['dvs', 'DVS / Timecode', 'Decodificador de señal por entrada de audio. Pendiente de calibración con hardware y medios de prueba.', false],
      ['pitchTime', "Pitch 'n Time (time-stretch)", 'Integración de motor DSP externo de alta calidad; pendiente de elegir licencia y paquete.', false]
    ];
    p.append(el('h3', {}, 'Módulos opcionales'), el('p', { class: 'hint' }, 'Activa solo las extensiones disponibles. Las funciones marcadas «en desarrollo» aún no se habilitan para evitar exponer controles que no funcionan.'),
      ...entries.map(([id, label, hint, available]) => {
        const checkbox = el('input', { type: 'checkbox', class: 'switch' });
        checkbox.checked = !!app.settings.expansions?.[id];
        checkbox.disabled = !available;
        checkbox.addEventListener('change', () => {
          app.expansions.setEnabled(id, checkbox.checked);
          if (id === 'laptop') app.applyPanels();
        });
        return this.row(label, checkbox, hint + (available ? '' : ' · No disponible todavía'));
      }),
      el('h3', {}, 'Notas de integración'),
      el('p', { class: 'hint' }, "Para time-stretch se recomienda evaluar Rubber Band (verificar GPL/comercial y distribución de binarios) frente a SoundTouchJS/WASM; sustituir el pitch-shifter granular del AudioWorklet solo tras pruebas A/B y medición de latencia. DVS precisa una ruta de captura de entrada seleccionable y el timecode licenciado apropiado. Video requiere ventana Electron secundaria y reloj maestro de audio; MKV no siempre se decodifica en Chromium, se recomienda transcodificar a MP4/H.264.")
    );
  }

  async page_youtube(p) {
    const app = this.app, s = app.settings;
    const yt = await app.platform.yt.texts();
    const key = this.secretField(s.ytApiKey, 'AIza…', (v) => app.setSetting('ytApiKey', v), yt.maskKey);
    const cid = el('input', { value: s.ytClientId, class: 'wide', placeholder: '…apps.googleusercontent.com' });
    cid.addEventListener('change', () => app.setSetting('ytClientId', cid.value.trim()));
    const csec = this.secretField(s.ytClientSecret, 'GOCSPX-…', (v) => app.setSetting('ytClientSecret', v), yt.maskKey);
    const keyMsg = el('span', { class: 'key-check hint', role: 'status', 'aria-live': 'polite' });
    const checkBtn = btn('Comprobar clave', {
      cls: 'small', onClick: async () => {
        key.commit();
        if (!key.value) { keyMsg.className = 'key-check warn'; keyMsg.textContent = yt.MSG.empty; return; }
        checkBtn.disabled = true;
        keyMsg.className = 'key-check hint'; keyMsg.textContent = 'Comprobando…';
        const r = await app.platform.yt.checkKey(key.value).catch(e => ({ ok: false, message: e.message }));
        checkBtn.disabled = false;
        keyMsg.className = 'key-check ' + (r.ok ? 'ok' : 'error');
        keyMsg.textContent = (r.ok ? '✓ ' : '✗ ') + r.message;
      }
    });
    const service = await app.platform.yt.searchAvailable().catch(() => false);
    const st = await app.platform.yt.status().catch(() => ({ connected: false }));
    const statusEl = el('span', { class: 'status-pill' + (st.connected ? ' ok' : '') }, st.connected ? 'Cuenta de Google conectada' : 'Sin cuenta conectada');
    p.append(
      el('h3', {}, 'Cómo funciona'),
      el('p', { class: 'hint' }, 'Las pistas de YouTube se reproducen en el reproductor oficial dentro del deck (vídeo visible). Puedes usar play/pausa, cue, hot cues, tempo (pasos de 5 %), fader de canal, crossfader y master. Por las condiciones de YouTube, su audio no pasa por el motor: no hay EQ, filtro, FX, scratch, loops ni cue de auriculares en esas pistas, y suena por la salida predeterminada de Windows (pon tu controladora o interfaz como dispositivo predeterminado).'),
      el('h3', {}, 'Importar listas sin configurar nada'),
      el('p', { class: 'hint' }, 'Pega la URL de cualquier lista pública o no listada en «YouTube → + Lista». Sin clave se importan hasta 200 vídeos por lista.'),
      el('h3', {}, 'Buscar vídeos'),
      el('p', { class: 'hint' }, service
        ? 'Sin configurar nada puedes buscar con el servicio gratuito de NexuraIA (30 búsquedas al día; solo se envía el texto buscado y un identificador anónimo de la instalación). Con tu propia clave la búsqueda va directamente a Google y tienes unas 100 al día.'
        : 'Para buscar vídeos necesitas tu propia clave de API (gratis) o tu cuenta de Google conectada.'),
      el('h3', {}, 'Clave de API (opcional)'),
      this.row('YouTube Data API key', key.box, 'Listas completas, duraciones y búsqueda. Se crea gratis en Google Cloud Console.'),
      el('div', { class: 'row' }, checkBtn,
        btn('Cómo crear la clave', { cls: 'small', onClick: () => app.platform.openExternal(yt.GUIDE) }), keyMsg),
      el('h3', {}, 'Conectar tu cuenta de Google (opcional)'),
      el('p', { class: 'hint' }, 'Para ver «Mis listas» (incluidas las privadas). Crea un cliente OAuth de tipo «Aplicación de escritorio» con la API YouTube Data v3 activada.'),
      this.row('Client ID', cid), this.row('Client secret', csec.box),
      el('div', { class: 'row' }, statusEl,
        btn(st.connected ? 'Desconectar' : 'Conectar cuenta', {
          cls: 'small', onClick: async () => {
            try {
              if (st.connected) await app.platform.yt.logout();
              else {
                csec.commit();
                if (!cid.value.trim() || !csec.value) return toast('Introduce el Client ID y el Client secret', 'warn');
                toast('Se ha abierto el navegador para iniciar sesión en Google…', 'info', 6000);
                await app.platform.yt.login(cid.value.trim(), csec.value);
                toast('Cuenta de Google conectada', 'ok');
              }
            } catch (e) { toast(e.message, 'error', 6000); }
            this.render();
          }
        })));
  }

  async page_spotify(p) {
    const app = this.app, s = app.settings;
    const { SPOTIFY_REDIRECT_URI } = await import('../spotify/spotify-core.js');
    const cid = el('input', { value: s.spotifyClientId || '', class: 'wide', placeholder: 'Client ID (32 caracteres)' });
    cid.addEventListener('change', () => app.setSetting('spotifyClientId', cid.value.trim()));
    const st = await app.spotify.status();
    const redirect = st.redirectUri || SPOTIFY_REDIRECT_URI;
    const statusEl = el('span', { class: 'status-pill' + (st.connected ? ' ok' : '') }, st.connected ? `Cuenta de Spotify conectada${st.user ? ' · ' + st.user : ''}` : 'Sin cuenta conectada');
    const copy = btn('Copiar', { cls: 'micro', onClick: async () => { try { await navigator.clipboard.writeText(redirect); toast('Redirect URI copiado', 'ok'); } catch (_) { toast('No se pudo copiar: selecciónalo y cópialo a mano', 'warn'); } } });
    p.append(
      el('h3', {}, 'Importar listas de Spotify'),
      el('p', { class: 'hint' }, 'Convierte una lista, álbum o canción de Spotify en una crate: se leen solo los metadatos (título, artistas, duración, ISRC y carátula) y se buscan en tu música. Las que no tengas puedes reproducirlas con el reproductor oficial de YouTube o buscarlas para comprarlas. Nunca se descarga ni se extrae audio de Spotify ni de YouTube.'),
      el('div', { class: 'row' }, btn('+ Importar lista de Spotify…', { cls: 'small primary', onClick: () => { app.closeModal(); app.spotifyImportDialog(); } })),
      el('h3', {}, 'Sin cuenta'),
      el('p', { class: 'hint' }, 'Pega el enlace de una lista o álbum públicos (Compartir → Copiar enlace). Sin cuenta conectada se leen como mucho las primeras 100 pistas de cada lista.'),
      el('h3', {}, 'Conectar tu cuenta (opcional)'),
      el('p', { class: 'hint' }, 'Para importar listas completas (más de 100 pistas), tus listas privadas y «Mis listas». Necesitas crear una app gratuita de Spotify una sola vez:'),
      el('ol', { class: 'sp-steps' },
        el('li', {}, 'Entra en developer.spotify.com/dashboard con tu cuenta de Spotify y pulsa «Create app».'),
        el('li', {}, 'Nombre y descripción libres (por ejemplo «Nexura DJ Studio»). En «Redirect URIs» añade exactamente esta dirección y pulsa «Add»:'),
        el('li', { class: 'sp-redirect' }, el('code', {}, redirect), copy),
        el('li', {}, 'En «Which API/SDKs are you planning to use?» marca «Web API», acepta las condiciones y guarda.'),
        el('li', {}, 'Abre «Settings» de la app, copia el «Client ID» y pégalo aquí debajo. No hace falta el «Client secret».'),
        el('li', {}, 'Mientras la app esté en modo de desarrollo, solo pueden conectarse las cuentas que añadas en «User Management».')),
      el('div', { class: 'row' }, btn('Abrir developer.spotify.com', { cls: 'small', onClick: () => app.platform.openExternal('https://developer.spotify.com/dashboard') })),
      this.row('Client ID', cid, 'Se guarda en los ajustes; la sesión (tokens) se guarda cifrada en este equipo'),
      el('div', { class: 'row' }, statusEl,
        btn(st.connected ? 'Desconectar' : 'Conectar cuenta', {
          cls: 'small', onClick: async () => {
            try {
              if (st.connected) await app.platform.spotify.logout();
              else {
                const id = cid.value.trim();
                if (!id) return toast('Introduce el Client ID de tu app de Spotify', 'warn');
                app.setSetting('spotifyClientId', id);
                toast('Se ha abierto el navegador para iniciar sesión en Spotify…', 'info', 6000);
                const r = await app.platform.spotify.login(id);
                toast(`Cuenta de Spotify conectada${r && r.user ? ' · ' + r.user : ''}`, 'ok');
              }
            } catch (e) { toast(e.message, 'error', 7000); }
            this.render();
          }
        })),
      el('p', { class: 'hint' }, 'Spotify no deja leer con la API algunas listas creadas por Spotify (por ejemplo, las personalizadas): en ese caso se usa la página pública, con el límite de 100 pistas.'));
  }

  page_keys(p) {
    const rows = [
      ['Deck 1: Cue / Play / Sync / Loop', 'Z / X / C / V'], ['Deck 1: pitch bend − / +', 'A / S'], ['Deck 1: pads 1-8', '1 … 8 (Mayús = borrar)'],
      ['Deck 2: Cue / Play / Sync / Loop', 'N / M / , / .'], ['Deck 2: pitch bend − / +', 'K / L'], ['Deck 2: pads 1-8', 'Q W E R T Y U I (Mayús = borrar)'],
      ['Navegar biblioteca', '↑ / ↓ / RePág / AvPág'], ['Barra lateral: recorrer / abrir / plegar y desplegar', '↑ ↓ / Intro / ← →'],
      ['Quitar de la crate / de Prepare (en «Todas las pistas»: eliminar de la biblioteca)', 'Supr'], ['Eliminar de la biblioteca al instante, sin preguntar (pistas seleccionadas, desde cualquier vista; los archivos no se borran)', 'Ctrl + Supr'], ['Eliminar la lista de YouTube con el foco en la barra lateral (en «YouTube · todos los vídeos»: quitar todos los vídeos; pide confirmación)', 'Supr'], ['Deshacer lo último quitado o eliminado', 'Ctrl + Z'], ['Cargar en deck 1 / 2', 'Mayús + ← / Mayús + →'], ['Cambiar panel', 'Tab / ← / →'],
      ['Buscar', 'Ctrl + F'], ['Grabar', 'F9'], ['Pantalla completa', 'F11'], ['Herramientas de desarrollo', 'F12'],
      ['Modo laptop', 'F8 (activar/desactivar)'], ['Automix IA', 'F7 (activar/desactivar)'], ['Autoplay del crate abierto', 'Mayús + F7 (empezar/parar)'], ['Autoplay: siguiente pista', 'Ctrl + →'], ['Split Cue', 'F6 (activar/desactivar)'],
      ['EQ kill', 'Clic derecho sobre HI/MID/LOW'], ['Ajuste fino de knobs/faders', 'Mayús + arrastrar'], ['Valor por defecto', 'Doble clic']
    ];
    p.append(el('h3', {}, 'Teclado y ratón'), el('table', { class: 'keys' }, ...rows.map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', {}, el('kbd', {}, b))))));
  }

  page_about(p) {
    const app = this.app, i = app.info;
    const link = (label, fn, id) => el('button', { class: 'link', type: 'button', id, onclick: fn }, label);
    p.append(
      el('div', { class: 'logo big' }, el('b', {}, 'NEXURA'), ' DJ STUDIO'),
      el('p', { class: 'about-ver' }, `Versión ${i.version}${i.osLabel ? ' · ' + i.osLabel : ''}`),
      el('p', {}, '© 2026 NexuraIA · Gratis durante la fase de lanzamiento.'),
      el('p', { class: 'hint' }, 'Software DJ de NexuraIA. Decks con keylock, sync, hot cues, loops, roll, slicer, beat jump, pitch play, slip y censor; mezclador con EQ y filtro; 2 unidades de 3 efectos; sampler de 32 ranuras; stems con IA; análisis de BPM, tonalidad y forma de onda; crates, smart crates, Prepare e historial; grabación; listas de YouTube y Spotify (solo metadatos); compatible con cualquier controladora MIDI.'),
      el('p', { class: 'about-links' }, link('Licencia de uso', () => app.legal.show('licencia'), 'about-lic'), ' · ', link('Política de privacidad', () => app.legal.show('privacidad'), 'about-priv'), ' · ', link('Licencias de terceros', () => app.legal.show('terceros'), 'about-3p'), ' · ', link('Novedades de esta versión', () => app.notes.show(), 'about-notes')),
      el('p', {}, 'contacto@nexuraia.com · nexuraia.com'),
      el('h3', {}, 'Errores y sugerencias'),
      el('p', { class: 'hint' }, 'Cuéntanos un error o una idea. Puedes adjuntar el registro técnico de la app (sin rutas ni nombres de canciones) y ver antes exactamente qué se envía.'),
      el('div', { class: 'row' },
        btn('Enviar informe o sugerencia', { cls: 'small primary', onClick: () => { app.closeModal(); app.feedback.open(); } }),
        platform.backup.available ? btn('Abrir carpeta del registro', { cls: 'small', onClick: () => platform.openLogFolder() }) : null),
      el('p', { class: 'hint' }, `Datos de la aplicación: ${i.userData || '—'}`));
  }
}
