import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAI, saveAIKey, thinkingParameters } from './ai.js';
import { freshState, recordStudy, studyStats, normalizeState } from './core.js';
import { parseLAPJSON, checkForms } from './lap-core.js';
const settings = {aiEnabled:true,aiBase:'https://mock.example/v1',aiModel:'qwen3',aiStream:true,aiThinking:'off'};
async function mock(response, work) {const previous=globalThis.fetch;saveAIKey('test-key');globalThis.fetch=response;try {await work();}finally{globalThis.fetch=previous;saveAIKey('');}}
test('流式 SSE 跨字节拆包合并正文，思考 token 解除首 token 超时，超过 90 秒继续输出',async()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 let deadline, cleared=false, fetchSignal, stream;
 globalThis.setTimeout=(callback,ms)=>{assert.equal(ms,90000);deadline=callback;return 123;};globalThis.clearTimeout=()=>{cleared=true;};
 try {await mock(async(_,options)=>{const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(body.enable_thinking,false);fetchSignal=options.signal;
  stream=new ReadableStream({start(c){const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\n');c.enqueue(bytes.slice(0,8));c.enqueue(bytes.slice(8));},cancel(){}});
  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
 },async()=>{
  let controller;
  // Replace with a stream whose remaining output can be emitted after first token.
  const saved=globalThis.fetch;globalThis.fetch=async(url,opts)=>{const result=await saved(url,opts);const reader=result.body.getReader();return new Response(new ReadableStream({async start(c){controller=c;const r=await reader.read();c.enqueue(r.value);const tail=await reader.read();c.enqueue(tail.value);}}),{headers:{'content-type':'text/event-stream'}});};
  let token;
  const first=new Promise(resolve=>token=resolve);const progress=[];
  const pending=requestAI(settings,[],{onToken:x=>{progress.push(x);token();}});
  await first;assert.equal(cleared,true);deadline();assert.equal(fetchSignal.aborted,false);
  const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();
  assert.equal(await pending,'你好 world');assert.ok(progress[0].reasoningCount>0);
 });}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
test('流式截断拒绝保存半份正文；普通 JSON 响应仍兼容',async()=>{
 await mock(async()=>new Response('data: {"choices":[{"delta":{"content":"half"}}]}\n\n',{headers:{'content-type':'text/event-stream'}}),async()=>assert.rejects(requestAI(settings,[]),/连接中断/));
 await mock(async()=>new Response(JSON.stringify({choices:[{message:{content:'complete'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}}),async()=>assert.equal(await requestAI(settings,[]),'complete'));
});
test('流式取消、服务错误和输出截断可识别',async()=>{
 await mock(async()=>new Response('data: {"error":{"message":"service error"}}\n\n',{headers:{'content-type':'text/event-stream'}}),async()=>assert.rejects(requestAI(settings,[]),/service error/));
 await mock(async()=>new Response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n',{headers:{'content-type':'text/event-stream'}}),async()=>assert.rejects(requestAI(settings,[]),/截断/));
 const controller=new AbortController();controller.abort();
 await mock(async(_,opts)=>{if(opts.signal.aborted)throw new DOMException('aborted','AbortError');},async()=>assert.rejects(requestAI(settings,[],{signal:controller.signal}),{name:'AbortError'}));
});
test('思考开关按不同接口构造，默认不强加开关',()=>{
 assert.deepEqual(thinkingParameters({...settings,aiThinking:'auto'}),{});
 assert.deepEqual(thinkingParameters({...settings,aiModel:'deepseek-flash',aiThinking:'on'}),{thinking:{type:'enabled'}});
 assert.deepEqual(thinkingParameters({...settings,aiModel:'gpt-5.2',aiThinking:'off'}),{reasoning_effort:'none'});
});
test('练习单词按词去重，跨日重复计今日，备份保留统计和目标',()=>{
 const state=freshState(),today=new Date(2026,9,5,12).getTime(),yesterday=today-86400e3;
 recordStudy(state,'Annual',yesterday);recordStudy(state,'annual',today);recordStudy(state,'annual',today);recordStudy(state,'phase',today);
 state.settings.dailyGoal=30;state.settings.aiStream=true;state.settings.aiThinking='off';
 const restored=normalizeState(JSON.parse(JSON.stringify(state)));
 assert.deepEqual(studyStats(restored,today),{total:2,today:2,goal:30});assert.equal(restored.settings.aiStream,true);assert.equal(restored.settings.aiThinking,'off');
 const e=parseLAPJSON('[{"word":"annual","noun":"annual","pastTense":"annualised","adjective":"annual"}]').entries[0];
 assert.ok(checkForms(e,{noun:'annual',adjective:'annual'},['noun','adjective']).every(c=>c.correct));
});
test('流式已经输出后仍可手动取消，未开始输出时仍有首 token 超时',async()=>{
 const cancel=new AbortController();
 await mock(async(_,options)=>new Response(new ReadableStream({start(c){options.signal.addEventListener('abort',()=>c.error(new DOMException('cancelled','AbortError')));c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'));}}),{headers:{'content-type':'text/event-stream'}}),async()=>assert.rejects(requestAI(settings,[],{signal:cancel.signal,onToken:()=>cancel.abort()}),{name:'AbortError'}));
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let deadline;
 globalThis.setTimeout=fn=>{deadline=fn;return 123;};globalThis.clearTimeout=()=>{};
 try{await mock(async(_,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')));}),async()=>{const pending=requestAI(settings,[]);deadline();await assert.rejects(pending,/90 秒内未开始/);});}
 finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
