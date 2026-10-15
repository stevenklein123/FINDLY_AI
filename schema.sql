-- =========================================================
-- Findly AI : Supabase schema
-- Run in Supabase Dashboard > SQL Editor
-- =========================================================

-- 1. PROFILES ------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  student_no  text,
  email       text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile whenever someone signs up (email or Google)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, student_no, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'full_name'),
    new.raw_user_meta_data->>'student_no',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. ITEMS ---------------------------------------------------
create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  type           text not null check (type in ('lost', 'found')),
  title          text not null,
  description    text,
  category       text,
  location       text,
  date_occurred  date,
  image_path     text,                 -- path inside the item-images bucket
  status         text not null default 'open'
                 check (status in ('open', 'matched', 'claimed', 'closed')),
  created_at     timestamptz not null default now()
);

create index if not exists items_user_idx on public.items (user_id);
create index if not exists items_type_status_idx on public.items (type, status);

alter table public.items enable row level security;

create policy "Users read own items"
  on public.items for select
  using (auth.uid() = user_id);

create policy "Users insert own items"
  on public.items for insert
  with check (auth.uid() = user_id);

create policy "Users update own items"
  on public.items for update
  using (auth.uid() = user_id);

create policy "Users delete own items"
  on public.items for delete
  using (auth.uid() = user_id);


-- 3. MATCHES -------------------------------------------------
-- Written by a server-side Edge Function (service role), read by users.
create table if not exists public.matches (
  id             uuid primary key default gen_random_uuid(),
  lost_item_id   uuid not null references public.items(id) on delete cascade,
  found_item_id  uuid not null references public.items(id) on delete cascade,
  score          numeric(5,4) not null check (score between 0 and 1),
  status         text not null default 'pending'
                 check (status in ('pending', 'verified', 'rejected')),
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (lost_item_id, found_item_id)
);

alter table public.matches enable row level security;

create policy "Users read matches on their items"
  on public.matches for select
  using (
    exists (
      select 1 from public.items i
      where i.id in (matches.lost_item_id, matches.found_item_id)
        and i.user_id = auth.uid()
    )
  );
-- No insert/update policies: only the service role (Edge Function) writes matches.


-- 4. STORAGE: item photos -----------------------------------
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

-- Files must be uploaded to  <user_id>/<filename>
create policy "Anyone can view item images"
  on storage.objects for select
  using (bucket_id = 'item-images');

create policy "Users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );