// Own-deployment smoke/load check; never publishes auction state.
const [endpoint, countText='500', secondsText='60'] = process.argv.slice(2);
const url = new URL(endpoint);
const count = Number(countText), seconds = Number(secondsText);
if (!['ws:','wss:'].includes(url.protocol) || !Number.isInteger(count) || count<1 || count>1000 || !Number.isInteger(seconds) || seconds<1 || seconds>600) throw new Error('Use: node scripts/load-overview.mjs wss://HOST/api/live/ROOM [1-1000 clients] [1-600 seconds]');
// Node's native WebSocket does not expose custom Origin headers. Use the HTTP
// upgrade in the ws package for browser-equivalent origins.
const {default:WebSocket} = await import('ws').catch(()=>{throw new Error('Install the load-test client first: npm install --no-save --package-lock=false ws');});
const origin = url.origin.replace(/^ws/,'http');
let opened=0, failed=0, updates=0;
const clients=[];
for(let i=0;i<count;i++) {
  const ws = new WebSocket(url,{origin}); clients.push(ws);
  ws.on('open',()=>opened++);
  ws.on('error',()=>failed++);
  ws.on('message',raw=>{try {if (['OVERVIEW_SYNC','OVERVIEW_BID'].includes(JSON.parse(raw).type)) updates++;} catch {}});
  if (i%25===24) await new Promise(resolve=>setTimeout(resolve,100));
}
await new Promise(resolve=>setTimeout(resolve,seconds*1000));
const active=clients.filter(ws=>ws.readyState===WebSocket.OPEN).length;
console.log(JSON.stringify({requested:count,opened,active,failed,receivedUpdates:updates},null,2));
clients.forEach(ws=>ws.terminate());
if(active!==count || failed || updates<count) process.exitCode=1;
