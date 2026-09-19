// Run against a Wrangler dry-run bundle; Supabase is mocked, no cloud writes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {Miniflare} = await import(process.env.MINIFLARE_MODULE ? pathToFileURL(process.env.MINIFLARE_MODULE).href : 'miniflare');
const bundle = process.argv[2];
if (!bundle) throw new Error('Pass the path to a Wrangler dry-run worker.js bundle');
const token = `h.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.s`;
const mf = new Miniflare({workers:[{name:'auction-test-worker',
  modules:true, scriptPath:bundle, compatibilityDate:'2026-07-30',
  durableObjects:{AUCTION_ROOMS:{className:'AuctionRoom',useSQLite:true}},
  bindings:{SUPABASE_URL:'https://mock.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
  serviceBindings:{ASSETS:()=>new Response('static')},
  outboundService:request=>{
    if (request.headers.get('Authorization') !== `Bearer ${token}`) return new Response('denied',{status:401});
    if (new URL(request.url).pathname === '/auth/v1/user') return Response.json({id:'owner'});
    return Response.json([{snapshot:{auc_tournaments_v1:'[{"id":"t"}]','auc_tournament_t_overview-peer':'auction-test','auc_tournament_t_overlayLive-peer':'auction-overlay-live'}}]);
  }
}]});
const sockets=[];
async function connect(path='auction-test',publish=false) {
  const result=await mf.dispatchFetch(`http://localhost/api/live/${path}${publish?'?mode=publish':''}`,{headers:{Upgrade:'websocket',Origin:'http://localhost'}});
  assert.equal(result.status,101);
  const socket=result.webSocket; const received=[];
  socket.addEventListener('message',event=>{if(event.data!=='pong') received.push(JSON.parse(event.data));});
  socket.accept(); sockets.push(socket);
  return {socket,received};
}
async function until(check) {
  const end=Date.now()+10000;
  while(!check()) {if(Date.now()>end) throw new Error('Timed out waiting for WebSocket result'); await new Promise(r=>setTimeout(r,10));}
}
try {
  assert.equal((await mf.dispatchFetch('http://localhost/')).status,200);
  assert.equal((await mf.dispatchFetch('http://localhost/api/live/auction-test',{headers:{Upgrade:'websocket',Origin:'https://wrong.example'}})).status,403);
  const publisher=await connect('auction-test',true);
  publisher.socket.send(JSON.stringify({type:'AUTH',token}));
  await until(()=>publisher.received.some(m=>m.type==='READY'));
  const snapshot={type:'OVERVIEW_SYNC',currentPlayer:{name:'Alice'},base:100,bid:100,introFields:[],teams:[],allPlayers:[],soldSerials:[],unsoldSerials:[]};
  publisher.socket.send(JSON.stringify(snapshot));
  const viewers=await Promise.all(Array.from({length:500},()=>connect()));
  await until(()=>viewers.every(v=>v.received.some(m=>m.type==='OVERVIEW_SYNC')));
  publisher.socket.send(JSON.stringify({type:'OVERVIEW_BID',player:{name:'Alice'},base:100,bid:200,introFields:[]}));
  await until(()=>viewers.every(v=>v.received.some(m=>m.type==='OVERVIEW_BID' && m.bid===200)));
  const reconnected=await connect();
  await until(()=>reconnected.received.some(m=>m.type==='OVERVIEW_SYNC' && m.bid===200));
  viewers[0].socket.send(JSON.stringify({...snapshot,bid:999}));
  await until(()=>viewers[0].received.some(m=>m.type==='LIVE_ERROR'));
  const intruder=await connect('auction-other',true);
  intruder.socket.send(JSON.stringify({type:'AUTH',token}));
  await until(()=>intruder.received.some(m=>m.type==='LIVE_ERROR'));
  publisher.socket.close(1000);
  await until(()=>viewers[1].received.some(m=>m.type==='LIVE_STATUS' && m.connected===false));

  // Separate room for the "overlay via Internet" link — its own peer id, own message family.
  const overlayPublisher=await connect('auction-overlay-live',true);
  overlayPublisher.socket.send(JSON.stringify({type:'AUTH',token}));
  await until(()=>overlayPublisher.received.some(m=>m.type==='READY'));
  const overlaySync={type:'SYNC_ALL',teams:[{name:'Titans'}],settings:{showBidding:true},base:100,bid:100,currentPlayer:{name:'Alice'}};
  overlayPublisher.socket.send(JSON.stringify(overlaySync));
  const overlayViewer=await connect('auction-overlay-live');
  await until(()=>overlayViewer.received.some(m=>m.type==='SYNC_ALL'));
  overlayPublisher.socket.send(JSON.stringify({type:'BID_UPDATE',base:100,bid:250,player:{name:'Alice'}}));
  await until(()=>overlayViewer.received.some(m=>m.type==='BID_UPDATE' && m.bid===250));
  overlayPublisher.socket.send(JSON.stringify({type:'SOLD_CELEBRATION',bid:250,team:'Titans',logo:'',player:'Alice',playerDetails:{name:'Alice'}}));
  await until(()=>overlayViewer.received.some(m=>m.type==='SOLD_CELEBRATION'));
  // The celebration is a one-shot cue, not part of the persisted snapshot — a late joiner should see the last real bid state, not a frozen "sold" replay.
  const overlayLateJoiner=await connect('auction-overlay-live');
  await until(()=>overlayLateJoiner.received.some(m=>m.type==='SYNC_ALL' && m.bid===250));
  assert.ok(!overlayLateJoiner.received.some(m=>m.type==='SOLD_CELEBRATION'), 'Late joiner must not replay a stale sold celebration');
  console.log('PASS: local Cloudflare runtime — 500 viewers, bid broadcast, reconnect snapshot, origin checks, read-only enforcement, room ownership and offline status');
  console.log('PASS: overlay-via-Internet room — separate peer id, SYNC_ALL/BID_UPDATE persisted, celebration cues broadcast-only');
} finally {
  sockets.forEach(ws=>{try {ws.close(1000);} catch {}});
  await mf.dispose();
}
