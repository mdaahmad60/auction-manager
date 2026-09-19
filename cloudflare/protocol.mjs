// OBS/broadcast overlay events relayed for the "via Internet" overlay link, distinct from the read-only overview family above.
const OVERLAY_MESSAGE_TYPES = ['SYNC_ALL','BID_UPDATE','BACKGROUND_BID_UPDATE','SOLD_CELEBRATION','UNSOLD_ANIMATION','RESET_VIEW'];

export function validateMessage(data) {
  if (!data || typeof data.type !== 'string') throw new Error('Unsupported update');
  if (['OVERVIEW_SYNC','OVERVIEW_BID'].includes(data.type)) {
    if (![data.base,data.bid].every(n=>Number.isSafeInteger(n) && n>=0)) throw new Error('Invalid bid');
    if (!Array.isArray(data.introFields) || data.introFields.some(f=>typeof f.key!=='string'||typeof f.label!=='string')) throw new Error('Invalid player fields');
    const player = data.type === 'OVERVIEW_SYNC' ? data.currentPlayer : data.player;
    if (player !== null && (!player || typeof player.name !== 'string')) throw new Error('Invalid player');
    if (data.type === 'OVERVIEW_SYNC' && !['teams','allPlayers','soldSerials','unsoldSerials'].every(key=>Array.isArray(data[key]))) throw new Error('Invalid snapshot');
  } else if (OVERLAY_MESSAGE_TYPES.includes(data.type)) {
    if (data.base !== undefined && !(Number.isSafeInteger(data.base) && data.base >= 0)) throw new Error('Invalid bid');
    if (data.bid !== undefined && !(Number.isSafeInteger(data.bid) && data.bid >= 0)) throw new Error('Invalid bid');
    if (data.type === 'SYNC_ALL' && !Array.isArray(data.teams)) throw new Error('Invalid snapshot');
  } else {
    throw new Error('Unsupported update');
  }
}

export async function authorizePublisher(env, token, room, fetcher = fetch) {
  if (typeof token !== 'string' || token.length > 16384 || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Authentication unavailable');
  const headers = {apikey:env.SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${token}`};
  const auth = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {headers});
  if (!auth.ok) throw new Error('Invalid session');
  const user = await auth.json();
  if (!user.id) throw new Error('Invalid user');
  const result = await fetcher(`${env.SUPABASE_URL}/rest/v1/auction_workspaces?user_id=eq.${encodeURIComponent(user.id)}&select=snapshot`, {headers});
  if (!result.ok) throw new Error('Workspace unavailable');
  const rows = await result.json();
  const snapshot = rows[0]?.snapshot || {};
  const tournaments = JSON.parse(snapshot.auc_tournaments_v1 || '[]');
  // A tournament's overview room and its "overlay via Internet" room are separate rooms; either may publish here.
  const ownsRoom = t => ['overview-peer','overlayLive-peer'].some(suffix => snapshot[`auc_tournament_${t.id}_${suffix}`] === room);
  if (!Array.isArray(tournaments) || !tournaments.some(ownsRoom)) throw new Error('You do not own this overview');
  // Supabase validated this token above; use its expiry only after that check.
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const expires = Number(payload.exp) * 1000;
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('Session expired');
  return expires;
}
