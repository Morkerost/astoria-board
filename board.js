(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("canvas");
  const world = $("world");
  const palette = $("palette");
  const saved = $("saved");
  const textToolbar = $("text-toolbar");
  const walletToolbar = $("wallet-toolbar");
  const textSelection = $("text-selection");
  const textOutline = $("text-outline");
  const textFonts = Array.from($("text-font").options, option => option.value);
  const defaultTextWidth = 300;
  const defaultTextSize = 28;
  const minTextWidth = 48;
  const isText = item => item?.type === "text";
  const isWallet = item => item?.type === "wallet";
  const isImage = item => item?.type === "image";
  const isRpg = item => item?.type === "rpg";
  const isCounter = item => item?.type === "counter";
  const isFlipCard = item => item?.type === "flipcard";
  const isShape = item => item?.type === "shape";
  let shapeKind = "rect";
  const isRecordTable = item => item?.type === "record-table";
  const isTable = item => item?.type === "table" || isRecordTable(item);
  const tableHeaderHeight = note => isRecordTable(note) ? 34 : 0;
  const isEquipmentFrame = item => isTable(item) && item.equipmentLayoutVersion === 2;
  const minTableColumn = 80;
  const minTableRow = 48;
  const isSticky = item => item && !isText(item) && !isScalable(item);
  const cardText = note => isSticky(note) && note.flipped ? note.back?.text || "" : note.text;
  const cardColor = note => isSticky(note) && note.flipped ? note.back?.color || note.color : note.color;
  const isScalable = item => isWallet(item) || isImage(item) || isRpg(item) || isCounter(item) || isFlipCard(item) || isTable(item) || isShape(item);
  const walletWidth = 440;
  const walletHeight = 640;
  const coinLabel = code => ({ P: "П", G: "З", S: "С", C: "М" })[code];
  const walletCurrencies = [
    { code: "P", name: "Платина", label: "ПЛАТИНА", color: "platinum" },
    { code: "G", name: "Золото", label: "ЗОЛОТО", color: "gold" },
    { code: "S", name: "Серебро", label: "СЕРЕБРО", color: "silver" },
    { code: "C", name: "Медь", label: "МЕДЬ", color: "copper" }
  ];
  const defaultWalletRates = {
    buy: { P: 100, G: 100, S: 50 },
    sell: { P: 80, G: 90, S: 40 }
  };
  const storageKey = "listok.board.v1";
  const papers = {
    yellow: ["#fff7a6", "Жёлтый"],
    lilac: ["#d8c6ec", "Сиреневый"],
    mint: ["#c6dfbc", "Мятный"],
    peach: ["#f1c4a5", "Персиковый"],
    blue: ["#bfd9e9", "Голубой"],
    pink: ["#edc4d0", "Розовый"]
  };

  const defaultSize = 200;
  const minSize = 64;
  const minZoom = 0.01;
  const maxZoom = 20;
  const percentFormat = new Intl.NumberFormat("ru-RU", { useGrouping: false, maximumFractionDigits: 0 });
  const starterNotes = new Map([["places", "Собрать карту любимых мест"], ["path", "Набросать первый маршрут по городу"], ["friends", "Спросить друзей про их тайные места"]]);
  const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const layerIcon = direction => {
    const arrow = direction === "down" ? "M17 4v9m-3-3 3 3 3-3" : direction === "up" ? "M17 13V4m-3 3 3-3 3 3" :
      direction === "back" ? "M17 4v9m-3-3 3 3 3-3M13 20h8" : "M17 13V4m-3 3 3-3 3 3M13 2h8";
    return '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3 9h8v8H3zM7 17v4h9v-5"/><path d="' + arrow + '"/></svg>';
  };
  const boardClipboardPrefix = "HUIRO_BOARD_V1\n";
  const limit = (value, min, max) => Math.min(max, Math.max(min, value));
  const noteElements = new Map();
  const counterRefresh = new Map();
  const rpgRefresh = new Map();
  let notes = [];
  let camera = { x: 0, y: 0, scale: 1 };
  let selected = null;
  let selection = new Set();
  let editor = null;
  let tool = "select";
  let gesture = null;
  let spaceHeld = false;
  let preferredColor = "yellow";
  let saveTimer;
  let restoringBackup = false;
  const grid = $("grid");
  const zoomInput = $("zoom");
  let viewport = canvas.getBoundingClientRect();
  let frameId = null;
  let pendingMove = null;
  let contextPoint = null;
  let copiedItems = null;
  let copiedBounds = null;
  let lastPointerWorld = null;
  const undoStack = [];
  let lastSavedSnapshot = null;
  let lastStoredValue = null;
  let remoteUpdatePending = false;
  let imageCropSession = null;
  try { lastStoredValue = localStorage.getItem(storageKey); } catch { /* Saving will report unavailable storage. */ }
  let cameraDirty = false;
  let paintedScale = 0;
  let gridStep = 20;
  let gridScale = 1;
  let paletteMetrics = null;
  let zoomEdited = false;

  function fit(initial = false) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const note of notes) {
      if (isScalable(note)) {
        left = Math.min(left, note.x - 10);
        top = Math.min(top, note.y - 10);
        right = Math.max(right, note.x + note.width * note.scale + 10);
        bottom = Math.max(bottom, note.y + note.height * note.scale + 10);
        continue;
      }
      if (isText(note)) {
        left = Math.min(left, note.x);
        top = Math.min(top, note.y);
        right = Math.max(right, note.x + note.width);
        bottom = Math.max(bottom, note.y + noteElements.get(note.id).offsetHeight);
        continue;
      }
      const angle = note.tilt * Math.PI / 180;
      const overhang = note.size * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) - 1) / 2;
      left = Math.min(left, note.x - overhang - 9);
      top = Math.min(top, note.y - overhang - 14);
      right = Math.max(right, note.x + note.size + overhang + 10);
      bottom = Math.max(bottom, note.y + note.size + overhang + 10);
    }
    if (!notes.length) { left = top = 0; right = bottom = 200; }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const marginLeft = width < 720 ? 60 : 95;
    const freeWidth = Math.max(100, width - marginLeft - 30);
    const freeHeight = Math.max(100, height - 95);
    let scale = limit(Math.min(freeWidth / (right-left), freeHeight / (bottom-top)), minZoom, 1);
    if (initial && width < 600) scale = Math.max(.8, scale);
    camera = {
      scale,
      x: marginLeft + Math.max(0, (freeWidth - (right-left) * scale) / 2) - left * scale,
      y: 30 + (freeHeight - (bottom-top) * scale) / 2 - top * scale
    };
    if (initial) {
      // Leave breathing room to the left of the opening row on wide screens.
      const spareWidth = Math.max(0, freeWidth - (right - left) * scale);
      camera.x += Math.min(width * .12, spareWidth / 2);
      camera.y = height / 2 - (top + bottom) * scale / 2;
    }
    drawCamera();
  }

  function validWalletTransaction(tx) {
    return tx && typeof tx.id === "string" && ["income", "expense"].includes(tx.type) &&
      (tx.amounts ? walletCurrencies.every(c => Number.isFinite(tx.amounts[c.code]) && tx.amounts[c.code] >= 0) && Object.values(tx.amounts).some(v => v > 0) : Number.isFinite(tx.amount) && tx.amount > 0 && walletCurrencies.some(currency => currency.code === tx.currency)) &&
      typeof tx.description === "string" && Number.isFinite(tx.at);
  }
  function normalizeWallet(note) {
    const rates = { buy: { ...defaultWalletRates.buy }, sell: { ...defaultWalletRates.sell } };
    for (const side of ["buy", "sell"]) {
      for (const currency of ["P", "G", "S"]) {
        const value = note.rates?.[side]?.[currency];
        if (Number.isFinite(value) && value > 0) rates[side][currency] = value;
      }
    }
    return {
      ...note,
      scale: Number.isFinite(note.scale) ? limit(note.scale, .35, 3) : 1,
      palette: ["forest", "ocean", "plum"].includes(note.palette) ? note.palette : "forest",
      color: /^#[0-9a-f]{6}$/i.test(note.color) ? note.color : ({ ocean: "#285f99", plum: "#754c80" }[note.palette] || "#285c50"),
      title: typeof note.title === "string" ? note.title.slice(0, 48) : "Кошелёк",
      width: Number.isFinite(note.width) ? limit(note.width, 360, 760) : walletWidth,
      height: Number.isFinite(note.height) ? limit(note.height, 420, 900) : walletHeight,
      rates,
      autoConvert: note.autoConvert !== false,
      transactions: Array.isArray(note.transactions) ? note.transactions.filter(validWalletTransaction) : []
    };
  }
  function normalizeTable(note) {
    const columns = Array.isArray(note.table?.columns) && note.table.columns.length ? note.table.columns.slice(0, 50).map(v => limit(Number(v) || 160, minTableColumn, 100000)) : [160, 160, 160];
    const rows = Array.isArray(note.table?.rows) && note.table.rows.length ? note.table.rows.slice(0, 50).map(v => limit(Number(v) || 60, minTableRow, 100000)) : [60, 60, 60];
    const cells = rows.map((_, r) => columns.map((_, c) => String(note.table?.cells?.[r]?.[c] ?? "")));
    const headers=columns.map((_,c)=>String(note.table?.headers?.[c]||`Столбец ${c+1}`));
    const types=columns.map((_,c)=>["text","dropdown","date","image"].includes(note.table?.types?.[c])?note.table.types[c]:"text");
    const options=columns.map((_,c)=>Array.isArray(note.table?.options?.[c])?note.table.options[c].map(String):[]);
    const images=rows.map((_,r)=>columns.map((_,c)=>typeof note.table?.images?.[r]?.[c]==="string"?note.table.images[r][c]:null));
    return { ...note, width: columns.reduce((a,b) => a+b, 0), height: rows.reduce((a,b) => a+b, 0) + tableHeaderHeight(note), scale: Number.isFinite(note.scale) ? limit(note.scale, .05, 20) : 1,
      table: { columns, rows, cells, headers, types, options, images, imageStyles: note.table?.imageStyles || {}, borderColor: /^#[0-9a-f]{6}$/i.test(note.table?.borderColor) ? note.table.borderColor : "#b7bec6", borderWidth: limit(Number(note.table?.borderWidth) || 1, .5, 12) } };
  }
  function imageMask(note) {
    const raw = note.mask || {}, crop = raw.crop || {};
    const w = limit(Number(crop.w) || 1, .05, 1), h = limit(Number(crop.h) || 1, .05, 1);
    return { shape:["original","circle","square","portrait","landscape","wide","custom"].includes(raw.shape) ? raw.shape : "original",
      crop:{ x:limit(Number(crop.x) || 0, 0, 1-w), y:limit(Number(crop.y) || 0, 0, 1-h), w, h } };
  }
  function imageStroke(note) {
    const raw = note.stroke || {};
    return { color:/^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : "#ffcc33", width:limit(Number(raw.width) || 0, 0, 30),
      radius:limit(Number(raw.radius) || 0, 0, 200), opacity:limit(Number(raw.opacity) || 1, .05, 1),
      style:["solid","dashed","dotted"].includes(raw.style) ? raw.style : "solid" };
  }
  function imageSourceSize(note) {
    return { width:Number.isFinite(note.imageSourceWidth) && note.imageSourceWidth > 0 ? note.imageSourceWidth : note.width,
      height:Number.isFinite(note.imageSourceHeight) && note.imageSourceHeight > 0 ? note.imageSourceHeight : note.height };
  }
  function validNote(note) {
    if (!note || typeof note.id !== "string" || ![note.x, note.y, note.tilt].every(Number.isFinite)) return false;
    if (isShape(note)) return [note.width,note.height,note.scale].every(v => Number.isFinite(v) && v > 0);
    if (isImage(note)) return typeof note.assetId === "string" && Number.isFinite(note.width) && note.width > 0 && Number.isFinite(note.height) && note.height > 0;
    if (isRpg(note)) return !!note.tracker;
    if (isCounter(note)) return !!note.counter;
    if (isTable(note)) return !!note.table && Array.isArray(note.table.columns) && Array.isArray(note.table.rows) && Array.isArray(note.table.cells);
    if (isFlipCard(note)) return Number.isFinite(note.width) && Number.isFinite(note.height) && note.front && note.back;
    if (isWallet(note)) return Number.isFinite(note.width) && Number.isFinite(note.height);
    return typeof note.text === "string" &&
      (isText(note) ? Number.isFinite(note.width) && note.width >= minTextWidth : Object.hasOwn(papers, note.color));
  }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey));
      if (!data || data.version !== 1 || !Array.isArray(data.notes) || !data.notes.every(validNote)) return false;
      if (new Set(data.notes.map(n => n.id)).size !== data.notes.length) return false;
      notes = data.notes.filter(note => !starterNotes.has(note.id) || starterNotes.get(note.id) !== note.text).map(note => {
        if (isShape(note)) return normalizeShape(note);
        if (isImage(note)) return { ...note, scale: Number.isFinite(note.scale) ? limit(note.scale, .05, 10) : 1, mask:imageMask(note), stroke:imageStroke(note) };
        if (isRpg(note)) return { ...note, width: 1080, height: 860, scale: Number.isFinite(note.scale) ? limit(note.scale, .35, 3) : 1, tracker: RpgTracker.normalize(note.tracker) };
        if (isCounter(note)) return { ...note, width: 520, height: Number.isFinite(note.height) && note.height > 0 ? note.height : 600, scale: Number.isFinite(note.scale) ? limit(note.scale, .35, 3) : 1, counter: CounterWidget.normalize(note.counter) };
        if (isTable(note)) return normalizeTable(note);
        if (isFlipCard(note)) return { ...note, scale: Number.isFinite(note.scale) ? limit(note.scale, .35, 3) : 1, front: normalizeCardFace(note.front), back: normalizeCardFace(note.back), flipped: !!note.flipped };
        if (isWallet(note)) return normalizeWallet(note);
        if (!isText(note)) {
          if (note.back) return {id:note.id,type:"flipcard",x:note.x,y:note.y,width:240,height:350,scale:1,tilt:0,locked:note.locked,groupId:note.groupId,flipped:!!note.flipped,
            front:normalizeCardFace({text:note.text,color:note.color}),back:normalizeCardFace(note.back)};
          return { ...note, size: Number.isFinite(note.size) ? Math.max(minSize, note.size) : defaultSize,flipped:false };
        }
        return {
          ...note, tilt: 0,
          height: Number.isFinite(note.height) ? Math.max(0, note.height) : 0,
          fontSize: Number.isFinite(note.fontSize) ? Math.max(1, note.fontSize) : defaultTextSize,
          font: textFonts.includes(note.font) ? note.font : textFonts[0],
          ink: /^#[0-9a-f]{6}$/i.test(note.ink) ? note.ink : "#1c1c1c",
          align: ["left", "center", "right"].includes(note.align) ? note.align : "left"
        };
      });
      // Move the legacy right-hand tracker panel into its own linked counter block.
      for (const character of notes.filter(isRpg)) {
        const pots = Object.values(character.tracker.potions || {});
        const resources = character.tracker.resources || {};
        const hasLegacy = !!(character.tracker.potions || character.tracker.resources);
        if (!hasLegacy || notes.some(n => isCounter(n) && n.counter.linkId === character.id)) continue;
        const counter = CounterWidget.create("custom", character.id); counter.title = "Зелья и ресурсы";
        for (const [key,p] of Object.entries(character.tracker.potions || {})) counter.items.push({id:crypto.randomUUID(),name:key.replaceAll("-"," ") + (p.drunk ? ` · выпито ${p.drunk}` : ""),value:p.stock,max:10});
        for (const [name,value,max] of [["Постоянный адреналин",resources.adrenaline,resources.adrenalineTotal],["Временный адреналин",resources.temporary,0],["Ярость",resources.rage,resources.rageTotal]]) if (value || max) counter.items.push({id:crypto.randomUUID(),name,value,max});
        notes.push({id:crypto.randomUUID(),type:"counter",x:character.x+character.width*character.scale+35,y:character.y,width:520,height:600,scale:.7,tilt:0,counter});
      }
      if (Object.hasOwn(papers, data.preferredColor)) preferredColor = data.preferredColor;
      const c = data.camera;
      if (c && [c.x, c.y, c.scale].every(Number.isFinite) && c.scale >= minZoom && c.scale <= maxZoom &&
          Math.abs(data.width - canvas.clientWidth) < 100 && Math.abs(data.height - canvas.clientHeight) < 120) {
        camera = c;
        return true;
      }
    } catch { /* A restricted browser can still use the board in memory. */ }
    return false;
  }
  function save() {
    if (restoringBackup) return;
    clearTimeout(saveTimer);
    try {
      if (syncFromOtherWindow()) return;
      const data = { version: 1, notes:storedNotes(), camera, preferredColor, width: canvas.clientWidth, height: canvas.clientHeight };
      const serialized = JSON.stringify(data);
      if (lastSavedSnapshot && lastSavedSnapshot !== serialized) {
        undoStack.push(lastSavedSnapshot);
        if (undoStack.length > 50) undoStack.shift();
      }
      localStorage.setItem(storageKey, serialized);
      lastStoredValue = serialized;
      lastSavedSnapshot = serialized;
      window.dispatchEvent(new Event("listok:saved"));
      saved.classList.remove("unsaved");
      saved.lastElementChild.textContent = "Сохранено локально";
    } catch {
      saved.classList.add("unsaved");
      saved.lastElementChild.textContent = "Сохранение недоступно";
    }
    saved.title = saved.lastElementChild.textContent;
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 160);
  }
  function storedNotes() {
    return imageCropSession ? notes.map(note => note === imageCropSession.note ? {...note,...imageCropSession.old} : note) : notes;
  }
  function refreshFromOtherWindow(current) {
    clearTimeout(saveTimer);
    finishEdit();
    closeContextMenu();
    setTool("select");
    selected = null;
    selection.clear();
    for (const element of noteElements.values()) element.remove();
    noteElements.clear(); counterRefresh.clear(); rpgRefresh.clear();
    notes = [];
    const hasCamera = restore();
    notes.forEach(addElement);
    viewport = canvas.getBoundingClientRect();
    if (hasCamera) drawCamera(); else fit(true);
    if (notes.length) selectNote(notes[0]);
    lastStoredValue = current;
    lastSavedSnapshot = current;
    remoteUpdatePending = false;
    saved.classList.remove("unsaved");
    saved.lastElementChild.textContent = "Изменения загружены";
    saved.title = saved.lastElementChild.textContent;
  }
  function syncFromOtherWindow() {
    if (restoringBackup) return false;
    let current;
    try { current = localStorage.getItem(storageKey); } catch { return false; }
    if (current === lastStoredValue) { remoteUpdatePending = false; return false; }
    remoteUpdatePending = true;
    const editing = !!editor || !!imageCropSession || (document.hasFocus() && document.activeElement?.matches("textarea,input,select,[contenteditable=true]"));
    if (editing || gesture) {
      saved.classList.add("unsaved");
      saved.lastElementChild.textContent = "Обновление из другого окна ожидает";
      return true;
    }
    refreshFromOtherWindow(current);
    return true;
  }
  window.addEventListener("storage", event => {
    if (event.key === storageKey) syncFromOtherWindow();
  });
  window.addEventListener("focus", () => { if (remoteUpdatePending || document.visibilityState === "visible") syncFromOtherWindow(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncFromOtherWindow(); });
  document.addEventListener("focusout", () => { if (remoteUpdatePending) queueMicrotask(syncFromOtherWindow); });
  function localPoint(x, y) {
    return { x: (x - viewport.left - camera.x) / camera.scale, y: (y - viewport.top - camera.y) / camera.scale };
  }
  function translate(x, y) {
    return `translate3d(${x}px, ${y}px, 0)`;
  }
  function moveNote(note, el) {
    el.style.transform = translate(note.x, note.y) + (isScalable(note) ? " scale(" + note.scale + ")" : " rotate(var(--tilt, 0deg))");
    if (isScalable(note)) el.style.setProperty("--wallet-inverse", 1 / note.scale);
  }
  function drawTextSelection() {
    drawGroupSelection();
    if (selection.size > 1) { textSelection.hidden = true; return; }
    if (!selected || (!isText(selected) && !isScalable(selected))) {
      textSelection.hidden = true;
      return;
    }
    const bounds = noteElements.get(selected.id).getBoundingClientRect();
    textSelection.hidden = false;
    textSelection.classList.toggle("editing", isText(selected) && !!editor && editor.note === selected);
    textSelection.style.transform = translate(bounds.left - viewport.left, bounds.top - viewport.top);
    textSelection.style.width = bounds.width + "px";
    textSelection.style.height = bounds.height + "px";
  }
  function positionNote(note, el) {
    el.style.setProperty("--item-scale", isScalable(note) ? note.scale : 1);
    if (isText(note)) {
      el.style.setProperty("--text-width", note.width + "px");
      el.style.setProperty("--text-height", note.height + "px");
    } else if (isScalable(note)) {
      el.style.setProperty("--wallet-width", note.width + "px");
      el.style.setProperty("--wallet-height", note.height + "px");
    } else {
      el.style.setProperty("--size", note.size + "px");
    }
    moveNote(note, el);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function walletBalances(wallet) {
    const balances = { P: 0, G: 0, S: 0, C: 0 };
    for (const transaction of wallet.transactions) {
      for (const currency of walletCurrencies) {
        const amount = transaction.amounts ? transaction.amounts[currency.code] : transaction.currency === currency.code ? transaction.amount : 0;
        balances[currency.code] += (transaction.type === "income" ? 1 : -1) * amount;
      }
    }
    if (wallet.autoConvert) {
      const convert = (from, to, rate) => {
        if (balances[to] >= 0) return;
        const coins = Math.ceil(-balances[to] / rate - 1e-9);
        balances[from] -= coins;
        balances[to] += coins * rate;
      };
      convert("S", "C", wallet.rates.sell.S);
      convert("G", "S", wallet.rates.sell.G);
      convert("P", "G", wallet.rates.sell.P);
    }
    return balances;
  }
  function formatWalletAmount(amount) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount);
  }
  function walletCopperTotal(wallet, balances) {
    const rates = wallet.rates.sell;
    return balances.P * rates.P * rates.G * rates.S + balances.G * rates.G * rates.S + balances.S * rates.S + balances.C;
  }
  function updateWalletView(wallet, el) {
    const balances = walletBalances(wallet);
    const rates = wallet.rates;
    el.style.setProperty("--wallet-color", wallet.color);
    el.querySelector(".wallet-title").textContent = wallet.title;
    el.querySelector(".wallet-copper-total").textContent = formatWalletAmount(walletCopperTotal(wallet, balances)) + " м.";
    el.querySelector(".wallet-auto-input").checked = wallet.autoConvert;
    el.querySelector(".wallet-coins").innerHTML = walletCurrencies.map(currency => `
      <div class="wallet-coin ${currency.color}">
        <span class="wallet-coin-mark">${coinLabel(currency.code)}</span>
        <span class="wallet-coin-name">${currency.label}</span>
        <strong>${formatWalletAmount(balances[currency.code])}</strong>
      </div>`).join("");
    for (const side of ["buy", "sell"]) {
      for (const currency of ["P", "G", "S"]) {
        const input = el.querySelector(`[data-wallet-rate="${side}.${currency}"]`);
        if (input && input !== document.activeElement) input.value = rates[side][currency];
      }
    }
    const list = el.querySelector(".wallet-transactions");
    const transactions = wallet.transactions;
    list.innerHTML = transactions.length ? transactions.map(transaction => {
      const amounts = transaction.amounts || { [transaction.currency]: transaction.amount };
      const date = new Date(transaction.at).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      const sign = transaction.type === "income" ? "+" : "−";
      const description = transaction.description || (transaction.type === "income" ? "Пополнение" : "Расход");
      return `<article class="wallet-transaction ${transaction.type}">
        <div class="wallet-transaction-copy"><strong>${escapeHtml(description)}</strong><span>${date} · ${transaction.type === "income" ? "Приход" : "Расход"}</span></div>
        <b>${walletCurrencies.filter(c => amounts[c.code] > 0).map(c => sign + formatWalletAmount(amounts[c.code]) + " " + coinLabel(c.code)).join(" · ")}</b>
        <button type="button" data-delete-transaction="${escapeHtml(transaction.id)}" aria-label="Удалить операцию: ${escapeHtml(description)}" title="Удалить операцию">×</button>
      </article>`;
    }).join("") : '<div class="wallet-empty">История пока пуста. Добавьте первую операцию.</div>';
  }
  function buildWallet(note, el) {
    el.innerHTML = `<div class="wallet-shell">
      <header class="wallet-header">
        <div class="wallet-brand"><span class="wallet-brand-mark">✦</span><div><small>УЧЁТ МОНЕТ</small><h2 class="wallet-title"></h2></div></div>
      </header>
      <section class="wallet-summary">
        <div><span>ВСЕГО В МЕДИ</span><strong class="wallet-copper-total">0 м.</strong></div>
        <label class="wallet-auto wallet-interactive"><input class="wallet-auto-input" type="checkbox"><span class="wallet-switch"></span><small>Авторазмен</small></label>
      </section>
      <div class="wallet-coins"></div>
      <details class="wallet-rates wallet-interactive">
        <summary><span>Курсы обмена</span><small>покупка / продажа</small></summary>
        <div class="wallet-rate-head"><span>Обмен</span><span>Покупка</span><span>Продажа</span></div>
        <label class="wallet-rate-row"><span>1 П → З</span><input type="number" min="1" step="1" inputmode="numeric" data-wallet-rate="buy.P" aria-label="Покупка платины"><input type="number" min="1" step="1" inputmode="numeric" data-wallet-rate="sell.P" aria-label="Продажа платины"></label>
        <label class="wallet-rate-row"><span>1 З → С</span><input type="number" min="1" step="1" inputmode="numeric" data-wallet-rate="buy.G" aria-label="Покупка золота"><input type="number" min="1" step="1" inputmode="numeric" data-wallet-rate="sell.G" aria-label="Продажа золота"></label>
        <label class="wallet-rate-row"><span>1 С → М</span><input type="number" min="1" step="1" inputmode="numeric" data-wallet-rate="buy.S" aria-label="Покупка серебра"><input type="number" min="1" step="1" inputmode="numeric" data-wallet-rate="sell.S" aria-label="Продажа серебра"></label>
        <small class="wallet-rate-hint">Авторазмен использует курс продажи.</small>
      </details>
      <form class="wallet-entry wallet-interactive">
        <div class="wallet-entry-label"><span>Новая операция</span><small>доход или расход</small></div>
        <div class="wallet-multi-head"><span></span>${walletCurrencies.map(c => `<span>${coinLabel(c.code)}</span>`).join("")}</div>
        ${["income", "expense"].map(type => `<div class="wallet-multi-row"><span>${type === "income" ? "Приход" : "Расход"}</span>${walletCurrencies.map(c => `<input name="${type}.${c.code}" type="number" min="0" step="1" inputmode="numeric" placeholder="0" aria-label="${type === "income" ? "Приход" : "Расход"}: ${c.name}">`).join("")}</div>`).join("")}
        <div class="wallet-entry-row description-row">
          <input name="description" type="text" maxlength="80" placeholder="Описание операции" aria-label="Описание операции">
          <button type="submit" aria-label="Добавить операцию" title="Добавить операцию">Добавить <span>＋</span></button>
        </div>
      </form>
      <section class="wallet-history wallet-interactive">
        <div class="wallet-history-head"><span>История операций</span><small>все операции</small></div>
        <div class="wallet-transactions"></div>
      </section>
    </div>`;
    const form = el.querySelector(".wallet-entry");
    form.addEventListener("submit", event => {
      event.preventDefault();
      const formData = new FormData(form);
      const entries = ["income", "expense"].map(type => ({
        id: crypto.randomUUID(), at: Date.now(), type,
        amounts: Object.fromEntries(walletCurrencies.map(c => [c.code, Number(formData.get(type + "." + c.code) || 0)])),
        description: String(formData.get("description") || "").trim()
      }));
      if (entries.some(tx => Object.values(tx.amounts).some(v => !Number.isSafeInteger(v) || v < 0))) return;
      const filled = entries.filter(tx => Object.values(tx.amounts).some(v => v > 0));
      if (!filled.length) return;
      note.transactions.unshift(...filled);
      form.reset();
      updateWalletView(note, el);
      save();
    });
    el.addEventListener("change", event => {
      const target = event.target;
      if (target.matches(".wallet-auto-input")) {
        note.autoConvert = target.checked;
      } else if (target.matches("[data-wallet-rate]")) {
        const [side, currency] = target.dataset.walletRate.split(".");
        const amount = Number(target.value);
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          target.value = note.rates[side][currency];
          updateWalletView(note, el);
          return;
        }
        note.rates[side][currency] = amount;
      } else {
        return;
      }
      updateWalletView(note, el);
      save();
    });
    el.addEventListener("click", event => {
      const button = event.target.closest("[data-delete-transaction]");
      if (!button) return;
      note.transactions = note.transactions.filter(transaction => transaction.id !== button.dataset.deleteTransaction);
      updateWalletView(note, el);
      save();
    });
    updateWalletView(note, el);
  }
  function zoomLabel() {
    return percentFormat.format(camera.scale * 100) + "%";
  }
  function drawCamera() {
    world.style.transform = translate(camera.x, camera.y) + " scale(" + camera.scale + ")";
    world.style.setProperty("--camera-scale", camera.scale);
    if (paintedScale !== camera.scale) {
      paintedScale = camera.scale;
      world.style.setProperty("--handle-scale", 1 / camera.scale);
      gridStep = 20 * camera.scale;
      while (gridStep < 11) gridStep *= 2;
      // Scale a whole-pixel tile so fractional zoom never snaps the grid spacing.
      const tile = 20 * 2 ** Math.floor(Math.log2(gridStep / 20));
      gridScale = gridStep / tile;
      grid.style.backgroundSize = tile + "px " + tile + "px";
      const dot = limit(camera.scale, .7, 1.8);
      grid.style.setProperty("--dot", dot / gridScale + "px");
      grid.style.setProperty("--edge", (dot + .28) / gridScale + "px");
      if (!zoomEdited) zoomInput.value = zoomLabel();
      $("minus").disabled = camera.scale <= minZoom;
      $("plus").disabled = camera.scale >= maxZoom;
    }
    // Keep the repeated grid over the viewport while moving it by fractional pixels.
    const phase = offset => ((offset - gridStep / 2) % gridStep + gridStep) % gridStep - gridStep;
    grid.style.transform = translate(phase(camera.x), phase(camera.y)) + " scale(" + gridScale + ")";
    drawTextSelection();
    placePalette(false);
  }
  function drawFrame() {
    frameId = null;
    if (pendingMove) {
      const event = pendingMove;
      pendingMove = null;
      moveGesture(event);
    }
    if (cameraDirty) {
      cameraDirty = false;
      drawCamera();
    }
  }
  function requestDraw() {
    if (frameId === null) frameId = requestAnimationFrame(drawFrame);
  }
  function zoomAt(scale, x, y) {
    const next = limit(scale, minZoom, maxZoom);
    if (next === camera.scale) return;
    const pos = localPoint(x, y);
    camera.x = x - viewport.left - pos.x * next;
    camera.y = y - viewport.top - pos.y * next;
    camera.scale = next;
    cameraDirty = true;
    requestDraw();
    saveSoon();
  }
  function zoomCenter(scale) {
    zoomAt(scale, viewport.left + viewport.width / 2, viewport.top + viewport.height / 2);
  }

  function applyTextFormat(note, el) {
    el.style.setProperty("--text-size", note.fontSize + "px");
    el.style.setProperty("--text-font", '"' + note.font + '", "Segoe UI", sans-serif');
    el.style.setProperty("--text-weight", note.bold ? "700" : "400");
    el.style.setProperty("--text-style", note.italic ? "italic" : "normal");
    el.style.setProperty("--text-decoration", note.underline ? "underline" : "none");
    el.style.setProperty("--text-align", note.align);
    el.style.setProperty("--ink", note.ink);
  }
  function adjustText(note, el) {
    if (isText(note)) {
      // A final newline needs a line box of its own, just as it has in the textarea.
      el.querySelector(".note-content").textContent = note.text + (note.text.endsWith("\n") ? "\u200b" : "");
      el.setAttribute("aria-label", note.text || "Пустая текстовая область");
      return;
    }
    const visibleText = cardText(note);
    const length = visibleText.length;
    const lines = visibleText.split("\n").length;
    el.classList.toggle("compact", length > 75 || lines > 5);
    el.classList.toggle("dense", length > 120 || lines > 7);
    el.classList.toggle("long", length > 170 || lines > 8);
    if (editor?.el === el) {
      const body = el.querySelector(".note-content");
      body.textContent = visibleText + (visibleText.endsWith("\n") ? "\u200b" : "");
      editor.field.style.paddingTop = body.offsetTop + "px";
    }
    el.setAttribute("aria-label", visibleText || "Пустой стикер");
  }
  function renderCard(note, el) {
    if (!isSticky(note)) return;
    el.style.setProperty("--paper", papers[cardColor(note)][0]);
    el.classList.toggle("card-flipped", !!note.flipped);
    el.querySelector(".note-content").textContent = cardText(note);
    el.querySelector(".card-image")?.remove();
    const assetId = note.flipped && note.back?.assetId;
    el.classList.toggle("card-has-image", !!assetId);
    if (assetId) {
      const img = document.createElement("img"); img.className = "card-image"; img.alt = "Картинка на обороте"; img.draggable = false;
      el.insertBefore(img, el.querySelector(".note-content"));
      readImageAsset(assetId).then(blob => {
        if (!blob || !img.isConnected) return;
        const url = URL.createObjectURL(blob);
        img.onload = img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
      }).catch(() => { img.alt = "Картинка недоступна"; });
    }
    adjustText(note, el);
  }
  const cloneState = value => JSON.parse(JSON.stringify(value));
  function characterSnapshot(character, overrideId, overrideCounter) {
    return { tracker: cloneState(character.tracker), counters: Object.fromEntries(notes.filter(n => isCounter(n) && n.counter.linkId === character.id)
      .map(n => [n.id, cloneState(n.id === overrideId ? overrideCounter : n.counter)])) };
  }
  function recordCharacterAction(character, snapshot) {
    if (!snapshot) return;
    character.actionHistory ||= [];
    character.actionHistory.push(snapshot);
    if (character.actionHistory.length > 50) character.actionHistory.shift();
  }
  function undoCharacterAction(character) {
    const previous = character.actionHistory?.pop();
    if (!previous) return false;
    Object.assign(character.tracker, RpgTracker.normalize(previous.tracker));
    for (const [id, saved] of Object.entries(previous.counters || {})) {
      const counter = notes.find(n => n.id === id && isCounter(n));
      if (!counter) continue;
      Object.assign(counter.counter, CounterWidget.normalize(saved));
      counterRefresh.get(id)?.();
    }
    save();
    return true;
  }
  function normalizeCardFace(face = {}) {
    return {title:typeof face.title === "string" ? face.title.slice(0,80) : "",text:typeof face.text === "string" ? face.text.slice(0,5000) : "",
      color:Object.hasOwn(papers,face.color) ? face.color : "yellow",assetId:typeof face.assetId === "string" ? face.assetId : null};
  }
  function layoutFlipText(el) {
    const field = el.querySelector("[data-card-text]");
    const slot = el.querySelector(".flip-text-slot");
    if (!field || !slot) return;
    if (!el.classList.contains("without-image")) { field.style.height = "100%"; return; }
    field.style.height = "1px";
    field.style.height = Math.max(28, field.scrollHeight) + "px";
    slot.style.height = field.style.height;
    const title = el.querySelector("[data-card-title]");
    title.style.marginTop = "0";
    title.style.marginBottom = "0";
  }
  function renderFlipCard(note, el) {
    const face = note.flipped ? note.back : note.front;
    el.classList.toggle("without-image", !face.assetId);
    el.classList.toggle("has-image", !!face.assetId);
    el.classList.toggle("landscape", note.width > note.height);
    el.style.setProperty("--card-color", papers[face.color][0]);
    el.querySelector("[data-card-title]").value = face.title;
    el.querySelector("[data-card-text]").value = face.text;
    layoutFlipText(el);
    el.querySelector(".flip-side-label").textContent = note.flipped ? "Оборот" : "Лицевая сторона";
    const image = el.querySelector(".flip-card-image");
    image.hidden = !face.assetId;
    image.removeAttribute("src");
    if (face.assetId) readImageAsset(face.assetId).then(blob => {
      if (!blob || !image.isConnected || (note.flipped ? note.back : note.front) !== face) return;
      const url = URL.createObjectURL(blob);
      image.onload = image.onerror = () => URL.revokeObjectURL(url);
      image.src = url;
    }).catch(() => { image.hidden = true; });
    if (selected?.id === note.id) syncFlipControls(note);
  }
  function flipCard(note, el) {
    if (el.dataset.flipping) return;
    const shell = el.querySelector(".flip-shell");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !shell.animate) {
      note.flipped = !note.flipped; renderFlipCard(note,el); save(); return;
    }
    el.dataset.flipping = "true";
    const first = shell.animate([{transform:"perspective(700px) rotateY(0deg)"},{transform:"perspective(700px) rotateY(90deg)"}],{duration:180,easing:"ease-in",fill:"forwards"});
    first.onfinish = () => {
      shell.style.transform = "perspective(700px) rotateY(-90deg)";
      first.cancel();
      note.flipped = !note.flipped; renderFlipCard(note,el);
      const second = shell.animate([{transform:"perspective(700px) rotateY(-90deg)"},{transform:"perspective(700px) rotateY(0deg)"}],{duration:200,easing:"ease-out",fill:"forwards"});
      second.onfinish = () => { second.cancel(); shell.style.transform = ""; delete el.dataset.flipping; save(); };
    };
  }
  function buildFlipCard(note, el) {
    const shell = document.createElement("div"); shell.className = "flip-shell";
    shell.innerHTML = '<small class="flip-side-label"></small><input data-card-title placeholder="Добавьте заголовок" maxlength="80" aria-label="Заголовок стороны"><div class="flip-image-slot"><img class="flip-card-image" alt="Картинка на карточке" draggable="false" hidden><span>Перетащите картинку сюда</span></div><textarea data-card-text placeholder="Напишите текст" maxlength="5000" aria-label="Текст стороны"></textarea><button type="button" data-card-flip>↻ Перевернуть</button>';
    el.append(shell);
    const textSlot = document.createElement("div");
    textSlot.className = "flip-text-slot";
    const textField = shell.querySelector("[data-card-text]");
    textField.before(textSlot); textSlot.append(textField);
    const textObserver = new ResizeObserver(() => {
      if (!el.isConnected) { textObserver.disconnect(); return; }
      layoutFlipText(el);
    });
    textObserver.observe(textSlot);
    shell.addEventListener("pointerdown", event => {
      if (!event.target.closest("input,textarea,button")) return;
      if (!event.target.closest("[data-card-flip]") && !selection.has(note.id)) selectNote(note);
      event.stopPropagation();
    });
    shell.addEventListener("input", event => {
      const face = note.flipped ? note.back : note.front;
      if (event.target.matches("[data-card-title]")) face.title = event.target.value;
      if (event.target.matches("[data-card-text]")) face.text = event.target.value;
      layoutFlipText(el);
      saveSoon();
    });
    shell.querySelector(".flip-card-image").addEventListener("dragstart", event => event.preventDefault());
    const imageSlot = shell.querySelector(".flip-image-slot");
    imageSlot.addEventListener("pointerdown", event => {
      const face = note.flipped ? note.back : note.front;
      if (event.button !== 0 || !face.assetId) return;
      const picture = imageSlot.querySelector("img");
      if (!picture.naturalWidth || !picture.naturalHeight) return;
      event.preventDefault(); event.stopPropagation();
      imageSlot.setPointerCapture(event.pointerId);
      const startX = event.clientX, startY = event.clientY;
      let ghost = null;
      const move = e => {
        if (e.pointerId !== event.pointerId || Math.hypot(e.clientX - startX, e.clientY - startY) < 6 && !ghost) return;
        if (!ghost) {
          const preview = document.createElement("canvas"); preview.width = 120; preview.height = 140;
          const fit = Math.min(preview.width / picture.naturalWidth, preview.height / picture.naturalHeight);
          const width = picture.naturalWidth * fit, height = picture.naturalHeight * fit;
          preview.getContext("2d").drawImage(picture, (preview.width - width) / 2, (preview.height - height) / 2, width, height);
          ghost = document.createElement("img"); ghost.src = preview.toDataURL("image/png");
          Object.assign(ghost.style, { position: "fixed", width: "120px", height: "140px", pointerEvents: "none", zIndex: "99999", opacity: ".85" });
          document.body.append(ghost);
        }
        ghost.style.left = e.clientX - 60 + "px"; ghost.style.top = e.clientY - 70 + "px";
      };
      const end = e => {
        if (e.pointerId !== event.pointerId) return;
        imageSlot.removeEventListener("pointermove", move);
        imageSlot.removeEventListener("pointerup", end);
        imageSlot.removeEventListener("pointercancel", end);
        ghost?.remove();
        if (e.type !== "pointerup" || !ghost || document.elementFromPoint(e.clientX, e.clientY)?.closest(".flip-card") === el) return;
        const width = picture.naturalWidth || 240, height = picture.naturalHeight || 320;
        const factor = Math.min(1, 480 / width, 420 / height), point = localPoint(e.clientX, e.clientY);
        const extracted = { id: crypto.randomUUID(), type: "image", assetId: face.assetId, name: face.title || "Изображение", width: width * factor, height: height * factor, scale: 1, tilt: 0, x: point.x - width * factor / 2, y: point.y - height * factor / 2 };
        face.assetId = null; notes.push(extracted); addElement(extracted); renderFlipCard(note, el); selectNote(extracted); save();
      };
      imageSlot.addEventListener("pointermove", move);
      imageSlot.addEventListener("pointerup", end);
      imageSlot.addEventListener("pointercancel", end);
    });
    shell.querySelector("[data-card-flip]").onclick = () => flipCard(note,el);
    renderFlipCard(note,el);
  }
  function layoutTable(note, el) {
    const grid = el.querySelector(".table-grid");
    grid.style.gridTemplateColumns = note.table.columns.map(n => n + "px").join(" ");
    grid.style.gridTemplateRows = `${isRecordTable(note) ? "34px " : ""}${note.table.rows.map(n => n + "px").join(" ")}`;
    let offset = 0;
    el.querySelectorAll('.table-divider[data-axis="col"]').forEach((handle, index) => { offset += note.table.columns[index]; handle.style.left = offset + "px"; });
    offset = tableHeaderHeight(note);
    el.querySelectorAll('.table-divider[data-axis="row"]').forEach((handle, index) => { offset += note.table.rows[index]; handle.style.top = offset + "px"; });
    offset = 0;
    el.querySelectorAll('.table-add[data-axis="col"]').forEach((button, index) => { if (index) offset += note.table.columns[index-1]; button.style.left = offset + "px"; });
    offset = tableHeaderHeight(note);
    el.querySelectorAll('.table-add[data-axis="row"]').forEach((button, index) => { if (index) offset += note.table.rows[index-1]; button.style.top = offset + "px"; });
    offset = tableHeaderHeight(note);
    el.querySelectorAll(".table-row-grip").forEach((button,index)=>{button.style.top=offset+note.table.rows[index]/2+"px";offset+=note.table.rows[index];});
    note.width = note.table.columns.reduce((a,b) => a+b, 0);
    note.height = note.table.rows.reduce((a,b) => a+b, 0) + tableHeaderHeight(note);
    positionNote(note, el);
    fitRecordPictures(el);
    if (selection.has(note.id)) { drawTextSelection(); placePalette(); }
  }
  function tableCellsFit(note, grid) {
    return [...grid.querySelectorAll(".table-cell")].every(cell => !note.table.cells[Number(cell.dataset.row)][Number(cell.dataset.col)] || cell.scrollHeight <= cell.clientHeight + 1);
  }
  function moveTableAxis(note, axis, from, to) {
    if (from === to || !Number.isInteger(from) || !Number.isInteger(to)) return;
    const t=note.table, move=array=>{const [item]=array.splice(from,1);array.splice(to,0,item);};
    if(axis==="row"){move(t.rows);move(t.cells);move(t.images);if(Number.isInteger(t.activeRow))t.activeRow=t.activeRow===from?to:t.activeRow>from&&t.activeRow<=to?t.activeRow-1:t.activeRow<from&&t.activeRow>=to?t.activeRow+1:t.activeRow;}
    else {move(t.columns);move(t.headers);move(t.types);move(t.options);t.cells.forEach(move);t.images.forEach(move);if(Number.isInteger(t.activeCol))t.activeCol=t.activeCol===from?to:t.activeCol>from&&t.activeCol<=to?t.activeCol-1:t.activeCol<from&&t.activeCol>=to?t.activeCol+1:t.activeCol;}
    renderTable(note,noteElements.get(note.id));save();
  }
  function tableDropIndex(items,coordinate,axis,from){let insert=items.length;for(let i=0;i<items.length;i++){const rect=items[i].getBoundingClientRect(),mid=axis==="row"?rect.top+rect.height/2:rect.left+rect.width/2;if(coordinate<mid){insert=i;break;}}if(insert>from)insert--;return limit(insert,0,items.length-1);}
  function resizeTableEdge(g, dx, dy) {
    const note = g.note, el = noteElements.get(note.id), horizontal = g.corner === "w" || g.corner === "e";
    const source = horizontal ? g.tableColumns : g.tableRows;
    const target = horizontal ? note.table.columns : note.table.rows;
    const min = horizontal ? minTableColumn : minTableRow;
    const signed = (horizontal ? dx : dy) / (camera.scale * note.scale) * (g.corner === "w" || g.corner === "n" ? -1 : 1);
    const lower = Math.max(...source.map(v => (min - v) * source.length));
    const upper = Math.min(...source.map(v => (100000 - v) * source.length));
    const delta = limit(signed, lower, upper);
    const grid = el.querySelector(".table-grid");
    const fits = amount => {
      source.forEach((value, index) => { target[index] = value + amount / source.length; });
      grid.style[horizontal ? "gridTemplateColumns" : "gridTemplateRows"] = horizontal ? target.map(v => v + "px").join(" ") : `${isRecordTable(note) ? "34px " : ""}${target.map(v => v + "px").join(" ")}`;
      return tableCellsFit(note, grid);
    };
    let accepted = delta;
    if (delta < 0 && !fits(delta)) {
      let lo = delta, hi = 0;
      for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      accepted = hi;
    }
    source.forEach((value, index) => { target[index] = value + accepted / source.length; });
    if (horizontal && g.corner === "w") note.x = g.x + g.tableColumns.reduce((a,b)=>a+b,0) * note.scale - target.reduce((a,b)=>a+b,0) * note.scale;
    if (!horizontal && g.corner === "n") note.y = g.y + g.tableRows.reduce((a,b)=>a+b,0) * note.scale - target.reduce((a,b)=>a+b,0) * note.scale;
    layoutTable(note, el);
  }

  let recordPopupClose = null;
  const recordTypes = {text:["≡","Текст"],dropdown:["⊙","Выпадающий список"],image:["▧","Картинка"],date:["▦","Дата"]};
  function recordPopup(anchor) {
    recordPopupClose?.();
    const popup=document.createElement("div");popup.className="record-popup";popup.setAttribute("role","dialog");document.body.append(popup);
    const rect=anchor.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-308))+"px";popup.style.top=Math.max(8,Math.min(rect.bottom+8,innerHeight-450))+"px";
    const close=()=>{popup.remove();document.removeEventListener("pointerdown",outside,true);document.removeEventListener("keydown",key,true);recordPopupClose=null;};
    const outside=e=>{if(!popup.contains(e.target)&&!anchor.contains(e.target))close();};
    const key=e=>{if(e.key==="Escape"){e.stopPropagation();close();anchor.focus();}};
    popup.onpointerdown=e=>e.stopPropagation();popup.onkeydown=e=>e.stopPropagation();
    document.addEventListener("pointerdown",outside,true);document.addEventListener("keydown",key,true);recordPopupClose=close;
    return {popup,close};
  }
  function openRecordField(note,c,anchor,adding=false) {
    const {popup,close}=recordPopup(anchor),t=note.table;
    const button=(label,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=fn;popup.append(b);return b;};
    const edit=(initialType=adding?"text":t.types[c])=>{
      popup.replaceChildren();
      const title=document.createElement("strong");title.textContent=adding?"Новое поле":"Настройка поля";popup.append(title);
      const name=document.createElement("input");name.placeholder="Название поля";name.setAttribute("aria-label","Название поля");name.value=adding?"":t.headers[c];popup.append(name);
      const typeLabel=document.createElement("label");typeLabel.textContent="Тип поля";popup.append(typeLabel);
      const types=document.createElement("div");types.className="record-type-list";popup.append(types);let kind=initialType;
      const opts=document.createElement("textarea");opts.placeholder="Каждый вариант с новой строки";opts.setAttribute("aria-label","Варианты списка");opts.value=adding?"":t.options[c].join("\n");
      const update=()=>{opts.hidden=!["dropdown","multi"].includes(kind);types.querySelectorAll("button").forEach(b=>b.classList.toggle("chosen",b.dataset.type===kind));};
      for(const [key,[icon,label]] of Object.entries(recordTypes)){const b=document.createElement("button");b.type="button";b.dataset.type=key;b.textContent=icon+"  "+label;b.onclick=()=>{kind=key;update();};types.append(b);}
      popup.append(opts);update();
      button("Сохранить",()=>{if(adding){editTableStructure(note,"add-col",c);}t.headers[c]=name.value.trim()||"Новое поле";t.types[c]=kind;t.options[c]=[...new Set(opts.value.split("\n").map(v=>v.trim()).filter(Boolean))];close();renderTable(note,noteElements.get(note.id));save();}).classList.add("primary");
      button("Отмена",close);name.focus();
    };
    if(adding){edit();return;}
    const title=document.createElement("strong");title.textContent=t.headers[c];popup.append(title);
    button("✎  Изменить поле",()=>edit());
    for(const [label,direction] of [["↑  По возрастанию",1],["↓  По убыванию",-1]])button(label,()=>{const order=t.cells.map((_,i)=>i).sort((a,b)=>String(t.cells[a][c]).localeCompare(String(t.cells[b][c]),"ru",{numeric:true})*direction);t.cells=order.map(i=>t.cells[i]);t.rows=order.map(i=>t.rows[i]);t.images=order.map(i=>t.images[i]);close();renderTable(note,noteElements.get(note.id));save();});
    button("+  Вставить слева",()=>{close();openRecordField(note,c,anchor,true);});
    button("+  Вставить справа",()=>{close();openRecordField(note,c+1,anchor,true);});
    button("⧉  Дублировать поле",()=>{const data={name:t.headers[c],type:t.types[c],options:[...t.options[c]],cells:t.cells.map(row=>row[c]),images:t.images.map(row=>row[c])};editTableStructure(note,"add-col",c+1);t.headers[c+1]=data.name+" — копия";t.types[c+1]=data.type;t.options[c+1]=data.options;t.cells.forEach((row,r)=>row[c+1]=data.cells[r]);t.images.forEach((row,r)=>row[c+1]=data.images[r]);close();renderTable(note,noteElements.get(note.id));save();});
    const remove=button("⌫  Удалить поле",()=>{close();editTableStructure(note,"remove-col",c);});remove.disabled=t.columns.length<=1;remove.classList.add("danger");
  }

  function fitRecordPictures(el) {
    el.querySelectorAll(".record-picture").forEach(picture=>{
      const cell=picture.closest(".table-cell"),ratio=Number(picture.dataset.ratio)||1;
      const width=Math.min(Math.max(1,cell.clientWidth-28),Math.max(1,cell.clientHeight-20)*ratio);
      picture.style.width=width+"px";picture.style.height=width/ratio+"px";
    });
  }
  function buildRecordImage(note,el,cell,r,c) {
    cell.classList.add("record-image-cell");
    const id=note.table.images[r][c],button=document.createElement("button");button.type="button";button.className="table-image-add";button.textContent=id?"Загрузка…":"＋ Картинка";cell.append(button);
    const upload=async file=>{
      if(!file||!file.type.startsWith("image/"))return;
      try {const probe=new Image(),url=URL.createObjectURL(file);try{probe.src=url;await probe.decode();}finally{URL.revokeObjectURL(url);}
      const asset=crypto.randomUUID(),db=await imageStore();await new Promise((resolve,reject)=>{const tx=db.transaction("images","readwrite");tx.objectStore("images").put(file,asset);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      note.table.images[r][c]=asset;renderTable(note,el);save();
      }catch(error){button.textContent="Не удалось загрузить. Повторить";button.title=error.message;}
    };
    const pick=()=>{const input=document.createElement("input");input.type="file";input.accept="image/*";input.onchange=()=>upload(input.files?.[0]);input.click();};
    button.onclick=pick;
    cell.ondragover=e=>{if([...e.dataTransfer.types].includes("Files")){e.preventDefault();e.stopPropagation();cell.classList.add("image-drop-target");}};
    cell.ondragleave=()=>cell.classList.remove("image-drop-target");
    cell.ondrop=e=>{e.preventDefault();e.stopPropagation();cell.classList.remove("image-drop-target");upload([...e.dataTransfer.files].find(file=>file.type.startsWith("image/")));};
    if(!id)return;
    readImageAsset(id).then(blob=>{
      if(!blob||!cell.isConnected){button.textContent="＋ Заменить картинку";return;}
      const picture=document.createElement("div");picture.className="record-picture";
      const img=document.createElement("img");img.draggable=false;img.alt="Картинка в ячейке";picture.append(img);
      const style=note.table.imageStyles?.[id]||{},mask=imageMask(style),crop=mask.crop;
      picture.style.borderRadius=mask.shape==="circle"?"50%":"0";
      img.style.cssText="position:absolute;max-width:none;max-height:none;object-fit:fill;margin:0;width:"+100/crop.w+"%;height:"+100/crop.h+"%;left:"+(-100*crop.x/crop.w)+"%;top:"+(-100*crop.y/crop.h)+"%;";
      const url=URL.createObjectURL(blob);img.onload=()=>{URL.revokeObjectURL(url);if(mask.shape==="circle"||mask.shape==="square"){const side=Math.min(img.naturalWidth*crop.w,img.naturalHeight*crop.h),w=side/img.naturalWidth,h=side/img.naturalHeight,x=crop.x+(crop.w-w)/2,y=crop.y+(crop.h-h)/2;img.style.width=100/w+"%";img.style.height=100/h+"%";img.style.left=-100*x/w+"%";img.style.top=-100*y/h+"%";mask.crop={x,y,w,h};picture.dataset.ratio=1;}else picture.dataset.ratio=(img.naturalWidth*crop.w)/(img.naturalHeight*crop.h);fitRecordPictures(el);};img.onerror=()=>URL.revokeObjectURL(url);img.src=url;button.replaceWith(picture);
      const extract=(x,y)=>{
        if(note.locked||note.table.images[r][c]!==id)return;
        const ratio=Number(picture.dataset.ratio)||1,width=Math.min(320,img.naturalWidth||320),height=width/ratio;
        const item={id:crypto.randomUUID(),type:"image",assetId:id,name:note.table.headers[c],x:x-width/2,y:y-height/2,width,height,scale:1,tilt:0,mask:structuredClone(mask)};
        notes.push(item);addElement(item);note.table.images[r][c]=null;renderTable(note,el);selectNote(item);save();
      };
      picture.onpointerdown=event=>{
        if(event.button!==0||spaceHeld)return;event.stopPropagation();if(note.locked)return;event.preventDefault();picture.setPointerCapture(event.pointerId);
        const startX=event.clientX,startY=event.clientY;let ghost=null,ghostUrl=null;
        const move=e=>{if(e.pointerId!==event.pointerId)return;if(!ghost&&Math.hypot(e.clientX-startX,e.clientY-startY)>5){const rect=picture.getBoundingClientRect();ghost=picture.cloneNode(true);ghost.classList.add("record-image-ghost");ghost.style.cssText+=";position:fixed;z-index:10001;pointer-events:none;width:"+rect.width+"px;height:"+rect.height+"px;opacity:.8;";ghostUrl=URL.createObjectURL(blob);ghost.querySelector("img").src=ghostUrl;document.body.append(ghost);}if(ghost){ghost.style.left=e.clientX-ghost.offsetWidth/2+"px";ghost.style.top=e.clientY-ghost.offsetHeight/2+"px";}};
        const end=e=>{if(e.pointerId!==event.pointerId)return;picture.removeEventListener("pointermove",move);picture.removeEventListener("pointerup",end);picture.removeEventListener("pointercancel",end);const moved=!!ghost;ghost?.remove();if(ghostUrl)URL.revokeObjectURL(ghostUrl);if(picture.hasPointerCapture(e.pointerId))picture.releasePointerCapture(e.pointerId);if(e.type!=="pointerup"||!moved)return;const rect=cell.getBoundingClientRect();if(e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom)return;const point=localPoint(e.clientX,e.clientY);extract(point.x,point.y);};
        picture.addEventListener("pointermove",move);picture.addEventListener("pointerup",end);picture.addEventListener("pointercancel",end);
      };
      const settings=document.createElement("button");settings.type="button";settings.className="record-image-settings";settings.textContent="⚙";settings.setAttribute("aria-label","Настройки картинки");
settings.title="Маска и картинка";cell.append(settings);
      settings.onclick=e=>{e.stopPropagation();const {popup,close}=recordPopup(settings);
        for(const [label,action] of [["Заменить картинку",()=>pick()],["Извлечь на доску",()=>extract(note.x+note.width*note.scale+180,note.y+120)],["Исходная маска",()=>setMask("original")],["Круг",()=>setMask("circle")],["Квадрат",()=>setMask("square")],["Удалить картинку",()=>{note.table.images[r][c]=null;renderTable(note,el);save();}]]){
          const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=()=>{close();action();};popup.append(b);
        }
        function setMask(shape){note.table.imageStyles??={};note.table.imageStyles[id]={mask:{shape,crop:shape==="original"?{x:0,y:0,w:1,h:1}:crop}};renderTable(note,el);save();}
      };
    });
  }
  function renderTable(note, el) {
    el.classList.toggle("record-table", isRecordTable(note));
    el.querySelectorAll(".table-grid,.table-divider,.table-add,.table-row-grip,.record-add-row,.record-add-col,.record-tools").forEach(child => child.remove());
    const grid = document.createElement("div"); grid.className = "table-grid";
    grid.style.gridTemplateRows = `${isRecordTable(note) ? "34px " : ""}${note.table.rows.map(n => n + "px").join(" ")}`;
    grid.style.setProperty("--table-border-color", note.table.borderColor);
    grid.style.setProperty("--table-border-width", note.table.borderWidth + "px");
    if(isRecordTable(note)) note.table.headers.forEach((name,c)=>{
      const head=document.createElement("div");head.className="table-head-cell";head.dataset.col=c;
      head.innerHTML=`<button type="button" class="table-drag-grip" title="Переместить столбец" aria-label="Переместить столбец">⠿</button><span>${escapeHtml(name)}</span><button type="button" title="Настроить столбец">⋮</button>`;
      head.addEventListener("pointerdown",event=>{event.stopPropagation();note.table.activeCol=c;selectNote(note);grid.querySelectorAll(".table-head-cell.active").forEach(item=>item.classList.remove("active"));head.classList.add("active");});
      head.querySelector("span").ondblclick=event=>{
        event.preventDefault();event.stopPropagation();const label=event.currentTarget,input=document.createElement("input");input.className="record-header-editor";input.value=note.table.headers[c];input.setAttribute("aria-label","Название столбца");label.replaceWith(input);let done=false;
        const finish=cancel=>{if(done)return;done=true;if(!cancel){note.table.headers[c]=input.value.trim()||note.table.headers[c];save();}label.textContent=note.table.headers[c];input.replaceWith(label);};
        input.onpointerdown=e=>e.stopPropagation();input.ondblclick=e=>e.stopPropagation();input.onkeydown=e=>{e.stopPropagation();if(e.key==="Enter"){e.preventDefault();finish(false);}if(e.key==="Escape")finish(true);};input.onblur=()=>finish(false);input.focus();input.select();
      };
      const colGrip=head.querySelector(".table-drag-grip");
      colGrip.addEventListener("pointerdown",event=>{
        if(event.button!==0||note.locked)return;event.preventDefault();event.stopPropagation();selectNote(note);colGrip.setPointerCapture(event.pointerId);
        const move=moveEvent=>{if(moveEvent.pointerId!==event.pointerId)return;const target=[...grid.querySelectorAll(".table-head-cell")].findIndex(item=>moveEvent.clientX<item.getBoundingClientRect().left+item.getBoundingClientRect().width/2);grid.querySelectorAll(".drop-target").forEach(item=>item.classList.remove("drop-target"));if(target>=0)grid.querySelectorAll(".table-head-cell")[target]?.classList.add("drop-target");};
        const end=endEvent=>{if(endEvent.pointerId!==event.pointerId)return;colGrip.removeEventListener("pointermove",move);colGrip.removeEventListener("pointerup",end);colGrip.removeEventListener("pointercancel",end);grid.querySelectorAll(".drop-target").forEach(item=>item.classList.remove("drop-target"));if(endEvent.type==="pointerup"){const items=[...grid.querySelectorAll(".table-head-cell")],target=tableDropIndex(items,endEvent.clientX,"col",c);if(target!==c)moveTableAxis(note,"col",c,target);}};
        colGrip.addEventListener("pointermove",move);colGrip.addEventListener("pointerup",end);colGrip.addEventListener("pointercancel",end);
      });
      head.querySelector("button:last-child").onclick=event=>{event.stopPropagation();openRecordField(note,c,event.currentTarget);
      };grid.append(head);
    });
    note.table.cells.forEach((row, r) => row.forEach((value, c) => {
      const cell = document.createElement("div"); cell.className = "table-cell";
      cell.dataset.row = r; cell.dataset.col = c;
      if(isRecordTable(note) && ["dropdown","multi"].includes(note.table.types[c])){
        const current=document.createElement("button");current.type="button";current.className="table-dropdown-value";current.textContent=value||"";current.setAttribute("aria-label",value||"Выбрать вариант");
        const menu=document.createElement("div");menu.className="table-dropdown-menu";menu.hidden=true;
        const search=document.createElement("input");search.type="search";search.placeholder="⌕  Найти вариант…";search.setAttribute("aria-label","Найти вариант");menu.append(search);
        const list=document.createElement("div");list.className="table-dropdown-options";menu.append(list);
        const choose=option=>{if(note.table.types[c]==="multi" && option){const selected=new Set(note.table.cells[r][c].split("\n").filter(Boolean));selected.has(option)?selected.delete(option):selected.add(option);option=[...selected].join("\n");}note.table.cells[r][c]=option;current.textContent=option;current.setAttribute("aria-label",option||"Выбрать вариант");menu.hidden=true;recordPopupClose?.();search.value="";save();};
        const drawOptions=()=>{list.replaceChildren();const options=[...new Set([...note.table.cells[r][c].split("\n").filter(Boolean),...note.table.options[c]])];for(const option of options){if(search.value&&!option.toLocaleLowerCase("ru").includes(search.value.toLocaleLowerCase("ru")))continue;const item=document.createElement("button");item.type="button";item.className="table-dropdown-option";item.textContent=option;item.onclick=event=>{event.stopPropagation();choose(option);};list.append(item);}const none=document.createElement("button");none.type="button";none.className="table-dropdown-none";none.textContent="Нет";none.onclick=event=>{event.stopPropagation();choose("");};list.append(none);};
        current.onclick=event=>{event.stopPropagation();const {popup}=recordPopup(current);menu.hidden=false;menu.style.cssText="position:static;width:auto;max-width:none;padding:0;border:0;box-shadow:none";popup.append(menu);drawOptions();search.focus();};
        search.oninput=drawOptions;search.onkeydown=event=>{if(event.key==="Escape"){event.stopPropagation();menu.hidden=true;recordPopupClose?.();current.focus();}};menu.onpointerdown=event=>event.stopPropagation();cell.append(current,menu);
      }else if(isRecordTable(note) && note.table.types[c]==="image"){
        buildRecordImage(note,el,cell,r,c);
      }else if(isRecordTable(note)&&["number","date","link"].includes(note.table.types[c])) {
        const input=document.createElement("input");input.className="record-cell-input";input.type=note.table.types[c]==="number"?"number":note.table.types[c]==="date"?"date":"url";input.step="any";input.value=value;input.setAttribute("aria-label",note.table.headers[c]);input.onpointerdown=e=>e.stopPropagation();input.oninput=()=>{note.table.cells[r][c]=input.value;saveSoon();};input.onchange=()=>save();cell.append(input);
      }else cell.textContent=value;
      cell.classList.toggle("active", note.table.activeRow === r && note.table.activeCol === c);
      grid.append(cell);
    }));
    grid.onpointerdown = event => {
      if (isEquipmentFrame(note)) return;
      if(event.button===0&&!spaceHeld&&event.target.closest("button,input,select,.record-picture"))event.stopPropagation();
      if(!event.target.closest(".table-dropdown-menu,.table-dropdown-value"))grid.querySelectorAll(".table-dropdown-menu").forEach(menu=>menu.hidden=true);
      const cell = event.target.closest(".table-cell");
      if (!cell) return;
      note.table.activeRow = Number(cell.dataset.row); note.table.activeCol = Number(cell.dataset.col);
      grid.querySelectorAll(".table-cell.active").forEach(item => item.classList.remove("active"));
      cell.classList.add("active");
      el.querySelectorAll(".table-add").forEach(button => {
        const selectedIndex = button.dataset.axis === "col" ? note.table.activeCol : note.table.activeRow;
        button.classList.toggle("near-active", Number(button.dataset.index) === selectedIndex || Number(button.dataset.index) === selectedIndex + 1);
      });
    };
    if(isRecordTable(note)) note.table.rows.forEach((_,r)=>{
      const grip=document.createElement("button");grip.type="button";grip.className="table-row-grip";grip.textContent=`${r+1} ⠿`;grip.title="Переместить строку";grip.setAttribute("aria-label",`Переместить строку ${r+1}`);grip.dataset.row=r;el.append(grip);
      grip.addEventListener("pointerdown",event=>{if(event.button!==0||note.locked)return;event.preventDefault();event.stopPropagation();note.table.activeRow=r;selectNote(note);grip.setPointerCapture(event.pointerId);const end=endEvent=>{if(endEvent.pointerId!==event.pointerId)return;grip.removeEventListener("pointerup",end);grip.removeEventListener("pointercancel",end);if(endEvent.type!=="pointerup")return;const cells=[...grid.querySelectorAll('.table-cell[data-col="0"]')],target=tableDropIndex(cells,endEvent.clientY,"row",r);if(target!==r)moveTableAxis(note,"row",r,target);};grip.addEventListener("pointerup",end);grip.addEventListener("pointercancel",end);});
    });
    el.ondblclick = event => {
      if (isEquipmentFrame(note)) { event.stopPropagation(); selectNote(note, false, true); return; }
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest(".table-cell");
      if (!cell || !grid.contains(cell) || cell.querySelector("textarea")) return;
      event.preventDefault(); event.stopPropagation(); selectNote(note);
      const r = Number(cell.dataset.row), c = Number(cell.dataset.col); if(isRecordTable(note) && !["text","person"].includes(note.table.types[c]))return; const field = document.createElement("textarea");
      field.value = note.table.cells[r][c]; field.setAttribute("aria-label", `Строка ${r+1}, столбец ${c+1}`);
      cell.textContent = ""; cell.append(field); field.focus();
      const fitEditor = () => {
        field.style.height = "1px";
        const style = getComputedStyle(cell);
        const needed = Math.ceil(field.scrollHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) + 2);
        field.style.height = "100%";
        if (needed > note.table.rows[r]) { note.table.rows[r] = needed; layoutTable(note, el); }
      };
      fitEditor();
      field.addEventListener("input", () => { note.table.cells[r][c] = field.value; fitEditor(); saveSoon(); });
      field.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); field.blur(); } });
      field.addEventListener("blur", () => { note.table.cells[r][c] = field.value; cell.textContent = field.value; save(); }, { once:true });
    };
    el.prepend(grid);
    if (isEquipmentFrame(note)) { layoutTable(note, el); return; }
    for (const [axis, lengths] of [["col", note.table.columns], ["row", note.table.rows]]) {
      for (let index = 0; index < lengths.length - 1; index++) {
        const handle = document.createElement("div"); handle.className = "table-divider";
        handle.dataset.axis = axis; handle.dataset.index = index;
        handle.addEventListener("pointerdown", event => {
          if (event.button !== 0 || note.locked) return;
          event.preventDefault(); event.stopPropagation(); document.activeElement?.blur(); selectNote(note);
          const start = axis === "col" ? event.clientX : event.clientY;
          const first = lengths[index], second = lengths[index+1], min = axis === "col" ? minTableColumn : minTableRow;
          handle.setPointerCapture(event.pointerId);
          const move = e => {
            if (e.pointerId !== event.pointerId) return;
            const delta = ((axis === "col" ? e.clientX : e.clientY) - start) / (camera.scale * note.scale);
            const grid = el.querySelector(".table-grid");
            const candidate = limit(first + delta, min, first + second - min);
            const fits = value => {
              lengths[index] = value; lengths[index+1] = first + second - value;
              grid.style[axis === "col" ? "gridTemplateColumns" : "gridTemplateRows"] = axis === "col" ? lengths.map(v => v + "px").join(" ") : `${isRecordTable(note) ? "34px " : ""}${lengths.map(v => v + "px").join(" ")}`;
              return tableCellsFit(note, grid);
            };
            const previous = lengths[index];
            if (!fits(candidate)) {
              let safe = previous, blocked = candidate;
              for (let i = 0; i < 10; i++) { const mid = (safe + blocked) / 2; if (fits(mid)) safe = mid; else blocked = mid; }
              fits(safe);
            }
            layoutTable(note, el);
          };
          const end = e => {
            if (e.pointerId !== event.pointerId) return;
            handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end);
            if (e.type === "pointerup") { layoutTable(note, el); save(); }
            else { lengths[index] = first; lengths[index+1] = second; layoutTable(note, el); }
          };
          handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
        });
        el.insertBefore(handle, el.querySelector(".note-corners"));
      }
      for (let index = 0; !isRecordTable(note) && index <= lengths.length; index++) {
        const button = document.createElement("button"); button.type = "button"; button.className = "table-add";
        button.dataset.axis = axis; button.dataset.index = index; button.textContent = "+";
        const selectedIndex = axis === "col" ? note.table.activeCol : note.table.activeRow;
        button.classList.toggle("near-active", Number.isInteger(selectedIndex) && (index === selectedIndex || index === selectedIndex + 1));
        button.title = axis === "col" ? "Вставить столбец" : "Вставить строку";
        button.setAttribute("aria-label", button.title);
        button.addEventListener("pointerdown", event => event.stopPropagation());
        button.addEventListener("click", event => { event.stopPropagation(); selectNote(note); editTableStructure(note, axis === "col" ? "add-col" : "add-row", index); });
        el.append(button);
      }
    }
    if(isRecordTable(note)) {
      const tools=document.createElement("div");tools.className="record-tools";
      const label=document.createElement("strong");label.textContent="▦  Таблица записей";tools.append(label);
      for(const [text,title,action] of [["↔","Одинаковая ширина столбцов","equal-col"],["↕","Одинаковая высота строк","equal-row"]]){const b=document.createElement("button");b.type="button";b.textContent=text;b.title=title;b.onclick=()=>editTableStructure(note,action,0);tools.append(b);}
      const search=document.createElement("input");search.type="search";search.placeholder="Поиск в таблице";search.setAttribute("aria-label","Поиск в таблице");search.oninput=()=>{const q=search.value.toLocaleLowerCase("ru");grid.querySelectorAll(".table-cell").forEach(cell=>cell.classList.toggle("record-match",!!q&&note.table.cells[Number(cell.dataset.row)][Number(cell.dataset.col)].toLocaleLowerCase("ru").includes(q)));};tools.append(search);tools.onpointerdown=e=>e.stopPropagation();el.append(tools);
      for(const [axis,label] of [["row","Добавить строку"],["col","Добавить столбец"]]) {
        const button=document.createElement("button");button.type="button";button.className="record-add-"+axis;button.textContent="+";button.title=label;button.setAttribute("aria-label",label);
        button.onpointerdown=event=>event.stopPropagation();button.onclick=event=>{event.stopPropagation();selectNote(note);if(axis==="col"){openRecordField(note,note.table.columns.length,button,true);return;}editTableStructure(note,"add-"+axis,note.table.rows.length);};el.append(button);
      }
    }
    layoutTable(note, el);
  }
  function editTableStructure(note, action, index) {
    if (!isTable(note) || isEquipmentFrame(note)) return;
    const { columns, rows, cells, headers, types, options, images } = note.table;
    if (action === "add-col" && columns.length < 50) { index = limit(index, 0, columns.length); columns.splice(index, 0, columns[Math.min(index, columns.length-1)]); cells.forEach(row => row.splice(index, 0, "")); headers.splice(index,0,`Столбец ${columns.length}`); types.splice(index,0,"text"); options.splice(index,0,[]); images.forEach(row=>row.splice(index,0,null)); }
    else if (action === "add-row" && rows.length < 50) { index = limit(index, 0, rows.length); rows.splice(index, 0, rows[Math.min(index, rows.length-1)]); cells.splice(index, 0, columns.map(() => "")); images.splice(index,0,columns.map(()=>null)); }
    else if (action === "remove-col" && columns.length > 1) { index = limit(index, 0, columns.length-1); columns.splice(index, 1); cells.forEach(row => row.splice(index, 1));headers.splice(index,1);types.splice(index,1);options.splice(index,1);images.forEach(row=>row.splice(index,1)); }
    else if (action === "remove-row" && rows.length > 1) { index = limit(index, 0, rows.length-1); rows.splice(index, 1); cells.splice(index, 1);images.splice(index,1); }
    else if (action === "equal-col") { const width = columns.reduce((a,b) => a+b, 0) / columns.length; columns.fill(width); }
    else if (action === "equal-row") { const height = rows.reduce((a,b) => a+b, 0) / rows.length; rows.fill(height); }
    else return;
    if (Number.isInteger(note.table.activeRow)) note.table.activeRow = Math.min(note.table.activeRow, rows.length-1);
    if (Number.isInteger(note.table.activeCol)) note.table.activeCol = Math.min(note.table.activeCol, columns.length-1);
    renderTable(note, noteElements.get(note.id)); paletteMetrics = null; placePalette(); save();
  }
  function renderImageStyle(note, el) {
    const viewport = el.querySelector(".image-viewport"), img = viewport?.querySelector("img");
    if (!viewport || !img) return;
    const mask = imageCropSession?.note === note ? {shape:"original",crop:{x:0,y:0,w:1,h:1}} : imageMask(note);
    const stroke = imageStroke(note), crop = mask.crop;
    img.style.width = 100 / crop.w + "%"; img.style.height = 100 / crop.h + "%";
    img.style.left = -100 * crop.x / crop.w + "%"; img.style.top = -100 * crop.y / crop.h + "%";
    viewport.style.borderRadius = mask.shape === "circle" && imageCropSession?.note !== note ? "50%" : stroke.radius + "px";
    viewport.style.setProperty("--image-stroke-color", stroke.color);
    viewport.style.setProperty("--image-stroke-width", stroke.width + "px");
    viewport.style.setProperty("--image-stroke-style", stroke.style);
    viewport.style.setProperty("--image-stroke-opacity", stroke.opacity);
  }
  function buildImage(note, el) {
    const viewport = document.createElement("div"); viewport.className = "image-viewport";
    const img = document.createElement("img"); img.alt = note.name || "Изображение"; img.draggable = false;
    viewport.append(img); el.append(viewport); renderImageStyle(note, el);
    readImageAsset(note.assetId).then(blob => {
      if (!blob || !el.isConnected) { if (!blob) img.alt = "Файл изображения недоступен"; return; }
      const url = URL.createObjectURL(blob);
      img.onload = img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }).catch(() => { img.alt = "Не удалось загрузить изображение"; });
  }
  function applyImageMask(note, shape, crop) {
    const el = noteElements.get(note.id), source = imageSourceSize(note);
    note.imageSourceWidth = source.width; note.imageSourceHeight = source.height;
    if (!crop) {
      const ratio = {circle:1,square:1,portrait:3/4,landscape:4/3,wide:16/9}[shape];
      if (!ratio) crop = {x:0,y:0,w:1,h:1};
      else {
        const sourceRatio = source.width / source.height;
        const w = Math.min(1, ratio / sourceRatio), h = Math.min(1, sourceRatio / ratio);
        crop = {x:(1-w)/2,y:(1-h)/2,w,h};
      }
    }
    const oldWidth = note.width, oldHeight = note.height;
    note.mask = {shape,crop};
    note.width = source.width * crop.w; note.height = source.height * crop.h;
    note.x += (oldWidth - note.width) * note.scale / 2;
    note.y += (oldHeight - note.height) * note.scale / 2;
    positionNote(note, el); renderImageStyle(note, el); drawTextSelection(); placePalette(); save();
  }
  function closeImageCrop(apply = false) {
    const session = imageCropSession;
    if (!session) return;
    const {note,old,crop} = session, el = noteElements.get(note.id);
    imageCropSession = null;
    el?.querySelector(".image-crop-overlay")?.remove(); el?.classList.remove("image-cropping");
    if (apply) {
      note.width = old.width; note.height = old.height; note.x = old.x; note.y = old.y;
      applyImageMask(note,"custom",crop);
    } else {
      Object.assign(note,old); positionNote(note,el); renderImageStyle(note,el); drawTextSelection(); placePalette();
    }
    $("image-crop-apply").hidden = $("image-crop-cancel").hidden = true;
    $("image-mask").hidden = $("image-stroke").hidden = false;
  }
  function startImageCrop(note) {
    if (imageCropSession) closeImageCrop(false);
    const el = noteElements.get(note.id), source = imageSourceSize(note), crop = structuredClone(imageMask(note).crop);
    imageCropSession = {note,crop,old:{x:note.x,y:note.y,width:note.width,height:note.height,mask:note.mask}};
    note.x += (note.width - source.width) * note.scale / 2;
    note.y += (note.height - source.height) * note.scale / 2;
    note.width = source.width; note.height = source.height;
    positionNote(note,el); renderImageStyle(note,el); el.classList.add("image-cropping");
    const overlay = document.createElement("div"); overlay.className = "image-crop-overlay";
    overlay.addEventListener("pointerdown", event => { if (event.target === overlay) { event.preventDefault(); event.stopPropagation(); } });
    const box = document.createElement("div"); box.className = "image-crop-box";
    box.innerHTML = ["nw","n","ne","e","se","s","sw","w"].map(edge => `<span class="image-crop-handle" data-edge="${edge}"></span>`).join("");
    overlay.append(box); el.querySelector(".image-viewport").append(overlay);
    const paint = () => { box.style.left=crop.x*100+"%"; box.style.top=crop.y*100+"%"; box.style.width=crop.w*100+"%"; box.style.height=crop.h*100+"%"; };
    paint();
    box.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const edge = event.target.dataset.edge || "move", start = {...crop}, sx = event.clientX, sy = event.clientY;
      box.setPointerCapture(event.pointerId);
      const move = e => {
        if (e.pointerId !== event.pointerId) return;
        const rect = el.getBoundingClientRect(), dx = (e.clientX-sx)/rect.width, dy = (e.clientY-sy)/rect.height;
        if (edge === "move") { crop.x=limit(start.x+dx,0,1-start.w); crop.y=limit(start.y+dy,0,1-start.h); }
        else {
          if (edge.includes("w")) { const x=limit(start.x+dx,0,start.x+start.w-.05); crop.x=x; crop.w=start.w+start.x-x; }
          if (edge.includes("e")) crop.w=limit(start.w+dx,.05,1-start.x);
          if (edge.includes("n")) { const y=limit(start.y+dy,0,start.y+start.h-.05); crop.y=y; crop.h=start.h+start.y-y; }
          if (edge.includes("s")) crop.h=limit(start.h+dy,.05,1-start.y);
        }
        paint();
      };
      const end = e => { if (e.pointerId !== event.pointerId) return; box.removeEventListener("pointermove",move); box.removeEventListener("pointerup",end); box.removeEventListener("pointercancel",end); };
      box.addEventListener("pointermove",move); box.addEventListener("pointerup",end); box.addEventListener("pointercancel",end);
    });
    $("image-crop-apply").hidden = $("image-crop-cancel").hidden = false;
    $("image-mask").hidden = $("image-stroke").hidden = true;
    drawTextSelection(); placePalette();
  }
  function addElement(note) {
    const el = document.createElement("article");
    el.className = isShape(note) ? "note shape-card" : isTable(note) ? "note table-card" : isFlipCard(note) ? "note flip-card" : isCounter(note) ? "note counter-card" : isRpg(note) ? "note rpg-card" : isText(note) ? "note text-area" : isWallet(note) ? "note wallet-card" : isImage(note) ? "note image-card" : "note";
    el.tabIndex = 0;
    el.dataset.id = note.id;
    el.style.setProperty("--tilt", note.tilt + "deg");
    if (isText(note)) applyTextFormat(note, el);
    else if (!isScalable(note)) el.style.setProperty("--paper", papers[note.color][0]);
    positionNote(note, el);
    if (isScalable(note)) {
      if (isShape(note)) renderShape(note, el);
      else if (isTable(note)) renderTable(note, el);
      else if (isFlipCard(note)) buildFlipCard(note, el);
      else if (isRpg(note)) rpgRefresh.set(note.id, RpgTracker.mount(el, note.tracker, (action, before) => {
        if (action?.type !== "undo") recordCharacterAction(note, before);
        if (action?.type === "name") notes.filter(isCounter).forEach(n => counterRefresh.get(n.id)?.());
        if (["turn", "use"].includes(action?.type) && note.tracker.mode === "action") {
          for (const counterNote of notes.filter(n => isCounter(n) && n.counter.linkId === note.id)) CounterWidget.turn(counterNote.counter);
          notes.filter(n => isCounter(n) && n.counter.linkId === note.id).forEach(n => counterRefresh.get(n.id)?.());
        }
        if (action?.type === "day") notes.filter(n => isCounter(n) && n.counter.linkId === note.id).forEach(n => { CounterWidget.day(n.counter); counterRefresh.get(n.id)?.(); });
        save();
      }, () => characterSnapshot(note), () => undoCharacterAction(note), () => !!note.actionHistory?.length));
      else if (isCounter(note)) counterRefresh.set(note.id, CounterWidget.mount(el, note.counter, notes.filter(isRpg), (updated, before) => {
        const character = notes.find(n => isRpg(n) && n.id === updated.linkId);
        if (character && before) recordCharacterAction(character, characterSnapshot(character, note.id, before));
        note.counter = updated;
        if (character) rpgRefresh.get(character.id)?.();
        save();
      }, height => {
        if (note.height === height) return;
        note.height = height;
        el.style.setProperty("--wallet-height", height + "px");
        if (selection.has(note.id)) placePalette();
        saveSoon();
      }));
      else if (isWallet(note)) buildWallet(note, el);
      else if (isImage(note)) buildImage(note, el);
      const corners = document.createElement("div");
      corners.className = "note-corners";
      corners.innerHTML = ["nw", "ne", "sw", "se", ...((isTable(note) || isShape(note)) ? ["n", "s", "e", "w"] : [])].map(c => `<span class="resize-handle" ${c.length === 1 ? `data-edge="${c}"` : `data-corner="${c}"`} title="Масштабировать элемент"></span>`).join("");
      el.append(corners);
    } else {
      const body = document.createElement("div");
      body.className = "note-content";
      body.textContent = note.text;
      const corners = document.createElement("div");
      corners.className = "note-corners";
      corners.setAttribute("aria-hidden", "true");
      const cornersAndEdges = ["nw", "ne", "sw", "se"];
      if (isText(note)) cornersAndEdges.push("n", "s", "e", "w");
      for (const corner of cornersAndEdges) {
        const handle = document.createElement("span");
        handle.className = "resize-handle";
        if (corner.length === 1) handle.dataset.edge = corner;
        else handle.dataset.corner = corner;
        handle.title = "Потяните, чтобы изменить размер";
        corners.append(handle);
      }
      el.append(body, corners);
      if (isText(note)) adjustText(note, el); else renderCard(note, el);
    }
    $("notes").append(el);
    noteElements.set(note.id, el);
    if (isCounter(note)) counterRefresh.get(note.id)?.();
    applyStackOrder();
    applyLockState(note, el);
    return el;
  }
  function placePalette(measure = true) {
    drawTextSelection();
    if (measure) paletteMetrics = null;
    if (selection.size > 1) { textToolbar.hidden = walletToolbar.hidden = palette.hidden = true; return; }
    if (!selected || tool !== "select" || gesture?.moving || (editor && !isText(selected))) {
      textToolbar.hidden = walletToolbar.hidden = palette.hidden = true;
      return;
    }
    const bar = isText(selected) ? textToolbar : isScalable(selected) ? walletToolbar : palette;
    if (!paletteMetrics) {
      textToolbar.hidden = bar !== textToolbar;
      walletToolbar.hidden = bar !== walletToolbar;
      palette.hidden = bar !== palette;
      const bounds = noteElements.get(selected.id).getBoundingClientRect();
      paletteMetrics = {
        width: bounds.width / paintedScale, height: bounds.height / paintedScale,
        barWidth: bar.offsetWidth, barHeight: bar.offsetHeight
      };
      if (bar === palette) {
        for (const btn of bar.querySelectorAll(".swatch")) btn.setAttribute("aria-pressed", String(btn.dataset.color === cardColor(selected)));
      }
    }
    const { width, height, barWidth, barHeight } = paletteMetrics;
    // Stickers rotate around their centre. Text areas use their unrotated bounds.
    const centeredSticker = !isText(selected) && !isScalable(selected);
    const left = camera.x + (selected.x + (centeredSticker ? (selected.size - width) / 2 : 0)) * camera.scale;
    const top = camera.y + (selected.y + (centeredSticker ? (selected.size - height) / 2 : 0)) * camera.scale;
    const bottom = top + height * camera.scale;
    bar.hidden = bottom < 0 || top > viewport.height || left + width * camera.scale < 0 || left > viewport.width;
    if (bar.hidden) return;
    const x = left + (width * camera.scale - barWidth) / 2;
    const above = top - barHeight - limit(viewport.height * .075, 24, 64);
    bar.style.transform = translate(limit(x, 6, viewport.width - barWidth - 6),
      limit(above < 4 ? bottom + 18 : above, 4, viewport.height - barHeight - 4));
  }
  function syncTextControls(note) {
    $("text-font").value = note.font;
    $("text-size").value = Math.round(note.fontSize);
    $("text-ink").value = note.ink;
    textToolbar.style.setProperty("--ink", note.ink);
    for (const button of textToolbar.querySelectorAll("[data-style], [data-align]")) {
      const { style, align } = button.dataset;
      button.setAttribute("aria-pressed", String(style ? !!note[style] : align === note.align));
    }
  }
  function applyLockState(note, el) {
    el.classList.toggle("locked", !!note.locked);
    for (const child of el.children) {
      child.inert = !!note.locked && !((isWallet(note) && child.classList.contains("wallet-shell")) || (isRpg(note) && child.classList.contains("rpg-shell")) || (isCounter(note) && child.classList.contains("counter-shell")) || (isFlipCard(note) && child.classList.contains("flip-shell")) || (isImage(note) && child.classList.contains("image-viewport")) || (isTable(note) && (child.classList.contains("table-grid") || child.classList.contains("table-add") || child.classList.contains("table-row-grip"))));
    }
  }
  function syncLockControls() {
    for (const bar of [palette, textToolbar, walletToolbar]) {
      for (const child of bar.children) {
        child.inert = !!selected?.locked && !child.classList.contains("lock-element") && !(isFlipCard(selected) && child.id === "flip-controls") && !(isImage(selected) && child.id === "image-controls") && !(isTable(selected) && child.id === "table-controls");
      }
      const button = bar.querySelector(".lock-element");
      if (!button) continue;
      const label = selected?.locked ? "Разблокировать элемент" : "Заблокировать элемент";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(!!selected?.locked));
      button.innerHTML = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="' + (selected?.locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 8 0') + '"/><path d="M12 14v3"/></svg>';
    }
  }
  function applyStackOrder() {
    // The persisted array is ordered from the back of the board to the front.
    notes.forEach((note, index) => {
      const el = noteElements.get(note.id);
      if (el) el.style.zIndex = String(index);
    });
  }
  function changeLayer(direction) {
    const chosen = notes.filter(n => selection.has(n.id));
    if (!chosen.length || chosen.some(n => n.locked)) return;
    finishEdit();
    if (direction === "front" || direction === "back") {
      const rest = notes.filter(n => !selection.has(n.id));
      notes = direction === "front" ? [...rest, ...chosen] : [...chosen, ...rest];
    } else if (direction === "up") {
      for (let i = notes.length - 2; i >= 0; i--) {
        if (selection.has(notes[i].id) && !selection.has(notes[i + 1].id)) [notes[i], notes[i + 1]] = [notes[i + 1], notes[i]];
      }
    } else {
      for (let i = 1; i < notes.length; i++) {
        if (selection.has(notes[i].id) && !selection.has(notes[i - 1].id)) [notes[i], notes[i - 1]] = [notes[i - 1], notes[i]];
      }
    }
    applyStackOrder(); placePalette(); save();
  }
  function clearTableCellSelection(note) {
    if (!isTable(note)) return;
    note.table.activeRow = note.table.activeCol = null;
    noteElements.get(note.id)?.querySelectorAll(".table-cell.active,.table-add.near-active").forEach(el => el.classList.remove("active", "near-active"));
  }
  document.addEventListener("pointerdown", event => {
    if (isTable(selected) && !event.target.closest(".table-card,#wallet-toolbar")) clearTableCellSelection(selected);
  }, true);
  function selectNote(note, additive = false, singleMember = false) {
    if (imageCropSession && imageCropSession.note !== note) closeImageCrop(false);
    if (selected !== note) clearTableCellSelection(selected);
    const members = note ? notes.filter(n => n.id === note.id || (!singleMember && note.groupId && n.groupId === note.groupId)) : [];
    if (!additive) selection.clear();
    const remove = additive && members.every(n => selection.has(n.id));
    for (const n of members) { if (remove) selection.delete(n.id); else selection.add(n.id); }
    for (const n of notes) noteElements.get(n.id)?.classList.toggle("selected", selection.has(n.id));
    note = notes.find(n => selection.has(n.id)) || null;
    selected = note;
    if (note) {
      const el = noteElements.get(note.id);
      el.classList.add("selected");
      if (isText(note)) syncTextControls(note);
      if (isWallet(note)) $("wallet-color").value = note.color;
    }
    $("wallet-appearance").open = false;
    $("wallet-appearance").hidden = !isWallet(note);
    $("flip-controls").hidden = !isFlipCard(note);
    $("image-controls").hidden = !isImage(note);
    $("image-mask").open = $("image-stroke").open = false;
    $("table-controls").hidden = !isTable(note);
    $("shape-controls").hidden=!isShape(note);
    if(isShape(note)) {
      $("shape-kind").value=note.shapeKind;$("shape-fill").value=note.fill==="none"?"#ffffff":note.fill;
      $("shape-radius").value=Number(note.cornerRadius)||0;
      $("shape-radius-control").hidden=note.shapeKind!=="rect";
      $("shape-transparent").checked=note.fill==="none";$("shape-stroke").value=note.strokeColor;$("shape-width").value=note.strokeWidth;
    }
    $("table-controls").querySelectorAll("[data-table-action]").forEach(button => {
      button.hidden = isEquipmentFrame(note) && button.dataset.tableAction !== "delete-table";
      if (button.dataset.tableAction === "delete-table") button.textContent = isEquipmentFrame(note) ? "Удалить рамку" : "Удалить таблицу";
    });
    $("table-more").open = false;
    walletToolbar.classList.toggle("table-toolbar", isTable(note));
    walletToolbar.classList.toggle("record-toolbar", isRecordTable(note));
    if (isFlipCard(note)) syncFlipControls(note);
    if (isImage(note)) {
      const stroke = imageStroke(note);
      $("image-stroke-color").value = stroke.color;
      $("image-stroke-width").value = stroke.width;
      $("image-stroke-radius").value = stroke.radius;
      $("image-stroke-opacity").value = Math.round(stroke.opacity * 100);
      $("image-stroke-style").value = stroke.style;
    }
    if (isTable(note)) { $("table-border-color").value = note.table.borderColor; $("table-border-width").value = note.table.borderWidth; }
    walletToolbar.querySelector(".wallet-toolbar-label").textContent = isShape(note) ? "Фигура" : isRecordTable(note) ? "Таблица записей" : isTable(note) ? "Свободная сетка" : isFlipCard(note) ? "Флип-карточка" : isCounter(note) ? "Счётчик" : isRpg(note) ? "Лист персонажа" : isImage(note) ? "Изображение" : "Кошелёк";
    $("remove-wallet").title = $("remove-wallet").ariaLabel = isShape(note) ? "Удалить фигуру" : isTable(note) ? "Удалить таблицу" : isFlipCard(note) ? "Удалить флип-карточку" : isCounter(note) ? "Удалить счётчик" : isRpg(note) ? "Удалить лист персонажа" : isImage(note) ? "Удалить изображение" : "Удалить кошелёк";
    syncLockControls();
    placePalette();
  }
  function finishEdit() {
    if (!editor) return;
    const { field, note, el } = editor;
    editor = null;
    if (isSticky(note) && note.flipped) note.back.text = field.value; else note.text = field.value;
    el.querySelector(".note-content").textContent = cardText(note);
    field.remove();
    el.classList.remove("editing");
    adjustText(note, el);
    placePalette();
    save();
  }
  function editNote(note, offset = cardText(note).length) {
    if (note.locked || (note.groupId && notes.some(n => n.groupId === note.groupId && n.locked))) return;
    finishEdit();
    selectNote(note, false, true);
    const el = noteElements.get(note.id);
    const field = document.createElement("textarea");
    field.className = "note-editor";
    field.setAttribute("aria-label", isText(note) ? "Текстовая область" : "Текст стикера");
    field.placeholder = isText(note) ? "Введите текст…" : "Ваш текст…";
    field.value = cardText(note);
    editor = { note, el, field };
    el.classList.add("editing");
    palette.hidden = true;
    el.append(field);
    adjustText(note, el);
    field.focus({ preventScroll: true });
    field.setSelectionRange(offset, offset);
    field.addEventListener("input", () => {
      if (isSticky(note) && note.flipped) note.back.text = field.value; else note.text = field.value;
      adjustText(note, el);
      if (isText(note)) placePalette();
      saveSoon();
    });
    field.addEventListener("blur", event => {
      if (!event.relatedTarget?.closest("#text-toolbar")) finishEdit();
    });
    placePalette();
  }
  function setTool(next) {
    finishEdit();
    $("shape-picker").hidden = true;
    tool = next;
    $("select-tool").setAttribute("aria-pressed", String(next === "select"));
    $("note-tool").setAttribute("aria-pressed", String(next === "note"));
    $("flip-tool").setAttribute("aria-pressed", String(next === "flipcard"));
    $("shape-tool").setAttribute("aria-pressed", String(next === "shape"));
    $("text-tool").setAttribute("aria-pressed", String(next === "text"));
    $("table-tool").setAttribute("aria-pressed", String(next === "table"));
    $("records-tool").setAttribute("aria-pressed", String(next === "records"));
    $("rpg-tool").setAttribute("aria-pressed", String(next === "rpg"));
    $("wallet-tool").setAttribute("aria-pressed", String(next === "wallet"));
    $("counter-tool").setAttribute("aria-pressed", String(next === "counter"));
    canvas.classList.toggle("placing", next === "note");
    canvas.classList.toggle("placing-text", next === "text");
    canvas.classList.toggle("placing-wallet", next === "wallet" || next === "flipcard" || next === "table" || next === "records" || next === "shape");
    canvas.classList.toggle("placing-counter", next === "counter");
    const tip = $("placement-tip");
    tip.hidden = next === "select";
    tip.textContent = next === "rpg" ? "Нажмите на холст, чтобы добавить лист персонажа" : next === "text" ? "Нажмите, чтобы ввести текст, или потяните, чтобы задать ширину" :
      next === "wallet" ? "Нажмите на холст, чтобы добавить кошелёк" : next === "counter" ? "Нажмите на холст, чтобы добавить счётчик" : next === "flipcard" ? "Нажмите на холст, чтобы добавить карточку" : next === "shape" ? "Потяните на холсте, чтобы нарисовать фигуру" : next === "records" ? "Нажмите или потяните, чтобы создать таблицу записей" : next === "table" ? "Нажмите или потяните, чтобы создать свободную сетку" : "Нажмите на холст, чтобы добавить стикер";
    if (next !== "select") selectNote(null);
    setHelp(false);
  }
  function createNote(point) {
    const note = { id: crypto.randomUUID(), x: point.x - defaultSize / 2, y: point.y - defaultSize / 2, size: defaultSize, tilt: 0, color: preferredColor, text: "" };
    notes.push(note);
    const el = addElement(note);
    setTool("select");
    selectNote(note);
    el.focus({ preventScroll: true });
    
    save();
  }
  function createFlipCard(point) {
    const note = {id:crypto.randomUUID(),type:"flipcard",x:point.x-120,y:point.y-175,width:240,height:350,scale:1,tilt:0,flipped:false,
      front:{title:"",text:"",color:"yellow",assetId:null},back:{title:"",text:"",color:"yellow",assetId:null}};
    notes.push(note); addElement(note); setTool("select"); selectNote(note); save();
  }
  function normalizeShape(note) {
    const color=(v,f)=>/^#[0-9a-f]{6}$/i.test(v)?v:f;
    return {...note,shapeKind:["rect","ellipse","diamond","triangle"].includes(note.shapeKind)?note.shapeKind:"rect",fill:note.fill==="none"?"none":color(note.fill,"#ffffff"),strokeColor:color(note.strokeColor,"#777777"),strokeWidth:limit(Number(note.strokeWidth)||0,0,30),cornerRadius:limit(Number(note.cornerRadius)||0,0,10000)};
  }
  function renderShape(note,el) {
    el.querySelector(".shape-drawing")?.remove();
    const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),w=note.width,h=note.height,i=Math.min(note.strokeWidth/2,w/2,h/2);
    svg.classList.add("shape-drawing");svg.setAttribute("viewBox","0 0 "+w+" "+h);
    const kind=note.shapeKind,shape=document.createElementNS(ns,kind==="ellipse"?"ellipse":kind==="rect"?"rect":"polygon");
    const attrs=kind==="ellipse"?{cx:w/2,cy:h/2,rx:w/2-i,ry:h/2-i}:kind==="rect"?{x:i,y:i,width:w-2*i,height:h-2*i}:{points:kind==="diamond"?w/2+","+i+" "+(w-i)+","+h/2+" "+w/2+","+(h-i)+" "+i+","+h/2:w/2+","+i+" "+(w-i)+","+(h-i)+" "+i+","+(h-i)};
    if(kind==="rect") attrs.rx=Math.min(Math.max(0,Number(note.cornerRadius)||0),Math.max(0,w/2-i),Math.max(0,h/2-i));
    for(const [k,v] of Object.entries(attrs))shape.setAttribute(k,v);
    shape.setAttribute("fill",note.fill);shape.setAttribute("stroke",note.strokeColor);shape.setAttribute("stroke-width",note.strokeWidth);shape.setAttribute("stroke-linejoin","round");svg.append(shape);el.prepend(svg);
  }
  function createShape(point,width,height) {
    const note=normalizeShape({id:crypto.randomUUID(),type:"shape",x:point.x,y:point.y,width,height,scale:1,tilt:0,shapeKind,fill:"none",strokeColor:"#777777",strokeWidth:2});
    notes.push(note);addElement(note);setTool("select");selectNote(note);save();
  }
  function createTable(point, width = 480, height = 180) {
    width = Math.max(3 * minTableColumn, width); height = Math.max(3 * minTableRow, height);
    const note = normalizeTable({ id:crypto.randomUUID(), type:tool === "records" ? "record-table" : "table", x:point.x, y:point.y, tilt:0, scale:1,
      table:{ columns:Array(3).fill(width/3), rows:Array(3).fill(height/3), cells:Array.from({length:3},()=>["","",""]), borderColor:"#b7bec6", borderWidth:1 } });
    notes.push(note); addElement(note); setTool("select"); selectNote(note); save();
  }
  function createText(point, width) {
    const note = {
      id: crypto.randomUUID(), type: "text", text: "", x: point.x, y: point.y, tilt: 0,
      width, height: 0, fontSize: defaultTextSize, font: textFonts[0], align: "left", ink: "#1c1c1c"
    };
    notes.push(note);
    addElement(note);
    setTool("select");
    editNote(note);
    
    save();
  }
  function createRpg(point) {
    const scale = Math.min(1, Math.max(.35, (canvas.clientHeight - 150) / (860 * camera.scale)));
    const note = { id: crypto.randomUUID(), type: "rpg", text: "", tilt: 0,
      x: point.x - 540 * scale, y: point.y - 430 * scale, width: 1080, height: 860, scale, tracker: RpgTracker.normalize({ name: "Персонаж" }) };
    notes.push(note); addElement(note); notes.filter(isCounter).forEach(n => counterRefresh.get(n.id)?.()); setTool("select"); selectNote(note); save();
  }
  function createCounter(point, preset = "custom") {
    const scale = Math.min(1, Math.max(.35, (canvas.clientHeight - 150) / (600 * camera.scale)));
    const character = notes.find(n => isRpg(n));
    const note = { id: crypto.randomUUID(), type: "counter", x: point.x - 260 * scale, y: point.y - 300 * scale, width: 520, height: 600, scale, tilt: 0, counter: CounterWidget.create(preset, character?.id || "") };
    notes.push(note); addElement(note); setTool("select"); selectNote(note); save();
  }
  function createWallet(point) {
    const note = normalizeWallet({
      id: crypto.randomUUID(), type: "wallet", text: "", title: "Кошелёк",
      x: point.x - walletWidth / 2, y: point.y - walletHeight / 2, tilt: 0,
      width: walletWidth, height: walletHeight, rates: defaultWalletRates,
      autoConvert: true, transactions: []
    });
    notes.push(note);
    const el = addElement(note);
    setTool("select");
    selectNote(note);
    el.focus({ preventScroll: true });
    
    save();
  }
  function askDelete(title, message, action) {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-message").textContent = message;
    dialog.querySelector("[data-confirm-accept]").textContent = action;
    return new Promise(resolve => {
      const cancel = () => { cleanup(); dialog.close(); resolve(false); };
      const accept = () => { cleanup(); dialog.close(); resolve(true); };
      const cleanup = () => { dialog.querySelector("[data-confirm-cancel]").removeEventListener("click",cancel); dialog.querySelector("[data-confirm-accept]").removeEventListener("click",accept); dialog.removeEventListener("cancel",cancel); };
      dialog.querySelector("[data-confirm-cancel]").addEventListener("click",cancel);
      dialog.querySelector("[data-confirm-accept]").addEventListener("click",accept);
      dialog.addEventListener("cancel",cancel,{once:true});
      dialog.showModal();
    });
  }
  async function removeNote() {
    if (selection.size > 1) { removeGroupSelection(); return; }
    if (!selected || selected.locked || editor) return;
    const target = selected;
    if (isWallet(target) && !await askDelete("Удалить кошелёк?","Все операции, баланс и настройки этого кошелька будут удалены. Восстановить их будет невозможно.","Удалить кошелёк")) return;
    if (isRpg(target) && !await askDelete("Удалить лист персонажа?","Навыки, ресурсы и история действий будут удалены.","Удалить лист")) return;
    if (isCounter(target) && !await askDelete("Удалить счётчик?","Все его блоки и значения будут удалены.","Удалить счётчик")) return;
    if (isFlipCard(target) && !await askDelete("Удалить флип-карточку?","Текст и картинки обеих сторон будут удалены с доски.","Удалить карточку")) return;
    if (isTable(target) && !await askDelete("Удалить таблицу?","Все строки, столбцы и данные в ячейках будут удалены.","Удалить таблицу")) return;
    if (selected !== target) return;
    const { id } = selected;
    selectNote(null);
    noteElements.get(id).remove();
    noteElements.delete(id);
    notes = notes.filter(n => n.id !== id);
    
    save();
  }
  for (const [color, [hex, label]] of Object.entries(papers)) {
    const btn = document.createElement("button");
    btn.className = "swatch";
    btn.dataset.color = color;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.style.setProperty("--paper", hex);
    btn.innerHTML = icon("check");
    btn.addEventListener("click", () => {
      if (!selected) return;
      if (isSticky(selected) && selected.flipped) selected.back.color = color; else preferredColor = selected.color = color;
      noteElements.get(selected.id).style.setProperty("--paper", hex);
      placePalette();
      save();
    });
    palette.append(btn);
  }
  const remove = document.createElement("button");
  remove.id = "remove";
  remove.title = "Удалить стикер";
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = icon("bin");
  remove.addEventListener("click", removeNote);
  palette.append(remove);
  for (const bar of [palette, textToolbar, walletToolbar]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lock-element";
    button.addEventListener("click", () => {
      if (!selected) return;
      finishEdit();
      selected.locked = !selected.locked;
      const el = noteElements.get(selected.id);
      applyLockState(selected, el);
      $("wallet-appearance").open = false;
      syncLockControls();
      el.focus({ preventScroll: true });
      placePalette();
      save();
    });
    bar.append(button);
    for (const [direction, label] of [
      ["down", "На слой ниже"], ["up", "На слой выше"],
      ["back", "На задний план"], ["front", "На передний план"]
    ]) {
      const layerButton = document.createElement("button");
      layerButton.type = "button";
      layerButton.className = "layer-element";
      layerButton.title = label;
      layerButton.setAttribute("aria-label", label);
      layerButton.innerHTML = layerIcon(direction);
      layerButton.addEventListener("mousedown", event => event.preventDefault());
      layerButton.addEventListener("click", () => changeLayer(direction));
      bar.append(layerButton);
    }
  }
  syncLockControls();

  function formatSelected(changes) {
    if (!isText(selected) || selected.locked) return;
    Object.assign(selected, changes);
    applyTextFormat(selected, noteElements.get(selected.id));
    syncTextControls(selected);
    placePalette();
    save();
  }
  textToolbar.addEventListener("mousedown", event => {
    if (event.target.closest("button")) event.preventDefault();
  });
  textToolbar.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !isText(selected)) return;
    const { style, align } = button.dataset;
    if (style) formatSelected({ [style]: !selected[style] });
    if (align) formatSelected({ align });
  });
  $("text-font").onchange = event => formatSelected({ font: event.target.value });
  $("text-size").onchange = event => {
    const size = event.target.valueAsNumber;
    if (Number.isFinite(size)) formatSelected({ fontSize: Math.max(1, Math.round(size)) });
    else if (isText(selected)) syncTextControls(selected);
  };
  $("text-ink").oninput = event => formatSelected({ ink: event.target.value });
  $("remove-text").onclick = () => { finishEdit(); removeNote(); };

  function setHelp(open) {
    $("help-panel").hidden = !open;
    $("help").setAttribute("aria-expanded", String(open));
  }
  $("select-tool").onclick = () => setTool("select");
  $("note-tool").onclick = () => setTool("note");
  $("flip-tool").onclick = () => setTool("flipcard");
  $("shape-tool").onclick=()=>{$("shape-picker").hidden=!$("shape-picker").hidden;};
  document.addEventListener("pointerdown",event=>{if(!event.target.closest("#shape-picker,#shape-tool"))$("shape-picker").hidden=true;});
  $("shape-picker").onclick=event=>{const btn=event.target.closest("[data-shape]");if(!btn)return;shapeKind=btn.dataset.shape;$("shape-picker").hidden=true;setTool("shape");};
  $("shape-controls").addEventListener("input",()=>{
    if(!isShape(selected)||selected.locked)return;
    selected.shapeKind=$("shape-kind").value;selected.fill=$("shape-transparent").checked?"none":$("shape-fill").value;
    selected.strokeColor=$("shape-stroke").value;selected.strokeWidth=limit(Number($("shape-width").value)||0,0,30);
    selected.cornerRadius=limit(Number($("shape-radius").value)||0,0,10000);
    $("shape-radius-control").hidden=selected.shapeKind!=="rect";
    renderShape(selected,noteElements.get(selected.id));saveSoon();
  });
  $("text-tool").onclick = () => setTool("text");
  $("table-tool").onclick = () => setTool("table");
  $("records-tool").onclick = () => setTool("records");
  $("rpg-tool").onclick = () => setTool("rpg");
  $("counter-tool").onclick = () => setTool("counter");
  $("table-controls").addEventListener("click", event => {
    const action = event.target.closest("button[data-table-action]")?.dataset.tableAction;
    if (!action || !isTable(selected)) return;
    if (action === "delete-table") { $("table-more").open = false; removeNote(); return; }
    editTableStructure(selected, action, action.includes("col") ? selected.table.activeCol ?? selected.table.columns.length-1 : selected.table.activeRow ?? selected.table.rows.length-1);
    $("table-more").open = false;
  });
  $("table-border-color").oninput = event => {
    if (!isTable(selected)) return;
    selected.table.borderColor = event.target.value;
    noteElements.get(selected.id).querySelector(".table-grid").style.setProperty("--table-border-color", event.target.value);
    saveSoon();
  };
  $("table-border-width").oninput = event => {
    if (!isTable(selected)) return;
    const width = Number(event.target.value);
    if (!Number.isFinite(width) || width <= 0) return;
    selected.table.borderWidth = limit(width, .5, 12);
    noteElements.get(selected.id).querySelector(".table-grid").style.setProperty("--table-border-width", selected.table.borderWidth + "px");
    saveSoon();
  };
  $("table-border-width").onchange = event => {
    if (!isTable(selected)) return;
    event.target.value = selected.table.borderWidth;
    save();
  };
  $("image-mask").addEventListener("click", event => {
    const shape = event.target.closest("button[data-image-mask]")?.dataset.imageMask;
    if (!shape || !isImage(selected)) return;
    $("image-mask").open = false;
    if (shape === "custom") startImageCrop(selected);
    else applyImageMask(selected,shape);
  });
  $("image-crop-apply").onclick = () => closeImageCrop(true);
  $("image-crop-cancel").onclick = () => closeImageCrop(false);
  for (const id of ["image-stroke-color","image-stroke-width","image-stroke-radius","image-stroke-opacity","image-stroke-style"]) {
    $(id).addEventListener("input", () => {
      if (!isImage(selected)) return;
      const stroke = imageStroke(selected);
      stroke.color = $("image-stroke-color").value;
      stroke.width = limit(Number($("image-stroke-width").value) || 0,0,30);
      stroke.radius = limit(Number($("image-stroke-radius").value) || 0,0,200);
      stroke.opacity = limit(Number($("image-stroke-opacity").value)/100,.05,1);
      stroke.style = $("image-stroke-style").value;
      selected.stroke = stroke;
      renderImageStyle(selected,noteElements.get(selected.id)); saveSoon();
    });
    $(id).addEventListener("change", () => { if (isImage(selected)) save(); });
  }
  $("wallet-tool").onclick = () => setTool("wallet");
  const flipColors = $("flip-colors");
  for (const [key,[hex,label]] of Object.entries(papers)) {
    const swatch = document.createElement("button");
    swatch.type = "button"; swatch.className = "flip-swatch"; swatch.dataset.color = key;
    swatch.title = label; swatch.setAttribute("aria-label", label); swatch.style.setProperty("--paper",hex);
    swatch.onclick = () => {
      if (!isFlipCard(selected)) return;
      (selected.flipped ? selected.back : selected.front).color = key;
      renderFlipCard(selected,noteElements.get(selected.id)); save();
    };
    flipColors.append(swatch);
  }
  function syncFlipControls(note) {
    const color = (note.flipped ? note.back : note.front).color;
    flipColors.querySelectorAll(".flip-swatch").forEach(button => button.setAttribute("aria-pressed",String(button.dataset.color === color)));
    $("flip-orientation").textContent = note.width > note.height ? "▯" : "▭";
    $("flip-image-remove").disabled = !(note.flipped ? note.back : note.front).assetId;
  }
  $("flip-orientation").onclick = () => {
    if (!isFlipCard(selected)) return;
    [selected.width,selected.height] = [selected.height,selected.width];
    positionNote(selected,noteElements.get(selected.id)); renderFlipCard(selected,noteElements.get(selected.id)); drawTextSelection(); placePalette(); save();
  };
  $("flip-toolbar-button").onclick = () => {
    if (!isFlipCard(selected)) return;
    flipCard(selected,noteElements.get(selected.id));
  };
  $("flip-image-remove").onclick = () => {
    if (!isFlipCard(selected)) return;
    (selected.flipped ? selected.back : selected.front).assetId = null;
    renderFlipCard(selected,noteElements.get(selected.id)); save();
  };
  let flipImageTarget = null;
  $("flip-image-upload").onclick = () => { if (!isFlipCard(selected)) return; flipImageTarget = {note:selected,flipped:selected.flipped}; $("flip-image-file").value = ""; $("flip-image-file").click(); };
  $("flip-image-file").onchange = async event => {
    const file = event.target.files?.[0], target = flipImageTarget;
    if (!file || !target || !file.type.startsWith("image/")) return;
    try {
      const db = await imageStore(), id = crypto.randomUUID();
      await new Promise((resolve,reject) => { const tx=db.transaction("images","readwrite");tx.objectStore("images").put(file,id);tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error); });
      (target.flipped ? target.note.back : target.note.front).assetId = id;
      if (noteElements.has(target.note.id)) renderFlipCard(target.note,noteElements.get(target.note.id));
      save();
    } catch { window.alert("Не удалось сохранить картинку."); }
  };
  $("remove-wallet").onclick = removeNote;
  $("wallet-color").oninput = event => {
    if (!isWallet(selected)) return;
    selected.color = event.target.value;
    noteElements.get(selected.id).style.setProperty("--wallet-color", selected.color);
    saveSoon();
  };
  $("minus").onclick = () => zoomCenter(camera.scale / 1.25);
  $("plus").onclick = () => zoomCenter(camera.scale * 1.25);
  zoomInput.onfocus = () => zoomInput.select();
  zoomInput.oninput = () => { zoomEdited = true; };
  zoomInput.onblur = () => {
    if (zoomEdited) {
      const match = zoomInput.value.trim().match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*%?$/);
      if (match) zoomCenter(Number(match[1].replace(",", ".")) / 100);
    }
    zoomEdited = false;
    zoomInput.value = zoomLabel();
  };
  zoomInput.onkeydown = event => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    if (event.key === "Escape") zoomEdited = false;
    zoomInput.blur();
  };
  zoomInput.ondblclick = () => {
    zoomEdited = false;
    zoomCenter(1);
    zoomInput.blur();
  };
  $("fit").onclick = () => { fit(); save(); };
  $("help").onclick = () => setHelp($("help-panel").hidden);
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest("#help, #help-panel")) setHelp(false);
    if (editor && event.target !== editor.field && !event.target.closest("#text-toolbar")) finishEdit();
  }, true);
  canvas.addEventListener("contextmenu", event => {
    if (event.target.closest("input,select,textarea,.rpg-modal,.wallet-entry,.wallet-rates")) return;
    event.preventDefault();
    const el = event.target.closest(".note");
    const note = el && notes.find(n => n.id === el.dataset.id);
    if (note && !selection.has(note.id)) selectNote(note);
    if (!note && !selection.size) selectNote(null);
    contextPoint = localPoint(event.clientX, event.clientY);
    const menu = $("context-menu");
    menu.hidden = false;
    menu.style.left = Math.min(event.clientX, innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(event.clientY, innerHeight - menu.offsetHeight - 8) + "px";
    menu.querySelectorAll("button[data-action]").forEach(button => {
      const action = button.dataset.action;
      button.disabled = action !== "paste" && !selection.size || ["cut", "delete"].includes(action) && notes.some(n => selection.has(n.id) && n.locked) || ["layerUp", "layerDown", "layerFront", "layerBack"].includes(action) && notes.some(n => selection.has(n.id) && n.locked);
    });
  });
  const contextMenu = $("context-menu");
  for (const [action,direction] of [["layerDown","down"],["layerUp","up"],["layerBack","back"],["layerFront","front"]]) {
    contextMenu.querySelector(`[data-action="${action}"]`).innerHTML = layerIcon(direction);
  }
  function closeContextMenu() { contextMenu.hidden = true; }
  function readBoardClipboard(text) {
    if (!text?.startsWith(boardClipboardPrefix)) return null;
    try {
      const data = JSON.parse(text.slice(boardClipboardPrefix.length));
      const items = Array.isArray(data) ? data : data?.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 100 || !items.every(n =>
        validNote(n) && [undefined,"text","wallet","image","rpg","counter","flipcard","table","shape"].includes(n.type))) return null;
      const bounds = Array.isArray(data?.bounds) && data.bounds.length === items.length && data.bounds.every(b =>
        b && [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width >= 0 && b.height >= 0) ? data.bounds : null;
      return {items,bounds};
    } catch { return null; }
  }
  function copySelection(cut = false, clipboardData = null) {
    const chosen = notes.filter(n => selection.has(n.id));
    if (!chosen.length || cut && chosen.some(n => n.locked)) return false;
    copiedItems = JSON.parse(JSON.stringify(chosen));
    copiedBounds = chosen.map(itemBounds);
    const payload = boardClipboardPrefix + JSON.stringify({items:copiedItems,bounds:copiedBounds});
    if (clipboardData) clipboardData.setData("text/plain", payload);
    else writeBoardClipboard(payload);
    if (cut) removeGroupSelection();
    closeContextMenu();
    return true;
  }
  async function writeBoardClipboard(payload) {
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(payload); return; } }
    catch { /* Use a selected temporary field when clipboard access is restricted. */ }
    const field = document.createElement("textarea");
    field.value = payload; field.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(field); field.select(); document.execCommand("copy"); field.remove();
  }
  function pasteSelection(point = lastPointerWorld || localPoint(viewport.left + viewport.width / 2, viewport.top + viewport.height / 2)) {
    if (!copiedItems?.length) return;
    finishEdit();
    const map = new Map(copiedItems.map(n => [n.id, crypto.randomUUID()]));
    const groupMap = new Map(copiedItems.filter(n => n.groupId).map(n => [n.groupId, crypto.randomUUID()]));
    const bounds = copiedBounds?.length === copiedItems.length ? copiedBounds : copiedItems.map(item => {
      if (noteElements.has(item.id)) return itemBounds(item);
      if (isScalable(item)) return {x:item.x,y:item.y,width:item.width*item.scale,height:item.height*item.scale};
      return {x:item.x,y:item.y,width:isText(item) ? item.width : item.size,height:isText(item) ? item.height : item.size};
    });
    const minX = Math.min(...bounds.map(b => b.x)), minY = Math.min(...bounds.map(b => b.y));
    const maxX = Math.max(...bounds.map(b => b.x+b.width)), maxY = Math.max(...bounds.map(b => b.y+b.height));
    const shiftX = point.x - (minX+maxX)/2, shiftY = point.y - (minY+maxY)/2;
    const copies = copiedItems.map(item => ({ ...JSON.parse(JSON.stringify(item)), id:map.get(item.id), x:item.x+shiftX, y:item.y+shiftY, groupId:item.groupId ? groupMap.get(item.groupId) : undefined }));
    notes.push(...copies); copies.forEach(addElement); applyStackOrder(); selectNote(copies[0]);
    for (const copy of copies.slice(1)) if (!selection.has(copy.id)) selectNote(copy, true);
    closeContextMenu(); save();
  }
  async function pasteFromContextMenu() {
    const point = contextPoint || lastPointerWorld || localPoint(viewport.left + viewport.width/2,viewport.top + viewport.height/2);
    try {
      const data = await navigator.clipboard.read();
      for (const item of data) {
        const textType = item.types.find(type => type === "text/plain");
        if (textType) {
          const parsed = readBoardClipboard(await (await item.getType(textType)).text());
          if (parsed) { copiedItems = parsed.items; copiedBounds = parsed.bounds; pasteSelection(point); return; }
        }
        const imageType = item.types.find(type => type.startsWith("image/"));
        if (imageType) { const blob = await item.getType(imageType); addImages([new File([blob],"Вставленное изображение",{type:imageType})],point); return; }
      }
      return;
    } catch { /* Clipboard access may be unavailable in a local WebView. */ }
    if (copiedItems?.length) pasteSelection(point);
  }
  function undoBoard() {
    finishEdit(); clearTimeout(saveTimer);
    const previous = undoStack.pop();
    if (!previous) return;
    try { localStorage.setItem(storageKey, previous); location.reload(); }
    catch { undoStack.push(previous); saved.classList.add("unsaved"); saved.title = "Не удалось отменить действие"; }
  }
  contextMenu.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]"); if (!button || button.disabled) return;
    const action = button.dataset.action; closeContextMenu();
    if (action === "copy") copySelection();
    else if (action === "cut") copySelection(true);
    else if (action === "paste") pasteFromContextMenu();
    else if (action === "delete") selection.size > 1 ? removeGroupSelection() : removeNote();
    else if (action.startsWith("layer")) changeLayer(({layerUp:"up",layerDown:"down",layerFront:"front",layerBack:"back"})[action]);
  });
  document.addEventListener("pointerdown", event => { if (!contextMenu.contains(event.target)) closeContextMenu(); });
  window.addEventListener("resize", closeContextMenu);
  canvas.addEventListener("wheel", event => {
    if (event.target.closest("#group-toolbar,#text-toolbar") || (event.target.closest("textarea") && !event.ctrlKey)) return;
    event.preventDefault();
    if (gesture?.action === "resize" || gesture?.action === "groupResize") return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
    zoomAt(camera.scale * Math.exp(-delta * .0015), event.clientX, event.clientY);
  }, { passive: false });
  canvas.addEventListener("pointerdown", event => {
    if (event.target.closest("#group-toolbar,#group-box,#palette,#text-toolbar,#wallet-toolbar,textarea") || gesture || !event.isPrimary) return;
    const pan = event.button === 1 || (spaceHeld && event.button === 0);
    if (!pan && event.button !== 0) return;
    if (pan) {
      gesture = { action: "pan", pointer: event.pointerId, mouseX: event.clientX, mouseY: event.clientY,
        x: camera.x, y: camera.y, startPoint: localPoint(event.clientX, event.clientY), note: null, target: canvas, moving: false };
      canvas.classList.add("panning");
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.target.closest(".wallet-interactive")) {
      const walletEl = event.target.closest(".wallet-card,.rpg-card");
      const wallet = walletEl && notes.find(item => item.id === walletEl.dataset.id);
      if (wallet && selected !== wallet) selectNote(wallet);
      return;
    }
    const el = event.target.closest(".note");
    const note = el && notes.find(n => n.id === el.dataset.id);
    if (event.shiftKey && note && !pan && tool === "select") {
      finishEdit(); selectNote(note, true); event.preventDefault(); return;
    }
    if (note?.locked && !pan) {
      selectNote(note);
      event.preventDefault();
      return;
    }
    const handle = event.target.closest(".resize-handle");
    const action = pan ? "pan" : tool === "text" ? "createText" : (tool === "table" || tool === "records") ? "createTable" : tool === "rpg" ? "createRpg" : tool === "wallet" ? "createWallet" : tool === "counter" ? "createCounter" : tool === "flipcard" ? "createFlipCard" : tool === "shape" ? "createShape" : tool === "note" ? "create" : handle ? "resize" : note ? "drag" : "background";
    if (action === "drag" && !selection.has(note.id)) selectNote(note);
    if (action === "drag" && notes.some(n => selection.has(n.id) && n.locked)) return;
    const baseSelection = event.shiftKey ? [...selection] : [];
    if (action === "background") selectNote(null);
    const target = action === "resize" ? handle : el || canvas;
    gesture = { action, pointer: event.pointerId, mouseX: event.clientX, mouseY: event.clientY,
      x: pan || !note ? camera.x : note.x, y: pan || !note ? camera.y : note.y,
      startPoint: localPoint(event.clientX, event.clientY), note, target, moving: false };
    gesture.baseSelection = baseSelection;
    if (action === "drag" && selection.size > 1) gesture.members = snapshotSelection();
    if (action === "resize" && isScalable(note)) {
      gesture.corner = handle.dataset.corner || handle.dataset.edge;
      gesture.startScale = note.scale;
      gesture.startWidth=note.width;gesture.startHeight=note.height;
      if (isTable(note)) { gesture.tableColumns = [...note.table.columns]; gesture.tableRows = [...note.table.rows]; document.activeElement?.blur(); }
      event.preventDefault();
    } else if (action === "resize" && isText(note)) {
      gesture.edge = handle.dataset.edge || handle.dataset.corner;
      gesture.startWidth = note.width;
      gesture.startHeight = el.getBoundingClientRect().height / camera.scale;
      gesture.startFontSize = note.fontSize;
      event.preventDefault();
    } else if (action === "resize") {
      const corner = handle.dataset.corner;
      const sx = corner.endsWith("e") ? 1 : -1;
      const sy = corner.startsWith("s") ? 1 : -1;
      const angle = note.tilt * Math.PI / 180;
      gesture.axisX = sx * Math.cos(angle) - sy * Math.sin(angle);
      gesture.axisY = sx * Math.sin(angle) + sy * Math.cos(angle);
      gesture.startSize = note.size;
      event.preventDefault();
    }
    target.setPointerCapture(event.pointerId);
    if (action === "pan") canvas.classList.add("panning");
  });
  canvas.addEventListener("pointermove", event => {
    lastPointerWorld = localPoint(event.clientX, event.clientY);
    if (!gesture || gesture.pointer !== event.pointerId) return;
    pendingMove = event;
    requestDraw();
  });
  function moveGesture(event) {
    const g = gesture;
    const dx = event.clientX - g.mouseX, dy = event.clientY - g.mouseY;
    const panning = g.action === "pan" || (g.action === "background" && event.pointerType === "touch");
    const distance = Math.hypot(dx, dy);
    if (!g.moving && (distance === 0 || (!panning && g.action !== "drag" && distance < 3))) return;
    if (!g.moving) {
      g.moving = true;
      textToolbar.hidden = walletToolbar.hidden = palette.hidden = true;
      if (g.action === "drag") g.target.classList.add("dragging");
    }
    if (panning) {
      camera.x = event.clientX - viewport.left - g.startPoint.x * camera.scale;
      camera.y = event.clientY - viewport.top - g.startPoint.y * camera.scale;
      cameraDirty = true;
    } else if (g.action === "groupResize") {
      previewGroupResize(g, dx / camera.scale, dy / camera.scale);
    } else if (g.action === "background") {
      const start = g.startPoint, end = localPoint(event.clientX, event.clientY);
      const box = { x:Math.min(start.x,end.x), y:Math.min(start.y,end.y), width:Math.abs(end.x-start.x), height:Math.abs(end.y-start.y) };
      marquee.hidden = false;
      placeScreenBox(marquee, box);
      const found = notes.filter(n => { const b = itemBounds(n); return b.x >= box.x && b.y >= box.y && b.x+b.width <= box.x+box.width && b.y+b.height <= box.y+box.height; });
      selection = new Set(g.baseSelection);
      for (const n of found) for (const member of notes.filter(m => m.id === n.id || (n.groupId && m.groupId === n.groupId))) selection.add(member.id);
      selected = notes.find(n => selection.has(n.id)) || null;
      notes.forEach(n => noteElements.get(n.id).classList.toggle("selected", selection.has(n.id)));
    } else if (g.action === "createTable" || g.action === "createShape") {
      textOutline.hidden = false;
      textOutline.style.transform = translate(Math.min(g.mouseX, event.clientX) - viewport.left, Math.min(g.mouseY, event.clientY) - viewport.top);
      textOutline.style.width = Math.max((g.action === "createShape" ? 20 : 3 * minTableColumn) * camera.scale, Math.abs(dx)) + "px";
      textOutline.style.height = Math.max((g.action === "createShape" ? 20 : 3 * minTableRow) * camera.scale, Math.abs(dy)) + "px";
    } else if (g.action === "createText") {
      textOutline.hidden = false;
      textOutline.style.transform = translate(Math.min(g.mouseX, event.clientX) - viewport.left, g.mouseY - viewport.top);
      textOutline.style.width = Math.max(minTextWidth * camera.scale, Math.abs(dx)) + "px";
      textOutline.style.height = defaultTextSize * 1.36 * camera.scale + "px";
    } else if (g.action === "resize" && isTable(g.note) && g.corner.length === 1) {
      resizeTableEdge(g, dx, dy);
    } else if (g.action === "resize" && isShape(g.note)) {
      const n=g.note,e=g.corner,w=e.includes("w"),t=e.includes("n"),k=camera.scale*g.startScale;
      if(w||e.includes("e"))n.width=Math.max(20,g.startWidth+dx/k*(w?-1:1));
      if(t||e.includes("s"))n.height=Math.max(20,g.startHeight+dy/k*(t?-1:1));
      n.x=g.x+(w?(g.startWidth-n.width)*n.scale:0);n.y=g.y+(t?(g.startHeight-n.height)*n.scale:0);
      const el=noteElements.get(n.id);positionNote(n,el);renderShape(n,el);
    } else if (g.action === "resize" && isScalable(g.note)) {
      const note = g.note;
      const west = g.corner.includes("w"), north = g.corner.includes("n");
      const sx = dx / camera.scale * (west ? -1 : 1), sy = dy / camera.scale * (north ? -1 : 1);
      const delta = g.corner.length === 1 ? (g.corner === "n" || g.corner === "s" ? sy / note.height : sx / note.width) : (sx * note.width + sy * note.height) / (note.width ** 2 + note.height ** 2);
      note.scale = limit(g.startScale + delta, isImage(note) || isTable(note) ? .05 : .35, isTable(note) ? 20 : isImage(note) ? 10 : 3);
      note.x = g.x + (west ? note.width * (g.startScale - note.scale) : 0);
      note.y = g.y + (north ? note.height * (g.startScale - note.scale) : 0);
      moveNote(note, noteElements.get(note.id));
    } else if (g.action === "resize" && isText(g.note)) {
      const note = g.note;
      const el = noteElements.get(note.id);
      const west = g.edge.includes("w"), north = g.edge.includes("n");
      const horizontal = west || g.edge.includes("e");
      const vertical = north || g.edge.includes("s");
      if (horizontal && vertical) {
        const signedX = dx / camera.scale * (west ? -1 : 1);
        const signedY = dy / camera.scale * (north ? -1 : 1);
        const scale = Math.max(minTextWidth / g.startWidth,
          1 + (signedX * g.startWidth + signedY * g.startHeight) /
          (g.startWidth * g.startWidth + g.startHeight * g.startHeight));
        g.resizeScale = scale;
        el.style.transformOrigin = (west ? "100%" : "0%") + " " + (north ? "100%" : "0%");
        el.style.setProperty("--handle-scale", 1 / (camera.scale * scale));
        el.style.transform = translate(g.x, g.y) + " scale(" + scale + ")";
      } else {
        if (horizontal) {
          note.width = Math.max(minTextWidth, g.startWidth + dx / camera.scale * (west ? -1 : 1));
          if (west) note.x = g.x + g.startWidth - note.width;
        }
        if (vertical) {
          note.height = Math.max(0, g.startHeight + dy / camera.scale * (north ? -1 : 1));
        }
        positionNote(note, el);
        if (north) {
          note.y = g.y + g.startHeight - el.getBoundingClientRect().height / camera.scale;
          moveNote(note, el);
        }
      }
    } else if (g.action === "resize") {
      // Project the mouse movement onto this diagonal in board coordinates.
      const delta = (dx * g.axisX + dy * g.axisY) / (2 * camera.scale);
      const size = Math.max(minSize, g.startSize + delta);
      const halfChange = (size - g.startSize) / 2;
      g.note.size = size;
      g.note.x = g.x + halfChange * (g.axisX - 1);
      g.note.y = g.y + halfChange * (g.axisY - 1);
      positionNote(g.note, noteElements.get(g.note.id));
    } else if (g.action === "drag" && g.members) {
      for (const original of g.members) {
        const n = original.note;
        n.x = original.x + dx / camera.scale; n.y = original.y + dy / camera.scale;
        moveNote(n, noteElements.get(n.id));
      }
    } else if (g.action === "drag") {
      const point = localPoint(event.clientX, event.clientY);
      g.note.x = g.x + (point.x - g.startPoint.x);
      g.note.y = g.y + (point.y - g.startPoint.y);
      moveNote(g.note, g.target);
    }
    drawTextSelection();
  }
  function endGesture(event) {
    if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.pointer)) return;
    // A release can arrive before the scheduled frame or beyond the last move.
    if (event.type === "pointerup") pendingMove = event;
    if (frameId !== null) cancelAnimationFrame(frameId);
    drawFrame();
    const g = gesture;
    gesture = null;
    marquee.hidden = true;
    if (g.action === "groupResize") commitGroupResize(g);
    if (g.action === "background" && g.moving) {
      const picked = notes.filter(n => selection.has(n.id));
      selectNote(null);
      for (const n of picked) if (!selection.has(n.id)) selectNote(n, true);
    }
    syncLockControls();
    if (g.action === "resize" && isText(g.note) && g.resizeScale !== undefined) {
      const note = g.note;
      const el = noteElements.get(note.id);
      const west = g.edge.includes("w"), north = g.edge.includes("n");
      note.width = g.startWidth * g.resizeScale;
      note.height = g.startHeight * g.resizeScale;
      note.fontSize = Math.max(1, g.startFontSize * g.resizeScale);
      if (west) note.x = g.x + g.startWidth - note.width;
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("--handle-scale");
      applyTextFormat(note, el);
      positionNote(note, el);
      if (north) {
        note.y = g.y + g.startHeight - el.getBoundingClientRect().height / camera.scale;
        moveNote(note, el);
      }
    }
    if (g.target.hasPointerCapture(g.pointer)) g.target.releasePointerCapture(g.pointer);
    g.target.classList.remove("dragging");
    canvas.classList.remove("panning");
    textOutline.hidden = true;
    if (event.type === "pointerup" && g.action === "createText") {
      const start = localPoint(g.mouseX, g.mouseY);
      const end = localPoint(event.clientX, event.clientY);
      const dragged = Math.abs(event.clientX - g.mouseX) >= 4;
      const width = dragged ? Math.max(minTextWidth, Math.abs(end.x - start.x)) :
        Math.min(defaultTextWidth, Math.max(minTextWidth, (canvas.clientWidth - 64) / camera.scale));
      createText({ x: dragged ? Math.min(start.x, end.x) : start.x, y: start.y }, width);
    } else if (event.type === "pointerup" && g.action === "createTable") {
      const start = g.startPoint, end = localPoint(event.clientX, event.clientY);
      if (g.moving) createTable({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y)}, Math.abs(end.x-start.x), Math.abs(end.y-start.y));
      else createTable({x:start.x-240,y:start.y-90});
    } else if (event.type === "pointerup" && g.action === "create" && !g.moving) {
      createNote(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createRpg" && !g.moving) {
      createRpg(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createWallet" && !g.moving) {
      createWallet(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createCounter" && !g.moving) {
      createCounter(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createFlipCard" && !g.moving) {
      createFlipCard(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createShape") {
      const a=g.startPoint,b=localPoint(event.clientX,event.clientY);
      createShape(g.moving?{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)}:a,g.moving?Math.max(20,Math.abs(b.x-a.x)):240,g.moving?Math.max(20,Math.abs(b.y-a.y)):160);
    } else {
      if (event.type === "pointerup" && g.action === "drag" && g.moving && isImage(g.note) && !g.members && !g.note.groupId) {
        const dragged = noteElements.get(g.note.id);
        dragged.style.pointerEvents = "none";
        const targetCell=document.elementFromPoint(event.clientX,event.clientY)?.closest(".record-image-cell");
        if(targetCell){const tableEl=targetCell.closest(".note"),table=notes.find(n=>n.id===tableEl.dataset.id);if(table&&!table.locked){const r=Number(targetCell.dataset.row),c=Number(targetCell.dataset.col);table.table.images[r][c]=g.note.assetId;table.table.imageStyles??={};table.table.imageStyles[g.note.assetId]={mask:structuredClone(imageMask(g.note))};notes=notes.filter(n=>n.id!==g.note.id);dragged.remove();noteElements.delete(g.note.id);renderTable(table,tableEl);selectNote(table);save();return;}}
        const slot = document.elementFromPoint(event.clientX,event.clientY)?.closest(".flip-image-slot,.flip-card.without-image");
        dragged.style.pointerEvents = "";
        const cardEl = slot?.closest(".flip-card");
        const card = cardEl && notes.find(n => n.id === cardEl.dataset.id);
        if (card && !card.locked) {
          (card.flipped ? card.back : card.front).assetId = g.note.assetId;
          notes = notes.filter(n => n.id !== g.note.id);
          dragged.remove(); noteElements.delete(g.note.id);
          renderFlipCard(card,cardEl); selectNote(card); save(); return;
        }
      }
      if (g.moving && g.action === "resize" && isText(g.note)) syncTextControls(g.note);
      placePalette();
      if (g.moving) save();
    }
  }
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);
  canvas.addEventListener("lostpointercapture", endGesture);
  canvas.addEventListener("dblclick", event => {
    if (tool !== "select" || spaceHeld || event.button !== 0 || event.target.closest("textarea,#palette,#text-toolbar,#wallet-toolbar,.wallet-interactive,.resize-handle")) return;
    const el = event.target.closest(".note");
    if (!el) return;
    const note = notes.find(n => n.id === el.dataset.id);
    if (!note || isScalable(note)) return;
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const body = el.querySelector(".note-content");
    const offset = caret && caret.startContainer === body.firstChild ? caret.startOffset : cardText(note).length;
    editNote(note, offset);
  });
  function releaseSpace() {
    spaceHeld = false;
    canvas.classList.remove("pan-ready");
  }
  window.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.target.closest("#text-toolbar")) {
      if (event.key === "Escape") (editor?.field || noteElements.get(selected?.id))?.focus({ preventScroll: true });
      return;
    }
    if (event.target.matches("textarea,input,select,[contenteditable=true]")) {
      if (event.key === "Escape" && editor) {
        const el = editor.el;
        finishEdit();
        el.focus({ preventScroll: true });
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ["KeyC", "KeyX", "KeyV"].includes(event.code)) return;
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") { event.preventDefault(); undoBoard(); return; }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyG") { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space" && !event.target.closest("button")) {
      event.preventDefault();
      spaceHeld = true;
      canvas.classList.add("pan-ready");
    }
    if (event.repeat) return;
    if (event.key === "Escape") { setTool("select"); selectNote(null); }
    if (event.code === "KeyN") setTool("note");
    if (event.code === "KeyT") setTool("text");
    if (event.code === "KeyG") setTool("table");
    if (event.code === "KeyW") setTool("wallet");
    if (event.code === "KeyV") setTool("select");
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeNote(); }
    if (event.key === "Enter" && event.target.closest(".note")) {
      const note = notes.find(n => n.id === event.target.closest(".note").dataset.id);
      if (!note || isScalable(note)) return;
      event.preventDefault();
      editNote(note);
    }
  });
  window.addEventListener("keyup", event => { if (event.code === "Space") releaseSpace(); });
  window.addEventListener("blur", event => { releaseSpace(); endGesture(event); });
  window.addEventListener("pagehide", save);
  window.addEventListener("resize", () => {
    viewport = canvas.getBoundingClientRect();
    placePalette();
    saveSoon();
  });


  let imageDatabase;
  function imageStore() {
    if (!imageDatabase) imageDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open("listok.images.v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("images");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { imageDatabase = null; throw error; });
    return imageDatabase;
  }
  async function readImageAsset(id) {
    const db = await imageStore();
    return new Promise((resolve, reject) => {
      const request = db.transaction("images").objectStore("images").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function addImages(files, point) {
    const candidates = Array.from(files).filter(file => file.type.startsWith("image/"));
    let offset = 0;
    for (const file of candidates) {
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
        if (!img.naturalWidth || !img.naturalHeight) throw new Error("Размер изображения недоступен");
        const factor = Math.min(1, 480 / img.naturalWidth, 420 / img.naturalHeight);
        const width = img.naturalWidth * factor, height = img.naturalHeight * factor;
        const assetId = crypto.randomUUID();
        const db = await imageStore();
        await new Promise((resolve, reject) => {
          const tx = db.transaction("images", "readwrite");
          tx.objectStore("images").put(file, assetId);
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
        const note = { id: crypto.randomUUID(), type: "image", assetId, name: file.name || "Изображение", width, height, scale: 1, tilt: 0, x: point.x - width / 2 + offset, y: point.y - height / 2 + offset };
        notes.push(note);
        addElement(note);
        setTool("select");
        selectNote(note);
        
        save();
        offset += 24;
      } catch {
        window.alert("Не удалось добавить изображение «" + (file.name || "Изображение") + "». Проверьте формат файла и доступное место в браузере.");
      }
    }
  }
  const imageCenter = () => localPoint(viewport.left + viewport.width / 2, viewport.top + viewport.height / 2);
  $("image-tool").onclick = () => { $("image-file").value = ""; $("image-file").click(); };
  $("image-file").onchange = event => addImages(event.target.files, imageCenter());
  document.addEventListener("copy", event => {
    if (event.target.closest("input,textarea,[contenteditable=true]")) return;
    if (copySelection(false,event.clipboardData)) event.preventDefault();
  });
  document.addEventListener("cut", event => {
    if (event.target.closest("input,textarea,[contenteditable=true]")) return;
    if (copySelection(true,event.clipboardData)) event.preventDefault();
  });
  document.addEventListener("paste", event => {
    const boardItems = readBoardClipboard(event.clipboardData?.getData("text/plain"));
    if (event.target.closest("input,textarea,[contenteditable=true]")) {
      if (boardItems) {
        event.preventDefault();
        const plain = boardItems.items.map(note => isTable(note) ? note.table.cells.map(row => row.join("\t")).join("\n") : typeof note.text === "string" ? note.text : "").filter(Boolean).join("\n");
        const textField = event.target.matches("textarea,input[type=text],input[type=search],input[type=url],input[type=tel],input:not([type])");
        if (plain && textField) {
          event.target.setRangeText(plain,event.target.selectionStart,event.target.selectionEnd,"end");
          event.target.dispatchEvent(new Event("input",{bubbles:true}));
        } else if (plain && event.target.isContentEditable) document.execCommand("insertText",false,plain);
      }
      return;
    }
    if (boardItems) { event.preventDefault(); copiedItems = boardItems.items; copiedBounds = boardItems.bounds; pasteSelection(); return; }
    const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); addImages(files, lastPointerWorld || imageCenter()); }
    else if (!event.clipboardData && copiedItems?.length) { event.preventDefault(); pasteSelection(); }
  });
  canvas.addEventListener("dragover", event => {
    if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
  });
  canvas.addEventListener("drop", event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    viewport = canvas.getBoundingClientRect();
    addImages(event.dataTransfer.files, localPoint(event.clientX, event.clientY));
  });


  const groupBox = document.createElement("div");
  groupBox.id = "group-box"; groupBox.hidden = true;
  groupBox.innerHTML = ["nw","ne","sw","se"].map(c => `<span data-group-corner="${c}" class="group-handle ${c}"></span>`).join("");
  const groupToolbar = document.createElement("div"); groupToolbar.id = "group-toolbar"; groupToolbar.hidden = true;
  const marquee = document.createElement("div"); marquee.id = "selection-marquee"; marquee.hidden = true;
  canvas.append(groupBox, groupToolbar, marquee);
  for (const [label, action, direction] of [["Сгруппировать",groupSelection],["Разгруппировать",ungroupSelection],["На слой ниже",()=>changeLayer("down"),"down"],["На слой выше",()=>changeLayer("up"),"up"],["На задний план",()=>changeLayer("back"),"back"],["На передний план",()=>changeLayer("front"),"front"],["Удалить",removeGroupSelection]]) {
    const button = document.createElement("button");
    button.innerHTML = direction ? layerIcon(direction) : label;
    if (direction) { button.className = "layer-element"; button.title = label; button.setAttribute("aria-label",label); }
    button.onmousedown = e => e.preventDefault(); button.onclick = action; groupToolbar.append(button);
  }
  function itemBounds(note) {
    const b = noteElements.get(note.id).getBoundingClientRect();
    return { x:(b.left-viewport.left-camera.x)/camera.scale, y:(b.top-viewport.top-camera.y)/camera.scale, width:b.width/camera.scale, height:b.height/camera.scale };
  }
  function selectionBounds() {
    const boxes = notes.filter(n=>selection.has(n.id)).map(itemBounds);
    const x=Math.min(...boxes.map(b=>b.x)), y=Math.min(...boxes.map(b=>b.y));
    return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
  }
  function placeScreenBox(el,b) {
    el.style.transform=translate(camera.x+b.x*camera.scale,camera.y+b.y*camera.scale);
    el.style.width=b.width*camera.scale+"px"; el.style.height=b.height*camera.scale+"px";
  }
  function drawGroupSelection() {
    const multiple = selection.size > 1;
    canvas.classList.toggle("multi-selection",multiple);
    groupBox.hidden = groupToolbar.hidden = !multiple;
    if (!multiple) return;
    const b=selectionBounds(); placeScreenBox(groupBox,b);
    const locked=notes.some(n=>selection.has(n.id)&&n.locked);
    groupBox.classList.toggle("group-locked",locked);
    for(const button of groupToolbar.children) button.disabled=locked;
    groupToolbar.hidden=!!gesture?.moving;
    groupToolbar.style.transform=translate(limit(camera.x+b.x*camera.scale,6,Math.max(6,viewport.width-groupToolbar.offsetWidth-6)),limit(camera.y+b.y*camera.scale-48,6,viewport.height-48));
  }
  function groupSelection() {
    const members=notes.filter(n=>selection.has(n.id));
    if(members.length<2||members.some(n=>n.locked)) return;
    finishEdit(); const id=crypto.randomUUID(); members.forEach(n=>n.groupId=id); save(); placePalette();
  }
  function ungroupSelection() {
    const members=notes.filter(n=>selection.has(n.id));
    if(members.some(n=>n.locked)) return;
    members.forEach(n=>delete n.groupId); save(); placePalette();
  }
  function removeGroupSelection() {
    const members=notes.filter(n=>selection.has(n.id));
    if(!members.length||members.some(n=>n.locked)) return;
    if(members.some(n => isWallet(n) || isRpg(n) || isCounter(n) || isFlipCard(n))&&!confirm("Удалить выбранные элементы? Данные виджетов и карточек будут удалены.")) return;
    finishEdit(); const ids=new Set(selection); selectNote(null);
    for(const id of ids){ noteElements.get(id).remove(); noteElements.delete(id); }
    notes=notes.filter(n=>!ids.has(n.id)); applyStackOrder();  save();
  }
  function snapshotSelection() {
    return notes.filter(n=>selection.has(n.id)).map(note=>({note,x:note.x,y:note.y,width:note.width,height:isText(note)?noteElements.get(note.id).getBoundingClientRect().height/camera.scale:note.height,size:note.size,fontSize:note.fontSize,scale:note.scale}));
  }
  groupBox.addEventListener("pointerdown",event=>{
    const handle=event.target.closest("[data-group-corner]");
    if(!handle||gesture||event.button!==0||notes.some(n=>selection.has(n.id)&&n.locked)) return;
    event.preventDefault(); finishEdit();
    gesture={action:"groupResize",pointer:event.pointerId,mouseX:event.clientX,mouseY:event.clientY,target:handle,moving:false,corner:handle.dataset.groupCorner,bounds:selectionBounds(),members:snapshotSelection()};
    handle.setPointerCapture(event.pointerId);
  });
  function previewGroupResize(g,dx,dy) {
    const b=g.bounds, west=g.corner.includes("w"), north=g.corner.includes("n");
    const minFactor=Math.max(...g.members.map(m=>isScalable(m.note)?(isImage(m.note)||isTable(m.note)?.05:.35)/m.scale:isText(m.note)?Math.max(minTextWidth/m.width,1/m.fontSize):minSize/m.size));
    const maxFactor=Math.min(...g.members.map(m=>isScalable(m.note)?(isTable(m.note)?20:isImage(m.note)?10:3)/m.scale:Infinity));
    const k=limit(1+((west?-dx:dx)*b.width+(north?-dy:dy)*b.height)/(b.width*b.width+b.height*b.height),minFactor,maxFactor);
    g.factor=k;
    const ax=b.x+(west?b.width:0), ay=b.y+(north?b.height:0);
    for(const m of g.members){
      const el=noteElements.get(m.note.id);
      const x=ax+(m.x-ax)*k,y=ay+(m.y-ay)*k;
      el.style.transformOrigin="0 0";
      el.style.transform=translate(x,y)+" scale("+(isScalable(m.note)?m.scale*k:k)+") rotate(var(--tilt,0deg))";
    }
  }
  function commitGroupResize(g) {
    const k=g.factor||1,b=g.bounds,ax=b.x+(g.corner.includes("w")?b.width:0),ay=b.y+(g.corner.includes("n")?b.height:0);
    for(const m of g.members){
      const n=m.note,el=noteElements.get(n.id);
      n.x=ax+(m.x-ax)*k; n.y=ay+(m.y-ay)*k;
      if(isScalable(n)) n.scale=m.scale*k;
      else if(isText(n)){ n.width=m.width*k; n.height=m.height*k; n.fontSize=m.fontSize*k; applyTextFormat(n,el); }
      else n.size=m.size*k;
      el.style.removeProperty("transform-origin"); positionNote(n,el);
    }
  }

  function boardSnapshot(quiet = false) {
    if (!quiet) { document.activeElement?.blur(); finishEdit(); }
    return JSON.parse(JSON.stringify({ version: 1, notes:storedNotes(), camera, preferredColor, width: canvas.clientWidth, height: canvas.clientHeight }));
  }
  function validBackupBoard(data) {
    try {
      if (Array.isArray(data?.notes)) for (const note of data.notes) {
        if (isRpg(note)) RpgTracker.normalize(note.tracker);
        if (isWallet(note)) normalizeWallet(note);
        if (isCounter(note)) CounterWidget.normalize(note.counter);
      }
    } catch { return false; }
    return data && data.version === 1 && Array.isArray(data.notes) && data.notes.every(n =>
      validNote(n) && [undefined, "text", "wallet", "image", "rpg", "counter", "flipcard", "table", "record-table", "shape"].includes(n.type) &&
      (!isScalable(n) || (Number.isFinite(n.scale) && n.scale > 0 && Number.isFinite(n.width) && n.width > 0 && Number.isFinite(n.height) && n.height > 0)) &&
      (!isRpg(n) || (n.tracker && typeof n.tracker === "object" && Array.isArray(n.tracker.skills))) &&
      (!isCounter(n) || (n.counter && typeof n.counter === "object" && Array.isArray(n.counter.items))) &&
      new Set(data.notes.map(n => n.id)).size === data.notes.length &&
      data.camera && [data.camera.x, data.camera.y, data.camera.scale].every(Number.isFinite) &&
      data.camera.scale >= minZoom && data.camera.scale <= maxZoom);
  }
  async function restoreBackup({ board, images }) {
    // New keys keep existing assets intact if storage runs out before the board is committed.
    const remap = new Map([...images.keys()].map(id => [id, crypto.randomUUID()]));
    const data = JSON.parse(JSON.stringify(board));
    data.notes.forEach(n => { if (isImage(n)) n.assetId = remap.get(n.assetId); if (n.front?.assetId) n.front.assetId = remap.get(n.front.assetId); if (n.back?.assetId) n.back.assetId = remap.get(n.back.assetId); if(n.table?.images)n.table.images=n.table.images.map(row=>row.map(id=>id?remap.get(id):null));if(n.table?.imageStyles)n.table.imageStyles=Object.fromEntries(Object.entries(n.table.imageStyles).filter(([id])=>remap.has(id)).map(([id,style])=>[remap.get(id),style])); });
    let db;
    if (images.size) {
      db = await imageStore();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readwrite"), store = tx.objectStore("images");
        for (const [id, blob] of images) store.put(blob, remap.get(id));
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(new Error("Не хватило места для картинок или хранилище недоступно. Текущая доска не изменена."));
      });
    }
    document.activeElement?.blur(); finishEdit(); clearTimeout(saveTimer);
    try { localStorage.setItem(storageKey, JSON.stringify(data)); }
    catch {
      if (db) await new Promise(resolve => {
        const tx = db.transaction("images", "readwrite"), store = tx.objectStore("images");
        for (const id of remap.values()) store.delete(id);
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      });
      throw new Error("Хранилище браузера недоступно или переполнено. Текущая доска не заменена.");
    }
    restoringBackup = true;
    location.reload();
  }
  ListokBackup.mount({ snapshot: boardSnapshot, readAsset: readImageAsset, validateBoard: validBackupBoard, restoreBoard: restoreBackup });
  globalThis.ListokAutoBackup?.mount({ snapshot: () => boardSnapshot(true), readAsset: readImageAsset, validateBoard: validBackupBoard, restoreBoard: restoreBackup });

  const hasCamera = restore();
  notes.forEach(addElement);
  
  if (hasCamera) drawCamera(); else fit(true);
  if (notes.length) selectNote(notes[0]);
  if (lastStoredValue === null) save(); else lastSavedSnapshot = lastStoredValue;
})();
