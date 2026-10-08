import { normalizeMaple } from './lap-core.js';

export const STORAGE_KEY = 'ciyu.remastered.v2';
export const LEGACY_KEY = 'ciyu.vocab.v1';
export const MODE_INFO = {
  read: { name: '认读', short: '看英文 · 记意思', detail: '认识与否由你判断，默认连续认识 3 次。', icon: 'book', flag: 'mastered' },
  listen: { name: '听力', short: '听发音 · 练拼写', detail: '听写 1 次，再连续听音认识 2 次。', icon: 'headphones', flag: 'listenMastered' },
  speak: { name: '口语', short: '双向回忆 · 开口说', detail: '中译英、英译中各自评说对 2 次。', icon: 'mic', flag: 'speakMastered' },
  write: { name: '写作', short: '看中文 · 写全表达', detail: '同组表达一次写全，累计答对 2 次。', icon: 'pen', flag: 'writeMastered' },
  audit: { name: '拼写审查', short: '每词一次 · 快速查漏', detail: '检查全书，每词只考一次。拼对记为听力掌握。', icon: 'checklist', flag: 'listenMastered' },
  review: { name: '记忆复习', short: '到期再见 · 长久记住', detail: '按间隔安排到期词，忘记的词更快回来。', icon: 'calendar', flag: 'mastered' }
};
export const INTERVALS = [20 * 60e3, 60 * 60e3, 9 * 3600e3, 24 * 3600e3, 2 * 86400e3, 4 * 86400e3, 7 * 86400e3, 15 * 86400e3, 30 * 86400e3];
export const DEFAULT_SETTINGS = {
  batch: 12, gap: 7, wrongGap: 3, target: 3, mixOld: false, mixEvery: 5, mixCount: 2,
  autoSpeak: true, autoSpeakZh: true, rate: 0.95, accent: 'uk', zhVoiceURI: '', audioTemplate: '',
  theme: 'auto', background: null,
  aiEnabled: false, aiNoKey: false, aiProvider: 'custom', aiBase: 'https://api.openai.com/v1', aiModel: 'gpt-4.1-mini', aiLevel: 'B1', aiJsonMode: false, aiStream: false, aiThinking: 'auto', aiThinkingFormat: 'auto', dailyGoal: 20,
  uiPalette: 'iris', uiCustom: false, uiAccent: '#5666eb', uiBackground: '#f7f8fc', uiSurface: '#ffffff', uiText: '#252b43',
  uiFont: 'sans', uiScale: 100, uiRadius: 20, uiCardWidth: 580, uiLayout: 'sidebar', uiDensity: 'comfortable', uiMotion: true, uiSelection: false
};
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const clone = value => structuredClone(value);
export const normWord = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const normalizeSpelling = value => String(value || '').toLowerCase().replace(/[’‘]/g, "'")
  .replace(/[-‐‑‒–—]/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function shuffle(list, random = Math.random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export const freshState = () => ({ version: 2, settings: { ...DEFAULT_SETTINGS }, books: [], sessions: {}, history: [], study: {}, aiMaterials: [], maple: { collections: [] }, migratedAt: null });
export const sessionKey = (bookId, mode) => `${bookId}:${mode}`;
export const bookById = (state, id) => state.books.find(book => book.id === id);
export const wordById = (state, bookId, id) => bookById(state, bookId)?.words.find(word => word.id === id);
export function sanitizeSettings(input = {}) {
  const result = { ...DEFAULT_SETTINGS };
  for (const [key, min, max] of [['dailyGoal', 1, 1000], ['batch', 5, 30], ['gap', 1, 30], ['wrongGap', 1, 8], ['target', 2, 5], ['mixEvery', 1, 50], ['mixCount', 1, 5]]) {
    result[key] = Math.min(max, Math.max(min, Math.round(Number(input[key]) || result[key])));
  }
  for (const key of ['mixOld', 'autoSpeak', 'autoSpeakZh', 'aiEnabled', 'aiNoKey', 'aiJsonMode', 'aiStream', 'uiCustom', 'uiMotion', 'uiSelection']) if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const [key, min, max] of [['uiScale', 85, 125], ['uiRadius', 4, 32], ['uiCardWidth', 360, 820]]) result[key] = Math.min(max, Math.max(min, Number(input[key]) || result[key]));
  for (const key of ['uiAccent', 'uiBackground', 'uiSurface', 'uiText']) if (/^#[0-9a-f]{6}$/i.test(input[key] || '')) result[key] = input[key];
  for (const [key, choices] of [['aiProvider', ['custom','ollama']], ['aiThinking', ['auto','on','off']], ['aiThinkingFormat',['auto','thinking','enable_thinking','reasoning_effort']], ['uiPalette', ['iris', 'forest', 'sand', 'rose', 'ocean', 'grape']], ['uiFont', ['sans', 'serif', 'rounded']], ['uiLayout', ['sidebar', 'top']], ['uiDensity', ['comfortable', 'compact']], ['aiLevel', ['A2', 'B1', 'B2', 'C1']]]) if (choices.includes(input[key])) result[key] = input[key];
  if (typeof input.aiBase === 'string' && input.aiBase.length < 500) { try { const url = new URL(input.aiBase); if (['https:','http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) result.aiBase = url.href.replace(/\/$/, ''); } catch {} }
  if (typeof input.aiModel === 'string') result.aiModel = input.aiModel.trim().slice(0, 160);
  result.rate = Math.min(1.3, Math.max(0.6, Number(input.rate) || 0.95));
  result.accent = input.accent === 'us' ? 'us' : 'uk';
  result.theme = ['auto', 'light', 'dark'].includes(input.theme) ? input.theme : 'auto';
  result.zhVoiceURI = typeof input.zhVoiceURI === 'string' ? input.zhVoiceURI : '';
  result.audioTemplate = typeof input.audioTemplate === 'string' && input.audioTemplate.startsWith('https://') && input.audioTemplate.includes('{text}') ? input.audioTemplate : '';
  result.background = typeof input.background === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(input.background) && input.background.length < 3e6 ? input.background : null;
  return result;
}
export function normalizeState(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.books)) throw new Error('这不是有效的词屿备份');
  const state = freshState();
  state.settings = sanitizeSettings({ ...input.settings, theme: input.theme || input.settings?.theme, background: input.background || input.settings?.background });
  const seenBooks = new Set();
  state.books = input.books.filter(book => book && typeof book.name === 'string' && Array.isArray(book.words)).map(book => {
    const id = typeof book.id === 'string' && !seenBooks.has(book.id) ? book.id : uid(); seenBooks.add(id);
    const seenWords = new Set();
    const words = [];
    for (const word of book.words) {
      if (!word || typeof word.en !== 'string' || !word.en.trim()) continue;
      const ens = Array.isArray(word.ens) && word.ens.length ? word.ens : [word.en];
      const group = word.synGroup || (ens.length > 1 ? uid() : null);
      for (const en of ens) {
        if (typeof en !== 'string' || !en.trim() || seenWords.has(normWord(en))) continue;
        seenWords.add(normWord(en));
        const review = word.review && Number.isFinite(Number(word.review.dueAt)) ? {
          stage: Math.min(9, Math.max(1, Number(word.review.stage) || 1)), dueAt: Number(word.review.dueAt),
          lastAt: Number(word.review.lastAt) || null, lapses: Math.max(0, Number(word.review.lapses) || 0)
        } : (word.mastered || word.listenMastered || word.speakMastered || word.writeMastered) ? { stage: 1, dueAt: Date.now(), lastAt: null, lapses: 0 } : null;
        words.push({
          id: en === ens[0] && typeof word.id === 'string' ? word.id : uid(), en: en.trim(), ens: [en.trim()], synGroup: group,
          phonetic: String(word.phonetic || ''), defs: Array.isArray(word.defs) ? word.defs.map(String).filter(Boolean) : [],
          mastered: !!word.mastered, listenMastered: !!word.listenMastered, speakMastered: !!word.speakMastered, writeMastered: !!word.writeMastered,
          addedAt: Number(word.addedAt) || Date.now(), auditWrong: !!word.auditWrong, review
        });
      }
    }
    return { id, name: book.name.trim().slice(0, 60) || '未命名词书', createdAt: Number(book.createdAt) || Date.now(), words };
  });
  if (input.version === 2 && input.sessions && typeof input.sessions === 'object') {
    for (const session of Object.values(input.sessions)) {
      if (!session || !MODE_INFO[session.mode] || !Array.isArray(session.active) || !Array.isArray(session.queue)) continue;
      if (session.bookId !== 'all' && !bookById(state, session.bookId)) continue;
      const clean = clone(session);
      clean.active = clean.active.filter(item => validItem(state, item, session.bookId));
      clean.queue = clean.queue.filter(item => validItem(state, item, session.bookId));
      clean.currentId = clean.active.some(item => item.id === clean.currentId) ? clean.currentId : null;
      if (!clean.currentId) { clean.phase = 'question'; clean.pending = null; }
      if (clean.active.length || clean.queue.length) state.sessions[sessionKey(clean.bookId, clean.mode)] = clean;
    }
  }
  state.history = Array.isArray(input.history) ? input.history.filter(h => h && MODE_INFO[h.mode] && Number.isFinite(h.finishedAt)).slice(-100) : [];
  state.aiMaterials = Array.isArray(input.aiMaterials) ? input.aiMaterials.filter(m => m && ['example', 'story'].includes(m.kind) && typeof m.text === 'string' && typeof m.bookId === 'string').slice(-200).map(m => ({
    id: typeof m.id === 'string' ? m.id : uid(), kind: m.kind, bookId: m.bookId,
    wordIds: Array.isArray(m.wordIds) ? m.wordIds.filter(id => typeof id === 'string').slice(0, 12) : [],
    title: String(m.title || '').slice(0, 200), text: m.text.slice(0, 14000), translation: String(m.translation || '').slice(0, 14000),
    note: String(m.note || '').slice(0, 4000), words: Array.isArray(m.words) ? m.words.filter(w => typeof w === 'string').slice(0, 12) : [], createdAt: Number(m.createdAt) || Date.now()
  })) : [];
  state.maple = normalizeMaple(input.maple);
  for (const [word, record] of Object.entries(input.study || {})) if (record && Number.isFinite(record.firstAt) && Number.isFinite(record.lastAt)) state.study[normWord(word)] = { firstAt: record.firstAt, lastAt: record.lastAt };
  state.migratedAt = input.migratedAt || null;
  return state;
}
function validItem(state, item, defaultBook) {
  return item && typeof item.id === 'string' && Array.isArray(item.wordIds) && item.wordIds.length &&
    item.wordIds.every(id => wordById(state, item.bookId || defaultBook, id));
}
export function parseImport(text) {
  const entries = new Map(), errors = [];
  String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim(); if (!line || line.startsWith('#')) return;
    const columns = line.split(/[|｜\t]/).map(part => part.trim());
    if (columns.length < 2) { errors.push({ line: index + 1, message: '英文和中文之间请加 | 或 Tab' }); return; }
    const ens = columns[0].split(/[/；;、]+/).map(en => en.trim()).filter(Boolean);
    const phonetic = columns.length >= 3 ? columns[1] : '';
    const defs = columns.slice(columns.length >= 3 ? 2 : 1).join('；').split(/[;；]/).map(def => def.trim()).filter(Boolean);
    if (!ens.length || !defs.length) { errors.push({ line: index + 1, message: !ens.length ? '缺少英文' : '缺少中文释义' }); return; }
    const key = normWord(ens[0]), previous = entries.get(key);
    if (previous) { previous.ens = [...new Set([...previous.ens, ...ens])]; previous.defs = [...new Set([...previous.defs, ...defs])]; previous.phonetic ||= phonetic; }
    else entries.set(key, { ens, defs, phonetic });
  });
  return { entries: [...entries.values()], errors };
}
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030').decode(buffer); }
}
export function importEntries(state, entries, name, targetId) {
  let book = bookById(state, targetId);
  if (!book) { book = { id: uid(), name: String(name || '我的词书').trim().slice(0, 60), createdAt: Date.now(), words: [] }; state.books.push(book); }
  let added = 0, updated = 0;
  for (const entry of entries) {
    const existingGroup = entry.ens.map(en => book.words.find(w => normWord(w.en) === normWord(en))?.synGroup).find(Boolean);
    const group = existingGroup || uid();
    for (const en of entry.ens) {
      const word = book.words.find(w => normWord(w.en) === normWord(en));
      if (word) {
        word.defs = [...new Set([...word.defs, ...entry.defs])]; word.phonetic ||= entry.phonetic;
        // Re-importing a synonym group joins it instead of leaving split writing groups.
        if (entry.ens.length > 1) word.synGroup = group;
        updated++;
      } else {
        book.words.push({ id: uid(), en, ens: [en], synGroup: group, phonetic: entry.phonetic, defs: [...entry.defs],
          mastered: false, listenMastered: false, speakMastered: false, writeMastered: false, addedAt: Date.now(), auditWrong: false, review: null });
        added++;
      }
    }
  }
  return { book, added, updated };
}
export function bookStats(book, now = Date.now()) {
  const result = { total: book.words.length, due: 0, auditWrong: 0 };
  for (const mode of ['read', 'listen', 'speak', 'write']) result[mode] = book.words.filter(w => w[MODE_INFO[mode].flag]).length;
  result.due = book.words.filter(w => w.review && w.review.dueAt <= now).length;
  result.auditWrong = book.words.filter(w => w.auditWrong).length;
  return result;
}
function makeItem(word, bookId) {
  return { id: uid(), bookId, wordIds: [word.id], en: word.en, ens: [word.en], defs: [...word.defs], phonetic: word.phonetic,
    streak: 0, dictRight: 0, zh2enRight: 0, en2zhRight: 0, right: 0, wrongs: 0, nextEligible: 0, lastAsked: 0,
    pendingWrong: false, visitOld: false, returnOnKnow: true, stage: word.review?.stage || 1, lapses: word.review?.lapses || 0 };
}
export function buildItems(state, bookId, mode, reset = false, now = Date.now()) {
  const books = bookId === 'all' ? state.books : [bookById(state, bookId)].filter(Boolean);
  if (mode === 'review') return books.flatMap(book => book.words.filter(w => w.review?.dueAt <= now).map(w => ({ ...makeItem(w, book.id), dueAt: w.review.dueAt }))).sort((a, b) => a.dueAt - b.dueAt);
  const book = books[0]; if (!book) return [];
  const flag = MODE_INFO[mode].flag;
  if (reset && mode !== 'audit') for (const word of book.words) word[flag] = false;
  const pool = mode === 'audit' ? book.words : book.words.filter(word => !word[flag]);
  if (mode !== 'write') return shuffle(pool).map(word => makeItem(word, book.id));
  const groups = new Map();
  for (const word of pool) { const group = word.synGroup || word.id; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(word); }
  return shuffle([...groups.values()]).map(words => ({ ...makeItem(words[0], book.id), wordIds: words.map(w => w.id),
    ens: [...new Set(words.map(w => w.en))], defs: [...new Set(words.flatMap(w => w.defs))] }));
}
export function startSession(state, bookId, mode, options = {}) {
  if (!MODE_INFO[mode]) throw new Error('未知的学习模式');
  const key = sessionKey(bookId, mode);
  if (state.sessions[key] && !options.restart) return state.sessions[key];
  const items = buildItems(state, bookId, mode, options.reset, options.now);
  if (!items.length) return null;
  const batch = mode === 'audit' || mode === 'review' ? items.length : Math.min(state.settings.batch, items.length);
  const session = {
    id: uid(), key, bookId, mode, startedAt: options.now || Date.now(), active: items.slice(0, batch), queue: items.slice(batch), batch,
    tick: 0, right: 0, wrong: 0, mastered: 0, initialTotal: items.length, lastId: null, currentId: null,
    phase: 'question', type: null, input: '', pending: null, newMasteredSinceMix: 0, visitedIds: [], auditWrongIds: []
  };
  state.sessions[key] = session;
  chooseNext(session, state.settings);
  return session;
}
export const currentItem = session => session?.active.find(item => item.id === session.currentId) || null;
export function chooseNext(session) {
  if (!session.active.length && session.queue.length) session.active.push(session.queue.shift());
  if (!session.active.length) return null;
  let candidates = session.active.filter(item => item.nextEligible <= session.tick && item.id !== session.lastId);
  if (!candidates.length) candidates = session.active.filter(item => item.nextEligible <= session.tick);
  if (!candidates.length) candidates = session.active.filter(item => item.id !== session.lastId);
  if (!candidates.length) candidates = session.active;
  if (session.mode !== 'audit') {
    const wrong = candidates.filter(item => item.pendingWrong); if (wrong.length) candidates = wrong;
    candidates = [...candidates].sort((a, b) => a.nextEligible - b.nextEligible || a.lastAsked - b.lastAsked);
    const first = candidates[0].nextEligible; candidates = candidates.filter(item => item.nextEligible === first);
  }
  const item = candidates[Math.floor(Math.random() * candidates.length)];
  session.currentId = item.id; session.lastId = item.id; session.phase = 'question'; session.input = ''; session.pending = null;
  if (session.mode === 'listen') {
    session.type = item.dictRight >= 1 ? 'recog' : item.streak >= 2 ? 'dict' : Math.random() < 0.5 ? 'dict' : 'recog';
  } else if (session.mode === 'speak') {
    session.type = item.zh2enRight < item.en2zhRight ? 'zh2en' : item.en2zhRight < item.zh2enRight ? 'en2zh' : Math.random() < 0.5 ? 'zh2en' : 'en2zh';
  } else session.type = session.mode === 'audit' ? 'dict' : session.mode;
  return item;
}
export function isMastered(session, item, settings) {
  switch (session.mode) {
    case 'read': return item.visitOld && item.returnOnKnow || item.streak >= settings.target;
    case 'listen': return item.dictRight >= 1 && item.streak >= 2;
    case 'audit': return item.dictRight >= 1;
    case 'speak': return item.zh2enRight >= 2 && item.en2zhRight >= 2;
    case 'write': return item.right >= 2;
    case 'review': return !!session.pending?.correct;
    default: return false;
  }
}
export function spellingMatches(item, raw, grouped = false) {
  if (!grouped) return normalizeSpelling(raw) === normalizeSpelling(item.en);
  const typed = new Set(String(raw || '').split(/[,，、;；/|\n]+/).map(normalizeSpelling).filter(Boolean));
  const required = new Set(item.ens.map(normalizeSpelling));
  return required.size > 0 && typed.size === required.size && [...required].every(value => typed.has(value));
}
export function revealSpeaking(session) {
  if (session.mode === 'speak' && session.phase === 'question') session.phase = 'self-grade';
}
export function gradeAnswer(state, session, answer, now = Date.now()) {
  const item = currentItem(session);
  if (!item || !['question', 'self-grade'].includes(session.phase)) return null;
  const typed = session.mode === 'write' || session.type === 'dict';
  if (typed && !String(answer || '').trim()) return null;
  const correct = typed ? spellingMatches(item, answer, session.mode === 'write') : !!answer;
  for (const en of item.ens || [item.en]) recordStudy(state, en, now);
  const savedWordFlags = item.wordIds.map(id => {
    const word = wordById(state, item.bookId, id); return { id, mastered: word?.mastered, review: clone(word?.review || null) };
  });
  session.pending = { correct, typed, submitted: typed ? String(answer).trim() : '', before: clone(item), wordFlags: savedWordFlags, at: now };
  session.tick++; item.lastAsked = session.tick; item.pendingWrong = !correct;
  if (correct) {
    session.right++;
    if (session.mode === 'read') item.streak++;
    else if (session.mode === 'listen' || session.mode === 'audit') { if (session.type === 'dict') item.dictRight = 1; else item.streak++; }
    else if (session.mode === 'speak') { if (session.type === 'zh2en') item.zh2enRight++; else item.en2zhRight++; }
    else if (session.mode === 'write') item.right++;
  } else {
    session.wrong++; item.wrongs++;
    if (session.mode === 'read' || session.mode === 'listen' && session.type === 'recog') item.streak = 0;
    if (session.mode === 'read' && item.visitOld) {
      item.returnOnKnow = false;
      for (const id of item.wordIds) { const word = wordById(state, item.bookId, id); if (word) { word.mastered = false; word.review = null; } }
    }
    if (session.mode === 'review') { item.stage = 1; item.lapses++; }
  }
  const gap = session.mode === 'write' ? (correct ? 2 : 1) : Math.min(correct ? state.settings.gap : state.settings.wrongGap, Math.max(0, session.active.length - 1));
  item.nextEligible = session.tick + gap;
  session.phase = 'feedback';
  return { correct, mastered: correct && isMastered(session, item, state.settings) };
}
export function correctToWrong(state, session, now = Date.now()) {
  if (session.phase !== 'feedback' || !session.pending?.correct || session.pending.typed || session.mode === 'speak') return false;
  const item = currentItem(session); if (!item) return false;
  const previous = session.pending;
  Object.assign(item, clone(previous.before));
  for (const data of previous.wordFlags) {
    const word = wordById(state, item.bookId, data.id); if (word) { word.mastered = data.mastered; word.review = clone(data.review); }
  }
  session.right--; session.tick--; session.phase = 'question';
  gradeAnswer(state, session, false, now);
  return true;
}
export function retryAnswer(session) {
  if (session.phase !== 'feedback' || session.pending?.correct || !session.pending?.typed || session.mode === 'audit') return false;
  session.phase = 'question'; session.pending = null; session.input = ''; return true;
}
export function ensureReview(word, now = Date.now()) {
  if (!word.review) word.review = { stage: 1, dueAt: now + INTERVALS[0], lastAt: now, lapses: 0 };
}
function injectOld(state, session) {
  if (session.mode !== 'read' || !state.settings.mixOld || session.newMasteredSinceMix < state.settings.mixEvery) return;
  session.newMasteredSinceMix = 0;
  const occupied = new Set([...session.active, ...session.queue].flatMap(item => item.wordIds));
  const book = bookById(state, session.bookId); if (!book) return;
  const old = shuffle(book.words.filter(word => word.mastered && !occupied.has(word.id) && !session.visitedIds.includes(word.id))).slice(0, state.settings.mixCount);
  for (const word of old) {
    const item = makeItem(word, book.id); item.visitOld = true; item.nextEligible = session.tick;
    session.active.push(item); session.visitedIds.push(word.id);
  }
}
export function advanceSession(state, session, now = Date.now()) {
  const item = currentItem(session);
  if (!item || session.phase !== 'feedback' || !session.pending) return null;
  const correct = session.pending.correct;
  const mastered = correct && isMastered(session, item, state.settings);
  if (session.mode === 'review') {
    const word = wordById(state, item.bookId, item.wordIds[0]);
    if (word) {
      const stage = correct ? Math.min(9, item.stage + 1) : 1;
      const effective = correct ? Math.max(1, stage - item.lapses) : 1;
      word.review = { stage, dueAt: now + INTERVALS[effective - 1], lastAt: now, lapses: item.lapses };
    }
  }
  if (session.mode === 'audit') {
    const word = wordById(state, item.bookId, item.wordIds[0]);
    if (word) {
      word.auditWrong = !correct;
      // A failed audit exposes a listening gap even if an older run marked it mastered.
      word.listenMastered = correct;
      if (correct) ensureReview(word, now);
    }
    if (!correct) session.auditWrongIds.push(item.wordIds[0]);
  } else if (mastered && session.mode !== 'review') {
    for (const id of item.wordIds) { const word = wordById(state, item.bookId, id); if (word) { word[MODE_INFO[session.mode].flag] = true; ensureReview(word, now); } }
  }
  const remove = session.mode === 'audit' || mastered;
  if (remove) {
    session.active = session.active.filter(other => other.id !== item.id);
    if (mastered && !item.visitOld) { session.mastered++; session.newMasteredSinceMix++; }
    if (!item.visitOld && session.queue.length) { const fresh = session.queue.shift(); fresh.nextEligible = session.tick; session.active.push(fresh); }
    injectOld(state, session);
  }
  session.phase = 'question'; session.pending = null; session.input = ''; session.currentId = null;
  if (!session.active.length && !session.queue.length) {
    const result = { id: session.id, bookId: session.bookId, mode: session.mode, mastered: session.mastered, right: session.right, wrong: session.wrong,
      finishedAt: now, duration: Math.max(0, now - session.startedAt), initialTotal: session.initialTotal, auditWrongIds: session.auditWrongIds || [] };
    state.history.push(result); state.history = state.history.slice(-100); delete state.sessions[session.key];
    return { finished: true, result };
  }
  chooseNext(session); return { finished: false, item: currentItem(session) };
}
export function invalidateSessions(state, bookId) {
  for (const [key, session] of Object.entries(state.sessions)) {
    if (session.bookId === bookId || session.bookId === 'all' && session.mode === 'review') delete state.sessions[key];
  }
}
export function removeWord(state, bookId, wordId) {
  const book = bookById(state, bookId); if (!book) return;
  book.words = book.words.filter(word => word.id !== wordId);
  // Grouped writing items contain several word IDs. Rebuilding avoids a stale required answer.
  invalidateSessions(state, bookId);
}
export function setMastery(state, bookId, wordId, mode, value, now = Date.now()) {
  const word = wordById(state, bookId, wordId); if (!word) return;
  const modes = mode === 'all' ? ['read', 'listen', 'speak', 'write'] : [mode];
  for (const name of modes) if (MODE_INFO[name]?.flag) word[MODE_INFO[name].flag] = !!value;
  if (modes.some(name => word[MODE_INFO[name].flag])) ensureReview(word, now);
  else if (!['read', 'listen', 'speak', 'write'].some(name => word[MODE_INFO[name].flag])) word.review = null;
  invalidateSessions(state, bookId);
}
export function resetBook(state, bookId, mode = 'all') {
  const book = bookById(state, bookId); if (!book) return;
  for (const word of book.words) {
    for (const name of mode === 'all' ? ['read', 'listen', 'speak', 'write'] : [mode]) word[MODE_INFO[name].flag] = false;
    if (mode === 'all') { word.review = null; word.auditWrong = false; }
  }
  invalidateSessions(state, bookId);
}
export function migrateLegacy(input) {
  const state = normalizeState({ ...input, version: 1 }); state.migratedAt = Date.now();
  const legacyModes = { study: 'read', listen: 'listen', speak: 'speak', write: 'write', review: 'review' };
  for (const [oldKey, defaultMode] of Object.entries(legacyModes)) {
    const old = input[oldKey]; if (!old?.active?.length) continue;
    const mode = old.onceMode ? 'audit' : defaultMode;
    const bookId = old.bookId; if (bookId !== 'all' && !bookById(state, bookId)) continue;
    const session = {
      id: uid(), key: sessionKey(bookId, mode), bookId, mode, startedAt: Number(old.startedAt) || Date.now(),
      active: [], queue: [], batch: old.batch || state.settings.batch, tick: old.askedCount || 0,
      right: old.rightCount || 0, wrong: old.wrongCount || 0, mastered: old.masteredCount || 0,
      initialTotal: old.initialTotal || old.active.length, currentId: null, lastId: null, phase: 'question', type: null,
      input: '', pending: null, newMasteredSinceMix: old.newMasteredSinceMix || 0, visitedIds: old.mixInsertedWids || [], auditWrongIds: []
    };
    const convert = item => {
      const entryBookId = item.bookId || bookId;
      const word = wordById(state, entryBookId, item.wid); if (!word) return null;
      const wordIds = (item.wordIds || [item.wid]).filter(id => wordById(state, entryBookId, id));
      return { ...makeItem(word, entryBookId), ...clone(item), id: uid(), bookId: entryBookId, wordIds,
        ens: item.ens?.length ? [...item.ens] : [word.en], en: item.en || word.en };
    };
    session.active = old.active.map(convert).filter(Boolean); session.queue = (old.queue || []).map(convert).filter(Boolean);
    if (!session.active.length) continue;
    state.sessions[session.key] = session; chooseNext(session);
  }
  return state;
}
export const SAMPLE_TEXT = `emotional bonds | 情感纽带
face-to-face interactions | 面对面的交流
look after / take care of | 照顾；照料
disposable income | 可支配收入
preserve | /prɪˈzɜːv/ | 保留；保护
resilience | /rɪˈzɪliəns/ | 韧性；恢复力
keep track of | 了解动态；跟踪
timely practical support | 及时的实际支持`;

export function recordStudy(state, word, now = Date.now()) {
  const key = normWord(word); if (!key) return;
  state.study ||= {}; const previous = state.study[key];
  state.study[key] = { firstAt: previous?.firstAt ?? now, lastAt: now };
}
export function studyStats(state, now = Date.now()) {
  const date = value => { const d = new Date(value); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const today = date(now), records = state.study || {}, learned = new Set(Object.keys(records));
  for (const book of state.books) for (const word of book.words) if (word.mastered || word.listenMastered || word.speakMastered || word.writeMastered || word.review?.lastAt) learned.add(normWord(word.en));
  for (const c of state.maple?.collections || []) for (const e of c.entries) if (Object.values(e.progress).some(p => p.stage || p.streak)) learned.add(normWord(e.word));
  return { total: learned.size, today: Object.values(records).filter(r => date(r.lastAt) === today).length, goal: state.settings.dailyGoal || 20 };
}
