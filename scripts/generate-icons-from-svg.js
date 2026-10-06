import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function generate() {
  const svgPath = path.resolve('public/icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  // 1. apple-touch-icon.png: 180x180 px with solid white background and padding (safe-zone)
  // Apple recommends 180x180 without transparency because iOS fills transparent areas with black.
  const innerIcon180 = await sharp(svgBuffer)
    .resize(140, 140, { fit: 'contain' })
    .toBuffer();

  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }, // Crisp pure white
    },
  })
    .composite([{ input: innerIcon180, gravity: 'center' }])
    .png()
    .toFile(path.resolve('public/apple-touch-icon.png'));

  // 2. pwa-192x192.png: 192x192 px
  const innerIcon192 = await sharp(svgBuffer)
    .resize(150, 150, { fit: 'contain' })
    .toBuffer();

  await sharp({
    create: {
      width: 192,
      height: 192,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }, // Crisp pure white
    },
  })
    .composite([{ input: innerIcon192, gravity: 'center' }])
    .png()
    .toFile(path.resolve('public/pwa-192x192.png'));

  // 3. pwa-512x512.png: 512x512 px
  const innerIcon512 = await sharp(svgBuffer)
    .resize(410, 410, { fit: 'contain' })
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }, // Crisp pure white
    },
  })
    .composite([{ input: innerIcon512, gravity: 'center' }])
    .png()
    .toFile(path.resolve('public/pwa-512x512.png'));

  // 4. pwa-maskable-512x512.png: 512x512 px with safe zone padding
  const innerIconMaskable = await sharp(svgBuffer)
    .resize(360, 360, { fit: 'contain' })
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }, // Crisp pure white
    },
  })
    .composite([{ input: innerIconMaskable, gravity: 'center' }])
    .png()
    .toFile(path.resolve('public/pwa-maskable-512x512.png'));

  // 5. favicon.ico / favicon (32x32)
  await sharp(svgBuffer)
    .resize(32, 32, { fit: 'contain' })
    .png()
    .toFile(path.resolve('public/favicon.ico'));

  console.log('All icons generated successfully from public/icon.svg!');
}

generate().catch(console.error);
