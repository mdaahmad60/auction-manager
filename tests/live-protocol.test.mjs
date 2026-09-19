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
test('the "overlay via Internet" room authorizes on its own saved peer id, separate from the overview room',async()=>{
  const overlayLiveSnapshot = {auc_tournaments_v1:JSON.stringify([{id:'one'}]), 'auc_tournament_one_overlayLive-peer':'auction-overlay-live'};
  assert.ok(await authorizePublisher(env,token,'auction-overlay-live',mockFetch(true,overlayLiveSnapshot)) > Date.now());
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch(true,overlayLiveSnapshot)),/own/);
});
test('overlay-via-Internet message types validate independently of the OVERVIEW family',()=>{
  const sync = {type:'SYNC_ALL',teams:[],settings:{},base:100,bid:100,currentPlayer:null};
  assert.doesNotThrow(()=>validateMessage(sync));
  assert.throws(()=>validateMessage({...sync,teams:'nope'}));
  assert.throws(()=>validateMessage({...sync,bid:-1}));
  const update = {type:'BID_UPDATE',base:100,bid:150,player:{name:'Alice'}};
  assert.doesNotThrow(()=>validateMessage(update));
  const background = {type:'BACKGROUND_BID_UPDATE',base:100,bid:150};
  assert.doesNotThrow(()=>validateMessage(background));
  assert.doesNotThrow(()=>validateMessage({type:'SOLD_CELEBRATION',bid:150,team:'Team',logo:'',player:'Alice',playerDetails:{name:'Alice'}}));
  assert.doesNotThrow(()=>validateMessage({type:'UNSOLD_ANIMATION',player:'Alice',playerDetails:{name:'Alice'}}));
  assert.doesNotThrow(()=>validateMessage({type:'RESET_VIEW'}));
  assert.throws(()=>validateMessage({type:'SOLD_CELEBRATION',bid:-1}));
});
