-- =========================================================
-- Findly AI : found_items + claim_items
-- =========================================================

-- 1. FOUND ITEMS ("I found something")
create table public.found_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  photo_url    text not null,
  item_name    text not null,
  category     text,
  color        text,
  brand        text,
  size         text,
  marks        text,
  description  text,
  place        text not null,
  occurred_at  timestamptz not null default now(),
  status       text not null default 'open',
  created_at   timestamptz not null default now()
);

-- 2. CLAIM ITEMS ("I lost something")
create table public.claim_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  photo_url    text not null,
  item_name    text not null,
  category     text,
  color        text,
  brand        text,
  size         text,
  marks        text,
  description  text,
  place        text not null,
  occurred_at  timestamptz not null default now(),
  status       text not null default 'open',
  created_at   timestamptz not null default now()
);

create index found_items_user_idx on public.found_items (user_id);
create index claim_items_user_idx on public.claim_items (user_id);

-- 3. ROW LEVEL SECURITY: students only add and see their own reports
alter table public.found_items enable row level security;
alter table public.claim_items enable row level security;

create policy "found: insert own" on public.found_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "found: read own" on public.found_items
  for select to authenticated using (user_id = auth.uid());

create policy "claim: insert own" on public.claim_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "claim: read own" on public.claim_items
  for select to authenticated using (user_id = auth.uid());

-- 4. STORAGE: item photos (bucket already exists, this is safe to re-run)
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

-- Files must be uploaded to  <user_id>/<filename>
create policy "photos: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: public read" on storage.objects
  for select
  using (bucket_id = 'item-images');