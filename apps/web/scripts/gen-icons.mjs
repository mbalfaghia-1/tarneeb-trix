// Rasterizes the app icon to the PNG sizes the PWA manifest / iOS need.
// Run: node scripts/gen-icons.mjs   (from apps/web)
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const SPADE =
  'M50 6 C30 26 14 40 14 57 C14 70 24 78 35 76 C43 74 49 68 51 61 ' +
  'C50 72 45 82 36 88 L64 88 C55 82 50 72 49 61 C51 68 57 74 65 76 ' +
  'C76 78 86 70 86 57 C86 40 70 26 50 6 Z';

const felt = `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#245c40"/><stop offset="1" stop-color="#143526"/></linearGradient></defs>`;

// "any" icon: rounded card-corners, ring + spade filling most of the tile.
const anySvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  ${felt}
  <rect width="512" height="512" rx="104" fill="url(#f)"/>
  <circle cx="256" cy="256" r="188" fill="none" stroke="#f4b64a" stroke-width="10" opacity="0.85"/>
  <g transform="translate(96,86) scale(3.2)" fill="#fff"><path d="${SPADE}"/></g>
</svg>`;

// maskable icon: full-bleed background, artwork kept inside the safe zone (centred, smaller).
const maskableSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  ${felt}
  <rect width="512" height="512" fill="url(#f)"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#f4b64a" stroke-width="9" opacity="0.85"/>
  <g transform="translate(126,118) scale(2.6)" fill="#fff"><path d="${SPADE}"/></g>
</svg>`;

const jobs = [
  { svg: anySvg, size: 192, file: 'pwa-192.png' },
  { svg: anySvg, size: 512, file: 'pwa-512.png' },
  { svg: maskableSvg, size: 512, file: 'pwa-maskable-512.png' },
  { svg: maskableSvg, size: 180, file: 'apple-touch-icon.png' }, // iOS applies its own mask
  { svg: anySvg, size: 48, file: 'favicon-48.png' },
];

for (const { svg, size, file } of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(outDir, file));
  console.log('wrote', file, size + 'px');
}
