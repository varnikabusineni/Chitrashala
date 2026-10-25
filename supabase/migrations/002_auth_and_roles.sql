-- =====================================================================
-- 002_auth_and_roles.sql — profiles, roles and permission helpers
--
-- HTTP status codes: Supabase's REST layer (PostgREST) turns an error
-- raised with SQLSTATE 'PTxyz' into HTTP status xyz. So:
--   PT401 = not logged in, PT403 = wrong role, PT404 = not found / not yours,
--   PT409 = conflict (already sold, date taken), PT400 = validation error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- When someone signs up through Supabase Auth, create their profile.
-- SECURITY: the role is ALWAYS 'customer'. We deliberately ignore any
-- "role" a user might put in their sign-up metadata.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that existed before this migration ran.
insert into public.profiles (id, email, role)
select u.id, coalesce(u.email, ''), 'customer'
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Defence in depth: even if someone later grants UPDATE on profiles by
-- mistake, a logged-in user (JWT role 'authenticated' or 'anon') can
-- never change a role. Only the SQL Editor (postgres) or the
-- service_role key used by scripts/provision-studio.js can.
-- ---------------------------------------------------------------------
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception using errcode = 'PT403', message = 'You cannot change your own role.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ---------------------------------------------------------------------
-- Permission helpers used by every business function in 003.
-- ---------------------------------------------------------------------

-- The role of the currently logged-in user, or NULL if not logged in.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- Used inside RLS policies. SECURITY DEFINER so it can read profiles
-- without triggering the profiles RLS policy (avoids infinite recursion).
create or replace function public.is_studio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'studio', false);
$$;

-- Raise 401 if not logged in. Returns the user's id.
create or replace function public.require_login()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception using errcode = 'PT401', message = 'Please log in to do that.';
  end if;
  return auth.uid();
end;
$$;

-- Raise 401 if not logged in, 403 if logged in but not a customer.
create or replace function public.require_customer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_id uuid := public.require_login();
begin
  if public.current_user_role() <> 'customer' then
    raise exception using errcode = 'PT403', message = 'Only customer accounts can do that.';
  end if;
  return user_id;
end;
$$;

-- Raise 401 if not logged in, 403 if logged in but not the studio admin.
create or replace function public.require_studio()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_id uuid := public.require_login();
begin
  if public.current_user_role() <> 'studio' then
    raise exception using errcode = 'PT403', message = 'Only the studio admin can do that.';
  end if;
  return user_id;
end;
$$;

-- "Today" for the studio, in Indian Standard Time, so the 7/14/90-day and
-- 3-day rules don't shift depending on the server's time zone.
create or replace function public.studio_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;
