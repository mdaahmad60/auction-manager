import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizePublisher,validateMessage} from '../cloudflare/protocol.mjs';
const env = {SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const token = `header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const snapshot = {auc_tournaments_v1:JSON.stringify([{id:'one'}]),auc_tournament_one_overview_peer:'unused', 'auc_tournament_one_overview-peer':'auction-owned'};
function mockFetch(authOK=true, workspace=snapshot) {
  return async url => url.endsWith('/auth/v1/user') ? new Response(JSON.stringify({id:'owner'}),{status:authOK?200:401}) : Response.json([{snapshot:workspace}]);
}
test('only a Supabase-validated owner can publish to the saved overview room',async()=>{
  assert.ok(await authorizePublisher(env,token,'auction-owned',mockFetch()) > Date.now());
  await assert.rejects(authorizePublisher(env,token,'auction-other',mockFetch()),/own/);
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch(false)),/session/);
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch(true,{...snapshot,auc_tournaments_v1:'[]'})),/own/);
});
test('expired tokens and invalid protocol messages fail closed',async()=>{
  const expired = `h.${Buffer.from(JSON.stringify({exp:1})).toString('base64url')}.s`;
  await assert.rejects(authorizePublisher(env,expired,'auction-owned',mockFetch()),/expired/);
  const bid = {type:'OVERVIEW_BID',player:null,base:0,bid:100,introFields:[]};
  assert.doesNotThrow(()=>validateMessage(bid));
  assert.throws(()=>validateMessage({...bid,bid:-1}));
  assert.throws(()=>validateMessage({...bid,type:'DELETE'}));
  assert.throws(()=>validateMessage({...bid,introFields:[{key:'x'}]}));
  assert.throws(()=>validateMessage({...bid,type:'OVERVIEW_SYNC'}));
});
