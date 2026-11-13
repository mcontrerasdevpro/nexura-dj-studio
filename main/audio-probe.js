// Lectura técnica de un archivo de audio para «Limpiar biblioteca» (sin dependencias ni Electron; se prueba en
// Node: tools/test-limpieza.mjs, comparando con ffprobe). Solo lee la cabecera, las etiquetas y el final del
// archivo, nunca lo modifica.
//   probeFile(ruta) → { fmt, codec, lossless, br (kbps), vbr, sr, bits, ch, dur (s), audioStart, audioEnd,
//                       damaged: motivo | null, tags: { title, artist, album, year, genre, cover, kind } | null }
//   audioStart/audioEnd = dónde empiezan y acaban los datos de audio (sin etiquetas ID3/APE ni bloques de FLAC):
//   la huella de duplicados se calcula solo sobre esa zona, así dos copias con etiquetas distintas coinciden.
'use strict';
const fsp = require('fs').promises;
const path = require('path');

const HEAD = 256 * 1024;
const MAX_TAG = 16 * 1024 * 1024;

// ------------------------------------------------------------------ utilidades
async function readAt(fh, pos, len) {
  const b = Buffer.alloc(Math.max(0, len));
  const { bytesRead } = await fh.read(b, 0, b.length, pos);
  return b.subarray(0, bytesRead);
}
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
function swap16(b) { const c = Buffer.from(b.length % 2 ? b.subarray(0, -1) : b); return c.swap16(); }
function decodeText(buf, enc) {
  try {
    if (enc === 0) return buf.toString('latin1');
    if (enc === 3) return buf.toString('utf8');
    if (enc === 1) {
      if (buf[0] === 0xFE && buf[1] === 0xFF) return swap16(buf.subarray(2)).toString('utf16le');
      if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
      return buf.toString('utf16le');
    }
    if (enc === 2) return swap16(buf).toString('utf16le');
  } catch (_) { /* texto ilegible */ }
  return buf.toString('latin1');
}
const clean = (s) => String(s || '').replace(/\u0000+$/g, '').replace(/\u0000/g, ' / ').replace(/\s+/g, ' ').trim();

// Géneros ID3v1 («(17)» o «17» en TCON)
const ID3_GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];
function genreText(g) {
  const s = clean(g);
  const m = /^\(?(\d{1,3})\)?$/.exec(s) || /^\((\d{1,3})\)(.*)$/.exec(s);
  if (m) return (m[2] && m[2].trim()) || ID3_GENRES[+m[1]] || '';
  return s;
}

// ------------------------------------------------------------------ ID3v2
// Marcos de un tag ID3v2 (buf = cuerpo sin la cabecera de 10 bytes) → [{ id, flags, data }]
function id3Frames(body, ver) {
  const frames = [], idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
  let p = 0;
  while (p + hdr <= body.length) {
    const id = body.toString('latin1', p, p + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size;
    if (ver === 2) size = (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5];
    else if (ver === 4) size = syncsafe(body, p + 4);
    else size = body.readUInt32BE(p + 4);
    if (size <= 0 || p + hdr + size > body.length) break;
    frames.push({ id, flags: ver === 2 ? 0 : body.readUInt16BE(p + 8), data: body.subarray(p + hdr, p + hdr + size) });
    p += hdr + size;
  }
  frames.end = p;   // hasta dónde se ha podido leer (lo que sigue debería ser relleno de ceros)
  return frames;
}
const TEXT_IDS = {
  2: { TT2: 'title', TP1: 'artist', TAL: 'album', TYE: 'year', TCO: 'genre' },
  3: { TIT2: 'title', TPE1: 'artist', TALB: 'album', TYER: 'year', TDRC: 'year', TCON: 'genre' },
  4: { TIT2: 'title', TPE1: 'artist', TALB: 'album', TDRC: 'year', TYER: 'year', TCON: 'genre' }
};
function id3Tags(body, ver) {
  const tags = { title: '', artist: '', album: '', year: '', genre: '', cover: false };
  const map = TEXT_IDS[ver] || TEXT_IDS[3];
  for (const f of id3Frames(body, ver)) {
    if ((f.flags & 0x00ff) & 0x0c) continue;   // marcos comprimidos o cifrados: se ignoran
    const k = map[f.id];
    if (k && f.data.length > 1 && !tags[k]) tags[k] = clean(decodeText(f.data.subarray(1), f.data[0]));
    if (f.id === 'APIC' || f.id === 'PIC') tags.cover = true;
  }
  tags.genre = genreText(tags.genre);
  return tags;
}

// ------------------------------------------------------------------ MP3 (MPEG audio)
const BR = {
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mpegHeader(b, o) {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const v = (b[o + 1] >> 3) & 3, l = (b[o + 1] >> 1) & 3, bi = b[o + 2] >> 4, si = (b[o + 2] >> 2) & 3, pad = (b[o + 2] >> 1) & 1;
  if (v === 1 || l === 0 || bi === 0 || bi === 15 || si === 3) return null;
  const layer = 4 - l, mpeg1 = v === 3;
  const br = BR[`${mpeg1 ? 1 : 2}-${layer}`][bi], sr = SR[v][si];
  const spf = layer === 1 ? 384 : layer === 3 && !mpeg1 ? 576 : 1152;
  const len = layer === 1 ? Math.floor((12 * br * 1000) / sr + pad) * 4 : Math.floor((spf / 8) * br * 1000 / sr) + pad;
  const mono = ((b[o + 3] >> 6) & 3) === 3;
  return { v, layer, mpeg1, br, sr, spf, len, mono };
}
// Primera trama válida (con la siguiente también válida, para no confundir datos con una cabecera)
function findFrame(b, from = 0) {
  for (let o = from; o + 4 < b.length; o++) {
    if (b[o] !== 0xff) continue;
    const h = mpegHeader(b, o);
    if (!h || h.len < 24) continue;
    const n = mpegHeader(b, o + h.len);
    if (n && n.v === h.v && n.layer === h.layer && n.sr === h.sr) return { o, h };
    if (o + h.len >= b.length - 4) return { o, h };   // última trama del trozo leído
  }
  return null;
}
function xingInfo(b, o, h) {
  const side = h.mpeg1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
  const x = o + 4 + side;
  const id = b.toString('latin1', x, x + 4);
  if (id === 'Xing' || id === 'Info') {
    const flags = b.readUInt32BE(x + 4);
    let q = x + 8;
    const frames = flags & 1 ? b.readUInt32BE(q) : 0; if (flags & 1) q += 4;
    const bytes = flags & 2 ? b.readUInt32BE(q) : 0;
    return { vbr: id === 'Xing', frames, bytes };
  }
  const v = o + 4 + 32;
  if (b.toString('latin1', v, v + 4) === 'VBRI') return { vbr: true, bytes: b.readUInt32BE(v + 10), frames: b.readUInt32BE(v + 14) };
  return null;
}

// ------------------------------------------------------------------ FLAC / Vorbis comments
function vorbisComments(b, q = 0) {
  const tags = { title: '', artist: '', album: '', year: '', genre: '', cover: false };
  try {
    const vlen = b.readUInt32LE(q); q += 4 + vlen;
    const n = b.readUInt32LE(q); q += 4;
    const m = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', DATE: 'year', YEAR: 'year', GENRE: 'genre' };
    for (let i = 0; i < n && q + 4 <= b.length; i++) {
      const l = b.readUInt32LE(q); q += 4;
      const kv = b.toString('utf8', q, Math.min(b.length, q + l)); q += l;
      const eq = kv.indexOf('=');
      if (eq < 1) continue;
      const k = kv.slice(0, eq).toUpperCase();
      if (m[k] && !tags[m[k]]) tags[m[k]] = clean(kv.slice(eq + 1));
      if (k === 'METADATA_BLOCK_PICTURE' || k === 'COVERART') tags.cover = true;
    }
  } catch (_) { /* comentario cortado */ }
  return tags;
}
async function probeFlac(fh, size, start) {
  const r = { fmt: 'flac', codec: 'flac', lossless: true, tags: null };
  let pos = start + 4, last = false, info = null;
  for (let guard = 0; guard < 128 && !last; guard++) {
    const bh = await readAt(fh, pos, 4);
    if (bh.length < 4) return { ...r, damaged: 'los datos de la cabecera están cortados' };
    last = !!(bh[0] & 0x80);
    const type = bh[0] & 0x7f, len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
    if (type === 127 || pos + 4 + len > size) return { ...r, damaged: 'cabecera FLAC no válida' };
    if (type === 0) {
      const s = await readAt(fh, pos + 4, 34);
      info = { sr: (s.readUIntBE(10, 3) >> 4), ch: ((s[12] >> 1) & 7) + 1, bits: ((s.readUInt16BE(12) >> 4) & 31) + 1, samples: (s[13] & 15) * 0x100000000 + s.readUInt32BE(14) };
    } else if (type === 4) r.tags = vorbisComments(await readAt(fh, pos + 4, Math.min(len, MAX_TAG)));
    else if (type === 6) { r.tags = r.tags || { title: '', artist: '', album: '', year: '', genre: '', cover: false }; r.tags.cover = true; r._pic = true; }
    pos += 4 + len;
  }
  if (r._pic && r.tags) r.tags.cover = true;
  delete r._pic;
  if (!info || !info.sr) return { ...r, damaged: 'falta la información del audio (STREAMINFO)' };
  const sync = await readAt(fh, pos, 2);
  if (sync.length < 2 || sync[0] !== 0xff || (sync[1] & 0xfe) !== 0xf8) return { ...r, damaged: 'no hay audio después de la cabecera' };
  const dur = info.samples ? info.samples / info.sr : 0;
  const end = await tailTags(fh, size, false);
  const audioEnd = end.end;
  return { ...r, sr: info.sr, ch: info.ch, bits: info.bits, dur, br: dur ? ((audioEnd - pos) * 8) / dur / 1000 : 0, audioStart: pos, audioEnd, tagKind: 'vorbis', damaged: null };
}

// ID3v1 y APEv2 al final del archivo → { end (donde acaba el audio), v1: tags | null }
async function tailTags(fh, size, mp3 = true) {
  let end = size, v1 = null;
  if (size > 128) {
    const t = await readAt(fh, size - 128, 128);
    if (t.toString('latin1', 0, 3) === 'TAG') {
      end -= 128;
      if (mp3) {
        const g = t[127];
        v1 = { title: clean(t.toString('latin1', 3, 33)), artist: clean(t.toString('latin1', 33, 63)), album: clean(t.toString('latin1', 63, 93)), year: clean(t.toString('latin1', 93, 97)), genre: ID3_GENRES[g] || '', cover: false };
      }
    }
  }
  if (end > 32) {
    const a = await readAt(fh, end - 32, 32);
    if (a.toString('latin1', 0, 8) === 'APETAGEX') {
      const len = a.readUInt32LE(12), flags = a.readUInt32LE(20);
      end -= len + (flags & 0x80000000 ? 32 : 0);
    }
  }
  return { end: Math.max(0, end), v1 };
}

async function probeMp3(fh, size, start, id3) {
  const r = { fmt: 'mp3', codec: 'mp3', lossless: false };
  let head = await readAt(fh, start, HEAD);
  let f = findFrame(head, 0);
  // algunos programas dejan basura o un segundo tag delante del audio: se busca hasta 4 MB
  if (!f && size - start > HEAD) { head = await readAt(fh, start, 4 * 1024 * 1024); f = findFrame(head, 0); }
  if (!f) return { ...r, damaged: 'no se encuentra audio MP3 válido', audioStart: start, audioEnd: size };
  const { h } = f;
  const first = start + f.o;
  const tail = await tailTags(fh, size, true);
  const audioEnd = tail.end;
  const x = xingInfo(head, f.o, h);
  let dur, br, vbr = false, damaged = null;
  if (x && x.frames) {
    dur = (x.frames * h.spf) / h.sr;
    vbr = x.vbr;
    br = vbr ? ((x.bytes || (audioEnd - first)) * 8) / dur / 1000 : h.br;
    // archivo cortado: la cabecera dice que el audio ocupa más de lo que hay
    if (x.bytes && audioEnd - first < x.bytes * 0.9) damaged = `archivo incompleto (le falta el ${Math.round(100 - ((audioEnd - first) / x.bytes) * 100)} % del final)`;
  } else {
    br = h.br;
    dur = ((audioEnd - first) * 8) / (h.br * 1000);
  }
  // final del archivo lleno de ceros = descarga o copia que no terminó (otros datos al final, como una
  // etiqueta ID3 pegada detrás del audio, no cuentan como daño)
  if (!damaged && audioEnd - first > 64 * 1024) {
    const tb = await readAt(fh, Math.max(first, audioEnd - 16 * 1024), 16 * 1024);
    if (tb.length && tb.every(v => v === 0)) {
      // cuánto ocupan los ceros: unos pocos KB son relleno; más del 10 % (o 1 MB) es audio que falta
      let zeros = 0;
      for (let pos = audioEnd; pos > first && zeros < 64 * 1024 * 1024;) {
        const n = Math.min(256 * 1024, pos - first), blk = await readAt(fh, pos - n, n);
        let k = blk.length; while (k > 0 && blk[k - 1] === 0) k--;
        zeros += blk.length - k;
        if (k > 0) break;
        pos -= n;
      }
      if (zeros > Math.min(1024 * 1024, (audioEnd - first) * 0.1)) damaged = `el final del archivo está vacío (copia o descarga incompleta: faltan unos ${Math.round(zeros / 1024)} KB)`;
    }
  }
  let tags = id3 ? id3.tags : null;
  if ((!tags || (!tags.title && !tags.artist)) && tail.v1) tags = { ...tail.v1, cover: !!(tags && tags.cover) };
  const kind = [id3 ? `ID3v2.${id3.ver}` : '', tail.v1 ? 'ID3v1' : ''].filter(Boolean).join('+');
  return { ...r, sr: h.sr, ch: h.mono ? 1 : 2, bits: 0, br, vbr, dur, audioStart: start, audioEnd, tags, tagKind: kind, unsync: !!(id3 && id3.unsync), damaged, codec: h.layer === 3 ? 'mp3' : 'mp' + h.layer };
}

// ------------------------------------------------------------------ WAV / AIFF
function ieee80(b, o) {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  const hi = b.readUInt32BE(o + 2), lo = b.readUInt32BE(o + 6);
  if (!exp && !hi && !lo) return 0;
  return (hi * 2 ** -31 + lo * 2 ** -63) * 2 ** (exp - 16383);
}
async function probeRiff(fh, size, aiff) {
  const r = { fmt: aiff ? 'aiff' : 'wav', codec: 'pcm', lossless: true, tags: null };
  let pos = 12, fmt = null, dataPos = 0, dataLen = 0, frames = 0;
  for (let guard = 0; guard < 512 && pos + 8 <= size; guard++) {
    const ch = await readAt(fh, pos, 8);
    if (ch.length < 8) break;
    const id = ch.toString('latin1', 0, 4), len = aiff ? ch.readUInt32BE(4) : ch.readUInt32LE(4);
    if (!aiff && id === 'fmt ') {
      const b = await readAt(fh, pos + 8, Math.min(len, 64));
      fmt = { tag: b.readUInt16LE(0), ch: b.readUInt16LE(2), sr: b.readUInt32LE(4), rate: b.readUInt32LE(8), bits: b.readUInt16LE(14) };
    } else if (aiff && id === 'COMM') {
      const b = await readAt(fh, pos + 8, 18);
      frames = b.readUInt32BE(2);
      fmt = { tag: 1, ch: b.readUInt16BE(0), bits: b.readUInt16BE(6), sr: Math.round(ieee80(b, 8)) };
      fmt.rate = fmt.sr * fmt.ch * (fmt.bits / 8);
    } else if ((!aiff && id === 'data') || (aiff && id === 'SSND')) { dataPos = pos + 8; dataLen = len; }
    else if (id === 'LIST' && !aiff && len < 64 * 1024) {
      const b = await readAt(fh, pos + 8, len);
      if (b.toString('latin1', 0, 4) === 'INFO') {
        r.tags = r.tags || { title: '', artist: '', album: '', year: '', genre: '', cover: false };
        const m = { INAM: 'title', IART: 'artist', IPRD: 'album', ICRD: 'year', IGNR: 'genre' };
        for (let q = 4; q + 8 <= b.length;) { const k = b.toString('latin1', q, q + 4), l = b.readUInt32LE(q + 4); if (m[k]) r.tags[m[k]] = clean(b.toString('latin1', q + 8, q + 8 + l)); q += 8 + l + (l & 1); }
      }
    } else if (id === 'id3 ' || id === 'ID3 ') {
      const b = await readAt(fh, pos + 8, Math.min(len, MAX_TAG));
      if (b.toString('latin1', 0, 3) === 'ID3') r.tags = id3Tags(b.subarray(10, 10 + syncsafe(b, 6)), b[3]);
    }
    pos += 8 + len + (len & 1);
  }
  if (!fmt || !dataPos) return { ...r, damaged: 'falta la cabecera o los datos de audio', audioStart: 0, audioEnd: size };
  const avail = Math.max(0, Math.min(dataLen, size - dataPos));
  const dur = aiff ? (fmt.sr ? frames / fmt.sr : 0) : (fmt.rate ? avail / fmt.rate : 0);
  const damaged = dataLen > 0 && avail < dataLen * 0.98 && dataLen !== 0xffffffff ? 'archivo incompleto (cortado)' : null;
  return { ...r, sr: fmt.sr, ch: fmt.ch, bits: fmt.bits, dur, br: fmt.rate * 8 / 1000, lossless: fmt.tag === 1 || fmt.tag === 3 || fmt.tag === 0xfffe, audioStart: dataPos, audioEnd: dataPos + avail, tagKind: r.tags ? 'riff' : '', damaged };
}

// ------------------------------------------------------------------ MP4 / M4A
// Bitrate medio del DecoderConfigDescriptor (dentro del ES_Descriptor de la caja esds)
function esdsBitrate(b, q, end) {
  const desc = () => { const tag = b[q++]; let len = 0; for (let k = 0; k < 4; k++) { const c = b[q++]; len = (len << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return { tag, len }; };
  try {
    let d = desc();
    if (d.tag === 3) {
      q += 2; const fl = b[q++];
      if (fl & 0x80) q += 2;
      if (fl & 0x40) q += 1 + b[q];
      if (fl & 0x20) q += 2;
      d = desc();
    }
    if (d.tag === 4 && q + 13 <= end) return b.readUInt32BE(q + 9);   // tipo(1) flujo(1) búfer(3) máximo(4) medio(4)
  } catch (_) { /* esds corto */ }
  return 0;
}
async function probeMp4(fh, size, ext) {
  const r = { fmt: ext === 'mp4' ? 'mp4' : 'm4a', codec: 'aac', lossless: false, tags: null };
  let pos = 0, moov = null, mdat = 0;
  for (let guard = 0; guard < 256 && pos + 8 <= size; guard++) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) break;
    let len = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let hl = 8;
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); hl = 16; } else if (len === 0) len = size - pos;
    if (len < 8) break;
    if (type === 'moov' && len < 64 * 1024 * 1024) moov = await readAt(fh, pos + hl, len - hl);
    if (type === 'mdat') mdat += len - hl;
    pos += len;
  }
  if (!moov) return { ...r, damaged: 'falta la información del archivo (moov)', audioStart: 0, audioEnd: size };
  const boxes = (b, from, to, cb) => { for (let p = from; p + 8 <= to;) { const l = b.readUInt32BE(p); if (l < 8 || p + l > to) break; cb(b.toString('latin1', p + 4, p + 8), p + 8, p + l); p += l; } };
  let dur = 0, sr = 0, ch = 0, bits = 0, avg = 0;
  const tags = { title: '', artist: '', album: '', year: '', genre: '', cover: false };
  const walk = (b, from, to) => boxes(b, from, to, (t, s, e) => {
    if (t === 'mvhd') { const v = b[s]; const ts = v === 1 ? b.readUInt32BE(s + 20) : b.readUInt32BE(s + 12); const d = v === 1 ? Number(b.readBigUInt64BE(s + 24)) : b.readUInt32BE(s + 16); if (ts) dur = d / ts; }
    else if (['trak', 'mdia', 'minf', 'stbl', 'udta', 'ilst'].includes(t)) walk(b, s, e);
    else if (t === 'meta') walk(b, s + 4, e);
    else if (t === 'stsd') boxes(b, s + 8, e, (st, ss, se) => {
      if (st === 'mp4a' || st === 'alac') {
        if (st === 'alac') { r.codec = 'alac'; r.lossless = true; }
        ch = b.readUInt16BE(ss + 16); bits = b.readUInt16BE(ss + 18); sr = b.readUInt32BE(ss + 24) >>> 16;
        boxes(b, ss + 28, se, (et, es, ee) => { if (et === 'esds') avg = esdsBitrate(b, es + 4, ee); });
      }
    });
    else if (['©nam', '©ART', '©alb', '©day', '©gen', 'covr', 'gnre'].includes(t)) {
      boxes(b, s, e, (dt, ds, de) => {
        if (dt !== 'data') return;
        const v = b.toString('utf8', ds + 8, de);
        if (t === '©nam') tags.title = clean(v); else if (t === '©ART') tags.artist = clean(v); else if (t === '©alb') tags.album = clean(v);
        else if (t === '©day') tags.year = clean(v); else if (t === '©gen') tags.genre = clean(v);
        else if (t === 'gnre' && de - ds >= 10) tags.genre = ID3_GENRES[b.readUInt16BE(ds + 8) - 1] || '';
        else if (t === 'covr') tags.cover = true;
      });
    }
  });
  walk(moov, 0, moov.length);
  if (!dur) return { ...r, damaged: 'no se puede leer la duración', audioStart: 0, audioEnd: size };
  const br = avg ? avg / 1000 : (mdat * 8) / dur / 1000;
  return { ...r, sr, ch, bits: r.lossless ? bits : 0, dur, br, audioStart: 0, audioEnd: size, tags, tagKind: 'mp4', damaged: null };
}

// ------------------------------------------------------------------ OGG (Vorbis / Opus)
async function probeOgg(fh, size, ext) {
  const head = await readAt(fh, 0, 64 * 1024);
  const r = { fmt: ext === 'opus' ? 'opus' : 'ogg', codec: 'vorbis', lossless: false, tags: null };
  let sr = 0, ch = 0, nominal = 0, pre = 0;
  const vi = head.indexOf('\u0001vorbis', 0, 'latin1'), oi = head.indexOf('OpusHead', 0, 'latin1');
  if (vi >= 0) { ch = head[vi + 11]; sr = head.readUInt32LE(vi + 12); nominal = head.readInt32LE(vi + 20); }
  else if (oi >= 0) { r.codec = 'opus'; r.fmt = 'opus'; ch = head[oi + 9]; pre = head.readUInt16LE(oi + 10); sr = 48000; }
  else return { ...r, damaged: 'no es un archivo OGG válido', audioStart: 0, audioEnd: size };
  const ci = r.codec === 'opus' ? head.indexOf('OpusTags', 0, 'latin1') : head.indexOf('\u0003vorbis', 0, 'latin1');
  if (ci >= 0) r.tags = vorbisComments(head, ci + (r.codec === 'opus' ? 8 : 7));
  const tail = await readAt(fh, Math.max(0, size - 64 * 1024), 64 * 1024);
  const li = tail.lastIndexOf('OggS', tail.length, 'latin1');
  const gran = li >= 0 && li + 14 <= tail.length ? Number(tail.readBigInt64LE(li + 6)) : 0;
  const dur = gran > 0 ? (r.codec === 'opus' ? (gran - pre) / 48000 : gran / sr) : 0;
  if (!dur) return { ...r, sr, ch, damaged: 'no se puede leer la duración (archivo cortado)', audioStart: 0, audioEnd: size };
  return { ...r, sr, ch, bits: 0, dur, br: nominal > 0 ? nominal / 1000 : (size * 8) / dur / 1000, audioStart: 0, audioEnd: size, tagKind: 'vorbis', damaged: null };
}

// ------------------------------------------------------------------ ADTS (.aac)
async function probeAdts(fh, size, start) {
  const b = await readAt(fh, start, HEAD);
  const SRS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  let o = b.indexOf(0xff), frames = 0, bytes = 0, sr = 0, ch = 0;
  while (o >= 0 && o + 7 < b.length) {
    if (b[o] !== 0xff || (b[o + 1] & 0xf6) !== 0xf0) { o = b.indexOf(0xff, o + 1); continue; }
    sr = SRS[(b[o + 2] >> 2) & 15] || sr; ch = ((b[o + 2] & 1) << 2) | (b[o + 3] >> 6);
    const len = ((b[o + 3] & 3) << 11) | (b[o + 4] << 3) | (b[o + 5] >> 5);
    if (len < 7) break;
    frames++; bytes += len; o += len;
  }
  if (!frames || !sr) return { fmt: 'aac', codec: 'aac', lossless: false, damaged: 'no se encuentra audio AAC válido', audioStart: start, audioEnd: size };
  const br = (bytes * 8) / ((frames * 1024) / sr) / 1000;
  const tail = await tailTags(fh, size, false);
  return { fmt: 'aac', codec: 'aac', lossless: false, sr, ch, bits: 0, br, dur: ((tail.end - start) * 8) / (br * 1000), audioStart: start, audioEnd: tail.end, tags: null, tagKind: '', damaged: null };
}

// ------------------------------------------------------------------ entrada
async function probeFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const st = await fh.stat();
    const size = st.size;
    const base = { size, mtime: Math.round(st.mtimeMs) };
    if (!size) return { ...base, fmt: ext, damaged: 'el archivo está vacío (0 bytes)', audioStart: 0, audioEnd: 0, tags: null };
    const h = await readAt(fh, 0, 12);
    let start = 0, id3 = null;
    if (h.toString('latin1', 0, 3) === 'ID3' && h[3] >= 2 && h[3] <= 4) {
      const len = syncsafe(h, 6), flags = h[5];
      const body = await readAt(fh, 10, Math.min(len, MAX_TAG));
      let b = body;
      if (h[3] >= 3 && flags & 0x40) { const ext = h[3] === 4 ? syncsafe(b, 0) : b.readUInt32BE(0) + 4; b = b.subarray(ext); }
      id3 = { ver: h[3], unsync: !!(flags & 0x80), tags: flags & 0x80 ? null : id3Tags(b, h[3]) };
      start = 10 + len + (h[3] === 4 && flags & 0x10 ? 10 : 0);
      // relleno de ceros que algunos programas dejan después del tag
      if (start < size) { const pad = await readAt(fh, start, 4096); let z = 0; while (z < pad.length && pad[z] === 0) z++; if (z < pad.length) start += z; }
      // un segundo tag ID3v2 justo detrás (pasa al re-etiquetar con según qué programas)
      for (let guard = 0; guard < 4; guard++) {
        const h2 = await readAt(fh, start, 10);
        if (h2.length < 10 || h2.toString('latin1', 0, 3) !== 'ID3' || h2[3] < 2 || h2[3] > 4) break;
        if (!id3.tags || (!id3.tags.title && !id3.tags.artist)) { const b2 = await readAt(fh, start + 10, Math.min(syncsafe(h2, 6), MAX_TAG)); if (!(h2[5] & 0x80)) id3.tags = { ...id3Tags(b2, h2[3]), cover: id3.tags ? id3.tags.cover || id3Tags(b2, h2[3]).cover : false }; }
        else if (!id3.tags.cover) { const b2 = await readAt(fh, start + 10, Math.min(syncsafe(h2, 6), MAX_TAG)); id3.tags.cover = id3Tags(b2, h2[3]).cover; }
        start += 10 + syncsafe(h2, 6) + (h2[3] === 4 && h2[5] & 0x10 ? 10 : 0);
      }
    }
    const magic = await readAt(fh, start, 12);
    let r;
    if (magic.toString('latin1', 0, 4) === 'fLaC') r = await probeFlac(fh, size, start);
    else if (magic.toString('latin1', 0, 4) === 'RIFF' && magic.toString('latin1', 8, 12) === 'WAVE') r = await probeRiff(fh, size, false);
    else if (magic.toString('latin1', 0, 4) === 'FORM' && /^AIF[FC]$/.test(magic.toString('latin1', 8, 12))) r = await probeRiff(fh, size, true);
    else if (magic.toString('latin1', 4, 8) === 'ftyp') r = await probeMp4(fh, size, ext);
    else if (magic.toString('latin1', 0, 4) === 'OggS') r = await probeOgg(fh, size, ext);
    else if (magic.toString('latin1', 0, 4) === 'MAC ') r = { fmt: 'ape', codec: 'ape', lossless: true, damaged: null, audioStart: 0, audioEnd: size };
    else if (magic.toString('latin1', 0, 4) === 'wvpk') r = { fmt: 'wv', codec: 'wavpack', lossless: true, damaged: null, audioStart: 0, audioEnd: size };
    else if (magic.readUInt32LE(0) === 0x75b22630) r = { fmt: 'wma', codec: 'wma', lossless: false, damaged: null, audioStart: 0, audioEnd: size };
    else if (magic[0] === 0xff && (magic[1] & 0xf6) === 0xf0) r = await probeAdts(fh, size, start);
    else if (magic[0] === 0xff && (magic[1] & 0xe0) === 0xe0) r = await probeMp3(fh, size, start, id3);
    else if (ext === 'mp3' || id3) r = await probeMp3(fh, size, start, id3);
    else r = { fmt: ext, codec: '', lossless: false, damaged: ['wma', 'ape', 'wv', 'mpc', 'ra', 'ac3', 'webm'].includes(ext) ? null : 'formato no reconocido', audioStart: 0, audioEnd: size };
    if (r.tags === undefined) r.tags = id3 ? id3.tags : null;
    if (id3 && r.fmt !== 'mp3' && r.fmt !== 'aac' && !r.tags) r.tags = id3.tags;
    const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * d) / d : 0);
    return { ...base, ...r, br: round(r.br || 0), dur: round(r.dur || 0, 100), sr: r.sr || 0, bits: r.bits || 0, ch: r.ch || 0, vbr: !!r.vbr, damaged: r.damaged || null };
  } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    return { fmt: ext, damaged: 'no se puede leer (' + (e.code || e.message) + ')', audioStart: 0, audioEnd: 0, tags: null };
  } finally { if (fh) await fh.close().catch(() => {}); }
}

module.exports = { probeFile, id3Frames, syncsafe, tailTags, findFrame, ID3_GENRES };
