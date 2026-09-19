import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizePublisher,validateMessage} from '../cloudflare/protocol.mjs';
const env = {SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const token = `header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
function mockFetch({authOK=true, allowedRooms=['auction-owned'], rpcStatus=200} = {}) {
  return async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({id:'owner'}, {status:authOK?200:401});
    assert.ok(url.endsWith('/rest/v1/rpc/can_publish_auction_room'), 'Ownership must use the registry RPC, not workspace peer strings');
    assert.equal(options.method,'POST');
    return Response.json(allowedRooms.includes(JSON.parse(options.body).p_room_id), {status:rpcStatus});
  };
}
test('only a Supabase-validated registered owner can publish',async()=>{
  assert.ok(await authorizePublisher(env,token,'auction-owned',mockFetch()) > Date.now());
  await assert.rejects(authorizePublisher(env,token,'auction-other',mockFetch()),/own/);
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch({authOK:false})),/session/);
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch({allowedRooms:[]})),/own/);
});
test('a copied workspace room ID cannot override the registry; missing migration fails closed',async()=>{
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch({allowedRooms:[]})),/own/);
  await assert.rejects(authorizePublisher(env,token,'auction-owned',mockFetch({rpcStatus:404})),/migration/);
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
test('the Internet overlay requires its own registered room, separate from the overview',async()=>{
  const fetcher = mockFetch({allowedRooms:['auction-overlay-live']});
  assert.ok(await authorizePublisher(env,token,'auction-overlay-live',fetcher) > Date.now());
  await assert.rejects(authorizePublisher(env,token,'auction-owned',fetcher),/own/);
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
