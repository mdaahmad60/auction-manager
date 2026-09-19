import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/tournaments.js',import.meta.url),'utf8');
function harness(failSecond=false) {
  const values=new Map([['auc_tournaments_v1','[{"id":"one","name":"Cup"}]'],['auc_tournament_one_overview-peer','auction-tampered']]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size;},key:index=>[...values.keys()][index]};
  const deleted=[],status={};let flushes=0;
  const registry=[{room_id:'auction-overview'},{room_id:'auction-overlay'}];
  const account={store:{flush:async()=>flushes++},client:{
    from:table=>{assert.equal(table,'auction_live_rooms');return {select:()=>({eq:async(key,id)=>{assert.equal(key,'tournament_id');assert.equal(id,'one');return {data:registry};}})};},
    rpc:async(name,args)=>{assert.equal(name,'get_auction_live_room');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_tournament_id:'one',p_kind:'overview'});return {data:'auction-server-room'};},
    auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}
  }};
  const context=vm.createContext({window:{APP_CONFIG:{liveOverview:'cloudflare'},auctionStorage:storage},Account:account,confirm:()=>true,
    document:{getElementById:()=>status},fetch:async(url,opts)=>{assert.equal(opts.method,'DELETE');deleted.push(url);return {ok:!(failSecond&&url.endsWith('auction-overlay'))};}});
  vm.runInContext(source+';initTournamentHome=()=>{};',context);
  return {context,values,deleted,status,account,get flushes(){return flushes;}};
}
test('delete cleans both registered rooms even when local link IDs are missing or modified',async()=>{
  const h=harness();await vm.runInContext("deleteTournament('one')",h.context);
  assert.deepEqual(h.deleted,['/api/live/auction-overview','/api/live/auction-overlay']);
  assert.equal(h.values.get('auc_tournaments_v1'),'[]');
  assert.equal(h.flushes,2);
});
test('failed second-room deletion keeps the tournament for an idempotent retry',async()=>{
  const h=harness(true);await vm.runInContext("deleteTournament('one')",h.context);
  assert.equal(JSON.parse(h.values.get('auc_tournaments_v1')).length,1);
  assert.match(h.status.textContent,/retry/);
});
test('cloud room setup uses server allocation and replaces a tampered local ID',async()=>{
  const h=harness();assert.equal(await vm.runInContext("cloudTournamentRoom('one','overview')",h.context),'auction-server-room');
  assert.equal(h.values.get('auc_tournament_one_overview-peer'),'auction-server-room');
  assert.equal(h.flushes,2);
});
test('failed migration or allocation cannot generate a replacement client-owned room',async()=>{
  const h=harness();h.account.client.rpc=async()=>({error:{message:'missing function'}});
  await assert.rejects(vm.runInContext("cloudTournamentRoom('one','overview')",h.context),/migration/);
  assert.equal(h.values.get('auc_tournament_one_overview-peer'),'auction-tampered');
});
