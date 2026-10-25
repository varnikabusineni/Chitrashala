# DESIGN.md — How the Art Studio app is built, and why

## Architecture in one picture

```
 Browser (untrusted)                         Supabase (trusted)
 ┌───────────────────────────┐  HTTPS   ┌──────────────────────────────────────────┐
 │ index.html + style.css    │          │ Auth (GoTrue) — passwords, sessions, JWT │
 │ app.js                    │ ───────► │                                          │
 │  • reads:  supabase.from()│          │ PostgREST (REST API over Postgres)       │
 │  • writes: supabase.rpc() │          │   ▼                                      │
 │  • anon key + user JWT    │          │ PostgreSQL                               │
 └───────────────────────────┘          │  • tables + CHECK/UNIQUE constraints     │
                                         │  • RLS policies (who sees which rows)    │
                                         │  • SECURITY DEFINER functions            │
                                         │    (every write + every business rule)   │
                                         └──────────────────────────────────────────┘
```

There is **no separate backend server**. The database is the backend: Supabase exposes PostgreSQL through an automatic REST API, and our rules live inside the database itself, as constraints, Row Level Security and functions. A customer can open the browser console and call the API by hand, and they still can't break any rule.

---

## Visual design

The look is a **calm "sage retreat"**: soft sage greens, warm cream and butter yellow, rounded photographs and a gentle, unhurried tone.
- **Type.** *Marcellus*, a calm flared serif, for headings and the logo; *Albert Sans* for body text, buttons and small spaced-out uppercase labels.
- **Colour.** Built from the assignment palette: cream (#F8F3E8) pages, soft green (#B9DCA7) and darker sage shades of it for the header, panels and sections, butter yellow (#F4D44D, plus a paler tint) for the scrolling ribbon, highlights and buttons, and dark ink for text. Coral and cobalt stay as tokens for status colours.
- **Header.** A centred lowercase **chitrashala** logo with "FOLK ✿ ART ✿ HOUSE" curving above it (SVG text on a path) and a small sun. The navigation links sit in a rounded pill bar on the left, with matching account pills on the right, laid out with CSS grid. Below 1080 px the menu folds into a hamburger with stacked pills.
- **Home page.**
  - A self-playing carousel of seven paintings, three at a time with the middle one large. It moves every 4.5 s, pauses while the mouse is over it, shows a small ‹ or › bubble only when you hover that side (click to slide; always faintly visible on touch screens), and stops for visitors who ask for reduced motion. Below it are a short welcome and a soft pill button.
  - A butter-yellow scrolling ribbon.
  - A full-width painting with three white cards (*Collect, Commission, Create*).
  - A "Which painting calls to you?" slider with arrows and dots, filled live from the database.
  - A sage "Wander through the studio" section with four rounded picture cards.
- **Other pages.** Rounded white cards with soft shadows, sage and butter pill buttons, and a sage mural estimate. Every data screen keeps its loading, empty, error and success states. The layout is responsive down to phone width, and the ribbon animation stops for visitors who ask for reduced motion.

---

## 1. How login and the two roles work

**Login (authentication — "who are you?")** is handled by **Supabase Auth**:
- `supabase.auth.signUp()` / `signInWithPassword()` in `app.js`.
- Supabase stores password hashes. We never see or store passwords.
- After login the browser holds a signed **JWT** (access token). Every API request sends it, and inside SQL `auth.uid()` returns the logged-in user's id from that token. The token is signed by Supabase, so the browser can't forge someone else's id.

**Roles (authorization — "what may you do?")** are stored in **our own table**, `public.profiles.role`, which can be `'customer'` or `'studio'`. "Studio" is the admin role named in `seed.json`.
- A trigger on `auth.users` (`handle_new_user`) creates a profile for every new sign-up with role **`customer`, always**. Anything the browser puts in the sign-up metadata, including `"role":"studio"`, is ignored. This is tested.
- Browsers have **no UPDATE permission** on `profiles`, so a customer can't promote themselves. As a second layer, the `protect_profile_role` trigger rejects role changes from any request whose JWT role is `anon` or `authenticated`.
- The studio admin is created by a trusted person: through the dashboard plus one SQL `update`, or with `scripts/provision-studio.js` and the secret service-role key. The password lives only in the local `.env`, never in the repo.

**How each request is checked** (in `002_auth_and_roles.sql`):

| Helper | Fails with | Meaning |
|---|---|---|
| `require_login()` | **401** (`PT401`) | No valid user token. |
| `require_customer()` | 401, or **403** (`PT403`) | Logged in, but not a customer (customer-only actions such as buy, book, request). |
| `require_studio()` | 401, or **403** | Logged in, but not the studio admin (admin actions). |
| Ownership check inside each function | **404** (`PT404`) | The record isn't yours. It looks exactly like a missing record, so we never reveal that it exists. |

PostgREST turns a SQL error with SQLSTATE `PTxyz` into HTTP status `xyz`. That is how the database produces exact 401/403/404 responses without a custom server.

**Reading data** uses RLS policies: `customer_id = auth.uid() OR is_studio()`. Customers only ever receive their own orders, bookings and requests; the studio receives all of them. Paintings, pottery items, glazes and settings are public catalogue data.

The frontend also hides buttons by role (for example, no "Buy" for the studio, and no dashboard for customers). That is **only for a nicer experience**; the database enforces every rule regardless.

---

## 2. Which database was chosen, and why

**Supabase PostgreSQL.**

- **Relational data.** Orders reference paintings and customers, and requests reference items and glazes. Foreign keys keep that consistent automatically.
- **Real transactions and row locks.** Purchases and bookings must be safe when two people act at the same moment. PostgreSQL gives atomic statements, `SELECT … FOR UPDATE`, and **partial unique indexes**, which are exactly the tools for "only one *active* order/booking".
- **Rules live next to the data.** CHECK constraints, RLS and functions mean the rules can't be skipped by a modified browser.
- **Supabase adds the missing pieces without a server.** It provides Auth, an automatic REST API (`from()` and `rpc()`), and a free tier, so the app can be plain HTML/CSS/JS with no backend code to host.
- **It's standard SQL.** Everything is portable and easy to explain. The migrations also run on plain PostgreSQL, which is how the automated tests run.

---

## 3. How duplicate purchases and bookings are prevented

### Paintings: two layers
1. **Atomic claim** in `purchase_painting`:
   ```sql
   update public.paintings
      set status = 'sold'
    where id = p_painting_id and status = 'available'
   returning * into painting;
   ```
   Checking and changing happen in **one statement**. If two buyers arrive together, PostgreSQL locks the row: the second `UPDATE` waits, re-checks `status = 'available'`, finds `'sold'`, updates **zero rows**, and the function raises **409 "already sold"**.
2. **Partial unique index** as a safety net:
   ```sql
   create unique index orders_one_active_per_painting
     on public.orders (painting_id) where status = 'placed';
   ```
   Even a future bug can't create two *placed* orders for one painting. Cancelled orders don't count, so a painting can be bought again after a cancellation.

The whole function is **one transaction**. If the order insert fails, the "sold" update rolls back too.

**Cancellation** (`cancel_order`) locks the customer's own order with `FOR UPDATE`, sets it to `cancelled`, and sets the painting back to `available`, all in one transaction. Paintings seeded as `sold` (p-004, p-009) have no order, so no cancellation can ever reach them. They **stay sold**, and re-running the seed uses `ON CONFLICT DO NOTHING`, so it never resets them either.

### Wall bookings: one active booking per date
```sql
create unique index bookings_one_active_per_date
  on public.wall_bookings (booking_date) where status in ('requested', 'confirmed');
```
- This index is the source of truth. Two simultaneous `INSERT`s for the same date can't both succeed: the second blocks until the first commits, then fails with `unique_violation`, which `create_wall_booking` turns into **409 "That date is already booked"**.
- **Declined and cancelled bookings are outside the index**, so they free the date for someone else.
- The form's list of booked dates is just a hint for the customer. The index is what actually decides.

Both race conditions are covered by the **concurrency tests** in `tests/run-db-tests.sh`, which use two real database sessions at the same moment.

### Other server-side rules (never trusted from the browser)
- **Prices.** An order copies `paintings.price`. A booking's total is `studio_settings.mural_rate_per_sqft × size`, and a CHECK constraint (`total_price = round(rate × size, 2)`) guarantees the stored total is consistent.
- **Who.** The customer is always `auth.uid()`; the browser never sends a user id.
- **Dates.** "Today" is computed in the database in **Asia/Kolkata** time. Bookings must be 7–90 days away and cancellations at least 3 days before the date; pottery needs a needed-by date at least 14 days away.
- **Sizes and quantities.** Wall size must be 10–500 sq ft and quantity 1–12. These are enforced both in the functions (friendly 400 errors) and by CHECK constraints (final guarantee).
- **Status transitions** are enforced in the functions:

```
Order:    placed ──cancel(owner)──► cancelled
Booking:  requested ──studio──► confirmed | declined
          requested/confirmed ──owner, ≥3 days before──► cancelled
Pottery:  requested ──studio──► accepted | declined
          requested ──owner──► cancelled   (owner may also edit while requested)
Painting: available ──purchase──► sold ──order cancelled──► available
          (studio may edit only while available)
```

---

## 4. What is finished, what is incomplete, what's next

### Finished
- All 7 screens: home, sign-up/login, paintings catalogue, my orders, wall booking (form, live price calculator and history), pottery (item cards, glaze swatches, stepper, history with edit/cancel), and the studio dashboard (stats; bookings, pottery, paintings and orders tabs; add/edit painting).
- Loading skeletons, empty states, error states with *Try again*, toasts, and inline validation on every data screen. The layout is responsive down to phone width.
- The complete schema with PK/FK/CHECK/UNIQUE constraints and indexes, RLS, read-only grants, and 15 API functions with 401/403/404/409/400 handling.
- An idempotent seed generated from `seed.json`, the real images, and secure admin provisioning.
- Automated SQL tests: 75 checks plus 2 concurrency tests.

### Incomplete / known limitations
-- **Tested on a live Supabase project.** Sign-up, buying, booking, pottery and the studio dashboard all work.
- **No real payments.** "Buying" places an order (a reservation); there's no payment gateway.
- **Images for new paintings** are a path (`images/…`) or an `https://` URL. There is no upload to Supabase Storage.
- **Plain table reads** of another customer's record return `200 []` (RLS hides the row). The explicit **404** comes from the `get_*` and mutation functions.
- No emails or notifications when the studio confirms or declines.
- The studio can't delete paintings, or cancel an order on a customer's behalf. There is no pagination; fine for a small studio, not for thousands of rows.
- A booking that is never reviewed stays `requested` after its date passes (no automatic expiry).
- The admin tabs don't support arrow-key navigation between tabs (Tab/Enter work).

### What to build next
1. Run against a Supabase project and add the curl checks to CI, using the Supabase CLI's local stack.
2. Image upload to **Supabase Storage**, with a storage policy that only the studio can write.
3. Email notifications through a Supabase Edge Function or database webhook when a status changes.
4. Payment integration (for example Razorpay), so an order becomes `paid` only after verification on the server.
5. A scheduled job (`pg_cron`) that expires stale `requested` bookings.
6. Pagination and search in the gallery and dashboard, plus an audit log of admin actions.
