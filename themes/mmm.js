/* Kept independent of the classic overlay so theme switching preserves its layout. */
const mmmDisplay = { settings:{}, player:null, base:0, bid:0, result:null, timer:null };
function getPhotoAlignment(player) {
    return ['top','center','bottom'].includes(player?.photoAlignment) ? player.photoAlignment : 'top';
}
function getMMMIntroFields(settings) {
    return Array.isArray(settings.introFields) ? settings.introFields : [
        {key:'village',label:'Village'}, {key:'panchayat',label:'Panchayat'}, {key:'basePrice',label:'Base price'}
    ];
}
function getMMMIntroFacts(player, settings, base) {
    return getMMMIntroFields(settings).map(field => ({
        label:field.label,
        value:field.key === 'basePrice' ? Number(base || 0).toLocaleString('en-IN')
            : String(player.introValues?.[field.key] ?? (field.key === 'village' ? player.village : field.key === 'panchayat' ? player.panchayat : '') ?? '').trim() || '—'
    }));
}
function renderMMM() {
    const view = mmmDisplay;
    const root = document.getElementById('mmm-overlay');
    document.getElementById('display-app').dataset.theme = view.settings.theme === 'mmm' ? 'mmm' : 'classic';
    const player = view.result ? view.result.player : view.player;
    root.hidden = !player || !player.name || !view.settings.showBidding || (view.settings.teamVisibility || []).some(Boolean);
    if (root.hidden) return;
    const phase = view.result ? view.result.phase : player.phase === 'bidding' ? 'bidding' : 'intro';
    root.dataset.phase = phase;
    const set = (id, value) => { document.getElementById(id).textContent = value; };
    set('mmm-name', player.name.toUpperCase());
    set('mmm-caption-name', player.name.toUpperCase());
    set('mmm-role', player.role || 'Player');
    set('mmm-caption-role', player.role || 'Player');
    const facts = getMMMIntroFacts(player, view.settings, view.base);
    const factsNode = document.getElementById('mmm-intro-facts');
    factsNode.replaceChildren();
    factsNode.hidden = facts.length === 0;
    factsNode.dataset.count = String(facts.length);
    for (const fact of facts) {
        const cell = document.createElement('div');
        const label = document.createElement('span'); label.className = 'mmm-label'; label.textContent = fact.label;
        const value = document.createElement('span'); value.className = 'mmm-value'; value.textContent = fact.value;
        cell.appendChild(label); cell.appendChild(value); factsNode.appendChild(cell);
    }
    set('mmm-base', Number(view.base || 0).toLocaleString('en-IN'));
    const bidNode = document.getElementById('mmm-bid');
    const nextBid = Number(view.bid || 0).toLocaleString('en-IN');
    const bidChanged = bidNode.textContent && bidNode.textContent !== nextBid;
    set('mmm-bid', nextBid);
    if (bidChanged && phase === 'bidding' && bidNode.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (view.bidAnimation) view.bidAnimation.cancel();
        view.bidAnimation = bidNode.animate([
            { transform:'scale(1)', color:'#fff' },
            { transform:'scale(1.07)', color:'#e7ceff', offset:0.35 },
            { transform:'scale(1)', color:'#fff' }
        ], { duration:380, easing:'ease-out' });
    }
    set('mmm-initials', player.name.trim().split(/\s+/).map(s => s[0]).slice(0,2).join('').toUpperCase());
    const image = document.getElementById('mmm-photo');
    image.dataset.verticalAlign = getPhotoAlignment(player);
    const photo = player.photo || '';
    if (image.dataset.source !== photo) {
        image.dataset.source = photo;
        image.hidden = !photo;
        image.onerror = () => { image.hidden = true; };
        if (photo) image.src = photo; else image.removeAttribute('src');
    }
    document.getElementById('mmm-bid-ribbon').hidden = phase !== 'bidding';
    document.getElementById('mmm-sale-ribbon').hidden = phase !== 'sold';
    if (phase === 'sold') {
        set('mmm-team-name', view.result.team || 'Team');
        set('mmm-sold-price', Number(view.result.bid || 0).toLocaleString('en-IN'));
        for (const id of ['mmm-logo-left']) {
            const slot = document.getElementById(id);
            const logoKey = JSON.stringify([view.result.logo || '', view.result.team || 'Team']);
            if (slot.dataset.logoKey === logoKey) continue;
            slot.dataset.logoKey = logoKey;
            slot.replaceChildren();
            if (view.result.logo) {
                const logo = document.createElement('img');
                logo.alt = view.result.team || 'Team';
                logo.src = view.result.logo;
                logo.onerror = () => { slot.textContent = (view.result.team || 'T').charAt(0); };
                slot.appendChild(logo);
            } else slot.textContent = (view.result.team || 'T').charAt(0);
        }
    }
}
function receiveMMM(data) {
    const view = mmmDisplay;
    if (data.type === 'SYNC_ALL') {
        view.settings = data.settings || view.settings;
        view.player = data.currentPlayer || null;
        view.base = data.base; view.bid = data.bid;
    } else if (data.type === 'BID_UPDATE') {
        // An actual next player/bid dismisses a result; connection syncs do not.
        if (data.player) { clearTimeout(view.timer); view.result = null; }
        view.player = data.player || null;
        view.base = data.base; view.bid = data.bid;
    } else if (data.type === 'SOLD_CELEBRATION' || data.type === 'UNSOLD_ANIMATION') {
        clearTimeout(view.timer);
        view.result = {phase:data.type === 'SOLD_CELEBRATION' ? 'sold' : 'unsold', player:data.playerDetails || view.player || {name:data.player}, team:data.team, logo:data.logo, bid:data.bid};
        view.timer = setTimeout(() => { view.result = null; renderMMM(); }, 7000);
    } else if (data.type === 'RESET_VIEW') {
        clearTimeout(view.timer); view.result = null; view.player = null;
    } else if (data.type !== 'BACKGROUND_BID_UPDATE') return;
    renderMMM();
}
