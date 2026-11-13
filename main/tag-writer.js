// «Limpiar biblioteca» — escribir etiquetas en el archivo (sin Electron; se prueba en Node: tools/test-limpieza.mjs).
//   · MP3: los marcos nuevos se crean con node-id3 y se colocan en el tag ID3v2 que ya tenía el archivo (misma
//     versión 2.3/2.4), sustituyendo solo título/artista/álbum/año/género/carátula: el resto de marcos (cues y
//     beatgrid de otros programas, comentarios…) se copian byte a byte. Sin tag, se crea uno ID3v2.3.
//   · FLAC: metaflac-js (Vorbis comments y bloque PICTURE); los demás bloques y las tramas de audio no se tocan.
// Nunca se toca el audio: antes de escribir se guarda la cabecera original (para deshacer) y la huella de los
// datos de audio; después se vuelve a leer el archivo y, si el audio no es idéntico, se deja como estaba.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const NodeID3 = require('node-id3');
const Metaflac = require('metaflac-js');
const { id3Frames, syncsafe } = require('./audio-probe');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const enc = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

// Dónde acaba la cabecera (tag ID3v2 o bloques de FLAC) y empieza el audio → { fmt, headEnd, ver, flags } o null
function splitHead(buf) {
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const ver = buf[3], flags = buf[5];
    const end = 10 + syncsafe(buf, 6) + (ver === 4 && flags & 0x10 ? 10 : 0);
    if (buf.toString('latin1', end, end + 4) === 'fLaC') return { fmt: 'id3+flac', headEnd: end, ver, flags };
    return { fmt: 'mp3', headEnd: end, ver, flags };
  }
  if (buf.toString('latin1', 0, 4) === 'fLaC') {
    let p = 4, last = false;
    while (!last && p + 4 <= buf.length) { last = !!(buf[p] & 0x80); p += 4 + buf.readUIntBE(p + 1, 3); }
    return { fmt: 'flac', headEnd: p };
  }
  return null;
}
// Huella de los datos de audio (todo lo que va después de la cabecera)
const audioHash = (buf, headEnd) => sha1(buf.subarray(headEnd));

function formatOf(file, buf) {
  const ext = path.extname(file).toLowerCase();
  const s = splitHead(buf);
  if (ext === '.flac' && s && s.fmt === 'flac') return { kind: 'flac', ...s };
  if (ext === '.mp3') return { kind: 'mp3', ...(s && s.fmt === 'mp3' ? s : { headEnd: 0, ver: 0, flags: 0 }) };
  return null;
}
// ¿Se pueden escribir etiquetas en este archivo? (MP3 y FLAC; el resto, solo en Nexura)
const canWrite = (file) => /\.(mp3|flac)$/i.test(file);

// ------------------------------------------------------------------ MP3
function picType(data) {          // tipo de imagen de un marco APIC (3 = portada)
  let q = 1;
  while (q < data.length && data[q] !== 0) q++;
  return data[q + 1];
}
function buildMp3(buf, info, fields, cover) {
  const ver = info.ver || 0;
  if (ver === 2) throw new Error('etiqueta ID3 antigua (v2.2): solo se cambia en Nexura');
  if (ver && info.flags & 0x80) throw new Error('etiqueta ID3 con desincronización: solo se cambia en Nexura');
  // marcos nuevos (node-id3 crea un tag ID3v2.3)
  const tags = {};
  if (fields.title != null) tags.title = fields.title;
  if (fields.artist != null) tags.artist = fields.artist;
  if (fields.album != null) tags.album = fields.album;
  if (fields.genre != null) tags.genre = fields.genre;
  if (fields.year != null) tags.year = fields.year;
  if (cover) tags.image = { mime: cover.mime || 'image/jpeg', type: { id: 3, name: 'front cover' }, description: '', imageBuffer: cover.data };
  const created = NodeID3.create(tags);
  const fresh = id3Frames(created.subarray(10, 10 + syncsafe(created, 6)), 3);
  const outVer = ver === 4 ? 4 : 3;
  // en ID3v2.4 el año va en TDRC
  for (const f of fresh) if (outVer === 4 && f.id === 'TYER') f.id = 'TDRC';
  const replace = new Set(fresh.map(f => f.id));
  if (fields.year != null) { replace.add('TYER'); replace.add('TDRC'); }
  // marcos que ya tenía (sin tocar), menos los que se sustituyen
  let old = [];
  if (ver) {
    let body = buf.subarray(10, 10 + syncsafe(buf, 6));
    if (info.flags & 0x40) body = body.subarray(ver === 4 ? syncsafe(body, 0) : body.readUInt32BE(0) + 4);
    old = id3Frames(body, ver);
    // si algún marco no se entiende, reescribir el tag perdería lo que va detrás: no se toca
    if (body.subarray(old.end).some(v => v !== 0)) throw new Error('etiqueta ID3 con marcos no estándar: solo se cambia en Nexura');
  }
  const kept = old.filter(f => !(replace.has(f.id) && f.id !== 'APIC') && !(cover && f.id === 'APIC' && [0, 3].includes(picType(f.data))));
  const frameBuf = (f) => {
    const h = Buffer.alloc(10);
    h.write(f.id, 0, 'latin1');
    if (outVer === 4) enc(f.data.length).copy(h, 4); else h.writeUInt32BE(f.data.length, 4);
    h.writeUInt16BE(f.flags || 0, 8);
    return Buffer.concat([h, f.data]);
  };
  // los marcos que se conservan llevan sus banderas tal cual (misma versión que el original)
  const frames = Buffer.concat([...kept.map(frameBuf), ...fresh.map(f => frameBuf({ ...f, flags: 0 }))]);
  const pad = Buffer.alloc(1024);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = outVer; header[4] = 0; header[5] = 0;
  enc(frames.length + pad.length).copy(header, 6);
  return Buffer.concat([header, frames, pad, buf.subarray(info.headEnd)]);
}

// ------------------------------------------------------------------ FLAC
const VORBIS = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', year: 'DATE', genre: 'GENRE' };
function buildFlac(buf, fields, cover) {
  const mf = new Metaflac(buf);
  for (const [k, name] of Object.entries(VORBIS)) {
    if (fields[k] == null) continue;
    mf.removeTag(name);
    if (String(fields[k]).trim()) mf.setTag(`${name}=${String(fields[k]).replace(/[\r\n]+/g, ' ')}`);
  }
  if (cover) {
    mf.pictures = mf.pictures.filter(p => p.readUInt32BE(0) !== 3);
    mf.parsePictureBlock();
    mf.importPictureFromBuffer(cover.data);
  }
  return mf.save();
}

// ------------------------------------------------------------------ escribir / deshacer
async function writeAtomic(file, data) {
  const tmp = file + '.nexura-tmp';
  await fsp.writeFile(tmp, data);
  try { await fsp.rename(tmp, file); } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
}

// fields: { title?, artist?, album?, year?, genre? } (solo los que cambian); cover: { data: Buffer, mime } | null
// backupBase: ruta sin extensión donde guardar la cabecera original (.bin) y su descripción (.json)
// → { ok: true, format, audioHash, size, backup } | { ok: false, error }
async function writeTags(file, fields, { cover = null, backupBase } = {}) {
  if (!canWrite(file)) return { ok: false, error: 'formato sin etiquetas editables: solo se cambia en Nexura' };
  let buf;
  try { buf = await fsp.readFile(file); } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'el archivo no existe' : 'no se puede leer (' + (e.code || e.message) + ')' }; }
  const info = formatOf(file, buf);
  if (!info) return { ok: false, error: 'no es un MP3/FLAC válido: solo se cambia en Nexura' };
  const before = audioHash(buf, info.headEnd);
  let out;
  try { out = info.kind === 'flac' ? buildFlac(buf, fields, cover) : buildMp3(buf, info, fields, cover); }
  catch (e) { return { ok: false, error: e.message }; }
  const after = splitHead(out);
  if (!after || audioHash(out, after.headEnd) !== before) return { ok: false, error: 'comprobación de seguridad: el audio cambiaría; no se ha escrito nada' };
  // copia de la cabecera original antes de escribir: sin copia no se escribe (no se podría deshacer)
  if (!backupBase) return { ok: false, error: 'sin copia de las etiquetas originales no se escribe el archivo' };
  try {
    await fsp.mkdir(path.dirname(backupBase), { recursive: true });
    await fsp.writeFile(backupBase + '.bin', buf.subarray(0, info.headEnd));
    await fsp.writeFile(backupBase + '.json', JSON.stringify({ file, format: info.kind, headLen: info.headEnd, audioHash: before, size: buf.length, date: new Date().toISOString() }));
  } catch (e) { return { ok: false, error: 'no se pudo guardar la copia de las etiquetas originales (' + (e.code || e.message) + '): no se ha escrito nada' }; }
  try { await writeAtomic(file, out); } catch (e) { return { ok: false, error: e.code === 'EBUSY' || e.code === 'EPERM' ? 'el archivo está abierto en otro programa o es de solo lectura' : 'no se pudo guardar (' + (e.code || e.message) + ')' }; }
  // comprobación final con lo que hay en el disco
  const disk = await fsp.readFile(file);
  const s = splitHead(disk);
  if (!s || audioHash(disk, s.headEnd) !== before) {
    await writeAtomic(file, buf).catch(() => {});
    return { ok: false, error: 'comprobación de seguridad fallida: se ha dejado el archivo como estaba' };
  }
  return { ok: true, format: info.kind, audioHash: before, size: disk.length, backup: backupBase || null };
}

// Devuelve el archivo a sus etiquetas originales (la cabecera guardada + el audio actual, que debe ser el mismo)
async function restoreTags(file, backupBase) {
  let meta, head, buf;
  try { meta = JSON.parse(await fsp.readFile(backupBase + '.json', 'utf8')); head = await fsp.readFile(backupBase + '.bin'); }
  catch (_) { return { ok: false, error: 'no se encuentra la copia de las etiquetas originales' }; }
  try { buf = await fsp.readFile(file); } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'el archivo ya no existe' : 'no se puede leer' }; }
  const s = splitHead(buf);
  const start = s ? s.headEnd : 0;
  if (sha1(buf.subarray(start)) !== meta.audioHash) return { ok: false, error: 'el audio del archivo ha cambiado desde entonces: no se toca' };
  const out = Buffer.concat([head, buf.subarray(start)]);
  try { await writeAtomic(file, out); } catch (e) { return { ok: false, error: 'no se pudo guardar (' + (e.code || e.message) + ')' }; }
  return { ok: true, size: out.length };
}

module.exports = { writeTags, restoreTags, canWrite, splitHead, audioHash };
