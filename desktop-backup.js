/* Automatic snapshots for the portable desktop build. Browser builds stay unchanged. */
(() => {
  'use strict';
  const interval = 15 * 60 * 1000;
  const firstDelay = 30 * 1000;
  const base = 'backups';
  const assetPath = id => `${base}/assets/${encodeURIComponent(id)}.blob`;
  const snapshotName = time => `snapshot-${time}.json`;
  const assetIds = board => [...new Set(board.notes.flatMap(note =>
    [note.type === 'image' ? note.assetId : null, note.front?.assetId, note.back?.assetId].filter(Boolean)))];

  async function createSnapshot(fs, directory, board, readAsset, time = Date.now()) {
    const options = { baseDir: directory };
    await fs.mkdir(`${base}/assets`, { ...options, recursive: true });
    const assets = [];
    for (const id of assetIds(board)) {
      const path = assetPath(id);
      const blob = await readAsset(id);
      if (!(blob instanceof Blob) || !blob.size) throw Error('На доске есть отсутствующая картинка: автокопия не создана.');
      if (!await fs.exists(path, options)) {
        await fs.writeFile(path + '.tmp', new Uint8Array(await blob.arrayBuffer()), options);
        await fs.rename(path + '.tmp', path, { oldPathBaseDir: directory, newPathBaseDir: directory });
      }
      assets.push({ id, type: blob.type });
    }
    const manifest = { format: 'listok-auto', version: 1, createdAt: new Date(time).toISOString(), board, assets };
    const name = snapshotName(time);
    await fs.writeTextFile(`${base}/${name}.tmp`, JSON.stringify(manifest), options);
    await fs.rename(`${base}/${name}.tmp`, `${base}/${name}`, { oldPathBaseDir: directory, newPathBaseDir: directory });
    return name;
  }

  async function readSnapshot(fs, directory, name, validateBoard) {
    if (!/^snapshot-\d+\.json$/.test(name)) throw Error('Неверное имя копии.');
    const options = { baseDir: directory };
    const manifest = JSON.parse(await fs.readTextFile(`${base}/${name}`, options));
    if (manifest.format !== 'listok-auto' || manifest.version !== 1 || !validateBoard(manifest.board) || !Array.isArray(manifest.assets)) throw Error('Копия повреждена.');
    const required = new Set(assetIds(manifest.board));
    if (required.size !== manifest.assets.length || new Set(manifest.assets.map(a => a.id)).size !== required.size || manifest.assets.some(a => !required.has(a.id) || typeof a.type !== 'string' || !a.type.startsWith('image/'))) throw Error('Список картинок повреждён.');
    const images = new Map();
    for (const asset of manifest.assets) {
      const blob = new Blob([await fs.readFile(assetPath(asset.id), options)], { type: asset.type });
      const url = URL.createObjectURL(blob), image = new Image();
      try { image.src = url; await image.decode(); if (!image.naturalWidth) throw Error(); }
      catch { throw Error('Картинка в автокопии повреждена.'); }
      finally { URL.revokeObjectURL(url); }
      images.set(asset.id, blob);
    }
    return { board: manifest.board, images };
  }

  function mount({ snapshot, readAsset, validateBoard, restoreBoard }) {
    const fs = globalThis.__TAURI__?.fs;
    if (!fs) return;
    const directory = fs.BaseDirectory.AppData;
    const panel = document.querySelector('#backup-menu .backup-panel');
    const status = document.getElementById('backup-status');
    const label = document.createElement('small');
    label.textContent = 'Автокопии хранятся рядом с программой в app-data/backups.';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Выбрать автоматическую копию');
    const restore = document.createElement('button');
    restore.type = 'button'; restore.textContent = '↶ Восстановить автокопию';
    panel.insertBefore(label, status);
    panel.insertBefore(select, status);
    panel.insertBefore(restore, status);
    let names = [], lastBackupAt = 0, timer = null, dirty = false, running = false;
    const ready = (async () => {
      await fs.mkdir(`${base}/assets`, { baseDir: directory, recursive: true });
      await refresh();
      lastBackupAt = Math.max(0, ...names.map(name => Number(name.slice(9, -5)) || 0));
    })().catch(error => { status.textContent = 'Автокопии недоступны: ' + error.message; });

    async function refresh() {
      names = (await fs.readDir(base, { baseDir: directory }))
        .map(entry => entry.name).filter(name => /^snapshot-\d+\.json$/.test(name)).sort().reverse();
      select.replaceChildren(...names.map(name => {
        const option = document.createElement('option');
        option.value = name; option.textContent = new Date(Number(name.slice(9, -5))).toLocaleString('ru-RU');
        return option;
      }));
      select.disabled = restore.disabled = !names.length;
    }

    async function backup() {
      await ready;
      if (!dirty || running) return;
      running = true; dirty = false;
      try {
        const board = snapshot();
        if (!validateBoard(board)) throw Error('Данные доски не прошли проверку.');
        const time = Date.now();
        await createSnapshot(fs, directory, board, readAsset, time);
        lastBackupAt = time;
        await refresh();
        status.textContent = 'Автокопия создана: ' + new Date(time).toLocaleString('ru-RU');
      } catch (error) {
        dirty = true;
        status.textContent = 'Автокопия не создана: ' + error.message;
      } finally {
        running = false;
        if (dirty) schedule();
      }
    }

    function schedule() {
      dirty = true;
      if (timer || running) return;
      ready.then(() => {
        if (timer || running || !dirty) return;
        const delay = Math.max(firstDelay, interval - (Date.now() - lastBackupAt));
        timer = setTimeout(() => { timer = null; backup(); }, delay);
      });
    }
    window.addEventListener('listok:saved', schedule);
    restore.onclick = async () => {
      if (!select.value || !confirm('Восстановить выбранную автокопию? Текущая доска будет заменена.')) return;
      restore.disabled = true; status.textContent = 'Проверяем автокопию…';
      try { await restoreBoard(await readSnapshot(fs, directory, select.value, validateBoard)); }
      catch (error) { status.textContent = 'Не удалось восстановить: ' + error.message; restore.disabled = false; }
    };
  }

  const api = { createSnapshot, readSnapshot, mount };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.ListokAutoBackup = api;
})();
