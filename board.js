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
  const isScalable = item => isWallet(item) || isImage(item) || isRpg(item);
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
  const percentFormat = new Intl.NumberFormat("ru-RU", { useGrouping: false, maximumFractionDigits: 0 });  const examples = [
    { id: "places", x: 0, y: 0, tilt: 0, color: "yellow", text: "Собрать карту любимых мест" },
    { id: "path", x: 222, y: 0, tilt: 0, color: "yellow", text: "Набросать первый маршрут по городу" },
    { id: "friends", x: 444, y: 0, tilt: 0, color: "yellow", text: "Спросить друзей про их тайные места" }
  ];
  const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const limit = (value, min, max) => Math.min(max, Math.max(min, value));
  const noteElements = new Map();
  let notes = examples.map(note => ({ ...note, size: defaultSize }));
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
  function validNote(note) {
    if (!note || typeof note.id !== "string" || ![note.x, note.y, note.tilt].every(Number.isFinite)) return false;
    if (isImage(note)) return typeof note.assetId === "string" && Number.isFinite(note.width) && note.width > 0 && Number.isFinite(note.height) && note.height > 0;
    if (isRpg(note)) return !!note.tracker;
    if (isWallet(note)) return Number.isFinite(note.width) && Number.isFinite(note.height);
    return typeof note.text === "string" &&
      (isText(note) ? Number.isFinite(note.width) && note.width >= minTextWidth : Object.hasOwn(papers, note.color));
  }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey));
      if (!data || data.version !== 1 || !Array.isArray(data.notes) || !data.notes.every(validNote)) return false;
      if (new Set(data.notes.map(n => n.id)).size !== data.notes.length) return false;
      notes = data.notes.map(note => {
        if (isImage(note)) return { ...note, scale: Number.isFinite(note.scale) ? limit(note.scale, .05, 10) : 1 };
        if (isRpg(note)) return { ...note, width: 1080, height: 860, scale: Number.isFinite(note.scale) ? limit(note.scale, .35, 3) : 1, tracker: RpgTracker.normalize(note.tracker) };
        if (isWallet(note)) return normalizeWallet(note);
        if (!isText(note)) return { ...note, size: Number.isFinite(note.size) ? Math.max(minSize, note.size) : defaultSize };
        return {
          ...note, tilt: 0,
          height: Number.isFinite(note.height) ? Math.max(0, note.height) : 0,
          fontSize: Number.isFinite(note.fontSize) ? Math.max(1, note.fontSize) : defaultTextSize,
          font: textFonts.includes(note.font) ? note.font : textFonts[0],
          ink: /^#[0-9a-f]{6}$/i.test(note.ink) ? note.ink : "#1c1c1c",
          align: ["left", "center", "right"].includes(note.align) ? note.align : "left"
        };
      });
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
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, notes, camera, preferredColor, width: canvas.clientWidth, height: canvas.clientHeight }));
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
    const length = note.text.length;
    const lines = note.text.split("\n").length;
    el.classList.toggle("compact", length > 75 || lines > 5);
    el.classList.toggle("dense", length > 120 || lines > 7);
    el.classList.toggle("long", length > 170 || lines > 8);
    if (editor?.el === el) {
      const body = el.querySelector(".note-content");
      body.textContent = note.text + (note.text.endsWith("\n") ? "\u200b" : "");
      editor.field.style.paddingTop = body.offsetTop + "px";
    }
    el.setAttribute("aria-label", note.text || "Пустой стикер");
  }
  function addElement(note) {
    const el = document.createElement("article");
    el.className = isRpg(note) ? "note rpg-card" : isText(note) ? "note text-area" : isWallet(note) ? "note wallet-card" : isImage(note) ? "note image-card" : "note";
    el.tabIndex = 0;
    el.dataset.id = note.id;
    el.style.setProperty("--tilt", note.tilt + "deg");
    if (isText(note)) applyTextFormat(note, el);
    else if (!isScalable(note)) el.style.setProperty("--paper", papers[note.color][0]);
    positionNote(note, el);
    if (isScalable(note)) {
      if (isRpg(note)) RpgTracker.mount(el, note.tracker, save);
      else if (isWallet(note)) buildWallet(note, el);
      else {
        const img = document.createElement("img");
        img.alt = note.name || "Изображение";
        img.draggable = false;
        el.append(img);
        readImageAsset(note.assetId).then(blob => {
          if (!blob || !el.isConnected) { if (!blob) img.alt = "Файл изображения недоступен"; return; }
          const url = URL.createObjectURL(blob);
          img.onload = img.onerror = () => URL.revokeObjectURL(url);
          img.src = url;
        }).catch(() => { img.alt = "Не удалось загрузить изображение"; });
      }
      const corners = document.createElement("div");
      corners.className = "note-corners";
      corners.innerHTML = ["nw", "ne", "sw", "se"].map(c => `<span class="resize-handle" data-corner="${c}" title="Масштабировать элемент"></span>`).join("");
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
      adjustText(note, el);
    }
    $("notes").append(el);
    noteElements.set(note.id, el);
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
        for (const btn of bar.querySelectorAll(".swatch")) btn.setAttribute("aria-pressed", String(btn.dataset.color === selected.color));
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
      child.inert = !!note.locked && !((isWallet(note) && child.classList.contains("wallet-shell")) || (isRpg(note) && child.classList.contains("rpg-shell")));
    }
  }
  function syncLockControls() {
    for (const bar of [palette, textToolbar, walletToolbar]) {
      for (const child of bar.children) {
        child.inert = !!selected?.locked && !child.classList.contains("lock-element");
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
  function selectNote(note, additive = false) {
    const members = note ? notes.filter(n => n.id === note.id || (note.groupId && n.groupId === note.groupId)) : [];
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
    walletToolbar.querySelector(".wallet-toolbar-label").textContent = isRpg(note) ? "Лист персонажа" : isImage(note) ? "Изображение" : "Кошелёк";
    $("remove-wallet").title = $("remove-wallet").ariaLabel = isRpg(note) ? "Удалить лист персонажа" : isImage(note) ? "Удалить изображение" : "Удалить кошелёк";
    syncLockControls();
    placePalette();
  }
  function finishEdit() {
    if (!editor) return;
    const { field, note, el } = editor;
    editor = null;
    note.text = field.value;
    el.querySelector(".note-content").textContent = note.text;
    field.remove();
    el.classList.remove("editing");
    adjustText(note, el);
    placePalette();
    save();
  }
  function editNote(note, offset = note.text.length) {
    if (note.locked || note.groupId || selection.size > 1) return;
    finishEdit();
    selectNote(note);
    const el = noteElements.get(note.id);
    const field = document.createElement("textarea");
    field.className = "note-editor";
    field.setAttribute("aria-label", isText(note) ? "Текстовая область" : "Текст стикера");
    field.placeholder = isText(note) ? "Введите текст…" : "Ваш текст…";
    field.value = note.text;
    editor = { note, el, field };
    el.classList.add("editing");
    palette.hidden = true;
    el.append(field);
    adjustText(note, el);
    field.focus({ preventScroll: true });
    field.setSelectionRange(offset, offset);
    field.addEventListener("input", () => {
      note.text = field.value;
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
    tool = next;
    $("select-tool").setAttribute("aria-pressed", String(next === "select"));
    $("note-tool").setAttribute("aria-pressed", String(next === "note"));
    $("text-tool").setAttribute("aria-pressed", String(next === "text"));
    $("rpg-tool").setAttribute("aria-pressed", String(next === "rpg"));
    $("wallet-tool").setAttribute("aria-pressed", String(next === "wallet"));
    canvas.classList.toggle("placing", next === "note");
    canvas.classList.toggle("placing-text", next === "text");
    canvas.classList.toggle("placing-wallet", next === "wallet");
    const tip = $("placement-tip");
    tip.hidden = next === "select";
    tip.textContent = next === "rpg" ? "Нажмите на холст, чтобы добавить лист персонажа" : next === "text" ? "Нажмите, чтобы ввести текст, или потяните, чтобы задать ширину" :
      next === "wallet" ? "Нажмите на холст, чтобы добавить кошелёк" : "Нажмите на холст, чтобы добавить стикер";
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
      x: point.x - 540 * scale, y: point.y - 430 * scale, width: 1080, height: 860, scale, tracker: RpgTracker.normalize() };
    notes.push(note); addElement(note); setTool("select"); selectNote(note);  save();
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
  function removeNote() {
    if (selection.size > 1) { removeGroupSelection(); return; }
    if (!selected || selected.locked || editor) return;
    if (isWallet(selected) && !window.confirm("Удалить кошелёк?\n\nВсе операции, баланс и настройки этого кошелька будут удалены. Данные не сохранятся, восстановить их будет невозможно.")) return;
    if (isRpg(selected) && !window.confirm("Удалить лист персонажа? Все навыки, зелья, ресурсы и история действий будут удалены. Данные не сохранятся.")) return;
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
      preferredColor = selected.color = color;
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
    for (const [direction, label, arrow] of [
      ["down", "На слой ниже", "M17 4v9m-3-3 3 3 3-3"],
      ["up", "На слой выше", "M17 13V4m-3 3 3-3 3 3"],
      ["back", "На задний план", "M17 4v9m-3-3 3 3 3-3"],
      ["front", "На передний план", "M17 13V4m-3 3 3-3 3 3"]
    ]) {
      const layerButton = document.createElement("button");
      layerButton.type = "button";
      layerButton.className = "layer-element";
      layerButton.title = label;
      layerButton.setAttribute("aria-label", label);
      layerButton.innerHTML = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3 9h8v8H3zM7 17v4h9v-5"/><path d="' + arrow + '"/></svg>';
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
  $("text-tool").onclick = () => setTool("text");
  $("rpg-tool").onclick = () => setTool("rpg");
  $("wallet-tool").onclick = () => setTool("wallet");
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
    if (!event.target.closest("input,select,textarea,.wallet-interactive")) event.preventDefault();
  });
  canvas.addEventListener("wheel", event => {
    if (event.target.closest("#group-toolbar,#text-toolbar,.wallet-interactive") || (event.target.closest("textarea") && !event.ctrlKey)) return;
    event.preventDefault();
    if (gesture?.action === "resize" || gesture?.action === "groupResize") return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
    zoomAt(camera.scale * Math.exp(-delta * .0015), event.clientX, event.clientY);
  }, { passive: false });
  canvas.addEventListener("pointerdown", event => {
    if (event.target.closest("#group-toolbar,#group-box,#palette,#text-toolbar,#wallet-toolbar,textarea") || gesture || !event.isPrimary) return;
    if (event.target.closest(".wallet-interactive")) {
      const walletEl = event.target.closest(".wallet-card,.rpg-card");
      const wallet = walletEl && notes.find(item => item.id === walletEl.dataset.id);
      if (wallet && selected !== wallet) selectNote(wallet);
      return;
    }
    const pan = event.button === 2 || (spaceHeld && event.button === 0);
    if (!pan && event.button !== 0) return;
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
    const action = pan ? "pan" : tool === "text" ? "createText" : tool === "rpg" ? "createRpg" : tool === "wallet" ? "createWallet" : tool === "note" ? "create" : handle ? "resize" : note ? "drag" : "background";
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
      gesture.corner = handle.dataset.corner;
      gesture.startScale = note.scale;
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
    } else if (g.action === "createText") {
      textOutline.hidden = false;
      textOutline.style.transform = translate(Math.min(g.mouseX, event.clientX) - viewport.left, g.mouseY - viewport.top);
      textOutline.style.width = Math.max(minTextWidth * camera.scale, Math.abs(dx)) + "px";
      textOutline.style.height = defaultTextSize * 1.36 * camera.scale + "px";
    } else if (g.action === "resize" && isScalable(g.note)) {
      const note = g.note;
      const west = g.corner.includes("w"), north = g.corner.includes("n");
      const sx = dx / camera.scale * (west ? -1 : 1), sy = dy / camera.scale * (north ? -1 : 1);
      note.scale = limit(g.startScale + (sx * note.width + sy * note.height) / (note.width ** 2 + note.height ** 2), isImage(note) ? .05 : .35, isImage(note) ? 10 : 3);
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
    } else if (event.type === "pointerup" && g.action === "create" && !g.moving) {
      createNote(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createRpg" && !g.moving) {
      createRpg(localPoint(event.clientX, event.clientY));
    } else if (event.type === "pointerup" && g.action === "createWallet" && !g.moving) {
      createWallet(localPoint(event.clientX, event.clientY));
    } else {
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
    const offset = caret && caret.startContainer === body.firstChild ? caret.startOffset : note.text.length;
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
  document.addEventListener("paste", event => {
    if (event.target.closest("input,textarea,[contenteditable=true]")) return;
    const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addImages(files, imageCenter());
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
  for (const [label, action] of [["Сгруппировать",groupSelection],["Разгруппировать",ungroupSelection],["На слой ниже",()=>changeLayer("down")],["На слой выше",()=>changeLayer("up")],["На задний план",()=>changeLayer("back")],["На передний план",()=>changeLayer("front")],["Удалить",removeGroupSelection]]) {
    const button = document.createElement("button"); button.textContent = label;
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
    if(members.some(n => isWallet(n) || isRpg(n))&&!confirm("Удалить выбранные элементы? Все данные кошельков и листов персонажа будут удалены без возможности восстановления.")) return;
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
    const minFactor=Math.max(...g.members.map(m=>isScalable(m.note)?(isImage(m.note)?.05:.35)/m.scale:isText(m.note)?Math.max(minTextWidth/m.width,1/m.fontSize):minSize/m.size));
    const maxFactor=Math.min(...g.members.map(m=>isScalable(m.note)?(isImage(m.note)?10:3)/m.scale:Infinity));
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

  function boardSnapshot() {
    document.activeElement?.blur();
    finishEdit();
    return JSON.parse(JSON.stringify({ version: 1, notes, camera, preferredColor, width: canvas.clientWidth, height: canvas.clientHeight }));
  }
  function validBackupBoard(data) {
    try {
      if (Array.isArray(data?.notes)) for (const note of data.notes) {
        if (isRpg(note)) RpgTracker.normalize(note.tracker);
        if (isWallet(note)) normalizeWallet(note);
      }
    } catch { return false; }
    return data && data.version === 1 && Array.isArray(data.notes) && data.notes.every(n =>
      validNote(n) && [undefined, "text", "wallet", "image", "rpg"].includes(n.type) &&
      (!isScalable(n) || (Number.isFinite(n.scale) && n.scale > 0 && Number.isFinite(n.width) && n.width > 0 && Number.isFinite(n.height) && n.height > 0)) &&
      (!isRpg(n) || (n.tracker && typeof n.tracker === "object" && Array.isArray(n.tracker.skills)))) &&
      new Set(data.notes.map(n => n.id)).size === data.notes.length &&
      data.camera && [data.camera.x, data.camera.y, data.camera.scale].every(Number.isFinite) &&
      data.camera.scale >= minZoom && data.camera.scale <= maxZoom;
  }
  async function restoreBackup({ board, images }) {
    // New keys keep existing assets intact if storage runs out before the board is committed.
    const remap = new Map([...images.keys()].map(id => [id, crypto.randomUUID()]));
    const data = JSON.parse(JSON.stringify(board));
    data.notes.forEach(n => { if (isImage(n)) n.assetId = remap.get(n.assetId); });
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

  const hasCamera = restore();
  notes.forEach(addElement);
  
  if (hasCamera) drawCamera(); else fit(true);
  if (notes.length) selectNote(notes[0]);
  save();
})();
