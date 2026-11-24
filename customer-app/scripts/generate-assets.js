const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(width, height, pixelFn) {
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y, width, height);
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Draw a modern car silhouette inside a circular badge
function drawCarPixel(x, y, w, h, bgR, bgG, bgB, bgA, iconR, iconG, iconB, isRound = true) {
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.42;

  // Background circle or fill
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  let inBadge = isRound ? dist <= r : true;

  if (!inBadge) {
    return [0, 0, 0, 0];
  }

  // Normalized coordinates from -1 to 1 relative to center
  const nx = (x - cx) / (w * 0.32);
  const ny = (y - cy) / (h * 0.32);

  // Car Body Shapes
  // Lower body: nx in [-0.8, 0.8], ny in [0.0, 0.5]
  const inLowerBody = nx >= -0.8 && nx <= 0.8 && ny >= 0.0 && ny <= 0.45;

  // Roof / cabin: nx in [-0.5, 0.5], ny in [-0.4, 0.0]
  // Slanted windshield & back
  const roofWidth = 0.5 - (ny + 0.4) * 0.3;
  const inCabin = nx >= -roofWidth && nx <= roofWidth && ny >= -0.38 && ny < 0.0;

  // Taxi light / Beacon on roof: nx in [-0.15, 0.15], ny in [-0.52, -0.38]
  const inTaxiLight = nx >= -0.16 && nx <= 0.16 && ny >= -0.52 && ny < -0.38;

  // Wheels: circles at (-0.5, 0.45) and (0.5, 0.45) radius ~ 0.18
  const w1Dist = Math.sqrt((nx - -0.48) ** 2 + (ny - 0.46) ** 2);
  const w2Dist = Math.sqrt((nx - 0.48) ** 2 + (ny - 0.46) ** 2);
  const inWheel = w1Dist <= 0.17 || w2Dist <= 0.17;
  const inWheelHub = w1Dist <= 0.07 || w2Dist <= 0.07;

  // Windows inside cabin: nx in [-0.4, 0.4], ny in [-0.32, -0.05]
  const winWidth = 0.42 - (ny + 0.32) * 0.3;
  const inWindow = nx >= -winWidth && nx <= winWidth && ny >= -0.32 && ny <= -0.05;

  // Render taxi beacon (Gold/Amber)
  if (inTaxiLight) {
    return [245, 158, 11, 255];
  }

  // Render wheels
  if (inWheel) {
    if (inWheelHub) return [226, 232, 240, 255];
    return [30, 41, 59, 255];
  }

  // Render car body
  if (inLowerBody || inCabin) {
    if (inWindow) {
      // Light blue window tint
      return [219, 234, 254, 255];
    }
    return [iconR, iconG, iconB, 255];
  }

  // Default to background
  return [bgR, bgG, bgB, bgA];
}

const assetsDir = path.join(__dirname, '..', 'assets', 'images');
fs.mkdirSync(assetsDir, { recursive: true });

console.log('Generating mobile app assets in:', assetsDir);

// 1. icon.png (1024x1024) - App Icon
const iconPng = createPng(1024, 1024, (x, y, w, h) =>
  drawCarPixel(x, y, w, h, 37, 99, 235, 255, 255, 255, 255, false)
);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconPng);
console.log('✓ icon.png (1024x1024)');

// 2. android-icon-foreground.png (1024x1024)
const foregroundPng = createPng(1024, 1024, (x, y, w, h) =>
  drawCarPixel(x, y, w, h, 0, 0, 0, 0, 37, 99, 235, 255, true)
);
fs.writeFileSync(path.join(assetsDir, 'android-icon-foreground.png'), foregroundPng);
console.log('✓ android-icon-foreground.png (1024x1024)');

// 3. android-icon-background.png (1024x1024)
const backgroundPng = createPng(1024, 1024, () => [230, 244, 254, 255]);
fs.writeFileSync(path.join(assetsDir, 'android-icon-background.png'), backgroundPng);
console.log('✓ android-icon-background.png (1024x1024)');

// 4. android-icon-monochrome.png (1024x1024)
const monochromePng = createPng(1024, 1024, (x, y, w, h) =>
  drawCarPixel(x, y, w, h, 0, 0, 0, 0, 255, 255, 255, 255, true)
);
fs.writeFileSync(path.join(assetsDir, 'android-icon-monochrome.png'), monochromePng);
console.log('✓ android-icon-monochrome.png (1024x1024)');

// 5. splash-icon.png (1024x1024)
const splashPng = createPng(1024, 1024, (x, y, w, h) =>
  drawCarPixel(x, y, w, h, 0, 0, 0, 0, 255, 255, 255, 255, true)
);
fs.writeFileSync(path.join(assetsDir, 'splash-icon.png'), splashPng);
console.log('✓ splash-icon.png (1024x1024)');

// 6. favicon.png (48x48)
const faviconPng = createPng(48, 48, (x, y, w, h) =>
  drawCarPixel(x, y, w, h, 37, 99, 235, 255, 255, 255, 255, false)
);
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), faviconPng);
console.log('✓ favicon.png (48x48)');

console.log('All icons generated successfully!');
