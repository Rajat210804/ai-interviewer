import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createInterviewEngine } from '../src/interview/engine.js';
import { answerExcerpt, LIVE_ANSWER_CONTEXT_CHARS, reportPrompt, REPORT_TRANSCRIPT_CHARS } from '../src/ai/prompts.js';
import { createFakeAI } from './fake-ai.js';
import { api } from '../../frontend/src/api.js';

const setup = {company:'Acme',role:'Data Analyst',candidateName:'Rajat',type:'technical',difficulty:'easy',length:5,panel:[{role:'tech',name:'Daniel',avatarId:'professional-man'}]};
async function fixture(options = {}) {
  const ai = createFakeAI();
  const server = createApp({ai,requestsPerMinute:1000,...options}).listen(0);
  await new Promise((resolve) => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (path,body) => {
    const response = await fetch(base + path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  return {ai,server,base,post};
}

test('million-character Unicode answers pass through the real chunk API and survive a lost commit response', async () => {
  const f = await fixture();
  const nativeFetch = globalThis.fetch;
  let sessionId;
  try {
    const started = await f.post('/interview/start',{setup,cv:null,jd:null});
    sessionId = started.body.sessionId;
    const text = 'FIRST EVIDENCE\n' + 'Résumé 東京 हिन्दी 😀\u0001 detail\n'.repeat(40000) + '\nFINAL EVIDENCE';
    assert.ok(text.length > 1_000_000);
    let lost = false;
    let committed;
    let partCount = 0;
    globalThis.fetch = async (url,options) => {
      const resolved = typeof url === 'string' && url.startsWith('/api/') ? f.base + url.slice(4) : url;
      if (String(resolved).endsWith('/answer-parts')) {
        partCount++;
        assert.ok(Buffer.byteLength(options.body) < 300 * 1024);
      }
      const response = await nativeFetch(resolved,options);
      if (String(resolved).endsWith('/answer') && !lost) {
        assert.equal(response.status,200);
        committed = await response.json();
        lost = true;
        throw new TypeError('response lost after commit');
      }
      return response;
    };
    const answer = {text,expectedTurn:1};
    await assert.rejects(api.answer(sessionId,answer), /couldn't reach the server/);
    const partsSent = partCount;
    const replay = await api.answer(sessionId,answer);
    assert.deepEqual(replay,committed);
    assert.equal(partCount,partsSent);
    assert.equal(f.ai.calls.filter((call) => call.label === 'turn').length,1);
    const report = await api.endInterview(sessionId);
    assert.equal(report.questionsAnswered,1);
    assert.equal(report.questions[0].answer,text);
    assert.equal(report.questions[0].answerCharacters,text.length);
    assert.equal(report.questions[0].contextLimited,true);
    assert.ok(report.questions[0].liveContextCharacters <= LIVE_ANSWER_CONTEXT_CHARS);
    assert.ok(report.evaluationCoverage.contextCharacters <= report.evaluationCoverage.answerContextBudget);
  } finally {
    globalThis.fetch = nativeFetch;
    api.clearAnswerUploads(sessionId);
    f.server.close();
  }
});

test('staging rejects changed, missing, oversized, and stale parts without losing accepted text', async () => {
  const f=await fixture();
  try {
    const started=await f.post('/interview/start',{setup,cv:null,jd:null});
    const id=started.body.sessionId;
    const part={uploadId:'upload-123456',expectedTurn:1,index:0,text:'Detailed candidate answer with concrete reasoning, results, and evidence.'};
    const path=`/interview/${id}`;
    assert.equal((await f.post(path+'/answer-parts',{...part,index:1})).status,409);
    assert.equal((await f.post(path+'/answer-parts',part)).status,200);
    const duplicate=await f.post(path+'/answer-parts',part);
    assert.equal(duplicate.status,200);
    assert.equal(duplicate.body.duplicate,true);
    assert.equal((await f.post(path+'/answer-parts',{...part,text:'Changed accepted text'})).status,409);
    assert.equal((await f.post(path+'/answer-parts',{...part,index:2})).status,409);
    assert.equal((await f.post(path+'/answer-parts',{...part,index:1,text:'x'.repeat(64001)})).status,400);
    const commit={uploadId:part.uploadId,expectedTurn:1,totalParts:2,answerCharacters:part.text.length};
    assert.equal((await f.post(path+'/answer',commit)).status,409);
    assert.equal(f.ai.calls.filter((call) => call.label==='turn').length,0);
    assert.equal((await f.post(path+'/answer',{...commit,totalParts:1})).status,200);
    assert.equal((await f.post(path+'/answer-parts',{...part,uploadId:'new-upload-123'})).status,409);
    assert.equal((await f.post(path+'/end',{})).body.questions[0].answer,part.text);
    assert.equal((await f.post(path+'/answer-parts',part)).status,404);
  } finally {f.server.close();}
});

test('reports distinguish limited live context from a complete final review', async () => {
  const engine = createInterviewEngine(createFakeAI());
  const state = await engine.start({ setup, cv: null, jd: null });
  const text = 'A detailed answer with evidence. '.repeat(600);
  assert.ok(text.length > LIVE_ANSWER_CONTEXT_CHARS && text.length < 24000);
  await engine.answer(state.sessionId, { text, expectedTurn: 1 });
  const report = await engine.end(state.sessionId);
  assert.equal(report.contextLimited, false, 'final review received the complete answer');
  assert.equal(report.questions[0].contextLimited, true, 'live follow-up used a bounded excerpt');
  assert.equal(report.questions[0].reportContextCharacters, text.length);
  assert.ok(report.questions[0].liveContextCharacters < text.length);
  assert.equal(report.questions[0].answer, text);
});

test('active-answer heartbeats refresh inactivity without imposing an interview duration', async () => {
  let now=0;
  const engine=createInterviewEngine(createFakeAI(),{now:()=>now,sessionTtlMs:100});
  const state=await engine.start({setup,cv:null,jd:null});
  for (let n=0;n<100;n++) {now+=90;assert.deepEqual(engine.keepAlive(state.sessionId),{ok:true});}
  assert.ok(await engine.answer(state.sessionId,{text:'Detailed response that takes longer than the initial inactivity period.',expectedTurn:1}));
  now+=101;
  assert.throws(()=>engine.keepAlive(state.sessionId),(error)=>error.status===404);
});

test('upload throttling retains accepted parts and supplies a retry delay', async () => {
  const f=await fixture({answerPartsPerMinute:1});
  try {
    const started=await f.post('/interview/start',{setup,cv:null,jd:null});
    const path=`/interview/${started.body.sessionId}`;
    const part={uploadId:'rate-upload-1',expectedTurn:1,index:0,text:'A complete answer with enough detail to be assessed.'};
    assert.equal((await f.post(path+'/answer-parts',part)).status,200);
    const rate=await f.post(path+'/answer-parts',{...part,index:1});
    assert.equal(rate.status,429);
    assert.ok(Number(rate.headers.get('retry-after'))>0);
    assert.equal((await f.post(path+'/answer',{uploadId:part.uploadId,expectedTurn:1,totalParts:1,answerCharacters:part.text.length})).status,200);
  } finally {f.server.close();}
});

test('AI excerpts preserve beginning, middle and end evidence without splitting surrogate pairs', () => {
  const text='BEGIN 😀'+ 'a'.repeat(50000)+'MIDDLE 😀'+'b'.repeat(50000)+'END 😀';
  const excerpt=answerExcerpt(text);
  assert.ok(excerpt.text.length<=LIVE_ANSWER_CONTEXT_CHARS);
  assert.match(excerpt.text,/BEGIN/);
  assert.match(excerpt.text,/MIDDLE/);
  assert.match(excerpt.text,/END/);
  assert.equal(excerpt.answerCharacters,text.length);
  assert.equal(excerpt.contextLimited,true);
  assert.ok(excerpt.text.isWellFormed());
  const session={setup,cv:null,jd:null,panel:[{id:'i1',role:'tech',name:'Daniel'}],plan:{strong_matches:[],partial_matches:[],missing_skills:[]}};
  const turns=Array.from({length:160},(_,index)=>({number:index+1,category:'technical',interviewer:'i1',question:'Q'.repeat(900),answer:text,assessment:{score:7,verdict:'adequate',gaps:['gap'.repeat(100)],incorrect_points:[]}}));
  const report=reportPrompt(session,turns);
  assert.ok(report.evaluationCoverage.transcriptCharacters<=REPORT_TRANSCRIPT_CHARS);
  assert.equal(report.evaluationCoverage.questionsLimited,160);
});
