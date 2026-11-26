/* A local archive: signature, manifest length, JSON manifest, original image blobs. */
(() => {
  'use strict';
  const magic = 'LISTOK01';
  const encoder = new TextEncoder();
  async function pack(board, readAsset) {
    const ids = [...new Set(board.notes.flatMap(n => [n.type === 'image' ? n.assetId : null, n.front?.assetId, n.back?.assetId].filter(Boolean)))];
    const blobs = [], assets = []; let offset = 0;
    for (const id of ids) {
      const blob = await readAsset(id);
      if (!(blob instanceof Blob) || !blob.size) throw Error('Картинка отсутствует в браузере. Полную копию создать нельзя: восстановите отсутствующую картинку или удалите её с доски.');
      assets.push({ id, offset, size: blob.size, type: blob.type }); blobs.push(blob); offset += blob.size;
    }
    const manifest = encoder.encode(JSON.stringify({ format: 'listok-backup', version: 1, createdAt: new Date().toISOString(), board, assets }));
    if (manifest.length > 16 * 1024 * 1024) throw Error('Слишком большой список элементов для этого формата резервной копии.');
    const header = new Uint8Array(12); header.set(encoder.encode(magic)); new DataView(header.buffer).setUint32(8, manifest.length);
    return new Blob([header, manifest, ...blobs], { type: 'application/octet-stream' });
  }
  async function unpack(file, validateBoard) {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (header.length !== 12 || new TextDecoder().decode(header.slice(0, 8)) !== magic) throw Error('Это не резервная копия Листка. Выберите файл .listok.');
    const length = new DataView(header.buffer).getUint32(8), start = 12 + length;
    if (!length || length > 16 * 1024 * 1024 || start > file.size) throw Error('Файл копии повреждён или обрезан.');
    let manifest;
    try { manifest = JSON.parse(await file.slice(12, start).text()); } catch { throw Error('Не удалось прочитать содержимое копии.'); }
    if (manifest.format !== 'listok-backup' || manifest.version !== 1 || !validateBoard(manifest.board) || !Array.isArray(manifest.assets)) throw Error('Неподдерживаемая версия или повреждённые данные доски.');
    const images = new Map(); let offset = 0;
    for (const a of manifest.assets) {
      if (typeof a.id !== 'string' || images.has(a.id) || !Number.isSafeInteger(a.size) || a.size <= 0 || a.offset !== offset || start + offset + a.size > file.size || typeof a.type !== 'string' || !a.type.startsWith('image/')) throw Error('Повреждён список картинок в копии.');
      images.set(a.id, file.slice(start + offset, start + offset + a.size, a.type)); offset += a.size;
    }
    const required = new Set(manifest.board.notes.flatMap(n => [n.type === 'image' ? n.assetId : null, n.front?.assetId, n.back?.assetId].filter(Boolean)));
    if (start + offset !== file.size || required.size !== images.size || [...required].some(id => !images.has(id))) throw Error('В копии отсутствуют картинки или есть лишние данные.');
    return { board: manifest.board, images };
  }
  function mount({ snapshot, readAsset, validateBoard, restoreBoard }) {
    const menu = document.getElementById('backup-menu'), status = document.getElementById('backup-status');
    const download = document.getElementById('backup-download'), restore = document.getElementById('backup-restore'), input = document.getElementById('backup-file');
    const busy = value => { download.disabled = restore.disabled = value; menu.setAttribute('aria-busy', String(value)); };
    download.onclick = async () => {
      busy(true); status.textContent = 'Собираем доску и картинки…';
      try {
        const blob = await pack(snapshot(), readAsset);
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'Листок-' + new Date().toISOString().replace(/[:.]/g, '-') + '.listok';
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        status.textContent = 'Копия передана браузеру для скачивания. Сохраните файл на компьютере или в облаке.';
      } catch (e) { status.textContent = 'Не удалось создать копию. ' + e.message; }
      finally { busy(false); }
    };
    restore.onclick = () => { input.value = ''; input.click(); };
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      busy(true); status.textContent = 'Проверяем файл и картинки…';
      try {
        const data = await unpack(file, validateBoard);
        for (const blob of data.images.values()) {
          const url = URL.createObjectURL(blob), img = new Image();
          try { img.src = url; await img.decode(); if (!img.naturalWidth) throw Error(); }
          catch { throw Error('Одна из картинок повреждена. Текущая доска не изменена.'); }
          finally { URL.revokeObjectURL(url); }
        }
        if (!confirm(`Восстановить доску из файла «${file.name}»?\n\nЭлементов: ${data.board.notes.length}. Картинок: ${data.images.size}.\nТекущая доска будет заменена. Если она нужна, сначала скачайте её резервную копию.`)) { status.textContent = 'Восстановление отменено. Доска не изменена.'; return; }
        status.textContent = 'Восстанавливаем…';
        await restoreBoard(data);
      } catch (e) { status.textContent = 'Не удалось восстановить копию. ' + e.message; }
      finally { busy(false); }
    };
    document.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && menu.getAttribute('aria-busy') !== 'true') menu.open = false; });
  }
  const api = { pack, unpack, mount };
  if (typeof module !== 'undefined') module.exports = api; else globalThis.ListokBackup = api;
})();
