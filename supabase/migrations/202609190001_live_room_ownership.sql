-- Run once before deploying the matching Worker/browser update.
-- Existing links are retained. Conflicting pre-existing claims abort the migration;
-- do not silently assign a shared room to whichever workspace is scanned first.
begin;
lock table public.auction_workspaces in share row exclusive mode;

create table public.auction_live_rooms (
  room_id text primary key check (room_id ~ '^auction-[a-zA-Z0-9-]{1,100}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  tournament_id text not null,
  kind text not null check (kind in ('overview', 'overlayLive')),
  unique (user_id, tournament_id, kind)
);
alter table public.auction_live_rooms enable row level security;
revoke all on public.auction_live_rooms from public, anon, authenticated;
grant select on public.auction_live_rooms to authenticated;
create policy "Read own live rooms" on public.auction_live_rooms
  for select to authenticated using ((select auth.uid()) = user_id);

insert into public.auction_live_rooms (room_id, user_id, tournament_id, kind)
select w.snapshot ->> ('auc_tournament_' || (t.value ->> 'id') || '_' || k.kind || '-peer'),
       w.user_id, t.value ->> 'id', k.kind
from public.auction_workspaces w
cross join lateral jsonb_array_elements(coalesce((w.snapshot ->> 'auc_tournaments_v1')::jsonb, '[]'::jsonb)) t(value)
cross join (values ('overview'), ('overlayLive')) k(kind)
where w.snapshot ->> ('auc_tournament_' || (t.value ->> 'id') || '_' || k.kind || '-peer') is not null;

-- Clients choose a tournament and purpose, never the room ID or its owner.
create function public.get_auction_live_room(p_tournament_id text, p_kind text)
returns text language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); result text;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_kind is null or p_kind not in ('overview', 'overlayLive') then
    raise exception 'Invalid room kind';
  end if;
  if not exists (
    select 1 from public.auction_workspaces w,
      lateral jsonb_array_elements(coalesce((w.snapshot ->> 'auc_tournaments_v1')::jsonb, '[]'::jsonb)) t(value)
    where w.user_id = owner_id and t.value ->> 'id' = p_tournament_id
  ) then raise exception 'Tournament not found' using errcode = '42501'; end if;
  insert into public.auction_live_rooms (room_id, user_id, tournament_id, kind)
    values ('auction-' || pg_catalog.gen_random_uuid()::text, owner_id, p_tournament_id, p_kind)
    on conflict (user_id, tournament_id, kind) do update set kind = excluded.kind
    returning room_id into result;
  return result;
end;
$$;
revoke all on function public.get_auction_live_room(text, text) from public, anon, authenticated;
grant execute on function public.get_auction_live_room(text, text) to authenticated;

-- RLS and auth.uid() restrict the registry and workspace to the caller. The
-- workspace's mutable peer strings are deliberately not used for authorization.
create function public.can_publish_auction_room(p_room_id text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.auction_live_rooms r
    join public.auction_workspaces w on w.user_id = r.user_id
    cross join lateral jsonb_array_elements(coalesce((w.snapshot ->> 'auc_tournaments_v1')::jsonb, '[]'::jsonb)) t(value)
    where r.room_id = p_room_id and r.user_id = auth.uid()
      and t.value ->> 'id' = r.tournament_id
  );
$$;
revoke all on function public.can_publish_auction_room(text) from public, anon, authenticated;
grant execute on function public.can_publish_auction_room(text) to authenticated;
commit;
