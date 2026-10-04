import {
  MODE_INFO, DEFAULT_SETTINGS, STORAGE_KEY, LEGACY_KEY, SAMPLE_TEXT, uid, normWord, sanitizeSettings,
  bookById, wordById, bookStats, parseImport, decodeText, importEntries, shuffle, sessionKey,
  startSession, currentItem, chooseNext, revealSpeaking, gradeAnswer, correctToWrong, retryAnswer,
  advanceSession, isMastered, setMastery, resetBook, removeWord, invalidateSessions
} from './core.js';
import { loadState, saveState, parseBackup, backupText, downloadFile } from './storage.js';
import { Pronunciation } from './audio.js';
import { icon } from './icons.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main'); const dialog = $('#modal');
const loaded = loadState(); let state = loaded.state;
let route = 'library'; let confirmResolve = null; let lastFocused = null; let bookQuery = ''; let saveFailed = false; let inputSave = null; let recoveryRequired = !!loaded.error;
const wordsStates = new Map();
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const audio = new Pronunciation(() => state.settings, (text, error) => {
  const element = $('#audio-status'); element.textContent = text; element.hidden = !text; element.classList.toggle('error', !!error);
});
const MODES = ['read', 'listen', 'speak', 'write'];
function toast(message, error = false) {
  const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.textContent = message;
  $('#toasts').append(element); setTimeout(() => element.remove(), error ? 6000 : 3200);
}
function persist() {
  if (recoveryRequired) return;
  try { saveState(state); saveFailed = false; }
  catch { if (!saveFailed) toast('保存空间不足，请先导出备份，再移除自定义背景。', true); saveFailed = true; }
}
function applyTheme() {
  const dark = state.settings.theme === 'dark' || state.settings.theme === 'auto' && darkQuery.matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dark ? '#161a28' : '#f7f8fc';
  document.body.classList.toggle('with-bg', !!state.settings.background);
  $('#wallpaper').style.backgroundImage = state.settings.background ? `url("${state.settings.background}")` : '';
}
function decorate(root = document) { root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); }); }
function pct(done, total) { return total ? Math.round(done / total * 100) : 0; }
function duration(ms) { const seconds = Math.round(ms / 1000); return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`; }
function dueText(time) {
  const delta = time - Date.now(); if (delta <= 0) return '现在可以复习';
  if (delta < 36e5) return `${Math.ceil(delta / 6e4)} 分钟后复习`;
  if (delta < 864e5) return `${Math.ceil(delta / 36e5)} 小时后复习`;
  return `${Math.ceil(delta / 864e5)} 天后复习`;
}
function navigation() {
  const active = route.startsWith('book/') ? 'library' : route;
  document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === active));
  const totalDue = state.books.reduce((sum, book) => sum + bookStats(book).due, 0);
  $('#nav-due').textContent = totalDue; $('#nav-due').hidden = !totalDue;
  const names = { library: '我的词书', review: '记忆复习', settings: '学习设置' };
  $('#breadcrumb').innerHTML = `我的学习空间 <span>/</span> ${esc(names[active] || '词表')}`;
  document.body.classList.toggle('focus-mode', route.startsWith('practice/') || route.startsWith('result/'));
}
function navigate(next, options = {}) {
  clearTimeout(inputSave); audio.stop(); route = next;
  const hash = `#${next}`; if (location.hash !== hash) history[options.replace ? 'replaceState' : 'pushState'](null, '', hash);
  render(options);
  if (!options.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
}
function render(options = {}) {
  navigation();
  if (route.startsWith('practice/')) renderSession(decodeURIComponent(route.slice(9)), options);
  else if (route.startsWith('result/')) renderResult(route.slice(7));
  else if (route.startsWith('book/')) renderWords(decodeURIComponent(route.slice(5)));
  else if (route === 'settings') renderSettings();
  else if (route === 'review') renderReview();
  else renderLibrary();
  decorate(main);
}
function libraryCard(book) {
  const stats = bookStats(book); const sessions = Object.values(state.sessions).filter(session => session.bookId === book.id);
  return `<article class="book-card" data-book-card="${esc(book.id)}">
    <div class="book-top"><div class="book-title"><div class="book-cover">${icon('book')}</div><div><h3>${esc(book.name)}</h3><p>${stats.total} 个词条${stats.due ? ` · ${stats.due} 个待复习` : ''}</p></div></div><button class="icon-button" data-action="book-menu" data-book="${esc(book.id)}" aria-label="${esc(book.name)}的管理选项">${icon('more')}</button></div>
    ${sessions.length ? `<div class="resume-tag">${icon('clock')}${sessions.map(session => MODE_INFO[session.mode].name).join('、')}进行中</div>` : ''}
    <div class="book-progress">${MODES.map(mode => `<div class="progress-row"><span>${MODE_INFO[mode].name}</span><div class="progress-track"><i style="width:${pct(stats[mode], stats.total)}%"></i></div><span>${pct(stats[mode], stats.total)}%</span></div>`).join('')}</div>
    <div class="book-actions"><button class="button primary" data-action="choose-mode" data-book="${esc(book.id)}">${sessions.length ? '继续 / 选择练习' : '开始学习'}${icon('arrow')}</button><button class="button" data-action="words" data-book="${esc(book.id)}">查看词表</button></div>
  </article>`;
}
function renderBookGrid() {
  const books = state.books.filter(book => book.name.toLowerCase().includes(bookQuery.toLowerCase()));
  $('#books').innerHTML = books.length ? books.map(libraryCard).join('') : `<div class="empty" style="grid-column:1/-1"><p style="margin:0">没有找到这本词书，换个名字试试。</p></div>`;
}
function renderLibrary() {
  const due = state.books.reduce((sum, book) => sum + bookStats(book).due, 0);
  const count = state.books.reduce((sum, book) => sum + book.words.length, 0);
  const sessions = Object.values(state.sessions).sort((a, b) => b.startedAt - a.startedAt);
  const recent = sessions[0];
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  main.innerHTML = `<div class="page">
    <div class="page-intro"><div><h1>把词汇，练成直觉。</h1><p>从认识到会用，找到适合你的练习节奏。</p></div><span class="date-label">${date}</span></div>
    <section class="welcome"><div class="welcome-copy"><div class="eyebrow">YOUR VOCABULARY ISLAND</div><h2>${due ? '让熟悉的词，再见一面。' : '今天，给记忆一点空间。'}</h2><p>${due ? `有 ${due} 个词到了复习时间，趁还记得，再巩固一次。` : '不用着急，一次只专注眼前的一小组。'}</p><button class="button primary" data-action="${due ? 'review-all' : state.books.length ? 'choose-mode' : 'demo'}" ${state.books.length && !due ? `data-book="${esc(state.books[0].id)}"` : ''}>${due ? '开始今日复习' : state.books.length ? '开始一小组' : '试学一组'}${icon('arrow')}</button></div><div class="hero-art" aria-hidden="true"><div class="hero-ring"></div><div class="hero-stone"></div><div class="hero-card back"><span>Aa</span><i></i><i></i></div><div class="hero-card"><span>a.</span><i></i><i></i></div><div class="hero-dot"></div></div></section>
    <div class="metrics"><div class="metric"><div class="metric-icon">${icon('library')}</div><div><div class="metric-value">${count}</div><div class="metric-label">我的词汇 · ${state.books.length} 本词书</div></div></div><div class="metric"><div class="metric-icon">${icon('calendar')}</div><div><div class="metric-value">${due}</div><div class="metric-label">今日待复习</div></div></div><div class="metric"><div class="metric-icon">${icon('checklist')}</div><div><div class="metric-value">${state.history.length}</div><div class="metric-label">已完成的练习</div></div></div></div>
    ${recent ? `<div class="continue-card">${icon('clock')}<div><h3>接着上次的节奏</h3><p>${esc(recent.bookId === 'all' ? '全部词书' : bookById(state, recent.bookId)?.name)} · ${MODE_INFO[recent.mode].name} · 还有 ${recent.active.length + recent.queue.length} 项</p></div><button class="button primary compact" data-action="resume" data-key="${esc(recent.key)}">继续练习${icon('arrow')}</button></div>` : ''}
    <div class="section-head"><h2>我的词书<small>${state.books.length} 本</small></h2>${state.books.length ? `<div class="search-field">${icon('search')}<input class="input book-search" id="book-search" aria-label="搜索词书" placeholder="找一本词书…" value="${esc(bookQuery)}"></div>` : ''}</div>
    ${state.books.length ? '<div id="books" class="books"></div>' : `<div class="empty"><div class="empty-icon">${icon('book')}</div><h3>你的第一座词汇小岛</h3><p>把自己的单词、短语或句子粘贴进来，也可以上传 TXT。认读、听力、口语和写作，会各自记录进度。</p><div class="empty-actions"><button class="button primary" data-action="import">${icon('plus')}导入我的词书</button><button class="button" data-action="demo">先试学一组</button></div></div>`}
  </div>`;
  if (state.books.length) renderBookGrid();
}
function openModal(title, subtitle, body) {
  if (dialog.open) closeModal(); lastFocused = document.activeElement;
  $('#modal-content').innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  dialog.showModal(); decorate(dialog);
}
function closeModal(confirmed = false) {
  if (dialog.open) dialog.close();
  if (confirmResolve) { const resolve = confirmResolve; confirmResolve = null; resolve(confirmed); }
  if (lastFocused?.isConnected) lastFocused.focus({ preventScroll: true });
}
function confirm(title, message, button = '确认', danger = false) {
  openModal(esc(title), '', `<p class="confirm-message">${esc(message)}</p><div class="modal-foot"><button class="button" data-action="close-modal">取消</button><button class="button ${danger ? 'danger' : 'primary'}" data-action="confirm">${esc(button)}</button></div>`);
  return new Promise(resolve => { confirmResolve = resolve; });
}
dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeModal(); } });
function chooseMode(bookId) {
  const book = bookById(state, bookId); if (!book) return;
  const stats = bookStats(book);
  openModal(esc(book.name), '选一个练习方式，进度会分别记录。', `<div class="mode-grid">${Object.entries(MODE_INFO).map(([mode, info]) => {
    const session = state.sessions[sessionKey(bookId, mode)];
    const progress = mode === 'review' ? `${stats.due} 个到期词` : mode === 'audit' ? '检查全书，每词仅一次' : `${stats[mode]} / ${stats.total} 已掌握`;
    const detail = mode === 'read' ? `连续认识 ${state.settings.target} 次算掌握` : info.detail;
    return `<button class="mode-tile" data-action="start" data-book="${esc(bookId)}" data-mode="${mode}">${icon(info.icon)}<h3>${info.name}${session ? ' · 继续' : ''}</h3><p>${esc(detail)}</p><div class="badge">${session ? `还有 ${session.active.length + session.queue.length} 项` : progress}</div></button>`;
  }).join('')}</div><div class="notice" style="margin-top:18px">${icon('info')}练习没有倒计时。看完答案后，由你决定什么时候继续。</div>`);
}
async function begin(bookId, mode, options = {}) {
  closeModal(); const book = bookById(state, bookId);
  if (!book && bookId !== 'all') return;
  if (mode !== 'review' && !book.words.length) { openImport(bookId); return; }
  if (mode !== 'review' && mode !== 'audit' && !state.sessions[sessionKey(bookId, mode)] && book.words.every(word => word[MODE_INFO[mode].flag])) {
    const yes = await confirm('已经全部掌握', `《${book.name}》的${MODE_INFO[mode].name}已经完成。重新练习会重置这一模式的掌握状态，其他模式保持原有进度。`, '重新练习');
    if (!yes) return; options = { ...options, restart: true, reset: true };
  }
  const session = startSession(state, bookId, mode, options);
  if (!session) { toast(mode === 'review' ? '还没有到期词，晚一点再来看看。' : '这本词书还没有可以练习的词'); return; }
  persist(); navigate(`practice/${encodeURIComponent(session.key)}`);
}
function openImport(presetId) {
  let parsed = { entries: [], errors: [] };
  openModal('把词汇带到这里', '粘贴文字，或上传一份 TXT 词表。', `
    <div class="two-fields"><div class="field"><label for="import-target">保存到</label><select id="import-target"><option value="new">新建一本词书</option>${state.books.map(book => `<option value="${esc(book.id)}" ${presetId === book.id ? 'selected' : ''}>${esc(book.name)}</option>`).join('')}</select></div><div class="field" id="name-field"><label for="import-name">词书名称</label><input class="input" id="import-name" maxlength="60" placeholder="例如：雅思表达 · 家庭与情感"></div></div>
    <div class="import-tools"><span class="label">一行一个词条</span><div><button class="button ghost compact" data-action="import-example">填入示例</button><button class="button ghost compact" data-action="import-empty">清空</button></div></div>
    <textarea class="textarea" id="import-text" spellcheck="false" aria-label="词表内容" placeholder="apple | 苹果&#10;look after / take care of | 照顾；照料&#10;resilience | /rɪˈzɪliəns/ | 韧性；恢复力"></textarea>
    <label class="dropzone" id="dropzone" for="import-file">${icon('upload')}<span id="file-label">选择或拖入 TXT · 自动识别常见编码</span><input id="import-file" type="file" accept=".txt,text/plain" hidden></label>
    <details class="format-help"><summary>查看支持的词表格式</summary><p>英文与中文之间用 <code>|</code> 或 Tab 分隔。三列时，中间一列是音标。<br>多个释义用分号分隔；同义英文用 <code>/</code> 分隔。写作练习会要求写全同组表达。<br>以 <code>#</code> 开头的行会忽略；重复词会合并释义。</p></details>
    <div id="import-preview"></div><div class="modal-foot"><button class="button" data-action="close-modal">取消</button><button class="button primary" id="import-save" disabled>导入词书${icon('arrow')}</button></div>`);
  const textarea = $('#import-text'); const button = $('#import-save');
  const update = () => {
    parsed = parseImport(textarea.value); const preview = $('#import-preview');
    button.disabled = !parsed.entries.length; button.textContent = parsed.entries.length ? `导入 ${parsed.entries.reduce((n, e) => n + e.ens.length, 0)} 个词` : '导入词书';
    preview.innerHTML = parsed.entries.length || parsed.errors.length ? `<div class="preview ${!parsed.entries.length ? 'errors' : ''}">${parsed.entries.length ? `已读出 ${parsed.entries.length} 组表达` : '暂时没有可导入的词'}${parsed.errors.length ? `<small>${parsed.errors.length} 行格式不完整，将跳过：${parsed.errors.slice(0, 3).map(e => `第 ${e.line} 行 · ${esc(e.message)}`).join('；')}</small>` : ''}<div class="preview-chips">${parsed.entries.slice(0, 4).map(e => `<span>${esc(e.ens[0])}</span>`).join('')}</div></div>` : '';
  };
  const targetChanged = () => { $('#name-field').hidden = $('#import-target').value !== 'new'; };
  targetChanged(); $('#import-target').addEventListener('change', targetChanged); textarea.addEventListener('input', update);
  $('#modal-content [data-action="import-example"]').addEventListener('click', () => { textarea.value = SAMPLE_TEXT; update(); });
  $('#modal-content [data-action="import-empty"]').addEventListener('click', () => { textarea.value = ''; $('#file-label').textContent = '选择或拖入 TXT · 自动识别常见编码'; update(); });
  const readFile = async file => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('词表超过 10 MB，请拆成几份导入。', true); return; }
    try { textarea.value = decodeText(await file.arrayBuffer()); $('#file-label').textContent = file.name; update(); }
    catch { toast('这份文件没有读成功，试试重新选择。', true); }
  };
  $('#import-file').addEventListener('change', event => readFile(event.target.files[0]));
  const drop = $('#dropzone');
  ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', event => readFile(event.dataTransfer.files[0]));
  button.addEventListener('click', () => {
    if (!parsed.entries.length) return;
    const target = $('#import-target').value;
    const { book, added, updated } = importEntries(state, parsed.entries, $('#import-name').value || '我的词书', target === 'new' ? null : target);
    persist(); closeModal(); navigate('library'); toast(`《${book.name}》新增 ${added} 个词${updated ? `，更新 ${updated} 个词` : ''}`);
  });
  textarea.focus();
}
function bookMenu(bookId) {
  const book = bookById(state, bookId); if (!book) return;
  openModal(esc(book.name), `${book.words.length} 个词条 · 你的词书，由你安排`, `<div class="menu-options">
    <button class="button" data-action="rename" data-book="${esc(bookId)}">${icon('pen')}修改词书名称</button>
    <button class="button" data-action="append" data-book="${esc(bookId)}">${icon('plus')}继续添加词汇</button>
    <button class="button" data-action="export-book" data-book="${esc(bookId)}">${icon('download')}导出本书 TXT</button>
    <button class="button" data-action="reset-book" data-book="${esc(bookId)}">${icon('reset')}重置本书进度</button>
    <button class="button danger" data-action="delete-book" data-book="${esc(bookId)}">${icon('trash')}删除词书</button></div>`);
}
function renameBook(bookId) {
  const book = bookById(state, bookId); if (!book) return;
  openModal('给词书换个名字', '', `<div class="field"><label for="rename-input">词书名称</label><input class="input" id="rename-input" maxlength="60" value="${esc(book.name)}"></div><div class="modal-foot"><button class="button" data-action="close-modal">取消</button><button class="button primary" id="rename-save">保存名称</button></div>`);
  $('#rename-save').addEventListener('click', () => { const name = $('#rename-input').value.trim(); if (!name) return; book.name = name; persist(); closeModal(); render(); toast('名称已更新'); });
  $('#rename-input').select();
}
function exportBook(bookId) {
  const book = bookById(state, bookId); if (!book) return;
  const groups = new Map();
  for (const word of book.words) { const group = word.synGroup || word.id; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(word); }
  const text = [...groups.values()].map(words => `${words.map(w => w.en).join(' / ')} | ${words[0].phonetic ? `${words[0].phonetic} | ` : ''}${[...new Set(words.flatMap(w => w.defs))].join('；')}`).join('\n');
  downloadFile(`${book.name.replace(/[\\/:*?"<>|]/g, '_')}.txt`, text, 'text/plain;charset=utf-8'); toast('词表已导出');
}
function wordsUi(book) {
  if (!wordsStates.has(book.id)) wordsStates.set(book.id, { search: '', mode: 'read', filter: 'all', hiddenEn: new Set(), hiddenDef: new Set(), order: book.words.map(w => w.id), page: 0 });
  return wordsStates.get(book.id);
}
function renderWords(bookId) {
  const book = bookById(state, bookId); if (!book) { navigate('library', { replace: true }); return; }
  const ui = wordsUi(book);
  main.innerHTML = `<div class="page"><button class="back-link" data-nav="library">${icon('back')}返回我的词书</button><div class="page-intro"><div><h1>${esc(book.name)}</h1><p>查词、遮词自测，或调整掌握状态。</p></div><div class="empty-actions"><button class="button" data-action="append" data-book="${esc(bookId)}">${icon('plus')}加词</button><button class="button primary" data-action="choose-mode" data-book="${esc(bookId)}">开始学习${icon('arrow')}</button></div></div>
    <div class="word-toolbar"><div class="search-field">${icon('search')}<input class="input" id="words-search" aria-label="搜索单词或释义" placeholder="搜索英文或中文释义…" value="${esc(ui.search)}"></div><select id="words-mode" aria-label="按学习模式筛选">${MODES.map(mode => `<option value="${mode}" ${mode === ui.mode ? 'selected' : ''}>${MODE_INFO[mode].name}状态</option>`).join('')}</select><select id="words-filter" aria-label="筛选掌握状态"><option value="all" ${ui.filter === 'all' ? 'selected' : ''}>全部词汇</option><option value="learning" ${ui.filter === 'learning' ? 'selected' : ''}>未掌握</option><option value="mastered" ${ui.filter === 'mastered' ? 'selected' : ''}>已掌握</option><option value="audit" ${ui.filter === 'audit' ? 'selected' : ''}>审查错词</option></select>
    <button class="button" data-action="mask-en" data-book="${esc(bookId)}" id="mask-en">${icon('hide')}隐藏英文</button><button class="button" data-action="mask-def" data-book="${esc(bookId)}" id="mask-def">${icon('hide')}隐藏中文</button><button class="button" data-action="shuffle" data-book="${esc(bookId)}">${icon('shuffle')}打乱</button><button class="button" data-action="restore-order" data-book="${esc(bookId)}">${icon('reset')}恢复</button></div>
    <div id="word-count" class="list-count"></div><div id="word-list" class="word-list"></div><div id="pagination" class="pagination"></div></div>`;
  renderWordRows(book);
}
function renderWordRows(book) {
  const ui = wordsUi(book), byId = new Map(book.words.map(w => [w.id, w]));
  ui.order = [...ui.order.filter(id => byId.has(id)), ...book.words.filter(w => !ui.order.includes(w.id)).map(w => w.id)];
  let words = ui.order.map(id => byId.get(id)); const search = ui.search.trim().toLowerCase();
  if (search) words = words.filter(w => w.en.toLowerCase().includes(search) || w.defs.some(def => def.toLowerCase().includes(search)));
  if (ui.filter === 'audit') words = words.filter(w => w.auditWrong);
  else if (ui.filter !== 'all') words = words.filter(w => !!w[MODE_INFO[ui.mode].flag] === (ui.filter === 'mastered'));
  const pages = Math.ceil(words.length / 40); ui.page = Math.min(ui.page, Math.max(0, pages - 1));
  $('#word-count').textContent = `${words.length} 个词 · ${MODE_INFO[ui.mode].name}已掌握 ${words.filter(w => w[MODE_INFO[ui.mode].flag]).length} 个`;
  $('#word-list').innerHTML = words.slice(ui.page * 40, (ui.page + 1) * 40).map(word => `<article class="word-row">
    <div class="word-english"><button class="icon-button" data-action="word-audio" data-book="${esc(book.id)}" data-word="${esc(word.id)}" aria-label="${ui.hiddenEn.has(word.id) ? '播放该词的发音' : `播放 ${esc(word.en)} 的发音`}">${icon('volume')}</button><div>${ui.hiddenEn.has(word.id) ? `<button class="masked" data-action="unmask-en" data-book="${esc(book.id)}" data-word="${esc(word.id)}">点击看英文</button>` : `<div class="word-en">${esc(word.en)}</div>${word.phonetic ? `<div class="word-phonetic">${esc(word.phonetic)}</div>` : ''}`}</div></div>
    <div class="word-def">${ui.hiddenDef.has(word.id) ? `<button class="masked" data-action="unmask-def" data-book="${esc(book.id)}" data-word="${esc(word.id)}">点击看释义</button>` : esc(word.defs.join('；'))}</div>
    <div class="word-right"><div class="mastery-chips">${MODES.map(mode => `<button class="chip ${word[MODE_INFO[mode].flag] ? 'done' : ''}" data-action="toggle-mastery" data-book="${esc(book.id)}" data-word="${esc(word.id)}" data-mode="${mode}" aria-label="${MODE_INFO[mode].name}${word[MODE_INFO[mode].flag] ? '已掌握，点击改为未掌握' : '未掌握，点击标记已掌握'}">${MODE_INFO[mode].name}${word[MODE_INFO[mode].flag] ? ' ✓' : ''}</button>`).join('')}</div><button class="icon-button" data-action="word-menu" data-book="${esc(book.id)}" data-word="${esc(word.id)}" aria-label="管理 ${esc(word.en)}">${icon('more')}</button></div></article>`).join('') || `<div class="empty"><p style="margin:0">没有符合条件的词，换个筛选条件试试。</p></div>`;
  $('#pagination').innerHTML = pages > 1 ? `<button class="button" data-action="word-page" data-page="${ui.page - 1}" data-book="${esc(book.id)}" ${ui.page === 0 ? 'disabled' : ''}>上一页</button><span>${ui.page + 1} / ${pages}</span><button class="button" data-action="word-page" data-page="${ui.page + 1}" data-book="${esc(book.id)}" ${ui.page === pages - 1 ? 'disabled' : ''}>下一页</button>` : '';
  $('#mask-en').innerHTML = `${icon('hide')}${book.words.length && book.words.every(w => ui.hiddenEn.has(w.id)) ? '显示英文' : '隐藏英文'}`;
  $('#mask-def').innerHTML = `${icon('hide')}${book.words.length && book.words.every(w => ui.hiddenDef.has(w.id)) ? '显示中文' : '隐藏中文'}`;
}
function wordMenu(bookId, wordId) {
  const word = wordById(state, bookId, wordId); if (!word) return;
  openModal(esc(word.en), esc(word.defs.join('；')), `<div class="menu-options"><button class="button" data-action="edit-word" data-book="${esc(bookId)}" data-word="${esc(wordId)}">${icon('pen')}编辑英文、音标和释义</button><button class="button" data-action="mark-all" data-book="${esc(bookId)}" data-word="${esc(wordId)}" data-value="${!word.mastered}">${icon('check')}四种模式全部${word.mastered ? '标为未掌握' : '标为已掌握'}</button><button class="button danger" data-action="delete-word" data-book="${esc(bookId)}" data-word="${esc(wordId)}">${icon('trash')}删除这个词</button></div>`);
}
function editWord(bookId, wordId) {
  const word = wordById(state, bookId, wordId); if (!word) return;
  openModal('调整这个词', '', `<div class="field"><label for="edit-en">英文</label><input class="input" id="edit-en" value="${esc(word.en)}"></div><div class="field"><label for="edit-phonetic">音标（可不填）</label><input class="input" id="edit-phonetic" value="${esc(word.phonetic)}"></div><div class="field"><label for="edit-def">中文释义 · 多个用分号分隔</label><textarea class="textarea" id="edit-def" style="min-height:95px">${esc(word.defs.join('；'))}</textarea></div><p class="hint">编辑会结束本书未完成的练习，已经掌握的进度会保留。</p><div class="modal-foot"><button class="button" data-action="close-modal">取消</button><button class="button primary" id="edit-save">保存修改</button></div>`);
  $('#edit-save').addEventListener('click', () => {
    const en = $('#edit-en').value.trim(), defs = $('#edit-def').value.split(/[;；\n]/).map(v => v.trim()).filter(Boolean);
    if (!en || !defs.length) { toast('请填写英文和中文释义'); return; }
    if (bookById(state, bookId).words.some(w => w.id !== wordId && normWord(w.en) === normWord(en))) { toast('这本词书里已经有这个英文了'); return; }
    Object.assign(word, { en, ens: [en], phonetic: $('#edit-phonetic').value.trim(), defs });
    invalidateSessions(state, bookId); persist(); closeModal(); render(); toast('修改已保存');
  });
}
function renderReview() {
  const total = state.books.reduce((sum, book) => sum + bookStats(book).due, 0);
  const allSession = state.sessions[sessionKey('all', 'review')];
  main.innerHTML = `<div class="page"><div class="page-intro"><div><h1>在遗忘前，再见一面。</h1><p>复习到期的词，让短暂的熟悉变成长期的记忆。</p></div></div>
    <section class="panel review-top"><div class="panel-head">${icon('calendar')}<h2>${allSession ? '接着上次的复习' : total ? `今天有 ${total} 个词等你复习` : '现在，还没有到期词'}</h2></div><p>练习掌握后，单词会进入复习安排。记住的词逐步拉长间隔，忘记的词更快回来。</p><div class="curve">${['20 分钟', '1 小时', '9 小时', '1 天', '2 天', '4 天', '7 天', '15 天', '30 天'].map((value, i) => `${i ? '<i>→</i>' : ''}<span>${value}</span>`).join('')}</div><button class="button primary" data-action="review-all" ${!total && !allSession ? 'disabled' : ''}>${allSession ? '继续上次复习' : '复习全部到期词'}${icon('arrow')}</button></section>
    <div class="section-head"><h2>按词书复习</h2></div><div class="review-list">${state.books.length ? state.books.map(book => {
      const stats = bookStats(book), session = state.sessions[sessionKey(book.id, 'review')];
      const upcoming = book.words.filter(w => w.review && w.review.dueAt > Date.now()).sort((a, b) => a.review.dueAt - b.review.dueAt)[0];
      return `<article class="review-book"><div class="book-cover">${icon('book')}</div><div><h3>${esc(book.name)}</h3><p>${session ? `还有 ${session.active.length} 个词待完成` : stats.due ? `${stats.due} 个到期词` : upcoming ? dueText(upcoming.review.dueAt) : '掌握词汇后会安排复习'}</p></div><button class="button ${stats.due || session ? 'soft' : ''} compact" data-action="start" data-book="${esc(book.id)}" data-mode="review" ${!stats.due && !session ? 'disabled' : ''}>${session ? '继续复习' : '开始复习'}${icon('arrow')}</button></article>`;
    }).join('') : `<div class="empty"><div class="empty-icon">${icon('calendar')}</div><h3>先认识一些新词吧</h3><p>完成学习后，词屿会在合适的时间把它们安排回来。</p><button class="button primary" data-nav="library">去我的词书${icon('arrow')}</button></div>`}</div></div>`;
}
const numberSetting = (key, title, description, min, max) => `<div class="setting-row"><div><h3>${title}</h3><p>${description}</p></div><input class="input" type="number" data-setting="${key}" aria-label="${title}" min="${min}" max="${max}" value="${state.settings[key]}"></div>`;
const toggleSetting = (key, title, description) => `<div class="setting-row"><div><h3>${title}</h3><p>${description}</p></div><label class="toggle"><input type="checkbox" data-setting="${key}" aria-label="${title}" ${state.settings[key] ? 'checked' : ''}><span></span></label></div>`;
function renderSettings() {
  const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('zh')) : [];
  main.innerHTML = `<div class="page"><div class="page-intro"><div><h1>找到你的练习节奏。</h1><p>调整一次，每本词书都按你的习惯来。所有题目都手动继续。</p></div></div><div class="settings-grid"><div class="settings-stack">
    <section class="panel"><div class="panel-head">${icon('book')}<h2>学习节奏</h2></div>${numberSetting('batch', '同时练多少个词', '掌握一个，再补进一个。小组更容易专注。', 5, 30)}${numberSetting('target', '认读连续认识几次算掌握', '不认识会重新计数。听力、口语和写作有各自的规则。', 2, 5)}${numberSetting('gap', '答对后，隔几个词再见', '用于认读、听力、口语，默认隔 7 个其他词。', 1, 30)}${numberSetting('wrongGap', '答错后，隔几个词再练', '忘记的词更快回来，默认隔 3 个其他词。', 1, 8)}<div class="notice" style="margin-top:20px">${icon('info')}写作采用更短间隔：写对隔 2 个词，写错隔 1 个词。任何模式都不会自动跳到下一题。</div></section>
    <section class="panel"><div class="panel-head">${icon('reset')}<h2>回访旧词</h2></div>${toggleSetting('mixOld', '学习中顺便复习旧词', '认读时，穿插以前掌握的词。如果忘了，会重新巩固。')}<div id="mix-options" ${state.settings.mixOld ? '' : 'hidden'}>${numberSetting('mixEvery', '每掌握多少个新词触发', '默认掌握 5 个新词后，回访一次旧词。', 1, 50)}${numberSetting('mixCount', '每次回访几个旧词', '默认随机插入 2 个旧词。', 1, 5)}</div></section>
    <section class="panel"><div class="panel-head">${icon('shield')}<h2>词书与备份</h2></div><p class="hint" style="margin-bottom:17px">词书、进度和设置都保存在这台设备的浏览器里。导出一份备份，可以在另一台设备接着练。</p><div class="setting-actions"><button class="button primary" data-action="backup">${icon('download')}导出完整备份</button><label class="button" for="backup-file">${icon('upload')}导入备份<input type="file" accept=".json,application/json" id="backup-file" hidden></label><button class="button" data-action="legacy-help">迁移旧版数据</button><button class="button" data-action="clear-audio-cache">清除音频缓存</button><button class="button danger" data-action="clear-data">清除全部数据</button></div><p class="hint" style="margin-top:14px">备份包含词书、四套学习进度、未完成的练习与复习安排。</p></section>
  </div><div class="settings-stack">
    <section class="panel"><div class="panel-head">${icon('headphones')}<h2>发音与跟读</h2></div><div class="setting-row"><div><h3>英语发音</h3><p>有道音频 · 单词、词组与句子<br>首次播放需要联网。</p></div><select data-setting="accent" aria-label="英语口音"><option value="uk" ${state.settings.accent === 'uk' ? 'selected' : ''}>英式发音</option><option value="us" ${state.settings.accent === 'us' ? 'selected' : ''}>美式发音</option></select></div><div class="setting-row"><div><h3>发音速度</h3><p>慢一点跟读，熟悉后再加快。</p></div><div class="range-row"><input type="range" data-setting="rate" aria-label="发音速度" min="0.6" max="1.3" step="0.05" value="${state.settings.rate}"><output id="rate-value">${state.settings.rate.toFixed(2)}×</output></div></div>${toggleSetting('autoSpeak', '自动播放英文', '认读、听音题和英文回忆题会自动发音。听写题始终先播放。')}${toggleSetting('autoSpeakZh', '自动朗读中文', '揭晓答案时朗读中文释义，使用系统中文声音。')}<div class="setting-row"><div><h3>中文发音人</h3><p>设备可用的中文声音。</p></div><select data-setting="zhVoiceURI" aria-label="中文发音人"><option value="">系统默认</option>${voices.map(voice => `<option value="${esc(voice.voiceURI)}" ${voice.voiceURI === state.settings.zhVoiceURI ? 'selected' : ''}>${esc(voice.name)}</option>`).join('')}</select></div><div class="setting-actions" style="margin-top:18px"><button class="button soft" data-action="test-en">${icon('volume')}试听英文</button><button class="button" data-action="test-zh">${icon('volume')}试听中文</button></div><details class="format-help" style="margin-bottom:0"><summary>使用自己的英语音源</summary><p>填写 HTTPS 音频链接模板，<code>{text}</code> 会替换为英文，<code>{accent}</code> 为英音 1 / 美音 2。留空使用默认音源。</p><input class="input" id="audio-template" data-setting="audioTemplate" aria-label="自定义英语音源" placeholder="https://…?text={text}" value="${esc(state.settings.audioTemplate)}"></details></section>
    <section class="panel"><div class="panel-head">${icon('sun')}<h2>我的学习空间</h2></div><div class="setting-row"><div><h3>页面主题</h3><p>按你的环境，调整明暗。</p></div><select data-setting="theme" aria-label="页面主题">${[['auto','跟随系统'],['light','浅色'],['dark','深色']].map(([value,label]) => `<option value="${value}" ${state.settings.theme === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="setting-row"><div><h3>自定义背景</h3><p>选择喜欢的图片，会自动压缩并柔化。</p></div></div><div class="setting-actions" style="margin-top:16px"><label class="button" for="background-file">${icon('upload')}选择图片<input id="background-file" type="file" accept="image/*" hidden></label><button class="button" data-action="clear-background">恢复默认</button></div>${state.settings.background ? `<div class="bg-preview" style="background-image:url('${state.settings.background}')"></div>` : ''}</section>
    <section class="panel"><div class="panel-head">${icon('info')}<h2>随手用的快捷键</h2></div><p class="hint">认读／听音／复习：1 不认识，2 认识。<br>口语揭晓后：1 说对了，2 没说出来。<br>输入英文后：Enter 检查。<br>看完答案：Enter 或 → 继续。<br>空格：重听发音；输入框中仍可正常输入空格。</p></section>
  </div></div></div>`;
}
function progressLabel(session, item) {
  const dots = (done, total) => `<span class="step-dots">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : ''}"></i>`).join('')}</span>`;
  switch (session.mode) {
    case 'read': return `${item.visitOld ? '旧词回访 · ' : ''}连续认识 ${Math.min(item.streak, state.settings.target)} / ${state.settings.target}${dots(item.streak, state.settings.target)}`;
    case 'listen': return `听写 ${item.dictRight}/1 · 听音连续认识 ${Math.min(item.streak, 2)}/2${dots(item.dictRight + item.streak, 3)}`;
    case 'speak': return `中 → 英 ${Math.min(item.zh2enRight, 2)}/2 · 英 → 中 ${Math.min(item.en2zhRight, 2)}/2${dots(item.zh2enRight + item.en2zhRight, 4)}`;
    case 'write': return `写全表达 ${Math.min(item.right, 2)} / 2${dots(item.right, 2)}`;
    case 'audit': return '每个词只考一次 · 不重复回炉';
    case 'review': return `第 ${item.stage} 阶段复习 · ${esc(bookById(state, item.bookId)?.name || '')}`;
    default: return '';
  }
}
const defsHTML = (item, answer = false) => `<div class="study-defs${answer ? ' answer' : ''}">${item.defs.map(def => `<p>${esc(def)}</p>`).join('')}</div>`;
const speakButton = () => `<button class="play-button" data-action="play-current">${icon('volume')}再听一遍 <span class="muted">${state.settings.accent === 'uk' ? 'UK' : 'US'}</span></button>`;
const audioOrb = () => '<button class="audio-orb" data-action="play-current" aria-label="播放英语发音"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></button>';
function questionContent(session, item) {
  const showEnglish = session.mode === 'read' || session.mode === 'review' || session.mode === 'speak' && session.type === 'en2zh';
  const showChinese = session.mode === 'write' || session.mode === 'speak' && session.type === 'zh2en';
  const typed = session.mode === 'write' || session.type === 'dict';
  const prompt = session.mode === 'write' ? '看中文 · 写出完整表达' : session.mode === 'speak' ? session.type === 'zh2en' ? '看中文 · 回忆英文' : '看英文 · 回忆中文' : session.type === 'dict' ? '听发音 · 写出英文' : session.mode === 'listen' ? '听发音 · 判断是否认识' : '看英文 · 回忆意思';
  return `<div class="card-label">${icon(MODE_INFO[session.mode].icon)}${prompt}</div>
    ${showEnglish ? `<h2 class="study-word">${esc(item.en)}</h2>${item.phonetic ? `<p class="phonetic">${esc(item.phonetic)}</p>` : ''}${speakButton()}` : ''}
    ${showChinese ? defsHTML(item) : ''}
    ${!showEnglish && !showChinese ? `${audioOrb()}<p class="listen-caption">点击声波重听${session.type === 'dict' ? '，写下你听到的英文' : '，在心里想一想它的意思'}</p>` : ''}
    ${typed ? `${session.mode === 'write' ? `<textarea class="answer-input textarea" id="answer-input" aria-label="英文答案" placeholder="写下英文表达${item.ens.length > 1 ? '，多个用 / 或换行分隔' : ''}" autocomplete="off" autocapitalize="none" spellcheck="false">${esc(session.input)}</textarea><p class="answer-note">${item.ens.length > 1 ? `这一组有 ${item.ens.length} 个英文表达，需要一次写全。` : '单词、短语和句子都按词书答案检查。'}</p>` : `<input class="answer-input" id="answer-input" aria-label="听写答案" placeholder="写下听到的英文…" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(session.input)}"><p class="answer-note">忽略大小写、首尾空格和常见标点。</p>`}` : ''}
    <div class="item-progress">${progressLabel(session, item)}</div>`;
}
function answerContent(session, item) {
  const selfGrade = session.phase === 'self-grade'; const correct = session.pending?.correct;
  const ready = !selfGrade && correct && isMastered(session, item, state.settings);
  const text = selfGrade ? '和答案对照一下，再如实自评' : correct ? ready ? '确认后，本词就完成了' : '答对了，再核对一下' : session.mode === 'audit' ? '已记下这个错词，继续查下一个' : '没关系，看一遍答案，再练一次';
  const english = session.mode === 'write' ? `<div class="synonyms">${item.ens.map(en => `<p>${esc(en)}</p>`).join('')}</div>` : `<h2 class="study-word">${esc(item.en)}</h2>`;
  return `<div class="feedback-label${!selfGrade && !correct ? ' wrong' : ''}">${icon(selfGrade ? 'eye' : correct ? 'check' : 'close')}${text}</div>
    ${english}${item.phonetic ? `<p class="phonetic">${esc(item.phonetic)}</p>` : ''}${defsHTML(item, true)}${speakButton()}
    ${session.pending?.typed && !correct ? `<p class="submitted">你刚才写的是：${esc(session.pending.submitted)}</p>` : ''}
    <div class="item-progress">${progressLabel(session, item)}</div>`;
}
function sessionActions(session) {
  if (session.phase === 'question') {
    if (session.mode === 'speak') return '<button class="button primary" data-action="reveal-speaking">显示答案，核对一下</button>';
    if (session.type === 'dict' || session.mode === 'write') return `<button class="button primary" data-action="check-answer">检查答案${icon('check')}</button>`;
    return `<button class="button" data-action="grade-no">${icon('close')}不认识</button><button class="button primary" data-action="grade-yes">${icon('check')}认识</button>`;
  }
  if (session.phase === 'self-grade') return `<button class="button" data-action="grade-no">${icon('close')}没说出来</button><button class="button primary" data-action="grade-yes">${icon('check')}说对了</button>`;
  const correction = session.pending?.correct && !session.pending.typed && session.mode !== 'speak';
  const retry = !session.pending?.correct && session.pending?.typed && session.mode !== 'audit';
  return `${correction ? `<button class="button danger" data-action="correct-answer">记错了</button>` : retry ? `<button class="button" data-action="retry-answer">再写一次</button>` : ''}<button class="button primary" data-action="next-answer">${session.pending?.correct ? '确认，继续' : session.mode === 'audit' ? '记下错词，继续' : '记住了，继续'}${icon('arrow')}</button>`;
}
function renderSession(key, options = {}) {
  const session = state.sessions[key]; if (!session) { navigate('library', { replace: true }); return; }
  let item = currentItem(session); if (!item) { item = chooseNext(session); persist(); }
  if (!item) { navigate('library', { replace: true }); return; }
  const feedback = session.phase !== 'question'; const info = MODE_INFO[session.mode];
  const book = session.bookId === 'all' ? '全部词书' : bookById(state, session.bookId)?.name;
  const progress = session.mode === 'audit' ? session.initialTotal - session.active.length : session.mastered;
  const caption = session.phase === 'feedback' ? '<kbd>Enter</kbd> 或 <kbd>→</kbd> 继续 · 完全由你决定节奏' : session.mode === 'speak' ? session.phase === 'self-grade' ? '<kbd>1</kbd> 说对了 · <kbd>2</kbd> 没说出来' : '<kbd>空格</kbd> 或 <kbd>Enter</kbd> 显示答案' : session.type === 'dict' || session.mode === 'write' ? '<kbd>Enter</kbd> 检查答案 · 空格可正常输入' : '<kbd>1</kbd> 不认识 · <kbd>2</kbd> 认识 · <kbd>空格</kbd> 重听';
  main.innerHTML = `<section class="session ${session.phase === 'feedback' && !session.pending?.correct ? 'wrong' : ''}">
    <header class="session-header"><a class="session-brand" href="#library"><img src="icon.svg" alt=""><span>词屿</span></a><div class="session-meta"><h1>${esc(book)}</h1><p>${info.name} · ${info.short}</p></div><button class="button" data-action="exit-session">暂停并退出</button></header>
    <div class="session-progress" role="progressbar" aria-label="本轮进度" aria-valuemin="0" aria-valuemax="${session.initialTotal}" aria-valuenow="${progress}"><i style="width:${pct(progress, session.initialTotal)}%"></i></div>
    <div class="session-stats"><span>完成 <b>${progress}</b> / ${session.initialTotal}${session.mode === 'audit' ? ' · 本书全部词汇' : ` · 本组 ${session.active.length} 项`}</span><span>待加入 <b>${session.queue.length}</b> · 答对 <b>${session.right}</b> · 答错 <b>${session.wrong}</b></span></div>
    <div class="study-card" id="study-card" aria-live="polite">${feedback ? answerContent(session, item) : questionContent(session, item)}</div>
    <div class="session-actions">${sessionActions(session)}</div><p class="session-help">${caption}</p></section>`;
  if (!feedback && $('#answer-input')) {
    $('#answer-input').focus({ preventScroll: true });
    $('#answer-input').setSelectionRange?.(session.input.length, session.input.length);
  }
  if (!options.silent) {
    if (feedback) {
      if (session.mode === 'speak' && session.phase === 'self-grade') {
        if (session.type === 'zh2en' && state.settings.autoSpeak) audio.english(item.en);
        else if (session.type === 'en2zh') audio.chinese(item.defs.join('；'));
      } else audio.both(session.mode === 'write' ? item.ens.join(', ') : item.en, item.defs.join('；'));
    } else if (session.type === 'dict' || (session.mode === 'read' || session.mode === 'review' || session.mode === 'listen' || session.mode === 'speak' && session.type === 'en2zh') && state.settings.autoSpeak) audio.english(item.en);
    else if (session.mode === 'write' || session.mode === 'speak' && session.type === 'zh2en') audio.chinese(item.defs.join('；'));
  }
  audio.prefetch(session.active.filter(other => other.id !== item.id).slice(0, 2).map(other => other.en));
}
function activeSession() { return route.startsWith('practice/') ? state.sessions[decodeURIComponent(route.slice(9))] : null; }
function grade(answer) {
  const session = activeSession(); if (!session) return;
  const result = gradeAnswer(state, session, answer);
  if (!result) { if ($('#answer-input')) { toast('先写下英文，再检查答案。'); $('#answer-input').focus(); } return; }
  audio.stop(); persist(); renderSession(session.key); if (result.mastered) celebrate(14);
}
function advance() {
  const session = activeSession(); if (!session) return;
  const result = advanceSession(state, session); if (!result) return;
  audio.stop(); persist();
  if (result.finished) { navigate(`result/${result.result.id}`); celebrate(35); }
  else renderSession(session.key);
}
function renderResult(id) {
  const result = state.history.find(value => value.id === id); if (!result) { navigate('library', { replace: true }); return; }
  const book = bookById(state, result.bookId); const title = result.mode === 'audit' ? '查漏完成，心里有数。' : result.mode === 'review' ? '记忆，又稳了一点。' : '这一轮，练得很好。';
  const accuracy = result.right + result.wrong ? Math.round(result.right / (result.right + result.wrong) * 100) : 100;
  main.innerHTML = `<section class="result"><div class="result-symbol">${icon('sparkle')}</div><div class="eyebrow">A LITTLE PROGRESS, EVERY DAY</div><h1 style="margin-top:13px">${title}</h1><p>${esc(book?.name || '全部词书')} · ${MODE_INFO[result.mode].name} · 用时 ${duration(result.duration)}</p><div class="result-metrics"><div><b>${result.mode === 'audit' ? result.initialTotal : result.mastered}</b><span>${result.mode === 'audit' ? '已检查' : result.mode === 'review' ? '已复习' : '本轮掌握'}</span></div><div><b>${result.right}</b><span>答对次数</span></div><div><b>${result.wrong}</b><span>答错次数</span></div><div><b>${accuracy}%</b><span>正确率</span></div></div>
    <div class="notice">${icon(result.mode === 'audit' ? 'checklist' : 'calendar')}${result.mode === 'audit' ? `拼对的词已标记为听力掌握。${result.auditWrongIds.length ? `${result.auditWrongIds.length} 个错词已记录，可在词表里筛选。` : '这次所有词都拼对了。'}` : '已经掌握的词会进入复习安排，在合适的时间再见一面。'}</div>
    ${result.mode === 'audit' && result.auditWrongIds.length ? `<div class="result-mistakes">${result.auditWrongIds.map(wordId => `<span>${esc(wordById(state, result.bookId, wordId)?.en || '')}</span>`).join('')}</div>` : ''}
    <div class="empty-actions"><button class="button" data-nav="library">返回我的词书</button>${result.mode === 'audit' && result.auditWrongIds.length ? `<button class="button primary" data-action="audit-mistakes" data-book="${esc(result.bookId)}">看看错词${icon('arrow')}</button>` : `<button class="button primary" data-action="again" data-book="${esc(result.bookId)}" data-mode="${result.mode}">再练一轮${icon('arrow')}</button>`}</div></section>`;
}
function celebrate(count) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#8597ff', '#91c8ab', '#d2b1e1', '#ebc88c'];
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('i'); dot.style.background = colors[i % colors.length];
    dot.style.setProperty('--x', `${(Math.random() - .5) * 420}px`); dot.style.setProperty('--y', `${80 + Math.random() * 270}px`); dot.style.setProperty('--r', `${Math.random() * 600}deg`);
    $('#confetti').append(dot); setTimeout(() => dot.remove(), 1000);
  }
}
function backup() { downloadFile(`词屿备份_${new Date().toISOString().slice(0, 10)}.json`, backupText(state)); toast('完整备份已导出'); }
async function restoreBackup(file) {
  if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('备份超过 25 MB，文件过大');
    const restored = parseBackup(await file.text());
    const yes = await confirm('导入这份备份？', `这份备份有 ${restored.books.length} 本词书、${restored.books.reduce((sum, b) => sum + b.words.length, 0)} 个词。导入后会替换当前词书、进度和设置；如需保留当前内容，请先取消并导出备份。`, '导入并恢复');
    if (!yes) return;
    state = restored; recoveryRequired = false; wordsStates.clear(); persist(); applyTheme(); navigate('library'); toast('词书与进度已经恢复');
  } catch (error) { toast(error.message || '备份读取失败', true); }
}
async function uploadBackground(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast('请选择小于 20 MB 的图片', true); return; }
  let source;
  try {
    source = URL.createObjectURL(file); const image = new Image(); image.src = source; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const background = canvas.toDataURL('image/jpeg', 0.78);
    if (background.length > 2.5e6) throw new Error('这张图片压缩后还是较大，请换一张');
    state.settings.background = background; persist(); applyTheme(); renderSettings(); toast('背景已更新');
  } catch (error) { toast(error.message || '图片没有加载成功', true); }
  finally { if (source) URL.revokeObjectURL(source); }
}
function legacyHelp() {
  const snippet = `(()=>{const d=localStorage.getItem('ciyu.vocab.v1');if(!d){alert('没有找到旧版词屿数据');return}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([d],{type:'application/json'}));a.download='词屿旧版备份.json';a.click()})()`;
  openModal('把旧版的进度带过来', '', `<div class="notice">${icon('info')}在同一个浏览器、同一个网站域名下，首次打开新版时会自动读取旧版词书和进度，旧版数据不会被删除。</div><p class="hint" style="margin:18px 0">如果旧版是本地文件或在另一个域名：打开旧版词屿，在开发者工具的 Console 中粘贴下面这段代码，导出旧版备份，再在这里点“导入备份”。</p><textarea class="textarea" id="legacy-snippet" readonly aria-label="旧版数据导出代码">${esc(snippet)}</textarea><div class="modal-foot"><button class="button" data-action="copy-legacy">复制导出代码</button><button class="button primary" data-action="close-modal">知道了</button></div>`);
}
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-nav]'); if (nav) { event.preventDefault(); persist(); navigate(nav.dataset.nav); return; }
  const home = event.target.closest('a[href="#library"]'); if (home) { event.preventDefault(); persist(); navigate('library'); return; }
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const { action, book: bookId, word: wordId, mode, key } = button.dataset;
  try {
    switch (action) {
      case 'close-modal': closeModal(); break;
      case 'confirm': closeModal(true); break;
      case 'import': openImport(); break;
      case 'append': openImport(bookId); break;
      case 'choose-mode': chooseMode(bookId); break;
      case 'start': await begin(bookId, mode); break;
      case 'resume': navigate(`practice/${encodeURIComponent(key)}`); break;
      case 'review-all': await begin('all', 'review'); break;
      case 'words': navigate(`book/${encodeURIComponent(bookId)}`); break;
      case 'book-menu': bookMenu(bookId); break;
      case 'word-menu': wordMenu(bookId, wordId); break;
      case 'rename': renameBook(bookId); break;
      case 'export-book': exportBook(bookId); closeModal(); break;
      case 'edit-word': editWord(bookId, wordId); break;
      case 'backup': backup(); break;
      case 'demo': {
        const existing = state.books.find(book => book.name === '初遇词屿 · 试学一组');
        const book = existing || importEntries(state, parseImport(SAMPLE_TEXT).entries, '初遇词屿 · 试学一组').book;
        persist(); renderLibrary(); chooseMode(book.id); break;
      }
      case 'reset-book': if (await confirm('重置这本词书？', '本书四种模式的掌握状态、未完成练习和复习安排会重新开始，词汇内容会保留。', '重置进度', true)) { resetBook(state, bookId); persist(); render(); toast('本书进度已重置'); } break;
      case 'delete-book': if (await confirm('删除这本词书？', `《${bookById(state, bookId)?.name}》的词汇和进度会一起删除。可以先导出备份。`, '删除词书', true)) { invalidateSessions(state, bookId); state.books = state.books.filter(book => book.id !== bookId); persist(); navigate('library'); toast('词书已删除'); } break;
      case 'delete-word': if (await confirm('删除这个词？', '会删除这个词和它的掌握状态，并结束本书未完成的练习。', '删除', true)) { removeWord(state, bookId, wordId); persist(); render(); toast('这个词已删除'); } break;
      case 'mark-all': setMastery(state, bookId, wordId, 'all', button.dataset.value === 'true'); persist(); closeModal(); render(); break;
      case 'toggle-mastery': {
        const value = !wordById(state, bookId, wordId)[MODE_INFO[mode].flag];
        const sessions = Object.values(state.sessions).some(session => session.bookId === bookId || session.bookId === 'all');
        if (sessions && !await confirm('调整这个词的进度？', '会结束本书未完成的练习，已掌握的其他词会保留。', '调整进度')) break;
        setMastery(state, bookId, wordId, mode, value); persist(); renderWordRows(bookById(state, bookId)); break;
      }
      case 'word-audio': audio.english(wordById(state, bookId, wordId)?.en); break;
      case 'mask-en': case 'mask-def': {
        const book = bookById(state, bookId), ui = wordsUi(book); const set = action === 'mask-en' ? ui.hiddenEn : ui.hiddenDef;
        if (book.words.every(w => set.has(w.id))) set.clear(); else book.words.forEach(w => set.add(w.id)); renderWordRows(book); break;
      }
      case 'unmask-en': case 'unmask-def': { const book = bookById(state, bookId), ui = wordsUi(book); (action === 'unmask-en' ? ui.hiddenEn : ui.hiddenDef).delete(wordId); renderWordRows(book); break; }
      case 'shuffle': { const book = bookById(state, bookId), ui = wordsUi(book); ui.order = shuffle(ui.order); ui.page = 0; renderWordRows(book); break; }
      case 'restore-order': { const book = bookById(state, bookId), ui = wordsUi(book); ui.order = book.words.map(w => w.id); ui.hiddenEn.clear(); ui.hiddenDef.clear(); ui.page = 0; renderWordRows(book); break; }
      case 'word-page': { const book = bookById(state, bookId); wordsUi(book).page = Number(button.dataset.page); renderWordRows(book); $('#word-count').scrollIntoView({ block: 'start' }); break; }
      case 'theme': state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; persist(); applyTheme(); if (route === 'settings') renderSettings(); break;
      case 'clear-audio-cache': if ('caches' in window) { await caches.delete('ciyu-remastered-audio-v1'); toast('英语音频缓存已清除，词书和进度保留'); } else toast('这台设备没有启用音频缓存'); break;
      case 'test-en': audio.english('Every small step brings you closer.'); break;
      case 'test-zh': audio.stop(); audio.chinese('慢慢练，每一次回忆都有意义。', true); break;
      case 'clear-background': state.settings.background = null; persist(); applyTheme(); renderSettings(); toast('已恢复默认背景'); break;
      case 'clear-data': if (await confirm('清除新版的全部数据？', '新版词书、学习进度、复习安排和设置都会清除。这个操作无法撤销，请先导出备份。旧版数据不会删除。', '清除全部数据', true)) { state = { version: 2, settings: { ...DEFAULT_SETTINGS }, books: [], sessions: {}, history: [], migratedAt: Date.now() }; recoveryRequired = false; wordsStates.clear(); persist(); applyTheme(); navigate('library'); toast('新版数据已清除'); } break;
      case 'legacy-help': legacyHelp(); break;
      case 'copy-legacy': { const text = $('#legacy-snippet').value; try { await navigator.clipboard.writeText(text); toast('代码已复制'); } catch { $('#legacy-snippet').select(); toast('已选中代码，请复制'); } break; }
      case 'exit-session': persist(); navigate('library'); break;
      case 'play-current': { const session = activeSession(), item = currentItem(session); if (item) audio.english(session.mode === 'write' && session.phase === 'feedback' ? item.ens.join(', ') : item.en); break; }
      case 'reveal-speaking': { const session = activeSession(); if (session) { revealSpeaking(session); persist(); renderSession(session.key); } break; }
      case 'grade-yes': grade(true); break;
      case 'grade-no': grade(false); break;
      case 'check-answer': grade($('#answer-input')?.value); break;
      case 'next-answer': advance(); break;
      case 'correct-answer': { const session = activeSession(); if (session && correctToWrong(state, session)) { persist(); renderSession(session.key); } break; }
      case 'retry-answer': { const session = activeSession(); if (session && retryAnswer(session)) { persist(); renderSession(session.key); } break; }
      case 'again': await begin(bookId, mode, { restart: true, reset: mode !== 'review' && mode !== 'audit' }); break;
      case 'audit-mistakes': { const book = bookById(state, bookId); if (book) { wordsUi(book).filter = 'audit'; navigate(`book/${encodeURIComponent(bookId)}`); } break; }
    }
  } catch (error) { console.error(error); toast('这次操作没有完成，请重试。', true); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'book-search') { bookQuery = event.target.value; renderBookGrid(); }
  else if (event.target.id === 'words-search') { const book = bookById(state, decodeURIComponent(route.slice(5))); if (book) { wordsUi(book).search = event.target.value; wordsUi(book).page = 0; renderWordRows(book); } }
  else if (event.target.id === 'answer-input') { const session = activeSession(); if (session) { session.input = event.target.value; clearTimeout(inputSave); inputSave = setTimeout(persist, 180); } }
  else if (event.target.dataset.setting === 'rate') { state.settings.rate = Number(event.target.value); $('#rate-value').textContent = `${state.settings.rate.toFixed(2)}×`; persist(); }
});
document.addEventListener('change', async event => {
  const element = event.target;
  if (element.dataset.setting) {
    const key = element.dataset.setting;
    const value = element.type === 'checkbox' ? element.checked : element.type === 'number' || element.type === 'range' ? Number(element.value) : element.value;
    if (key === 'audioTemplate' && value && (!value.startsWith('https://') || !value.includes('{text}'))) { toast('请填写包含 {text} 的 HTTPS 音频链接', true); element.value = state.settings.audioTemplate; return; }
    state.settings = sanitizeSettings({ ...state.settings, [key]: value }); persist();
    if (element.type === 'number') element.value = state.settings[key];
    if (key === 'mixOld') $('#mix-options').hidden = !state.settings.mixOld;
    if (key === 'theme') applyTheme();
    if (key === 'accent' || key === 'audioTemplate') audio.stop();
  } else if (element.id === 'words-mode' || element.id === 'words-filter') {
    const book = bookById(state, decodeURIComponent(route.slice(5))); if (!book) return;
    const ui = wordsUi(book); ui[element.id === 'words-mode' ? 'mode' : 'filter'] = element.value; ui.page = 0; renderWordRows(book);
  } else if (element.id === 'backup-file') { await restoreBackup(element.files[0]); element.value = ''; }
  else if (element.id === 'background-file') await uploadBackground(element.files[0]);
});
document.addEventListener('keydown', event => {
  if (dialog.open || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const session = activeSession(); if (!session) return;
  if (event.target.matches('input,textarea,select')) {
    if (event.key === 'Enter' && !event.shiftKey && event.target.id === 'answer-input') { event.preventDefault(); grade(event.target.value); }
    return;
  }
  if (session.phase === 'feedback') {
    if (['Enter', 'ArrowRight', ' '].includes(event.key)) { event.preventDefault(); advance(); }
    else if (event.key === '1' || event.key === 'ArrowLeft') { if (correctToWrong(state, session)) { event.preventDefault(); persist(); renderSession(session.key); } }
  } else if (session.mode === 'speak') {
    if (session.phase === 'question' && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); revealSpeaking(session); persist(); renderSession(session.key); }
    else if (session.phase === 'self-grade' && ['1', '2'].includes(event.key)) { event.preventDefault(); grade(event.key === '1'); }
  } else if (event.key === ' ') { event.preventDefault(); audio.english(currentItem(session)?.en); }
  else if (session.type !== 'dict' && session.mode !== 'write' && ['1', '2', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); grade(['2', 'ArrowRight'].includes(event.key)); }
});
window.addEventListener('popstate', () => { audio.stop(); route = decodeURI(location.hash.slice(1)) || 'library'; render(); });
window.addEventListener('hashchange', () => { audio.stop(); route = location.hash.slice(1) || 'library'; render(); });
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.stop(); persist(); } else if (route === 'review' || route === 'library') render(); });
darkQuery.addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) toast('另一页更新了词书。请刷新本页后继续，避免覆盖。', true); });
applyTheme(); decorate();
route = location.hash.slice(1) || 'library'; render();
if (loaded.migrated) toast('旧版词书和进度已迁移，欢迎来到新版词屿。');
if (loaded.error) toast(loaded.error, true);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(error => console.info('离线页面暂未启用', error.message));
}
