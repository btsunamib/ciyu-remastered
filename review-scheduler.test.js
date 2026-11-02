import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, FIRST_REVIEW, RELEARN_REVIEW, MAX_REVIEW, initialReview, scheduleReview, adaptiveFields } from './review-scheduler.js';
import { freshState, parseImport, importEntries, startSession, currentItem, gradeAnswer, correctToWrong, advanceSession, ensureReview, normalizeState, planWordReview } from './core.js';
import { normalizeEntries, updateProgress } from './lap-core.js';
import { backupText, parseBackup } from './storage.js';

function wordFixture() {
  const state = freshState(), { book } = importEntries(state, parseImport('create | 创造').entries, '记忆测试');
  book.dailyReview = true; const word = book.words[0]; ensureReview(word, 1000);
  return { state, book, word };
}
const lapFixture = () => normalizeEntries([{ word: 'create', meaning: '创造', forms: { verb: ['create'], noun: ['creation'], adjective: ['creative'] } }], true)[0];

test('连续到期答对逐步延长，越过旧30天上限，最终有180天上限', () => {
  let memory = initialReview(1000), previousInterval = FIRST_REVIEW;
  const intervals = [];
  for (let i = 0; i < 12; i++) {
    memory = scheduleReview(memory, true, memory.dueAt);
    assert.ok(memory.intervalMs >= previousInterval);
    assert.ok(memory.intervalMs <= MAX_REVIEW);
    assert.equal(memory.successCount, i + 1); assert.equal(memory.reviewStreak, i + 1);
    intervals.push(memory.intervalMs); previousInterval = memory.intervalMs;
  }
  assert.deepEqual(intervals.slice(0, 2), [DAY, 3 * DAY]);
  assert.ok(intervals[4] > 30 * DAY); assert.equal(intervals.at(-1), MAX_REVIEW);
});

test('答错重置连续记忆并缩至10分钟，立即重答不算长期记住，到期后能恢复', () => {
  let memory = initialReview(1000);
  for (let i = 0; i < 5; i++) memory = scheduleReview(memory, true, memory.dueAt);
  const successes = memory.successCount, now = memory.dueAt;
  memory = scheduleReview(memory, false, now);
  assert.equal(memory.reviewStreak, 0); assert.equal(memory.failureCount, 1);
  assert.equal(memory.intervalMs, RELEARN_REVIEW); assert.equal(memory.successCount, successes);
  const immediate = scheduleReview(memory, true, now + 1000);
  assert.deepEqual(immediate, memory);
  const recovered = scheduleReview(memory, true, memory.dueAt);
  assert.equal(recovered.reviewStreak, 1); assert.equal(recovered.intervalMs, DAY);
  assert.equal(recovered.failureCount, 1); assert.equal(recovered.successCount, successes + 1);
});

test('大量历史错误不永久压低间隔，提前练习不推迟原到期日，迟到奖励有上限', () => {
  let memory = initialReview(1000);
  for (let i = 0; i < 20; i++) memory = scheduleReview(memory, false, memory.dueAt);
  for (let i = 0; i < 12; i++) memory = scheduleReview(memory, true, memory.dueAt);
  assert.equal(memory.failureCount, 20); assert.equal(memory.intervalMs, MAX_REVIEW);
  assert.deepEqual(scheduleReview(memory, true, memory.lastAt + 1), memory);
  const late = scheduleReview(memory, true, memory.dueAt + 10 * 365 * DAY);
  assert.equal(late.intervalMs, MAX_REVIEW);
});

test('普通复习在确认继续时更新；改判、错后重答、刷新恢复不重复奖励', () => {
  const { state, word } = wordFixture(), now = word.review.dueAt;
  let session = startSession(state, 'all', 'review', { now });
  const before = structuredClone(word.review);
  gradeAnswer(state, session, true, now);
  assert.deepEqual(word.review, before); // Feedback preview does not commit.
  assert.equal(correctToWrong(state, session, now), true);
  advanceSession(state, session, now);
  assert.equal(word.review.failureCount, 1); assert.equal(word.review.reviewStreak, 0);
  assert.equal(word.review.intervalMs, RELEARN_REVIEW);
  gradeAnswer(state, session, true, now + 1000);
  const restored = parseBackup(backupText(state)); session = restored.sessions[session.key];
  advanceSession(restored, session, now + 1000);
  const savedWord = restored.books[0].words[0];
  assert.equal(savedWord.review.successCount, 0); assert.equal(savedWord.review.dueAt, now + RELEARN_REVIEW);
  session = startSession(restored, 'all', 'review', { now: savedWord.review.dueAt });
  gradeAnswer(restored, session, true, savedWord.review.dueAt);
  advanceSession(restored, session, savedWord.review.dueAt);
  assert.equal(savedWord.review.intervalMs, DAY); assert.equal(savedWord.review.successCount, 1);
  assert.equal(currentItem(session), null);
});

test('旧普通词书保持原到期日和阶段，到下一次复习平滑采用新规则', () => {
  const { state, word } = wordFixture();
  word.review = { stage: 8, dueAt: 9 * DAY, lastAt: DAY, lapses: 12 };
  const restored = normalizeState(state).books[0].words[0];
  assert.deepEqual(restored.review, word.review);
  assert.equal(planWordReview(restored, true, restored.review.dueAt - 1).dueAt, restored.review.dueAt);
  const plan = planWordReview(restored, true, restored.review.dueAt);
  assert.equal(plan.scheduleVersion, 1); assert.equal(plan.intervalMs, DAY);
  assert.equal(plan.failureCount, 12);
});

test('LAP各技能独立调度，练习全部的提前作答不刷长间隔，备份保留新字段', () => {
  const entry = lapFixture(), state = freshState();
  updateProgress(entry, 'forms', true, 1000);
  const first = structuredClone(entry.progress.forms);
  assert.equal(first.dueAt, 1000 + DAY); assert.equal(first.successCount, 1);
  updateProgress(entry, 'forms', true, 2000); assert.deepEqual(entry.progress.forms, first);
  updateProgress(entry, 'forms', true, first.dueAt); assert.equal(entry.progress.forms.intervalMs, 3 * DAY);
  updateProgress(entry, 'spelling', false, 3000);
  assert.equal(entry.progress.spelling.failureCount, 1); assert.equal(entry.progress.forms.failureCount, 0);
  assert.equal(entry.progress.meaning.dueAt, 0);
  state.maple.collections.push({ id: 'lap', name: 'LAP', entries: [entry], papers: [], activePaperId: '' });
  const restored = parseBackup(backupText(state)).maple.collections[0].entries[0];
  assert.deepEqual(restored.progress.forms, entry.progress.forms);
  assert.deepEqual(restored.progress.spelling, entry.progress.spelling);
});

test('新调度字段校验边界，未知版本和缺失字段不会制造无效计时', () => {
  assert.deepEqual(adaptiveFields({ scheduleVersion: 99 }), {});
  const fields = adaptiveFields({ scheduleVersion: 1, intervalMs: Infinity, easeFactor: -10, reviewStreak: NaN, successCount: -1, lastAt: null });
  assert.equal(fields.intervalMs, FIRST_REVIEW); assert.equal(fields.easeFactor, 1.3);
  assert.equal(fields.lastAt, null); assert.equal(fields.successCount, 0); assert.equal(fields.reviewStreak, 0);
});
