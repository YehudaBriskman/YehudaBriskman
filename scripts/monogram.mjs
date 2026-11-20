#!/usr/bin/env node
/*
 * One-off: draws a shaded monogram as ASCII into assets/portrait.txt, for when
 * there is no portrait to hand. A soft radial light behind bold letters gives
 * the glyph ramp something to shade with, so the letters read as lit solids.
 *
 *   node scripts/monogram.mjs [YB] [--cols 64]       (needs `sharp`, see ascii.mjs)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const sharp = createRequire(import.meta.url)("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const text = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "YB";
const i = process.argv.indexOf("--cols");
const cols = i > 0 ? +process.argv[i + 1] : 64;
const W = 800;
const H = 800;
const rows = Math.round(cols * (H / W) * (3.72 / 6.2));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="g" cx="35%" cy="30%" r="85%"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#9a9a9a"/><stop offset="1" stop-color="#2c2c2c"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="#000"/>
  <text x="50%" y="58%" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="${text.length > 2 ? 330 : 520}" fill="url(#g)" stroke="#fff" stroke-width="6" letter-spacing="-18">${text}</text>
</svg>`;
const { data } = await sharp(Buffer.from(svg)).greyscale().blur(1.4).resize(cols, rows, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
const RAMP = " .:-=+*#%@";
const lines = [];
for (let y = 0; y < rows; y += 1) {
  let line = "";
  for (let x = 0; x < cols; x += 1) line += RAMP[Math.min(RAMP.length - 1, Math.floor((data[y * cols + x] / 256) * RAMP.length))];
  lines.push(line.replace(/\s+$/, ""));
}
const out = join(here, "..", "assets", "portrait.txt");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}: ${cols}x${rows}`);
