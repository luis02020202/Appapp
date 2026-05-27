-- ============================================================
--  Tripp MVP - Supabase Setup
--  Führe dieses Skript einmal im Supabase SQL Editor aus:
--  Supabase Dashboard -> SQL Editor -> New query -> einfügen -> Run
-- ============================================================

-- ---------- Tabellen ----------
create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  destination text,
  start_date  date,
  end_date    date,
  created_at  timestamptz default now()
);

create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid references trips(id) on delete cascade,
  name       text not null,
  emoji      text default '🙂',
  created_at timestamptz default now()
);

create table if not exists clips (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid references trips(id) on delete cascade,
  member_name   text,
  member_emoji  text,
  storage_path  text not null,
  caption       text,
  day_label     text,
  reactions     int default 0,
  created_at    timestamptz default now()
);

create index if not exists clips_trip_idx on clips(trip_id, created_at);
create index if not exists members_trip_idx on members(trip_id);

-- ---------- Row Level Security ----------
-- MVP-Hinweis: Diese Policies erlauben jedem mit dem (öffentlichen) anon-Key
-- Lesen und Schreiben. Das ist für eine kleine Freundes-Gruppe ok, aber NICHT
-- für eine öffentliche Produktiv-App. Vor einem echten Launch absichern.
alter table trips   enable row level security;
alter table members enable row level security;
alter table clips   enable row level security;

drop policy if exists "public read trips"    on trips;
drop policy if exists "public insert trips"   on trips;
drop policy if exists "public read members"   on members;
drop policy if exists "public insert members" on members;
drop policy if exists "public read clips"     on clips;
drop policy if exists "public insert clips"   on clips;
drop policy if exists "public update clips"   on clips;

create policy "public read trips"    on trips   for select using (true);
create policy "public insert trips"  on trips   for insert with check (true);
create policy "public read members"  on members for select using (true);
create policy "public insert members" on members for insert with check (true);
create policy "public read clips"    on clips   for select using (true);
create policy "public insert clips"  on clips   for insert with check (true);
create policy "public update clips"  on clips   for update using (true) with check (true);

-- ---------- Atomare Reaktions-Zählung ----------
create or replace function add_reaction(clip_id uuid)
returns void language sql as $$
  update clips set reactions = reactions + 1 where id = clip_id;
$$;

-- ---------- Storage Bucket für Video-Clips ----------
insert into storage.buckets (id, name, public)
values ('clips', 'clips', true)
on conflict (id) do nothing;

drop policy if exists "public read clip files"   on storage.objects;
drop policy if exists "public upload clip files" on storage.objects;

create policy "public read clip files"   on storage.objects
  for select using (bucket_id = 'clips');
create policy "public upload clip files" on storage.objects
  for insert with check (bucket_id = 'clips');
