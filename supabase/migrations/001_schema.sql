-- =====================================================================
-- 001_schema.sql — tables, relationships, constraints and indexes
-- Run this first in the Supabase SQL Editor.
--
-- Golden rule of this project: the browser is never trusted.
-- Every rule that matters (prices, dates, sizes, statuses, ownership)
-- is enforced here in the database, not only in app.js.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Studio settings (one row). Holds seeded values such as the mural rate,
-- so the price is always calculated from the database, never the client.
-- ---------------------------------------------------------------------
create table if not exists public.studio_settings (
  id                  boolean primary key default true,
  currency            text    not null default 'INR',
  mural_rate_per_sqft numeric(10,2) not null,
  constraint studio_settings_single_row check (id),          -- only one row can exist
  constraint studio_settings_rate_positive check (mural_rate_per_sqft > 0),
  constraint studio_settings_currency_format check (currency ~ '^[A-Z]{3}$')
);

-- ---------------------------------------------------------------------
-- Profiles: one row per Supabase Auth user. Stores the ROLE.
-- The role is never read from the browser; a trigger (002) always
-- creates new users as 'customer'. Only the database owner can promote
-- someone to 'studio' (the studio admin role from seed.json).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'customer',
  created_at  timestamptz not null default now(),
  constraint profiles_role_valid check (role in ('customer', 'studio'))
);

-- ---------------------------------------------------------------------
-- Paintings. IDs come from seed.json (e.g. 'p-001'); new paintings added
-- by the studio get a generated 'p-xxxxxxxx' id.
-- status = 'available' or 'sold'. A painting becomes 'sold' when bought
-- and goes back to 'available' only when THAT order is cancelled.
-- ---------------------------------------------------------------------
create table if not exists public.paintings (
  id          text primary key default ('p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  title       text not null,
  artist      text not null,
  description text not null default '',
  price       numeric(12,2) not null,
  image_url   text not null default '',
  status      text not null default 'available',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint paintings_title_not_blank  check (length(btrim(title)) > 0),
  constraint paintings_artist_not_blank check (length(btrim(artist)) > 0),
  constraint paintings_price_range      check (price > 0 and price <= 10000000),
  constraint paintings_status_valid     check (status in ('available', 'sold'))
);

create index if not exists paintings_status_idx on public.paintings (status);

-- ---------------------------------------------------------------------
-- Orders (painting purchases). Status: 'placed' or 'cancelled'.
-- price is COPIED from the painting inside the purchase function, so a
-- customer can never send their own price.
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.profiles (id) on delete cascade,
  painting_id   text not null references public.paintings (id) on delete restrict,
  price         numeric(12,2) not null,
  status        text not null default 'placed',
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  constraint orders_status_valid check (status in ('placed', 'cancelled')),
  constraint orders_price_positive check (price > 0),
  -- a cancelled order must have a cancel time, a placed one must not
  constraint orders_cancelled_at_matches check ((status = 'cancelled') = (cancelled_at is not null))
);

-- THE key rule: at most ONE active ('placed') order per painting.
-- Even if two customers click "Buy" at the same millisecond, the second
-- insert fails with a unique violation. Cancelled orders don't count.
create unique index if not exists orders_one_active_per_painting
  on public.orders (painting_id) where status = 'placed';

create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);

-- ---------------------------------------------------------------------
-- Wall (mural) bookings.
-- Status: requested -> confirmed | declined ; requested/confirmed -> cancelled
-- ---------------------------------------------------------------------
create table if not exists public.wall_bookings (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.profiles (id) on delete cascade,
  booking_date    date not null,
  wall_size_sqft  numeric(6,2) not null,
  address         text not null,
  rate_per_sqft   numeric(10,2) not null,   -- copied from studio_settings at booking time
  total_price     numeric(12,2) not null,   -- rate * size, calculated by the database
  status          text not null default 'requested',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bookings_size_range      check (wall_size_sqft between 10 and 500),
  constraint bookings_address_present check (length(btrim(address)) between 5 and 500),
  constraint bookings_rate_positive   check (rate_per_sqft > 0),
  constraint bookings_price_correct   check (total_price = round(rate_per_sqft * wall_size_sqft, 2)),
  constraint bookings_status_valid    check (status in ('requested', 'confirmed', 'declined', 'cancelled'))
);

-- One ACTIVE booking per date. Declined/cancelled bookings are excluded,
-- so they free the date for someone else.
create unique index if not exists bookings_one_active_per_date
  on public.wall_bookings (booking_date) where status in ('requested', 'confirmed');

create index if not exists bookings_customer_idx on public.wall_bookings (customer_id, booking_date desc);

-- ---------------------------------------------------------------------
-- Pottery reference data (from seed.json) and custom requests.
-- ---------------------------------------------------------------------
create table if not exists public.pottery_items (
  id    text primary key,
  name  text not null unique
);

create table if not exists public.glazes (
  id    text primary key,
  name  text not null unique
);

create table if not exists public.pottery_requests (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles (id) on delete cascade,
  item_id      text not null references public.pottery_items (id),
  glaze_id     text not null references public.glazes (id),
  quantity     integer not null,
  needed_by    date not null,
  notes        text not null default '',
  status       text not null default 'requested',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pottery_quantity_range check (quantity between 1 and 12),
  constraint pottery_notes_length   check (length(notes) <= 500),
  constraint pottery_status_valid   check (status in ('requested', 'accepted', 'declined', 'cancelled'))
);

create index if not exists pottery_customer_idx on public.pottery_requests (customer_id, created_at desc);
create index if not exists pottery_status_idx   on public.pottery_requests (status);
