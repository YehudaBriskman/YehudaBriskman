#!/usr/bin/env node
/*
 * One-off: turns a photo into assets/portrait.txt, the ASCII art that
 * readme-art.mjs scans into whoami.svg. Run it when you change the photo; the
 * nightly job never needs it (so the Action has no image dependency).
 *
 *   node scripts/ascii.mjs <image> [--crop x,y,w,h] [--cols 104] [--out assets/portrait.txt]
 *
 * Needs `sharp`, which is not a dependency of this repo:
 *   npm i --no-save sharp   (or NODE_PATH=/some/node_modules)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const input = process.argv[2];
if (!input) throw new Error("usage: ascii.mjs <image> [--crop x,y,w,h] [--cols N]");
const cols = +arg("cols", 104);
const [cx, cy, cw, ch] = (arg("crop", "") || "").split(",").map(Number);
const out = join(here, "..", arg("out", "assets/portrait.txt"));

let img = sharp(input).rotate();
const meta = await img.metadata();
const crop = cw ? { left: cx, top: cy, width: cw, height: ch } : { left: 0, top: 0, width: meta.width, height: meta.height };
/* A terminal cell is about 0.6 wide and 1.0 tall (here 3.72 x 6.2 px): sample rows accordingly. */
const rows = Math.round(cols * (crop.height / crop.width) * (3.72 / 6.2));
const { data } = await img
  .extract(crop)
  .greyscale()
  .resize({ width: crop.width * 4, kernel: "lanczos3" })
  .blur(2.2)
  .normalise({ lower: 4, upper: 96 })
  .gamma(1.2)
  .resize(cols, rows, { fit: "fill" })
  .raw()
  .toBuffer({ resolveWithObject: true });

/* Dark background: light pixels get the dense glyphs. */
const RAMP = " .,:;i1tfLCG08@";
const lines = [];
for (let y = 0; y < rows; y += 1) {
  let line = "";
  for (let x = 0; x < cols; x += 1) {
    const v = data[y * cols + x] / 255;
    line += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
  }
  lines.push(line.replace(/\s+$/, ""));
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}: ${cols}x${rows}`);
