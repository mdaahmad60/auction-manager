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
    return Response.json([{snapshot:{auc_tournaments_v1:'[{"id":"t"}]','auc_tournament_t_overview-peer':'auction-test'}}]);
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
  console.log('PASS: local Cloudflare runtime — 500 viewers, bid broadcast, reconnect snapshot, origin checks, read-only enforcement, room ownership and offline status');
} finally {
  sockets.forEach(ws=>{try {ws.close(1000);} catch {}});
  await mf.dispose();
}
