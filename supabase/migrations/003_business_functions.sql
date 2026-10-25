-- =====================================================================
-- 003_business_functions.sql — every write the website can make
--
-- The browser NEVER inserts/updates tables directly (see 004: no
-- INSERT/UPDATE/DELETE grants). It can only call these functions via
-- supabase.rpc('function_name', {...}).
--
-- Each function:
--   1. checks who is calling (401 / 403),
--   2. checks ownership (404 if the record isn't yours),
--   3. validates input and the status transition (400 / 409),
--   4. does the work in ONE transaction (a function call is atomic:
--      if anything raises an error, every change in it is rolled back).
--
-- SECURITY DEFINER = the function runs with the owner's rights, which is
-- why it must do its own permission checks first. "set search_path = ''"
-- stops anyone from hijacking table names, so every name is qualified.
-- =====================================================================


-- =====================================================================
-- PAINTINGS & ORDERS
-- =====================================================================

-- Customer buys a painting. The price comes from the paintings table,
-- never from the browser.
create or replace function public.purchase_painting(p_painting_id text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id   uuid := public.require_customer();
  painting    public.paintings;
  new_order   public.orders;
begin
  -- ATOMIC CLAIM: flip available -> sold in a single UPDATE.
  -- If two customers buy at the same time, Postgres locks the row; the
  -- second UPDATE waits, re-checks "status = 'available'", finds 'sold'
  -- and updates nothing. So only one buyer can ever win.
  update public.paintings
     set status = 'sold', updated_at = now()
   where id = p_painting_id
     and status = 'available'
  returning * into painting;

  if not found then
    if exists (select 1 from public.paintings where id = p_painting_id) then
      raise exception using errcode = 'PT409',
        message = 'Sorry, this painting has already been sold.';
    end if;
    raise exception using errcode = 'PT404', message = 'Painting not found.';
  end if;

  -- Second safety net: the unique index orders_one_active_per_painting.
  begin
    insert into public.orders (customer_id, painting_id, price)
    values (caller_id, painting.id, painting.price)
    returning * into new_order;
  exception when unique_violation then
    raise exception using errcode = 'PT409',
      message = 'Sorry, this painting has already been sold.';
  end;

  return new_order;
end;
$$;

-- Customer cancels their own order; the painting becomes available again.
create or replace function public.cancel_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id   uuid := public.require_customer();
  the_order   public.orders;
begin
  -- "FOR UPDATE" locks the order so a double-click can't cancel twice.
  -- Someone else's order looks exactly like a missing one: 404.
  select * into the_order
    from public.orders o
   where o.id = p_order_id and o.customer_id = caller_id
   for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Order not found.';
  end if;

  if the_order.status <> 'placed' then
    raise exception using errcode = 'PT409', message = 'This order is already cancelled.';
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where id = the_order.id
  returning * into the_order;

  -- Restore availability. Only paintings that had a real order can reach
  -- this line, so paintings seeded as 'sold' (no order) stay sold forever.
  update public.paintings
     set status = 'available', updated_at = now()
   where id = the_order.painting_id
     and status = 'sold';

  return the_order;
end;
$$;

-- Shared validation for studio add/edit painting.
create or replace function public.validate_painting_input(
  p_title text, p_artist text, p_description text, p_price numeric, p_image_url text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_title is null or length(btrim(p_title)) = 0 or length(p_title) > 200 then
    raise exception using errcode = 'PT400', message = 'Title is required (max 200 characters).';
  end if;
  if p_artist is null or length(btrim(p_artist)) = 0 or length(p_artist) > 120 then
    raise exception using errcode = 'PT400', message = 'Artist is required (max 120 characters).';
  end if;
  if length(coalesce(p_description, '')) > 2000 then
    raise exception using errcode = 'PT400', message = 'Description must be at most 2000 characters.';
  end if;
  if p_price is null or p_price <= 0 or p_price > 10000000 then
    raise exception using errcode = 'PT400', message = 'Price must be between 1 and 1,00,00,000.';
  end if;
  if length(coalesce(p_image_url, '')) > 500 then
    raise exception using errcode = 'PT400', message = 'Image path is too long.';
  end if;
end;
$$;

-- Studio admin adds a new painting (always starts 'available').
create or replace function public.studio_add_painting(
  p_title text, p_artist text, p_description text, p_price numeric, p_image_url text)
returns public.paintings
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_painting public.paintings;
begin
  perform public.require_studio();
  perform public.validate_painting_input(p_title, p_artist, p_description, p_price, p_image_url);

  insert into public.paintings (title, artist, description, price, image_url, status)
  values (btrim(p_title), btrim(p_artist), btrim(coalesce(p_description, '')),
          round(p_price, 2), btrim(coalesce(p_image_url, '')), 'available')
  returning * into new_painting;

  return new_painting;
end;
$$;

-- Studio admin edits a painting — only while it is still available.
create or replace function public.studio_update_painting(
  p_painting_id text, p_title text, p_artist text, p_description text,
  p_price numeric, p_image_url text)
returns public.paintings
language plpgsql
security definer
set search_path = ''
as $$
declare
  painting public.paintings;
begin
  perform public.require_studio();

  -- Lock the row so a purchase can't happen halfway through the edit.
  select * into painting from public.paintings where id = p_painting_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Painting not found.';
  end if;
  if painting.status <> 'available' then
    raise exception using errcode = 'PT409', message = 'Sold paintings cannot be edited.';
  end if;

  perform public.validate_painting_input(p_title, p_artist, p_description, p_price, p_image_url);

  update public.paintings
     set title = btrim(p_title),
         artist = btrim(p_artist),
         description = btrim(coalesce(p_description, '')),
         price = round(p_price, 2),
         image_url = btrim(coalesce(p_image_url, '')),
         updated_at = now()
   where id = p_painting_id
  returning * into painting;

  return painting;
end;
$$;


-- =====================================================================
-- WALL BOOKINGS
-- =====================================================================

-- Customer requests a mural on a date 7–90 days away.
create or replace function public.create_wall_booking(
  p_booking_date date, p_wall_size_sqft numeric, p_address text)
returns public.wall_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id     uuid := public.require_customer();
  days_ahead    integer;
  wall_size     numeric(6,2);
  rate          numeric(10,2);
  new_booking   public.wall_bookings;
begin
  -- Validate the date window against the STUDIO's today, not the browser's.
  if p_booking_date is null then
    raise exception using errcode = 'PT400', message = 'Please choose a date.';
  end if;
  days_ahead := p_booking_date - public.studio_today();
  if days_ahead < 7 or days_ahead > 90 then
    raise exception using errcode = 'PT400',
      message = 'Please choose a date between 7 and 90 days from today.';
  end if;

  if p_wall_size_sqft is null or p_wall_size_sqft < 10 or p_wall_size_sqft > 500 then
    raise exception using errcode = 'PT400', message = 'Wall size must be between 10 and 500 sq ft.';
  end if;
  wall_size := round(p_wall_size_sqft, 2);

  if p_address is null or length(btrim(p_address)) < 5 or length(p_address) > 500 then
    raise exception using errcode = 'PT400', message = 'Please enter the full wall address.';
  end if;

  -- Price = seeded rate x size, calculated here. The browser's live
  -- calculator is only a preview.
  select s.mural_rate_per_sqft into rate from public.studio_settings s where s.id;
  if rate is null then
    raise exception 'Studio settings are missing. Run supabase/seed.sql first.';
  end if;

  -- The unique index bookings_one_active_per_date is what really prevents
  -- double booking: if two customers submit the same date at once, the
  -- second INSERT fails and we turn that into a friendly 409.
  begin
    insert into public.wall_bookings
      (customer_id, booking_date, wall_size_sqft, address, rate_per_sqft, total_price)
    values
      (caller_id, p_booking_date, wall_size, btrim(p_address), rate, round(rate * wall_size, 2))
    returning * into new_booking;
  exception when unique_violation then
    raise exception using errcode = 'PT409',
      message = 'That date is already booked. Please choose another date.';
  end;

  return new_booking;
end;
$$;

-- Customer cancels their own booking, up to 3 days before the date.
create or replace function public.cancel_wall_booking(p_booking_id uuid)
returns public.wall_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id   uuid := public.require_customer();
  booking     public.wall_bookings;
begin
  select * into booking
    from public.wall_bookings b
   where b.id = p_booking_id and b.customer_id = caller_id
   for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Booking not found.';
  end if;

  if booking.status not in ('requested', 'confirmed') then
    raise exception using errcode = 'PT409',
      message = format('This booking is already %s.', booking.status);
  end if;

  -- Last day to cancel = booking date minus 3 days.
  if public.studio_today() > booking.booking_date - 3 then
    raise exception using errcode = 'PT409',
      message = format('Bookings can only be cancelled until 3 days before the date (last day was %s).',
                       to_char(booking.booking_date - 3, 'DD Mon YYYY'));
  end if;

  update public.wall_bookings
     set status = 'cancelled', updated_at = now()
   where id = booking.id
  returning * into booking;

  return booking;
end;
$$;

-- Studio admin confirms or declines a 'requested' booking.
create or replace function public.studio_set_booking_status(p_booking_id uuid, p_new_status text)
returns public.wall_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.wall_bookings;
begin
  perform public.require_studio();

  if p_new_status is null or p_new_status not in ('confirmed', 'declined') then
    raise exception using errcode = 'PT400', message = 'Status must be confirmed or declined.';
  end if;

  select * into booking from public.wall_bookings where id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Booking not found.';
  end if;

  if booking.status <> 'requested' then
    raise exception using errcode = 'PT409',
      message = format('Only requested bookings can be changed (this one is %s).', booking.status);
  end if;

  if p_new_status = 'confirmed' and booking.booking_date < public.studio_today() then
    raise exception using errcode = 'PT409', message = 'This booking date has already passed.';
  end if;

  update public.wall_bookings
     set status = p_new_status, updated_at = now()
   where id = booking.id
  returning * into booking;

  return booking;
end;
$$;


-- =====================================================================
-- POTTERY REQUESTS
-- =====================================================================

-- Shared validation for create and edit.
create or replace function public.validate_pottery_input(
  p_item_id text, p_glaze_id text, p_quantity integer, p_needed_by date, p_notes text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_item_id is null or not exists (select 1 from public.pottery_items where id = p_item_id) then
    raise exception using errcode = 'PT400', message = 'Please choose a pottery item from the list.';
  end if;
  if p_glaze_id is null or not exists (select 1 from public.glazes where id = p_glaze_id) then
    raise exception using errcode = 'PT400', message = 'Please choose a glaze from the list.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 12 then
    raise exception using errcode = 'PT400', message = 'Quantity must be between 1 and 12.';
  end if;
  if p_needed_by is null or p_needed_by < public.studio_today() + 14 then
    raise exception using errcode = 'PT400',
      message = 'The needed-by date must be at least 14 days from today.';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = 'PT400', message = 'Notes must be at most 500 characters.';
  end if;
end;
$$;

create or replace function public.create_pottery_request(
  p_item_id text, p_glaze_id text, p_quantity integer, p_needed_by date, p_notes text)
returns public.pottery_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id   uuid := public.require_customer();
  new_request public.pottery_requests;
begin
  perform public.validate_pottery_input(p_item_id, p_glaze_id, p_quantity, p_needed_by, p_notes);

  insert into public.pottery_requests (customer_id, item_id, glaze_id, quantity, needed_by, notes)
  values (caller_id, p_item_id, p_glaze_id, p_quantity, p_needed_by, btrim(coalesce(p_notes, '')))
  returning * into new_request;

  return new_request;
end;
$$;

-- Customer edits their own request — only while it is still 'requested'.
create or replace function public.update_pottery_request(
  p_request_id uuid, p_item_id text, p_glaze_id text, p_quantity integer,
  p_needed_by date, p_notes text)
returns public.pottery_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id   uuid := public.require_customer();
  request     public.pottery_requests;
begin
  select * into request
    from public.pottery_requests r
   where r.id = p_request_id and r.customer_id = caller_id
   for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Pottery request not found.';
  end if;
  if request.status <> 'requested' then
    raise exception using errcode = 'PT409',
      message = format('This request is already %s and can no longer be edited.', request.status);
  end if;

  perform public.validate_pottery_input(p_item_id, p_glaze_id, p_quantity, p_needed_by, p_notes);

  update public.pottery_requests
     set item_id = p_item_id, glaze_id = p_glaze_id, quantity = p_quantity,
         needed_by = p_needed_by, notes = btrim(coalesce(p_notes, '')), updated_at = now()
   where id = request.id
  returning * into request;

  return request;
end;
$$;

-- Customer cancels their own request — only while it is still 'requested'.
create or replace function public.cancel_pottery_request(p_request_id uuid)
returns public.pottery_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id   uuid := public.require_customer();
  request     public.pottery_requests;
begin
  select * into request
    from public.pottery_requests r
   where r.id = p_request_id and r.customer_id = caller_id
   for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Pottery request not found.';
  end if;
  if request.status <> 'requested' then
    raise exception using errcode = 'PT409',
      message = format('This request is already %s and can no longer be cancelled.', request.status);
  end if;

  update public.pottery_requests
     set status = 'cancelled', updated_at = now()
   where id = request.id
  returning * into request;

  return request;
end;
$$;

-- Studio admin accepts or declines a 'requested' pottery request.
create or replace function public.studio_set_pottery_status(p_request_id uuid, p_new_status text)
returns public.pottery_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.pottery_requests;
begin
  perform public.require_studio();

  if p_new_status is null or p_new_status not in ('accepted', 'declined') then
    raise exception using errcode = 'PT400', message = 'Status must be accepted or declined.';
  end if;

  select * into request from public.pottery_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pottery request not found.';
  end if;
  if request.status <> 'requested' then
    raise exception using errcode = 'PT409',
      message = format('Only requested items can be changed (this one is %s).', request.status);
  end if;

  update public.pottery_requests
     set status = p_new_status, updated_at = now()
   where id = request.id
  returning * into request;

  return request;
end;
$$;


-- =====================================================================
-- SINGLE-RECORD READS with explicit HTTP codes
-- (401 if logged out, 404 if the record doesn't exist OR isn't yours —
-- we never reveal that someone else's record exists.)
-- =====================================================================

create or replace function public.get_order(p_order_id uuid)
returns public.orders
language plpgsql stable security definer set search_path = ''
as $$
declare
  user_id uuid := public.require_login();
  result  public.orders;
begin
  select * into result from public.orders o
   where o.id = p_order_id and (o.customer_id = user_id or public.is_studio());
  if not found then
    raise exception using errcode = 'PT404', message = 'Order not found.';
  end if;
  return result;
end;
$$;

create or replace function public.get_wall_booking(p_booking_id uuid)
returns public.wall_bookings
language plpgsql stable security definer set search_path = ''
as $$
declare
  user_id uuid := public.require_login();
  result  public.wall_bookings;
begin
  select * into result from public.wall_bookings b
   where b.id = p_booking_id and (b.customer_id = user_id or public.is_studio());
  if not found then
    raise exception using errcode = 'PT404', message = 'Booking not found.';
  end if;
  return result;
end;
$$;

create or replace function public.get_pottery_request(p_request_id uuid)
returns public.pottery_requests
language plpgsql stable security definer set search_path = ''
as $$
declare
  user_id uuid := public.require_login();
  result  public.pottery_requests;
begin
  select * into result from public.pottery_requests r
   where r.id = p_request_id and (r.customer_id = user_id or public.is_studio());
  if not found then
    raise exception using errcode = 'PT404', message = 'Pottery request not found.';
  end if;
  return result;
end;
$$;

-- Dates already taken (for the booking form). Returns only dates, never
-- who booked them, so it is safe for any logged-in customer to call.
create or replace function public.booked_wall_dates()
returns setof date
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_login();
  return query
    select b.booking_date from public.wall_bookings b
     where b.status in ('requested', 'confirmed')
       and b.booking_date >= public.studio_today()
     order by 1;
end;
$$;
