#!/usr/bin/env node
/**
 * Generates the PWA icon set into `public/icons`.
 *
 * Rasterised here rather than exported from a design tool, because the mark is
 * five capsules and a background: it is fully described by the numbers below,
 * so the repository can hold the description instead of six binaries nobody
 * can diff or regenerate. Run `npm run icons` after changing anything here.
 *
 * Coverage is computed from the signed distance to each capsule, which gives
 * real anti-aliasing without a rasteriser dependency — the mark is read at
 * 48 px on a home screen, where aliased edges are the difference between a
 * barbell and a smudge.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/** Theme values, duplicated from styles/_tokens.css by necessity. */
const BACKGROUND = [0x0b, 0x0c, 0x0e];
const ACCENT = [0xc8, 0xfa, 0x4b];

/**
 * The mark, in a 512-unit square: a bar between two collars and two plates.
 *
 * Each entry is a capsule — a segment with a radius — so the ends are round
 * and the shape needs no path data.
 */
const CAPSULES = [
  { x1: 150, y1: 256, x2: 362, y2: 256, r: 15 }, // bar
  { x1: 150, y1: 196, x2: 150, y2: 316, r: 20 }, // inner collar, left
  { x1: 362, y1: 196, x2: 362, y2: 316, r: 20 }, // inner collar, right
  { x1: 86, y1: 166, x2: 86, y2: 346, r: 22 }, // outer plate, left
  { x1: 426, y1: 166, x2: 426, y2: 346, r: 22 }, // outer plate, right
];

/** Distance from a point to a capsule's surface; negative means inside. */
function capsuleDistance(px, py, c) {
  const dx = c.x2 - c.x1;
  const dy = c.y2 - c.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - c.x1) * dx + (py - c.y1) * dy) / lengthSquared));
  const nx = px - (c.x1 + t * dx);
  const ny = py - (c.y1 + t * dy);
  return Math.hypot(nx, ny) - c.r;
}

/**
 * Renders the mark at `size`, with the design scaled by `markScale` about the
 * centre.
 *
 * `markScale` is what makes a maskable icon honest: Android may crop to the
 * central 80 % circle, so the mark has to sit inside that circle or it loses
 * its plates on some launchers and not others.
 */
function render(size, markScale) {
  const pixels = Buffer.alloc(size * size * 3);
  const unit = 512 / size;
  // Antialias over roughly one device pixel, expressed in design units.
  const feather = unit * 0.6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Pixel centre, mapped into design space and un-scaled about the centre.
      const dx = ((x + 0.5) * unit - 256) / markScale + 256;
      const dy = ((y + 0.5) * unit - 256) / markScale + 256;

      let coverage = 0;
      for (const capsule of CAPSULES) {
        const distance = capsuleDistance(dx, dy, capsule);
        // Smooth step across the feather band, clamped.
        const value = Math.max(0, Math.min(1, 0.5 - distance / feather));
        if (value > coverage) coverage = value;
      }

      const offset = (y * size + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(
          BACKGROUND[channel] + (ACCENT[channel] - BACKGROUND[channel]) * coverage,
        );
      }
    }
  }
  return pixels;
}

// ------------------------------------------------------------------- PNG

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 8-bit RGB, no alpha: these icons are opaque, which iOS requires anyway. */
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per row; filter 0 (none) keeps this simple and the
  // images compress well regardless, being mostly flat colour.
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ main

const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-256.png', size: 256, scale: 1 },
  { file: 'icon-384.png', size: 384, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  // Inside the central 80 % circle a maskable icon is allowed to assume.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.68 },
  // iOS ignores `maskable` and applies its own rounded-rectangle mask to an
  // opaque image, so this is the plain mark at the size Safari asks for.
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
];

mkdirSync(OUT, { recursive: true });
for (const target of TARGETS) {
  const png = encodePng(target.size, render(target.size, target.scale));
  writeFileSync(join(OUT, target.file), png);
  console.log(`build-icons: ${target.file} (${png.length} bytes)`);
}
