// Renders the app icon (a dark tile with an amber pulse line) at the sizes iOS
// and the manifest want. Run on a dev machine and commit the PNGs; CI does
// not regenerate them.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a0a0b"/>
  <polyline points="48,300 140,300 180,180 230,392 280,120 320,340 360,300 464,300"
    fill="none" stroke="#ffb340" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  writeFileSync(new URL(`../public/${file}`, import.meta.url), png);
  console.log(file, size);
}
