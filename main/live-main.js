// Sesión en directo en el proceso principal (rc.10). Se prueba en Node con objetos falsos (tools/test-directo.mjs).
//  - Confirmación al cerrar: si la interfaz dice que suena música (live:state), cerrar la ventana pregunta antes
//    «Hay música sonando. ¿Cerrar Nexura DJ Studio?».
//  - Cuelgues y caídas de la interfaz: si el proceso de la ventana se cae (render-process-gone) se recarga la
//    interfaz (que ofrece recuperar la sesión: no hay marca de cierre limpio); si deja de responder (unresponsive)
//    más de `hangMs`, se cierra a la fuerza y se recarga igual. Más de 3 caídas en un minuto: se avisa y no se
//    insiste (para no entrar en un bucle).
'use strict';

const CLOSE_MSG = 'Hay música sonando. ¿Cerrar Nexura DJ Studio?';

function createLiveGuard({ dialog, log = () => {} }) {
  const st = { playing: false, live: false };
  return {
    setState(s) { st.playing = !!(s && s.playing); st.live = !!(s && s.live); },
    state: () => ({ ...st }),
    // true = se puede cerrar
    async confirmClose(win) {
      if (!st.playing) return true;
      const r = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Seguir pinchando', 'Cerrar'], defaultId: 0, cancelId: 0, noLink: true,
        title: 'Nexura DJ Studio', message: CLOSE_MSG, detail: 'Si cierras, la música se para.'
      });
      const ok = r && r.response === 1;
      log('INFO', 'main', ok ? 'Cerrar con música sonando: confirmado' : 'Cerrar con música sonando: cancelado');
      return ok;
    }
  };
}

function createCrashGuard({ reload, crash, showError = () => {}, log = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, hangMs = 10000, maxPerMinute = 3 }) {
  let crashes = [], hang = null, given = false;
  return {
    // details: { reason, exitCode } de render-process-gone. quitting = la app se está cerrando
    gone(details, quitting = false) {
      const reason = (details && details.reason) || 'desconocido';
      clearTimer(hang); hang = null;
      if (quitting || reason === 'clean-exit') return 'ignored';
      const t = now();
      crashes = crashes.filter(x => t - x < 60000);
      crashes.push(t);
      log('ERROR', 'main', `Cierre inesperado de la interfaz (${reason}, código ${(details && details.exitCode) ?? '?'})`);
      if (crashes.length > maxPerMinute) {
        if (!given) { given = true; log('ERROR', 'main', 'La interfaz se ha cerrado varias veces seguidas: no se vuelve a recargar sola'); showError(); }
        return 'gave-up';
      }
      log('WARN', 'main', 'Se recarga la interfaz y se ofrece recuperar la sesión');
      reload();
      return 'reload';
    },
    unresponsive() {
      if (hang) return 'waiting';
      log('WARN', 'main', 'La interfaz no responde');
      hang = setTimer(() => {
        hang = null;
        log('ERROR', 'main', `La interfaz lleva más de ${Math.round(hangMs / 1000)} s sin responder: se cierra y se recarga`);
        crash();
      }, hangMs);
      return 'waiting';
    },
    responsive() {
      if (!hang) return 'ok';
      clearTimer(hang); hang = null;
      log('INFO', 'main', 'La interfaz vuelve a responder');
      return 'recovered';
    }
  };
}

module.exports = { createLiveGuard, createCrashGuard, CLOSE_MSG };
