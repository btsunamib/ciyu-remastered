import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState, parseImport, importEntries, decodeText, bookStats, startSession, currentItem, gradeAnswer,
  advanceSession, correctToWrong, revealSpeaking, setMastery, spellingMatches, normalizeState,
  migrateLegacy, INTERVALS, removeWord, sessionKey
} from './core.js';
import { pronunciationURL } from './audio.js';
import { loadState, parseBackup, backupText } from './storage.js';
function fixture(text = 'apple | 苹果') { const state = freshState(); const { book } = importEntries(state, parseImport(text).entries, '测试词书'); return { state, book }; }
const next = (state, session, answer, now = 1000) => { gradeAnswer(state, session, answer, now); return advanceSession(state, session, now); };
test('导入保留音标、多个释义、同义表达、错误行和注释', () => {
  const parsed = parseImport('# 注释\nlook after / take care of | /lʊk/ | 照顾；照料\napple\nrun\t/rʌn/\t跑；运行');
  assert.equal(parsed.entries.length, 2); assert.deepEqual(parsed.entries[0].ens, ['look after', 'take care of']);
  assert.equal(parsed.entries[1].phonetic, '/rʌn/'); assert.equal(parsed.errors[0].line, 3);
});
test('重复导入合并释义，同义组在写作中合并、其他模式拆开', () => {
  const { state, book } = fixture('look after | 照顾');
  importEntries(state, parseImport('look after / take care of | 照料').entries, '', book.id);
  assert.equal(book.words.length, 2); assert.deepEqual(book.words[0].defs, ['照顾', '照料']);
  assert.equal(startSession(state, book.id, 'read').initialTotal, 2);
  const write = startSession(state, book.id, 'write'); assert.equal(write.initialTotal, 1); assert.equal(currentItem(write).ens.length, 2);
});
test('TXT 解码支持 UTF-8、UTF-16LE 和 GB18030', () => {
  assert.equal(decodeText(new TextEncoder().encode('apple | 苹果').buffer), 'apple | 苹果');
  const utf16 = Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('apple | 苹果', 'utf16le')]);
  assert.equal(decodeText(utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.byteLength)), 'apple | 苹果');
  assert.equal(decodeText(Uint8Array.from([0xc6,0xbb,0xb9,0xfb]).buffer), '苹果');
});
test('认读连续正确达标，错误清零，手动确认前不会切题或掌握', () => {
  const { state, book } = fixture(); const s = startSession(state, book.id, 'read');
  next(state, s, true); next(state, s, true); next(state, s, false); assert.equal(currentItem(s).streak, 0);
  next(state, s, true); next(state, s, true); const id = s.currentId;
  gradeAnswer(state, s, true); assert.equal(s.phase, 'feedback'); assert.equal(s.currentId, id); assert.equal(book.words[0].mastered, false);
  const result = advanceSession(state, s); assert.equal(result.finished, true); assert.equal(book.words[0].mastered, true);
});
test('认识后可改判，撤销答对数且只计一次作答', () => {
  const { state, book } = fixture(); const s = startSession(state, book.id, 'read');
  gradeAnswer(state, s, true); assert.equal(correctToWrong(state, s), true);
  assert.equal(s.tick, 1); assert.equal(s.right, 0); assert.equal(s.wrong, 1); assert.equal(currentItem(s).streak, 0);
  assert.equal(correctToWrong(state, s), false);
});
test('听力必须同时达到听写 1 次和听音连续认识 2 次，听写错不清零听音', () => {
  const { state, book } = fixture(); const s = startSession(state, book.id, 'listen');
  s.type = 'recog'; next(state, s, true); s.type = 'recog'; next(state, s, true);
  assert.equal(book.words[0].listenMastered, false); s.type = 'dict'; next(state, s, 'appl'); assert.equal(currentItem(s).streak, 2);
  s.type = 'dict'; const done = next(state, s, ' Apple! '); assert.equal(done.finished, true);
  assert.equal(book.words[0].listenMastered, true); assert.equal(book.words[0].mastered, false);
});
test('口语两个方向各说对两次，不认识保留已完成次数', () => {
  const { state, book } = fixture(); const s = startSession(state, book.id, 'speak');
  for (const type of ['zh2en', 'en2zh', 'zh2en']) { s.type = type; revealSpeaking(s); next(state, s, true); }
  s.type = 'en2zh'; revealSpeaking(s); next(state, s, false); assert.equal(currentItem(s).zh2enRight, 2);
  s.type = 'en2zh'; revealSpeaking(s); next(state, s, true); assert.equal(book.words[0].speakMastered, true);
  assert.ok(book.words[0].review);
});
test('写作必须写全同义表达，允许乱序，不允许遗漏或多写', () => {
  const item = { ens: ['look after', 'take care of'] };
  assert.equal(spellingMatches(item, 'Take care of / LOOK AFTER', true), true);
  assert.equal(spellingMatches(item, 'look after', true), false);
  assert.equal(spellingMatches(item, 'look after / take care of / care', true), false);
  const { state, book } = fixture('look after / take care of | 照顾'); const s = startSession(state, book.id, 'write');
  next(state, s, 'look after / take care of'); next(state, s, 'look after'); assert.equal(currentItem(s).right, 1);
  next(state, s, 'take care of\nlook after'); assert.equal(book.words.every(w => w.writeMastered), true);
});
test('工作集只放设置数量，掌握一个后补一个新词', () => {
  const { state, book } = fixture(Array.from({ length: 20 }, (_, i) => `word${i} | 词${i}`).join('\n'));
  state.settings.batch = 5; state.settings.target = 2; const s = startSession(state, book.id, 'read');
  assert.equal(s.active.length, 5); assert.equal(s.queue.length, 15); const item = currentItem(s);
  item.streak = 1; next(state, s, true); assert.equal(s.active.length, 5); assert.equal(s.queue.length, 14);
});
test('随机旧词回访：认识一次返回，忘记后需要重新达到目标', () => {
  const { state, book } = fixture('old | 旧词\nnew | 新词');
  book.words[0].mastered = true; state.settings.mixOld = true; state.settings.mixEvery = 1; state.settings.target = 2;
  const s = startSession(state, book.id, 'read'); next(state, s, true); next(state, s, true);
  assert.equal(s.active.length, 2); // Previously mastered word and the just-mastered word may both be revisited.
  const oldItem = s.active.find(i => i.en === 'old'); s.currentId = oldItem.id; s.phase = 'question'; next(state, s, false);
  assert.equal(book.words[0].mastered, false); s.currentId = oldItem.id; s.phase = 'question'; next(state, s, true);
  assert.equal(book.words[0].mastered, false); s.currentId = oldItem.id; s.phase = 'question'; next(state, s, true);
  assert.equal(book.words[0].mastered, true);
});
test('审查包含已掌握词，每个词仅一次，拼错标记后立即可继续', () => {
  const { state, book } = fixture('apple | 苹果\nbanana | 香蕉'); book.words.forEach(w => { w.listenMastered = true; });
  const s = startSession(state, book.id, 'audit'); assert.equal(s.initialTotal, 2);
  const wrongId = currentItem(s).wordIds[0]; next(state, s, 'wrong');
  assert.equal(s.active.length, 1); assert.equal(book.words.find(w => w.id === wrongId).auditWrong, true);
  assert.equal(book.words.find(w => w.id === wrongId).listenMastered, false);
  const done = next(state, s, currentItem(s).en); assert.equal(done.finished, true); assert.equal(done.result.auditWrongIds.length, 1);
});
test('复习只收集到期词，正确延长间隔，忘记回退并在本轮再考', () => {
  const { state, book } = fixture('apple | 苹果\nbanana | 香蕉');
  book.words[0].review = { stage: 1, dueAt: 1, lapses: 0 }; book.words[1].review = { stage: 1, dueAt: 200000, lapses: 0 };
  const s = startSession(state, 'all', 'review', { now: 1000 }); assert.equal(s.initialTotal, 1);
  next(state, s, false, 1000); assert.equal(s.active.length, 1); assert.equal(book.words[0].review.dueAt, 1000 + INTERVALS[0]);
  next(state, s, true, 2000); assert.equal(book.words[0].review.stage, 2); assert.ok(book.words[0].review.dueAt > 2000);
});
test('各本词书、各模式的断点独立，检查后反馈状态可完整恢复', () => {
  const { state, book } = fixture(); const read = startSession(state, book.id, 'read');
  const second = importEntries(state, parseImport('banana | 香蕉').entries, '第二本').book;
  startSession(state, second.id, 'read'); startSession(state, book.id, 'listen'); gradeAnswer(state, read, true);
  const restored = parseBackup(backupText(state)); assert.equal(Object.keys(restored.sessions).length, 3);
  assert.equal(restored.sessions[read.key].phase, 'feedback'); assert.equal(currentItem(restored.sessions[read.key]).streak, 1);
});
test('删除同义组中的词时，不留下要求已删除答案的旧练习', () => {
  const { state, book } = fixture('look after / take care of | 照顾'); startSession(state, book.id, 'write');
  removeWord(state, book.id, book.words[1].id); assert.equal(state.sessions[sessionKey(book.id, 'write')], undefined);
  assert.deepEqual(currentItem(startSession(state, book.id, 'write')).ens, ['look after']);
});
test('手动掌握支持单模式和全部模式，标记未掌握会清理对应复习计划', () => {
  const { state, book } = fixture(); const id = book.words[0].id;
  setMastery(state, book.id, id, 'speak', true, 1000); assert.equal(book.words[0].speakMastered, true); assert.equal(book.words[0].mastered, false);
  setMastery(state, book.id, id, 'all', false); assert.equal(book.words[0].review, null);
});
test('旧版词书、独立进度、设置和练习计数都能迁移', () => {
  const old = { version: 1, theme: 'dark', settings: { batch: 5, target: 4 }, books: [{ id: 'b', name: '旧词书', words: [{ id: 'w', en: 'apple', defs: ['苹果'], mastered: true, listenMastered: false }] }],
    listen: { bookId: 'b', active: [{ wid: 'w', en: 'apple', dictRight: 1, streak: 1 }], queue: [], askedCount: 7, rightCount: 3 } };
  const state = migrateLegacy(old); assert.equal(state.settings.theme, 'dark'); assert.equal(state.books[0].words[0].mastered, true);
  assert.equal(currentItem(state.sessions['b:listen']).dictRight, 1); assert.equal(state.sessions['b:listen'].tick, 7);
});
test('首次访问读取旧版数据时不删除或覆盖旧版键', () => {
  const { state } = fixture(); const map = new Map([['ciyu.vocab.v1', JSON.stringify({ ...state, version: 1 })]]);
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const result = loadState(storage); assert.equal(result.migrated, true); assert.ok(map.get('ciyu.vocab.v1')); assert.ok(map.get('ciyu.remastered.v2'));
});
test('英语音源是独立音频链接，支持口音、编码和自定义音源', () => {
  assert.equal(pronunciationURL('look after', { accent: 'uk' }), 'https://dict.youdao.com/dictvoice?audio=look%20after&type=1');
  assert.ok(pronunciationURL('hello', { accent: 'us' }).endsWith('type=2'));
  assert.equal(pronunciationURL('a & b', { accent: 'us', audioTemplate: 'https://example.com/{text}?accent={accent}' }), 'https://example.com/a%20%26%20b?accent=2');
});
test('备份验证拒绝无效结构，恢复时保留进度与复习时间', () => {
  assert.throws(() => normalizeState({}), /有效/); assert.throws(() => parseBackup('{broken'), /JSON/);
  const { state, book } = fixture(); setMastery(state, book.id, book.words[0].id, 'all', true, 1000);
  const restored = parseBackup(backupText(state)); assert.equal(bookStats(restored.books[0], 1000).read, 1); assert.equal(restored.books[0].words[0].review.dueAt, 1000 + INTERVALS[0]);
});
