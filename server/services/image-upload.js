const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./commerce');
const {uploadDir}=require('../config/storage');

function imageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function saveImage(bytes, prefix = 'image') {
  const ext = imageType(bytes);
  if (!ext) fail('文件内容不是受支持的 JPG、PNG、GIF 或 WebP 图片');
  fs.mkdirSync(uploadDir, { recursive: true });
  const filename = `${prefix}-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), bytes, { flag: 'wx' });
  return { url: `/uploads/${filename}`, filename, ext };
}

module.exports = { imageType, saveImage };
