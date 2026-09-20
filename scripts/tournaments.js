function getAuctionStorage() { return typeof window !== 'undefined' && window.auctionStorage ? window.auctionStorage : localStorage; }
const TOURNAMENT_INDEX_KEY = 'auc_tournaments_v1';
function tournamentStorageKey(id, part) { return `auc_tournament_${id}_${part}`; }
function tournamentPeerId(id, role) {
    if (!id || !['overlay', 'overview', 'overlayLive'].includes(role)) throw new Error('Invalid tournament connection.');
    const key = tournamentStorageKey(id, role + '-peer');
    let peerId = getAuctionStorage().getItem(key);
    if (!peerId) {
        peerId = 'auction-' + crypto.randomUUID();
        getAuctionStorage().setItem(key, peerId);
    }
    return peerId;
}
async function cloudTournamentRoom(id, kind) {
    if (!id || !['overview', 'overlayLive'].includes(kind)) throw new Error('Invalid live room.');
    await Account.store.flush();
    const {data, error} = await Account.client.rpc('get_auction_live_room', {p_tournament_id:id, p_kind:kind});
    if (error) throw new Error('Could not prepare the live room. Check the Supabase live-room migration and retry.');
    if (typeof data !== 'string' || !/^auction-[a-zA-Z0-9-]{1,100}$/.test(data)) throw new Error('Invalid live room response.');
    if (!readTournamentIndex().some(t => t.id === id)) throw new Error('Tournament was deleted.');
    getAuctionStorage().setItem(tournamentStorageKey(id, kind + '-peer'), data);
    await Account.store.flush();
    return data;
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
function createTournamentRecord(name, logo) {
    name = name.trim();
    if (!name) throw new Error('Enter a tournament name.');
    if (name.length > 100) throw new Error('Use a name of 100 characters or fewer.');
    const index = readTournamentIndex();
    const tournament = {id:crypto.randomUUID(), name, createdAt:new Date().toISOString(), ...(logo ? {logo} : {})};
    getAuctionStorage().setItem(TOURNAMENT_INDEX_KEY, JSON.stringify([...index,tournament]));
    return tournament;
}
function updateTournamentRecord(id, patch) {
    const index = readTournamentIndex();
    const i = index.findIndex(t => t.id === id);
    if (i === -1) throw new Error('Tournament not found.');
    const name = (patch.name ?? index[i].name).trim();
    if (!name) throw new Error('Enter a tournament name.');
    if (name.length > 100) throw new Error('Use a name of 100 characters or fewer.');
    const updated = {...index[i], ...patch, name};
    if (!updated.logo) delete updated.logo;
    index[i] = updated;
    getAuctionStorage().setItem(TOURNAMENT_INDEX_KEY, JSON.stringify(index));
    return updated;
}
// Shared by the create and edit tournament dialogs: resize to a small square PNG data URI, same
// approach as the existing team-logo upload (scripts/auction.js handleLogoUpload).
function readResizedTournamentLogo(file, onReady) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 150;
            let width = img.width, height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
            else if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            onReady(canvas.toDataURL('image/png'));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
function renderTournamentLogoBox(elementId, dataUri, onChangeAttr, ariaLabel) {
    const box = document.getElementById(elementId);
    if (!box) return;
    box.innerHTML = (dataUri ? `<img src="${dataUri}" alt="">` : 'ADD<br>LOGO')
        + `<input type="file" aria-label="${escapeHTML(ariaLabel)}" accept="image/*" onchange="${onChangeAttr}">`;
}
let newTournamentLogo = null;
function handleNewTournamentLogo(event) {
    const file = event.target.files[0];
    if (!file) return;
    readResizedTournamentLogo(file, dataUri => {
        newTournamentLogo = dataUri;
        renderTournamentLogoBox('new-tournament-logo-preview', dataUri, 'handleNewTournamentLogo(event)', 'Upload tournament logo');
    });
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
            let icon;
            if (tournament.logo) {
                icon = document.createElement('img'); icon.className = 'tournament-icon'; icon.alt = ''; icon.src = tournament.logo;
                icon.onerror = () => { const fallback = document.createElement('span'); fallback.className = 'tournament-icon'; fallback.textContent = '🏆'; icon.replaceWith(fallback); };
            } else {
                icon = document.createElement('span'); icon.className = 'tournament-icon'; icon.textContent = '🏆';
            }
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
    newTournamentLogo = null;
    renderTournamentLogoBox('new-tournament-logo-preview', null, 'handleNewTournamentLogo(event)', 'Upload tournament logo');
    dialog.showModal(); document.getElementById('new-tournament-name').focus();
}
async function submitTournament(event) {
    event.preventDefault();
    try {
        const tournament = createTournamentRecord(document.getElementById('new-tournament-name').value, newTournamentLogo);
        if (getAuctionStorage().flush) await getAuctionStorage().flush();
        location.href = tournamentUrl(tournament.id);
    } catch (error) { document.getElementById('tournament-form-error').textContent = error.message; }
}

// Backup-file "values" (key -> string, same shape as storage) held only while the import dialog is open.
let importBackupValues = null;
function showImportTournament() {
    importBackupValues = null;
    document.getElementById('import-tournament-file').value = '';
    document.getElementById('import-tournament-error').textContent = '';
    document.getElementById('import-tournament-list').replaceChildren();
    document.getElementById('import-tournament-dialog').showModal();
}
async function handleImportBackupFile(input) {
    const errorEl = document.getElementById('import-tournament-error');
    const listEl = document.getElementById('import-tournament-list');
    errorEl.textContent = ''; listEl.replaceChildren(); importBackupValues = null;
    const file = input.files?.[0];
    if (!file) return;
    try {
        const parsed = JSON.parse(await file.text());
        if (parsed?.format !== 'auction-workspace-v1' || !parsed.values || typeof parsed.values !== 'object') {
            throw new Error('This does not look like a tournament backup file.');
        }
        importBackupValues = parsed.values;
        const tournaments = JSON.parse(importBackupValues['auc_tournaments_v1'] || '[]');
        if (!Array.isArray(tournaments) || !tournaments.length) throw new Error('No tournaments found in this backup.');
        for (const t of tournaments) {
            if (!t?.id || !t.name) continue;
            const row = document.createElement('div'); row.className = 'import-tournament-row';
            const label = document.createElement('span'); label.textContent = t.name;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Import';
            button.onclick = () => importTournamentFromBackup(t.id, t.name, button);
            row.append(label, button); listEl.appendChild(row);
        }
    } catch (error) {
        errorEl.textContent = error.message || 'Could not read this file.';
    }
}
async function importTournamentFromBackup(sourceId, name, button) {
    const errorEl = document.getElementById('import-tournament-error');
    errorEl.textContent = '';
    if (button) button.disabled = true;
    try {
        if (!importBackupValues) throw new Error('Choose a backup file first.');
        const newId = crypto.randomUUID();
        const prefix = tournamentStorageKey(sourceId, '');
        // Fresh room/peer IDs get generated on first use — reusing the backup's would connect a new
        // tournament to an old, unrelated broadcast room.
        const skipSuffixes = ['overlay-peer', 'overview-peer', 'overlayLive-peer'];
        for (const key of Object.keys(importBackupValues)) {
            if (!key.startsWith(prefix) || skipSuffixes.includes(key.slice(prefix.length))) continue;
            getAuctionStorage().setItem(tournamentStorageKey(newId, key.slice(prefix.length)), importBackupValues[key]);
        }
        const index = readTournamentIndex();
        index.push({id: newId, name, createdAt: new Date().toISOString()});
        getAuctionStorage().setItem(TOURNAMENT_INDEX_KEY, JSON.stringify(index));
        if (getAuctionStorage().flush) await getAuctionStorage().flush();
        location.href = tournamentUrl(newId);
    } catch (error) {
        errorEl.textContent = error.message || 'Import failed.';
        if (button) button.disabled = false;
    }
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
            await Account.store.flush();
            // The registry also includes rooms allocated before a browser saved its local link.
            const {data: rooms, error: roomError} = await Account.client.from('auction_live_rooms')
                .select('room_id').eq('tournament_id', id);
            if (roomError || !Array.isArray(rooms)) throw new Error('Could not load the live rooms. Please retry.');
            const {data,error} = await Account.client.auth.getSession();
            if (error || !data.session) throw new Error('Sign in again before deleting.');
            for (const {room_id: room} of rooms) {
                const response = await fetch(`/api/live/${encodeURIComponent(room)}`, {method:'DELETE',headers:{Authorization:`Bearer ${data.session.access_token}`}});
                if (!response.ok) throw new Error('Could not remove all public live rooms. Please retry.');
            }
        }
        deleteTournamentRecord(id);
        if (window.APP_CONFIG?.liveOverview === 'cloudflare') await Account.store.flush();
        initTournamentHome();
        status.textContent = `Deleted “${tournament.name}”.`;
    } catch (error) { status.textContent = `Could not delete tournament: ${error.message}`; }
}
