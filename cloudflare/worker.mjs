import { DurableObject } from 'cloudflare:workers';
import { authorizePublisher, validateMessage } from './protocol.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/live\/(auction-[a-zA-Z0-9-]{1,100})$/);
    if (match) {
      if (request.method !== 'DELETE' && (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')) return new Response('WebSocket required', {status:426});
      if (request.headers.get('Origin') !== url.origin) return new Response('Origin denied', {status:403});
      return env.AUCTION_ROOMS.getByName(match[1]).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', {status:404});
    return env.ASSETS.fetch(request);
  }
};

export class AuctionRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS overview (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // Connections authenticated before the ownership migration must authenticate again.
    for (const socket of ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.role === 'publisher' && attachment.authVersion !== 2) socket.close(4003, 'Reauthenticate');
    }
  }
  snapshot() {
    const row = [...this.ctx.storage.sql.exec('SELECT data FROM overview WHERE id = 1')][0];
    return row ? JSON.parse(row.data) : null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'DELETE') {
      try {
        await authorizePublisher(this.env, request.headers.get('Authorization')?.replace(/^Bearer /,''), url.pathname.split('/').pop());
        await this.ctx.storage.put('deleted',true);
        this.ctx.storage.sql.exec('DELETE FROM overview');
        for (const socket of this.ctx.getWebSockets()) socket.close(4004,'Tournament deleted');
        await this.ctx.storage.deleteAlarm();
        return new Response(null,{status:204});
      } catch { return new Response('Deletion denied',{status:403}); }
    }
    if (await this.ctx.storage.get('deleted')) return new Response('Tournament deleted',{status:410});
    const publisher = url.searchParams.get('mode') === 'publish';
    if (this.ctx.getWebSockets().length >= 1100) return new Response('Room full', {status:503});
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({role:publisher ? 'pending' : 'viewer', room:url.pathname.split('/').pop(), expires:Date.now()+15000});
    if (publisher) {
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm || alarm > Date.now()+15000) await this.ctx.storage.setAlarm(Date.now()+15000);
    }
    if (!publisher) {
      const snapshot = this.snapshot();
      if (snapshot) server.send(JSON.stringify(snapshot));
      server.send(JSON.stringify({type:'LIVE_STATUS', connected:this.publisherOnline()}));
    }
    return new Response(null, {status:101, webSocket:client});
  }
  publisherOnline() {
    return this.ctx.getWebSockets().some(ws => { const a = ws.deserializeAttachment(); return ws.readyState === 1 && a?.role === 'publisher' && a.expires > Date.now(); });
  }
  broadcast(message) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.deserializeAttachment()?.role !== 'viewer') continue;
      try { socket.send(text); } catch { socket.close(1011, 'Reconnect'); }
    }
  }
  async webSocketMessage(socket, raw) {
    const attachment = socket.deserializeAttachment();
    try {
      if (await this.ctx.storage.get('deleted')) throw new Error('Tournament deleted');
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 1024*1024) throw new Error('Message exceeds 1 MB');
      const data = JSON.parse(raw);
      if (attachment.role === 'pending') {
        if (attachment.expires < Date.now() || data.type !== 'AUTH') throw new Error('Authentication required');
        const expires = await authorizePublisher(this.env, data.token, attachment.room);
        if (await this.ctx.storage.get('deleted')) throw new Error('Tournament deleted');
        // One controller at a time prevents competing auction state.
        for (const other of this.ctx.getWebSockets()) if (other !== socket && other.deserializeAttachment()?.role === 'publisher') other.close(4001, 'Another controller connected');
        socket.serializeAttachment({...attachment,role:'publisher',expires,authVersion:2});
        socket.send(JSON.stringify({type:'READY'}));
        this.broadcast({type:'LIVE_STATUS',connected:true});
        const alarm = await this.ctx.storage.getAlarm();
        if (!alarm || expires < alarm) await this.ctx.storage.setAlarm(expires);
        return;
      }
      if (attachment.role !== 'publisher' || attachment.authVersion !== 2 || attachment.expires <= Date.now()) throw new Error('Read-only or expired connection');
      validateMessage(data);
      const previous = this.snapshot();
      if (['OVERVIEW_BID','BID_UPDATE','BACKGROUND_BID_UPDATE'].includes(data.type) && !previous) throw new Error('Full snapshot required first');
      const updatedAt = Date.now();
      // SOLD_CELEBRATION/UNSOLD_ANIMATION/RESET_VIEW are one-shot broadcast cues, not part of the persisted snapshot a late joiner should replay.
      const snapshot = data.type === 'OVERVIEW_SYNC' || data.type === 'SYNC_ALL' ? {...data,updatedAt}
        : data.type === 'OVERVIEW_BID' ? {...previous,currentPlayer:data.player,base:data.base,bid:data.bid,introFields:data.introFields,updatedAt}
        : data.type === 'BID_UPDATE' ? {...previous,currentPlayer:data.player,base:data.base,bid:data.bid,updatedAt}
        : data.type === 'BACKGROUND_BID_UPDATE' ? {...previous,base:data.base,bid:data.bid,updatedAt}
        : null;
      if (snapshot) this.ctx.storage.sql.exec('INSERT INTO overview (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', JSON.stringify(snapshot));
      this.broadcast({...data,updatedAt});
    } catch (error) {
      socket.send(JSON.stringify({type:'LIVE_ERROR',message:error.message}));
      socket.close(1008, 'Invalid or unauthorized update');
    }
  }
  webSocketClose(socket, code) {
    socket.close(code === 1005 ? 1000 : code);
    if (socket.deserializeAttachment()?.role === 'publisher') this.broadcast({type:'LIVE_STATUS',connected:this.publisherOnline()});
  }
  webSocketError(socket) { socket.close(1011, 'Reconnect'); }
  async alarm() {
    for (const socket of this.ctx.getWebSockets()) {
      const a = socket.deserializeAttachment();
      if (a?.role !== 'viewer' && a.expires <= Date.now()) socket.close(4003, 'Session expired');
    }
    this.broadcast({type:'LIVE_STATUS',connected:this.publisherOnline()});
    const active = this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment()).filter(a=>a?.role==='publisher' && a.expires>Date.now());
    const pending = this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment()).filter(a=>a?.role==='pending' && a.expires>Date.now());
    const next = [...active,...pending].map(a=>a.expires);
    if (next.length) await this.ctx.storage.setAlarm(Math.min(...next));
  }
}
