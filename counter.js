(() => {
  'use strict';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=n=>Math.max(0,Math.min(999999,Math.floor(Number(n)||0)));
  const chargeCount=x=>Math.max(1,Math.min(50,num(x.chargeCount??(Array.isArray(x.cooldowns)?x.cooldowns.length:1))||1));
  const cooldownValues=x=>Array.from({length:chargeCount(x)},(_,j)=>num(Array.isArray(x.cooldowns)?x.cooldowns[j]:(j===0?x.value:0)));
  const presets={
    custom:{title:'Счётчик',items:[]},
    resources:{title:'Ресурсы',items:[['Постоянный адреналин',5,5],['Временный адреналин',0,0],['Ярость',2,2]]}
  };
  function normalize(raw={}){
    return {title:String(raw.title||'Счётчик').slice(0,64),linkId:String(raw.linkId||''),configuring:raw.configuring!==false,items:(Array.isArray(raw.items)?raw.items:[]).map((x,i)=>{
      const ammoTypes=Array.isArray(x.ammoTypes)&&x.ammoTypes.length?x.ammoTypes.map((a,j)=>({id:String(a.id||'ammo-'+j),name:String(a.name||'Обычные').slice(0,40),count:num(a.count),color:/^#[0-9a-f]{6}$/i.test(a.color)?a.color:['#e4ba52','#5796df','#dc5b61'][j%3]})):[{id:'ammo-0',name:'Обычные',count:num(x.value),color:'#e4ba52'}];
      const legacyMagazine=!Array.isArray(x.magazine);
      const magazine=legacyMagazine?ammoTypes.flatMap(a=>Array(Math.min(a.count,200)).fill(a.id)):(x.magazine||[]).map(value=>ammoTypes.find(a=>a.id===value||a.name===value)?.id).filter(Boolean);
      const chamberLoaded=ammoTypes.find(a=>a.id===x.chamberLoaded||a.name===x.chamberLoaded)?.id||'';
      if(legacyMagazine&&x.type==='weapon')ammoTypes.forEach(a=>a.count=0);
      return {
      id:String(x.id||'charge-'+i),type:['resource','consumable','cooldown','weapon','storage'].includes(x.type)?x.type:x.kind==='potion'?'consumable':'resource',
      name:String(x.name||'Заряды').slice(0,64),value:num(x.value),max:x.type==='consumable'?0:num(x.max),
      dailyLimit:num(x.dailyLimit),usedToday:num(x.usedToday),color:String(x.color||'Красный'),consumableKind:x.consumableKind==='injector'||(x.consumableKind==null&&/инъектор/i.test(x.name))?'injector':'potion',storageCapacity:Math.max(1,num(x.storageCapacity)||1),contents:(Array.isArray(x.contents)?x.contents:[]).map((entry,j)=>({id:String(entry.id||'stored-'+j),name:String(entry.name||'').slice(0,80),count:num(entry.count)})),cooldownTurns:Math.max(1,num(x.cooldownTurns)||1),chargeCount:chargeCount(x),cooldowns:cooldownValues(x),
      ammoTypes,magazine,chamberLoaded,fireMode:x.fireMode==='burst'?'burst':'single',burstSize:Math.max(1,Math.min(50,num(x.burstSize)||3))
    };})};
  }
  function create(preset='custom',linkId=''){
    const p=presets[preset]||presets.custom;
    return normalize({title:p.title,linkId,configuring:true,items:p.items.map(([name,value,dailyLimit])=>({id:crypto.randomUUID(),name,value,max:preset==='potions'?10:dailyLimit,dailyLimit:preset==='potions'?dailyLimit:0,type:preset==='potions'?'consumable':'resource',color:name.toLowerCase().includes('син')?'#5796df':'#dc5b61'}))});
  }
  function turn(s,n=1){for(const i of s.items)if(i.type==='cooldown'){i.cooldowns=i.cooldowns.map(v=>Math.max(0,v-n));i.value=0;}}
  function day(s){s.items.forEach(i=>i.usedToday=0);}
  function load(weapon){if(weapon.chamberLoaded||!weapon.magazine.length)return false;weapon.chamberLoaded=weapon.magazine.shift();return true;}
  function fire(weapon,shots=1){shots=Math.max(1,num(shots));if(weapon.magazine.length+(weapon.chamberLoaded?1:0)<shots)return false;for(let n=0;n<shots;n++){if(!weapon.chamberLoaded)load(weapon);weapon.chamberLoaded='';}load(weapon);return true;}
  const consumableButtons=i=>`<div class="counter-potion-actions"><small>${i.consumableKind==='injector'?'Использовано':'Выпито'} ${i.usedToday}/${i.dailyLimit}</small><button data-consume="drink" data-id="${i.id}" ${!i.value||i.usedToday>=i.dailyLimit?'disabled':''}>${i.consumableKind==='injector'?'Использовать':'Выпить'}</button>${i.consumableKind==='potion'?`<button data-consume="give" data-id="${i.id}" ${!i.value?'disabled':''}>Отдать</button><button data-consume="receive" data-id="${i.id}" ${i.usedToday>=i.dailyLimit?'disabled':''}>Принять</button>`:''}</div>`;
  const storageContents=i=>`<div class="counter-storage"><small>Занято ${i.contents.reduce((sum,entry)=>sum+entry.count,0)} / ${i.storageCapacity}</small>${i.contents.map((entry,index)=>`<div class="counter-storage-entry"><input data-storage-name="${i.id}" data-index="${index}" value="${esc(entry.name)}" placeholder="Что хранится" aria-label="Содержимое"><input type="number" min="0" data-storage-count="${i.id}" data-index="${index}" value="${entry.count}" aria-label="Количество"><button data-storage-remove="${i.id}" data-index="${index}" title="Убрать содержимое">×</button></div>`).join('')}<button data-storage-add="${i.id}">＋ Добавить содержимое</button></div>`;
  const ammoType=(weapon,id)=>weapon.ammoTypes.find(a=>a.id===id);
  const weaponPanel=(i,config)=>`<div class='counter-weapon-panel'><div class='counter-ammo-legend'><b>Типы патронов · запас</b>${i.ammoTypes.map((a,index)=>config?`<div class='counter-ammo-type'><input type='color' data-ammo-color='${i.id}' data-index='${index}' value='${a.color}' aria-label='Цвет патрона'><input data-ammo-name='${i.id}' data-index='${index}' value='${esc(a.name)}' aria-label='Тип патрона'><input type='number' min='0' data-ammo-count='${i.id}' data-index='${index}' value='${a.count}' aria-label='Запас патронов'><button data-remove-ammo='${i.id}' data-index='${index}' title='Удалить тип'>×</button></div>`:`<div class='counter-ammo-type' data-ammo-reserve='${i.id}' data-ammo-id='${a.id}' title='Перетащите в магазин'><span class='counter-ammo-dot' style='--ammo-color:${a.color}'></span><span>${esc(a.name)}</span><b>${a.count}</b><span class='counter-reserve-rounds'>${Array.from({length:Math.min(a.count,4)},()=>`<span class='counter-ammo-token' style='--ammo-color:${a.color}'></span>`).join('')}${a.count>4?`<small>+${a.count-4}</small>`:''}</span><button data-mag-add='${i.id}' data-ammo-id='${a.id}' ${!a.count||i.magazine.length>=i.max?'disabled':''} title='Добавить в магазин'>＋</button></div>`).join('')}${config?`<button data-add-ammo='${i.id}'>＋ Тип патрона</button>`:''}</div><div class='counter-magazine' data-magazine='${i.id}'><div><b>Магазин</b><small>${i.magazine.length} / ${i.max} · перетаскивайте патроны для смены порядка</small></div><div class='counter-ammo-lane'>${i.magazine.map((id,index)=>{const a=ammoType(i,id);return a?`<button type='button' class='counter-ammo-token' data-ammo-slot='${i.id}' data-index='${index}' style='--ammo-color:${a.color}' title='${esc(a.name)} · нажмите, чтобы вернуть в запас'><span>${index+1}</span></button>`:'';}).join('')||`<small>Магазин пуст</small>`}</div></div><div class='counter-weapon-controls'><div class='counter-chamber'><b>Ствол</b>${i.chamberLoaded&&ammoType(i,i.chamberLoaded)?`<span class='counter-ammo-token' style='--ammo-color:${ammoType(i,i.chamberLoaded).color}' title='${esc(ammoType(i,i.chamberLoaded).name)}'></span><small>${esc(ammoType(i,i.chamberLoaded).name)}</small>`:`<small>Пусто</small>`}</div><button data-unload='${i.id}' ${!i.chamberLoaded?'disabled':''}>Извлечь</button><button data-load='${i.id}' ${i.chamberLoaded||!i.magazine.length?'disabled':''}>Дослать</button>${i.fireMode==='burst'?`<label>Патронов <select data-shot-count='${i.id}'>${Array.from({length:i.burstSize},(_,n)=>`<option value='${n+1}'>${n+1}</option>`).join('')}</select></label>`:''}<button data-fire='${i.id}' ${!i.chamberLoaded&&!i.magazine.length?'disabled':''}>Выстрелить</button></div></div>`;
  const weaponSettings=i=>`<div class='cb-settings'><label>Ёмкость магазина<input type='number' min='1' data-max='${i.id}' value='${i.max||1}'></label><label>Режим<select data-mode='${i.id}'><option value='single' ${i.fireMode==='single'?'selected':''}>Одиночный</option><option value='burst' ${i.fireMode==='burst'?'selected':''}>Очередь</option></select></label>${i.fireMode==='burst'?`<label>Патронов в очереди<input type='number' min='1' data-burst='${i.id}' value='${i.burstSize}'></label>`:''}</div>`;
  function mount(root,state,characters,onChange,onHeight){
    const shell=document.createElement('div');shell.className='counter-shell';root.append(shell);
    let previous=JSON.parse(JSON.stringify(state));
    function render(){
      const list=typeof characters==='function'?characters():characters;
      const rows=state.items.map(i=>{
        const common=`<header class="cb-row-head"><input data-name="${esc(i.id)}" value="${esc(i.name)}" maxlength="64" aria-label="Название блока"><button class="counter-delete" data-delete="${esc(i.id)}" title="Удалить блок">×</button></header>`;
        if(i.type==='consumable')return `<article class="counter-row">${common}<div class="cb-settings"><label>Тип<select data-consumable-kind="${esc(i.id)}"><option value="potion" ${i.consumableKind==='potion'?'selected':''}>Зелье</option><option value="injector" ${i.consumableKind==='injector'?'selected':''}>Инъектор</option></select></label><label>Цвет<input type="color" data-color="${esc(i.id)}" value="${/^#[0-9a-f]{6}$/i.test(i.color)?i.color:(i.color.toLowerCase().includes('син')?'#5796df':'#dc5b61')}"></label><label>Лимит/день<input type="number" min="0" data-limit="${esc(i.id)}" value="${i.dailyLimit}"></label></div><div class="counter-values"><span>В наличии</span><b>${i.value}</b><button data-change="-1" data-id="${i.id}" ${!i.value?'disabled':''}>−</button><button data-change="1" data-id="${i.id}">＋</button></div>${consumableButtons(i)}</article>`;
        if(i.type==='storage')return `<article class="counter-row">${common}<div class="cb-settings"><label>Мест<input type="number" min="1" data-storage-capacity="${i.id}" value="${i.storageCapacity}"></label></div>${storageContents(i)}</article>`;
        if(i.type==='cooldown')return `<article class="counter-row">${common}<div class="cb-settings"><label>Количество зарядов<input type="number" min="1" max="50" data-charge-count="${i.id}" value="${i.chargeCount}"></label><label>Откат, ходов<input type="number" min="1" data-cooldown="${i.id}" value="${i.cooldownTurns}"></label></div><div class="cb-cooldown-charges">${i.cooldowns.map((v,index)=>`<div><small>Заряд ${index+1}</small><b>${v?`${v} х.`:'ГОТОВ'}</b></div>`).join('')}</div></article>`;
        if(i.type==='weapon')return `<article class='counter-row cb-weapon'>${common}${weaponSettings(i)}${weaponPanel(i,true)}</article>`;
        return `<article class="counter-row">${common}<div class="cb-settings"><label>Макс. запас<input type="number" min="0" data-max="${i.id}" value="${i.max}"></label></div><div class="counter-values"><button data-change="-1" data-id="${i.id}" ${!i.value?'disabled':''}>−</button><b>${i.value}</b><span>/ ${i.max||'∞'}</span><button data-change="1" data-id="${i.id}" ${i.max&&i.value>=i.max?'disabled':''}>＋</button>${i.name.toLowerCase().includes('ярост')?`<button data-spend-two="${i.id}" ${i.value<2?'disabled':''}>Безумство −2</button>`:''}</div></article>`;
      }).join('');
      const viewRows=state.items.map(i=>{
        const detail=i.type==='consumable'?`сегодня ${i.usedToday}/${i.dailyLimit}`:i.type==='storage'?'Хранилище':i.type==='cooldown'?'Заряды и откат':i.type==='weapon'?(i.fireMode==='burst'?`Очередь ${i.burstSize}`:'Одиночный огонь'):'Запас';
        const title=`<div class='counter-view-title'><i style='--charge-color:${/^#[0-9a-f]{6}$/i.test(i.color)?i.color:'#6da9b6'}'></i><strong>${esc(i.name)}</strong><small>${detail}</small></div>`;
        if(i.type==='weapon')return `<article class='counter-view-row'>${title}${weaponPanel(i,false)}</article>`;
        if(i.type==='storage')return `<article class='counter-view-row'>${title}${storageContents(i)}</article>`;
        if(i.type==='cooldown')return `<article class='counter-view-row'>${title}<div class='counter-cooldown-charges'>${i.cooldowns.map((v,index)=>`<button data-use-cooldown='${i.id}' data-charge-index='${index}' ${v?'disabled':''}><small>Заряд ${index+1}</small><b>${v?`${v} х.`:'ГОТОВ'}</b></button>`).join('')}</div></article>`;
        return `<article class='counter-view-row'>${title}<div class='counter-values'><button data-change='-1' data-id='${i.id}' ${i.value<1?'disabled':''}>−</button><b>${i.value}${i.max?' / '+i.max:''}</b><button data-change='1' data-id='${i.id}' ${i.max&&i.value>=i.max?'disabled':''}>＋</button></div>${i.type==='consumable'?consumableButtons(i):i.name.toLowerCase().includes('ярост')?`<button data-spend-two='${i.id}' ${i.value<2?'disabled':''}>Безумство · −2</button>`:''}</article>`;
      }).join('');
      shell.innerHTML=`<header class="counter-head"><div>${state.configuring?`<small>КОНСТРУКТОР СЧЁТЧИКА</small><input data-field="title" maxlength="64" value="${esc(state.title)}" aria-label="Название счётчика">`:`<small>СЧЁТЧИК</small><h3>${esc(state.title)}</h3>`}</div>${state.configuring?`<select data-field="linkId" aria-label="Подключить к персонажу"><option value="">Не подключён к персонажу</option>${list.map(c=>`<option value="${esc(c.id)}" ${state.linkId===c.id?'selected':''}>${esc(c.tracker.name)}</option>`).join('')}</select>`:''}<span class="counter-help"><button type="button" aria-label="Справка по счётчику">?</button><span class="counter-help-popover" role="tooltip"><b>Как пользоваться счётчиком</b><br>В режиме настройки можно добавить блоки и задать их параметры. В игровом режиме кнопки меняют запасы.<br><br><b>Зелья:</b> «Выпить» — выпить самому; «Влить» — применить на другом игроке; «Получить» — другой игрок вливает зелье в вас. Дневной лимит сбрасывается кнопкой «Следующий день» в листе персонажа.<br><br>Размер счётчика меняется за угол, блокировка защищает его от перемещения.</span></span><button data-config>${state.configuring?'Готово':'Настроить'}</button></header><div class="counter-rows">${state.configuring?rows:viewRows}</div>${state.configuring?`<footer><button data-open-add>＋ Добавить блок</button></footer>`:''}${state.addOpen?`<div class="counter-choice-overlay"><section><button class="counter-choice-close" data-close-add>×</button><small>ДОБАВИТЬ В СЧЁТЧИК</small><h3>Что будем считать?</h3><div class="counter-choices">${[['empty','Пустой блок','Собрать с нуля'],['mana','Ячейка маны','Создать свой вид ячейки и задать ему название'],['adrenaline','Адреналин','Обычный или временный запас'],['rage','Ярость','С расходом двух зарядов на безумство'],['injector','Зелье / инъектор','Выберите тип, цвет и лимит на день'],['storage','Ячейка хранения','Укажите вместимость и содержимое'],['cooldown','Блинк / способность','Независимый откат в ходах'],['weapon','Оружие','Смешанный магазин, ствол и очередь']].map(([key,title,sub])=>`<button data-preset-add="${key}"><b>${title}</b><small>${sub}</small></button>`).join('')}</div></section></div>`:''}`;
      shell.querySelectorAll('input,select,button').forEach(x=>x.classList.add('wallet-interactive'));
      shell.style.minHeight=state.addOpen?'480px':'';
      const height=Math.max(150,Math.ceil(shell.scrollHeight));root.style.setProperty('--wallet-height',height+'px');onHeight?.(height);
      previous=JSON.parse(JSON.stringify(state));
    }
    function update(){const before=previous;state=normalize(state);onChange(state,before);render();}
    shell.addEventListener('pointerdown',e=>{if(e.target.closest('input,select,button,.counter-ammo-lane,.counter-ammo-legend'))e.stopPropagation();});
    let dragging=null,suppressAmmoClick=false;
    function finishAmmoDrag(e,cancel=false){
      if(!dragging||e.pointerId!==dragging.pointerId)return;
      const drag=dragging;dragging=null;
      window.removeEventListener('pointermove',moveAmmoDrag);window.removeEventListener('pointerup',finishAmmoDrag);window.removeEventListener('pointercancel',cancelAmmoDrag);
      if(drag.source.hasPointerCapture?.(e.pointerId))drag.source.releasePointerCapture(e.pointerId);
      drag.ghost?.remove();
      if(!drag.active||cancel)return;
      suppressAmmoClick=true;setTimeout(()=>suppressAmmoClick=false,0);
      const target=document.elementFromPoint(e.clientX,e.clientY);
      const slot=target?.closest('[data-ammo-slot]'),reserve=target?.closest('[data-ammo-reserve]'),lane=target?.closest('[data-magazine]');
      const weapon=state.items.find(i=>i.id===drag.weaponId);if(!weapon)return;
      if(drag.kind==='slot'&&reserve?.dataset.ammoReserve===weapon.id){
        const id=weapon.magazine[drag.index],type=ammoType(weapon,id);
        if(type&&id===reserve.dataset.ammoId){weapon.magazine.splice(drag.index,1);type.count++;update();}
      }else if(drag.kind==='slot'&&lane?.dataset.magazine===weapon.id){
        const targetIndex=slot?Number(slot.dataset.index):weapon.magazine.length-1;
        if(targetIndex!==drag.index){const [id]=weapon.magazine.splice(drag.index,1);weapon.magazine.splice(Math.max(0,targetIndex),0,id);update();}
      }else if(drag.kind==='reserve'&&lane?.dataset.magazine===weapon.id){
        const type=ammoType(weapon,drag.ammoId);
        if(type?.count&&weapon.magazine.length<weapon.max){type.count--;weapon.magazine.splice(slot?Number(slot.dataset.index):weapon.magazine.length,0,type.id);update();}
      }
    }
    function cancelAmmoDrag(e){finishAmmoDrag(e,true);}
    function moveAmmoDrag(e){
      if(!dragging||e.pointerId!==dragging.pointerId)return;
      if(!dragging.active&&Math.hypot(e.clientX-dragging.x,e.clientY-dragging.y)<6)return;
      if(!dragging.active){
        const weapon=state.items.find(i=>i.id===dragging.weaponId);
        const id=dragging.kind==='slot'?weapon?.magazine[dragging.index]:dragging.ammoId;
        const type=weapon&&ammoType(weapon,id);if(!type)return;
        const ghost=document.createElement('span');ghost.className='counter-ammo-token counter-drag-ghost';ghost.style.setProperty('--ammo-color',type.color);document.body.append(ghost);dragging.ghost=ghost;dragging.active=true;
      }
      e.preventDefault();dragging.ghost.style.left=e.clientX-20+'px';dragging.ghost.style.top=e.clientY-9+'px';
    }
    shell.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const slot=e.target.closest('[data-ammo-slot]'),reserve=e.target.closest('[data-ammo-reserve]');
      if(!slot&&!reserve||reserve&&!slot&&e.target.closest('button,input,select'))return;
      const weaponId=slot?.dataset.ammoSlot||reserve.dataset.ammoReserve;
      const weapon=state.items.find(i=>i.id===weaponId);
      const ammoId=reserve?.dataset.ammoId;
      if(!weapon||reserve&&(!ammoType(weapon,ammoId)?.count))return;
      const source=slot||reserve;source.setPointerCapture(e.pointerId);
      dragging={kind:slot?'slot':'reserve',weaponId,index:slot?Number(slot.dataset.index):-1,ammoId,source,pointerId:e.pointerId,x:e.clientX,y:e.clientY,active:false,ghost:null};
      window.addEventListener('pointermove',moveAmmoDrag);window.addEventListener('pointerup',finishAmmoDrag);window.addEventListener('pointercancel',cancelAmmoDrag);
    });
    shell.addEventListener('click',e=>{
      if(suppressAmmoClick&&e.target.closest('[data-ammo-slot]')){e.preventDefault();suppressAmmoClick=false;return;}
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-config')){state.configuring=!state.configuring;state.addOpen=false;update();return;}
      if(b.hasAttribute('data-open-add')){state.addOpen=true;render();return;}
      if(b.hasAttribute('data-close-add')){state.addOpen=false;render();return;}
      if(b.dataset.presetAdd){
        const key=b.dataset.presetAdd,id=()=>crypto.randomUUID();
        const base=(type,name,extra={})=>({id:id(),type,name,value:0,max:0,dailyLimit:0,usedToday:0,color:'#dc5b61',cooldownTurns:3,ammoTypes:[{id:id(),name:'Обычные',count:0,color:'#e4ba52'}],magazine:[],chamberLoaded:'',fireMode:'single',burstSize:3,...extra});
        if(key==='empty') state.items.push(base('resource','Новый блок'));
        else if(key==='resource') state.items.push(base('resource','Ресурс'));
        else if(key==='mana') state.items.push(base('resource','Новый вид ячейки маны',{}));
        else if(key==='adrenaline') state.items.push(base('resource','Адреналин',{value:5,max:5}));
        else if(key==='rage') state.items.push(base('resource','Ярость',{value:2,max:2}));
        else if(key==='consumable'||key==='injector') state.items.push(base('consumable','Новый расходник',{dailyLimit:3,consumableKind:'potion'}));
        else if(key==='storage') state.items.push(base('storage','Ячейка хранения',{storageCapacity:6,contents:[]}));
        else if(key==='cooldown') state.items.push(base('cooldown','Блинк',{chargeCount:5,cooldowns:[0,0,0,0,0],cooldownTurns:3}));
        else if(key==='weapon') state.items.push(base('weapon','Оружие',{max:6}));
        state.addOpen=false;update();return;
      }
      if(b.dataset.delete){state.items=state.items.filter(i=>i.id!==b.dataset.delete);update();return;}
      const i=state.items.find(i=>i.id===(b.dataset.id||b.dataset.consume||b.dataset.useCooldown||b.dataset.addAmmo||b.dataset.removeAmmo||b.dataset.spendTwo||b.dataset.fire||b.dataset.load||b.dataset.unload||b.dataset.storageAdd||b.dataset.storageRemove||b.dataset.magAdd||b.dataset.ammoSlot));
      if(b.dataset.magAdd&&i){const a=ammoType(i,b.dataset.ammoId);if(a&&a.count&&i.magazine.length<i.max){a.count--;i.magazine.push(a.id);update();}return;}
      if(b.dataset.ammoSlot&&i){const id=i.magazine.splice(Number(b.dataset.index),1)[0];const a=ammoType(i,id);if(a)a.count++;update();return;}
      if(b.dataset.storageAdd&&i){i.contents.push({id:crypto.randomUUID(),name:'',count:0});update();return;}
      if(b.dataset.storageRemove&&i){i.contents.splice(Number(b.dataset.index),1);update();return;}
      if(b.dataset.change&&i){i.value=num(i.value+Number(b.dataset.change));update();return;}
      if(b.dataset.spendTwo&&i&&i.value>=2){i.value-=2;update();return;}
      if(b.dataset.consume&&i){if(i.consumableKind==='injector'&&b.dataset.consume!=='drink')return;if(b.dataset.consume==='drink'&&i.value&&i.usedToday<i.dailyLimit){i.value--;i.usedToday++;}else if(b.dataset.consume==='give'&&i.value){i.value--;}else if(b.dataset.consume==='receive'&&i.usedToday<i.dailyLimit)i.usedToday++;update();return;}
      if(b.dataset.useCooldown&&i){const index=Number(b.dataset.chargeIndex||0);if(!i.cooldowns[index]){i.cooldowns[index]=i.cooldownTurns;i.value=0;update();}return;}
      if(b.dataset.addAmmo&&i){i.ammoTypes.push({id:crypto.randomUUID(),name:`Патроны ${i.ammoTypes.length+1}`,count:0,color:['#5796df','#dc5b61','#9d82df'][i.ammoTypes.length%3]});update();return;}
      if(b.dataset.removeAmmo&&i){const removed=i.ammoTypes.splice(Number(b.dataset.index),1)[0];if(removed){i.magazine=i.magazine.filter(id=>id!==removed.id);if(i.chamberLoaded===removed.id)i.chamberLoaded='';}if(!i.ammoTypes.length)i.ammoTypes.push({id:crypto.randomUUID(),name:'Обычные',count:0,color:'#e4ba52'});update();return;}
      if(b.dataset.load&&i){if(load(i))update();return;}
      if(b.dataset.unload&&i&&i.chamberLoaded){const a=ammoType(i,i.chamberLoaded);if(a)a.count++;i.chamberLoaded='';update();return;}
      if(b.dataset.fire&&i){const shots=i.fireMode==='burst'?Number(shell.querySelector(`[data-shot-count="${i.id}"]`)?.value||i.burstSize):1;if(fire(i,shots))update();return;}
    });
    shell.addEventListener('change',e=>{if(e.target.matches('.counter-new-type,[data-shot-count]'))return;const d=e.target.dataset;const i=state.items.find(x=>x.id===(d.name||d.max||d.turn||d.cooldown||d.chargeCount||d.limit||d.color||d.consumableKind||d.mode||d.burst||d.chamber||d.ammoName||d.ammoCount||d.ammoColor||d.storageCapacity||d.storageName||d.storageCount));if(d.field==='title')state.title=e.target.value||'Счётчик';else if(d.field==='linkId')state.linkId=e.target.value;else if(i){if(d.name)i.name=e.target.value||i.name;if(d.max){i.max=i.type==='weapon'?Math.max(1,num(e.target.value),i.magazine.length):num(e.target.value);i.value=Math.min(i.value,i.max||i.value);}if(d.cooldown)i.cooldownTurns=Math.max(1,num(e.target.value));if(d.chargeCount){i.chargeCount=Math.max(1,Math.min(50,num(e.target.value)||1));i.cooldowns=Array.from({length:i.chargeCount},(_,j)=>i.cooldowns[j]||0);}if(d.limit)i.dailyLimit=num(e.target.value);if(d.color)i.color=e.target.value;if(d.consumableKind)i.consumableKind=e.target.value;if(d.mode)i.fireMode=e.target.value;if(d.burst)i.burstSize=Math.max(1,Math.min(50,num(e.target.value)));if(d.chamber)i.chambered=e.target.value;if(d.ammoName)i.ammoTypes[Number(d.index)].name=e.target.value||'Патроны';if(d.ammoColor)i.ammoTypes[Number(d.index)].color=e.target.value;if(d.ammoCount)i.ammoTypes[Number(d.index)].count=num(e.target.value);if(d.storageCapacity)i.storageCapacity=Math.max(1,num(e.target.value)||1,i.contents.reduce((sum,entry)=>sum+entry.count,0));if(d.storageName)i.contents[Number(d.index)].name=e.target.value.slice(0,80);if(d.storageCount){const index=Number(d.index),other=i.contents.reduce((n,entry,j)=>n+(j===index?0:entry.count),0);i.contents[index].count=Math.min(num(e.target.value),Math.max(0,i.storageCapacity-other));}}update();});
    render();return render;
  }
  globalThis.CounterWidget={normalize,create,turn,day,load,fire,mount};
})();
