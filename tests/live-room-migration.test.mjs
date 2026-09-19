import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/202609190001_live_room_ownership.sql',import.meta.url),'utf8');
const base=readFileSync(new URL('../supabase/migrations/202609130001_private_workspaces.sql',import.meta.url),'utf8');
const alice='00000000-0000-0000-0000-000000000001',bob='00000000-0000-0000-0000-000000000002';
function workspace(room, overlay) {
  return {auc_tournaments_v1:'[{"id":"cup","name":"Cup"}]','auc_tournament_cup_overview-peer':room,...(overlay?{'auc_tournament_cup_overlayLive-peer':overlay}:{})};
}
async function prepare(secondRoom='auction-bob') {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
    INSERT INTO auth.users VALUES ('${alice}'),('${bob}');`);
  await db.exec(base);
  for (const [id,snapshot] of [[alice,workspace('auction-alice','auction-alice-overlay')],[bob,workspace(secondRoom)]])
    await db.query('INSERT INTO public.auction_workspaces(user_id,snapshot) VALUES ($1,$2)',[id,JSON.stringify(snapshot)]);
  return db;
}
async function asUser(db,id) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('SET ROLE authenticated');
}
async function canPublish(db,room) {
  return (await db.query('SELECT public.can_publish_auction_room($1) AS allowed',[room])).rows[0].allowed;
}
test('migration preserves links and enforces server-owned rooms despite copied workspace IDs',async()=>{
  const db=await prepare();
  try {
    await db.exec(migration);
    await asUser(db,alice);
    assert.equal(await canPublish(db,'auction-alice'),true);
    assert.equal(await canPublish(db,'auction-alice-overlay'),true);
    const original=await db.query("SELECT public.get_auction_live_room('cup','overview') AS room");
    assert.equal(original.rows[0].room,'auction-alice','Existing public link must survive migration');
    await asUser(db,bob);
    assert.equal(await canPublish(db,'auction-alice'),false);
    // This is the previous exploit: use the legitimate workspace RPC to copy another room ID.
    await db.query('SELECT public.save_auction_workspace(1,$1)',[JSON.stringify(workspace('auction-alice','auction-alice-overlay'))]);
    assert.equal(await canPublish(db,'auction-alice'),false);
    assert.equal(await canPublish(db,'auction-alice-overlay'),false);
    assert.equal(await canPublish(db,'auction-bob'),true);
    const own=await db.query("SELECT public.get_auction_live_room('cup','overview') AS room");
    assert.equal(own.rows[0].room,'auction-bob','Tampered cache must resolve to the caller’s original room');
    const allocated=(await db.query("SELECT public.get_auction_live_room('cup','overlayLive') AS room")).rows[0].room;
    assert.match(allocated,/^auction-[0-9a-f-]{36}$/);
    assert.notEqual(allocated,'auction-alice-overlay');
    assert.equal(await canPublish(db,allocated),true);
    await assert.rejects(db.query("SELECT public.get_auction_live_room('missing','overview')"),/Tournament not found/);
    await assert.rejects(db.query("INSERT INTO public.auction_live_rooms VALUES ('auction-forged',$1,'cup','overview')",[bob]),/permission denied/);
    await assert.rejects(db.query("UPDATE public.auction_live_rooms SET user_id=$1 WHERE room_id='auction-alice'",[bob]),/permission denied/);
    const visible=await db.query('SELECT room_id FROM public.auction_live_rooms');
    assert.ok(!visible.rows.some(r=>r.room_id==='auction-alice'),'RLS hides other users’ registry rows');
    await db.query('SELECT public.save_auction_workspace(2,$1)',[JSON.stringify({auc_tournaments_v1:'[]'})]);
    assert.equal(await canPublish(db,'auction-bob'),false,'Deleted tournaments cannot start new publishers');
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query("SELECT public.get_auction_live_room('cup','overview')"),/permission denied/);
  } finally {await db.close();}
});
test('conflicting legacy room ownership rolls the whole migration back',async()=>{
  const db=await prepare('auction-alice');
  try {
    await assert.rejects(db.exec(migration),/duplicate key/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT to_regclass('public.auction_live_rooms') AS registry")).rows[0].registry,null);
  } finally {await db.close();}
});
