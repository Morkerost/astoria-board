const assert = require('node:assert/strict');
const { pack, unpack } = require('./backup.js');
(async () => {
  const board = { version: 1, notes: [{ id:'1',type:'image',assetId:'shared' }, {id:'2',type:'image',assetId:'shared'}, {id:'3',type:'rpg',tracker:{turn:5}}] };
  const image = new Blob([new Uint8Array([0,1,2,250,255])], {type:'image/png'});
  const valid = b => b?.version === 1 && Array.isArray(b.notes);
  const archive = await pack(board, async()=>image);
  const data = await unpack(archive, valid);
  assert.deepEqual(data.board,board); assert.equal(data.images.size,1);
  assert.deepEqual(new Uint8Array(await data.images.get('shared').arrayBuffer()), new Uint8Array(await image.arrayBuffer()));
  await assert.rejects(pack(board,async()=>undefined),/отсутствует/);
  await assert.rejects(unpack(new Blob(['bad']),valid),/не резервная/);
  await assert.rejects(unpack(archive.slice(0,archive.size-1),valid),/Повреждён/);
  await assert.rejects(unpack(new Blob([archive,'extra']),valid),/лишние/);
  await assert.rejects(unpack(archive,()=>false),/повреждённые/);
  const empty = {version:1,notes:[]}; assert.deepEqual((await unpack(await pack(empty,()=>{}),valid)).board,empty);
  console.log('Backup: binary round trip, shared assets, empty board, missing images, corrupt and truncated archives passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
