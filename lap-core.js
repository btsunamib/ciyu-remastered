// LAP data is separate from ordinary word books, but lives in the same backup.
export const POS = { noun: '名词 n.', verb: '动词 v.', pastTense: '过去式', adjective: '形容词 adj.', adverb: '副词 adv.', pronoun: '代词 pron.', preposition: '介词 prep.', conjunction: '连词 conj.', determiner: '限定词 det.', interjection: '感叹词 interj.', numeral: '数词 num.' };
export const SKILLS = { spelling: '听音拼写', forms: '词性转换', meaning: '词义回忆' };
export const DEFAULT_EXAM = { forms: 3, meanings: 3, sentences: 3, corrections: 3, repeatWords: false };
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const text = (value, limit = 2000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export const spelling = value => text(value).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
export const availablePOS = entry => Object.keys(POS).filter(pos => entry.forms?.[pos]?.length);
export function normalizeEntries(raw, strict = false) {
  if (!Array.isArray(raw)) throw new Error('没有得到 LAP 词族列表');
  const entries = [], seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') { if (strict) throw new Error('词族数据不完整，请重新识别'); else continue; }
    const forms = {};
    for (const pos of Object.keys(POS)) {
      const values = Array.isArray(item.forms?.[pos]) ? item.forms[pos] : [];
      const unique = new Map();
      for (const value of values) {
        const word = text(typeof value === 'string' ? value : value?.text, 100);
        if (!word || /^[—–\-/\\\s]+$/.test(word)) continue;
        if (!/^[a-z][a-z '\-]*$/i.test(word)) { if (strict) throw new Error(`词形“${word}”不是有效的英文词，请核对资料`); else continue; }
        unique.set(spelling(word), { text: word, meaning: text(value?.meaning, 500) });
      }
      if (unique.size > 12 && strict) throw new Error('同一词性最多保留 12 个词形，请核对表格');
      if (unique.size) forms[pos] = [...unique.values()].slice(0, 12);
    }
    const word = text(item.word, 100), meaning = text(item.meaning);
    if (!word || !availablePOS({ forms }).length) { if (strict) throw new Error('每个词族需要主词和至少一个已列出的词形'); else continue; }
    if (!/^[a-z][a-z '\-]*$/i.test(word) || !Object.values(forms).flat().some(f => spelling(f.text) === spelling(word))) { if (strict) throw new Error(`主词“${word}”必须是表格中已有的词形`); else continue; }
    let entryId = text(item.id, 100) || id(); if (seen.has(entryId)) entryId = id(); seen.add(entryId);
    const progress = {};
    for (const skill of Object.keys(SKILLS)) {
      const p = item.progress?.[skill];
      progress[skill] = { streak: Math.min(10, Math.max(0, Number(p?.streak) || 0)), stage: Math.min(5, Math.max(0, Number(p?.stage) || 0)), dueAt: Math.max(0, Number(p?.dueAt) || 0) };
    }
    entries.push({ id: entryId, word, meaning, forms, note: text(item.note), progress, ...(Number.isInteger(item.num) ? { num: item.num } : {}), ...(text(item.pos, 100) ? { pos: text(item.pos, 100) } : {}) });
    if (entries.length > 1000) throw new Error('单份 LAP 最多 1000 个词族，请拆分资料');
  }
  return entries;
}
export function mergeEntries(parts) {
  const map = new Map();
  for (const entry of parts) {
    const key = spelling(entry.word), previous = map.get(key);
    if (!previous) { map.set(key, structuredClone(entry)); continue; }
    for (const pos of availablePOS(entry)) {
      const values = new Map((previous.forms[pos] || []).map(f => [spelling(f.text), f]));
      for (const form of entry.forms[pos]) if (!values.has(spelling(form.text))) values.set(spelling(form.text), form);
      previous.forms[pos] = [...values.values()];
    }
    if (!previous.meaning.includes(entry.meaning)) previous.meaning += `；${entry.meaning}`;
  }
  return normalizeEntries([...map.values()], true);
}
// Flat LAP JSON is parsed locally, without AI, dictionary lookup or spelling changes.
export function parseLAPJSON(source, name = 'LAP 单词') {
  let raw;
  try { raw = JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch { throw new Error('JSON 格式错误，请检查逗号、引号和括号'); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw new Error('JSON 必须是含 1–1000 个单词对象的数组');
  const empty = value => !value || /^(?:n\s*\/\s*a|none|null|[—–\-/\\\s]+)$/i.test(value);
  const entries = raw.map((item, index) => {
    const fail = message => { throw new Error(`第 ${index + 1} 行：${message}`); };
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('需要一个单词对象');
    if (typeof item.word !== 'string' || !item.word.trim()) fail('缺少 word 主词');
    if (item.word.trim().length > 100) fail('主词过长');
    const forms = {}, notes = [];
    if (item.num !== undefined) { if (!Number.isInteger(item.num)) fail('num 必须是整数'); notes.push(`原序号：${item.num}`); }
    if (item.pos !== undefined) { if (typeof item.pos !== 'string' || item.pos.length > 100) fail('pos 必须是词性文字'); notes.push(`主词词性：${item.pos}`); }
    for (const key of Object.keys(POS)) {
      if (item[key] === undefined || item[key] === null) continue;
      if (typeof item[key] !== 'string' || item[key].length > 1500) fail(`${key} 必须是词形文字，最多 1500 字符`);
      const cell = item[key].trim(); if (empty(cell)) continue;
      const cleaned = cell.replace(/\([^)]*\)|（[^）]*）/g, '').replace(/\*/g, '').trim();
      if (cleaned !== cell) notes.push(`${POS[key]}原文：${cell}`);
      const values = cleaned.split(/[/,;，；\n]+/).map(v => v.trim()).filter(v => !empty(v));
      if (values.length) forms[key] = values.map(word => ({ text: word, meaning: '' }));
    }
    if (item.meaning !== undefined && typeof item.meaning !== 'string') fail('meaning 必须是释义文字');
    if (item.note !== undefined && typeof item.note !== 'string') fail('note 必须是备注文字');
    if (item.note) notes.push(item.note);
    try { return normalizeEntries([{ word: item.word, meaning: item.meaning || '', forms, note: notes.join('；'), num: item.num, pos: item.pos }], true)[0]; }
    catch (error) { fail(error.message); }
  });
  if (new Set(entries.map(e => spelling(e.word))).size !== entries.length) throw new Error('JSON 中有重复主词，请先合并对应行');
  return { name, entries, warnings: entries.some(e => !e.meaning) ? ['JSON 未提供的释义保持空白，可在此补充；不会调用 AI 自动补全。括号说明与星号保存在备注，拼写按原文保留。'] : [] };
}
export function examConfig(raw = {}) {
  const result = { repeatWords: raw.repeatWords === true };
  for (const section of ['forms', 'meanings', 'sentences', 'corrections']) {
    const value = raw[section] === undefined ? DEFAULT_EXAM[section] : Number(raw[section]);
    if (!Number.isInteger(value) || value < 0 || value > 20) throw new Error('每类题数需要是 0–20 的整数');
    result[section] = value;
  }
  if (!Object.values(result).some(v => typeof v === 'number' && v > 0)) throw new Error('请至少设置一道题');
  return result;
}
function shuffled(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function createPaper(collection, rawConfig, random = Math.random) {
  const config = examConfig(rawConfig), entries = collection.entries;
  const eligible = entries.filter(e => availablePOS(e).length >= 3);
  if (config.forms && !eligible.length) throw new Error('听写词性转换题需要至少有 3 种词性的词族');
  if (!config.repeatWords && eligible.length < config.forms) throw new Error(`听写需要 ${config.forms} 个至少有 3 种词性的词族，当前只有 ${eligible.length} 个`);
  const count = ['forms', 'meanings', 'sentences', 'corrections'].reduce((sum, s) => sum + config[s], 0);
  if (!entries.length || !config.repeatWords && entries.length < count) throw new Error(`禁止重复时需要 ${count} 个不同词族，当前只有 ${entries.length} 个；请减少题数或允许重复`);
  const used = new Set(), questions = [];
  const columns = [...new Set(entries.flatMap(availablePOS))];
  for (const section of ['forms', 'meanings', 'sentences', 'corrections']) {
    const source = section === 'forms' ? eligible : entries;
    let pool = [];
    for (let n = 0; n < config[section]; n++) {
      if (!pool.length) pool = [...shuffled(source.filter(e => !used.has(e.id)), random), ...(config.repeatWords ? shuffled(source.filter(e => used.has(e.id)), random) : [])];
      const entry = pool.shift(); if (!entry) throw new Error('可用词族不足，请调整题数');
      used.add(entry.id);
      const choices = availablePOS(entry).filter(pos => section === 'forms' || pos !== 'pastTense');
      if (!choices.length) throw new Error(`词族“${entry.word}”只有过去式，不能用于此类题目，请补充词性形式`);
      const pos = choices[Math.floor(random() * choices.length)];
      const target = entry.forms[pos][Math.floor(random() * entry.forms[pos].length)];
      questions.push({ id: id(), section, entry: structuredClone(entry), pos, target: structuredClone(target), maxScore: section === 'forms' ? availablePOS(entry).length : 2, answer: section === 'forms' ? {} : '' });
    }
  }
  return { id: id(), collectionId: collection.id, name: collection.name, createdAt: Date.now(), config, columns, questions, submittedAt: null, result: null };
}
export function checkForms(entry, answers, cols = availablePOS(entry)) {
  return cols.map(pos => {
    const expected = entry.forms[pos].map(f => spelling(f.text)).sort();
    const actual = [...new Set(text(answers?.[pos]).split(/[,;，；/\n]+/).map(spelling).filter(Boolean))].sort();
    return { pos, correct: expected.length === actual.length && expected.every((f, i) => f === actual[i]), expected: entry.forms[pos].map(f => f.text).join(' / ') };
  });
}
export function hasTargetInDefinition(answer, entry) {
  const tokens = spelling(answer).match(/[a-z]+(?:'[a-z]+)?/g) || [];
  return [entry.word, ...Object.values(entry.forms).flat().map(f => f.text)].some(word => {
    const pattern = spelling(word).match(/[a-z]+(?:'[a-z]+)?/g) || [];
    return pattern.length && tokens.some((_, i) => pattern.every((t, j) => t === tokens[i + j]));
  });
}
export function validateGrades(raw, questions) {
  if (!Array.isArray(raw) || raw.length !== questions.length) throw new Error('AI 批改没有覆盖所有题目，请重试');
  const seen = new Set();
  const grades = raw.map(grade => {
    const question = questions.find(q => q.id === grade?.id);
    if (!question || seen.has(grade.id) || typeof grade.score !== 'number' || !Number.isFinite(grade.score) || !Number.isInteger(grade.score * 2) || grade.score < 0 || grade.score > question.maxScore || !text(grade.feedback)) throw new Error('AI 返回了无效评分，请重新批改');
    seen.add(grade.id);
    let score = grade.score, feedback = text(grade.feedback);
    if (!text(question.answer) && question.section !== 'forms') { score = 0; feedback = '未作答。'; }
    if (question.section === 'meanings' && hasTargetInDefinition(question.answer, question.entry)) { score = 0; feedback = '释义包含了目标词或本词族词形，不能用目标词解释自己。'; }
    return { id: grade.id, score, maxScore: question.maxScore, feedback, reference: text(grade.reference, 4000) };
  });
  return grades;
}
export function updateProgress(entry, skill, correct, now = Date.now()) {
  const p = entry.progress[skill];
  const intervals = [20 * 60e3, 86400e3, 3 * 86400e3, 7 * 86400e3, 15 * 86400e3, 30 * 86400e3];
  p.streak = correct ? p.streak + 1 : 0;
  p.stage = correct ? Math.min(5, p.stage + 1) : 0;
  p.dueAt = correct ? now + intervals[p.stage] : now;
}
export function startPractice(collection, all = false, now = Date.now(), skills = Object.keys(SKILLS)) {
  const tasks = [];
  for (const entry of collection.entries.slice().sort((a, b) => Math.min(...Object.values(a.progress).map(p => p.dueAt)) - Math.min(...Object.values(b.progress).map(p => p.dueAt)))) {
    for (const skill of skills.filter(s => SKILLS[s])) if (all || entry.progress[skill].dueAt <= now) tasks.push({ entryId: entry.id, skill });
    if (tasks.length >= 36) break;
  }
  if (!tasks.length) return null;
  return { queue: shuffled(tasks, Math.random), completed: 0, answer: '', feedback: null };
}
export function normalizeMaple(raw) {
  const result = { collections: [] };
  const seen = new Set();
  for (const value of (Array.isArray(raw?.collections) ? raw.collections : [])) {
    if (!value || !Array.isArray(value.entries)) continue;
    const entries = normalizeEntries(value.entries);
    let collectionId = text(value.id, 100) || id(); if (seen.has(collectionId)) collectionId = id(); seen.add(collectionId);
    const collection = { id: collectionId, mode: 'lap', name: text(value.name, 60) || 'LAP 单词', entries, createdAt: Number(value.createdAt) || Date.now(), papers: [], activePaperId: text(value.activePaperId, 100), practice: null };
    try { collection.examConfig = examConfig(value.examConfig); } catch { collection.examConfig = { ...DEFAULT_EXAM }; }
    for (const p of (Array.isArray(value.papers) ? value.papers.slice(-20) : [])) {
      try {
        const config = examConfig(p.config);
        if (!Array.isArray(p.questions) || p.questions.length > 80 || !p.questions.length) continue;
        const ids = new Set();
        const questions = p.questions.map(q => {
          const entry = normalizeEntries([q.entry], true)[0];
          if (!q.id || ids.has(q.id) || !['forms','meanings','sentences','corrections'].includes(q.section) || !entry.forms[q.pos]?.some(f => f.text === q.target?.text)) throw new Error('无效题目');
          ids.add(q.id);
          if (q.section === 'forms' && availablePOS(entry).length < 3) throw new Error('无效听写题');
          return { id: text(q.id, 100), section: q.section, entry, pos: q.pos, target: { text: text(q.target.text, 100), meaning: text(q.target.meaning) }, maxScore: q.section === 'forms' ? availablePOS(entry).length : 2, answer: q.section === 'forms' ? Object.fromEntries(availablePOS(entry).map(pos => [pos, text(q.answer?.[pos])])) : text(q.answer, 4000), sentence: text(q.sentence, 2000), corrected: text(q.corrected, 2000), explanation: text(q.explanation), errorType: text(q.errorType, 100) };
        });
        const paper = { id: text(p.id, 100) || id(), collectionId, name: text(p.name, 60) || collection.name, createdAt: Number(p.createdAt) || Date.now(), config, columns: [...new Set(questions.flatMap(q => availablePOS(q.entry)))], questions, submittedAt: Number(p.submittedAt) || null, result: null };
        if (p.result?.grades) { const grades = validateGrades(p.result.grades, questions); paper.result = { grades, score: grades.reduce((s,g) => s + g.score, 0), maxScore: grades.reduce((s,g) => s + g.maxScore, 0) }; }
        collection.papers.push(paper);
      } catch { /* Invalid imported papers do not erase the vocabulary collection. */ }
    }
    const practice = value.practice;
    if (Array.isArray(practice?.queue)) {
      const queue = practice.queue.filter(t => entries.some(e => e.id === t?.entryId) && SKILLS[t.skill]).slice(0, 300);
      collection.practice = { queue, completed: Math.max(0, Number(practice.completed) || 0), answer: typeof practice.answer === 'object' && practice.answer ? Object.fromEntries(Object.keys(POS).map(pos => [pos, text(practice.answer[pos])])) : text(practice.answer, 4000), feedback: practice.feedback && typeof practice.feedback.correct === 'boolean' ? { correct: practice.feedback.correct, text: text(practice.feedback.text, 4000) } : null };
    }
    result.collections.push(collection);
  }
  return result;
}
