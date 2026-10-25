-- =====================================================================
-- tests/database_tests.sql — automated checks of every business rule.
-- Run with:  bash tests/run-db-tests.sh   (needs a local PostgreSQL)
--
-- "set role authenticated" + tests.login(...) imitates a logged-in
-- browser request; "set role anon" imitates a logged-out one.
-- Any failed check stops the script with "FAIL ...".
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- Test helpers
-- ---------------------------------------------------------------------
create schema tests;
grant usage on schema tests to public;

create function tests.assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end $$;

-- Runs a statement and checks it fails with the expected SQLSTATE
-- (PT401/PT403/PT404/PT409/PT400 become HTTP 401/403/404/409/400).
create function tests.expect_error(stmt text, expected_state text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = expected_state then
      raise notice 'PASS: % -> % "%"', label, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % -> expected % but got % "%"', label, expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % -> expected error % but it succeeded', label, expected_state;
end $$;

-- Pretend to be logged in as this email (like a JWT would say).
create function tests.login(user_email text) returns void
language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = user_email), false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end $$;

create function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
end $$;

grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------
-- Users: two customers and the studio. "alice" tries to sneak in a role.
-- ---------------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data) values
  ('alice@example.com', '{"full_name": "Alice", "role": "studio"}'),
  ('bob@example.com',   '{"full_name": "Bob"}'),
  ('studio@artstudio.in', '{}');

select tests.assert((select role from public.profiles where email = 'alice@example.com') = 'customer',
  'sign-up metadata cannot make a user studio: new users are always customer');

-- Provision the studio admin the same way the README describes.
update public.profiles set role = 'studio' where email = 'studio@artstudio.in';

select tests.assert((select count(*) from public.paintings) = 12, 'seed: 12 paintings');
select tests.assert((select count(*) from public.pottery_items) = 5, 'seed: 5 pottery items');
select tests.assert((select count(*) from public.glazes) = 6, 'seed: 6 glazes');
select tests.assert((select mural_rate_per_sqft from public.studio_settings) = 150, 'seed: rate 150/sqft');
select tests.assert((select string_agg(id, ',' order by id) from public.paintings where status = 'sold') = 'p-004,p-009',
  'seed: p-004 and p-009 start sold');

-- =====================================================================
-- 401 — logged out
-- =====================================================================
set role anon;
select tests.logout();
select tests.assert((select count(*) from public.paintings) = 12, 'logged-out visitors can browse paintings');
select tests.expect_error($q$ select public.purchase_painting('p-001') $q$, 'PT401', 'logged-out purchase is 401');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 10, 100, '12 MG Road, Pune') $q$,
  'PT401', 'logged-out booking is 401');
select tests.expect_error($q$ select public.studio_add_painting('x','y','',100,'') $q$, 'PT401', 'logged-out admin call is 401');
select tests.expect_error($q$ select public.booked_wall_dates() $q$, 'PT401', 'logged-out booked dates is 401');
select tests.expect_error($q$ select * from public.orders $q$, '42501', 'logged-out cannot read orders table');
reset role;

-- =====================================================================
-- Paintings and orders
-- =====================================================================
set role authenticated;
select tests.login('studio@artstudio.in');
select tests.expect_error($q$ select public.purchase_painting('p-001') $q$, 'PT403', 'studio account buying is 403 (customer-only action)');

select tests.login('alice@example.com');
select tests.expect_error($q$ select public.studio_add_painting('x','y','',100,'') $q$, 'PT403', 'customer adding painting is 403');
select tests.expect_error($q$ select public.studio_update_painting('p-001','x','y','',1,'') $q$, 'PT403', 'customer editing painting is 403');
select tests.expect_error($q$ update public.profiles set role = 'studio' $q$, '42501', 'customer cannot update own role (no grant)');
select tests.expect_error($q$ insert into public.orders (customer_id, painting_id, price) values (auth.uid(), 'p-002', 1) $q$,
  '42501', 'customer cannot insert orders directly (no grant)');
select tests.expect_error($q$ update public.paintings set status = 'available' where id = 'p-004' $q$,
  '42501', 'customer cannot update paintings directly');

select id as alice_order from public.purchase_painting('p-001') \gset
select tests.assert((select price from public.orders where id = :'alice_order') = 6500, 'order price copied from painting (6500)');
select tests.assert((select status from public.paintings where id = 'p-001') = 'sold', 'purchased painting becomes sold');
select tests.expect_error($q$ select public.purchase_painting('p-001') $q$, 'PT409', 'buying the same painting twice is 409');
select tests.expect_error($q$ select public.purchase_painting('p-004') $q$, 'PT409', 'seeded sold painting cannot be bought (409)');
select tests.expect_error($q$ select public.purchase_painting('p-999') $q$, 'PT404', 'unknown painting is 404');

select tests.login('bob@example.com');
select tests.expect_error($q$ select public.purchase_painting('p-001') $q$, 'PT409', 'another customer cannot buy a sold painting (409)');
select tests.assert((select count(*) from public.orders) = 0, 'bob sees none of alice''s orders (RLS)');
select tests.expect_error(format('select public.cancel_order(%L)', :'alice_order'), 'PT404', 'bob cancelling alice''s order is 404');
select tests.expect_error(format('select public.get_order(%L)', :'alice_order'), 'PT404', 'bob reading alice''s order is 404');

select tests.login('studio@artstudio.in');
select tests.assert((select count(*) from public.orders) = 1, 'studio sees all orders');
select tests.expect_error($q$ select public.studio_update_painting('p-001','New','Artist','',10,'') $q$,
  'PT409', 'studio cannot edit a sold painting (409)');
select tests.expect_error($q$ select public.studio_update_painting('p-004','New','Artist','',10,'') $q$,
  'PT409', 'studio cannot edit seeded sold painting (409)');

select tests.login('alice@example.com');
select tests.assert((select count(*) from public.orders) = 1, 'alice sees her own order');
select public.cancel_order(:'alice_order') \gset ignored_
select tests.assert((select status from public.orders where id = :'alice_order') = 'cancelled', 'order is cancelled');
select tests.assert((select status from public.paintings where id = 'p-001') = 'available', 'cancelling makes the painting available again');
select tests.expect_error(format('select public.cancel_order(%L)', :'alice_order'), 'PT409', 'cancelling twice is 409');

select tests.login('bob@example.com');
select id as bob_order from public.purchase_painting('p-001') \gset
select tests.assert((select count(*) from public.orders where status = 'placed') = 1, 'cancelled order does not block a new purchase');

-- =====================================================================
-- Studio painting management
-- =====================================================================
select tests.login('studio@artstudio.in');
select id as new_painting from public.studio_add_painting('Test Canvas', 'Test Artist', 'desc', 999.5, '') \gset
select tests.assert((select status from public.paintings where id = :'new_painting') = 'available', 'new painting starts available');
select tests.expect_error($q$ select public.studio_add_painting('', 'A', '', 10, '') $q$, 'PT400', 'blank title is 400');
select tests.expect_error($q$ select public.studio_add_painting('T', 'A', '', -5, '') $q$, 'PT400', 'negative price is 400');
select public.studio_update_painting('p-002', 'Warli Village Scene (Small)', 'Anil Gavit', 'Edited', 1900, 'images/p-002.jpg') \gset ignored_
select tests.assert((select price from public.paintings where id = 'p-002') = 1900, 'studio can edit an available painting');

-- =====================================================================
-- Wall bookings
-- =====================================================================
select tests.login('alice@example.com');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 6, 100, '12 MG Road, Pune') $q$, 'PT400', 'date 6 days away is 400');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 91, 100, '12 MG Road, Pune') $q$, 'PT400', 'date 91 days away is 400');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 10, 9.99, '12 MG Road, Pune') $q$, 'PT400', 'size below 10 is 400');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 10, 500.01, '12 MG Road, Pune') $q$, 'PT400', 'size above 500 is 400');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 10, 100, '   ') $q$, 'PT400', 'blank address is 400');

select id as alice_booking from public.create_wall_booking(public.studio_today() + 7, 100, '12 MG Road, Pune') \gset
select tests.assert((select total_price from public.wall_bookings where id = :'alice_booking') = 15000, 'price = 100 sqft x 150 = 15000');
select id as alice_booking_90 from public.create_wall_booking(public.studio_today() + 90, 10, '12 MG Road, Pune') \gset
select tests.assert(true, 'boundary dates 7 and 90 days and size 10 accepted');

select tests.login('bob@example.com');
select tests.expect_error($q$ select public.create_wall_booking(public.studio_today() + 7, 50, '1 Park Street, Kolkata') $q$,
  'PT409', 'same date already booked is 409');
select tests.expect_error(format('select public.cancel_wall_booking(%L)', :'alice_booking'), 'PT404', 'bob cancelling alice''s booking is 404');
select tests.expect_error(format('select public.studio_set_booking_status(%L, %L)', :'alice_booking', 'declined'),
  'PT403', 'customer confirming/declining is 403');
select tests.assert((select count(*) from public.booked_wall_dates()) = 2, 'booked dates visible (dates only)');

select tests.login('studio@artstudio.in');
select public.studio_set_booking_status(:'alice_booking', 'declined') \gset ignored_
select tests.expect_error(format('select public.studio_set_booking_status(%L, %L)', :'alice_booking', 'confirmed'),
  'PT409', 'cannot confirm an already declined booking (409)');
select tests.expect_error(format('select public.studio_set_booking_status(%L, %L)', :'alice_booking_90', 'cancelled'),
  'PT400', 'studio status must be confirmed/declined (400)');

select tests.login('bob@example.com');
select id as bob_booking from public.create_wall_booking(public.studio_today() + 7, 50, '1 Park Street, Kolkata') \gset
select tests.assert((select total_price from public.wall_bookings where id = :'bob_booking') = 7500, 'declined booking frees the date for someone else');

select tests.login('studio@artstudio.in');
select public.studio_set_booking_status(:'bob_booking', 'confirmed') \gset ignored_

select tests.login('bob@example.com');
select public.cancel_wall_booking(:'bob_booking') \gset ignored_
select tests.assert((select status from public.wall_bookings where id = :'bob_booking') = 'cancelled', 'customer can cancel a confirmed booking 7 days ahead');
select tests.expect_error(format('select public.cancel_wall_booking(%L)', :'bob_booking'), 'PT409', 'cancelling twice is 409');

-- 3-day cancellation rule: create bookings close to the date as the owner
-- (customers can't book that close, so the database owner inserts them).
reset role;
insert into public.wall_bookings (customer_id, booking_date, wall_size_sqft, address, rate_per_sqft, total_price)
select p.id, public.studio_today() + d, 20, 'Close date test', 150, 3000
  from public.profiles p, (values (2), (3)) as days(d)
 where p.email = 'alice@example.com';
set role authenticated;
select tests.login('alice@example.com');
select tests.expect_error(format('select public.cancel_wall_booking(%L)',
  (select id from public.wall_bookings where booking_date = public.studio_today() + 2)),
  'PT409', 'cancelling 2 days before the date is 409');
select public.cancel_wall_booking((select id from public.wall_bookings where booking_date = public.studio_today() + 3)) \gset ignored_
select tests.assert(true, 'cancelling exactly 3 days before the date is allowed');

-- =====================================================================
-- Pottery requests
-- =====================================================================
select tests.expect_error($q$ select public.create_pottery_request('i-01','g-01', 0, public.studio_today() + 20, '') $q$, 'PT400', 'quantity 0 is 400');
select tests.expect_error($q$ select public.create_pottery_request('i-01','g-01', 13, public.studio_today() + 20, '') $q$, 'PT400', 'quantity 13 is 400');
select tests.expect_error($q$ select public.create_pottery_request('i-01','g-01', 2, public.studio_today() + 13, '') $q$, 'PT400', 'needed-by 13 days away is 400');
select tests.expect_error($q$ select public.create_pottery_request('i-99','g-01', 2, public.studio_today() + 20, '') $q$, 'PT400', 'unknown item is 400');
select tests.expect_error($q$ select public.create_pottery_request('i-01','g-99', 2, public.studio_today() + 20, '') $q$, 'PT400', 'unknown glaze is 400');

select id as pot1 from public.create_pottery_request('i-01', 'g-01', 12, public.studio_today() + 14, 'For a party') \gset
select id as pot2 from public.create_pottery_request('i-04', 'g-02', 1, public.studio_today() + 30, '') \gset
select public.update_pottery_request(:'pot1', 'i-02', 'g-04', 6, public.studio_today() + 20, 'Changed') \gset ignored_
select tests.assert((select quantity from public.pottery_requests where id = :'pot1') = 6, 'customer can edit a requested pottery request');

select tests.login('bob@example.com');
select tests.expect_error(format('select public.update_pottery_request(%L, %L, %L, 1, public.studio_today() + 20, %L)', :'pot1', 'i-01', 'g-01', ''),
  'PT404', 'bob editing alice''s pottery request is 404');
select tests.expect_error(format('select public.cancel_pottery_request(%L)', :'pot1'), 'PT404', 'bob cancelling alice''s pottery request is 404');
select tests.expect_error(format('select public.studio_set_pottery_status(%L, %L)', :'pot1', 'accepted'), 'PT403', 'customer accepting pottery is 403');

select tests.login('studio@artstudio.in');
select public.studio_set_pottery_status(:'pot1', 'accepted') \gset ignored_
select tests.expect_error(format('select public.studio_set_pottery_status(%L, %L)', :'pot1', 'declined'), 'PT409', 'cannot decline an accepted request (409)');
select tests.expect_error($q$ select public.create_pottery_request('i-01','g-01', 2, public.studio_today() + 20, '') $q$, 'PT403', 'studio creating pottery request is 403');

select tests.login('alice@example.com');
select tests.expect_error(format('select public.update_pottery_request(%L, %L, %L, 1, public.studio_today() + 20, %L)', :'pot1', 'i-01', 'g-01', ''),
  'PT409', 'editing an accepted request is 409');
select tests.expect_error(format('select public.cancel_pottery_request(%L)', :'pot1'), 'PT409', 'cancelling an accepted request is 409');
select public.cancel_pottery_request(:'pot2') \gset ignored_
select tests.assert((select status from public.pottery_requests where id = :'pot2') = 'cancelled', 'customer can cancel a requested pottery request');

-- =====================================================================
-- Re-running the seed must not duplicate or reset anything
-- =====================================================================
reset role;
select tests.login('studio@artstudio.in');
\i supabase/seed.sql
\set QUIET on
select tests.assert((select count(*) from public.paintings) = 13, 'seed re-run: still 12 seeded + 1 added painting');
select tests.assert((select count(*) from public.glazes) = 6 and (select count(*) from public.pottery_items) = 5, 'seed re-run: no duplicate pottery data');
select tests.assert((select status from public.paintings where id = 'p-001') = 'sold', 'seed re-run does not reset a bought painting');
select tests.assert((select price from public.paintings where id = 'p-002') = 1900, 'seed re-run keeps studio edits');

\echo 'ALL DATABASE TESTS PASSED'
