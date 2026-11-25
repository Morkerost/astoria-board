import main
import json
from pathlib import Path
original=main.BrowserTab.call
def patched(self, method, params=None):
    if method == 'Page.captureScreenshot':
        def evaluate(code):
            result=original(self,'Runtime.evaluate',{'expression':code,'returnByValue':True,'awaitPromise':True})
            if 'exceptionDetails' in result: raise RuntimeError(json.dumps(result['exceptionDetails'],ensure_ascii=False))
            return result['result'].get('value')
        evaluate("document.getElementById('rpg-tool').click()")
        for kind in ['mousePressed','mouseReleased']:
            original(self,'Input.dispatchMouseEvent',{'type':kind,'x':780,'y':460,'button':'left','clickCount':1})
        print(evaluate('''(() => {
          const card=document.querySelector('.rpg-card'); if(!card) throw Error('Widget not created');
          card.querySelector('[data-action=addSkill]').click();
          let f=card.querySelector('form'); f.elements.name.value='Удар'; f.elements.description.value='Сильный удар сверху'; f.elements.cooldown.value='3'; f.requestSubmit();
          card.querySelector('[data-action=use]').click();
          if(!card.querySelector('.rpg-turn').textContent.includes('1')) throw Error('Turn did not advance');
          if(card.querySelector('.rpg-status').textContent!=='2 х.') throw Error('Cooldown incorrect');
          card.querySelector('[data-action=undo]').click();
          if(card.querySelector('.rpg-status').textContent!=='ГОТОВ') throw Error('Undo failed');
          const stock=card.querySelector('[data-potion="small-red"]'); stock.value=5; stock.dispatchEvent(new Event('change',{bubbles:true}));
          card.querySelector('[data-operation=drink]').click();
          if(card.querySelector('[data-potion="small-red"]').value!=='4') throw Error('Drink failed');
          document.querySelector('#wallet-toolbar .lock-element').click();
          if(card.querySelector('.rpg-shell').inert) throw Error('Locked contents inert');
          card.querySelector('[data-operation=drink]').click();
          if(card.querySelector('[data-potion="small-red"]').value!=='3') throw Error('Locked drink failed');
          const data=JSON.parse(localStorage.getItem('listok.board.v1'));
          if(data.notes.find(n=>n.type==='rpg').tracker.potions['small-red'].drunk!==2) throw Error('Persistence failed');
          return 'Browser: creation, editor, use, undo, potions, lock and save passed';
        })()'''))
        original(self,'Page.reload')
        print(evaluate('''new Promise(resolve => { const timer=setInterval(()=>{const c=document.querySelector('.rpg-card'); if(c){clearInterval(timer); if(c.querySelector('[data-potion="small-red"]').value!=='3') throw Error('Reload failed'); resolve('Reload restored tracker');}},30); })'''))
        def click(selector):
            point=evaluate(f"(() => {{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()")
            for kind in ['mousePressed','mouseReleased']:
                original(self,'Input.dispatchMouseEvent',{'type':kind,**point,'button':'left','clickCount':1})
        click('.rpg-card [data-action=turn]')
        if evaluate("document.querySelector('.rpg-turn b').textContent") != '1': raise RuntimeError('Native next turn failed')
        click('.rpg-header')
        click('#wallet-toolbar .lock-element')
        def drag(selector,dx,dy):
            p=evaluate(f"(() => {{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()")
            original(self,'Input.dispatchMouseEvent',{'type':'mousePressed',**p,'button':'left','clickCount':1})
            original(self,'Input.dispatchMouseEvent',{'type':'mouseMoved','x':p['x']+dx,'y':p['y']+dy,'button':'left','buttons':1})
            original(self,'Input.dispatchMouseEvent',{'type':'mouseReleased','x':p['x']+dx,'y':p['y']+dy,'button':'left','clickCount':1})
        before=evaluate("JSON.parse(localStorage.getItem('listok.board.v1')).notes.find(n=>n.type==='rpg')")
        drag('.rpg-header',-20,0)
        moved=evaluate("JSON.parse(localStorage.getItem('listok.board.v1')).notes.find(n=>n.type==='rpg')")
        if moved['x'] >= before['x']: raise RuntimeError('Drag failed')
        drag('.rpg-card [data-corner=se]',-20,-20)
        after=evaluate("JSON.parse(localStorage.getItem('listok.board.v1')).notes.find(n=>n.type==='rpg')")
        if after['scale'] >= moved['scale']: raise RuntimeError('Resize failed')
        print('Native pointer: next turn, unlock, move and proportional resize passed')
        print(evaluate("(() => { const s=document.querySelector('.rpg-sidebar'); if(s.scrollHeight>s.clientHeight+1) throw Error('Resources require scrolling'); return 'All resource panels fit'; })()"))
        for kind in ['mousePressed','mouseReleased']:
            original(self,'Input.dispatchMouseEvent',{'type':kind,'x':1380,'y':650,'button':'left','clickCount':1})
    return original(self,method,params)
main.BrowserTab.call=patched
main.capture(Path('rpg-preview.png'))
