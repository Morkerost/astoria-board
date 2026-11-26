/* RPG state and view; independent from the board's camera and selection. */
(() => {
  'use strict';
  const integer = v => Math.min(999999, Math.max(0, Math.floor(Number(v) || 0)));
  const types = ['turns', 'days', 'rest', 'none'];
  const sizes = ['small', 'medium', 'large'];
  const caps = { small: 3, medium: 6, large: 9 };
  const clone = v => JSON.parse(JSON.stringify(v));
  function normalize(raw = {}) {
    const s = { name: String(raw.name || 'Персонаж').slice(0,64), turn: integer(raw.turn), mode: raw.mode === 'dodge' ? 'dodge' : 'action', skills: [], potions: {}, resources: {}, history: [] };
    s.skills = (Array.isArray(raw.skills) ? raw.skills : []).map((v, i) => ({ id: String(v.id || 'skill-' + i), name: String(v.name || 'Навык'), description: String(v.description || ''), source: String(v.source || ''), cooldown_type: types.includes(v.cooldown_type) ? v.cooldown_type : 'none', cooldown: integer(v.cooldown), remaining: integer(v.remaining) })).map(v => ({ ...v, remaining: v.cooldown_type === 'none' ? 0 : Math.min(v.remaining, v.cooldown_type === 'rest' ? 1 : v.cooldown) }));
    for (const size of sizes) for (const color of ['red', 'blue']) {
      const key = size + '-' + color, p = raw.potions?.[key] || {};
      s.potions[key] = { stock: integer(p.stock), drunk: Math.min(caps[size], integer(p.drunk)), given: integer(p.given) };
    }
    for (const key of ['adrenalineTotal', 'adrenaline', 'temporary', 'rageTotal', 'rage']) s.resources[key] = integer(raw.resources?.[key]);
    s.resources.adrenaline = Math.min(s.resources.adrenaline, s.resources.adrenalineTotal);
    s.resources.rage = Math.min(s.resources.rage, s.resources.rageTotal);
    s.resources.madness = String(raw.resources?.madness || '');
    s.history = Array.isArray(raw.history) ? raw.history.slice(-50).map(v => { const n = normalize({ ...v, history: [] }); delete n.history; return n; }) : [];
    return s;
  }
  function dispatch(s, a) {
    if (a.type === 'undo') { const prev = s.history.pop(); if (!prev) return false; const history = s.history; Object.assign(s, prev, { history }); return true; }
    const before = clone({ ...s, history: undefined });
    const nextTurn = () => { s.turn++; s.skills.forEach(v => { if (v.cooldown_type === 'turns') v.remaining = Math.max(0, v.remaining - 1); }); };
    if (a.type === 'use') {
      const v = s.skills.find(v => v.id === a.id); if (!v || v.remaining) return false;
      // Advance the shared turn first. The skill being used starts its full cooldown after that turn.
      if (s.mode === 'action') nextTurn();
      v.remaining = v.cooldown_type === 'rest' ? 1 : v.cooldown_type === 'none' ? 0 : v.cooldown;
    } else if (a.type === 'turn') nextTurn();
    else if (a.type === 'day') { s.skills.forEach(v => { if (v.cooldown_type === 'days') v.remaining = Math.max(0, v.remaining - 1); }); Object.values(s.potions).forEach(p => p.drunk = 0); }
    else if (a.type === 'rest') { s.turn = 0; s.skills.forEach(v => { if (v.cooldown_type === 'rest') v.remaining = 0; }); }
    else if (a.type === 'mode') s.mode = a.value === 'dodge' ? 'dodge' : 'action';
    else if (a.type === 'name') s.name = String(a.value || 'Персонаж').slice(0,64);
    else if (a.type === 'skill') {
      const old = s.skills.find(v => v.id === a.skill.id);
      const v = normalize({ skills: [a.skill] }).skills[0];
      v.remaining = old && old.cooldown_type === v.cooldown_type ? Math.min(old.remaining, v.cooldown_type === 'rest' ? 1 : v.cooldown) : 0;
      if (old) Object.assign(old, v); else s.skills.push(v);
    } else if (a.type === 'deleteSkill') s.skills = s.skills.filter(v => v.id !== a.id);
    else if (a.type === 'potion') {
      const p = s.potions[a.key]; if (!p) return false;
      const cap = caps[a.key.split('-')[0]];
      if (a.operation === 'stock') p.stock = integer(a.value);
      else if (a.operation === 'give') { if (!p.stock) return false; p.stock--; p.given++; }
      else if (['drink', 'receive'].includes(a.operation)) {
        if (p.drunk >= cap || (a.operation === 'drink' && !p.stock)) return false;
        if (a.operation === 'drink') p.stock--; p.drunk++;
      } else return false;
    } else if (a.type === 'resource') {
      if (!(a.key in s.resources)) return false;
      s.resources[a.key] = a.key === 'madness' ? String(a.value) : integer(a.value);
      s.resources.adrenaline = Math.min(s.resources.adrenaline, s.resources.adrenalineTotal);
      s.resources.rage = Math.min(s.resources.rage, s.resources.rageTotal);
    } else if (a.type === 'spend') {
      const cost = a.key === 'madness' ? 2 : 1, key = a.key === 'madness' ? 'rage' : a.key;
      if (!['adrenaline', 'temporary', 'rage'].includes(key) || s.resources[key] < cost) return false;
      s.resources[key] -= cost;
    } else return false;
    if (a.type !== 'day' && JSON.stringify(before) === JSON.stringify({ ...s, history: undefined })) return false;
    s.history.push(before); if (s.history.length > 50) s.history.shift(); return true;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cooldown = v => v.cooldown_type === 'rest' ? 'До отдыха' : v.cooldown_type === 'none' ? 'Без отката' : v.cooldown + (v.cooldown_type === 'turns' ? ' х.' : ' сут.');
  function mount(root, state, onChange, beforeAction, undoLinked, canUndoLinked) {
    let editing = false, formId = null, size = 'small';
    const shell = document.createElement('div'); shell.className = 'rpg-shell'; root.append(shell);
    const button = (label, action, extra = '') => `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
    const num = (label, value, attrs) => `<label>${label}<input type="number" min="0" max="999999" step="1" value="${value}" ${attrs}></label>`;
    function render() {
      const r = state.resources;
      shell.innerHTML = `<header class="rpg-header"><div><small>ЛИСТ ПЕРСОНАЖА</small><input class="rpg-character-name wallet-interactive" aria-label="Имя персонажа" value="${esc(state.name)}" maxlength="64"><span class="rpg-name-hint">Имя для подключения счётчиков</span></div><span class="rpg-turn">ХОД <b>${state.turn}</b></span></header>
      <div class="rpg-layout wallet-interactive"><section class="rpg-skills rpg-panel"><div class="rpg-section-head"><h3>${editing ? 'Редактор навыков' : 'Навыки'}</h3><div class="rpg-segment">${button('Действие', 'mode', `data-value="action" aria-pressed="${state.mode === 'action'}"`)}${button('Уклонение', 'mode', `data-value="dodge" aria-pressed="${state.mode === 'dodge'}"`)}</div></div>
      <div class="rpg-skill-scroll"><table><thead><tr><th>Навык / источник</th><th>Перезарядка</th><th>Статус</th><th></th></tr></thead><tbody>${state.skills.map(v => `<tr><td><span class="rpg-skill-name" tabindex="0">${esc(v.name)}<span class="rpg-tooltip" role="tooltip">${esc(v.description || 'Нет описания')}</span></span><small>${esc(v.source || 'Без источника')}</small></td><td>${cooldown(v)}</td><td><span class="rpg-status ${v.remaining ? 'waiting' : ''}">${!v.remaining ? 'ГОТОВ' : v.cooldown_type === 'rest' ? 'ДО ОТДЫХА' : v.remaining + (v.cooldown_type === 'days' ? ' сут.' : ' х.')}</span></td><td>${editing ? button('Изменить', 'editSkill', `data-id="${esc(v.id)}"`) + button('×', 'deleteSkill', `data-id="${esc(v.id)}" aria-label="Удалить навык"`) : button('Использовать', 'use', `data-id="${esc(v.id)}" ${v.remaining ? 'disabled' : ''}`)}</td></tr>`).join('')}</tbody></table>${!state.skills.length ? '<div class="rpg-empty"><span>✧</span><h3>Здесь начнётся приключение</h3><p>Добавьте навыки персонажа и предметов.<br>Перезарядки будут считаться автоматически.</p>' + button('+ Добавить навык', 'addSkill') + '</div>' : ''}</div>
      <div class="rpg-footer">${editing ? button('+ Добавить навык', 'addSkill') + button('Готово', 'editor') : button('← Назад', 'undo', `${state.history.length || canUndoLinked?.() ? '' : 'disabled'} title="Отменить последнее изменение (до 50 действий)"`) + button('Следующий ход →', 'turn') + button('Отдых', 'rest') + button('Следующий день', 'day') + button('Редактор', 'editor')}</div></section>
      </div>`;
      if (formId !== null) renderForm();
    }
    function renderForm() {
      const v = state.skills.find(v => v.id === formId) || { name:'', source:'Базовый', description:'', cooldown_type:'turns', cooldown:1 };
      const overlay = document.createElement('div'); overlay.className = 'rpg-modal wallet-interactive';
      overlay.innerHTML = `<form class="rpg-form"><div class="rpg-section-head"><h3>${formId ? 'Изменить навык' : 'Новый навык'}</h3>${button('×','closeForm','aria-label="Закрыть редактор навыка"')}</div><label>Название<input name="name" required maxlength="120" value="${esc(v.name)}"></label><label>Источник<input name="source" maxlength="120" value="${esc(v.source)}"></label><div class="rpg-form-row"><label>Перезарядка<select name="cooldown_type">${types.map((t,i) => `<option value="${t}" ${v.cooldown_type === t ? 'selected' : ''}>${['В ходах','В сутках','До отдыха','Без перезарядки'][i]}</option>`).join('')}</select></label>${num('Длительность',v.cooldown,'name="cooldown"')}</div><label>Описание<textarea name="description" rows="5">${esc(v.description)}</textarea></label><div class="rpg-form-buttons">${button('Отмена','closeForm')}<button type="submit">Сохранить навык</button></div></form>`;
      shell.append(overlay);
      const form = overlay.querySelector('form');
      const update = () => { form.elements.cooldown.disabled = !['turns','days'].includes(form.elements.cooldown_type.value); };
      form.elements.cooldown_type.addEventListener('change', update); update();
      form.addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); if (!values.name.trim()) return; const id = formId || crypto.randomUUID(); formId = null; change({type:'skill', skill:{...values, name:values.name.trim(), id}}); });
      form.elements.name.focus({preventScroll:true});
    }
    function change(a) {
      if (a.type === 'undo' && undoLinked?.()) { render(); return; }
      const before = a.type === 'undo' ? null : beforeAction?.(a);
      if (dispatch(state, a)) onChange(a, before);
      render();
    }
    shell.addEventListener('click', e => {
      const b = e.target.closest('button[data-action]'); if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.action === 'editor') { editing = !editing; render(); }
      else if (d.action === 'size') { size = d.value; render(); }
      else if (d.action === 'editSkill' || d.action === 'addSkill') { formId = d.id || ''; render(); }
      else if (d.action === 'closeForm') { formId = null; render(); }
      else change({type:d.action, id:d.id, value:d.value, key:d.key, operation:d.operation});
    });
    shell.addEventListener('change', e => {
      const a = e.target.classList.contains('rpg-character-name') ? {type:'name', value:e.target.value} : e.target.dataset.resource ? {type:'resource', key:e.target.dataset.resource, value:e.target.value} : e.target.dataset.potion ? {type:'potion', key:e.target.dataset.potion, operation:'stock', value:e.target.value} : null;
      if (!a) return;
      const before = beforeAction?.(a);
      if (dispatch(state, a)) onChange(a, before);
      // Keep controls mounted on blur so the click following a stock edit is not lost.
      shell.querySelectorAll('[data-resource]').forEach(input => input.value = state.resources[input.dataset.resource]);
      shell.querySelectorAll('[data-potion]').forEach(input => input.value = state.potions[input.dataset.potion].stock);
      shell.querySelectorAll('[data-action=spend]').forEach(b => b.disabled = b.dataset.key === 'madness' ? state.resources.rage < 2 : !state.resources[b.dataset.key]);
      shell.querySelectorAll('[data-action=potion]').forEach(b => { const p = state.potions[b.dataset.key], op = b.dataset.operation; b.disabled = (op !== 'receive' && !p.stock) || (op !== 'give' && p.drunk >= caps[size]); });
      const undo = shell.querySelector('[data-action=undo]'); if (undo) undo.disabled = !state.history.length && !canUndoLinked?.();
    });
    shell.addEventListener('keydown', e => { if (e.key === 'Escape' && formId !== null) { e.stopPropagation(); formId = null; render(); } });
    render();
    return render;
  }
  const api = { normalize, dispatch, mount };
  if (typeof module !== 'undefined') module.exports = api; else globalThis.RpgTracker = api;
})();
