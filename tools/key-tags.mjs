// Tonalidad guardada en las etiquetas de los archivos (referencia para tools/key-medir.mjs y test-key-real.mjs).
// Lee solo la cabecera ID3v2 (TKEY o TXXX «initialkey» / «key») o los comentarios de FLAC (INITIALKEY / KEY) y
// entiende las notaciones habituales: Camelot («8A»), Open Key («1m», «1d»), «Am», «F#m», «A minor», «Abmin»,
// «C# major», «Dbm»… Los archivos se leen en su sitio: no se copian.
import fs from 'node:fs';
import path from 'node:path';

const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, fb: 4, 'e#': 5, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11, cb: 11, 'b#': 0 };
// Camelot: número de la rueda para cada tónica (mayor = B, menor = A)
const CAM_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAM_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

// Texto de una etiqueta → { tonic 0-11, minor } o null
export function parseKeyTag(raw) {
  let s = String(raw || '').trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\0/g, '');
  if (!s) return null;
  // Camelot «8A», «08B»
  let m = /^0?(\d{1,2})\s*([AB])$/i.exec(s);
  if (m) {
    const n = +m[1]; if (n < 1 || n > 12) return null;
    const minor = m[2].toUpperCase() === 'A';
    const tonic = (minor ? CAM_MINOR : CAM_MAJOR).indexOf(n);
    return tonic < 0 ? null : { tonic, minor };
  }
  // Open Key «1m» / «1d» (1d = C mayor = 8B)
  m = /^(\d{1,2})\s*([dm])$/i.exec(s);
  if (m) {
    const n = +m[1]; if (n < 1 || n > 12) return null;
    const cam = ((n - 1 + 7) % 12) + 1, minor = m[2].toLowerCase() === 'm';
    const tonic = (minor ? CAM_MINOR : CAM_MAJOR).indexOf(cam);
    return tonic < 0 ? null : { tonic, minor };
  }
  // «Am», «F#m», «A minor», «Abmin», «C# major», «Dbmaj», «E» (mayor)
  m = /^([A-Ga-g])\s*([#b]?)\s*(m|min|minor|moll|-|maj|major|dur|M)?$/.exec(s.replace(/\s+/g, ' '));
  if (m) {
    const name = (m[1] + m[2]).toLowerCase();
    if (!(name in NOTE)) return null;
    const q = m[3] || '';
    const minor = q === 'm' || /^(min|minor|moll|-)$/i.test(q);
    return { tonic: NOTE[name], minor };
  }
  return null;
}

export const camelotOf = (k) => (k ? (k.minor ? CAM_MINOR : CAM_MAJOR)[k.tonic] + (k.minor ? 'A' : 'B') : '');

function decodeText(buf, enc) {
  if (enc === 0) return buf.toString('latin1');
  if (enc === 3) return buf.toString('utf8');
  if (enc === 1) {
    if (buf[0] === 0xFE && buf[1] === 0xFF) { const c = Buffer.from(buf.slice(2)); if (c.length % 2) return ''; return c.swap16().toString('utf16le'); }
    if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
    return buf.toString('utf16le');
  }
  if (enc === 2) { const c = Buffer.from(buf); if (c.length % 2) return ''; return c.swap16().toString('utf16le'); }
  return buf.toString('latin1');
}

// Etiqueta de tonalidad (texto) de un archivo, o ''
export function readKeyTag(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(10);
    fs.readSync(fd, head, 0, 10, 0);
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const ver = head[3];
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      const tag = Buffer.alloc(Math.min(size, 1 << 20));
      fs.readSync(fd, tag, 0, tag.length, 10);
      const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
      let p = 0, key = '';
      while (p + hdrLen < tag.length) {
        const id = tag.toString('latin1', p, p + idLen);
        if (!/^[A-Z0-9]+$/.test(id)) break;
        let fsize;
        if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
        else if (ver === 4) fsize = (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7];
        else fsize = tag.readUInt32BE(p + 4);
        if (fsize <= 0) break;
        const body = tag.slice(p + hdrLen, p + hdrLen + fsize);
        if ((id === 'TKEY' || id === 'TKE') && body.length > 1) key = decodeText(body.slice(1), body[0]).replace(/\0/g, '').trim() || key;
        else if (id === 'TXXX' && body.length > 2 && !key) {
          const txt = decodeText(body.slice(1), body[0]);
          const [desc, val] = txt.split('\0').filter((x, i) => i < 2 || x);
          if (/^(initial ?key|key)$/i.test(String(desc || '').trim()) && val) key = val.trim();
        }
        p += hdrLen + fsize;
      }
      return key;
    }
    if (head.toString('latin1', 0, 4) === 'fLaC') {
      let pos = 4;
      for (let g = 0; g < 64; g++) {
        const bh = Buffer.alloc(4); fs.readSync(fd, bh, 0, 4, pos);
        const last = bh[0] & 0x80, type = bh[0] & 0x7F, len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
        if (type === 4) {
          const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos + 4);
          let q = 4 + b.readUInt32LE(0); const n = b.readUInt32LE(q); q += 4;
          for (let i = 0; i < n && q < b.length; i++) {
            const l = b.readUInt32LE(q); q += 4;
            const kv = b.toString('utf8', q, q + l); q += l;
            const eq = kv.indexOf('=');
            if (/^(INITIALKEY|KEY)$/i.test(kv.slice(0, eq))) return kv.slice(eq + 1).trim();
          }
          return '';
        }
        pos += 4 + len;
        if (last) break;
      }
    }
  } catch (_) { /* ilegible */ }
  finally { if (fd != null) try { fs.closeSync(fd); } catch (_) { /* */ } }
  return '';
}

// Archivos de audio de una carpeta (recursivo, como mucho `max`)
export function listAudio(dir, max = 100000, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (out.length >= max) break;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('$')) listAudio(f, max, out); }
    else if (/\.(mp3|flac)$/i.test(e.name)) out.push(f);
  }
  return out;
}
