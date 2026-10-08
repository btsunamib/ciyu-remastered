import test from 'node:test';
import assert from 'node:assert/strict';
import { POS, availablePOS, examPOS, examConfig, normalizeMaple, normalizeEntries, parseLAPJSON, mergeEntries, createPaper, checkForms, hasTargetInDefinition, validateGrades, updateProgress, startPractice } from './lap-core.js';
import { freshState, normalizeState } from './core.js';
import { backupText, parseBackup } from './storage.js';
import { modelsURL, fetchModels, saveAIKey } from './ai.js';
import { extractLAP, generateCorrections, gradePaper, gradeMeaning } from './lap-ai.js';

const families = [
  ['create','creation','creative','creatively'], ['act','action','active','actively'], ['decide','decision','decisive','decisively'],
  ['succeed','success','successful','successfully'], ['differ','difference','different','differently'], ['compete','competition','competitive','competitively'],
  ['inform','information','informative','informatively'], ['educate','education','educational','educationally'], ['protect','protection','protective','protectively'],
  ['care','care','careful','carefully'], ['help','help','helpful','helpfully'], ['attract','attraction','attractive','attractively']
];
function fixture(count = 12) {
  return { id: 'lap-one', name: 'LAP 1', entries: normalizeEntries(families.slice(0, count).map(([verb, noun, adjective, adverb], i) => ({ id: `word-${i}`, word: verb, meaning: '准确中文词义', forms: { noun: [{ text: noun, meaning: '名词释义' }], verb: [{ text: verb, meaning: '动词释义' }], adjective: [{ text: adjective, meaning: '形容词释义' }], adverb: [{ text: adverb, meaning: '副词释义' }] } })), true), papers: [], activePaperId: '' };
}
const settings = { aiEnabled: true, aiBase: 'https://mock.example/v1', aiModel: 'vision-model', aiJsonMode: false };
async function mockAI(handler, work) {
  const original = globalThis.fetch; saveAIKey('test-only-key');
  globalThis.fetch = async (url, options) => {
    const response = await handler(url, options?.body ? JSON.parse(options.body) : null, options);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { return await work(); } finally { globalThis.fetch = original; saveAIKey(''); }
}
const completion = data => ({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] });

test('模型列表由基础地址或完整对话接口推导，不接受不安全地址', async () => {
  assert.equal(modelsURL('https://mock.example/v1/chat/completions/'), 'https://mock.example/v1/models');
  assert.equal(modelsURL('https://api.deepseek.com'), 'https://api.deepseek.com/models');
  assert.equal(modelsURL('http://mock.example/v1'), 'http://mock.example/v1/models');
  assert.throws(() => modelsURL('ftp://mock.example/v1'));
  assert.throws(() => modelsURL('https://key:secret@mock.example/v1'));
  await mockAI((url, body, options) => {
    assert.equal(url, settings.aiBase + '/models'); assert.equal(body, null); assert.equal(options.credentials, 'omit');
    return { data: [{ id: 'z-model' }, { id: 'vision-model' }, { id: 'vision-model' }, {}, { id: '' }] };
  }, async () => assert.deepEqual(await fetchModels(settings), ['vision-model','z-model']));
});
test('LAP 保留多词形与空格，严格识别不完整数据，分段合并不丢词形', () => {
  const c = fixture(1); c.entries[0].forms.noun.push({ text: 'creator', meaning: '创造者' }); c.entries[0].forms.adverb = [];
  const clean = normalizeEntries(c.entries, true)[0];
  assert.equal(clean.forms.noun.length, 2); assert.equal(clean.forms.adverb, undefined); assert.equal(availablePOS(clean).length, 3);
  const partial = structuredClone(clean); partial.forms.noun = [{ text: 'creativity', meaning: '创造力' }];
  const merged = mergeEntries([clean, partial]); assert.equal(merged.length, 1); assert.equal(merged[0].forms.noun.length, 3);
  assert.throws(() => normalizeEntries([{ word: 'create', meaning: '', forms: {} }], true), /词形/);
  assert.throws(() => normalizeEntries([{ word: 'missing', meaning: '含义', forms: { verb: ['create'] } }], true), /主词/);
});
test('默认三类各三题，忽略旧释义题配置，禁止重复覆盖全卷词族，题目保存独立词表快照', () => {
  const c = fixture(), p = createPaper(c);
  assert.equal(p.questions.length, 9); assert.equal(new Set(p.questions.map(q => q.entry.id)).size, 9);
  for (const section of ['forms','sentences','corrections']) assert.equal(p.questions.filter(q => q.section === section).length, 3);
  c.entries.forEach(e => e.meaning = '改过的释义'); assert.equal(p.questions[0].entry.meaning, '准确中文词义');
});
test('听写至少三个词性，缺少格子不评分；禁止重复时不足必须报错', () => {
  const c = fixture(4); c.entries.push(...normalizeEntries([{ word: 'cat', meaning: '猫', forms: { noun: ['cat'] } }], true));
  const p = createPaper(c, { forms: 3, meanings: 1, sentences: 1, corrections: 0 });
  assert.ok(p.questions.filter(q => q.section === 'forms').every(q => availablePOS(q.entry).length >= 3));
  assert.throws(() => createPaper(c), /需要 9/);
  delete c.entries[0].forms.adjective; delete c.entries[0].forms.adverb;
  assert.throws(() => createPaper(c, { forms: 4, meanings: 0, sentences: 0, corrections: 0 }), /只有 3/);
});
test('允许重复仍优先未出现词族，可自定义题数及关闭单一题型', () => {
  const p = createPaper(fixture(2), { forms: 3, meanings: 3, sentences: 0, corrections: 0, repeatWords: true }, () => 0);
  assert.equal(p.questions.length, 3); assert.notEqual(p.questions[0].entry.id, p.questions[1].entry.id);
  assert.throws(() => createPaper(fixture(), { forms: -1 }), /0–20/);
  assert.throws(() => createPaper(fixture(), { forms: 0, meanings: 0, sentences: 0, corrections: 0 }), /至少/);
});
test('词形转换接受任意一个正确词形，允许多形式乱序，拒绝空白或夹带错误词', () => {
  const e = fixture(1).entries[0]; e.forms.noun.push({ text: 'creator', meaning: '创造者' });
  const answers = { noun: 'CREATOR / creation', verb: 'create', adjective: 'creative', adverb: 'creatively' };
  assert.ok(checkForms(e, answers).every(c => c.correct));
  answers.noun = 'creation'; assert.equal(checkForms(e, answers)[0].correct, true);
  answers.noun = 'CREATOR'; assert.equal(checkForms(e, answers)[0].correct, true);
  answers.noun = ''; assert.equal(checkForms(e, answers)[0].correct, false);
  answers.noun = 'cat'; assert.equal(checkForms(e, answers)[0].correct, false);
  answers.noun = 'creation/creator/cat'; assert.equal(checkForms(e, answers)[0].correct, false);
});
test('释义自包含按词边界检测并强制零分；AI 漏题、重复和越界评分被拒绝', () => {
  const e = fixture(1).entries[0]; assert.ok(hasTargetInDefinition('create 是创造', e)); assert.ok(hasTargetInDefinition('Something creative.', e)); assert.equal(hasTargetInDefinition('recreated ideas', e), false);
  const q = { id: 'q', entry: e, section: 'meanings', maxScore: 2, answer: 'create means 创造' };
  assert.equal(validateGrades([{ id:'q', score:2, feedback:'正确' }], [q])[0].score, 0);
  assert.throws(() => validateGrades([], [q]), /所有题/);
  assert.throws(() => validateGrades([{ id:'q', score:3, feedback:'正确' }], [q]), /无效评分/);
  assert.throws(() => validateGrades([{ id:'other', score:2, feedback:'正确' }], [q]), /无效评分/);
});
test('背诵三个维度独立复习，反馈和未完成试卷可完整备份恢复，密钥不入备份', () => {
  const c = fixture(), state = freshState(); c.practice = startPractice(c); assert.equal(c.practice.queue.length, 36);
  c.practice.feedback = { correct: false, text: '参考解释' }; c.practice.answer = { noun:'creation' };
  updateProgress(c.entries[0], 'spelling', true, 1000); assert.equal(c.entries[0].progress.spelling.dueAt, 1000 + 86400e3); assert.equal(c.entries[0].progress.forms.dueAt, 0);
  const p = createPaper(c); p.questions[0].answer = { noun: 'creation' }; p.questions.find(q => q.section === 'sentences').answer = 'My answer'; c.papers.push(p); c.activePaperId = p.id;
  state.maple.collections.push(c); state.settings.apiKey = 'must-not-export';
  const backup = backupText(state); assert.ok(!backup.includes('must-not-export'));
  const restored = parseBackup(backup).maple.collections[0]; assert.equal(restored.papers.length, 1); assert.equal(restored.activePaperId, p.id); assert.equal(restored.papers[0].questions.find(q => q.section === 'sentences').answer, 'My answer'); assert.equal(restored.practice.feedback.text, '参考解释'); assert.equal(restored.practice.queue.length, 36);
  assert.deepEqual(normalizeState({ ...freshState(), maple: undefined }).maple, { collections: [] });
});
test('文字与多个图片分段请求 AI，识别失败不返回半份词表', async () => {
  let calls = 0;
  await mockAI((url, body) => { calls++; const content = body.messages[1].content; if (calls > 1) assert.ok(content.some(c => c.type === 'image_url')); else assert.equal(typeof content, 'string'); return completion({ name:'LAP', entries: fixture(1).entries }); }, async () => {
    const result = await extractLAP(settings, { text:'词表文字', images:[{name:'1.png',url:'data:image/png;base64,AA=='},{name:'2.png',url:'data:image/png;base64,AA=='}] }); assert.equal(calls, 3); assert.equal(result.entries.length, 1);
  });
  calls = 0;
  await mockAI(() => completion({ entries: ++calls === 1 ? fixture(1).entries : [{}] }), async () => assert.rejects(extractLAP(settings, { text:'文字', images:[{name:'1.png',url:'data:image/png;base64,AA=='}] }), /主词/));
});
test('随机改错题严格匹配 ID、数量及 LAP 词族，参考不混入学生答案', async () => {
  const p = createPaper(fixture(), { forms:0, meanings:0, sentences:0, corrections:3 });
  await mockAI((url, body) => completion({ questions: JSON.parse(body.messages[1].content).map(q => ({ id:q.id, sentence:`She ${q.entry.word} every day.`, corrected:`They ${q.entry.word} every day.`, explanation:'主谓一致', errorType:'agreement' })) }), async () => {
    await generateCorrections(settings, p); assert.ok(p.questions.every(q => q.sentence && q.corrected && q.answer === ''));
  });
  await mockAI(() => completion({ questions:[] }), async () => assert.rejects(generateCorrections(settings, p), /数量/));
});
test('混合试卷合并词形分与 AI 主观分，空白作答为零', async () => {
  const p = createPaper(fixture(), { forms:1, meanings:1, sentences:1, corrections:1 });
  const forms = p.questions[0]; forms.answer = Object.fromEntries(availablePOS(forms.entry).map(pos => [pos, forms.entry.forms[pos].map(f => f.text).join('/') ]));
  p.questions[1].answer = 'A meaningful sentence.'; p.questions[2].answer = '';
  await mockAI((url, body) => completion({ grades:JSON.parse(body.messages[1].content).map(q => ({id:q.id,score:2,feedback:'正确',reference:'参考'})) }), async () => {
    const r = await gradePaper(settings, p); assert.equal(r.score, 6); assert.equal(r.maxScore, 8); assert.equal(r.grades.length, 3);
  });
});
test('词义背诵检查每个已有词性，取消请求后不能落下评分', async () => {
  const entry = fixture(1).entries[0];
  await mockAI((url, body) => { const batch = JSON.parse(body.messages[1].content); assert.equal(batch.length, 4); return completion({ grades: batch.map(q => ({id:q.id,score:2,feedback:'准确',reference:'词义'})) }); }, async () => {
    const result = await gradeMeaning(settings, entry, Object.fromEntries(Object.keys(POS).map(pos => [pos, '中文释义']))); assert.equal(result.correct, true);
  });
  const controller = new AbortController(); controller.abort();
  await mockAI((url, body, options) => { if (options.signal.aborted) throw new DOMException('cancelled','AbortError'); return completion({grades:[]}); }, async () => assert.rejects(gradeMeaning(settings, entry, {}, controller.signal), { name:'AbortError' }));
});


test('直接 JSON 导入保留过去式、大小写与源备注，N/A 不成为词形，缺释义可备份恢复', () => {
  const input = [
    { num: 8, word: 'phase', pos: 'noun', noun: 'phase', verb: 'phase', pastTense: 'phased', adjective: 'phased', adverb: '*Phasally (not common)' },
    { num: 10, word: 'predict', pos: 'verb', noun: 'prediction', verb: 'predict', pastTense: 'predicted', adjective: 'predictable / predictive', adverb: 'Predictably / predictively' },
    { num: 19, word: 'certain', pos: 'adjective', noun: 'certainty', verb: 'N/A', pastTense: 'N/A', adjective: 'certain', adverb: 'certainly' },
    { num: 29, word: 'hence', pos: 'adverb', noun: 'N/A', verb: 'N/A', pastTense: 'N/A', adjective: 'N/A', adverb: 'hence' },
    { word: 'trauma', noun: 'trauma', pastTense: 'tramatized' }
  ];
  const { entries, warnings } = parseLAPJSON('\uFEFF' + JSON.stringify(input), 'English 12');
  assert.equal(entries.length, 5); assert.ok(warnings.length);
  assert.equal(entries[0].forms.pastTense[0].text, 'phased');
  assert.equal(entries[0].forms.adverb[0].text, 'Phasally');
  assert.match(entries[0].note, /\*Phasally \(not common\)/);
  assert.equal(entries[0].meaning, '');
  assert.equal(entries[1].forms.adverb[0].text, 'Predictably');
  assert.equal(checkForms(entries[1], { adjective: 'predictive / predictable' }).find(c => c.pos === 'adjective').correct, true);
  assert.equal(entries[2].forms.verb, undefined); assert.equal(entries[2].forms.pastTense, undefined);
  assert.deepEqual(availablePOS(entries[3]), ['adverb']);
  assert.equal(entries[4].forms.pastTense[0].text, 'tramatized');
  const state = freshState(); state.maple = { collections: [{ id: 'json-lap', name: 'English 12', entries }] };
  const restored = parseBackup(backupText(state)).maple.collections[0].entries;
  assert.deepEqual(restored, entries);
  const session = startPractice({ entries }, true, Date.now(), ['spelling', 'forms']);
  assert.ok(session.queue.every(t => t.skill !== 'meaning'));
});

test('JSON 格式和类型错误给出明确行号，失败不静默丢行或接受重复词族', () => {
  assert.throws(() => parseLAPJSON('[broken'), /JSON 格式/);
  for (const value of [{}, [], [null], [{ noun: 'goal' }], [{ word: 'goal', noun: 123 }]]) assert.throws(() => parseLAPJSON(JSON.stringify(value)));
  assert.throws(() => parseLAPJSON(JSON.stringify([{ word: 'goal', noun: 'goal' }, { word: 'x', noun: 'x2' }])), /第 2 行/);
  assert.throws(() => parseLAPJSON(JSON.stringify([{ word: 'goal', noun: 'goal' }, { word: 'Goal', noun: 'goal' }])), /重复主词/);
  const entries = parseLAPJSON(JSON.stringify([{ word: 'goal', noun: 'goal', verb: 'goal (rarely used)', pastTense: 'Gained (used when referring to achieving a goal)', adverb: 'N/A', meaning: '目标' }])).entries;
  assert.equal(entries[0].meaning, '目标'); assert.equal(entries[0].forms.pastTense[0].text, 'Gained');
  const paper = createPaper({ id: 'json-lap', name: 'LAP', entries }, { forms: 0, meanings: 0, sentences: 1, corrections: 0 }, () => 0.9);
  assert.notEqual(paper.questions[0].pos, 'pastTense');
});

test('新卷不出过去式或释义，过去式不贡献词性资格及听写分数', async () => {
  const c = fixture(1), e = c.entries[0];
  e.forms.pastTense = [{ text: 'created', meaning: '创造了' }];
  e.forms.noun.push({ text: 'creator', meaning: '创造者' });
  const p = createPaper(c, { forms: 1, meanings: 20, sentences: 0, corrections: 0 });
  assert.equal(p.questions.length, 1);
  assert.equal(p.questions[0].maxScore, 4);
  assert.ok(!p.columns.includes('pastTense'));
  assert.notEqual(p.questions[0].pos, 'pastTense');
  assert.equal(examConfig({ meanings: 20 }).meanings, undefined);
  p.questions[0].answer = { noun: 'creator', verb: 'create', adjective: 'creative', adverb: 'creatively' };
  const result = await gradePaper({}, p);
  assert.equal(result.score, 4); assert.equal(result.maxScore, 4);
  p.result = result; p.submittedAt = Date.now(); c.papers.push(p);
  const restored = normalizeMaple({ collections: [c] }).collections[0].papers[0];
  assert.equal(restored.result.maxScore, 4);
  assert.ok(!restored.columns.includes('pastTense'));
  delete e.forms.adjective; delete e.forms.adverb;
  assert.equal(examPOS(e).length, 2);
  assert.throws(() => createPaper(c, { forms: 1, sentences: 0, corrections: 0 }), /至少有 3 种词性/);
});

test('旧未提交试卷移除释义、时态改错和过去式答案，已提交成绩保持原规则', () => {
  const c = fixture(1), entry = c.entries[0]; entry.forms.pastTense = [{ text: 'created', meaning: '' }];
  const form = { id: 'form', section: 'forms', entry, pos: 'pastTense', target: entry.forms.pastTense[0], maxScore: 5, answer: { noun: 'creation', pastTense: 'created' } };
  const meaning = { id: 'meaning', section: 'meanings', entry, pos: 'verb', target: entry.forms.verb[0], maxScore: 2, answer: '含义' };
  const correction = { id: 'correction', section: 'corrections', entry, pos: 'verb', target: entry.forms.verb[0], maxScore: 2, errorType: 'tense', answer: 'old sentence' };
  const legacy = { id: 'old', config: { forms: 1, meanings: 1, sentences: 0, corrections: 1 }, questions: [form, meaning, correction] };
  c.papers.push(legacy);
  let restored = normalizeMaple({ collections: [c] }).collections[0].papers[0];
  assert.equal(restored.questions.length, 1); assert.equal(restored.rulesVersion, 2);
  assert.equal(restored.questions[0].answer.noun, 'creation'); assert.equal(restored.questions[0].answer.pastTense, undefined);
  assert.equal(restored.questions[0].maxScore, 4); assert.equal(restored.questions[0].pos, 'noun');
  assert.ok(!restored.columns.includes('pastTense'));
  legacy.submittedAt = Date.now();
  legacy.result = { grades: [form, meaning, correction].map(q => ({ id: q.id, score: q.maxScore, feedback: '旧规则正确' })) };
  restored = normalizeMaple({ collections: [c] }).collections[0].papers[0];
  assert.equal(restored.questions.length, 3); assert.equal(restored.result.score, 9); assert.equal(restored.rulesVersion, 1);
});

test('改错生成不发送过去式列或选择时态错误，拒绝模型擅自出时态题', async () => {
  const c = fixture(1); c.entries[0].forms.pastTense = [{ text: 'created', meaning: '' }];
  const p = createPaper(c, { forms: 0, sentences: 0, corrections: 1 });
  await mockAI((url, body) => {
    const [q] = JSON.parse(body.messages[1].content);
    assert.equal(q.entry.forms.pastTense, undefined); assert.notEqual(q.errorType, 'tense');
    assert.match(body.messages[0].content, /不考过去时/);
    return completion({ questions: [{ id: q.id, sentence: 'She create every day.', corrected: 'They create every day.', explanation: '主谓一致', errorType: 'agreement' }] });
  }, async () => await generateCorrections(settings, p));
  await mockAI(() => completion({ questions: [{ id: p.questions[0].id, sentence: 'She create every day.', corrected: 'She created every day.', explanation: '过去时', errorType: 'tense' }] }), async () => assert.rejects(generateCorrections(settings, p), /不符合要求/));
});

test('造句随机指定已有词性及对应词形，并把指定词性传给批改', async () => {
  const c = fixture(1); c.entries[0].forms.pastTense = [{ text: 'created', meaning: '' }];
  const selected = [0, 0.3, 0.6, 0.9].map(r => createPaper(c, { forms: 0, sentences: 1, corrections: 0 }, () => r).questions[0]);
  assert.deepEqual(selected.map(q => q.pos), ['noun', 'verb', 'adjective', 'adverb']);
  for (const q of selected) {
    assert.ok(q.entry.forms[q.pos].some(f => f.text === q.target.text));
    assert.notEqual(q.pos, 'pastTense');
  }
  const q = selected[2]; q.answer = 'This is a creative idea.';
  await mockAI((url, body) => {
    const [question] = JSON.parse(body.messages[1].content);
    assert.equal(question.pos, 'adjective'); assert.equal(question.target.text, 'creative');
    assert.match(body.messages[0].content, /指定 pos/);
    return completion({ grades: [{ id: q.id, score: 2, feedback: '按指定形容词造句正确' }] });
  }, async () => assert.equal((await gradePaper(settings, { questions: [q] })).score, 2));
});
