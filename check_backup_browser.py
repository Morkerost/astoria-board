import main
import json
import time
from pathlib import Path
original = main.BrowserTab.call
def patched(self, method, params=None):
    if method == 'Page.captureScreenshot':
        def evaluate(code):
            result=original(self,'Runtime.evaluate',{'expression':code,'returnByValue':True,'awaitPromise':True})
            if 'exceptionDetails' in result: raise RuntimeError(json.dumps(result['exceptionDetails'],ensure_ascii=False))
            return result['result'].get('value')
        def ready(selector):
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                try:
                    if evaluate(f"document.readyState==='complete' && !!document.querySelector({json.dumps(selector)})"): return
                except RuntimeError: pass
                time.sleep(.05)
            raise RuntimeError('Page did not become ready')
        evaluate('''(async()=>{
          const c=document.createElement('canvas');c.width=8;c.height=8;c.getContext('2d').fillRect(0,0,8,8);
          const blob=await new Promise(r=>c.toBlob(r));
          const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('listok.images.v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('images');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
          await new Promise((resolve,reject)=>{const t=db.transaction('images','readwrite');t.objectStore('images').put(blob,'original');t.oncomplete=resolve;t.onerror=reject;});db.close();
          const base={x:150,y:180,tilt:0};
          const notes=[{...base,id:'sticky',text:'Важные записи',color:'yellow',size:200},
            {...base,id:'text',type:'text',text:'Подпись',width:200,fontSize:28,groupId:'group'},
            {...base,id:'image',type:'image',assetId:'original',width:240,height:240,scale:1,groupId:'group',locked:true},
            {...base,id:'wallet',type:'wallet',text:'',width:440,height:640,scale:1,transactions:[{id:'tx',type:'income',amounts:{P:0,G:7,S:0,C:0},description:'Награда',at:1}]},
            {...base,id:'rpg',type:'rpg',width:1080,height:860,scale:.5,tracker:RpgTracker.normalize({turn:12,resources:{temporary:6}})}];
          localStorage.setItem('listok.board.v1',JSON.stringify({version:1,notes,camera:{x:0,y:0,scale:.7},width:1440,height:900,preferredColor:'mint'}));
          // Simulate a closed browser receiving saved data, without this page's pagehide autosave.
          Storage.prototype.setItem=function(){};
        })()''')
        original(self,'Page.reload'); ready('.rpg-card')
        before=evaluate("JSON.parse(localStorage.getItem('listok.board.v1'))")
        encoded=evaluate('''(async()=>{
          const originalClick=HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click=function(){window.archivePromise=fetch(this.href).then(r=>r.blob());};
          try {await document.getElementById('backup-download').onclick();} finally {HTMLAnchorElement.prototype.click=originalClick;}
          const blob=await window.archivePromise;if(!blob)throw Error(document.getElementById('backup-status').textContent);
          return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);});
        })()''')
        evaluate('''(async()=>{
          localStorage.clear();
          const db=await new Promise(resolve=>{const q=indexedDB.open('listok.images.v1',1);q.onsuccess=()=>resolve(q.result);});
          await new Promise((resolve,reject)=>{const t=db.transaction('images','readwrite');t.objectStore('images').clear();t.oncomplete=resolve;t.onerror=reject;});db.close();
          Storage.prototype.setItem=function(){};
        })()''')
        original(self,'Page.reload'); ready('.note')
        print(evaluate('''(async()=>{
          const before=localStorage.getItem('listok.board.v1');
          const transfer=new DataTransfer();transfer.items.add(new File(['broken'],'broken.listok'));
          const input=document.getElementById('backup-file');input.files=transfer.files;
          window.confirm=()=>{throw Error('Invalid file reached confirmation');};
          await input.onchange();
          if(localStorage.getItem('listok.board.v1')!==before)throw Error('Invalid file changed board');
          if(!document.getElementById('backup-status').textContent.includes('Не удалось'))throw Error('No error shown');
          return 'Browser: invalid archive rejected without changing board';
        })()'''))
        evaluate('''(() => {
          const raw=atob('''+json.dumps(encoded)+''');const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
          const transfer=new DataTransfer();transfer.items.add(new File([bytes],'test.listok'));
          const input=document.getElementById('backup-file');input.files=transfer.files;
          window.confirm=()=>true;document.getElementById('backup-menu').open=true;
          setTimeout(()=>input.dispatchEvent(new Event('change')),0);
        })()''')
        ready('.rpg-card')
        after=evaluate("JSON.parse(localStorage.getItem('listok.board.v1'))")
        old_id=before['notes'][2]['assetId'];new_id=after['notes'][2]['assetId']
        assert old_id!=new_id
        after['notes'][2]['assetId']=old_id
        assert before==after, 'Board differs after restore'
        print(evaluate('''(async()=>{
          const img=document.querySelector('.image-card img');await img.decode();if(img.naturalWidth!==8)throw Error('Image was not recovered');
          if(!document.querySelector('.image-card').classList.contains('locked'))throw Error('Lock not restored');
          document.getElementById('backup-menu').open=true;
          return 'Browser: export, clear localStorage + image database, import, exact board restoration and decoded image passed';
        })()'''))
    return original(self, method, params)
main.BrowserTab.call=patched
main.capture(Path('backup-preview.png'))
