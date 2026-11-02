// Shared scheduling for ordinary words and independent LAP skills.
export const DAY = 86400e3;
export const FIRST_REVIEW = 20 * 60e3;
export const RELEARN_REVIEW = 10 * 60e3;
export const MAX_REVIEW = 180 * DAY;
const bounded = (value, fallback, min, max) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const count = value => Math.floor(bounded(value, 0, 0, 1e6));
export function adaptiveFields(record) {
  if (record?.scheduleVersion !== 1) return {};
  return {
    scheduleVersion: 1, intervalMs: bounded(record.intervalMs, FIRST_REVIEW, RELEARN_REVIEW, MAX_REVIEW),
    successCount: count(record.successCount), reviewStreak: count(record.reviewStreak), failureCount: count(record.failureCount),
    easeFactor: bounded(record.easeFactor, 2.2, 1.3, 2.8), lastResult: typeof record.lastResult === 'boolean' ? record.lastResult : null,
    lastAt: bounded(record.lastAt, null, 0, 864e13)
  };
}
export function initialReview(now = Date.now()) {
  return { ...adaptiveFields({ scheduleVersion: 1 }), lastAt: now, dueAt: now + FIRST_REVIEW };
}
export function scheduleReview(record, correct, now = Date.now(), legacy = {}) {
  const inferred = Number.isFinite(record?.lastAt) && record.dueAt > record.lastAt ? record.dueAt - record.lastAt : legacy.intervalMs;
  const memory = record?.scheduleVersion === 1 ? adaptiveFields(record) : {
    scheduleVersion: 1, intervalMs: bounded(inferred, FIRST_REVIEW, RELEARN_REVIEW, MAX_REVIEW),
    successCount: count(legacy.successCount), reviewStreak: count(legacy.reviewStreak), failureCount: count(legacy.failureCount),
    easeFactor: 2.2, lastResult: null, lastAt: Number.isFinite(record?.lastAt) ? record.lastAt : null
  };
  // Repeating a just-seen answer is practice, not evidence of longer retention.
  if (correct && Number.isFinite(record?.dueAt) && now < record.dueAt) return { ...memory, dueAt: record.dueAt };
  if (!correct) return {
    ...memory, reviewStreak: 0, failureCount: memory.failureCount + 1, easeFactor: Math.max(1.3, memory.easeFactor - .2),
    intervalMs: RELEARN_REVIEW, lastAt: now, dueAt: now + RELEARN_REVIEW, lastResult: false
  };
  const reviewStreak = memory.reviewStreak + 1, easeFactor = Math.min(2.8, memory.easeFactor + .05);
  // Remembering an overdue word earns a bounded bonus, rather than an unbounded jump.
  const elapsed = memory.lastAt === null ? memory.intervalMs : Math.max(0, now - memory.lastAt);
  const retainedInterval = Math.max(memory.intervalMs, Math.min(elapsed, memory.intervalMs * 1.5));
  let intervalMs = reviewStreak === 1 ? DAY : reviewStreak === 2 ? Math.max(3 * DAY, memory.intervalMs * easeFactor) : retainedInterval * (easeFactor + Math.min(.3, reviewStreak * .03));
  intervalMs = Math.min(MAX_REVIEW, Math.max(DAY, Math.round(intervalMs / 3600e3) * 3600e3));
  return { ...memory, successCount: memory.successCount + 1, reviewStreak, easeFactor, intervalMs, lastAt: now, dueAt: now + intervalMs, lastResult: true };
}
