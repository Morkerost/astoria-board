const assert = require('node:assert/strict');
const { createSnapshot, readSnapshot } = require('./desktop-backup.js');

const files = new Map();
let imageWrites = 0;
const fs = {
  async mkdir() {},
  async exists(path) { return files.has(path); },
  async writeFile(path, bytes) { files.set(path, bytes); if (path.includes('/assets/')) imageWrites++; },
  async writeTextFile(path, text) { files.set(path, text); },
  async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
  async readFile(path) { return files.get(path); },
  async readTextFile(path) { return files.get(path); }
};
const board = { version: 1, notes: [{ type: 'image', assetId: 'picture-1' }] };
const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

(async () => {
  const first = await createSnapshot(fs, 'app-data', board, async () => image, 1000);
  const second = await createSnapshot(fs, 'app-data', board, async () => image, 2000);
  assert.equal(imageWrites, 1);
  assert.equal(first, 'snapshot-1000.json');
  assert.equal(second, 'snapshot-2000.json');
  global.Image = class { naturalWidth = 1; async decode() {} };
  const restored = await readSnapshot(fs, 'app-data', first, b => b.version === 1);
  assert.deepEqual(restored.board, board);
  assert.equal(restored.images.get('picture-1').size, 3);
})().catch(error => { console.error(error); process.exitCode = 1; });

