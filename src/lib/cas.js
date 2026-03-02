const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
};

function extForMime(mime) {
  return MIME_TO_EXT[mime] || 'bin';
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function storeBuffer(casDir, buffer, mime) {
  const hash = hashBuffer(buffer);
  const ext = extForMime(mime);
  const relativePath = path.join(hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ext}`);
  const absolutePath = path.join(casDir, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  try {
    await fs.access(absolutePath);
  } catch {
    await fs.writeFile(absolutePath, buffer);
  }

  return {
    hash,
    ext,
    casPath: relativePath,
    size: buffer.length,
  };
}

async function readBuffer(casDir, casPath) {
  return fs.readFile(path.join(casDir, casPath));
}

function absoluteAssetPath(casDir, casPath) {
  return path.join(casDir, casPath);
}

module.exports = {
  extForMime,
  storeBuffer,
  readBuffer,
  absoluteAssetPath,
};
