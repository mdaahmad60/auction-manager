/* Cloudflare transport: token stays in an authenticated message, never in a URL. */
class CloudOverviewConnection {
    constructor(room, {publisher = false, onData = () => {}, onStatus = () => {}, snapshot} = {}) {
        this.room = room; this.publisher = publisher; this.onData = onData;
        this.onStatus = onStatus; this.snapshot = snapshot; this.stopped = false;
        this.ready = false; this.attempt = 0;
        this.connect();
        window.addEventListener('pagehide', () => this.close(), {once:true});
    }
    async connect() {
        if (this.stopped) return;
        this.onStatus(false, 'Connecting to live overview…');
        try {
            let token;
            if (this.publisher) {
                // Persist permanent room ID before the server verifies ownership.
                await Account.store.flush();
                const {data,error} = await Account.client.auth.getSession();
                if (error || !data.session) throw new Error('Sign in again to publish live updates.');
                token = data.session.access_token;
            }
            if (this.stopped) return;
            const url = new URL(`/api/live/${encodeURIComponent(this.room)}`, location.origin);
            url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            if (this.publisher) url.searchParams.set('mode','publish');
            const socket = this.socket = new WebSocket(url);
            this.lastSeen = Date.now();
            socket.onopen = () => {
                this.lastSeen = Date.now();
                if (this.publisher) socket.send(JSON.stringify({type:'AUTH',token}));
                this.heartbeat = setInterval(() => {
                    if (Date.now() - this.lastSeen > 65000) { socket.close(); return; }
                    if (socket.readyState === WebSocket.OPEN) socket.send('ping');
                }, 25000);
            };
            socket.onmessage = event => {
                this.lastSeen = Date.now();
                if (event.data === 'pong') return;
                let data; try {data = JSON.parse(event.data);} catch {return;}
                if (data.type === 'READY') {
                    this.ready = true; this.attempt = 0; this.lastCore = null; this.lastMessage = null;
                    this.onStatus(true, 'Live overview connected');
                    this.snapshot({send:message=>this.send(message)});
                } else if (data.type === 'LIVE_ERROR') {
                    this.onStatus(false, data.message);
                } else if (data.type === 'LIVE_STATUS') {
                    this.attempt = 0;
                    this.onStatus(data.connected, data.connected ? 'Live updates connected' : 'Controller offline — showing last saved update');
                } else {
                    this.onData(data);
                }
            };
            socket.onerror = () => socket.close();
            socket.onclose = event => {
                clearInterval(this.heartbeat); this.ready = false;
                this.onStatus(false, event.code === 4004 ? 'Tournament deleted' : event.code === 4001 ? 'Another controller is publishing. Reload to take over.' : 'Live overview disconnected — reconnecting…');
                if ([4001,4004].includes(event.code)) this.stopped = true;
                if (event.code === 4004 && !this.publisher) this.onData({type:'OVERVIEW_SYNC',currentPlayer:null,base:0,bid:0,introFields:[],teams:[],allPlayers:[],soldSerials:[],unsoldSerials:[]});
                this.retry();
            };
        } catch (error) {
            this.onStatus(false, error.message); this.retry();
        }
    }
    retry() {
        if (this.stopped) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(()=>this.connect(), Math.min(30000,1000*2**this.attempt++) + Math.random()*1000);
    }
    send(message) {
        // On reconnect, send a fresh snapshot rather than replaying stale bids.
        if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
        let nextCore = this.lastCore;
        if (message.type === 'OVERVIEW_SYNC') {
            const {currentPlayer,base,bid,...core} = message;
            const signature = JSON.stringify(core);
            if (signature === this.lastCore) message = {type:'OVERVIEW_BID',player:currentPlayer,base,bid,introFields:message.introFields};
            nextCore = signature;
        }
        const text = JSON.stringify(message);
        if (text === this.lastMessage) return;
        if (new TextEncoder().encode(text).length > 1024*1024) {
            this.onStatus(false, 'Overview exceeds 1 MB. Use image URLs or smaller team logos.'); return;
        }
        this.socket.send(text);
        this.lastCore = nextCore;
        this.lastMessage = text;
    }
    close() {
        this.stopped = true; this.ready = false;
        clearTimeout(this.retryTimer); clearInterval(this.heartbeat); this.socket?.close();
    }
}
