# INTERVIEW_PREP.md — Explaining this project

Everything below describes the code **as it is in this repo**. File and function names are real, so you can open them while you practise.

---

## 1. What each file does

| File | In one sentence |
|---|---|
| `index.html` | The page skeleton: header and navigation, an empty `<main id="app">` that `app.js` fills, the footer, the toast area and a reusable confirm `<dialog>`. It loads supabase-js, `config.js` and `app.js`. |
| `style.css` | The single design system: colour tokens (`--cream`, `--cobalt`, `--coral`, `--butter`, `--green`, `--ink`), Marcellus and Albert Sans, sage and butter colours, the curved-text logo, rounded photo cards, the scrolling ribbon and the painting slider, tags, gallery grid, forms, swatches, badges, skeletons, states and responsive rules. |
| `app.js` | All frontend behaviour, in 9 numbered sections: setup, helpers, UI blocks, database calls, login state, router, pages, click actions, start. |
| `config.js` *(generated, git-ignored)* | `window.APP_CONFIG` with the public Supabase URL and anon key. |
| `config.example.js` | Template for `config.js`. |
| `supabase/migrations/001_schema.sql` | Tables, primary/foreign keys, CHECK rules, unique and partial unique indexes. |
| `supabase/migrations/002_auth_and_roles.sql` | `profiles`, the sign-up trigger that always creates customers, the role-change guard, and the `require_login`/`require_customer`/`require_studio`/`is_studio`/`studio_today` helpers. |
| `supabase/migrations/003_business_functions.sql` | Every write: `purchase_painting`, `cancel_order`, `create_wall_booking`, `cancel_wall_booking`, the pottery create/update/cancel functions, the studio actions, and the `get_*` reads. |
| `supabase/migrations/004_rls_and_grants.sql` | RLS on every table, SELECT-only grants for browsers, the policies, and which functions can be called. |
| `supabase/seed.sql` | Idempotent import of settings, 12 paintings, 5 items and 6 glazes (generated). |
| `seed/seed.json` | The source dataset, with the password removed. |
| `images/` | The 12 real painting images. |
| `scripts/build-seed-sql.js` | Turns `seed.json` into `seed.sql` and checks that the images exist. |
| `scripts/generate-config.js` | Copies the public values from `.env` into `config.js`; refuses service-role keys. |
| `scripts/provision-studio.js` | Creates the studio Auth user and sets `role = 'studio'` using the secret key from `.env`. |
| `scripts/env.js` | A 30-line `.env` parser, so no npm packages are needed. |
| `tests/*` | A Supabase stub, 75 SQL checks, and two concurrency tests. |
| `.env.example`, `.gitignore`, `README.md`, `DESIGN.md` | Configuration template, secrets protection, and documentation. |

---

## 2. A purchase, from button click to database

1. **Render.** `paintingCard()` → `paintingActions()` shows `<button data-action="buy" data-id="p-001">` only to a logged-in customer viewing an available painting.
2. **Click.** One listener on `#app` finds `data-action="buy"` and looks it up in the `clickActions` map, which calls `handleBuy(button)`.
3. **Confirm.** `confirmAction()` opens the native `<dialog>`; the code continues only if the user clicks "Buy".
4. **API call.** `callFunction("purchase_painting", { p_painting_id: "p-001" })` → `db.rpc(...)`. supabase-js sends `POST /rest/v1/rpc/purchase_painting` with the **anon key** and the user's **JWT**. *Only the id is sent: no price, no user id.*
5. **In PostgreSQL**, the function `purchase_painting` (SECURITY DEFINER):
   - `require_customer()`: no token → **401**, not a customer → **403**.
   - Atomic `UPDATE paintings SET status='sold' WHERE id=… AND status='available'`. Zero rows → it checks whether the painting exists: if yes, **409 "already sold"**, otherwise **404**.
   - `INSERT INTO orders (customer_id, painting_id, price) VALUES (caller_id, painting.id, painting.price)`, with the price taken from the database. A `unique_violation` from `orders_one_active_per_painting` → **409**.
   - The function is one transaction: all of it commits, or none of it does.
6. **Back in the browser.** `result.ok` → success toast; otherwise `friendlyError()` shows the database's message (it uses the message directly for `PT…` codes). Either way `loadAndRenderGallery()` reloads, so the card shows the true status.

---

## 3. Login and role authorization, in 30 seconds

> "Supabase Auth handles passwords and gives the browser a signed JWT. In SQL, `auth.uid()` reads the user id from that token, so it can't be faked. Roles are in my own `profiles` table. A trigger creates every new user as a customer, and browsers have no UPDATE permission on that table, so nobody can make themselves admin. The studio admin is promoted with a SQL statement or a script using the secret key. Every write goes through a database function that starts with `require_customer()` or `require_studio()`, which raise PT401 or PT403; PostgREST turns those into HTTP 401 and 403. Reads go through RLS policies: `customer_id = auth.uid() OR is_studio()`."

---

## 4. Duplicate purchases and booking conflicts, in 30 seconds

> "Two layers. First, the purchase is one atomic UPDATE with `WHERE status = 'available'`. Postgres row-locks it, so a second simultaneous buyer re-checks after the first commits and updates nothing, which gives a 409. Second, a partial unique index allows only one order per painting with `status = 'placed'`. For bookings, a partial unique index on `booking_date WHERE status IN ('requested','confirmed')` means two inserts for the same date can't both commit, and declined or cancelled bookings don't block the date. I tested both races with two real database sessions."

---

## 5. Explaining the schema

```
auth.users (Supabase) 1──1 profiles(id, email, full_name, role ∈ {customer, studio})
                              │1
          ┌───────────────────┼─────────────────────┐
          │*                  │*                    │*
       orders            wall_bookings        pottery_requests
  (painting_id → paintings) (booking_date,     (item_id → pottery_items,
   price, status ∈           wall_size_sqft,     glaze_id → glazes,
   {placed,cancelled})       address, rate,      quantity 1–12, needed_by,
                             total_price,        status ∈ {requested, accepted,
                             status ∈ {requested,          declined, cancelled})
                             confirmed, declined,
                             cancelled})
paintings(id 'p-001', title, artist, description, price, image_url, status ∈ {available, sold})
studio_settings(single row: currency 'INR', mural_rate_per_sqft 150)
```

Talking points:
- **IDs.** Seed tables keep the dataset's own text IDs (`p-001`, `i-01`, `g-01`), so re-imports match and no data is invented. Records users create get UUIDs, which can't be guessed.
- **Money** is `numeric(12,2)`, never float, so there are no rounding errors.
- **`orders.price` and `wall_bookings.rate_per_sqft`/`total_price`** are copies taken at the time of the order. Later price changes don't rewrite history.
- **Single-row settings table.** `id boolean primary key check (id)` means only one row can exist.

### Important SQL to be able to explain

```sql
-- 1. The partial unique index: one ACTIVE order per painting
create unique index orders_one_active_per_painting
  on public.orders (painting_id) where status = 'placed';

-- 2. The atomic claim inside purchase_painting
update public.paintings set status = 'sold', updated_at = now()
 where id = p_painting_id and status = 'available'
returning * into painting;

-- 3. An RLS policy: customers see their own rows, the studio sees all
create policy "Customers read own orders, studio reads all" on public.orders
  for select to authenticated
  using (customer_id = auth.uid() or public.is_studio());

-- 4. Turning a business rule into an HTTP status
raise exception using errcode = 'PT409', message = 'Sorry, this painting has already been sold.';

-- 5. The 3-day cancellation rule (cancel_wall_booking)
if public.studio_today() > booking.booking_date - 3 then  -- raise PT409
```

---

## 6. The 15 most likely interview questions

**1. Why is there no backend server?**
Supabase gives me a REST API over PostgreSQL. All the business rules are in the database (constraints, RLS, and SECURITY DEFINER functions), so the database *is* the trusted backend. Fewer moving parts means fewer places for a security gap.

**2. The anon key is visible in the browser. Isn't that a security problem?**
No. The anon key only identifies the project; it isn't a password. What it can do is limited by grants and RLS: browsers can only SELECT, and RLS filters rows. The **service-role key** bypasses RLS, so it lives only in the local `.env` for the provisioning script, and `generate-config.js` refuses to put it in `config.js`.

**3. How do you stop a customer from making themselves admin?**
Three ways: (a) `handle_new_user` always inserts `role = 'customer'` and ignores sign-up metadata; (b) there is no UPDATE grant on `profiles` for browser roles; (c) the `protect_profile_role` trigger rejects role changes from `anon`/`authenticated` requests. The test `customer cannot update own role` checks this.

**4. What happens if two people click "Buy" at the same moment?**
The atomic `UPDATE … WHERE status = 'available'` locks the row. The second transaction waits, re-evaluates the WHERE after the first commits, matches zero rows, and gets a 409. As a backup, the partial unique index rejects a second `placed` order. My concurrency test proves exactly one order is created.

**5. Why a partial unique index instead of a normal UNIQUE?**
A normal `UNIQUE(painting_id)` would block buying a painting again after a cancellation, and `UNIQUE(booking_date)` would let a declined booking block the date forever. `WHERE status = 'placed'` (or `IN ('requested','confirmed')`) applies uniqueness only to *active* records.

**6. Why SECURITY DEFINER functions, and what's the risk?**
Browsers have no INSERT/UPDATE permission, so a write must run with more rights. The function runs as its owner and does all the checks first. The risks are forgetting a check, or search-path hijacking. I mitigate those by calling a `require_*` helper first in every function, setting `set search_path = ''`, and schema-qualifying every name.

**7. How do you return 401, 403 and 404?**
The functions raise SQLSTATE `PT401`, `PT403` or `PT404`, and PostgREST uses the last three digits as the HTTP status. 401 means no user; 403 means the wrong role; 404 means the record doesn't exist *or isn't yours*. Both cases give the same 404 response, so an attacker can't tell that someone else's order id exists.

**8. Why do you also validate in JavaScript?**
For user experience only: instant messages without a round trip. The browser can be modified, so every rule is repeated in SQL. Example: the live mural price is a preview; `create_wall_booking` recalculates it from `studio_settings`, and a CHECK constraint guarantees `total_price = rate × size`.

**9. How does cancelling an order restore availability, and why do seeded sold paintings stay sold?**
`cancel_order` locks the caller's order, sets it `cancelled`, then sets the painting `available WHERE status = 'sold'`, all in one transaction. p-004 and p-009 were sold in the seed with no order, so there is nothing to cancel. The admin can't edit sold paintings, and the seed re-import uses `ON CONFLICT DO NOTHING`.

**10. How is the seed import idempotent?**
`seed.sql` uses `INSERT … ON CONFLICT (id)`. Paintings use `DO NOTHING` (so live sales and edits are never overwritten); items, glazes and settings use `DO UPDATE` with the same values. My tests run it twice and then check the counts and statuses again.

**11. How do you handle dates and time zones?**
The studio's "today" is `(now() at time zone 'Asia/Kolkata')::date` in SQL and the same calculation (via `Intl`) in JS. The rules are 7–90 days ahead for bookings, cancellation until `booking_date - 3`, and 14+ days for pottery. Date maths on `YYYY-MM-DD` strings in JS is done in UTC, so the day can't shift.

**12. How do you prevent XSS?**
All database text goes through `escapeHtml()` before it is put into HTML, and `safeImageUrl()` only allows `images/…` or `https://` image URLs. Confirm dialogs use `textContent`. A painting title like `<script>` would display as text.

**13. How is the frontend organised without a framework?**
A hash router (`routes` map → `renderXPage()`), one render function per page, and a single delegated click listener with a `clickActions` map driven by `data-action` attributes. Data screens follow the same pattern: show a skeleton → fetch → error state with retry, empty state, or the list.

**14. How did you test it?**
`tests/run-db-tests.sh` loads the migrations onto local PostgreSQL with a stub of Supabase's `auth` schema. It runs 75 assertions (every 400/401/403/404/409 path, RLS visibility, prices, boundaries such as day 7 vs 6 and day 90 vs 91, seed re-runs) and two concurrency tests. I also drove the UI in headless Chromium against a mock Supabase client. Honestly: I haven't yet run it end to end against a live Supabase project.

**15. What would you improve next?**
Run it against a real Supabase project in CI; Storage uploads for painting images; real payments (an order becomes `paid` only after verification on the server); email notifications; a `pg_cron` job to expire stale requests; and pagination and audit logs.
