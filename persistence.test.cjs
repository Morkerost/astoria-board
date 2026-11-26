const assert = require('node:assert/strict');
const { pack, unpack } = require('./backup.js');
const { createSnapshot, readSnapshot } = require('./desktop-backup.js');
require('./counter.js');
const RpgTracker = require('./rpg.js');

const counter = CounterWidget.normalize({
  title: 'Арсенал', linkId: 'hero', configuring: false, items: [
    { id: 'potion', type: 'consumable', name: 'Красное зелье', value: 7, dailyLimit: 3, usedToday: 2, given: 4, consumableKind: 'potion', color: '#dd3344' },
    { id: 'injector', type: 'consumable', name: 'Инъектор', value: 2, dailyLimit: 5, usedToday: 1, consumableKind: 'injector' },
    { id: 'mana', type: 'resource', name: 'Нестабильная мана', value: 4, max: 8 },
    { id: 'storage', type: 'storage', name: 'Сумка', storageCapacity: 9, contents: [{ id: 'item', name: 'Кристаллы', count: 3 }] },
    { id: 'blink', type: 'cooldown', name: 'Блинк', chargeCount: 3, cooldownTurns: 4, cooldowns: [0, 2, 4] },
    { id: 'gun', type: 'weapon', name: 'Винтовка', max: 6, ammoTypes: [{ id: 'blue', name: 'Кристальные', count: 8, color: '#2244ee' }, { id: 'red', name: 'Бронебойные', count: 3, color: '#ee3344' }], magazine: ['red', 'blue', 'red'], chamberLoaded: 'blue', fireMode: 'burst', burstSize: 2 }
  ]
});
const tracker = RpgTracker.normalize({ name: 'Готрик', turn: 7, mode: 'dodge', skills: [
  { id: 'skill', name: 'Рывок', description: 'Описание', source: 'Топор', cooldown_type: 'turns', cooldown: 4, remaining: 2 }
], resources: { adrenalineTotal: 5, adrenaline: 3, temporary: 2, rageTotal: 4, rage: 3, madness: 'Эффект' }, history: [{ name: 'Готрик', turn: 6 }] });
const board = { version: 1, camera: { x: -100, y: 42, scale: 1.8 }, preferredColor: 'mint', width: 1200, height: 800, notes: [
  { id: 'sticky', x: 1, y: 2, tilt: 4, size: 240, color: 'mint', text: 'Заметка', groupId: 'group', locked: true },
  { id: 'text', type: 'text', x: 3, y: 4, tilt: 0, width: 320, height: 80, fontSize: 26, font: 'Arial', align: 'center', ink: '#112233', text: 'Текст', groupId: 'group' },
  { id: 'image', type: 'image', x: 5, y: 6, tilt: 0, width: 640, height: 480, scale: 2, assetId: 'art', name: 'Карта' },
  { id: 'flip', type: 'flipcard', x: 7, y: 8, tilt: 0, width: 300, height: 420, scale: 1.3, flipped: true, front: { title: 'Лицевая', text: 'Текст', color: 'yellow', assetId: 'art' }, back: { title: 'Оборот', text: 'Другой текст', color: 'blue', assetId: 'back' } },
  { id: 'wallet', type: 'wallet', x: 9, y: 10, tilt: 0, width: 440, height: 640, scale: 1.1, title: 'Казна', palette: 'plum', color: '#445566', autoConvert: false, rates: { buy: { P: 100, G: 90, S: 50 }, sell: { P: 80, G: 70, S: 40 } }, transactions: [{ id: 'tx', type: 'income', amounts: { P: 1, G: 2, S: 3, C: 4 }, description: 'Награда', at: 123 }] },
  { id: 'hero', type: 'rpg', x: 11, y: 12, tilt: 0, width: 1080, height: 860, scale: .7, tracker, actionHistory: [{ tracker }] },
  { id: 'counter', type: 'counter', x: 13, y: 14, tilt: 0, width: 520, height: 945, scale: .9, counter }
] };

(async () => {
  assert.deepEqual(CounterWidget.normalize(counter), counter);
  assert.deepEqual(RpgTracker.normalize(tracker), tracker);
  const blobs = new Map([['art', new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' })], ['back', new Blob([Uint8Array.from([4, 5])], { type: 'image/webp' })]]);
  const valid = data => data?.version === 1 && Array.isArray(data.notes);
  const archive = await unpack(await pack(board, id => blobs.get(id)), valid);
  assert.deepEqual(archive.board, board);
  assert.deepEqual([...archive.images.keys()], ['art', 'back']);
  for (const [id, blob] of archive.images) assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(await blobs.get(id).arrayBuffer()));
  const files = new Map();
  const fs = { async mkdir() {}, async exists(p) { return files.has(p); }, async writeFile(p, bytes) { files.set(p, bytes); }, async writeTextFile(p, value) { files.set(p, value); }, async rename(a, b) { files.set(b, files.get(a)); files.delete(a); }, async readFile(p) { return files.get(p); }, async readTextFile(p) { return files.get(p); } };
  const name = await createSnapshot(fs, 'app-data', board, id => blobs.get(id), 123456);
  global.Image = class { naturalWidth = 1; async decode() {} };
  const snapshot = await readSnapshot(fs, 'app-data', name, valid);
  assert.deepEqual(snapshot.board, board);
  assert.deepEqual([...snapshot.images.keys()], ['art', 'back']);
  assert.equal(snapshot.images.get('back').type, 'image/webp');
  console.log('All board elements, nested widget settings, front/back images, and camera survived both backup formats.');
})().catch(error => { console.error(error); process.exitCode = 1; });
