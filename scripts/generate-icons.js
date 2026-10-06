import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, r, g, b, a = 255) {
  // A simple uncompressed/deflated raw RGBA scanline PNG generator
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = crc32(body);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(crc, 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  // Table-based CRC32
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return c ^ -1;
  }

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = chunk('IHDR', ihdr);

  // Raw image data with 0 filter byte per scanline
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      // Gradient & GNSS logo shape
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isCenter = dist < width * 0.35;
      const isRing = Math.abs(dist - width * 0.38) < width * 0.02;

      let pr = r, pg = g, pb = b, pa = a;
      if (isCenter) {
        pr = 14; pg = 165; pb = 233; // Sky blue
      } else if (isRing) {
        pr = 16; pg = 185; pb = 129; // Emerald
      } else {
        // Deep navy
        pr = Math.min(255, Math.floor(r * (0.8 + 0.4 * (y / height))));
        pg = Math.min(255, Math.floor(g * (0.8 + 0.4 * (y / height))));
        pb = Math.min(255, Math.floor(b * (0.8 + 0.4 * (y / height))));
      }

      rawData[pixelOffset] = pr;
      rawData[pixelOffset + 1] = pg;
      rawData[pixelOffset + 2] = pb;
      rawData[pixelOffset + 3] = pa;
    }
  }

  const deflated = zlib.deflateSync(rawData);
  const idatChunk = chunk('IDAT', deflated);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 15, 23, 42 -> slate-900 navy
const png192 = createPNG(192, 192, 15, 23, 42);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), png192);

const png512 = createPNG(512, 512, 15, 23, 42);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), png512);
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), png512);

const appleTouch = createPNG(180, 180, 15, 23, 42);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouch);

const fav = createPNG(32, 32, 15, 23, 42);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), fav);

console.log('PWA icons created successfully.');
