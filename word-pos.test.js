import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, parseImport, importEntries, normalizeState, normalizePOS, formatBookText, startSession, currentItem } from './core.js';
import { backupText, parseBackup } from './storage.js';
import { extractVocabulary, saveAIKey } from './ai.js';

test('词性格式识别三列与四列，兼容旧音标列和多释义列', () => {
  const parsed = parseImport('annual | adjective | 每年的\ncommit | /kəˈmɪt/ | verb / noun | 承诺；投入\ncat | /kæt/ | 猫\napple | 苹果\nold | /əʊld/ | 老的 | 年老的');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries[0].pos, 'adj.'); assert.equal(parsed.entries[0].phonetic, '');
  assert.equal(parsed.entries[1].pos, 'v. / n.'); assert.equal(parsed.entries[1].phonetic, '/kəˈmɪt/');
  assert.deepEqual(parsed.entries[1].defs, ['承诺', '投入']);
  assert.equal(parsed.entries[2].phonetic, '/kæt/'); assert.equal(parsed.entries[2].pos, '');
  assert.equal(parsed.entries[3].pos, '');
  assert.deepEqual(parsed.entries[4].defs, ['老的', '年老的']);
  assert.equal(parseImport('sound | /v/ | 声音').entries[0].phonetic, '/v/');
  assert.equal(parseImport('bad | n. |').errors[0].message, '缺少中文释义');
});

test('中文/英文/缩写词性归一化、多词性去重，释义标注识别但不猜测未标注词', () => {
  assert.equal(normalizePOS(['名词 / verb', 'n. / 形容词']), 'n. / v. / adj.');
  assert.equal(normalizePOS('constructor'), 'constructor');
  const parsed = parseImport('stress | n. 压力；v. 强调\nresilient | 有韧性的');
  assert.equal(parsed.entries[0].pos, 'n. / v.'); assert.equal(parsed.entries[1].pos, '');
  assert.deepEqual(parsed.entries[0].defs, ['n. 压力', 'v. 强调']);
});

test('词性合并、导出再导入、完整备份恢复与练习题均保留词性', () => {
  const state = freshState();
  const { book } = importEntries(state, parseImport('contrast | n. | 对比\nannual | /ˈænjuəl/ | adj. | 每年的').entries, '词性词书');
  importEntries(state, parseImport('contrast | verb | 对照').entries, '', book.id);
  assert.equal(book.words[0].pos, 'n. / v.');
  const output = formatBookText(book), roundtrip = parseImport(output);
  assert.deepEqual(roundtrip.errors, []);
  assert.deepEqual(roundtrip.entries.map(e => e.pos), ['n. / v.', 'adj.']);
  assert.deepEqual(roundtrip.entries.map(e => e.phonetic), ['', '/ˈænjuəl/']);
  const session = startSession(state, book.id, 'read');
  assert.equal(currentItem(session).pos, book.words.find(w => w.en === currentItem(session).en).pos);
  const restored = parseBackup(backupText(state));
  assert.equal(restored.books[0].words[0].pos, 'n. / v.');
  assert.equal(currentItem(restored.sessions[session.key]).pos, currentItem(session).pos);
  delete session.active[0].pos;
  assert.ok(normalizeState(state).sessions[session.key].active[0].pos);
});

test('旧词书从已有释义标注恢复词性，未标注旧词书不编造词性', () => {
  const state = freshState(), { book } = importEntries(state, parseImport('run | 跑\ncat | 猫').entries, '旧词书');
  delete book.words[0].pos; book.words[0].defs = ['v. 跑']; delete book.words[1].pos;
  const restored = normalizeState(state);
  assert.equal(restored.books[0].words[0].pos, 'v.'); assert.equal(restored.books[0].words[1].pos, '');
});

test('AI 导入要求按语境识别词性，保留返回的多词性、标注及不确定空值', async () => {
  const original = globalThis.fetch;
  saveAIKey('test-only');
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /"pos"/); assert.match(body.messages[0].content, /按文档语境识别词性/);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ name: '词性测试', entries: [
      { en: 'annual', pos: 'adjective', defs: ['每年的'] },
      { en: 'contrast', pos: ['noun', 'verb'], defs: ['对比'] },
      { en: 'run', defs: ['v. 跑'] },
      { en: 'uncertain', pos: '', defs: ['不确定的'] }
    ] }) }, finish_reason: 'stop' }] });
  };
  try {
    const result = await extractVocabulary({ aiEnabled: true, aiBase: 'https://mock.example/v1', aiModel: 'test-model' }, 'word list', 'test', '');
    assert.deepEqual(result.entries.map(e => e.pos), ['adj.', 'n. / v.', 'v.', '']);
  } finally { globalThis.fetch = original; saveAIKey(''); }
});
