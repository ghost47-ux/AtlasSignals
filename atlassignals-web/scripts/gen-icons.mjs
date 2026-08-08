/**
 * gen-icons.mjs — generate properly-sized PWA/social icons from the brand
 * logo (public/logo-main.png). Run: node scripts/gen-icons.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC = 'public/logo-main.png';
const OUT = 'public/icons';

await mkdir(OUT, { recursive: true });

const jobs = [
  ['icon-192.png', 192, 192],
  ['icon-512.png', 512, 512],
  ['icon-maskable-512.png', 512, 512],
  ['apple-touch-icon.png', 180, 180],
];

for (const [name, w, h] of jobs) {
  await sharp(SRC).resize(w, h, { fit: 'cover' }).png({ quality: 90 }).toFile(`${OUT}/${name}`);
  console.log(`wrote ${OUT}/${name} (${w}x${h})`);
}

// Social share cover: 1200x630 center crop.
await sharp(SRC).resize(1200, 630, { fit: 'cover' }).png({ quality: 88 }).toFile('public/og-cover.png');
console.log('wrote public/og-cover.png (1200x630)');
