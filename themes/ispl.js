/* ISPL uses the same auction lifecycle as MMM, including its result timeout. */
let isplPage = 0;
let isplPageTimer = null;
let isplLastPanel = '';
let isplRenderedKey = '';
let isplPreviousFrame = null;
// Purpose-tuned durations: structural moves stay snappy, the sold/unsold reveal gets an energetic spring pop.
const ISPL_ENTER_MS = 620;
const ISPL_SHIFT_MS = 460;
const ISPL_REVEAL_MS = 520;
const ISPL_POP_MS = 640;
const ISPL_EXIT_MS = 420;
const ISPL_EASE = 'cubic-bezier(.22,1,.36,1)';
const ISPL_SPRING = 'cubic-bezier(.34,1.56,.64,1)';
let isplExitAnimation = null;
function animateISPL(node, frames, options = {}) {
    if (!node?.animate || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    return node.animate(frames, {duration:450, easing:ISPL_EASE, ...options});
}
function mountISPL(root, content, frame) {
    const previous = isplPreviousFrame;
    root.append(content);
    const entrance = !previous || previous.mode !== frame.mode || previous.player !== frame.player;
    if (entrance) {
        animateISPL(content, [
            {opacity:0, translate:frame.mode === 'player' ? '0 22px' : '-32px 0', scale:.97, filter:'blur(6px)'},
            {opacity:1, translate:'0 0', scale:1, filter:'blur(0px)'}
        ], {duration:ISPL_ENTER_MS});
    }
    if (frame.mode === 'player') {
        const changedPhase = previous?.phase !== frame.phase;
        if (!entrance && changedPhase) {
            const offset = (['sold','unsold'].includes(previous.phase) ? 12 : 295)
                - (['sold','unsold'].includes(frame.phase) ? 12 : 295);
            animateISPL(content.querySelector?.('.ispl-portrait'), [{translate:`${offset}px 0`},{translate:'0 0'}], {duration:ISPL_SHIFT_MS});
        }
        if (entrance || changedPhase) {
            const isResult = frame.phase === 'sold' || frame.phase === 'unsold';
            animateISPL(content.querySelector?.('.ispl-prices'), [{opacity:0},{opacity:1}], {duration:ISPL_REVEAL_MS});
            animateISPL(content.querySelector?.('.ispl-result'),
                isResult
                    ? [{opacity:0,scale:.7},{opacity:1,scale:1.1,offset:.6},{opacity:1,scale:1}]
                    : [{opacity:0,scale:.88},{opacity:1,scale:1}],
                isResult ? {duration:ISPL_POP_MS, easing:ISPL_SPRING} : {duration:ISPL_REVEAL_MS}
            );
            animateISPL(content.querySelector?.('.ispl-winner'), [{opacity:0,translate:'16px 0',scale:.9},{opacity:1,translate:'0 0',scale:1}], {duration:ISPL_POP_MS, easing:ISPL_SPRING});
        }
        if (frame.phase === 'bidding' && previous?.bid !== frame.bid) {
            animateISPL(content.querySelector?.('.ispl-price:last-child strong'), [
                {scale:'1',color:'#fff',textShadow:'0 0 0px transparent'},
                {scale:'1.12',color:'#fcf23b',textShadow:'0 0 20px #fcf23bcc',offset:.4},
                {scale:'1',color:'#fff',textShadow:'0 0 0px transparent'}
            ], {duration:420});
        }
    } else if (entrance || previous?.page !== frame.page) {
        Array.from(content.querySelectorAll?.('.ispl-team-row') || []).forEach((row,index) => {
            animateISPL(row, [{opacity:0,translate:'-18px 0',scale:.97},{opacity:1,translate:'0 0',scale:1}], {duration:380,delay:index*40,fill:'backwards'});
        });
    }
    isplPreviousFrame = frame;
}

function isplMoney(value) {
    const amount = Number(value) || 0;
    return '₹ ' + (Math.abs(amount) >= 100000
        ? (amount / 100000).toLocaleString('en-IN', {maximumFractionDigits:2}) + 'L'
        : amount.toLocaleString('en-IN'));
}
function isplNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function renderISPL(view) {
    const root = document.getElementById('ispl-overlay');
    if (!root) return;
    const mode = view.settings.isplView || 'player';
    const panelKey = view.settings.theme === 'ispl' ? mode : '';
    if (panelKey !== isplLastPanel) {
        clearInterval(isplPageTimer); isplPageTimer = null; isplPage = 0;
        isplLastPanel = panelKey;
    }
    const player = view.result ? view.result.player : view.player;
    const hidePlayer = mode !== 'purse' && mode !== 'squad' && (!view.settings.showBidding || !player?.name);
    if (view.settings.theme === 'ispl' && hidePlayer) {
        if (isplExitAnimation) return;
        const finish = () => {
            root.hidden = true; root.replaceChildren();
            isplPreviousFrame = null; isplRenderedKey = ''; isplExitAnimation = null;
        };
        const content = root.firstElementChild;
        isplExitAnimation = animateISPL(content, [{opacity:1,translate:'0 0',scale:1},{opacity:0,translate:'0 30px',scale:.97}], {duration:ISPL_EXIT_MS,fill:'forwards'});
        if (isplExitAnimation) isplExitAnimation.onfinish = finish;
        else finish();
        return;
    }
    if (isplExitAnimation) {
        isplExitAnimation.onfinish = null;
        isplExitAnimation.cancel(); isplExitAnimation = null;
        isplRenderedKey = ''; isplPreviousFrame = null;
    }
    root.hidden = view.settings.theme !== 'ispl';
    if (root.hidden) { isplRenderedKey = ''; isplPreviousFrame = null; return; }
    // Repeated connection snapshots must not restart broadcast animations.
    const renderKey = JSON.stringify([view.settings, view.player, view.result, view.base, view.bid, view.teams, isplPage]);
    if (renderKey === isplRenderedKey) return;
    isplRenderedKey = renderKey;
    root.replaceChildren();
    if (mode === 'purse' || mode === 'squad') {
        const teams = view.teams || [];
        const pages = Math.max(1, Math.ceil(teams.length / 8));
        isplPage %= pages;
        if (pages > 1 && !isplPageTimer) isplPageTimer = setInterval(() => {
            isplPage++; renderISPL(mmmDisplay);
        }, 8000);
        if (pages === 1) { clearInterval(isplPageTimer); isplPageTimer = null; }
        const panel = isplNode('aside', 'ispl-sidebar');
        const heading = isplNode('header', 'ispl-sidebar-heading');
        heading.append(isplNode('span','ispl-tournament-name',view.settings.tournamentName || 'Tournament'), isplNode('strong','','AUCTION'));
        panel.append(heading, isplNode('h2','',mode === 'purse' ? 'PURSE REMAINING' : 'SQUAD SIZE'));
        panel.append(isplNode('div','ispl-units', mode === 'purse' ? '₹ IN LAKH' : 'PLAYERS'));
        const rows = isplNode('div','ispl-team-rows');
        for (const team of teams.slice(isplPage * 8, isplPage * 8 + 8)) {
            const row = isplNode('div','ispl-team-row');
            row.append(isplNode('span','',team.name || 'Team'), isplNode('strong','', mode === 'purse'
                ? ((Number(team.purse) || 0) / 100000).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2})
                : String((team.playerList || []).length)));
            rows.append(row);
        }
        if (!teams.length) rows.append(isplNode('p','','No teams yet'));
        panel.append(rows);
        if (pages > 1) panel.append(isplNode('div','ispl-page',`${isplPage + 1} / ${pages}`));
        mountISPL(root, panel, {mode, page:isplPage});
        return;
    }
    const phase = view.result?.phase || (player.phase === 'bidding' ? 'bidding' : 'intro');
    root.dataset.phase = phase;
    const card = isplNode('div','ispl-card');
    const portrait = isplNode('div','ispl-portrait');
    portrait.append(isplNode('span','ispl-initials',player.name.trim().split(/\s+/).slice(0,2).map(s => s[0]).join('')));
    if (player.photo) {
        const photo = isplNode('img',''); photo.alt = player.name; photo.referrerPolicy = 'no-referrer';
        photo.dataset.verticalAlign = getPhotoAlignment(player);
        photo.onerror = () => { photo.hidden = true; };
        photo.src = player.photo; portrait.append(photo);
    }
    const prices = isplNode('div','ispl-prices');
    if (phase === 'sold' || phase === 'unsold') {
        prices.append(isplNode('strong','ispl-result',phase === 'sold' ? 'SOLD  ' + isplMoney(view.result.bid) : 'UNSOLD'));
        if (phase === 'sold') {
            const team = isplNode('div','ispl-winner');
            team.append(isplNode('span','',view.result.team || 'Team'));
            if (view.result.logo) {
                const logo = isplNode('img',''); logo.alt = view.result.team || 'Team';
                logo.onerror = () => { logo.hidden = true; }; logo.src = view.result.logo; team.prepend(logo);
            }
            prices.append(team);
        }
    } else {
        const base = isplNode('div','ispl-price');
        base.append(isplNode('span','','BASE PRICE'),isplNode('strong','',isplMoney(view.base)));
        const bid = isplNode('div','ispl-price');
        if (phase === 'bidding') bid.append(isplNode('span','','CURRENT BID'),isplNode('strong','',isplMoney(view.bid)));
        else {
            const gavel = isplNode('div','ispl-gavel');
            gavel.setAttribute('aria-label','Ready for auction');
            gavel.innerHTML = '<svg viewBox="0 0 80 80" aria-hidden="true"><g transform="rotate(-35 40 40)" fill="currentColor"><rect x="19" y="13" width="38" height="22" rx="3"/><rect x="34" y="32" width="8" height="38" rx="3"/></g></svg>';
            bid.append(gavel);
        }
        prices.append(base,bid);
    }
    const caption = isplNode('div','ispl-caption');
    caption.append(isplNode('strong','',player.name),isplNode('span','',player.role || 'Player'));
    const category = isplNode('div','ispl-category');
    category.append(isplNode('span','','CATEGORY'),isplNode('strong','',player.category || player.introValues?.category || '—'));
    card.append(prices,portrait,caption,category);
    mountISPL(root, card, {mode:'player', player:player.id || player.serial || player.name, phase, bid:view.bid});
}
