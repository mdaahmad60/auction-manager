function getAuctionStorage() { return typeof window !== 'undefined' && window.auctionStorage ? window.auctionStorage : localStorage; }
const TOURNAMENT_INDEX_KEY = 'auc_tournaments_v1';
function tournamentStorageKey(id, part) { return `auc_tournament_${id}_${part}`; }
function tournamentPeerId(id, role) {
    if (!id || !['overlay', 'overview'].includes(role)) throw new Error('Invalid tournament connection.');
    const key = tournamentStorageKey(id, role + '-peer');
    let peerId = getAuctionStorage().getItem(key);
    if (!peerId) {
        peerId = 'auction-' + crypto.randomUUID();
        getAuctionStorage().setItem(key, peerId);
    }
    return peerId;
}
function readTournamentIndex() {
    const raw = getAuctionStorage().getItem(TOURNAMENT_INDEX_KEY);
    if (!raw) return [];
    const index = JSON.parse(raw);
    if (!Array.isArray(index) || index.some(t => !t || typeof t.id !== 'string' || typeof t.name !== 'string')) throw new Error('Tournament list is unreadable. Your saved data has been kept.');
    return index;
}
function migrateLegacyTournament() {
    const index = readTournamentIndex();
    const saved = getAuctionStorage().getItem('auc_state_v8');
    if (!saved || index.some(t => t.id === 'legacy')) return index;
    // Preserve the original single-auction keys as a recovery copy.
    if (!getAuctionStorage().getItem(tournamentStorageKey('legacy', 'state'))) {
        getAuctionStorage().setItem(tournamentStorageKey('legacy', 'state'), saved);
        getAuctionStorage().setItem(tournamentStorageKey('legacy', 'sheet'), getAuctionStorage().getItem('auc_player_sheet_url_v1') || 'https://docs.google.com/spreadsheets/d/1nlo7vkIOs4w8QTD-wWZjY_zcm73E0JJfzvWzDtRhuGI/edit?usp=sharing');
        getAuctionStorage().setItem(tournamentStorageKey('legacy', 'tab'), getAuctionStorage().getItem('auc_controller_tab_v1') || 'players');
    }
    index.push({id:'legacy',name:'Existing tournament',createdAt:new Date().toISOString()});
    getAuctionStorage().setItem(TOURNAMENT_INDEX_KEY, JSON.stringify(index));
    return index;
}
function createTournamentRecord(name) {
    name = name.trim();
    if (!name) throw new Error('Enter a tournament name.');
    if (name.length > 100) throw new Error('Use a name of 100 characters or fewer.');
    const index = readTournamentIndex();
    const tournament = {id:crypto.randomUUID(),name,createdAt:new Date().toISOString()};
    getAuctionStorage().setItem(TOURNAMENT_INDEX_KEY, JSON.stringify([...index,tournament]));
    return tournament;
}
function tournamentUrl(id) {
    const url = new URL(location.href); url.search = ''; url.hash = '';
    if (id) url.searchParams.set('tournament', id);
    return url.href;
}
function initTournamentHome() {
    const list = document.getElementById('tournament-list');
    const status = document.getElementById('tournament-home-status');
    try {
        const tournaments = migrateLegacyTournament();
        list.replaceChildren();
        document.getElementById('tournament-empty').hidden = tournaments.length > 0;
        document.getElementById('tournament-count').textContent = `${tournaments.length} tournament${tournaments.length === 1 ? '' : 's'}`;
        for (const tournament of tournaments) {
            const card = document.createElement('article'); card.className = 'tournament-card';
            const link = document.createElement('a'); link.className = 'tournament-card-link'; link.href = tournamentUrl(tournament.id);
            const icon = document.createElement('span'); icon.className = 'tournament-icon'; icon.textContent = '🏆';
            const title = document.createElement('h2'); title.textContent = tournament.name;
            const info = document.createElement('p');
            try {
                const saved = JSON.parse(getAuctionStorage().getItem(tournamentStorageKey(tournament.id,'state')) || 'null');
                info.textContent = saved ? `${saved.teams.length} teams · ${saved.teams.reduce((sum,t) => sum + t.playerList.length,0)} players sold` : 'Ready to set up your auction';
            } catch (_) { info.textContent = 'Saved auction · open to review'; }
            const action = document.createElement('span'); action.className = 'tournament-open'; action.textContent = 'Open auction →';
            link.append(icon,title,info,action);
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tournament-delete';
            remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete ${tournament.name}`);
            remove.onclick = () => deleteTournament(tournament.id);
            card.append(link,remove); list.appendChild(card);
        }
    } catch (error) { status.textContent = error.message; }
}
function showAddTournament() {
    const dialog = document.getElementById('add-tournament-dialog');
    document.getElementById('new-tournament-name').value = '';
    document.getElementById('tournament-form-error').textContent = '';
    dialog.showModal(); document.getElementById('new-tournament-name').focus();
}
async function submitTournament(event) {
    event.preventDefault();
    try {
        const tournament = createTournamentRecord(document.getElementById('new-tournament-name').value);
        if (getAuctionStorage().flush) await getAuctionStorage().flush();
        location.href = tournamentUrl(tournament.id);
    } catch (error) { document.getElementById('tournament-form-error').textContent = error.message; }
}

function deleteTournamentRecord(id) {
    const index = readTournamentIndex();
    if (!index.some(t => t.id === id)) return;
    const prefix = tournamentStorageKey(id, '');
    const keys = [];
    for (let i = 0; i < getAuctionStorage().length; i++) {
        const key = getAuctionStorage().key(i);
        if (key.startsWith(prefix)) keys.push(key);
    }
    // Remove the directory entry first; active controllers observe this change and close.
    getAuctionStorage().setItem(TOURNAMENT_INDEX_KEY, JSON.stringify(index.filter(t => t.id !== id)));
    if (id === 'legacy') {
        // An explicitly deleted imported tournament must not be imported again.
        keys.push('auc_state_v8', 'auc_state_v8_recovery', 'auc_player_sheet_url_v1', 'auc_controller_tab_v1');
    }
    keys.forEach(key => getAuctionStorage().removeItem(key));
}
async function deleteTournament(id) {
    const status = document.getElementById('tournament-home-status');
    try {
        const tournament = readTournamentIndex().find(t => t.id === id);
        if (!tournament) { initTournamentHome(); return; }
        if (!confirm(`Delete “${tournament.name}”?\n\nThis permanently removes its saved auction, players, settings and links from this browser. This cannot be undone.`)) return;
        if (window.APP_CONFIG?.liveOverview === 'cloudflare') {
            const room = getAuctionStorage().getItem(tournamentStorageKey(id, 'overview-peer'));
            if (room) {
                await Account.store.flush();
                const {data,error} = await Account.client.auth.getSession();
                if (error || !data.session) throw new Error('Sign in again before deleting.');
                const response = await fetch(`/api/live/${encodeURIComponent(room)}`, {method:'DELETE',headers:{Authorization:`Bearer ${data.session.access_token}`}});
                if (!response.ok) throw new Error('Could not remove the public overview. Please retry.');
            }
        }
        deleteTournamentRecord(id);
        if (window.APP_CONFIG?.liveOverview === 'cloudflare') await Account.store.flush();
        initTournamentHome();
        status.textContent = `Deleted “${tournament.name}”.`;
    } catch (error) { status.textContent = `Could not delete tournament: ${error.message}`; }
}
