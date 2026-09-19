-- Each authenticated organizer owns one versioned workspace containing their tournaments.
-- The snapshot preserves the existing auction model, including stable link IDs and cached players.
create table public.auction_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint workspace_is_object check (jsonb_typeof(snapshot) = 'object'),
  constraint workspace_size check (octet_length(snapshot::text) <= 20971520)
);
alter table public.auction_workspaces enable row level security;
revoke all on public.auction_workspaces from anon;
grant select, insert, update on public.auction_workspaces to authenticated;
create policy "Read own workspace" on public.auction_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own workspace" on public.auction_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own workspace" on public.auction_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Compare-and-swap prevents a stale controller/device from overwriting a newer save.
create or replace function public.save_auction_workspace(expected_revision bigint, new_snapshot jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if expected_revision < 0 or expected_revision is null then raise exception 'Invalid revision'; end if;
  if jsonb_typeof(new_snapshot) is distinct from 'object' then raise exception 'Invalid workspace'; end if;
  if exists (select 1 from jsonb_each(new_snapshot) e where e.key !~ '^auc_' or jsonb_typeof(e.value) <> 'string') then
    raise exception 'Workspace entries must be auction keys with string values';
  end if;
  if expected_revision = 0 then
    insert into public.auction_workspaces(user_id,snapshot,revision)
    values(auth.uid(),new_snapshot,1) on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.auction_workspaces set snapshot=new_snapshot, revision=revision+1, updated_at=now()
    where user_id=auth.uid() and revision=expected_revision returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'Workspace changed on another device. Reload before saving.' using errcode='40001'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_auction_workspace(bigint,jsonb) from public, anon;
grant execute on function public.save_auction_workspace(bigint,jsonb) to authenticated;
