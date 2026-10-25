-- =====================================================================
-- 004_rls_and_grants.sql — Row Level Security and permissions
--
-- Two layers protect the data:
--   1. GRANTS decide WHAT a role may do at all. Browsers (roles 'anon'
--      and 'authenticated') get SELECT only. No INSERT/UPDATE/DELETE —
--      all changes must go through the checked functions in 003.
--   2. RLS POLICIES decide WHICH ROWS a role may see: customers see only
--      their own orders/bookings/requests, the studio sees everything.
-- =====================================================================

-- ---------- Turn on RLS for every table ----------
alter table public.studio_settings  enable row level security;
alter table public.profiles         enable row level security;
alter table public.paintings        enable row level security;
alter table public.orders           enable row level security;
alter table public.wall_bookings    enable row level security;
alter table public.pottery_items    enable row level security;
alter table public.glazes           enable row level security;
alter table public.pottery_requests enable row level security;

-- ---------- Table grants: read-only for the browser ----------
revoke all on all tables in schema public from anon, authenticated;

-- Public catalogue data: anyone (even logged out) may read it.
grant select on public.paintings, public.pottery_items, public.glazes, public.studio_settings
  to anon, authenticated;

-- Private data: logged-in users only (rows filtered by the policies below).
grant select on public.profiles, public.orders, public.wall_bookings, public.pottery_requests
  to authenticated;

-- Server-side scripts using the secret service_role key (never shipped to
-- the browser) may manage everything, e.g. scripts/provision-studio.js.
grant all on all tables in schema public to service_role;

-- ---------- Policies (drop first so this file can be re-run) ----------
drop policy if exists "Anyone can read studio settings" on public.studio_settings;
create policy "Anyone can read studio settings" on public.studio_settings
  for select using (true);

drop policy if exists "Anyone can read paintings" on public.paintings;
create policy "Anyone can read paintings" on public.paintings
  for select using (true);

drop policy if exists "Anyone can read pottery items" on public.pottery_items;
create policy "Anyone can read pottery items" on public.pottery_items
  for select using (true);

drop policy if exists "Anyone can read glazes" on public.glazes;
create policy "Anyone can read glazes" on public.glazes
  for select using (true);

drop policy if exists "Users read own profile, studio reads all" on public.profiles;
create policy "Users read own profile, studio reads all" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_studio());

drop policy if exists "Customers read own orders, studio reads all" on public.orders;
create policy "Customers read own orders, studio reads all" on public.orders
  for select to authenticated
  using (customer_id = auth.uid() or public.is_studio());

drop policy if exists "Customers read own bookings, studio reads all" on public.wall_bookings;
create policy "Customers read own bookings, studio reads all" on public.wall_bookings
  for select to authenticated
  using (customer_id = auth.uid() or public.is_studio());

drop policy if exists "Customers read own pottery requests, studio reads all" on public.pottery_requests;
create policy "Customers read own pottery requests, studio reads all" on public.pottery_requests
  for select to authenticated
  using (customer_id = auth.uid() or public.is_studio());

-- ---------- Function grants ----------
-- Start from "nobody can call anything", then allow only the API.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Needed inside RLS policies (policies run as the caller).
grant execute on function public.is_studio()          to anon, authenticated;
grant execute on function public.current_user_role()  to anon, authenticated;
grant execute on function public.studio_today()       to anon, authenticated;

-- The website's API. anon is allowed to CALL them so that a logged-out
-- request reaches require_login() and gets a clear HTTP 401 message.
grant execute on function
  public.purchase_painting(text),
  public.cancel_order(uuid),
  public.studio_add_painting(text, text, text, numeric, text),
  public.studio_update_painting(text, text, text, text, numeric, text),
  public.create_wall_booking(date, numeric, text),
  public.cancel_wall_booking(uuid),
  public.studio_set_booking_status(uuid, text),
  public.create_pottery_request(text, text, integer, date, text),
  public.update_pottery_request(uuid, text, text, integer, date, text),
  public.cancel_pottery_request(uuid),
  public.studio_set_pottery_status(uuid, text),
  public.get_order(uuid),
  public.get_wall_booking(uuid),
  public.get_pottery_request(uuid),
  public.booked_wall_dates()
to anon, authenticated;

grant execute on all functions in schema public to service_role;
