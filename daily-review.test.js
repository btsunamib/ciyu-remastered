import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, importEntries, parseImport, dailyReviewBooks, dailyReviewCount, setDailyReview, buildItems, startSession, sessionKey, normalizeState, migrateLegacy } from './core.js';
import { backupText, parseBackup } from './storage.js';

function fixture() {
  const state = freshState();
  const a = importEntries(state, parseImport('apple | 苹果\nbanana | 香蕉').entries, '词书 A').book;
  const b = importEntries(state, parseImport('cat | 猫').entries, '词书 B').book;
  for (const book of state.books) for (const word of book.words) word.review = { stage: 3, dueAt: 100, lastAt: 50, lapses: 1 };
  a.words[1].review.dueAt = 2000;
  return { state, a, b };
}

test('新词书和缺少设置的旧词书默认不加入每日复习，显式 true 才加入', () => {
  const { state, a, b } = fixture();
  assert.equal(a.dailyReview, false); assert.equal(b.dailyReview, false);
  assert.equal(dailyReviewCount(state, 1000), 0);
  assert.deepEqual(buildItems(state, 'all', 'review', false, 1000), []);
  delete a.dailyReview; b.dailyReview = 'true';
  const normalized = normalizeState(state);
  assert.ok(normalized.books.every(book => book.dailyReview === false));
  assert.equal(migrateLegacy({ ...state, version: 1 }).books[0].dailyReview, false);
});

test('每日数量和全书队列只包含勾选且到期的词书，单书练习仍可手动使用', () => {
  const { state, a, b } = fixture();
  setDailyReview(state, a.id, true);
  assert.deepEqual(dailyReviewBooks(state).map(book => book.id), [a.id]);
  assert.equal(dailyReviewCount(state, 1000), 1);
  assert.deepEqual(buildItems(state, 'all', 'review', false, 1000).map(item => item.en), ['apple']);
  assert.equal(buildItems(state, b.id, 'review', false, 1000).length, 1);
  setDailyReview(state, b.id, true);
  assert.equal(dailyReviewCount(state, 1000), 2);
  assert.equal(startSession(state, 'all', 'review', { now: 1000 }).initialTotal, 2);
});

test('取消勾选清除旧每日队列，保留词书进度和其他练习；重新勾选可再次复习', () => {
  const { state, a, b } = fixture();
  setDailyReview(state, a.id, true); setDailyReview(state, b.id, true);
  const read = startSession(state, a.id, 'read');
  startSession(state, 'all', 'review', { now: 1000 });
  const before = structuredClone(a.words);
  setDailyReview(state, a.id, false);
  assert.equal(state.sessions[sessionKey('all', 'review')], undefined);
  assert.equal(state.sessions[read.key], read);
  assert.deepEqual(a.words, before);
  assert.deepEqual(startSession(state, 'all', 'review', { now: 1000 }).active.map(item => item.en), ['cat']);
  setDailyReview(state, b.id, false);
  assert.equal(startSession(state, 'all', 'review', { now: 1000 }), null);
  setDailyReview(state, a.id, true);
  assert.equal(startSession(state, 'all', 'review', { now: 1000 }).active[0].en, 'apple');
});

test('备份保留勾选与进度，旧每日断点不能恢复未勾选词书的单词', () => {
  const { state, a, b } = fixture();
  setDailyReview(state, a.id, true); setDailyReview(state, b.id, true);
  const all = startSession(state, 'all', 'review', { now: 1000 });
  const restored = parseBackup(backupText(state));
  assert.ok(restored.books.every(book => book.dailyReview === true));
  assert.equal(restored.sessions[all.key].initialTotal, 2);
  assert.deepEqual(restored.books[0].words[0].review, a.words[0].review);
  b.dailyReview = false; // Simulate an old or inconsistent saved queue.
  assert.equal(normalizeState(state).sessions[all.key], undefined);
  assert.deepEqual(startSession(state, 'all', 'review', { now: 1000 }).active.map(item => item.en), ['apple']);
  const legacy = migrateLegacy({ ...state, version: 1, review: { bookId: 'all', active: [{ bookId: b.id, wid: b.words[0].id }] } });
  assert.equal(legacy.sessions[all.key], undefined);
});
