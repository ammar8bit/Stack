// Generates build/icon.ico from the website's assets/logo-512.png.
// Run with Electron (`electron scripts/make-icon.js`) so nativeImage does the resizing and no
// image library is needed. Small sizes are stored as classic 32-bit bitmaps and 256px as PNG,
// which is the layout Windows, NSIS and electron-builder all accept.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '..', '..', 'assets', 'logo-512.png');
const outDir = path.resolve(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function bitmapEntry(image, size) {
  const bgra = image.toBitmap(); // premultiplied BGRA, top-down
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // colour rows + mask rows
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4; // bitmaps are stored bottom-up
      const a = bgra[from + 3];
      for (let c = 0; c < 3; c++) pixels[to + c] = a ? Math.min(255, Math.round(bgra[from + c] * 255 / a)) : 0;
      pixels[to + 3] = a;
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

app.whenReady().then(() => {
  const logo = nativeImage.createFromPath(source);
  if (logo.isEmpty()) throw new Error('make-icon: could not read ' + source);
  const entries = SIZES.map(size => {
    const image = logo.resize({ width: size, height: size, quality: 'best' });
    return { size, data: size === 256 ? image.toPNG() : bitmapEntry(image, size) };
  });
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach((entry, i) => {
    const at = 6 + i * 16;
    dir.writeUInt8(entry.size === 256 ? 0 : entry.size, at);
    dir.writeUInt8(entry.size === 256 ? 0 : entry.size, at + 1);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([dir].concat(entries.map(e => e.data))));
  console.log('Icon written to build/icon.ico (' + SIZES.join(', ') + ' px)');
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
