import { freshState, normalizeState, migrateLegacy, STORAGE_KEY, LEGACY_KEY } from './core.js';
export function loadState(storage = localStorage) {
  try {
    const current = storage.getItem(STORAGE_KEY);
    if (current) return { state: normalizeState(JSON.parse(current)), migrated: false };
    const old = storage.getItem(LEGACY_KEY);
    if (old) {
      const state = migrateLegacy(JSON.parse(old));
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { state, migrated: true };
    }
    return { state: freshState(), migrated: false };
  } catch (error) { return { state: freshState(), migrated: false, error: '读取失败，旧数据没有被覆盖。可以在设置中导入备份。' }; }
}
export function saveState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let useDatabase = false, saveQueue = Promise.resolve();
function databaseValue(value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ciyu-remastered-storage', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('学习数据存储被其他页面阻塞，请关闭其他词屿页面后重试'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('state', value === undefined ? 'readonly' : 'readwrite');
      const operation = value === undefined ? transaction.objectStore('state').get(STORAGE_KEY) : transaction.objectStore('state').put(value, STORAGE_KEY);
      transaction.oncomplete = () => { db.close(); resolve(operation.result); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || operation.error || new Error('学习数据存储失败')); };
    };
  });
}
export async function loadDurableState() {
  let saved;
  try { saved = await databaseValue(); }
  catch { /* Browsers without IndexedDB can still use existing localStorage. */ }
  if (saved !== undefined) {
    useDatabase = true;
    try { return { state: normalizeState(JSON.parse(saved)), migrated: false }; }
    catch { return { state: freshState(), migrated: false, error: '学习数据库读取失败，旧数据没有被覆盖。请先导出备份再恢复。' }; }
  }
  return loadState();
}
export function saveDurableState(state) {
  // Serialize immediately so later edits cannot change an already queued save.
  const serialized = JSON.stringify(state);
  const save = async () => {
    if (!useDatabase) {
      try { localStorage.setItem(STORAGE_KEY, serialized); return; }
      catch (error) {
        if (!['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED', 'SecurityError'].includes(error.name)) throw error;
      }
    }
    await databaseValue(serialized);
    useDatabase = true;
  };
  const pending = saveQueue.then(save);
  saveQueue = pending.catch(() => {});
  return pending;
}
export function savingError(error) {
  if (['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name)) return '浏览器存储配额已满，学习数据尚未保存。请先导出完整备份，再释放此网站的存储空间。';
  if (error?.name === 'SecurityError') return '浏览器禁止此网站保存数据。请允许网站存储或退出限制存储的浏览模式；当前数据请先导出备份。';
  return `学习数据保存失败，尚未写入浏览器。请先导出备份。${error?.message ? `（${error.message}）` : ''}`;
}
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('无法读取 JSON 备份，请选择词屿导出的文件'); }
  if (data.version === 2) return normalizeState(data);
  return migrateLegacy(data);
}
export function backupText(state) {
  const settings = { ...state.settings }; delete settings.aiKey; delete settings.apiKey;
  return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
}
export function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
