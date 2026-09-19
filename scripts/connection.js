/* Same-origin tabs connect directly; separate browsers use PeerJS. */
class AuctionEvents {
    constructor() { this.events = {}; }
    on(name, fn) { (this.events[name] ||= []).push(fn); return this; }
    emit(name, value) { (this.events[name] || []).forEach(fn => fn(value)); }
}
class AuctionLocalConnection extends AuctionEvents {
    constructor(owner, remote, token) {
        super(); this.owner = owner; this.remote = remote; this.token = token;
        this.open = false; this.lastSeen = Date.now();
    }
    send(data) { if (this.open) this.owner.post(this.remote, this.token, 'data', data); }
    close() {
        this.owner.post(this.remote, this.token, 'close');
        this.owner.locals.delete(this.token);
        if (this.open) { this.open = false; this.emit('close'); }
    }
}
class AuctionPeer extends AuctionEvents {
    constructor(id) {
        super(); this.id = id || 'auction-' + crypto.randomUUID(); this.locals = new Map();
        this.outgoing = new Set(); this.stopped = false;
        try {
            this.channel = new BroadcastChannel('auction-connections-v1');
            this.channel.onmessage = event => this.receive(event.data);
        } catch (_) {}
        this.startNetwork();
        this.heartbeat = setInterval(() => {
            for (const conn of this.locals.values()) {
                if (Date.now() - conn.lastSeen > 12000) conn.close();
                else this.post(conn.remote, conn.token, 'ping');
            }
        }, 3000);
        window.addEventListener('pagehide', () => this.destroy(), {once:true});
        // Links and local connections do not have to wait for cloud signaling.
        queueMicrotask(() => this.emit('open', this.id));
    }
    post(to, token, type, data) { try { this.channel?.postMessage({from:this.id, to, token, type, data}); } catch (_) {} }
    receive(message) {
        if (!message || message.to !== this.id) return;
        let conn = this.locals.get(message.token);
        if (message.type === 'hello' && !conn) {
            conn = new AuctionLocalConnection(this, message.from, message.token);
            this.locals.set(message.token, conn);
            this.emit('connection', conn);
            conn.open = true;
            this.post(conn.remote, conn.token, 'ready');
            conn.emit('open');
        } else if (conn) {
            conn.lastSeen = Date.now();
            if (message.type === 'ready' && !conn.open) { conn.open = true; conn.emit('open'); }
            if (message.type === 'data' && conn.open) conn.emit('data', message.data);
            if (message.type === 'ping') this.post(conn.remote, conn.token, 'pong');
            if (message.type === 'close') {
                this.locals.delete(conn.token); conn.open = false; conn.emit('close');
            }
        }
    }
    startNetwork() {
        if (this.stopped || typeof Peer === 'undefined') return;
        this.network = new Peer(this.id, {config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},
            {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
            {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
            {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}]}});
        const network = this.network;
        network.on('connection', conn => this.emit('connection', conn));
        network.on('open', () => this.outgoing.forEach(attempt => attempt()));
        network.on('disconnected', () => {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
                if (!this.stopped && !network.destroyed && network.disconnected) network.reconnect();
            }, 2000);
        });
        network.on('error', error => {
            this.emit('error', error);
            // A refreshed controller may briefly wait for its previous cloud ID to be released.
            if (['network','server-error','socket-error','socket-closed','unavailable-id'].includes(error.type)) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => {
                    if (this.stopped) return;
                    network.destroy(); this.startNetwork();
                }, 3000);
            }
        });
    }
    connect(remote) {
        const result = new AuctionEvents(); result.open = false;
        let selected = null, candidates = [], attemptTimer, timeout;
        const cleanup = () => {
            clearTimeout(timeout);
            const old = candidates; candidates = [];
            old.forEach(c => { if (c !== selected) c.close(); });
        };
        const attach = conn => {
            candidates.push(conn);
            conn.on('open', () => {
                if (selected) { if (selected !== conn) conn.close(); return; }
                selected = conn; result.open = true; cleanup(); result.emit('open');
            });
            conn.on('data', data => { if (selected === conn) result.emit('data', data); });
            const lost = () => {
                if (selected !== conn) return;
                selected = null; result.open = false; result.emit('close');
                clearTimeout(attemptTimer); attemptTimer = setTimeout(attempt, 1000);
            };
            conn.on('close', lost); conn.on('error', lost);
        };
        const attempt = () => {
            if (selected || this.stopped) return;
            clearTimeout(attemptTimer); cleanup();
            if (this.channel) {
                const local = new AuctionLocalConnection(this, remote, crypto.randomUUID());
                this.locals.set(local.token, local); attach(local); this.post(remote, local.token, 'hello');
            }
            if (this.network?.open) {
                try { attach(this.network.connect(remote, {reliable:true})); } catch (_) {}
            }
            timeout = setTimeout(() => {
                if (!selected) { cleanup(); result.emit('retry'); attemptTimer = setTimeout(attempt, 2000); }
            }, 6000);
        };
        result.send = data => { if (selected?.open) selected.send(data); };
        result.close = () => {
            this.outgoing.delete(attempt); clearTimeout(attemptTimer); cleanup();
            const old = selected; selected = null; result.open = false; if (old) old.close();
        };
        this.outgoing.add(attempt); queueMicrotask(attempt);
        return result;
    }
    destroy() {
        this.stopped = true; clearInterval(this.heartbeat); clearTimeout(this.reconnectTimer);
        for (const conn of this.locals.values()) conn.close();
        this.channel?.close(); this.network?.destroy();
    }
}
