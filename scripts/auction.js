// ============================================================
//  MODE DETECTION
// ============================================================
const _params = new URLSearchParams(window.location.search);
const _overlayId = _params.get('overlay');
const _overlayLiveId = _params.get('overlayLive');
const _overviewId = _params.get('overview');
const _tournamentId = _params.get('tournament');
let activeTournament = null;
try { activeTournament = readTournamentIndex().find(t => t.id === _tournamentId) || null; } catch (_) {}
const AUCTION_STATE_KEY = tournamentStorageKey(_tournamentId, 'state');
const PLAYER_CACHE_KEY = tournamentStorageKey(_tournamentId, 'players');
const DEFAULT_PLAYER_SHEET_URL = '';
const PLAYER_SHEET_URL_KEY = tournamentStorageKey(_tournamentId, 'sheet');
let sheetPlayers = [];
let overlaySettings = { showBidding:true, teamVisibility:[] };
let currentOverlayPlayer = null;
let overlayAnimationTimer = null;
let overlayMessageActive = false;

// Stable numeric IDs preserve inline card handlers without relying on sheet order.
function stablePlayerId(player) {
    const identity = player.registrationId
        ? ['id', player.registrationId]
        : ['player', player.name.trim().toLowerCase(), player.phone, player.village.toLowerCase(), player.father.toLowerCase()];
    let hash = 2166136261;
    for (const char of JSON.stringify(identity)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash;
}

function reconcilePlayerReferences() {
    for (const record of [...state.teams.flatMap(t => t.playerList), ...state.unsoldPlayers]) {
        const matches = state.playerIdentityVersion === 1
            ? sheetPlayers.filter(p => String(p.id) === String(record.sourceId))
            : sheetPlayers.filter(p => p.name.trim().toLowerCase() === record.name.trim().toLowerCase());
        const match = matches.length === 1 ? matches[0] : null;
        record.sourceSerial = match ? match.serial : null;
        if (match) record.sourceId = String(match.id);
        else if (state.playerIdentityVersion !== 1) record.sourceId = '';
    }
    state.playerIdentityVersion = 1;
}

function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
            else quoted = !quoted;
        } else if (char === ',' && !quoted) {
            row.push(cell); cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(value => value.trim())) rows.push(row);
            row = [];
        } else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

function normaliseRole(role) {
    const value = (role || '').trim().toLowerCase();
    if (value.includes('all')) return 'All-Rounder';
    if (value.includes('ball') || value.includes('bowl')) return 'Bowler';
    if (value.includes('keep')) return 'Wicket-Keeper';
    if (value.includes('bat')) return 'Batsman';
    return (role || 'Player').trim();
}

function driveThumbnail(url) {
    const match = (url || '').match(/(?:[?&]id=|\/file\/d\/)([\w-]+)/);
    // Use the final image host directly. The Drive thumbnail endpoint redirects,
    // and that redirect is rejected when the image is drawn onto a canvas.
    return match ? `https://lh3.googleusercontent.com/d/${match[1]}=w1200` : '';
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function getPlayerStatus(playerName) {
    const soldPlayer = state.teams.flatMap(team => team.playerList).find(player => player.name === playerName);
    if (soldPlayer) return 'sold';
    const unsoldPlayer = state.unsoldPlayers.find(player => player.name === playerName);
    if (unsoldPlayer) return 'unsold';
    return 'available';
}

function getPlayerStatusById(playerId) {
    const id = String(playerId);
    const soldPlayer = state.teams.flatMap(team => team.playerList).find(player => String(player.sourceId ?? '') === id);
    if (soldPlayer) return 'sold';
    const unsoldPlayer = state.unsoldPlayers.find(player => String(player.sourceId ?? '') === id);
    if (unsoldPlayer) return 'unsold';
    return 'available';
}

function directoryPlayerVisible(player) {
    return getPlayerStatusById(player.id) !== 'unsold' || Boolean(document.getElementById('showUnsoldDirectoryPlayers')?.checked);
}

function toggleUnsoldDirectoryPlayers() {
    clearPlayerDirectorySelection();
    buildPlayerDirectoryOptions();
}

function buildPlayerDirectoryOptions() {
    const input = document.getElementById('playerDirectorySelect');
    const datalist = document.getElementById('playerDirectoryOptions');
    if (!input || !datalist) return;
    const currentValue = input.value;
    datalist.innerHTML = '';
    sheetPlayers.filter(directoryPlayerVisible).forEach(player => {
        const status = getPlayerStatusById(player.id);
        const statusLabel = status === 'available' ? 'AVAILABLE' : status === 'sold' ? 'SOLD' : 'UNSOLD';
        const label = formatPlayerDirectoryLabel(player, statusLabel);
        datalist.innerHTML += `<option value="${escapeHTML(label)}"></option>`;
    });
    input.value = currentValue;
}

function syncPlayerDirectoryCards() {
    document.querySelectorAll('.player-card[data-player-id]').forEach(card => {
        const name = card.dataset.playerName || '';
        const status = card.dataset.playerStatus || 'available';
        card.classList.toggle('sold', status === 'sold');
        card.classList.toggle('unsold', status === 'unsold');
        const badge = card.querySelector('.player-status-badge');
        if (badge) {
            badge.textContent = status;
            badge.className = `player-status-badge player-status-${status}`;
        }
        const useLabel = card.querySelector('.player-use');
        if (useLabel) useLabel.textContent = status === 'sold' ? 'Sold in auction' : status === 'unsold' ? 'Marked unsold' : 'Select for auction →';
    });
    buildPlayerDirectoryOptions();
}

function getPlayerSheetUrl() {
    const input = document.getElementById('player-sheet-url');
    if (input && input.value.trim()) return input.value.trim();
    return auctionStorage.getItem(PLAYER_SHEET_URL_KEY) || DEFAULT_PLAYER_SHEET_URL;
}

function setPlayerSheetUrl(url) {
    const input = document.getElementById('player-sheet-url');
    const value = (url || '').trim() || DEFAULT_PLAYER_SHEET_URL;
    if (input) input.value = value;
    auctionStorage.setItem(PLAYER_SHEET_URL_KEY, value);
    return value;
}

function buildSheetCsvUrl(sheetUrl) {
    const source = (sheetUrl || '').trim();
    if (!source) return '';
    if (/format=csv|output=csv/i.test(source)) return source;
    const match = source.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return source;
    const gidMatch = source.match(/[?&#]gid=(\d+)/);
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gidMatch ? `&gid=${gidMatch[1]}` : ''}`;
}

function downloadSheetTemplate() {
    const headers = ['ID', 'Name', 'Photo', 'Village/Locality', 'City', 'Age/DOB', 'Icon type / role', 'Player category'];
    const rows = [
        ['P001', 'Player Name', 'https://drive.google.com/file/d/FILE_ID/view', 'Example Village', 'Example City', '2005-06-15', 'Batsman', 'Senior'],
        ['P002', 'Second Player', '', 'Example Locality', 'Example City', '20', 'Bowler', 'Junior']
    ];
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'player_sheet_template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Age is the age reached during the current calendar year, regardless of birthday.
function playerAge(value, currentYear = new Date().getFullYear()) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (/^\d{1,3}$/.test(text)) return String(Number(text));
    let year, month = 1, day = 1;
    let match;
    if (/^\d{4}$/.test(text)) year = Number(text);
    else if ((match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
        [, year, month, day] = match.map(Number);
    } else if ((match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) {
        [, day, month, year] = match.map(Number);
    } else return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year > currentYear) return '';
    return String(currentYear - year);
}

async function loadSheetPlayers() {
    const list = document.getElementById('players-list');
    const count = document.getElementById('player-count');
    if (!list || !count) return;
    const sheetUrl = setPlayerSheetUrl(getPlayerSheetUrl());
    const csvUrl = buildSheetCsvUrl(sheetUrl);
    list.className = 'players-status';
    list.textContent = 'Loading player registrations…';
    count.textContent = 'Loading…';
    try {
        if (!csvUrl) throw new Error('Please enter a Google Sheet link first.');
        const response = await fetch(`${csvUrl}${csvUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
        if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
        const rows = parseCSV(await response.text());
        if (!rows.length) throw new Error('The sheet is empty.');
        const headerLabels = rows.shift().map(header => header.trim());
        const headers = headerLabels.map(header => header.toLowerCase().replace(/\s*\/\s*/g, '/'));
        const column = (...names) => {
            const exact = headers.findIndex(header => names.includes(header));
            return exact !== -1 ? exact : headers.findIndex(header => names.some(name => header.includes(name)));
        };
        const indexes = {
            registrationId: column('id', 'player id', 'registration id'), panchayat: column('panchayat'),
            village: column('village/locality', 'choose your village', 'village', 'locality'), name: column('name'),
            age: column('age/dob', 'age'), dob: column('dob', 'date of birth'),
            city: column('city'), category: column('player category', 'category'),
            photo: column('profile photo', 'photo'), father: column('father name'), phone: column('phone'),
            jerseySize: column('jersy size', 'jersey size'), role: column('icon type/role', 'icons type', 'icon type', 'role'),
            jerseyName: column('name on jersy', 'name on jersey')
        };
        if (indexes.name < 0) throw new Error('A name column is required.');
        const occurrences = new Map();
        const importedColumns = headerLabels.map((label, index) => {
            const normalized = headers[index];
            const occurrence = (occurrences.get(normalized) || 0) + 1;
            occurrences.set(normalized, occurrence);
            const key = index === indexes.village ? 'village' : index === indexes.panchayat ? 'panchayat' : `column:${normalized}:${occurrence}`;
            return { key, label: occurrence > 1 ? `${label} (${occurrence})` : label, index };
        }).filter(column => column.label);
        const importedPlayers = rows.map(values => ({
            sheetValues: Object.fromEntries(importedColumns.map(column => [column.key, (values[column.index] || '').trim()])),
            registrationId: (values[indexes.registrationId] || '').trim(), panchayat: (values[indexes.panchayat] || '').trim(),
            name: (values[indexes.name] || '').trim(), village: (values[indexes.village] || '').trim(),
            age: playerAge(values[indexes.dob] || values[indexes.age]),
            city: (values[indexes.city] || '').trim(), category: (values[indexes.category] || '').trim(), photo: driveThumbnail(values[indexes.photo]),
            father: (values[indexes.father] || '').trim(), phone: (values[indexes.phone] || '').trim(),
            jerseySize: (values[indexes.jerseySize] || '').trim(), role: normaliseRole(values[indexes.role]),
            jerseyName: (values[indexes.jerseyName] || '').trim()
        })).filter(player => player.name).map((player, index) => {
            for (const column of importedColumns) {
                if (column.index === indexes.age || column.index === indexes.dob) player.sheetValues[column.key] = player.age;
            }
            return { ...player, id: stablePlayerId(player), serial: index + 1 };
        });
        if (new Set(importedPlayers.map(p => p.id)).size !== importedPlayers.length) {
            throw new Error('Duplicate player identities. Add a unique player id column for each registration.');
        }
        state.sheetColumns = importedColumns.map(({key, label, index}) => ({key, label: index === indexes.age || index === indexes.dob ? 'Age' : label}));
        if (!readTournamentIndex().some(t => t.id === _tournamentId)) return;
        auctionStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify(importedPlayers));
        sheetPlayers = importedPlayers;
        reconcilePlayerReferences();
        resetPlayer();
        populatePlayerFilters();
        renderSheetPlayers();
    } catch (error) {
        count.textContent = 'Unavailable';
        list.className = 'players-status players-error';
        list.innerHTML = `Could not load the Google Sheet. Make sure it is shared as <b>Anyone with the link</b>, then try Refresh.<br><small>${escapeHTML(error.message)}</small>`;
    }
}

function populatePlayerFilters() {
    const setOptions = (id, values, label) => {
        const select = document.getElementById(id), current = select.value;
        select.innerHTML = `<option value="">All ${label}</option>` + [...new Set(values.filter(Boolean))]
            .sort((a, b) => a.localeCompare(b)).map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
        select.value = current;
    };
    setOptions('player-role-filter', sheetPlayers.map(player => player.role), 'roles');
    setOptions('player-village-filter', sheetPlayers.map(player => player.village), 'villages');
}

function renderSheetPlayers() {
    const list = document.getElementById('players-list');
    if (!list) return;
    const query = document.getElementById('player-search').value.trim().toLowerCase();
    const role = document.getElementById('player-role-filter').value;
    const village = document.getElementById('player-village-filter').value;
    const visible = sheetPlayers.filter(player => {
        const haystack = `${player.name} ${player.village} ${player.phone} ${player.jerseyName}`.toLowerCase();
        return (!query || haystack.includes(query)) && (!role || player.role === role) && (!village || player.village === village);
    });
    document.getElementById('player-count').textContent = `${visible.length} of ${sheetPlayers.length} players`;
    if (!visible.length) {
        list.className = 'players-status'; list.textContent = 'No players match your filters.'; return;
    }
    list.className = 'players-grid';
    list.innerHTML = visible.map(player => {
        const initial = escapeHTML(player.name.charAt(0).toUpperCase());
        const photo = player.photo ? `<img class="player-avatar" src="${escapeHTML(player.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` : '';
        const fallbackStyle = player.photo ? ' style="display:none"' : '';
        const details = [player.age && `Age ${player.age}`, player.village, player.city, player.category, player.jerseySize && `Jersey ${player.jerseySize}`].filter(Boolean).join(' · ');
        const status = getPlayerStatusById(player.id);
        const statusLabel = status === 'available' ? 'AVAILABLE' : status === 'sold' ? 'SOLD' : 'UNSOLD';
        return `<article class="player-card ${status === 'sold' ? 'sold' : status === 'unsold' ? 'unsold' : ''}" data-player-id="${player.id}" data-player-name="${escapeHTML(player.name)}" data-player-status="${status}" onclick="selectSheetPlayer(${player.id})" title="Use this player in the auction">
            <div class="player-topline">
                <span class="player-serial-badge">SL ${String(player.serial).padStart(2, '0')}</span>
                <span class="player-status-badge player-status-${status}">${statusLabel}</span>
            </div>
            <div>${photo}<div class="player-avatar player-fallback"${fallbackStyle}>${initial}</div></div>
            <div class="player-info"><div class="player-name">${escapeHTML(player.name)}</div>
            <div class="player-meta">${escapeHTML(details || 'Player registration')} · SL ${String(player.serial).padStart(2, '0')}</div>
            ${player.jerseyName ? `<div class="player-meta">Jersey name: ${escapeHTML(player.jerseyName)}</div>` : ''}
            <span class="player-role">${escapeHTML(player.role)}</span><div class="player-use">Select for auction →</div>
            <button class="poster-download" type="button" onclick="event.stopPropagation(); downloadPlayerPoster(${player.id}, this)">↓ Download poster</button></div>
        </article>`;
    }).join('');
    syncPlayerDirectoryCards();
}

function loadPosterImage(url) {
    return new Promise(resolve => {
        if (!url) return resolve(null);
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function drawCoverImage(context, image, x, y, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale, sourceHeight = height / scale;
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    // Keep the top of portrait photos visible and crop any excess from the bottom.
    const sourceY = 0;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawFittedText(context, text, centerX, y, maxWidth, startingSize, minimumSize) {
    let size = startingSize;
    do {
        context.font = `900 ${size}px Arial, sans-serif`;
        if (context.measureText(text).width <= maxWidth) break;
        size -= 2;
    } while (size > minimumSize);
    context.fillText(text, centerX, y);
}

async function downloadPlayerPoster(id, button) {
    const player = sheetPlayers.find(item => item.id === id);
    if (!player || button.classList.contains('busy')) return;
    button.classList.add('busy');
    const originalLabel = button.textContent;
    button.textContent = 'Creating poster…';
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 1000;
        const context = canvas.getContext('2d');
        const posterBackground = context.createLinearGradient(0, 0, canvas.width, canvas.height);
        posterBackground.addColorStop(0, '#0f172a');
        posterBackground.addColorStop(1, '#1e3a8a');
        context.fillStyle = posterBackground;
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.fillStyle = '#fff';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.font = '900 42px Arial, sans-serif';
        context.fillText(`SL:- ${String(player.serial).padStart(2, '0')}`, 20, 55);

        const photo = await loadPosterImage(player.photo);
        if (photo) {
            drawCoverImage(context, photo, 20, 96, 760, 762);
        } else {
            const gradient = context.createLinearGradient(20, 96, 780, 761);
            gradient.addColorStop(0, '#dbeafe'); gradient.addColorStop(1, '#93c5fd');
            context.fillStyle = gradient; context.fillRect(20, 96, 760, 762);
            context.fillStyle = '#1e3a8a'; context.textAlign = 'center'; context.textBaseline = 'middle';
            context.font = '900 210px Arial, sans-serif';
            context.fillText(player.name.charAt(0).toUpperCase(), 400, 477);
        }

        context.fillStyle = '#fff';
        context.textAlign = 'center';
        context.textBaseline = 'alphabetic';
        drawFittedText(context, player.name.toUpperCase(), 400, 916, 750, 58, 30);
        const posterRole = player.role.replace('-', ' ').toUpperCase();
        drawFittedText(context, posterRole, 400, 982, 700, 48, 28);

        const blob = await new Promise((resolve, reject) => {
            try { canvas.toBlob(value => value ? resolve(value) : reject(new Error('Poster export failed')), 'image/jpeg', 0.94); }
            catch (error) { reject(error); }
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${player.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'player'}_poster.jpg`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Poster download failed:', error);
        alert('Could not create this poster. The player photo may not allow downloading; please check its Google Drive sharing permission.');
    } finally {
        button.classList.remove('busy');
        button.textContent = originalLabel;
    }
}

function selectSheetPlayer(id) {
    const player = sheetPlayers.find(item => item.id === id);
    if (!player) return;
    if (getPlayerStatusById(player.id) === 'sold') return;
    document.getElementById('pNameInput').value = player.name;
    document.getElementById('pNameInput').dataset.playerId = String(player.id);
    const type = document.getElementById('pTypeInput');
    if ([...type.options].some(option => option.value === player.role)) type.value = player.role;
    state.currentPlayer = { id: player.id, name: player.name, photo: player.photo || '', role: player.role || 'Player', category: player.category || '', serial: player.serial || null, village:player.village || '', panchayat:player.panchayat || '', introValues: selectedIntroValues(player), photoAlignment: state.photoAlignments?.[String(player.id)] || 'top', phase:'intro' };
    applyPlayerBasePrice(player);
    renderOverlayPlayer(state.currentPlayer);
    if (activeConn) activeConn.send({ type: 'BID_UPDATE', base: state.basePrice, bid: state.currentBid, player: state.currentPlayer });
    saveAndAction();
    document.getElementById('pNameInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('pNameInput').focus({ preventScroll: true });
}

function syncPlayerSelectionToOverlay() {
    const nameInput = document.getElementById('pNameInput');
    const typeInput = document.getElementById('pTypeInput');
    const name = nameInput ? nameInput.value.trim() : '';
    if (nameInput) nameInput.dataset.playerId = '';
    clearPlayerDirectorySelection();
    if (!name) {
        state.currentPlayer = null;
        renderOverlayPlayer(null);
        renderPhotoAlignmentControls();
        if (activeConn) activeConn.send({ type: 'BID_UPDATE', base: state.basePrice, bid: state.currentBid, player: null });
        syncOverview();
        return;
    }
    if (!state.currentPlayer || state.currentPlayer.id !== undefined) applyPlayerBasePrice(null);
    state.currentPlayer = { name, photo: '', role: typeInput ? typeInput.value : 'Player', serial: null, phase:'intro' };
    renderEverything();
    renderPhotoAlignmentControls();
    renderOverlayPlayer(state.currentPlayer);
    if (activeConn) activeConn.send({ type: 'BID_UPDATE', base: state.basePrice, bid: state.currentBid, player: state.currentPlayer });
    syncOverview();
}

function selectAuctionPlayerFromDirectory(id) {
    const player = resolveDirectoryPlayer(id);
    if (!player) return;
    if (getPlayerStatusById(player.id) === 'sold') {
        document.getElementById('playerDirectorySelect').value = '';
        return;
    }
    selectSheetPlayer(player.id);
    document.getElementById('playerDirectorySelect').value = formatPlayerDirectoryLabel(player, getPlayerStatusById(player.id) === 'available' ? 'AVAILABLE' : getPlayerStatusById(player.id) === 'sold' ? 'SOLD' : 'UNSOLD');
}

function formatPlayerDirectoryLabel(player, statusLabel) {
    return `SL ${String(player.serial).padStart(2, '0')} - ${player.name} [${statusLabel}]`;
}

function resolveDirectoryPlayer(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const serialMatch = raw.match(/SL\s*0*(\d+)/i);
    if (serialMatch) {
        const serial = Number(serialMatch[1]);
        const bySerial = sheetPlayers.find(player => directoryPlayerVisible(player) && Number(player.serial) === serial);
        if (bySerial) return bySerial;
    }
    const lower = raw.toLowerCase();
    return sheetPlayers.filter(directoryPlayerVisible).find(player => {
        const status = getPlayerStatusById(player.id);
        const label = formatPlayerDirectoryLabel(player, status === 'available' ? 'AVAILABLE' : status === 'sold' ? 'SOLD' : 'UNSOLD').toLowerCase();
        return label.includes(lower) || player.name.toLowerCase().includes(lower);
    }) || null;
}

if (_overlayId || _overlayLiveId) {
    // ── DISPLAY MODE ──
    document.documentElement.style.cssText = 'width:1920px;height:1080px;';
    document.body.style.cssText = 'width:1920px;height:1080px;background:transparent;overflow:hidden;margin:0;padding:0;';
    document.getElementById('display-app').style.display = 'block';
    if (_overlayId) initDisplayMode(_overlayId); else initDisplayModeCloud(_overlayLiveId);
} else if (_overviewId) {
    // ── OVERVIEW MODE ──
    document.body.style.cssText = 'margin:0;padding:0;background:#0a0b12;min-height:100vh;';
    document.getElementById('overview-app').style.display = 'block';
    initOverviewMode(_overviewId);
} else {
    // ── CONTROLLER MODE ──
    document.body.style.background = '#f0f2f5';
    if (activeTournament) {
        document.getElementById('controller-app').style.display = 'block';
        document.getElementById('active-tournament-name').textContent = activeTournament.name;
        document.getElementById('all-tournaments-link').href = tournamentUrl(null);
        initControllerMode();
    } else {
        document.getElementById('tournament-home').style.display = 'block';
        queueMicrotask(initTournamentHome);
    }
}


// ============================================================
//  DISPLAY MODE
// ============================================================
function renderOverlayPlayer(player) {
    const photoEl = document.getElementById('bid-player-photo');
    const fallbackEl = document.getElementById('bid-player-fallback');
    const nameEl = document.getElementById('bid-player-name');
    const roleEl = document.getElementById('bid-player-role');
    const slEl = document.getElementById('showcase-sl');
    if (!photoEl || !fallbackEl || !nameEl || !roleEl) return;

    photoEl.dataset.verticalAlign = getPhotoAlignment(player);
    if (player && player.name) {
        nameEl.textContent = player.name;
        roleEl.textContent = player.role || 'Player';
        fallbackEl.textContent = String(player.name).trim().charAt(0).toUpperCase() || '?';
        if (slEl) slEl.textContent = player.serial ? `SL:- ${String(player.serial).padStart(2, '0')}` : '';
        if (player.photo) {
            photoEl.src = player.photo;
            photoEl.style.display = 'block';
            fallbackEl.style.display = 'none';
            photoEl.onerror = () => {
                photoEl.style.display = 'none';
                fallbackEl.style.display = 'grid';
            };
        } else {
            photoEl.removeAttribute('src');
            photoEl.style.display = 'none';
            fallbackEl.style.display = 'grid';
        }
    } else {
        nameEl.textContent = 'Player';
        roleEl.textContent = 'Role';
        fallbackEl.textContent = '?';
        if (slEl) slEl.textContent = 'SL:- --';
        photoEl.removeAttribute('src');
        photoEl.style.display = 'none';
        fallbackEl.style.display = 'grid';
    }
}

function resetOverlayPanels() {
    const biddingActive = document.getElementById('bidding-active');
    const biddingSold = document.getElementById('bidding-sold');
    const biddingUnsold = document.getElementById('bidding-unsold');
    const leftPanel = document.getElementById('left-panel');
    if (biddingActive) biddingActive.style.display = 'flex';
    if (biddingSold) biddingSold.style.display = 'none';
    if (biddingUnsold) biddingUnsold.style.display = 'none';
    if (leftPanel) {
        leftPanel.style.opacity = '1';
        leftPanel.style.transform = 'translateY(0)';
    }
}

function handleOverlayData(data) {
    receiveMMM(data);
    if (data.type === 'BID_UPDATE') {
        clearTimeout(overlayAnimationTimer);
        overlayMessageActive = false;
        currentOverlayPlayer = data.player || null;
        updateBidNumbers(data.base, data.bid, currentOverlayPlayer);
        resetOverlayPanels();
        refreshOverlayVisibility();
    }
    if (data.type === 'BACKGROUND_BID_UPDATE') {
        currentOverlayPlayer = data.player || null;
        if (!overlayMessageActive) {
            updateBidNumbers(data.base, data.bid, currentOverlayPlayer);
            resetOverlayPanels();
            refreshOverlayVisibility();
        }
    }
    if (data.type === 'SYNC_ALL') {
        overlaySettings = data.settings || overlaySettings;
        currentOverlayPlayer = data.currentPlayer || null;
        if (overlayMessageActive) {
            // Animation playing — update balance sheet only, leave bidding panel alone
            renderDisplayUI(data.teams, overlaySettings, currentOverlayPlayer, data.base || 0, data.bid || 0, true);
        } else {
            resetOverlayPanels();
            renderDisplayUI(data.teams, overlaySettings, currentOverlayPlayer, data.base || 0, data.bid || 0);
        }
    }
    if (data.type === 'SOLD_CELEBRATION') {
        clearTimeout(overlayAnimationTimer);
        overlayMessageActive = true;
        document.getElementById('bidding-active').style.display = 'none';
        document.getElementById('bidding-unsold').style.display = 'none';
        document.getElementById('bidding-sold').style.display = 'block';
        document.getElementById('res-team').textContent = data.team;
        document.getElementById('res-player').textContent = data.player;
        document.getElementById('res-price').textContent = '₹ ' + data.bid.toLocaleString('en-IN');
        document.getElementById('left-panel').style.opacity = '1';
        document.getElementById('left-panel').style.transform = 'translateY(0)';
        launchSoldParticles();
        overlayAnimationTimer = setTimeout(() => {
            overlayMessageActive = false;
            refreshOverlayVisibility();
        }, 7000);
    }
    if (data.type === 'UNSOLD_ANIMATION') {
        clearTimeout(overlayAnimationTimer);
        overlayMessageActive = true;
        document.getElementById('bidding-active').style.display = 'none';
        document.getElementById('bidding-sold').style.display = 'none';
        document.getElementById('bidding-unsold').style.display = 'block';
        document.getElementById('unsold-player').textContent = data.player;
        document.getElementById('left-panel').style.opacity = '1';
        document.getElementById('left-panel').style.transform = 'translateY(0)';
        overlayAnimationTimer = setTimeout(() => {
            overlayMessageActive = false;
            refreshOverlayVisibility();
        }, 7000);
    }
    if (data.type === 'RESET_VIEW') {
        clearTimeout(overlayAnimationTimer);
        overlayMessageActive = false;
        currentOverlayPlayer = null;
        resetOverlayPanels();
        refreshOverlayVisibility();
    }
}

function initDisplayMode(controllerId) {
    document.getElementById('connecting-status').textContent = 'CONNECTING…';

    const peer = new AuctionPeer();   // display

    peer.on('open', () => {
        const conn = peer.connect(controllerId);

        conn.on('open', () => {
            document.getElementById('connecting-layer').style.display = 'none';
        });

        const retryStatus = () => {
            document.getElementById('connecting-layer').style.display = 'flex';
            document.getElementById('connecting-status').textContent = 'RECONNECTING…';
        };
        conn.on('close', retryStatus);
        conn.on('retry', retryStatus);
        conn.on('data', handleOverlayData);

        conn.on('error', err => {
            console.warn('Display conn error:', err);
            document.getElementById('connecting-status').textContent = 'ERROR';
        });
    });

    peer.on('error', err => {
        console.warn('Display peer error:', err);
        document.getElementById('connecting-status').textContent = 'CONNECTING / RETRYING…';
    });
}

function initDisplayModeCloud(room) {
    document.getElementById('connecting-status').textContent = 'CONNECTING…';
    new CloudOverviewConnection(room, {
        syncType: 'SYNC_ALL',
        deltaType: 'BID_UPDATE',
        emptyMessage: {type:'RESET_VIEW'},
        onData: handleOverlayData,
        onStatus: connected => {
            document.getElementById('connecting-layer').style.display = connected ? 'none' : 'flex';
            document.getElementById('connecting-status').textContent = connected ? 'CONNECTED' : 'RECONNECTING…';
        }
    });
}

function launchSoldParticles() {
    const canvas = document.getElementById('sold-particles');
    const el = document.getElementById('bidding-sold');
    canvas.width = el.offsetWidth;
    canvas.height = el.offsetHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#F0A500','#FFD166','#00C98D','#FFFFFF','#1A6EFF'];
    const particles = Array.from({length: 38}, () => ({
        x: Math.random() * canvas.width,
        y: canvas.height * (0.3 + Math.random() * 0.4),
        vx: (Math.random() - 0.5) * 5,
        vy: -(2 + Math.random() * 5),
        r: 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        rot: Math.random() * Math.PI * 2,
        rSpeed: (Math.random() - 0.5) * 0.3,
        shape: Math.random() > 0.5 ? 'circle' : 'rect'
    }));
    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.18;
            p.alpha -= 0.018; p.rot += p.rSpeed;
            if (p.alpha <= 0) return;
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0,0,p.r,0,Math.PI*2); ctx.fill(); }
            else { ctx.fillRect(-p.r, -p.r/2, p.r*2, p.r); }
            ctx.restore();
        });
        frame++;
        if (frame < 80) requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    draw();
}

function updateBidNumbers(base, bid, player = null) {
    document.getElementById('baseDisplay').textContent = '₹ ' + base.toLocaleString('en-IN');
    document.getElementById('bidDisplay').textContent = '₹ ' + bid.toLocaleString('en-IN');
    renderOverlayPlayer(player);
}

function shouldShowOverlayBidding(player, settings, teamVisibility) {
    const hasSelectedPlayer = !!(player && player.name);
    const hasEnabledTeamDetails = Array.isArray(teamVisibility) && teamVisibility.some(Boolean);
    return hasSelectedPlayer && settings.showBidding && !hasEnabledTeamDetails;
}

function refreshOverlayVisibility() {
    const leftPanel = document.getElementById('left-panel');
    if (!leftPanel) return;
    const shouldShow = shouldShowOverlayBidding(currentOverlayPlayer, overlaySettings, overlaySettings.teamVisibility);
    leftPanel.style.opacity = shouldShow ? '1' : '0';
    leftPanel.style.transform = shouldShow ? 'translateY(0)' : 'translateY(50px)';
    if (!shouldShow) {
        document.getElementById('bidding-active').style.display = 'none';
        document.getElementById('bidding-sold').style.display = 'none';
        document.getElementById('bidding-unsold').style.display = 'none';
    } else {
        document.getElementById('bidding-active').style.display = 'flex';
        document.getElementById('bidding-sold').style.display = 'none';
        document.getElementById('bidding-unsold').style.display = 'none';
    }
}

function resetToActiveBidding() {
    refreshOverlayVisibility();
}

function renderDisplayUI(teams, settings, currentPlayer = null, base = 0, bid = 0, skipBiddingUI = false) {
    const leftPanel = document.getElementById('left-panel');
    const showTeamDetails = Array.isArray(settings.teamVisibility) && settings.teamVisibility.some(Boolean);
    if (!skipBiddingUI) {
        const showBidding = shouldShowOverlayBidding(currentPlayer, settings, settings.teamVisibility);
        if (leftPanel) {
            leftPanel.style.opacity = showBidding ? '1' : '0';
            leftPanel.style.transform = showBidding ? 'translateY(0)' : 'translateY(50px)';
        }
        updateBidNumbers(base, bid, currentPlayer);
    }

    const sheetUi = document.getElementById('sheet-ui');
    const sheetTitle = document.querySelector('.sheet-title');
    const tbody = document.getElementById('balance-body');
    if (sheetTitle) sheetTitle.textContent = showTeamDetails ? 'Team Overview' : 'Balance Sheet';
    if (settings.showPurse || settings.showNames || settings.showTopPlayers || showTeamDetails) sheetUi.classList.add('sheet-visible');
    else sheetUi.classList.remove('sheet-visible');

    tbody.innerHTML = '';
    const visibleTeams = teams.filter((team, index) => Array.isArray(settings.teamVisibility) && settings.teamVisibility[index]);
    if (showTeamDetails && visibleTeams.length) {
        visibleTeams.forEach(team => {
            const badgesHtml = team.playerList.length
                ? team.playerList.map(p => `<span class="player-badge">${escapeHTML(p.name)}</span>`).join('')
                : '<span class="player-badge" style="opacity:0.45">No players yet</span>';
            const logoHtml = team.logo
                ? `<div class="team-logo-wrap"><img src="${team.logo}" class="team-logo"></div>`
                : '';
            tbody.innerHTML += `<tr><td colspan="2"><div class="team-row-top"><div class="team-info-cell">${logoHtml}<div class="team-info"><b>${escapeHTML(team.name)}</b></div></div><span class="purse-val">₹ ${team.purse.toLocaleString('en-IN')}</span></div><div class="player-badges">${badgesHtml}</div></td></tr>`;
        });
    } else {
        teams.forEach((t, index) => {
            const badgesHtml = settings.showNames && t.playerList.length
                ? t.playerList.map(p => `<span class="player-badge">${escapeHTML(p.name)}</span>`).join('')
                : t.playerList.length
                    ? `<span class="player-badge">${t.playerList.length} player${t.playerList.length !== 1 ? 's' : ''}</span>`
                    : '';
            const playerSection = badgesHtml ? `<div class="player-badges">${badgesHtml}</div>` : '';
            const purseHtml = settings.showPurse
                ? `<span class="purse-val">₹ ${t.purse.toLocaleString('en-IN')}</span>`
                : '';
            const logoHtml = t.logo
                ? `<div class="team-logo-wrap"><img src="${t.logo}" class="team-logo"></div>`
                : '';

            tbody.innerHTML += `<tr><td colspan="2"><div class="team-row-top"><div class="team-info-cell">${logoHtml}<div class="team-info"><b>${escapeHTML(t.name)}</b></div></div>${purseHtml}</div>${playerSection}</td></tr>`;
        });
    }

    if (settings.showTopPlayers) {
        const topPlayers = teams.flatMap(team => team.playerList.map(player => ({ team: team.name, ...player })))
            .sort((a, b) => (b.price || 0) - (a.price || 0))
            .slice(0, 10);
        if (topPlayers.length) {
            tbody.innerHTML += `<tr><td colspan="2"><div class="overlay-top-players"><h4>Top 10 players</h4>${topPlayers.map((player, idx) => `<div class="overlay-top-player"><span><strong>#${idx + 1}</strong> ${escapeHTML(player.name)}</span><span>${escapeHTML(player.team)} · ₹ ${player.price.toLocaleString('en-IN')}</span></div>`).join('')}</div></td></tr>`;
        }
    }

    requestAnimationFrame(startBalanceScroll);
}

function startBalanceScroll() {
    const wrap = document.getElementById('balance-scroll-wrap');
    const inner = document.getElementById('balance-scroll-inner');
    if (!wrap || !inner) return;
    inner.style.animation = 'none';
    inner.style.transform = 'translateY(0)';
    requestAnimationFrame(() => {
        const overflow = inner.scrollHeight - wrap.clientHeight;
        if (overflow > 0) {
            const duration = Math.max(12, overflow / 32);
            inner.style.setProperty('--scroll-dist', `-${overflow}px`);
            inner.style.animation = `balanceAutoScroll ${duration}s ease-in-out 2s infinite alternate`;
        }
    });
}

const CONTROLLER_TAB_KEY = tournamentStorageKey(_tournamentId, 'tab');

function switchControllerTab(tab) {
    const panels = document.querySelectorAll('#controller-app .tab-panel');
    const buttons = document.querySelectorAll('#controller-app .controller-tab-btn');
    panels.forEach(panel => {
        panel.hidden = panel.dataset.tabPanel !== tab;
    });
    buttons.forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tab);
    });
    const tabBar = document.querySelector('#controller-app .controller-tabs');
    const activeButton = document.querySelector('#controller-app .controller-tab-btn.active');
    if (tabBar && activeButton && tabBar.scrollWidth > tabBar.clientWidth) {
        tabBar.scrollLeft = Math.max(0, activeButton.offsetLeft - (tabBar.clientWidth - activeButton.offsetWidth) / 2);
    }
    auctionStorage.setItem(CONTROLLER_TAB_KEY, tab);
}

function initControllerTabState() {
    const savedTab = auctionStorage.getItem(CONTROLLER_TAB_KEY) || 'players';
    switchControllerTab(savedTab);
}


// ============================================================
//  CONTROLLER MODE
// ============================================================
function initControllerMode() {
    window.addEventListener('beforeunload', function (e) {
        if (storageWarningShown) { e.preventDefault(); e.returnValue = ''; }
    });

    const initializeController = () => {
        const saved = auctionStorage.getItem(AUCTION_STATE_KEY);
        if (saved) {
            try {
                const restored = JSON.parse(saved);
                if (!restored || !Array.isArray(restored.teams) || !restored.teams.every(t => typeof t.name === 'string' && Number.isSafeInteger(t.maxPurse) && t.maxPurse >= 0 && Array.isArray(t.playerList) && t.playerList.every(p => typeof p.name === 'string' && Number.isSafeInteger(p.price) && p.price >= 0))) throw new Error('Invalid auction data');
                state = restored;
                state.currentBid = Number.isSafeInteger(state.currentBid) && state.currentBid >= 0 ? state.currentBid : 0;
                state.basePrice = Number.isSafeInteger(state.basePrice) && state.basePrice >= 0 ? state.basePrice : 0;
            } catch (error) {
                try { auctionStorage.setItem(AUCTION_STATE_KEY + '_recovery', saved); } catch (_) {}
                alert('Saved auction data could not be loaded. A recovery copy was attempted for this tournament.');
                initTeams();
            }
            if (!state.settings) state.settings = { showPurse: true, showNames: true, showBidding: true, showTopPlayers: false, teamVisibility: [] };
            if (!state.settings.teamVisibility) state.settings.teamVisibility = [];
            if (!state.settings.showTopPlayers) state.settings.showTopPlayers = false;
            if (!Array.isArray(state.unsoldPlayers)) state.unsoldPlayers = [];
            if (!state.globalSeq) state.globalSeq = 1;
            pushHistory();
        } else {
            initTeams();
        }
        setPlayerSheetUrl(auctionStorage.getItem(PLAYER_SHEET_URL_KEY) || DEFAULT_PLAYER_SHEET_URL);
        try { sheetPlayers = JSON.parse(auctionStorage.getItem(PLAYER_CACHE_KEY) || '[]'); if (!Array.isArray(sheetPlayers)) sheetPlayers = []; } catch (_) { sheetPlayers = []; }
        document.getElementById('teamCount').value = state.teams.length;
        if (state.currentPlayer) {
            const player = sheetPlayers.find(p => p.id === state.currentPlayer.id);
            document.getElementById('pNameInput').value = state.currentPlayer.name || '';
            document.getElementById('pNameInput').dataset.playerId = player ? String(player.id) : '';
            document.getElementById('pTypeInput').value = state.currentPlayer.role || 'Batsman';
        }
        initControllerTabState();
        renderEverything();
        syncToDisplay();
        syncOverview();
        if (sheetPlayers.length) { populatePlayerFilters(); renderSheetPlayers(); }
        else if (getPlayerSheetUrl()) loadSheetPlayers();
        else {
            document.getElementById('players-list').textContent = 'Add a Google Sheet link and click Refresh to load this tournament’s players.';
            document.getElementById('player-count').textContent = '0 players';
        }
    };
    if (document.readyState === 'complete') queueMicrotask(initializeController);
    else window.addEventListener('load', initializeController, {once:true});
}

let state = {
    globalSeq: 1,
    teams: [],
    currentBid: 0,
    basePrice: 0,
    currentPlayer: null,
    settings: { showPurse: true, showNames: true, showBidding: true, showTopPlayers: false, teamVisibility: [] },
    unsoldPlayers: []
};

let storageWarningShown = false;
let auctionHistory = [];
let auctionHistoryStep = -1;
const overlayConnections = new Set();
let cloudOverlay = null;
const activeConn = {
    send(data) {
        for (const conn of overlayConnections) {
            if (!conn.open) continue;
            try { conn.send(data); } catch (error) { console.warn('Overlay send failed:', error); }
        }
        if (cloudOverlay) cloudOverlay.send(data);
    }
};
let overlayUrl = '';
let overlayLiveUrl = '';
let overviewUrl = '';
let overviewConns = [];
let cloudOverview = null;

if (!_overlayId && !_overlayLiveId && !_overviewId && activeTournament) {
// Controller peers – only created in controller mode
const ctrlPeer = new AuctionPeer(tournamentPeerId(activeTournament.id, 'overlay'));
ctrlPeer.on('open', id => {
    overlayUrl = `${window.location.origin}${window.location.pathname}?overlay=${id}`;
    const urlBox = document.getElementById('overlay-url-display');
    const copyBtn = document.getElementById('copyLinkBtn');
    if (urlBox) urlBox.textContent = overlayUrl;
    if (copyBtn) copyBtn.disabled = false;
});
ctrlPeer.on('connection', conn => {
    const updateStatus = () => {
        const statusEl = document.getElementById('ctrl-status');
        const count = [...overlayConnections].filter(c => c.open).length;
        if (statusEl) {
            statusEl.textContent = count ? `Status: ${count} display(s) connected` : 'Status: Display Disconnected';
            statusEl.style.color = count ? 'green' : 'red';
        }
    };
    conn.on('open', () => { overlayConnections.add(conn); updateStatus(); syncToDisplay(); sendBidOnly(); });
    const remove = () => { overlayConnections.delete(conn); updateStatus(); };
    conn.on('close', remove);
    conn.on('error', remove);
});
ctrlPeer.on('error', err => console.warn('Controller peer error:', err));

if (window.APP_CONFIG?.liveOverview === 'cloudflare') {
    document.getElementById('overlay-live-card').style.display = '';
    cloudTournamentRoom(activeTournament.id, 'overlayLive').then(liveRoom => {
        overlayLiveUrl = `${window.location.origin}${window.location.pathname}?overlayLive=${liveRoom}`;
        const urlBox = document.getElementById('overlay-live-url-display');
        const copyBtn = document.getElementById('copyOverlayLiveLinkBtn');
        if (urlBox) urlBox.textContent = overlayLiveUrl;
        if (copyBtn) copyBtn.disabled = false;
        cloudOverlay = new CloudOverviewConnection(liveRoom, {
            publisher: true,
            syncType: 'SYNC_ALL',
            deltaType: 'BID_UPDATE',
            emptyMessage: {type:'RESET_VIEW'},
            snapshot: conn => syncToDisplay(conn),
            onStatus: (_, text) => {
                const statusEl = document.getElementById('overlay-live-conn-status');
                if (statusEl) statusEl.textContent = text;
            }
        });
    }).catch(error => { document.getElementById('overlay-live-conn-status').textContent = error.message; });
}

let overviewPeer;
if (window.APP_CONFIG?.liveOverview === 'cloudflare') {
    overviewPeer = {destroy:()=>cloudOverview?.close()};
    cloudTournamentRoom(activeTournament.id, 'overview').then(room => {
        overviewUrl = `${window.location.origin}${window.location.pathname}?overview=${room}`;
        document.getElementById('overview-url-display').textContent = overviewUrl;
        document.getElementById('copyOverviewLinkBtn').disabled = false;
        cloudOverview = new CloudOverviewConnection(room, {
            publisher: true,
            snapshot: conn => sendOverviewSync(conn),
            onStatus: (_, text) => { document.getElementById('overview-conn-status').textContent = text; }
        });
    }).catch(error => { document.getElementById('overview-conn-status').textContent = error.message; });
} else {
overviewPeer = new AuctionPeer(tournamentPeerId(activeTournament.id, 'overview'));
overviewPeer.on('open', id => {
    overviewUrl = `${window.location.origin}${window.location.pathname}?overview=${id}`;
    const urlBox = document.getElementById('overview-url-display');
    const copyBtn = document.getElementById('copyOverviewLinkBtn');
    if (urlBox) urlBox.textContent = overviewUrl;
    if (copyBtn) copyBtn.disabled = false;
});
overviewPeer.on('connection', conn => {
    overviewConns.push(conn);
    const statusEl = document.getElementById('overview-conn-status');
    const updateStatus = () => {
        if (statusEl) statusEl.textContent = overviewConns.length
            ? `${overviewConns.length} viewer${overviewConns.length !== 1 ? 's' : ''} connected`
            : 'No viewers connected';
    };
    updateStatus();
    conn.on('open', () => sendOverviewSync(conn));
    conn.on('close', () => {
        overviewConns = overviewConns.filter(c => c !== conn);
        updateStatus();
    });
});
overviewPeer.on('error', err => console.warn('Overview peer error:', err));
}
window.addEventListener('storage', event => {
    if (event.key !== TOURNAMENT_INDEX_KEY) return;
    if (!readTournamentIndex().some(t => t.id === activeTournament.id)) {
        ctrlPeer.destroy(); overviewPeer.destroy();
        if (cloudOverlay) cloudOverlay.close();
        storageWarningShown = false;
        location.replace(tournamentUrl(null));
    }
});
} // end if (!_overlayId && !_overlayLiveId && !_overviewId)

function copyOverlayLink() {
    if (!overlayUrl) return;
    navigator.clipboard.writeText(overlayUrl).then(() => {
        const fb = document.getElementById('copy-feedback');
        if (fb) { fb.classList.add('show'); setTimeout(() => fb.classList.remove('show'), 2000); }
    });
}

function copyOverlayLiveLink() {
    if (!overlayLiveUrl) return;
    navigator.clipboard.writeText(overlayLiveUrl).then(() => {
        const fb = document.getElementById('copy-overlay-live-feedback');
        if (fb) { fb.classList.add('show'); setTimeout(() => fb.classList.remove('show'), 2000); }
    });
}

function copyOverviewLink() {
    if (!overviewUrl) return;
    navigator.clipboard.writeText(overviewUrl).then(() => {
        const fb = document.getElementById('copy-overview-feedback');
        if (fb) { fb.classList.add('show'); setTimeout(() => fb.classList.remove('show'), 2000); }
    });
}

function sendOverviewSync(conn) {
    if (!conn) return;
    try {
        const soldSerials = state.teams.flatMap(t => t.playerList.map(p => p.sourceSerial)).filter(s => s !== null && s !== undefined);
        const unsoldSerials = state.unsoldPlayers.map(p => p.sourceSerial).filter(s => s !== null && s !== undefined);
        conn.send({
            type: 'OVERVIEW_SYNC',
            introFields: getMMMIntroFields(state.settings),
            teams: state.teams.map(t => ({
                name: t.name,
                logo: t.logo,
                maxPurse: t.maxPurse,
                purse: t.maxPurse - t.playerList.reduce((s, p) => s + p.price, 0),
                playerList: t.playerList.map(p => ({
                    name: p.name,
                    price: p.price,
                    type: p.type || '',
                    sourceSerial: p.sourceSerial,
                    photo: (sheetPlayers.find(sp => sp.id == p.sourceId) || {}).photo || ''
                }))
            })),
            allPlayers: sheetPlayers.map(p => ({
                id: p.id,
                serial: p.serial,
                name: p.name,
                role: p.role || 'Player',
                photo: p.photo || ''
            })),
            soldSerials,
            unsoldSerials,
            currentPlayer: state.currentPlayer || null,
            base: state.basePrice || 0,
            bid: state.currentBid || 0
        });
    } catch (e) {
        console.warn('sendOverviewSync error:', e);
    }
}

function syncOverview() {
    if (cloudOverview) sendOverviewSync(cloudOverview);
    overviewConns.forEach(c => sendOverviewSync(c));
}

// ============================================================
//  OVERVIEW MODE  (team-owner mobile view)
// ============================================================
let ovData = null;
let ovPlayerFilter = 'all';
let ovPlayerSearch = '';
let ovLiveLastPlayer = null;
let ovLiveResult = null;
let ovLiveResultTimer = null;

function handleOverviewUpdate(data) {
    if (data.type === 'OVERVIEW_SYNC') {
        ovData = data;
        renderPlayersPane(data);
        renderTeamsPane(data);
        handleOvLiveSync(data);
    } else if (data.type === 'OVERVIEW_BID') {
        handleOvLiveBid(data);
    }
}

function initOverviewMode(peerId) {
    if (window.APP_CONFIG?.liveOverview === 'cloudflare') {
        new CloudOverviewConnection(peerId, {
            onStatus: (connected, text) => {
                const dot = document.getElementById('ov-conn-dot');
                dot.classList.toggle('connected', connected);
                document.getElementById('ov-live-status').textContent = text;
            },
            onData: handleOverviewUpdate
        });
        return;
    }
    const peer = new AuctionPeer();
    peer.on('open', () => {
        const conn = peer.connect(peerId);
        const dot = document.getElementById('ov-conn-dot');
        conn.on('open', () => {
            if (dot) dot.classList.add('connected');
        });
        conn.on('data', handleOverviewUpdate);
        conn.on('close', () => { if (dot) dot.classList.remove('connected'); });
        conn.on('error', () => { if (dot) dot.classList.remove('connected'); });
    });
    peer.on('error', err => {
        console.warn('Overview peer error:', err);
        const dot = document.getElementById('ov-conn-dot');
        if (dot) dot.classList.remove('connected');
    });
}

function switchOvTab(tab) {
    for (const name of ['players', 'teams', 'live']) {
        document.getElementById(`ov-${name}-pane`).classList.toggle('active', tab === name);
        document.getElementById(`ov-tab-${name}`).classList.toggle('active', tab === name);
    }
}

function handleOvLiveSync(data) {
    ovData = data;
    const soldSet = new Set(data.soldSerials || []);
    const unsoldSet = new Set(data.unsoldSerials || []);
    const player = data.currentPlayer;
    if (player && player.name) {
        if (ovLiveResultTimer) { clearTimeout(ovLiveResultTimer); ovLiveResultTimer = null; }
        ovLiveResult = null;
        ovLiveLastPlayer = player;
    } else if (ovLiveLastPlayer && ovLiveLastPlayer.serial !== null && ovLiveLastPlayer.serial !== undefined) {
        const serial = ovLiveLastPlayer.serial;
        if (soldSet.has(serial)) {
            const info = buildSoldLookup(data.teams)[serial] || {};
            ovLiveResult = { phase: 'sold', player: ovLiveLastPlayer, team: info.teamName || '', price: info.price || 0 };
            armOvLiveResultTimer();
        } else if (unsoldSet.has(serial)) {
            ovLiveResult = { phase: 'unsold', player: ovLiveLastPlayer };
            armOvLiveResultTimer();
        }
        ovLiveLastPlayer = null;
    }
    renderLiveAuctionPane(data);
}

function handleOvLiveBid(data) {
    ovData = {...(ovData || {}), currentPlayer:data.player, base:data.base, bid:data.bid,
        introFields:data.introFields ?? ovData?.introFields};
    if (data.player && data.player.name) {
        // Player selection can arrive as a compact delta during a result reveal.
        if (ovLiveResultTimer) clearTimeout(ovLiveResultTimer);
        ovLiveResultTimer = null;
        ovLiveResult = null;
    }
    if (ovLiveResult) return;
    if (data.player && data.player.name) ovLiveLastPlayer = data.player;
    renderLiveAuctionPane({ currentPlayer: data.player, base: data.base, bid: data.bid, introFields: data.introFields });
}

function armOvLiveResultTimer() {
    ovLiveResultTimer = setTimeout(() => {
        ovLiveResult = null;
        ovLiveResultTimer = null;
        renderLiveAuctionPane(ovData || {});
    }, 7000);
}

function renderLiveAuctionPane(data) {
    const el = document.getElementById('ov-live-pane');
    if (!el) return;
    if (ovLiveResult) {
        el.innerHTML = renderOvLiveResultHtml(ovLiveResult);
        return;
    }
    const player = data?.currentPlayer;
    if (!player || !player.name) {
        el.innerHTML = `<div class="ov-empty">No player is currently up for auction.</div>`;
        return;
    }
    el.innerHTML = renderOvLiveStageHtml(player, data.base, data.bid, data.introFields ?? ovData?.introFields);
}

function renderOvLivePhotoHtml(player, wrapClass, fallbackClass) {
    const initial = escapeHTML((player.name || '?').trim().charAt(0).toUpperCase());
    const photo = player.photo
        ? `<img src="${escapeHTML(player.photo)}" alt="${escapeHTML(player.name)}" style="object-position:center ${getPhotoAlignment(player)}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
    return `<div class="${wrapClass}">${photo}<div class="${fallbackClass}" style="${player.photo ? 'display:none' : 'display:flex'}">${initial}</div></div>`;
}

function renderOvLiveStageHtml(player, base, bid, introFields) {
    const facts = getMMMIntroFacts(player, { introFields: introFields ?? ovData?.introFields }, base);
    const photoHtml = renderOvLivePhotoHtml(player, 'ov-live-stage-photo-wrap', 'ov-live-stage-fallback');
    return `<div class="ov-live-stage">
        ${photoHtml}
        <div>
            <div class="ov-live-stage-name">${escapeHTML(player.name)}</div>
            <div class="ov-live-stage-role">${escapeHTML(player.role || 'Player')}</div>
        </div>
        <dl class="ov-live-stage-facts">${facts.map(fact => `<div><dt>${escapeHTML(fact.label)}</dt><dd>${escapeHTML(fact.value)}</dd></div>`).join('')}</dl>
        <div class="ov-live-stage-amounts">
            <div class="bid-card"><div class="d-label">Base Price</div><div class="d-value">₹ ${Number(base || 0).toLocaleString('en-IN')}</div></div>
            <div class="bid-card current"><div class="d-label blue">Current Bid</div><div class="d-value">₹ ${Number(bid || base || 0).toLocaleString('en-IN')}</div></div>
        </div>
    </div>`;
}

function renderOvLiveResultHtml(result) {
    const { phase, player, team, price } = result;
    const photoHtml = renderOvLivePhotoHtml(player, 'ov-live-result-photo-wrap', 'ov-live-result-fallback');
    if (phase === 'sold') {
        return `<div class="ov-live-result ov-live-result-sold">
            <div class="sold-header"><div class="sold-word">SOLD</div><div class="sold-divider"></div></div>
            ${photoHtml}
            <div class="ov-live-result-team">${escapeHTML(team || '—')}</div>
            <div class="sold-meta">${escapeHTML(player.name)} &nbsp;·&nbsp; ₹ ${Number(price || 0).toLocaleString('en-IN')}</div>
        </div>`;
    }
    return `<div class="ov-live-result ov-live-result-unsold">
        <div class="unsold-header"><div class="unsold-word">UNSOLD</div><div class="unsold-divider"></div></div>
        ${photoHtml}
        <div class="ov-live-result-player">${escapeHTML(player.name)}</div>
        <div class="unsold-sub">Not acquired this round</div>
    </div>`;
}

function setOvFilter(f) {
    ovPlayerFilter = f;
    if (ovData) renderPlayersPane(ovData);
}

function buildSoldLookup(teams = []) {
    // sourceSerial -> { teamName, price }
    const soldLookup = {};
    teams.forEach(t => {
        t.playerList.forEach(p => {
            if (p.sourceSerial !== null && p.sourceSerial !== undefined) {
                soldLookup[p.sourceSerial] = { teamName: t.name, price: p.price };
            }
        });
    });
    return soldLookup;
}

function renderPlayersPane(data) {
    const { allPlayers = [], teams = [], soldSerials = [], unsoldSerials = [] } = data;
    const soldSet = new Set(soldSerials);
    const unsoldSet = new Set(unsoldSerials);
    const soldLookup = buildSoldLookup(teams);

    const soldCount = allPlayers.filter(p => soldSet.has(p.serial)).length;
    const unsoldCount = allPlayers.filter(p => unsoldSet.has(p.serial)).length;
    const availCount = allPlayers.length - soldCount - unsoldCount;

    const search = ovPlayerSearch.toLowerCase();
    let filtered = allPlayers.filter(p => {
        if (ovPlayerFilter === 'sold') return soldSet.has(p.serial);
        if (ovPlayerFilter === 'unsold') return unsoldSet.has(p.serial);
        if (ovPlayerFilter === 'available') return !soldSet.has(p.serial) && !unsoldSet.has(p.serial);
        return true;
    });
    if (search) filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(search) || (p.role || '').toLowerCase().includes(search)
    );

    const statsHtml = `<div class="ov-stats">
        <div class="ov-stat ov-stat-sold"><div class="ov-stat-num">${soldCount}</div><div class="ov-stat-label">Sold</div></div>
        <div class="ov-stat ov-stat-unsold"><div class="ov-stat-num">${unsoldCount}</div><div class="ov-stat-label">Unsold</div></div>
        <div class="ov-stat ov-stat-avail"><div class="ov-stat-num">${availCount}</div><div class="ov-stat-label">Available</div></div>
    </div>`;

    const chipLabels = { all: `All (${allPlayers.length})`, sold: 'Sold', unsold: 'Unsold', available: 'Available' };
    const chipsHtml = Object.entries(chipLabels).map(([f, label]) =>
        `<button class="ov-chip ${ovPlayerFilter === f ? 'active' : ''}" onclick="setOvFilter('${f}')">${label}</button>`
    ).join('');

    const cardsHtml = filtered.length ? filtered.map(p => {
        const sold = soldSet.has(p.serial);
        const unsold = unsoldSet.has(p.serial);
        const si = sold ? soldLookup[p.serial] : null;
        const photoHtml = p.photo
            ? `<img class="ov-player-photo" src="${escapeHTML(p.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : '';
        const fallbackHtml = `<div class="ov-player-fallback" style="${p.photo ? 'display:none' : ''}">${escapeHTML(p.name.trim().charAt(0).toUpperCase())}</div>`;
        const badgeHtml = sold
            ? `<span class="ov-badge ov-badge-sold">Sold</span>`
            : unsold
                ? `<span class="ov-badge ov-badge-unsold">Unsold</span>`
                : `<span class="ov-badge ov-badge-available">Available</span>`;
        return `<div class="ov-player-card">
            ${photoHtml}${fallbackHtml}
            <div class="ov-player-info">
                <div class="ov-player-name">${escapeHTML(p.name)}</div>
                <div class="ov-player-role">${escapeHTML(p.role || 'Player')}</div>
                ${si ? `<div class="ov-player-team">${escapeHTML(si.teamName)}</div>` : ''}
            </div>
            <div class="ov-player-right">
                ${badgeHtml}
                ${si ? `<div class="ov-sold-price">₹ ${si.price.toLocaleString('en-IN')}</div>` : ''}
            </div>
        </div>`;
    }).join('') : `<div class="ov-empty">No players found</div>`;

    const el = document.getElementById('ov-players-pane');
    el.innerHTML = statsHtml
        + `<input class="ov-search" type="search" placeholder="Search players…" value="${escapeHTML(ovPlayerSearch)}" oninput="ovPlayerSearch=this.value;if(ovData)renderPlayersPane(ovData)">`
        + `<div class="ov-filters">${chipsHtml}</div>`
        + `<div class="ov-player-list">${cardsHtml}</div>`;
}

function renderTeamsPane(data) {
    const { teams = [] } = data;
    const el = document.getElementById('ov-teams-pane');
    if (!teams.length) {
        el.innerHTML = `<div class="ov-empty">No teams configured yet</div>`;
        return;
    }
    const teamsHtml = teams.map(t => {
        const logoHtml = t.logo
            ? `<img class="ov-team-logo" src="${escapeHTML(t.logo)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="ov-team-logo-initial" style="display:none">${escapeHTML(t.name.trim().charAt(0).toUpperCase())}</div>`
            : `<div class="ov-team-logo-initial">${escapeHTML(t.name.trim().charAt(0).toUpperCase())}</div>`;
        const playersHtml = t.playerList.length
            ? t.playerList.map(p => `<div class="ov-team-player-row">
                <div class="ov-team-player-name">${escapeHTML(p.name)}</div>
                ${p.type ? `<span class="ov-team-player-role">${escapeHTML(p.type)}</span>` : ''}
                <div class="ov-team-player-price">₹ ${p.price.toLocaleString('en-IN')}</div>
            </div>`).join('')
            : `<div class="ov-no-players">No players yet</div>`;
        return `<div class="ov-team-card">
            <div class="ov-team-header">
                <div class="ov-team-logo-wrap">${logoHtml}</div>
                <div class="ov-team-info">
                    <div class="ov-team-name">${escapeHTML(t.name)}</div>
                    <div class="ov-team-meta">${t.playerList.length} player${t.playerList.length !== 1 ? 's' : ''} bought</div>
                </div>
                <div>
                    <div class="ov-team-purse">₹ ${(t.purse || 0).toLocaleString('en-IN')}</div>
                    <div class="ov-team-purse-label">Purse left</div>
                </div>
            </div>
            <div class="ov-team-players">${playersHtml}</div>
        </div>`;
    }).join('');
    el.innerHTML = `<div class="ov-team-list">${teamsHtml}</div>`;
}

function factoryReset() {
    if (confirm("⚠️ WARNING: Are you sure you want to completely reset the auction?\n\nThis will reset teams, auction results, logos, and display settings for this tournament only. This action CANNOT be undone!")) {
        auctionStorage.removeItem(AUCTION_STATE_KEY);
        auctionHistory = []; auctionHistoryStep = -1;
        document.getElementById('teamCount').value = 4;
        document.getElementById('basePriceInput').value = 0;
        document.getElementById('customStepInput').value = 50000;
        state.currentPlayer = null;
        document.getElementById('pNameInput').value = '';
        document.getElementById('pNameInput').dataset.playerId = '';
        state.photoAlignments = {};
        state.globalBasePrice = 0;
        state.basePriceMode = 'global';
        state.categoryBasePrices = {};
        state.bidRanges = [];
        state.bidIncrement = 50000;
        state.currentBid = 0;
        state.basePrice = 0;
        state.settings = { showPurse: true, showNames: true, showBidding: true, showTopPlayers: false, teamVisibility: [] };
        initTeams();
        if (activeConn) { activeConn.send({ type: 'RESET_VIEW' }); syncToDisplay(); sendBidOnly(); }
        alert("✅ All data has been successfully reset.");
    }
}

function initTeams() {
    const count = document.getElementById('teamCount').value;
    const previousVisibility = Array.isArray(state.settings.teamVisibility) ? state.settings.teamVisibility : [];
    state.teams = [];
    state.unsoldPlayers = [];
    state.globalSeq = 1;
    for (let i = 0; i < count; i++) {
        state.teams.push({ name: `Team ${i+1}`, maxPurse: 10000000, logo: null, playerList: [] });
    }
    state.settings.teamVisibility = Array.from({ length: count }, (_, i) => Boolean(previousVisibility[i]));
    saveAndAction();
}

function saveAndAction() {
    if (auctionHistoryStep < auctionHistory.length - 1) auctionHistory = auctionHistory.slice(0, auctionHistoryStep + 1);
    pushHistory();
    renderEverything();
    syncToDisplay();
    syncOverview();
}

function pushHistory() {
    auctionHistory.push(JSON.stringify(state));
    auctionHistoryStep++;
    updateUndoRedoButtons();
}

function undo() {
    if (auctionHistoryStep > 0) {
        auctionHistoryStep--;
        state = JSON.parse(auctionHistory[auctionHistoryStep]);
        if (sheetPlayers.length) reconcilePlayerReferences();
        renderEverything(); syncToDisplay(); syncOverview(); updateUndoRedoButtons(); sendBidOnly();
    }
}

function redo() {
    if (auctionHistoryStep < auctionHistory.length - 1) {
        auctionHistoryStep++;
        state = JSON.parse(auctionHistory[auctionHistoryStep]);
        if (sheetPlayers.length) reconcilePlayerReferences();
        renderEverything(); syncToDisplay(); syncOverview(); updateUndoRedoButtons(); sendBidOnly();
    }
}

function updateUndoRedoButtons() {
    document.getElementById('undoBtn').disabled = auctionHistoryStep <= 0;
    document.getElementById('redoBtn').disabled = auctionHistoryStep >= auctionHistory.length - 1;
}

function clearPlayerDirectorySelection() {
    const select = document.getElementById('playerDirectorySelect');
    if (select) select.value = '';
}

function selectedIntroValues(player) {
    return Object.fromEntries(getMMMIntroFields(state.settings).filter(field => field.key !== 'basePrice').map(field => [field.key,
        player.sheetValues?.[field.key] ?? (field.key === 'village' ? player.village : field.key === 'panchayat' ? player.panchayat : '') ?? ''
    ]));
}

function renderIntroFieldControls() {
    const container = document.getElementById('intro-field-controls');
    if (!container) return;
    const choices = new Map([{key:'basePrice',label:'Base price'}, ...(state.sheetColumns || [])].map(field => [field.key, field]));
    const rawSelected = getMMMIntroFields(state.settings);
    const selected = rawSelected.filter(item => choices.has(item.key));
    if (selected.length !== rawSelected.length) state.settings.introFields = selected;
    container.replaceChildren();
    for (const field of choices.values()) {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0;font-size:13px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.cssText = 'width:auto;margin:0';
        checkbox.checked = selected.some(item => item.key === field.key);
        checkbox.onchange = () => {
            const fields = getMMMIntroFields(state.settings).filter(item => item.key !== field.key);
            if (checkbox.checked) fields.push({key:field.key, label:field.label});
            state.settings.introFields = fields;
            const playerId = document.getElementById('pNameInput').dataset.playerId;
            const player = sheetPlayers.find(item => String(item.id) === playerId);
            if (state.currentPlayer && player) state.currentPlayer.introValues = selectedIntroValues(player);
            saveAndAction();
        };
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(field.label));
        container.appendChild(label);
    }
}

function updatePhotoAlignment(alignment) {
    if (!['top','center','bottom'].includes(alignment) || !state.currentPlayer) return;
    state.currentPlayer.photoAlignment = alignment;
    if (state.currentPlayer.id !== undefined && state.currentPlayer.id !== null) {
        if (!state.photoAlignments) state.photoAlignments = {};
        state.photoAlignments[String(state.currentPlayer.id)] = alignment;
    }
    saveAndAction();
}

function renderPhotoAlignmentControls() {
    const player = state.currentPlayer;
    document.querySelectorAll('[data-photo-align]').forEach(button => {
        button.disabled = !player;
        button.setAttribute('aria-pressed', String(button.dataset.photoAlign === getPhotoAlignment(player)));
    });
    document.getElementById('photo-alignment-status').textContent = player
        ? `Photo position for ${player.name}` : 'Select a player to adjust their overlay photo.';
}

function updateSettings() {
    state.settings.theme = document.getElementById('overlayTheme').value;
    state.settings.isplView = document.getElementById('isplView').value;
    state.settings.showPurse = document.getElementById('setPurse').checked;
    state.settings.showNames = document.getElementById('setNames').checked;
    state.settings.showBidding = document.getElementById('setBidding').checked;
    state.settings.showTopPlayers = document.getElementById('setTopPlayers').checked;
    saveAndAction();
}

function updateOverlayTeamVisibility(teamIdx, checked) {
    if (!Array.isArray(state.settings.teamVisibility)) state.settings.teamVisibility = [];
    state.settings.teamVisibility[teamIdx] = checked;
    saveAndAction();
}

function renderEverything() {
    document.getElementById('customStepInput').value = state.bidIncrement || 50000;
    document.getElementById('overlayTheme').value = ['mmm','ispl'].includes(state.settings.theme) ? state.settings.theme : 'classic';
    document.getElementById('ispl-controls').hidden = state.settings.theme !== 'ispl';
    document.getElementById('isplView').value = state.settings.isplView || 'player';
    renderSetup();
    renderPricingSetup();
    renderDropdown();
    renderDashboard();
    renderUnsoldDashboard();
    buildPlayerDirectoryOptions();
    renderOverlayTeamToggles();
    renderIntroFieldControls();
    renderPhotoAlignmentControls();
    document.getElementById('curBidLabel').textContent = "₹ " + state.currentBid.toLocaleString('en-IN');
    document.getElementById('manualBidEdit').value = state.currentBid;
    if (document.getElementById('basePriceInput')) document.getElementById('basePriceInput').value = state.globalBasePrice ?? state.basePrice ?? 0;
    if (document.getElementById('setPurse')) document.getElementById('setPurse').checked = state.settings.showPurse;
    if (document.getElementById('setNames')) document.getElementById('setNames').checked = state.settings.showNames;
    if (document.getElementById('setBidding')) document.getElementById('setBidding').checked = state.settings.showBidding;
    if (document.getElementById('setTopPlayers')) document.getElementById('setTopPlayers').checked = !!state.settings.showTopPlayers;
    try {
        if (!readTournamentIndex().some(t => t.id === _tournamentId)) { location.replace(tournamentUrl(null)); return; }
        auctionStorage.setItem(AUCTION_STATE_KEY, JSON.stringify(state));
        storageWarningShown = false;
    } catch (error) {
        if (!storageWarningShown) alert('Changes could not be saved in this browser. Keep this page open and export your results before leaving.');
        storageWarningShown = true;
    }
}

function renderOverlayTeamToggles() {
    const container = document.getElementById('overlay-team-toggles');
    if (!container) return;
    if (!Array.isArray(state.settings.teamVisibility)) state.settings.teamVisibility = [];
    while (state.settings.teamVisibility.length < state.teams.length) state.settings.teamVisibility.push(false);
    while (state.settings.teamVisibility.length > state.teams.length) state.settings.teamVisibility.pop();
    container.innerHTML = state.teams.map((team, index) => `
        <label class="overlay-team-toggle">
            <input type="checkbox" ${state.settings.teamVisibility[index] ? 'checked' : ''} onchange="updateOverlayTeamVisibility(${index}, this.checked)">
            <span>${escapeHTML(team.name)}</span>
        </label>
    `).join('');
}

function renderSetup() {
    const container = document.getElementById('team-config-area');
    container.innerHTML = '';
    state.teams.forEach((t, i) => {
        const spent = t.playerList.reduce((sum, p) => sum + p.price, 0);
        const remaining = t.maxPurse - spent;
        const logoImg = t.logo ? `<img src="${t.logo}">` : 'ADD<br>LOGO';
        container.innerHTML += `
            <div class="team-input-row team-config-row">
                <div class="logo-upload">
                    ${logoImg}
                    <input type="file" aria-label="Upload team ${i + 1} logo" accept="image/*" onchange="handleLogoUpload(event, ${i})">
                </div>
                <label class="team-field"><span class="team-field-title">Team name</span><input type="text" aria-label="Team ${i + 1} name" value="${escapeHTML(t.name)}" onchange="updateTeamData(${i}, 'name', this.value)"></label>
                <label class="team-field"><span class="team-field-title">Maximum purse (₹)</span><input type="number" inputmode="numeric" aria-label="Team ${i + 1} maximum purse" value="${t.maxPurse}" onchange="updateTeamData(${i}, 'maxPurse', this.value)"></label>
                <div class="remaining-purse">₹${remaining.toLocaleString()}</div>
            </div>`;
    });
}

function handleLogoUpload(event, teamIdx) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 150;
            let width = img.width, height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            state.teams[teamIdx].logo = canvas.toDataURL('image/png');
            saveAndAction();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function renderDropdown() {
    const sel = document.getElementById('winSelect');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="" selected disabled>-- No Team Selected --</option>';
    state.teams.forEach((t, i) => {
        const spent = t.playerList.reduce((sum, p) => sum + p.price, 0);
        const rem = t.maxPurse - spent;
        sel.innerHTML += `<option value="${i}">${escapeHTML(t.name)} (Rem: ₹${rem.toLocaleString()})</option>`;
    });
    if (currentVal && state.teams[currentVal]) sel.value = currentVal;
}

function renderDashboard() {
    const container = document.getElementById('teamDashboards');
    container.innerHTML = '';
    state.teams.forEach((t, teamIdx) => {
        let rows = t.playerList.map(p => `
            <tr>
                <td style="width:50px"><span class="seq-badge">#${p.seq}</span></td>
                <td style="width:70px"><span class="seq-badge">SL ${String(p.sourceSerial || '').padStart(2, '0')}</span></td>
                <td>${escapeHTML(p.name)}</td>
                <td>${escapeHTML(p.type)}</td>
                <td>₹${p.price.toLocaleString()}</td>
                <td><button class="remove-btn" onclick="removePlayer(${teamIdx}, '${p.id}')">REMOVE</button></td>
            </tr>
        `).join('');
        container.innerHTML += `
            <div style="margin-bottom:20px; border:1px solid #eee; border-radius:8px; padding:10px;">
                <h3 style="margin:0; font-size:14px; color:#2563eb;">${escapeHTML(t.name)} Roster</h3>
                <div class="table-scroll" role="region" aria-label="${escapeHTML(t.name)} roster, scroll horizontally for all columns" tabindex="0"><table class="dash-table">
                    <thead><tr><th>Seq</th><th>SL</th><th>Name</th><th>Type</th><th>Price</th><th>Action</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; color:#999;">No players signed</td></tr>'}</tbody>
                </table></div>
            </div>`;
    });
}

function renderUnsoldDashboard() {
    const container = document.getElementById('unsoldDashboards');
    let rows = state.unsoldPlayers.map(p => `
        <tr>
            <td style="width:50px"><span class="seq-badge">#${p.seq}</span></td>
            <td>${escapeHTML(p.name)}</td>
            <td>${escapeHTML(p.type)}</td>
            <td><button class="remove-btn" onclick="removeUnsoldPlayer('${p.id}')">REMOVE</button></td>
        </tr>
    `).join('');
    container.innerHTML = `
        <div class="table-scroll" role="region" aria-label="Unsold players, scroll horizontally for all columns" tabindex="0"><table class="dash-table">
            <thead><tr><th>Seq</th><th>Name</th><th>Type</th><th>Action</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" style="text-align:center; color:#999;">No unsold players</td></tr>'}</tbody>
        </table></div>
    `;
}

function updateTeamData(idx, key, val) {
    if (key === 'maxPurse') {
        const amount = Number(val);
        const spent = state.teams[idx].playerList.reduce((sum, p) => sum + p.price, 0);
        if (!Number.isSafeInteger(amount) || amount < spent) { renderEverything(); return alert('Purse must be a whole amount covering existing sales.'); }
        state.teams[idx].maxPurse = amount;
    } else if (key === 'name') {
        if (!val.trim()) { renderEverything(); return alert('Enter a team name.'); }
        state.teams[idx].name = val.trim();
    } else return;
    saveAndAction();
}

function basePriceFor(player) {
    const fallback = state.globalBasePrice ?? state.basePrice ?? 0;
    const category = player?.category || '';
    if (state.basePriceMode === 'category' && Object.hasOwn(state.categoryBasePrices || {}, category)) {
        return state.categoryBasePrices[category];
    }
    return fallback;
}

function applyPlayerBasePrice(player) {
    state.globalBasePrice ??= state.basePrice || 0;
    state.basePrice = basePriceFor(player);
    state.currentBid = state.basePrice;
}

function refreshActiveBasePrice() {
    const oldBase = state.basePrice;
    state.globalBasePrice ??= oldBase || 0;
    const player = sheetPlayers.find(p => String(p.id) === String(state.currentPlayer?.id));
    state.basePrice = basePriceFor(player);
    if (!state.currentPlayer || state.currentPlayer.phase !== 'bidding' || state.currentBid === oldBase) state.currentBid = state.basePrice;
    else state.currentBid = Math.max(state.currentBid, state.basePrice);
}

function updatePricingMode(mode) {
    state.basePriceMode = mode === 'category' ? 'category' : 'global';
    refreshActiveBasePrice();
    saveAndAction();
}

function updateCategoryBasePrice(category, value) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0) { renderEverything(); return alert('Enter a non-negative whole base price.'); }
    state.categoryBasePrices = Object.fromEntries([...Object.entries(state.categoryBasePrices || {}).filter(([key]) => key !== category), ...(value.trim() ? [[category, amount]] : [])]);
    refreshActiveBasePrice();
    saveAndAction();
}

function bidStepFor(amount) {
    const range = (state.bidRanges || []).find(row => amount >= row.from && (row.to === null || amount < row.to));
    return range ? range.increment : state.bidIncrement || 50000;
}

function validBidRanges(ranges) {
    const sorted = [...ranges].sort((a,b) => a.from - b.from);
    return sorted.every((row, i) => Number.isSafeInteger(row.from) && row.from >= 0 &&
        (row.to === null || (Number.isSafeInteger(row.to) && row.to > row.from)) &&
        Number.isSafeInteger(row.increment) && row.increment > 0 &&
        (!i || (sorted[i-1].to !== null && sorted[i-1].to <= row.from)));
}

function addBidRange() {
    const ranges = [...(state.bidRanges || [])].sort((a,b) => a.from-b.from);
    if (ranges.length && ranges.at(-1).to === null) return alert('Set the last range’s upper limit before adding another range.');
    const from = ranges.length ? ranges.at(-1).to : 0;
    state.bidRanges = [...ranges, {from, to: null, increment: state.bidIncrement || 50000}];
    saveAndAction();
}

function updateBidRange(index, key, value) {
    const ranges = (state.bidRanges || []).map(row => ({...row}));
    ranges[index][key] = key === 'to' && value.trim() === '' ? null : value.trim() === '' ? NaN : Number(value);
    if (!validBidRanges(ranges)) { renderEverything(); return alert('Use non-overlapping ranges with From < To and a positive whole increment.'); }
    state.bidRanges = ranges;
    saveAndAction();
}

function removeBidRange(index) {
    state.bidRanges = state.bidRanges.filter((_, i) => i !== index);
    saveAndAction();
}

function renderPricingSetup() {
    document.getElementById('basePriceMode').value = state.basePriceMode === 'category' ? 'category' : 'global';
    const categories = [...new Set(sheetPlayers.map(p => p.category).filter(Boolean))].sort();
    const container = document.getElementById('category-base-prices');
    container.hidden = state.basePriceMode !== 'category';
    container.replaceChildren();
    const help = document.createElement('p');
    help.textContent = categories.length ? 'Blank values and players without a category use the global base price.' : 'Load a sheet with Player category values to set category prices.';
    container.appendChild(help);
    categories.forEach(category => {
        const label = document.createElement('label');
        label.textContent = category + ' (₹)';
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '1';
        input.value = Object.hasOwn(state.categoryBasePrices || {}, category) ? state.categoryBasePrices[category] : '';
        input.placeholder = 'Global base price';
        input.onchange = () => updateCategoryBasePrice(category, input.value);
        label.appendChild(input); container.appendChild(label);
    });
    document.getElementById('bid-increment-ranges').innerHTML = (state.bidRanges || []).map((row,index) => `<div class="pricing-range-row">${[['from','From (₹)'],['to','To (₹)'],['increment','Increment (₹)']].map(([key,label]) => `<label>${label}<input type="number" min="${key === 'increment' ? 1 : 0}" step="1" value="${row[key] ?? ''}" placeholder="${key === 'to' ? 'No limit' : ''}" onchange="updateBidRange(${index}, '${key}', this.value)"></label>`).join('')}<button type="button" onclick="removeBidRange(${index})">Remove</button></div>`).join('');
    document.getElementById('active-pricing-summary').textContent = `Player base: ₹ ${state.basePrice.toLocaleString('en-IN')} · Current step: ₹ ${bidStepFor(state.currentBid).toLocaleString('en-IN')}`;
}

function updateBasePrice(val) {
    const amount = Number(val);
    if (!Number.isSafeInteger(amount) || amount < 0) { renderEverything(); return alert('Enter a non-negative whole base price.'); }
    state.globalBasePrice = amount;
    refreshActiveBasePrice();
    saveAndAction();
}

function updateBidIncrement(value) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0) { renderEverything(); return alert('Enter a positive whole bid increment.'); }
    state.bidIncrement = amount;
    saveAndAction();
}

function changeBid(dir) {
    const step = bidStepFor(state.currentBid);
    if (!Number.isSafeInteger(step) || step <= 0 || !Number.isSafeInteger(state.currentBid + step * dir)) return alert('Enter a valid positive bid increment.');
    if (state.currentPlayer) state.currentPlayer.phase = 'bidding';
    state.currentBid += (step * dir);
    if (state.currentBid < 0) state.currentBid = 0;
    saveAndAction(); sendBidOnly();
}

function manualBidChange(val) {
    const amount = Number(val);
    if (!Number.isSafeInteger(amount) || amount < 0) { renderEverything(); return alert('Enter a non-negative whole bid.'); }
    if (state.currentPlayer) state.currentPlayer.phase = 'bidding';
    state.currentBid = amount;
    saveAndAction(); sendBidOnly();
}

function handleSold() {
    const name = document.getElementById('pNameInput').value.trim();
    const type = document.getElementById('pTypeInput').value;
    const teamIdx = document.getElementById('winSelect').value;
    if (!name || teamIdx === "") return alert("Select Name and Team!");
    const selectedPlayerId = document.getElementById('pNameInput').dataset.playerId;
    const selectedPlayer = sheetPlayers.find(player => String(player.id) === String(selectedPlayerId));
    const existingUnsoldIndex = selectedPlayerId
        ? state.unsoldPlayers.findIndex(player => String(player.sourceId ?? '') === String(selectedPlayerId))
        : -1;
    if (!Number.isSafeInteger(state.currentBid) || state.currentBid < state.basePrice || state.currentBid < 0) return alert('Bid must be a whole amount at least equal to the base price.');
    if (state.teams.some(t => t.playerList.some(p => selectedPlayerId ? String(p.sourceId) === selectedPlayerId : p.name.trim().toLowerCase() === name.toLowerCase()))) return alert('This player is already sold.');
    const team = state.teams[teamIdx];
    if (!team || !Number.isSafeInteger(team.maxPurse)) return alert('Select a team with a valid purse.');
    const spent = team.playerList.reduce((sum, p) => sum + p.price, 0);
    if ((team.maxPurse - spent) < state.currentBid) return alert("Insufficient Funds!");
    if (existingUnsoldIndex !== -1) state.unsoldPlayers.splice(existingUnsoldIndex, 1);
    team.playerList.push({ id: Date.now().toString(), seq: state.globalSeq++, sourceId: selectedPlayerId || '', sourceSerial: selectedPlayer ? selectedPlayer.serial : null, name, type, price: state.currentBid });
    if (activeConn) activeConn.send({ type: 'SOLD_CELEBRATION', bid: state.currentBid, team: team.name, logo: team.logo || '', player: name, playerDetails: state.currentPlayer || { name, role:type } });
    state.currentPlayer = null;
    state.basePrice = state.globalBasePrice ?? state.basePrice ?? 0;
    state.currentBid = state.basePrice || 0;
    document.getElementById('pNameInput').value = '';
    document.getElementById('pNameInput').dataset.playerId = '';
    document.getElementById('pTypeInput').selectedIndex = 0;
    document.getElementById('winSelect').value = "";
    clearPlayerDirectorySelection();
    saveAndAction();
    if (activeConn) activeConn.send({ type: 'BACKGROUND_BID_UPDATE', base: state.basePrice, bid: state.currentBid });
}

function removePlayer(teamIdx, playerId) {
    const player = state.teams[teamIdx].playerList.find(item => item.id === playerId);
    state.teams[teamIdx].playerList = state.teams[teamIdx].playerList.filter(p => p.id !== playerId);
    if (player) {
        const existingStatus = state.unsoldPlayers.findIndex(item => (player.sourceId !== '' && player.sourceId != null && String(item.sourceId ?? '') === String(player.sourceId)) || item.name === player.name);
        if (existingStatus === -1) {
            state.unsoldPlayers.push({ id: `returned-${player.id}`, seq: player.seq, sourceId: player.sourceId ?? '', sourceSerial: player.sourceSerial || null, name: player.name, type: player.type });
        }
    }
    saveAndAction();
}

function handleUnsold() {
    const name = document.getElementById('pNameInput').value.trim();
    if (!name) return alert('Select a player first.');
    const type = document.getElementById('pTypeInput').value;
    const selectedPlayerId = document.getElementById('pNameInput').dataset.playerId;
    const selectedPlayer = sheetPlayers.find(player => String(player.id) === String(selectedPlayerId));
    const existingSold = state.teams.find(team => team.playerList.some(player =>
        selectedPlayerId ? String(player.sourceId ?? '') === String(selectedPlayerId) : player.name === name
    ));
    if (existingSold) return alert('Remove this player from the team before marking unsold.');
    if (state.unsoldPlayers.some(p => selectedPlayerId ? String(p.sourceId) === selectedPlayerId : p.name.trim().toLowerCase() === name.toLowerCase())) return alert('This player is already unsold.');
    state.unsoldPlayers.push({ id: Date.now().toString(), seq: state.globalSeq++, sourceId: selectedPlayerId || '', sourceSerial: selectedPlayer ? selectedPlayer.serial : null, name, type });
    if (activeConn) activeConn.send({ type: 'UNSOLD_ANIMATION', player: name, playerDetails: state.currentPlayer || { name, role:type } });
    state.currentPlayer = null;
    state.basePrice = state.globalBasePrice ?? state.basePrice ?? 0;
    state.currentBid = state.basePrice || 0;
    document.getElementById('pNameInput').value = '';
    document.getElementById('pNameInput').dataset.playerId = '';
    document.getElementById('pTypeInput').selectedIndex = 0;
    document.getElementById('winSelect').value = "";
    clearPlayerDirectorySelection();
    saveAndAction();
    if (activeConn) activeConn.send({ type: 'BACKGROUND_BID_UPDATE', base: state.basePrice, bid: state.currentBid });
}

function removeUnsoldPlayer(playerId) {
    state.unsoldPlayers = state.unsoldPlayers.filter(p => p.id !== playerId);
    saveAndAction();
}

function resetPlayer() {
    state.currentPlayer = null;
    state.basePrice = state.globalBasePrice ?? state.basePrice ?? 0;
    state.currentBid = state.basePrice || 0;
    document.getElementById('pNameInput').value = '';
    document.getElementById('pNameInput').dataset.playerId = '';
    document.getElementById('pTypeInput').selectedIndex = 0;
    document.getElementById('winSelect').value = "";
    clearPlayerDirectorySelection();
    saveAndAction();
    if (activeConn) activeConn.send({ type: 'RESET_VIEW' });
    sendBidOnly();
}

function syncToDisplay(target = activeConn) {
    const displayTeams = state.teams.map(t => ({
        name: t.name,
        logo: t.logo,
        purse: t.maxPurse - t.playerList.reduce((sum, p) => sum + p.price, 0),
        playerList: t.playerList.map(p => ({ name: p.name, price: p.price, type: p.type }))
    }));
    target.send({ type: 'SYNC_ALL', teams: displayTeams, settings: { ...state.settings, tournamentName: activeTournament?.name || 'Tournament' }, base: state.basePrice, bid: state.currentBid, currentPlayer: state.currentPlayer });
}

function sendBidOnly() {
    if (cloudOverview) cloudOverview.send({type:'OVERVIEW_BID', introFields:getMMMIntroFields(state.settings), player:state.currentPlayer || null, base:state.basePrice || 0, bid:state.currentBid || 0});
    if (activeConn) activeConn.send({ type: 'BID_UPDATE', base: state.basePrice, bid: state.currentBid, player: state.currentPlayer });
    overviewConns.forEach(c => { try { c.send({ type: 'OVERVIEW_BID', introFields: getMMMIntroFields(state.settings), player: state.currentPlayer || null, base: state.basePrice || 0, bid: state.currentBid || 0 }); } catch(e) {} });
}

function applyAndSync() {
    saveAndAction(); alert("Data Synced to Overlay!");
}

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
}

function exportCSV() {
    let allPlayers = [];
    state.teams.forEach(t => {
        t.playerList.forEach(p => { allPlayers.push({...p, status: 'Sold', team: t.name}); });
    });
    state.unsoldPlayers.forEach(p => {
        allPlayers.push({...p, status: 'Unsold', team: 'N/A', price: 0});
    });
    allPlayers.sort((a,b) => a.seq - b.seq);
    let csv = "Sequence,Player Name,Type,Status,Team,Price\n";
    allPlayers.forEach(p => { csv += [p.seq, p.name, p.type, p.status, p.team, p.price].map(csvCell).join(',') + '\r\n'; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Auction_Results.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
