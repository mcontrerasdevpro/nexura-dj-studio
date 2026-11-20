// Novedades de la versión: al arrancar tras una actualización, aviso «Nexura se ha actualizado a la X ·
// Ver novedades» que abre las notas de src/legal/NOVEDADES.md. También desde el menú «?» y Acerca de.
import { el, toast } from '../util.js';
import { parseNotes, notesFor, shouldAnnounce } from './release-notes-core.js';

// «**texto**» → <b>
function rich(text) {
  return String(text).split(/\*\*(.+?)\*\*/g).map((s, i) => (i % 2 ? el('b', {}, s) : s));
}

export class ReleaseNotes {
  constructor(app) { this.app = app; this.list = null; }

  async load() {
    if (!this.list) {
      const r = await fetch('legal/NOVEDADES.md', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.list = parseNotes(await r.text());
    }
    return this.list;
  }

  // Al arrancar: avisa si la versión es posterior a la última que se abrió y la guarda
  check() {
    const app = this.app, s = app.settings, v = app.info && app.info.version;
    if (!/^\d+\.\d+\.\d+/.test(String(v || ''))) return false;
    const announce = shouldAnnounce(s.lastVersion, v, s.welcomeDone);
    if (s.lastVersion !== v) app.setSetting('lastVersion', v);
    if (!announce) return false;
    app.feedback && app.feedback.log('INFO', 'app', `Actualizada desde ${s.lastVersion || 'una versión anterior'}`);
    toast(`Nexura se ha actualizado a la ${v}`, 'ok upd-notes', 20000, { label: 'Ver novedades', fn: () => this.show(v) }, { kind: 'bg' });
    return true;
  }

  async show(version) {
    let list;
    try { list = await this.load(); } catch (e) { return toast('No se pudieron abrir las novedades: ' + e.message, 'error'); }
    const v = version || (this.app.info && this.app.info.version);
    const cur = notesFor(list, v);
    if (!cur) return toast('No hay notas para esta versión', 'warn');
    const body = el('div', { class: 'notes', tabindex: 0 });
    for (const b of cur.blocks) {
      if (b.type === 'h') body.append(el('h3', {}, b.text));
      else if (b.type === 'p') body.append(el('p', {}, ...rich(b.text)));
      else body.append(el('ul', {}, ...b.items.map(t => el('li', {}, ...rich(t)))));
    }
    return this.app.modal('Novedades · ' + cur.title, body, ['Cerrar']);
  }
}
