import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {publicConfig} from '../scripts/build.mjs';
const {WorkspaceStore}=createRequire(import.meta.url)('../scripts/workspace-store.js');
test('build requires public credentials and excludes secrets',()=>{
  assert.throws(()=>publicConfig({}));
  for(const key of ['sb_secret_nope', 'eyJ.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.sig'])
    assert.throws(()=>publicConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:key}));
  assert.deepEqual(publicConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_demo',SECRET:'hidden'}),{supabaseUrl:'https://example.supabase.co',supabaseKey:'sb_publishable_demo',localMode:false});
});
test('mutations during an in-flight save are persisted in order',async()=>{
  let release;const calls=[];
  const store=new WorkspaceStore({cache:()=>{},save:async(rev,values)=>{calls.push([rev,values]);if(calls.length===1)await new Promise(r=>release=r);return rev+1;}});
  store.setItem('auc_state','first');const pending=store.flush();
  store.setItem('auc_state','second');release();await pending;
  assert.deepEqual(calls,[[0,{auc_state:'first'}],[1,{auc_state:'second'}]]);
  assert.equal(store.dirty,false);assert.equal(store.revision,2);
});
test('failed saves retain recovery data and can retry',async()=>{
  let fail=true,cache;
  const store=new WorkspaceStore({cache:v=>cache=structuredClone(v),save:async()=>{if(fail)throw Error('offline');return 1;}});
  store.setItem('auc_state','recover me');await assert.rejects(store.flush());
  assert.equal(cache.pending,true);assert.equal(cache.values.auc_state,'recover me');
  fail=false;await store.flush();assert.equal(cache.pending,false);
});
test('revision conflict blocks overwriting newer cloud data',async()=>{
  let calls=0;
  const store=new WorkspaceStore({cache:()=>{},save:async()=>{calls++;throw Object.assign(Error('conflict'),{code:'40001'});}});
  store.setItem('auc_state','old');await assert.rejects(store.flush());
  await assert.rejects(store.flush());assert.equal(calls,1);assert.equal(store.conflict,true);
});
