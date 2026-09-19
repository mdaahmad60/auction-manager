/* Authentication gates the controller. Public display links remain read-only viewers. */
const Account = {
    client:null, store:null, session:null, mode:'login', loaded:false, busy:false,
    setMode(mode) {
        this.mode = mode;
        const titles = {login:'Welcome back',signup:'Create your account',forgot:'Reset your password',reset:'Choose a new password'};
        document.getElementById('auth-title').textContent = titles[mode];
        document.getElementById('auth-name-row').hidden = mode !== 'signup';
        document.getElementById('auth-name').required = mode === 'signup';
        document.getElementById('auth-email-row').hidden = mode === 'reset';
        document.getElementById('auth-email').required = mode !== 'reset';
        document.getElementById('auth-password-row').hidden = mode === 'forgot';
        document.getElementById('auth-password').required = mode !== 'forgot';
        document.getElementById('auth-password').minLength = mode === 'login' ? 1 : 8;
        document.getElementById('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        document.getElementById('auth-confirm-row').hidden = !['signup','reset'].includes(mode);
        document.getElementById('auth-confirm').required = ['signup','reset'].includes(mode);
        document.getElementById('auth-submit').textContent = {login:'Log in',signup:'Create account',forgot:'Send reset email',reset:'Save new password'}[mode];
        document.getElementById('auth-resend').hidden = true;
        this.message('');
    },
    message(text) { document.getElementById('auth-message').textContent = text; },
    redirect(query = '') { return location.origin + location.pathname + query; },
    async submit(event) {
        event.preventDefault();
        if (this.busy || !this.client) return;
        const mode = this.mode;
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        if (['signup','reset'].includes(mode) && password !== document.getElementById('auth-confirm').value) {this.message('The passwords do not match.'); return;}
        this.busy = true; document.getElementById('auth-submit').disabled = true; this.message('Please wait…');
        try {
            if (mode === 'signup') {
                const {data,error} = await this.client.auth.signUp({email,password,options:{data:{full_name:document.getElementById('auth-name').value.trim()},emailRedirectTo:this.redirect('?auth=confirmed')}});
                if (error) throw error;
                if (data.session) await this.open(data.session);
                else {this.message('Check your email to confirm your account, then log in.');document.getElementById('auth-resend').hidden = false;}
            } else if (mode === 'login') {
                const {data,error} = await this.client.auth.signInWithPassword({email,password});
                if (error) throw error;
                await this.open(data.session);
            } else if (mode === 'forgot') {
                const {error} = await this.client.auth.resetPasswordForEmail(email,{redirectTo:this.redirect('?auth=recovery')});
                if (error) throw error;
                this.message('If an account exists for this address, a password reset link will arrive shortly.');
            } else {
                const {error} = await this.client.auth.updateUser({password});
                if (error) throw error;
                const {data} = await this.client.auth.getSession();
                history.replaceState(null,'',location.pathname);
                await this.open(data.session);
            }
        } catch (error) {this.message(error.message || 'Unable to complete the request. Please try again.');}
        finally {this.busy = false;document.getElementById('auth-submit').disabled = false;}
    },
    async resend() {
        if (!this.client || this.busy) return;
        this.busy = true; document.getElementById('auth-resend').disabled = true;
        try {
            const {error} = await this.client.auth.resend({type:'signup',email:document.getElementById('auth-email').value.trim(),options:{emailRedirectTo:this.redirect('?auth=confirmed')}});
            if (error) throw error;
            this.message('Confirmation email requested. Check your inbox.');
        } catch (error) {this.message(error.message);}
        finally {this.busy = false;document.getElementById('auth-resend').disabled = false;}
    },
    report(status,error) {
        const descriptions = {saved:'All changes saved',pending:'Changes waiting to save…',saving:'Saving…',error:'Not saved to cloud. Check your connection and retry.',conflict:'A newer cloud version exists. Download your pending copy before reloading.', 'cache-error':'Browser recovery storage is full. Keep this page open until cloud saving completes.'};
        document.getElementById('cloud-status').textContent = descriptions[status] || status;
        document.getElementById('cloud-status').dataset.status = status;
        document.getElementById('cloud-retry').hidden = !['error','pending','cache-error'].includes(status);
        document.getElementById('cloud-reload').hidden = status !== 'conflict';
        if (error) console.warn('Cloud save failed:',error.code || error.name);
    },
    async open(session) {
        if (this.loaded) return;
        if (!session) {this.setMode('login');return;}
        this.session = session;
        this.message('Loading your tournaments…');
        const {data,error} = await this.client.from('auction_workspaces').select('snapshot,revision').eq('user_id',session.user.id).maybeSingle();
        if (error) throw new Error('Could not load your workspace. Check the Supabase migration and connection, then log in again.');
        const cacheKey = 'auction_cloud_cache_' + session.user.id;
        let cache;
        try {cache = JSON.parse(localStorage.getItem(cacheKey) || 'null');} catch (_) {}
        const revision = Number(data?.revision || 0);
        const pending = cache?.pending && cache.values && typeof cache.values === 'object';
        const store = new WorkspaceStore({
            values:pending ? cache.values : data?.snapshot || {},
            revision:pending ? Number(cache.revision) : revision,
            cache:value => localStorage.setItem(cacheKey,JSON.stringify(value)),
            report:(status,error) => this.report(status,error),
            save:async (expected_revision,new_snapshot) => {
                const {data,error} = await this.client.rpc('save_auction_workspace',{expected_revision,new_snapshot});
                if (error) throw error;
                return data;
            }
        });
        store.dirty = !!pending;
        store.conflict = !!pending && Number(cache.revision) !== revision;
        this.store = store; window.auctionStorage = store;
        document.getElementById('account-email').textContent = session.user.email || 'Your account';
        document.getElementById('account-bar').hidden = false;
        document.getElementById('auth-screen').hidden = true;
        for (const id of ['auth-password','auth-confirm']) document.getElementById(id).value = '';
        this.loaded = true;
        if (new URLSearchParams(location.search).has('auth')) history.replaceState(null,'',location.pathname);
        try {await loadAuctionScript();}
        catch (error) {
            this.loaded = false;
            document.getElementById('auth-screen').hidden = false;
            document.getElementById('account-bar').hidden = true;
            throw error;
        }
        if (store.conflict) this.report('conflict');
        else if (store.dirty) store.flush().catch(() => {});
        else this.report('saved');
    },
    async retry() {try {await this.store.flush();} catch (_) {}},
    download() {
        const payload = {format:'auction-workspace-v1',exportedAt:new Date().toISOString(),values:this.store.values};
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
        const a = document.createElement('a'); a.href=url;a.download='auction-workspace-backup.json';a.click();
        setTimeout(() => URL.revokeObjectURL(url),1000);
    },
    async importLocal() {
        try {
            const raw = localStorage.getItem('auc_tournaments_v1');
            const list = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(list)) throw new Error('The local tournament list is unreadable.');
            const current = JSON.parse(this.store.getItem('auc_tournaments_v1') || '[]');
            let count = 0;
            for (const item of list) {
                if (!item?.id || !item.name || current.some(t => t.id === item.id)) continue;
                const prefix = `auc_tournament_${item.id}_`;
                for (let i=0;i<localStorage.length;i++) {const key=localStorage.key(i);if(key.startsWith(prefix))this.store.setItem(key,localStorage.getItem(key));}
                current.push(item);count++;
            }
            const old = localStorage.getItem('auc_state_v8');
            if (old && !current.some(t => t.id === 'legacy')) {
                this.store.setItem('auc_tournament_legacy_state',old);
                this.store.setItem('auc_tournament_legacy_sheet',localStorage.getItem('auc_player_sheet_url_v1') || '');
                current.push({id:'legacy',name:'Existing tournament',createdAt:new Date().toISOString()});count++;
            }
            this.store.setItem('auc_tournaments_v1',JSON.stringify(current));
            await this.store.flush();
            if (typeof initTournamentHome === 'function') initTournamentHome();
            document.getElementById('cloud-status').textContent = count ? `Imported ${count} local tournament(s).` : 'No new local tournaments found in this browser and site address.';
        } catch (error) {document.getElementById('cloud-status').textContent = error.message;}
    },
    async signOut() {
        try {
            await this.store.flush();
            const {error} = await this.client.auth.signOut();
            if (error) throw error;
            location.replace(location.pathname);
        } catch (error) {document.getElementById('cloud-status').textContent = 'Sign out paused: save or download pending changes first. ' + error.message;}
    },
    reloadCloud() {
        if (!confirm('Load the newest cloud version? Unsaved changes on this device will be discarded. Download a backup first if needed.')) return;
        localStorage.removeItem('auction_cloud_cache_' + this.session.user.id);
        this.store.dirty = false;
        location.reload();
    }
};
function loadAuctionScript() {
    return new Promise((resolve,reject) => {
        const script=document.createElement('script');script.src='scripts/auction.js';
        script.onload=resolve;script.onerror=()=>reject(new Error('The auction interface could not load. Please refresh.'));
        document.body.appendChild(script);
    });
}
async function startAccountApp() {
    const config=window.APP_CONFIG || {};
    const params=new URLSearchParams(location.search);
    if (params.has('overlay') || params.has('overview') || config.localMode === true) {
        window.auctionStorage = config.localMode ? localStorage : new WorkspaceStore({save:async()=>0,cache:()=>{}});
        document.getElementById('auth-screen').hidden=true;
        await loadAuctionScript();return;
    }
    if (!config.supabaseUrl || !config.supabaseKey || !window.supabase) {
        Account.message('Deployment configuration is missing. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, then rebuild.');
        document.getElementById('auth-submit').disabled=true;return;
    }
    Account.client=window.supabase.createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    Account.setMode(params.get('auth') === 'recovery' ? 'reset' : 'login');
    let recovery=params.get('auth') === 'recovery';
    Account.client.auth.onAuthStateChange((event,session) => {
        if(event === 'PASSWORD_RECOVERY') {recovery=true;Account.setMode('reset');}
        if(Account.loaded && (event === 'SIGNED_OUT' || (session && session.user.id !== Account.session.user.id))) location.replace(location.pathname);
    });
    const {data,error}=await Account.client.auth.getSession();
    if(error) throw error;
    if(recovery) {
        if(!data.session) {Account.setMode('forgot');Account.message('This reset link is missing or expired. Request a new one.');}
    } else if(data.session) await Account.open(data.session);
    else if(params.get('auth') === 'confirmed') Account.message('Your email confirmation was processed. You can log in now.');
}
window.addEventListener('beforeunload',event => {if(Account.store?.dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',()=>Account.store?.flush().catch(()=>{}));
document.addEventListener('click', async event => {
    const link=event.target.closest('a[href]');
    if(!Account.store?.dirty || !link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || link.target || link.download) return;
    const url=new URL(link.href,location.href);
    if(url.origin !== location.origin) return;
    event.preventDefault();
    try {await Account.store.flush();location.href=url.href;} catch (_) {}
});
startAccountApp().catch(error=>Account.message(error.message));
