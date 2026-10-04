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
