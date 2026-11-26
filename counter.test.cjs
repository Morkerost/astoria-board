const assert = require('node:assert/strict');
require('./counter.js');
const {normalize,load,fire,day} = globalThis.CounterWidget;

const weapon = normalize({items:[{type:'weapon',name:'Винтовка',max:4,ammoTypes:[
  {id:'ordinary',name:'Обычный',color:'#e4ba52',count:2},
  {id:'crystal',name:'Кристальный',color:'#5796df',count:1}
]}]}).items[0];
assert.deepEqual(weapon.magazine,['ordinary','ordinary','crystal']);
assert.equal(weapon.ammoTypes[0].count,0);
weapon.magazine=['crystal','ordinary','crystal'];
assert.equal(load(weapon),true);
assert.equal(weapon.chamberLoaded,'crystal');
assert.deepEqual(weapon.magazine,['ordinary','crystal']);
assert.equal(fire(weapon,2),true);
assert.equal(weapon.chamberLoaded,'crystal');
assert.deepEqual(weapon.magazine,[]);
assert.equal(fire(weapon,2),false);
assert.equal(weapon.chamberLoaded,'crystal');
assert.equal(fire(weapon,1),true);
assert.equal(weapon.chamberLoaded,'');

const counter=normalize({items:[{type:'consumable',name:'Неизвестный раствор',consumableKind:'injector',usedToday:2}]});
day(counter);
assert.equal(counter.items[0].usedToday,0);
assert.equal(counter.items[0].consumableKind,'injector');

let shell;
global.document={createElement(){shell={style:{setProperty(){}},scrollHeight:420,querySelectorAll(){return[]},addEventListener(){}};return shell;}};
const root={style:{setProperty(){}},append(){}};
globalThis.CounterWidget.mount(root,normalize({configuring:false,items:[weapon]}),[],()=>{},()=>{});
assert.match(shell.innerHTML,/<\/small><\/div><div class='counter-weapon-panel'>/);
