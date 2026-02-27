#!/usr/bin/env node

/**
 * SuperNova TryOnMe - Icon Generator
 *
 * Generates supernova-themed PNG icons for the Chrome extension.
 * Creates 16x16, 48x48, and 128x128 PNGs with a star burst design.
 *
 * Usage:
 *   node scripts/generate-icons.js
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ICONS_DIR = path.join(__dirname, "..", "extension", "icons");
const SIZES = [16, 48, 128];

// Brand colors
const BRAND_R = 255, BRAND_G = 153, BRAND_B = 0;       // #FF9900
const CORE_R = 255, CORE_G = 213, CORE_B = 128;         // #FFD580
const DARK_R = 35,  DARK_G = 47,  DARK_B = 62;          // #232F3E

/**
 * Create a supernova-themed PNG icon.
 */
function createSupernovaPng(size) {
  const rawRows = [];
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.48;
  const innerR = size * 0.18;
  const coreR = size * 0.08;
  const margin = Math.floor(size * 0.04);
  const cornerRadius = Math.floor(size * 0.18);

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: None

    for (let x = 0; x < size; x++) {
      const offset = 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      // Check rounded rectangle bounds
      const inBounds = isInRoundedRect(x, y, size, margin, cornerRadius);

      if (!inBounds) {
        // Transparent
        row[offset] = 0; row[offset + 1] = 0; row[offset + 2] = 0; row[offset + 3] = 0;
        continue;
      }

      // Dark background
      let r = DARK_R, g = DARK_G, b = DARK_B, a = 255;

      // Radial glow behind the star
      if (dist < outerR) {
        const glowT = 1 - dist / outerR;
        const glowAlpha = glowT * glowT * 0.25;
        r = blend(r, BRAND_R, glowAlpha);
        g = blend(g, BRAND_G, glowAlpha);
        b = blend(b, BRAND_B, glowAlpha);
      }

      // Star rays (8 rays)
      const numRays = 8;
      const rayWidth = 0.12; // angular width in radians
      for (let i = 0; i < numRays; i++) {
        const rayAngle = (i * Math.PI * 2) / numRays - Math.PI / 2;
        let angleDiff = Math.abs(angle - rayAngle);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        if (angleDiff < rayWidth && dist > innerR * 1.5 && dist < outerR * 0.95) {
          const rayT = (1 - angleDiff / rayWidth) * (1 - (dist - innerR * 1.5) / (outerR * 0.95 - innerR * 1.5));
          const rayAlpha = rayT * 0.6;
          r = blend(r, CORE_R, rayAlpha);
          g = blend(g, CORE_G, rayAlpha);
          b = blend(b, CORE_B, rayAlpha);
        }
      }

      // Star shape (5-pointed)
      if (isInStar(x, y, cx, cy, size * 0.32, size * 0.14, 5)) {
        r = BRAND_R; g = BRAND_G; b = BRAND_B;
        // Inner glow
        if (dist < innerR * 1.8) {
          const t = 1 - dist / (innerR * 1.8);
          r = blend(r, CORE_R, t * 0.5);
          g = blend(g, CORE_G, t * 0.5);
          b = blend(b, CORE_B, t * 0.5);
        }
      }

      // Bright core
      if (dist < coreR) {
        r = CORE_R; g = CORE_G; b = CORE_B;
      }

      // "SN" text for larger sizes
      if (size >= 48 && isInSNText(x, y, size, margin)) {
        r = 255; g = 255; b = 255;
      }

      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  const chunks = [];
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(createPngChunk("IHDR", ihdr));
  chunks.push(createPngChunk("IDAT", compressed));
  chunks.push(createPngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function blend(base, target, t) {
  return Math.round(base + (target - base) * Math.min(1, Math.max(0, t)));
}

function isInRoundedRect(x, y, size, margin, cornerRadius) {
  if (x < margin || x >= size - margin || y < margin || y >= size - margin) return false;
  const lx = x - margin, ly = y - margin;
  const w = size - 2 * margin, h = size - 2 * margin;
  if (lx < cornerRadius && ly < cornerRadius) {
    return (lx - cornerRadius) ** 2 + (ly - cornerRadius) ** 2 <= cornerRadius ** 2;
  }
  if (lx >= w - cornerRadius && ly < cornerRadius) {
    return (lx - (w - cornerRadius)) ** 2 + (ly - cornerRadius) ** 2 <= cornerRadius ** 2;
  }
  if (lx < cornerRadius && ly >= h - cornerRadius) {
    return (lx - cornerRadius) ** 2 + (ly - (h - cornerRadius)) ** 2 <= cornerRadius ** 2;
  }
  if (lx >= w - cornerRadius && ly >= h - cornerRadius) {
    return (lx - (w - cornerRadius)) ** 2 + (ly - (h - cornerRadius)) ** 2 <= cornerRadius ** 2;
  }
  return true;
}

function isInStar(px, py, cx, cy, outerR, innerR, points) {
  const dx = px - cx, dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) + Math.PI / 2; // rotate so first point is up
  const slice = Math.PI / points;
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sector = Math.floor(a / slice);
  const sectorAngle = a - sector * slice;

  const r1 = sector % 2 === 0 ? outerR : innerR;
  const r2 = sector % 2 === 0 ? innerR : outerR;

  // Linear interpolation of radius at this angle
  const t = sectorAngle / slice;
  const expectedR = r1 + (r2 - r1) * t;
  return dist <= expectedR;
}

function isInSNText(x, y, size, margin) {
  const w = size - 2 * margin;
  const h = size - 2 * margin;
  const nx = (x - margin) / w;
  const ny = (y - margin) / h;

  // Text in bottom portion
  if (ny < 0.72 || ny > 0.92) return false;
  const textNy = (ny - 0.72) / 0.20;
  const sw = size >= 128 ? 0.04 : 0.06; // stroke width

  // "S" - left side (0.28 - 0.48)
  if (nx >= 0.28 && nx <= 0.48) {
    const snx = (nx - 0.28) / 0.20;
    // Top bar
    if (textNy < 0.2 && snx >= 0.15 && snx <= 1.0) return true;
    // Middle bar
    if (textNy >= 0.4 && textNy <= 0.6 && snx >= 0.0 && snx <= 0.85) return true;
    // Bottom bar
    if (textNy > 0.8 && snx >= 0.0 && snx <= 0.85) return true;
    // Left top vertical
    if (snx < 0.2 && textNy >= 0.0 && textNy <= 0.5) return true;
    // Right bottom vertical
    if (snx > 0.8 && textNy >= 0.5 && textNy <= 1.0) return true;
  }

  // "N" - right side (0.52 - 0.72)
  if (nx >= 0.52 && nx <= 0.72) {
    const snx = (nx - 0.52) / 0.20;
    // Left vertical
    if (snx < 0.2) return true;
    // Right vertical
    if (snx > 0.8) return true;
    // Diagonal
    const diagPos = textNy;
    if (Math.abs(snx - diagPos) < 0.2) return true;
  }

  return false;
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) { crc = (crc >>> 1) ^ 0xedb88320; } else { crc = crc >>> 1; }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function main() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    console.log(`Created directory: ${ICONS_DIR}`);
  }

  for (const size of SIZES) {
    const filename = `icon${size}.png`;
    const filepath = path.join(ICONS_DIR, filename);
    const pngBuffer = createSupernovaPng(size);
    fs.writeFileSync(filepath, pngBuffer);
    console.log(`Generated: ${filepath} (${size}x${size}, ${pngBuffer.length} bytes)`);
  }

  console.log("\nDone! SuperNova TryOnMe icons generated.");
}

main();
