import { uid, recordStudy } from './core.js';
import { readAIKey } from './ai.js';
import { POS, SKILLS, DEFAULT_EXAM, availablePOS, normalizeEntries, parseLAPJSON, createPaper, checkForms, spelling, updateProgress, startPractice } from './lap-core.js';
import { readLAPFiles, extractLAP, generateCorrections, gradePaper, gradeMeaning } from './lap-ai.js';
import { icon } from './icons.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = selector => document.querySelector(selector);
const EN_POS = { noun:'Noun', verb:'Verb', pastTense:'Past tense', adjective:'Adjective', adverb:'Adverb', pronoun:'Pronoun', preposition:'Preposition', conjunction:'Conjunction', determiner:'Determiner', interjection:'Interjection', numeral:'Numeral' };
const practicePOS = e => availablePOS(e).filter(p => p !== 'pastTense');
const SECTIONS = { forms: '1. Listen and complete the word forms', meanings: '2. Explain the meaning', sentences: '3. Write a sentence', corrections: '4. Correct the sentence' };
export function installMaple(bridge) {
  const state = () => bridge.getState();
  const collections = () => { state().maple ||= { collections: [] }; return state().maple.collections; };
  let selectedId = '', view = 'words', job = null, importing = null, query = '', page = 0;
  let playToken = 0, playTimer, immersive = false;
  async function setImmersive(value) {
    immersive = value; document.body.classList.toggle('lap-immersive', value);
    renderPage();
    try { if (value && !document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else if (!value && document.fullscreenElement) await document.exitFullscreen(); } catch {}
    if (value) window.scrollTo({top:0,behavior:'instant'});
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && immersive) { immersive = false; document.body.classList.remove('lap-immersive'); if (isPage()) renderPage(); } });
  const collection = () => collections().find(c => c.id === selectedId) || collections()[0];
  const paper = () => collection()?.papers.find(p => p.id === collection().activePaperId);
  const isPage = () => location.hash === '#maple';
  function requireAI() {
    if (state().settings.aiEnabled && readAIKey() && state().settings.aiModel) return true;
    bridge.toast('枫叶 LAP 需要开启 AI、填写密钥并选择模型'); bridge.navigate('settings'); return false;
  }
  function stopPlayback() { playToken++; clearTimeout(playTimer); bridge.audio.stop(); }
  function playWords(words) {
    stopPlayback(); const token = playToken;
    const queue = words.flatMap(word => [word, word]);
    const next = () => {
      if (token !== playToken || !isPage()) return;
      const word = queue.shift(); if (!word) return;
      bridge.audio.english(word, () => { if (token === playToken) playTimer = setTimeout(next, 650); });
    };
    next();
  }
  const formText = (entry, pos) => (entry.forms[pos] || []).map(f => f.text).join(' / ');
  const columns = c => [...new Set(c.entries.flatMap(availablePOS))];
  function fieldHTML(entry, pos, answer, dataset, locked = false, check = null) {
    const status = check ? check.correct ? 'correct' : 'wrong' : '';
    return `<div class="lap-answer-cell ${status}" ${check && !check.correct ? 'tabindex="0" data-action="lap-answer-toggle" role="button" aria-label="Show correct answer"' : ''}><input class="input" ${dataset} data-pos="${pos}" value="${esc(answer?.[pos] || '')}" aria-label="${esc(EN_POS[pos])}" ${check ? `aria-invalid="${!check.correct}"` : ''} autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="2000" ${locked ? 'readonly' : ''}>${check ? `<span class="lap-cell-status">${check.correct ? '✓' : '✗'}</span>${!check.correct ? `<span class="lap-correct-answer" role="status">Correct: ${esc(check.expected)}</span>` : ''}` : ''}</div>`;
  }
  function cells(entry, cols, answer, dataset, locked = false, checks = []) {
    return cols.map(pos => entry.forms[pos]?.length ? `<td data-label="${esc(EN_POS[pos])}">${fieldHTML(entry, pos, answer, dataset, locked, checks.find(c => c.pos === pos))}</td>` : `<td data-label="${esc(EN_POS[pos])}" class="lap-slash" aria-label="No ${esc(EN_POS[pos])} form">／</td>`).join('');
  }
  function renderWords(c) {
    const filtered = c.entries.filter(e => `${e.word} ${e.meaning} ${Object.values(e.forms).flat().map(f => f.text).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    const cols = columns(c), pages = Math.max(1, Math.ceil(filtered.length / 40)); page = Math.min(page, pages - 1);
    return `<section class="panel"><div class="section-head"><h2>${esc(c.name)}<small>${c.entries.length} 个词族</small></h2><div class="lap-actions"><button class="button compact" data-action="lap-edit">核对 / 编辑词表</button><button class="button compact danger" data-action="lap-delete">删除</button></div></div><div class="field"><label for="lap-search">搜索词族或含义</label><input class="input" id="lap-search" value="${esc(query)}" placeholder="查词形、中文意思…"></div><div id="lap-word-table">${wordTable(filtered, cols)}</div><div class="lap-actions"><button class="button compact" data-action="lap-page" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>上一页</button><span class="hint">${page + 1} / ${pages} 页 · ${filtered.length} 个词族</span><button class="button compact" data-action="lap-page" data-page="${page + 1}" ${page + 1 >= pages ? 'disabled' : ''}>下一页</button></div></section>`;
  }
  function wordTable(filtered, cols) {
    return `<div class="lap-table-wrap"><table class="lap-table"><thead><tr><th scope="col">词族 / 含义</th>${cols.map(pos => `<th scope="col">${POS[pos]}</th>`).join('')}<th scope="col">学习进度</th></tr></thead><tbody>${filtered.slice(page * 40, page * 40 + 40).map(e => `<tr><th scope="row"><button class="text-button" data-action="lap-audio" data-entry="${esc(e.id)}">${icon('volume')}${esc(e.word)}</button><small>${esc(e.meaning)}</small>${e.note ? `<small>${esc(e.note)}</small>` : ''}</th>${cols.map(pos => e.forms[pos]?.length ? `<td>${e.forms[pos].map(f => `<span class="lap-form">${esc(f.text)}${f.meaning ? `<small>${esc(f.meaning)}</small>` : ''}</span>`).join('')}</td>` : '<td class="lap-slash" aria-label="无对应形式">／</td>').join('')}<td>${Object.entries(SKILLS).map(([skill, label]) => `<small>${label} · ${e.progress[skill].stage ? e.progress[skill].dueAt <= Date.now() ? '待复习' : '已练习' : '待学习'}</small>`).join('')}</td></tr>`).join('') || `<tr><td colspan="${cols.length + 2}">没有找到词族。</td></tr>`}</tbody></table></div>`;
  }
  function renderPractice(c) {
    const session = c.practice;
    if (session && session.queue.some(t => t.skill !== 'forms')) { session.queue = session.queue.filter(t => t.skill === 'forms'); session.answer = {}; session.feedback = null; bridge.persist(); }
    const task = session?.queue[0], entry = c.entries.find(e => e.id === task?.entryId);
    if (!entry) return `<section class="panel lap-practice"><h2>${session ? '这一组练习完成了' : '把词性转换，练到熟悉。'}</h2><p>只填写词性形式，不考过去式。同格多个形式用 / 分隔；Enter 跳到下一格，最后一格 Enter 检查答案。</p><div class="lap-actions"><button class="button primary" data-action="lap-practice-start">学习 / 复习到期词</button><button class="button" data-action="lap-practice-all">练习全部词族</button></div></section>`;
    const feedback = session.feedback, cols = practicePOS(entry);
    const checks = feedback ? checkForms(entry, session.answer, cols) : [];
    return `<section class="panel lap-practice"><div class="section-head"><h2>词性转换</h2><span class="hint">已完成 ${session.completed} 项 · 还有 ${session.queue.length} 项</span></div><div class="lap-study-word">${esc(entry.word)}</div><p class="hint">${esc(entry.meaning)} · 同格多个形式用 / 分隔。Enter 下一格，最后一格提交。</p><form id="lap-practice-form"><div class="lap-practice-fields">${cols.map(pos => `<label class="field"><span>${POS[pos]}</span>${fieldHTML(entry,pos,session.answer,'data-lap-practice',!!feedback || !!job, checks.find(c => c.pos === pos))}</label>`).join('')}</div>${feedback ? `<p class="hint" role="status">${feedback.correct ? '全部正确。' : '红框为错误，悬停、点击或用 Tab 聚焦查看绿色正确答案。'}</p><button class="button primary" type="button" data-action="lap-practice-next">确认，继续 ↵</button>` : `<div class="lap-actions"><button class="button primary" type="submit" ${job ? 'disabled' : ''}>检查答案 ↵</button><button class="button" type="button" data-action="lap-practice-reveal">查看答案</button></div>`}</form></section>`;
  }
  function examSetup(c) {
    const config = c.examConfig || DEFAULT_EXAM;
    return `<section class="panel"><h2>生成 LAP 模拟卷</h2><p class="hint">默认四类题各 3 题。听写每个可填写词性格 1 分，词义、造句、改错每题 2 分。缺少的形式划斜线，不能填写。禁止重复按整个词族计算。</p><form id="lap-exam-form"><div class="lap-config-grid">${Object.entries(SECTIONS).map(([key,label]) => `<div class="field"><label for="lap-count-${key}">${label}</label><input class="input" type="number" min="0" max="20" step="1" id="lap-count-${key}" data-lap-count="${key}" value="${config[key]}" required></div>`).join('')}</div><label class="check-label"><input id="lap-repeat" type="checkbox" ${config.repeatWords ? 'checked' : ''}>允许同一词族在卷内重复（优先选择未出现过的词族）</label><p class="hint">共有 ${c.entries.length} 个词族，其中 ${c.entries.filter(e => availablePOS(e).length >= 3).length} 个可出听写转换题。可将不需要的题型设为 0。</p><label class="check-label"><input id="lap-immersive-start" type="checkbox">全屏沉浸式考试</label><button class="button primary" type="submit" ${job ? 'disabled' : ''}>AI 生成并开始考试${icon('arrow')}</button></form></section>`;
  }
  function renderPaper(p) {
    const result = p.result;
    return `<section class="panel lap-paper" lang="en"><div class="section-head"><div><h2>${esc(p.name)} · LAP Mock Exam</h2><p class="hint">${new Date(p.createdAt).toLocaleString('en-GB')} · Answers saved automatically</p></div><div class="lap-actions"><button class="button compact" data-action="lap-immersive">${immersive ? 'Exit fullscreen' : 'Immersive fullscreen'}</button><button class="button compact" data-action="lap-print">Print</button></div></div>${result ? `<div class="lap-score" role="status">${result.score} <small>/ ${result.maxScore}</small></div>` : '<p class="hint">Listen to each word twice. Explain meanings without using the target word. Use the given word class in a meaningful sentence. Enter moves to the next answer; Shift+Enter adds a new line. Enter in the last answer submits the paper.</p>'}
    ${Object.entries(SECTIONS).map(([section,label]) => {
      const questions = p.questions.filter(q => q.section === section); if (!questions.length) return '';
      const heading = `<h3>${label} <small>${questions.reduce((s,q) => s + q.maxScore,0)} marks</small></h3>`;
      if (section === 'forms') return `<div class="lap-exam-section">${heading}<div class="lap-actions"><button class="button soft" data-action="lap-play-all">Play all twice</button><button class="button compact" data-action="lap-stop-audio">Stop</button></div><p class="hint">Write every form listed for each word class. Separate multiple forms with /. Each correct cell earns one mark.</p><div class="lap-table-wrap lap-exam-table-wrap"><table class="lap-table lap-exam-table"><thead><tr><th>Word</th>${p.columns.map(pos => `<th>${EN_POS[pos]}</th>`).join('')}</tr></thead><tbody>${questions.map((q,n) => `<tr><th scope="row"><span>Word ${n+1}</span><button class="button compact" data-action="lap-question-audio" data-question="${esc(q.id)}">Play twice</button>${result ? `<small>${esc(q.entry.word)}</small>` : ''}</th>${cells(q.entry,p.columns,q.answer,`data-lap-answer="${esc(q.id)}"`,!!result || !!job,result ? checkForms(q.entry,q.answer) : [])}</tr>`).join('')}</tbody></table></div></div>`;
      return `<div class="lap-exam-section">${heading}${questions.map((q,n) => `<article class="lap-question"><div class="lap-question-title"><b>${n+1}. ${section === 'corrections' ? esc(q.sentence) : `${esc(q.target.text)}${section === 'sentences' ? ` (${EN_POS[q.pos]})` : ''}`}</b><span class="hint">${q.maxScore} marks</span></div><label class="label" for="lap-answer-${esc(q.id)}">${section === 'meanings' ? 'Meaning (English or Chinese)' : section === 'sentences' ? 'Your sentence' : 'The corrected sentence'}</label><textarea class="textarea" id="lap-answer-${esc(q.id)}" data-lap-answer="${esc(q.id)}" maxlength="4000" ${result || job ? 'readonly' : ''}>${esc(q.answer)}</textarea>${result ? gradeHTML(result.grades.find(g=>g.id===q.id),q) : ''}</article>`).join('')}</div>`;
    }).join('')}${!result ? `<div class="lap-actions"><button class="button primary" data-action="lap-grade" ${job ? 'disabled' : ''}>Submit paper ↵</button><span class="hint">Blank answers earn zero marks. Submitted papers are locked.</span></div>` : ''}</section>`;
  }
  function gradeHTML(g, q) {
    if (!g) return '';
    return `<div class="lap-feedback ${g.score === g.maxScore ? 'correct' : 'wrong'}"><b>${g.score} / ${g.maxScore} 分${q.section === 'forms' ? ` · ${esc(q.entry.word)}` : ''}</b><p>${esc(g.feedback)}</p><p>参考：${esc(g.reference || (q.section === 'corrections' ? q.corrected : q.entry.meaning))}</p></div>`;
  }
  function renderExam(c) {
    const p = paper();
    return `${examSetup(c)}${c.papers.length ? `<section class="panel"><label class="label" for="lap-paper-select">已保存的试卷</label><select id="lap-paper-select"><option value="">选择试卷</option>${[...c.papers].reverse().map(p => `<option value="${esc(p.id)}" ${p.id === c.activePaperId ? 'selected' : ''}>${new Date(p.createdAt).toLocaleString('zh-CN')} · ${p.result ? `${p.result.score}/${p.result.maxScore} 分` : '继续作答'}</option>`).join('')}</select><p class="hint">每份 LAP 保留最近 20 张试卷。背诵时可查看词表；模拟考试时先完成作答再核对。</p></section>` : ''}${p ? renderPaper(p) : ''}`;
  }
  function renderPage() {
    const c = collection(); if (c) selectedId = c.id;
    document.body.classList.toggle('lap-practicing', view === 'practice' && !!c?.practice?.queue.length);
    bridge.main.innerHTML = `<div class="page maple-page"><div class="page-intro"><div><div class="eyebrow">MAPLE LEARNING</div><h1><span aria-hidden="true">🍁</span> 枫叶模式</h1><p>从一张词表，到会拼写、会转换、会表达。</p></div><button class="button primary" data-action="lap-import" ${job ? 'disabled' : ''}>${icon('upload')}导入 LAP 词表</button></div><div class="lap-mode-bar"><span class="badge">LAP 单词模式</span><span class="hint">更多模式（如 Vocab）将来加入</span></div>${!state().settings.aiEnabled || !readAIKey() || !state().settings.aiModel ? '<div class="notice">JSON 导入、听音拼写和词形练习无需 AI；资料识别、模拟卷生成与词义批改需要配置 AI。图片需要选择支持视觉的模型。<button class="text-button" data-nav="settings">打开设置 →</button></div>' : ''}
      ${c ? `<div class="field"><label for="lap-collection">我的 LAP</label><select id="lap-collection" ${job ? 'disabled' : ''}>${collections().map(item => `<option value="${esc(item.id)}" ${item.id === c.id ? 'selected' : ''}>${esc(item.name)} · ${item.entries.length} 个词族</option>`).join('')}</select></div><div class="ai-tabs" role="tablist" aria-label="LAP 学习方式">${[['words','词族表'],['practice','背诵'],['exam','模拟考试']].map(([key,label]) => `<button class="button ${view === key ? 'soft' : ''}" role="tab" aria-selected="${view === key}" data-action="lap-tab" data-view="${key}" ${job ? 'disabled' : ''}>${label}</button>`).join('')}</div>` : ''}<div class="lap-job" id="lap-job" role="status" ${job ? '' : 'hidden'}><span id="lap-job-text">正在处理…</span><button class="text-button" data-action="lap-cancel">取消</button></div><div class="lap-workspace">${c ? view === 'practice' ? renderPractice(c) : view === 'exam' ? renderExam(c) : renderWords(c) : '<div class="empty"><h2>带来你的第一份 LAP</h2><p>直接上传或粘贴 JSON 词表，无需 AI；也可用 AI 识别文档或图片。核对后开始学习。</p><button class="button primary" data-action="lap-import">上传资料</button></div>'}</div></div>`;
    if (view === 'practice' && c?.practice?.queue.length) queueMicrotask(() => { if (isPage()) (c.practice.feedback ? $('[data-action="lap-practice-next"]') : $('[data-lap-practice]'))?.focus({preventScroll:true}); });
    if (view === 'practice' && c?.practice?.queue[0]?.skill === 'spelling' && !c.practice.feedback && state().settings.autoSpeak && !job) queueMicrotask(() => { if (isPage()) { const e = c.entries.find(e => e.id === c.practice.queue[0]?.entryId); if (e) playWords([e.word]); } });
  }
  document.addEventListener('ciyu-ai-stream', e => { if (job?.signal === e.detail.signal && $('#lap-job-text')) $('#lap-job-text').textContent = `AI 正在${e.detail.content ? '输出' : '思考'}… 已接收 ${e.detail.content.length + e.detail.reasoningCount} 字`; });
  async function runJob(work) {
    if (job) return;
    const controller = new AbortController(); job = controller; stopPlayback(); renderPage();
    const report = message => { if (isPage() && $('#lap-job-text')) $('#lap-job-text').textContent = message; };
    try { await work(controller.signal, report); }
    catch (error) { if (error.name !== 'AbortError') bridge.toast(error.message, true); else if (isPage()) bridge.toast('已取消，作答仍然保留'); }
    finally { if (job === controller) job = null; if (isPage()) { renderPage(); if (paper()?.result && view === 'exam') $('.lap-score')?.scrollIntoView({block:'start'}); } }
  }
  function openImport() {
    let source = { text: '', images: [], name: 'LAP 单词' };
    bridge.openModal('导入 LAP 词表', 'JSON 直接导入无需 AI；文档与图片可使用 AI 识别。', `<label class="dropzone" id="lap-drop" for="lap-files">${icon('upload')}<span>选择或拖入 JSON / 一份文档 / 最多 8 张图片</span><input id="lap-files" type="file" accept=".json,.txt,.md,.csv,.tsv,.pdf,.docx,.png,.jpg,.jpeg,.webp" multiple hidden></label><p class="hint">PDF 需含可读取文字；扫描资料请上传 PNG / JPEG / WebP 图片。Word 支持 .docx。单文件 15 MB，合计 30 MB。</p><div class="field"><label for="lap-source-text">粘贴 JSON 数组或词表（词表请保留词性列标题）</label><textarea class="textarea" id="lap-source-text" maxlength="150000"></textarea></div><p class="hint">JSON 使用 word、pos、noun、verb、pastTense、adjective、adverb 字段，N/A 表示空白；可选 num、meaning、note。点击“直接导入 JSON”只在本机解析。点击 AI 识别才把文字和图片发送到你选择的 AI 服务。PDF / Word 读取器首次需联网加载。原始图片不会保存进词书或备份。</p><div id="lap-import-status" class="ai-document-progress" role="status"></div><div class="modal-foot"><button class="button" data-action="lap-import-cancel">取消</button><button class="button primary" id="lap-json-import">直接导入 JSON（无需 AI）</button><button class="button" id="lap-recognize">AI 识别词表</button></div>`);
    const status = $('#lap-import-status'), recognize = $('#lap-recognize'), textarea = $('#lap-source-text'), input = $('#lap-files');
    const report = message => { if (status.isConnected) status.textContent = message; };
    $('#lap-json-import').addEventListener('click', () => {
      if (importing) return;
      try {
        if (source.images.length) throw new Error('图片不能直接导入 JSON，请选择 JSON 文件或仅粘贴 JSON 数组');
        showEditor(parseLAPJSON(textarea.value, source.name));
      } catch (error) { report(error.message); }
    });
    const read = async files => {
      if (importing || !files.length) return;
      source = { text: '', images: [], name: 'LAP 单词' }; textarea.value = '';
      const controller = new AbortController(); importing = controller; recognize.disabled = input.disabled = textarea.disabled = true;
      try {
        const selected = [...files];
        if (selected.some(f => /\.json$/i.test(f.name))) {
          if (selected.length !== 1) throw new Error('JSON 请一次选择一个文件，不要混合图片或其他文档');
          if (selected[0].size > 15 * 1024 * 1024) throw new Error('JSON 文件不能超过 15 MB');
          const json = await selected[0].text();
          if (controller.signal.aborted || !status.isConnected) return;
          source.name = selected[0].name.replace(/\.json$/i, '') || 'LAP 单词';
          textarea.value = json;
          const result = parseLAPJSON(json, source.name);
          importing = null; showEditor(result); return;
        }
        const result = await readLAPFiles(files, controller.signal, report); if (!controller.signal.aborted && status.isConnected) { source = result; textarea.value = result.text; report(`已读取 ${[...files].map(f => f.name).join('、')}，可点击识别。`); } }
      catch (error) { report(error.name === 'AbortError' ? '已取消' : error.message); }
      finally { if (importing === controller) importing = null; if (recognize.isConnected) recognize.disabled = input.disabled = textarea.disabled = false; }
    };
    input.addEventListener('change', e => read(e.target.files));
    const drop = $('#lap-drop'); ['dragenter','dragover','dragleave','drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); if (type === 'drop') read(e.dataTransfer.files); }));
    recognize.addEventListener('click', async () => {
      if (importing) return;
      source.text = textarea.value.trim();
      if (source.text.startsWith('[') && !source.images.length) {
        try { showEditor(parseLAPJSON(source.text, source.name)); } catch (error) { report(error.message); }
        return;
      }
      if (!requireAI()) return;
      if (!source.text && !source.images.length) { report('请先上传或粘贴词表'); return; }
      const controller = new AbortController(); importing = controller; recognize.disabled = input.disabled = textarea.disabled = true;
      try { const result = await extractLAP({ ...state().settings }, source, controller.signal, report); if (controller.signal.aborted || !status.isConnected) return; importing = null; showEditor(result); }
      catch (error) { report(error.name === 'AbortError' ? '已取消' : error.message); }
      finally { if (importing === controller) importing = null; if (recognize.isConnected) recognize.disabled = input.disabled = textarea.disabled = false; }
    });
  }
  function showEditor(result, existing = null) {
    let entries = structuredClone(result.entries);
    const cols = [...new Set(['noun','verb','pastTense','adjective','adverb', ...entries.flatMap(availablePOS)])];
    bridge.openModal(existing ? '核对 LAP 词族' : '核对导入结果', '只保存表格中的词形；空白和斜线表示没有对应形式。同格多个形式用 / 分隔。', `<div class="field"><label for="lap-name">LAP 名称</label><input class="input" id="lap-name" maxlength="60" value="${esc(result.name)}"></div>${result.warnings?.length ? `<div class="notice">${result.warnings.map(esc).join('<br>')}</div>` : ''}<p class="hint">${entries.length} 个词族。核对拼写、词性与释义；没有释义也可保存，稍后补充。编辑词形后，对应的背诵进度会重置。既有试卷保存出题时的词表。</p><div class="lap-editor-list">${entries.map((e,n) => `<details class="lap-edit-row" ${entries.length <= 8 ? 'open' : ''}><summary>${n + 1}. ${esc(e.word)} · ${esc(e.meaning)}</summary><div class="field"><label>主词<input class="input" data-lap-edit="word" data-index="${n}" value="${esc(e.word)}" maxlength="100"></label></div><div class="field"><label>词族释义<textarea class="textarea" data-lap-edit="meaning" data-index="${n}" maxlength="2000">${esc(e.meaning)}</textarea></label></div><div class="lap-config-grid">${cols.map(pos => `<div class="field"><label>${POS[pos]}<input class="input" data-lap-edit="${pos}" data-index="${n}" value="${esc(formText(e,pos))}" placeholder="／" maxlength="1500"></label><label>对应释义（按词形顺序，用 / 分隔）<input class="input" data-lap-edit-def="${pos}" data-index="${n}" value="${esc((e.forms[pos] || []).map(f => f.meaning).join(' / '))}" maxlength="2000"></label></div>`).join('')}</div><div class="field"><label>用法 / 核对备注<input class="input" data-lap-edit="note" data-index="${n}" value="${esc(e.note)}" maxlength="2000"></label></div><label class="check-label"><input type="checkbox" data-lap-remove="${n}">移除这个词族</label></details>`).join('')}</div><p class="ai-document-progress" id="lap-editor-error" role="status"></p><div class="modal-foot"><button class="button" data-action="close-modal">取消</button><button class="button primary" id="lap-save">保存 LAP</button></div>`);
    $('#lap-save').addEventListener('click', async () => {
      const saveButton = $('#lap-save'); if (saveButton.disabled) return;
      saveButton.disabled = true;
      const previousCollections = structuredClone(collections());
      try {
        const name = $('#lap-name').value.trim(); if (!name) throw new Error('请填写 LAP 名称');
        const edited = structuredClone(entries);
        document.querySelectorAll('[data-lap-edit]').forEach(input => {
          const e = edited[Number(input.dataset.index)], key = input.dataset.lapEdit;
          if (POS[key]) {
            const values = input.value.split(/[,;，；/]+/).map(v => v.trim()).filter(v => v && !/^[—–\-\\\s]+$/.test(v));
            e.forms[key] = values.map(word => e.forms[key]?.find(f => spelling(f.text) === spelling(word)) || { text: word, meaning: '' });
          } else e[key] = input.value.trim();
        });
        document.querySelectorAll('[data-lap-edit-def]').forEach(input => {
          const e = edited[Number(input.dataset.index)], pos = input.dataset.lapEditDef;
          const meanings = input.value.split('/').map(v => v.trim());
          (e.forms[pos] || []).forEach((form, i) => { form.meaning = meanings[i] || ''; });
        });
        const removed = new Set([...document.querySelectorAll('[data-lap-remove]:checked')].map(el => Number(el.dataset.lapRemove)));
        const clean = normalizeEntries(edited.filter((_, n) => !removed.has(n)), true); if (!clean.length) throw new Error('请至少保留一个词族');
        if (new Set(clean.map(e => spelling(e.word))).size !== clean.length) throw new Error('有重复主词，请合并词族后保存');
        if (existing) {
          for (const entry of clean) {
            const old = existing.entries.find(e => e.id === entry.id);
            if (!old || old.word !== entry.word || old.meaning !== entry.meaning || JSON.stringify(old.forms) !== JSON.stringify(entry.forms)) entry.progress = normalizeEntries([{ ...entry, progress: null }])[0].progress;
          }
          Object.assign(existing, { name, entries: clean, practice: null }); selectedId = existing.id;
        } else { const c = { id: uid(), mode: 'lap', name, entries: clean, createdAt: Date.now(), papers: [], activePaperId: '', practice: null, examConfig: { ...DEFAULT_EXAM } }; collections().push(c); selectedId = c.id; }
        if (!await bridge.persist()) {
          state().maple.collections = previousCollections;
          throw new Error('保存未成功，导入内容仍在此核对页。请先导出已有数据备份，解决存储问题后再点击保存。');
        }
        view = 'words'; query = ''; page = 0; bridge.closeModal(); bridge.navigate('maple'); bridge.toast('LAP 词族已保存');
      } catch (error) { $('#lap-editor-error').textContent = error.message; }
      finally { if (saveButton.isConnected) saveButton.disabled = false; }
    });
  }
  async function checkPractice(reveal = false) {
    const c = collection(), s = c?.practice, task = s?.queue[0], entry = c?.entries.find(e => e.id === task?.entryId);
    if (!entry || s.feedback || job) return;
    const apply = feedback => { recordStudy(state(), entry.word); s.feedback = feedback; updateProgress(entry, task.skill, feedback.correct); bridge.persist(); };
    if (reveal) { s.answer = {}; apply({ correct: false, text: task.skill === 'spelling' ? `${entry.word} · ${entry.meaning}` : task.skill === 'forms' ? practicePOS(entry).map(pos => `${POS[pos]}：${formText(entry,pos)}`).join('\n') : entry.meaning }); }
    else if (task.skill === 'spelling') apply({ correct: spelling(s.answer) === spelling(entry.word), text: `${entry.word} · ${entry.meaning}` });
    else if (task.skill === 'forms') { const checks = checkForms(entry, s.answer, practicePOS(entry)); apply({ correct: checks.every(c => c.correct), text: checks.map(c => `${POS[c.pos]}：${c.correct ? '正确' : `应为 ${c.expected}`}`).join('\n') }); }
    else { if (!requireAI()) return; await runJob(async signal => { const feedback = await gradeMeaning({ ...state().settings }, entry, s.answer, signal); if (!signal.aborted) apply(feedback); }); return; }
    stopPlayback(); renderPage();
  }
  document.addEventListener('input', e => {
    const input = e.target;
    if (input.dataset.lapAnswer) {
      const p = paper(), q = p?.questions.find(q => q.id === input.dataset.lapAnswer); if (!q || p.result || job) return;
      if (q.section === 'forms') q.answer[input.dataset.pos] = input.value; else q.answer = input.value;
      bridge.persist();
    }
    if (input.id === 'lap-practice-answer' || input.hasAttribute('data-lap-practice')) {
      const s = collection()?.practice; if (!s || s.feedback || job) return;
      if (input.dataset.pos) { if (!s.answer || typeof s.answer !== 'object') s.answer = {}; s.answer[input.dataset.pos] = input.value; } else s.answer = input.value;
      bridge.persist();
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'lap-collection') { job?.abort(); stopPlayback(); selectedId = e.target.value; view = 'words'; query = ''; page = 0; renderPage(); }
    if (e.target.id === 'lap-paper-select') { if (job) return; stopPlayback(); collection().activePaperId = e.target.value; bridge.persist(); renderPage(); }
    if (e.target.id === 'lap-search') { query = e.target.value; page = 0; renderPage(); $('#lap-search')?.focus(); }
  });
  document.addEventListener('submit', async e => {
    if (e.target.id === 'lap-practice-form') { e.preventDefault(); await checkPractice(); }
    if (e.target.id === 'lap-exam-form') {
      e.preventDefault(); if (job || !requireAI()) return;
      const startImmersive = $('#lap-immersive-start').checked;
      const c = collection(), config = { repeatWords: $('#lap-repeat').checked, ...Object.fromEntries([...document.querySelectorAll('[data-lap-count]')].map(el => [el.dataset.lapCount, Number(el.value)])) };
      let p; try { p = createPaper(c, config); } catch (error) { bridge.toast(error.message, true); return; }
      c.examConfig = p.config; bridge.persist();
      await runJob(async (signal, report) => { await generateCorrections({ ...state().settings }, p, signal, report); if (signal.aborted) return; c.papers.push(p); c.papers = c.papers.slice(-20); c.activePaperId = p.id; bridge.persist(); });
      if (startImmersive && isPage() && paper()?.id === p.id) await setImmersive(true);
      if (isPage() && paper()?.id === p.id) playWords(p.questions.filter(q => q.section === 'forms').map(q => q.entry.word));
    }
  });
  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-action^="lap-"]'); if (!button || button.disabled) return;
    const action = button.dataset.action, c = collection();
    if (action === 'lap-answer-toggle') { button.classList.toggle('show-answer'); return; }
    if (action === 'lap-immersive') { await setImmersive(!immersive); return; }
    if (action === 'lap-import') openImport();
    else if (action === 'lap-import-cancel') { importing?.abort(); bridge.closeModal(); }
    else if (action === 'lap-tab') { if (immersive) await setImmersive(false); stopPlayback(); view = button.dataset.view; renderPage(); }
    else if (action === 'lap-page') { page = Number(button.dataset.page); renderPage(); }
    else if (action === 'lap-edit' && c) showEditor(c, c);
    else if (action === 'lap-delete' && c) { if (await bridge.confirm('删除这份 LAP？', '这份资料的词族、背诵进度和模拟试卷会一起删除，可以先导出完整备份。', '删除', true)) { state().maple.collections = collections().filter(item => item.id !== c.id); bridge.persist(); renderPage(); } }
    else if (action === 'lap-audio') { const entry = c?.entries.find(e => e.id === button.dataset.entry); if (entry) playWords([entry.word]); }
    else if (action === 'lap-cancel') job?.abort();
    else if (action === 'lap-stop-audio') stopPlayback();
    else if (action === 'lap-play-all') playWords(paper().questions.filter(q => q.section === 'forms').map(q => q.entry.word));
    else if (action === 'lap-question-audio') { const q = paper()?.questions.find(q => q.id === button.dataset.question); if (q) playWords([q.entry.word]); }
    else if (action === 'lap-practice-start' || action === 'lap-practice-all') { if (!c) return; const skills = ['forms']; c.practice = startPractice(c, action === 'lap-practice-all', Date.now(), skills); bridge.persist(); if (!c.practice) bridge.toast('当前没有到期项目，可以选择练习全部词族'); renderPage(); }
    else if (action === 'lap-practice-audio') { const task = c?.practice?.queue[0], entry = c?.entries.find(e => e.id === task?.entryId); if (entry) playWords([entry.word]); }
    else if (action === 'lap-practice-reveal') await checkPractice(true);
    else if (action === 'lap-practice-next') { const s = c?.practice; if (!s?.feedback) return; const task = s.queue.shift(); if (!s.feedback.correct) s.queue.splice(Math.min(3, s.queue.length), 0, task); s.completed++; s.feedback = null; s.answer = s.queue[0]?.skill === 'spelling' ? '' : {}; bridge.persist(); stopPlayback(); renderPage(); }
    else if (action === 'lap-grade') {
      const p = paper(); if (!p || p.result || job || !requireAI()) return;
      if (!button.dataset.enter && !await bridge.confirm('提交这张试卷？', '未填写的答案按 0 分处理。批改完成后本卷不能修改，可重新生成试卷继续练习。', '交卷')) return;
      await runJob(async (signal, report) => { const result = await gradePaper({ ...state().settings }, structuredClone(p), signal, report); if (signal.aborted) return; p.result = result; p.submittedAt = Date.now(); for (const q of p.questions) recordStudy(state(), q.entry.word); bridge.persist(); });
    }
    else if (action === 'lap-print') { document.body.classList.add('lap-printing'); window.print(); document.body.classList.remove('lap-printing'); }
  });
  document.addEventListener('keydown', e => {
    if (!isPage() || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('.lap-answer-cell.wrong') && e.target.tagName !== 'INPUT') { e.preventDefault(); e.target.closest('.lap-answer-cell').classList.toggle('show-answer'); return; }
    const input = e.target;
    if (!input.matches('[data-lap-practice], [data-lap-answer]')) return;
    e.preventDefault();
    if (input.readOnly) { if (input.hasAttribute('data-lap-practice')) $('[data-action="lap-practice-next"]')?.click(); return; }
    const scope = input.hasAttribute('data-lap-practice') ? '#lap-practice-form' : '.lap-paper';
    const inputs = [...document.querySelectorAll(`${scope} input:not([readonly]):not([disabled]), ${scope} textarea:not([readonly]):not([disabled])`)];
    const next = inputs[inputs.indexOf(input)+1];
    if (next) next.focus(); else if (scope === '#lap-practice-form') $('#lap-practice-form').requestSubmit();
    else { const button = $('[data-action="lap-grade"]'); if (button && !button.disabled) { button.dataset.enter = 'true'; button.click(); delete button.dataset.enter; } }
  });
  $('#modal').addEventListener('close', () => importing?.abort());
  const cancelAll = () => { document.body.classList.remove('lap-practicing'); if (immersive) { immersive = false; document.body.classList.remove('lap-immersive'); if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); } job?.abort(); importing?.abort(); stopPlayback(); };
  document.addEventListener('change', e => { if (e.target.dataset.setting === 'aiEnabled' && !e.target.checked) cancelAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  return { renderPage, cancelAll, onNavigate: cancelAll };
}
