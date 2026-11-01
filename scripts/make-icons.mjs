import zlib from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 手写 PNG 编码器：不引第三方依赖，生成托盘/应用图标 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources');

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function canvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function blend(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const src = a / 255;
  const dstA = c.data[i + 3] / 255;
  const outA = src + dstA * (1 - src);
  if (outA === 0) return;
  for (let k = 0; k < 3; k += 1) {
    const srcC = [r, g, b][k];
    c.data[i + k] = Math.round((srcC * src + c.data[i + k] * dstA * (1 - src)) / outA);
  }
  c.data[i + 3] = Math.round(outA * 255);
}

function roundedRect(c, x0, y0, w, h, radius, color) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const dx = Math.min(x - x0, x0 + w - 1 - x);
      const dy = Math.min(y - y0, y0 + h - 1 - y);
      const inside =
        dx > radius || dy > radius
          ? true
          : (dx - radius) ** 2 + (dy - radius) ** 2 <= radius * radius;
      if (inside) blend(c, x, y, color);
    }
  }
}

function dot(c, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) blend(c, x, y, color);
    }
  }
}

function drawIcon(size) {
  const c = canvas(size);
  const s = size / 32;
  // 底：近黑圆角方块
  roundedRect(c, 0, 0, size, size, Math.round(7 * s), [11, 15, 13, 255]);
  // 内框：荧光绿极细描边
  const inset = Math.round(4 * s);
  const line = Math.max(1, Math.round(1.2 * s));
  const accent = [154, 230, 110, 255];
  const dim = [154, 230, 110, 90];
  for (let t = 0; t < line; t += 1) {
    const y0 = inset + t;
    const y1 = size - inset - 1 - t;
    const x0 = inset + t;
    const x1 = size - inset - 1 - t;
    for (let x = x0; x <= x1; x += 1) {
      blend(c, x, y0, dim);
      blend(c, x, y1, dim);
    }
    for (let y = y0; y <= y1; y += 1) {
      blend(c, x0, y, dim);
      blend(c, x1, y, dim);
    }
  }
  // 三个数据点由细线连成上扬折线：象征"课堂信号"
  const r = Math.max(1.1, 1.8 * s);
  const lineWidth = Math.max(1, Math.round(0.6 * s));
  const connect = (ax, ay, bx, by, color) => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = steps === 0 ? 0 : i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      for (let ox = -lineWidth; ox <= lineWidth; ox += 1) {
        for (let oy = -lineWidth; oy <= lineWidth; oy += 1) {
          if (ox * ox + oy * oy <= lineWidth * lineWidth) blend(c, Math.round(x + ox), Math.round(y + oy), color);
        }
      }
    }
  };
  connect(10 * s, 21 * s, 16 * s, 15.5 * s, [154, 230, 110, 110]);
  connect(16 * s, 15.5 * s, 22.5 * s, 10 * s, [255, 184, 77, 110]);
  dot(c, 10 * s, 21 * s, r, accent);
  dot(c, 16 * s, 15.5 * s, r, accent);
  dot(c, 22.5 * s, 10 * s, r, [255, 184, 77, 255]);
  return c;
}

await mkdir(outDir, { recursive: true });

const trayCanvas = drawIcon(32);
await writeFile(join(outDir, 'tray.png'), encodePng(32, 32, trayCanvas.data));

const appCanvas = drawIcon(256);
await writeFile(join(outDir, 'icon.png'), encodePng(256, 256, appCanvas.data));

// Windows .ico：多尺寸，条目内嵌 PNG（Vista+ 支持）
function encodeIco(sizes) {
  const images = sizes.map((size) => ({ size, png: encodePng(size, size, drawIcon(size).data) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size;
    entry[1] = img.size >= 256 ? 0 : img.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += img.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

await writeFile(join(outDir, 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256]));

console.log('icons written to', outDir);
