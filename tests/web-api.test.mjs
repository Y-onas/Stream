import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../apps/web/src/services/api.mjs';

const fallback='Something went wrong. Please try again.';

test('empty and non-JSON HTTP errors retain their status and a usable message',async t=>{
  for(const [status,body] of [[403,null],[503,null],[502,'<html>Bad gateway</html>'],[504,'<html>Gateway timeout</html>'],[401,'{incomplete'],[401,'null']]){
    await t.test(`${status}: ${body??'empty body'}`,async t=>{
      t.mock.method(globalThis,'fetch',async()=>new Response(body,{status}));
      await assert.rejects(api('/auth/me'),error=>{
        assert.equal(error.status,status);assert.equal(error.message,fallback);assert.equal(error.code,undefined);return true;
      });
    });
  }
});

test('JSON HTTP errors preserve the server message and error code',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({message:'Your session has expired.',code:'SESSION_EXPIRED'},{status:401}));
  await assert.rejects(api('/me/library'),error=>{
    assert.equal(error.status,401);assert.equal(error.code,'SESSION_EXPIRED');assert.equal(error.message,'Your session has expired.');return true;
  });
});

test('empty and null successful responses are safe to consume',async t=>{
  for(const response of [new Response(null,{status:204}),Response.json(null)]){
    t.mock.method(globalThis,'fetch',async()=>response);
    assert.deepEqual(await api('/test'),{});
    t.mock.restoreAll();
  }
});

test('structured 501 availability responses remain available to the UI',async t=>{
  const data={available:false,code:'NOT_IMPLEMENTED',message:'Comments are unavailable.',items:[]};
  t.mock.method(globalThis,'fetch',async()=>Response.json(data,{status:501}));
  assert.deepEqual(await api('/videos/test/comments'),data);
});

test('network failures keep their original error',async t=>{
  const error=new TypeError('Network unavailable');
  t.mock.method(globalThis,'fetch',async()=>{throw error;});
  await assert.rejects(api('/auth/me'),received=>received===error);
});

test('successful JSON responses still update and clear the CSRF token',async t=>{
  const calls=[],responses=[{user:{id:'test-user'},csrfToken:'test-csrf-token'},{selected:true},{user:null,csrfToken:null},{items:[]}];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return Response.json(responses.shift());});
  assert.deepEqual(await api('/auth/me'),{user:{id:'test-user'},csrfToken:'test-csrf-token'});
  assert.deepEqual(await api('/me/videos/test/liked',{method:'POST',json:{selected:true}}),{selected:true});
  assert.equal(calls[1].url,'/api/me/videos/test/liked');assert.equal(calls[1].options.credentials,'same-origin');
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'test-csrf-token');assert.equal(calls[1].options.headers['Content-Type'],'application/json');assert.deepEqual(JSON.parse(calls[1].options.body),{selected:true});
  await api('/auth/me');await api('/videos');
  assert.equal(calls[3].options.headers['X-CSRF-Token'],undefined);
});
