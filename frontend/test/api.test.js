import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});

test('ordinary answers retain the existing direct request', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {calls.push({url,body:JSON.parse(options.body)});return response({done:false});};
  try {
    await api.answer('small', {text:'My answer.',expectedTurn:1});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/interview/small/answer');
    assert.equal(calls[0].body.text, 'My answer.');
  } finally {globalThis.fetch = original;api.clearAnswerUploads('small');}
});

test('large Unicode and JSON escape-heavy answers upload losslessly in bounded, retryable parts', async () => {
  const original = globalThis.fetch;
  const text = ('Long answer 😀 हिन्दी \u0001\n').repeat(12000);
  const parts = new Map();
  const calls = [];
  let lost = false;
  let committed;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(new TextEncoder().encode(options.body).length < 300 * 1024);
    calls.push({url,body});
    if (url.endsWith('/answer-parts')) {
      const duplicate = parts.has(body.index);
      if (duplicate) assert.equal(parts.get(body.index), body.text);
      parts.set(body.index, body.text);
      if (!lost) {lost = true;throw new TypeError('response lost after server accepted part');}
      return response({uploadId:body.uploadId,index:body.index,nextIndex:body.index+1,duplicate});
    }
    committed = body;
    return response({done:false,turn:{number:2}});
  };
  try {
    const answer = {text,expectedTurn:1,integrity:{awayEvents:0}};
    await assert.rejects(api.answer('large', answer), /couldn't reach the server/);
    const result = await api.answer('large', answer);
    assert.equal(result.turn.number, 2);
    assert.equal(calls[0].body.uploadId, calls[1].body.uploadId, 'retry retains same upload identity');
    assert.equal([...parts.values()].join(''), text);
    assert.equal(committed.expectedTurn, 1);
    assert.equal(committed.answerCharacters, text.length);
    assert.equal(committed.totalParts, parts.size);
    assert.equal(committed.text, undefined, 'commit does not exceed request budget');
  } finally {globalThis.fetch = original;api.clearAnswerUploads('large');}
});

test('a lost commit response retries the same upload without uploading its parts again', async () => {
  const original = globalThis.fetch;
  const text = 'Detailed response. '.repeat(20000);
  const commits = [];
  let partRequests = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/answer-parts')) {partRequests++;return response({uploadId:body.uploadId,index:body.index,nextIndex:body.index+1});}
    commits.push(body);
    if (commits.length === 1) throw new TypeError('lost commit response');
    return response({done:false,turn:{number:2}});
  };
  try {
    const answer = {text,expectedTurn:1};
    await assert.rejects(api.answer('commit',answer));
    const sent = partRequests;
    await api.answer('commit',answer);
    assert.equal(partRequests,sent);
    assert.equal(commits[0].uploadId,commits[1].uploadId);
  } finally {globalThis.fetch=original;api.clearAnswerUploads('commit');}
});

test('canceling a large upload preserves a recoverable error and stops further requests', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = async () => {calls++;controller.abort();throw new DOMException('canceled','AbortError');};
  try {
    await assert.rejects(api.answer('cancel',{text:'answer '.repeat(50000),expectedTurn:1},{signal:controller.signal}), (error) => error.name === 'AbortError');
    assert.equal(calls,1);
  } finally {globalThis.fetch=original;api.clearAnswerUploads('cancel');}
});

test('canceling during rate-limit backoff does not lose the abort or issue another request', async () => {
  const original=globalThis.fetch;
  const controller=new AbortController();
  let calls=0;
  globalThis.fetch=async () => {calls++;controller.abort();return response({error:'Wait briefly.'},429);};
  try {
    await assert.rejects(api.answer('backoff',{text:'answer '.repeat(50000),expectedTurn:1},{signal:controller.signal}), (error) => error.name === 'AbortError');
    assert.equal(calls,1);
  } finally {globalThis.fetch=original;api.clearAnswerUploads('backoff');}
});
