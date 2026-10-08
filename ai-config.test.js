import test from 'node:test';
import assert from 'node:assert/strict';
import { completionURL, modelsURL, apiAddressSpace, aiReady, fetchModels, requestAI, saveAIKey, thinkingParameters } from './ai.js';
import { freshState, sanitizeSettings } from './core.js';
import { backupText, parseBackup } from './storage.js';
import { splitChatResponse } from './chat-format.js';

const local = { aiEnabled: true, aiBase: 'http://localhost:11434', aiModel: 'qwen3:8b', aiProvider: 'ollama', aiNoKey: true, aiStream: true, aiThinking: 'on' };
async function withFetch(handler, work) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await work(); } finally { globalThis.fetch = original; saveAIKey(''); }
}

test('HTTP / HTTPS 地址支持完整端点及 Ollama 默认端口，拒绝其他协议和内嵌认证', () => {
  assert.equal(completionURL(local.aiBase), 'http://localhost:11434/v1/chat/completions');
  assert.equal(modelsURL('http://192.168.1.10:11434/v1/chat/completions/'), 'http://192.168.1.10:11434/v1/models');
  assert.equal(completionURL('http://api.example/proxy'), 'http://api.example/proxy/chat/completions');
  for (const base of ['ftp://api.example/v1','https://user:password@api.example/v1','https://api.example/v1?key=secret','http://api.example/v1#frag']) {
    assert.throws(() => completionURL(base));
    assert.notEqual(sanitizeSettings({ aiBase: base }).aiBase, base);
  }
});

test('HTTP 连接、免密钥及模型输出配置可保存和备份恢复，密钥不入备份', () => {
  const state = freshState();
  state.settings = sanitizeSettings({ ...state.settings, ...local, aiThinkingFormat: 'auto', apiKey: 'test-do-not-export' });
  const backup = backupText(state), restored = parseBackup(backup).settings;
  assert.ok(!backup.includes('test-do-not-export'));
  for (const key of ['aiBase','aiModel','aiProvider','aiNoKey','aiStream','aiThinking']) assert.equal(restored[key], local[key]);
  assert.equal(sanitizeSettings({ aiProvider: 'unknown' }).aiProvider, 'custom');
});

test('本地地址判定支持回环、私有 IPv4 / IPv6，公网地址不被误判', () => {
  for (const host of ['localhost','api.localhost','127.0.0.1','[::1]']) assert.equal(apiAddressSpace(`http://${host}:11434`), 'loopback');
  for (const host of ['10.0.0.2','192.168.1.10','172.16.0.1','172.31.255.254','169.254.1.2','ollama.local','[fd12::1]','[fe80::1]']) assert.equal(apiAddressSpace(`http://${host}:11434`), 'local');
  for (const host of ['api.example','172.15.0.1','172.32.0.1','192.169.1.10','[2001:db8::1]']) assert.equal(apiAddressSpace(`http://${host}:11434`), undefined);
});

test('本地免密钥模型列表与对话不携带已保存的云端密钥，公网仍需要认证或显式免密钥', async () => {
  saveAIKey('');
  assert.equal(aiReady(local), true);
  const remote = { ...local, aiBase: 'http://api.example/v1', aiProvider: 'custom', aiNoKey: false };
  assert.equal(aiReady(remote), false);
  await assert.rejects(requestAI(remote, []), /密钥/);
  saveAIKey('test-cloud-key');
  let calls = 0;
  await withFetch(async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.targetAddressSpace, 'loopback');
    assert.equal(options.credentials, 'omit');
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'qwen3:8b' }, { id: 'qwen3:8b' }] });
    const body = JSON.parse(options.body);
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.enable_thinking, undefined);
    return Response.json({ choices: [{ message: { content: 'Answer', reasoning: 'Service thought' }, finish_reason: 'stop' }] });
  }, async () => {
    assert.deepEqual(await fetchModels(local), ['qwen3:8b']);
    const progress = [];
    assert.equal(await requestAI(local, [], { onToken: p => progress.push(p) }), 'Answer');
    assert.equal(progress.at(-1).reasoning, 'Service thought');
    assert.equal(progress.at(-1).content, 'Answer');
  });
  assert.equal(calls, 2);
});

test('SSE 正文与两种思考字段跨片段累积，输出正文保持原有返回类型', async () => {
  const encoder = new TextEncoder(), progress = [];
  await withFetch(async () => new Response(new ReadableStream({ start(controller) {
    const chunks = [
      { choices: [{ delta: { reasoning: 'First ' } }] },
      { choices: [{ delta: { reasoning_content: 'thought' } }] },
      { choices: [{ delta: { content: '**Good' } }] },
      { choices: [{ delta: { content: ' answer**' }, finish_reason: 'stop' }] }
    ];
    const wire = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n';
    for (let i = 0; i < wire.length; i += 9) controller.enqueue(encoder.encode(wire.slice(i, i + 9)));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } }), async () => {
    assert.equal(await requestAI(local, [], { onToken: p => progress.push(p) }), '**Good answer**');
  });
  assert.equal(progress.length, 4);
  assert.equal(progress[0].content, '');
  assert.equal(progress.at(-1).reasoning, 'First thought');
  assert.equal(progress.at(-1).reasoningCount, 13);
});

test('Ollama 自动适配思考开关，保留其他服务的兼容选项', () => {
  assert.deepEqual(thinkingParameters(local), { reasoning_effort: 'high' });
  assert.deepEqual(thinkingParameters({ ...local, aiThinking: 'off' }), { reasoning_effort: 'none' });
  assert.deepEqual(thinkingParameters({ ...local, aiThinking: 'auto' }), {});
  assert.deepEqual(thinkingParameters({ ...local, aiThinkingFormat: 'enable_thinking' }), { enable_thinking: true });
});

test('正文内 think 标记可渐进拆分，代码示例中的标记保留为正文', () => {
  assert.deepEqual(splitChatResponse('<thi'), { content: '', reasoning: '', thinking: false });
  assert.deepEqual(splitChatResponse('<think>First'), { content: '', reasoning: 'First', thinking: true });
  assert.deepEqual(splitChatResponse('<think>First</think>\n## Answer', 'Returned: '), { content: '## Answer', reasoning: 'Returned: First', thinking: false });
  assert.equal(splitChatResponse('```html\n<think>example</think>\n```').reasoning, '');
  assert.equal(splitChatResponse('Literal <think>example</think>').content, 'Literal <think>example</think>');
});
