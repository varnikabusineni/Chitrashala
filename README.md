# Chitrashala — a house of Indian folk art

*Paintings, wall murals and custom pottery: an art-studio web app.*

A small full-stack web app for an art studio:

- **Customers** browse and buy original paintings, book a wall-mural day, and request custom pottery.
- **The studio admin** adds and edits paintings, confirms or declines mural bookings, and accepts or declines pottery requests.

**Stack:** HTML + CSS + vanilla JavaScript (no build step) · Supabase PostgreSQL · Supabase Auth · Row Level Security and database functions for every business rule.

> Design decisions are explained in [DESIGN.md](DESIGN.md). Walkthroughs and likely interview questions are in [INTERVIEW_PREP.md](INTERVIEW_PREP.md).

---

## Contents
1. [Project structure](#1-project-structure)
2. [Prerequisites](#2-prerequisites)
3. [Create the Supabase project](#3-create-the-supabase-project)
4. [Apply the SQL migrations](#4-apply-the-sql-migrations)
5. [Import seed data and images](#5-import-seed-data-and-images)
6. [Configure environment variables](#6-configure-environment-variables)
7. [Provision the studio admin account](#7-provision-the-studio-admin-account)
8. [Run the website locally](#8-run-the-website-locally)
9. [Test the customer and admin workflows](#9-test-the-customer-and-admin-workflows)
10. [Automated database tests](#10-automated-database-tests)
11. [Deploying (optional)](#11-deploying-optional)
12. [Troubleshooting](#12-troubleshooting)
13. [What has and hasn't been verified](#13-what-has-and-hasnt-been-verified)

---

## 1. Project structure

```
Art_Studio_website/
├── serve.py                    Runs the site locally without browser caching (py serve.py)
├── index.html                  Page shell: header/nav, <main id="app">, footer, toast area, confirm dialog
├── style.css                   The single design system (colours, type, buttons, gallery, forms, states)
├── app.js                      All frontend logic: auth state, hash router, every page, all button actions
├── config.js                   The studio project's PUBLIC Supabase URL + anon key (safe to commit)
├── config.example.js           Template for config.js, for connecting a different project
├── images/p-001.jpg … p-012.jpg   The 12 real painting images from seedData.zip
├── seed/seed.json              The seed dataset (source of truth) — studio PASSWORD REMOVED
├── supabase/
│   ├── migrations/
│   │   ├── 001_schema.sql            Tables, keys, CHECK constraints, unique/partial indexes
│   │   ├── 002_auth_and_roles.sql    Profiles, sign-up trigger, role guard, 401/403 helpers
│   │   ├── 003_business_functions.sql Atomic functions: purchase, cancel, book, pottery, admin actions
│   │   └── 004_rls_and_grants.sql    Row Level Security policies + read-only grants
│   └── seed.sql                Idempotent seed import (GENERATED from seed/seed.json)
├── scripts/
│   ├── build-seed-sql.js       seed/seed.json → supabase/seed.sql (checks every image exists)
│   ├── generate-config.js      .env → config.js (refuses to expose a service-role key)
│   ├── provision-studio.js     Creates the studio Auth user from .env and sets role = 'studio'
│   └── env.js                  Tiny .env reader shared by the scripts (no npm packages)
├── tests/
│   ├── supabase_stub.sql       Fakes Supabase's auth schema/roles for plain PostgreSQL
│   ├── database_tests.sql      75 checks of every business and security rule
│   └── run-db-tests.sh         Runs the stub + migrations + seed + tests + 2 concurrency tests
├── .env.example                Every environment variable, with placeholders
├── .gitignore                  Keeps .env and the original seedData.zip (with the password) out of git
├── README.md / DESIGN.md / INTERVIEW_PREP.md
```

**Why the extra files beyond the required list?**
- `config.example.js` and `scripts/generate-config.js`: a static website can't read `.env`, so the two *public* values are copied into `config.js`.
- `scripts/provision-studio.js`: creates the admin account without putting the password in code.
- `scripts/build-seed-sql.js`: makes `seed.json` the real source of truth for the import.
- `tests/`: proves the SQL rules work, including real concurrent requests.

---

## 2. Prerequisites

| Tool | Why | Check |
|---|---|---|
| A free [Supabase](https://supabase.com) account | Database + Auth | — |
| **Node.js 18+** | Runs the three helper scripts (no `npm install` needed) | `node --version` |
| Python 3 *or* any static file server | Serves the site locally | `python3 --version` |
| A modern browser (Chrome, Edge, Firefox, Safari) | — | — |
| *(Optional)* PostgreSQL 15+ with `psql` | Only for the automated tests in section 10 | `psql --version` |

---

## 3. Create the Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), click **New project** and choose a name, a database password and a region close to India (for example *Mumbai*).
2. Wait for it to finish provisioning.
3. Go to **Authentication → Sign In / Providers** and make sure **Email** is enabled.
   - For quick local testing you may turn **Confirm email** off. If you leave it on, new customers must click the email link before they can log in, and the sign-up page tells them so.
4. Go to **Authentication → URL Configuration** and set **Site URL** to `http://localhost:8000`.

---

## 4. Apply the SQL migrations

> **Shortcut (one paste):** `supabase/setup_all.sql` is the four migrations below, plus `seed.sql`, plus the studio-admin promotion, in the right order. First create the `studio@artstudio.in` user (section 7, Option A steps 1–2). Then paste the whole file into the SQL Editor and click **Run**. The last result row should read `12 | 5 | 6 | 1`, and in that case you can skip sections 5 and 7. Rebuild it with `bash scripts/build-setup-all.sh` if you change any SQL file.

Open **SQL Editor → New query** and run each file **in this order**. Paste the whole file, click **Run**, and wait for "Success" before moving on.

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_auth_and_roles.sql`
3. `supabase/migrations/003_business_functions.sql`
4. `supabase/migrations/004_rls_and_grants.sql`

Every file is written to be safe to re-run (`if not exists`, `create or replace`, `drop policy if exists`).

> Using `psql` instead? Copy the connection string from **Connect → Direct connection**, then run
> `psql "<connection string>" -f supabase/migrations/001_schema.sql` (and so on for each file).

---

## 5. Import seed data and images

**Data.** Run `supabase/seed.sql` in the SQL Editor. It inserts:
- the studio settings (currency **INR**, mural rate **₹150 per sq ft**),
- the **12 paintings** with their exact IDs, titles, artists, descriptions, prices, image paths and status (**p-004 and p-009 start sold**),
- the **5 pottery items** and **6 glazes**.

It is **idempotent**: every insert uses `ON CONFLICT (id)`, so running it again never creates duplicates. Paintings use `DO NOTHING`, so a re-run never resets a painting that has since been bought or edited.

`seed.sql` is generated from `seed/seed.json`. If you ever change the JSON, regenerate it:

```bash
node scripts/build-seed-sql.js
```

The script also checks that every `imageUrl` in the JSON exists on disk.

**Images.** The 12 images from `seedData.zip` are already in `images/`. The seed stores paths like `images/p-001.jpg`, which are relative to `index.html`, so they work as-is when the project folder is served. Nothing needs uploading. If an image is ever missing, the site shows a designed "Image coming soon" card instead of a broken icon.

> **About the original zip:** `seedData.zip`'s `seed.json` contains the studio password in plain text. The copy in `seed/seed.json` has the password removed, and `.gitignore` blocks `seedData.zip` and `seedData/`. Don't commit the original.

---

## 6. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` from **Project Settings → API Keys** (or the **Connect** button):

| Variable | Where it's used | Secret? |
|---|---|---|
| `SUPABASE_URL` | Browser (via `config.js`) + scripts | Public |
| `SUPABASE_ANON_KEY` | Browser (via `config.js`). Use the **anon / publishable** key | Public (RLS protects the data) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Only** `scripts/provision-studio.js` on your machine. Use the **service_role / secret** key | **SECRET** — bypasses RLS |
| `STUDIO_EMAIL` | `provision-studio.js` (`studio@artstudio.in` from the seed) | — |
| `STUDIO_PASSWORD` | `provision-studio.js` (use the password from your `seedData.zip`, or a stronger one) | **SECRET** |

Then generate the browser config:

```bash
node scripts/generate-config.js
```

This writes `config.js`. It only holds public values, so this repo commits it, already pointing at the studio's project. As a safety check, the script **refuses** to run if the anon key you entered is actually a service-role key.

---

## 7. Provision the studio admin account

**Security model.** Everyone who signs up through the website becomes a `customer`. That is enforced by the `handle_new_user` trigger, which ignores any role sent from the browser. Browsers have no permission to update `profiles`, and a trigger also blocks role changes from logged-in users. **Only a trusted person with the SQL Editor or the service-role key can create a studio admin.**

> Run the migrations (section 4) **before** creating the user, so the trigger creates their profile.

### Option A — Supabase dashboard (no code)
1. **Authentication → Users → Add user → Create new user**.
2. Email: `studio@artstudio.in`. Password: the one from your `seedData.zip` (or a stronger one). Tick **Auto Confirm User**.
3. In the **SQL Editor**, run:
   ```sql
   update public.profiles
      set role = 'studio', full_name = 'Studio Admin'
    where email = 'studio@artstudio.in';

   -- check: should return one row with role = studio
   select email, role from public.profiles where email = 'studio@artstudio.in';
   ```

### Option B — script
With `SUPABASE_SERVICE_ROLE_KEY`, `STUDIO_EMAIL` and `STUDIO_PASSWORD` set in `.env`:
```bash
node scripts/provision-studio.js
```
It creates the user with a confirmed email, or reuses it if it already exists, then sets `role = 'studio'`. Running it twice is safe.

**Good practice:** after the demo, change the studio password (Dashboard → Users → … → *Send password recovery*, or set a new one). The seed password is now known to everyone who has the zip.

---

## 8. Run the website locally

From the project folder:

```bash
py serve.py          # Windows
python3 serve.py     # Mac / Linux
```

Open **http://localhost:5501**. `serve.py` is a tiny built-in Python server that tells the browser not to keep old copies, so after downloading a new version you always see the latest design. (`python -m http.server 5501` also works, but you may need **Ctrl + Shift + R** to see changes.)

Use a local server rather than double-clicking `index.html`, so the page and the image paths load the same way they would online. If you see a **"Connect your Supabase project"** panel, `config.js` is missing or still contains placeholders (go back to section 6).

---

## 9. Test the customer and admin workflows

### Customer
1. **Sign up** (top right). You'll land on Paintings logged in as a *Customer*. If email confirmation is on, confirm by email first.
2. **Buy**: click *Buy for ₹…* on an available painting and confirm. A success toast appears and the card turns **Sold**.
3. **Failed purchase**: in a second browser (or a private window), log in as another customer and try to buy the same painting. You'll see *"Sorry, this painting has already been sold."* p-004 and p-009 can never be bought.
4. **My orders**: the order is listed. **Cancel order** marks it *cancelled*, and the painting is *Available* again in the gallery.
5. **Wall murals**: type a size and watch the live price (size × ₹150). Try a date outside 7–90 days, a size outside 10–500, or an empty address to see the validation messages. Submit a valid booking. Then, from another customer account, pick the same date: the date is listed as already booked, and the database answers **409 "That date is already booked"**.
6. **Cancel a booking**: allowed only until three days before the date. After that the button is replaced by *"Cancellation closed on …"*, and the database refuses with 409.
7. **Pottery**: choose an item card, click a glaze swatch, set quantity with the stepper (1–12), and pick a needed-by date at least 14 days away. Submit, then **Edit** or **Cancel**. Both disappear once the studio accepts or declines the request.

### Studio admin
1. Log in as `studio@artstudio.in`. You're taken to the **Studio dashboard**.
2. **Bookings** tab: **Confirm** or **Decline** requested bookings. A declined date becomes bookable again.
3. **Pottery** tab: **Accept** or **Decline** requests.
4. **Paintings** tab: **+ Add painting** (put the image in `images/` and enter `images/your-file.jpg`, or paste an `https://` URL). **Edit** appears only for available paintings; sold ones are locked.
5. **Orders** tab: every order, with the customer's name and email.
6. The studio account can't buy, book or request. Those are customer actions, so the database returns **403**.

### Security checks (HTTP 401 / 403 / 404)
The browser is untrusted, so test the API directly. Put your values in shell variables first:

```bash
URL=https://your-project-ref.supabase.co
ANON=your-anon-key

# 401 — logged out (no user token)
curl -i -X POST "$URL/rest/v1/rpc/purchase_painting" \
  -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"p_painting_id":"p-001"}'

# Log in as a customer to get a token
TOKEN=$(curl -s -X POST "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"customer@example.com","password":"their-password"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 403 — customer calling an admin function
curl -i -X POST "$URL/rest/v1/rpc/studio_set_booking_status" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_booking_id":"00000000-0000-0000-0000-000000000000","p_new_status":"confirmed"}'

# 404 — customer touching someone else's order (use another customer's order id)
curl -i -X POST "$URL/rest/v1/rpc/cancel_order" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_order_id":"<another customer order id>"}'

# Direct writes are not allowed at all (no INSERT/UPDATE grants)
curl -i -X PATCH "$URL/rest/v1/profiles?id=eq.<your user id>" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"role":"studio"}'
```

How the status codes are produced: the SQL functions raise errors with SQLSTATE `PT401`, `PT403`, `PT404`, `PT409` or `PT400`, and Supabase's REST layer (PostgREST) returns that number as the HTTP status. Single-record reads that must return 404 (`get_order`, `get_wall_booking`, `get_pottery_request`) are also database functions. A plain table query such as `GET /rest/v1/orders?id=eq.X` for someone else's order returns `200 []`, because RLS hides the row.

---

## 10. Automated database tests

`tests/run-db-tests.sh` runs everything against a throwaway **local** PostgreSQL database:

```bash
PGHOST=localhost PGUSER=postgres bash tests/run-db-tests.sh
```

It loads a small stub of Supabase's `auth` schema and roles, then all four migrations, then `seed.sql` twice (to prove it's idempotent). After that it runs **75 checks** covering 401/403/404/409/400 cases, RLS visibility, price calculation, date windows, status transitions and seed re-runs. It finishes with **two real concurrency tests**: two sessions buying the same painting, and two sessions booking the same date, at the same moment. Expected ending:

```
ALL DATABASE TESTS PASSED
PASS: concurrent purchases -> exactly 1 order, second buyer got 409
PASS: concurrent bookings for one date -> exactly 1 booking, second got 409
DONE
```

⚠️ Never run `tests/supabase_stub.sql` on your real Supabase project.

---

## 11. Deploying (optional)

The site is static, so any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
- The host needs a `config.js`. It only contains the public URL and anon key, so you may commit it on a deploy branch, or create it in the host's build step with `node scripts/generate-config.js`.
- Add the deployed URL under **Authentication → URL Configuration** in Supabase.
- **Never** deploy `.env` or the service-role key.

---

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| "Connect your Supabase project" panel | Create `config.js` (section 6) and hard-refresh the page. |
| Gallery shows "Something went wrong … permission denied" | Run `004_rls_and_grants.sql`. |
| Gallery is empty | Run `supabase/seed.sql`. |
| "Studio settings are missing" when booking | Run `supabase/seed.sql`. |
| Logged in as studio but the dashboard says "Studio staff only" | The `update public.profiles set role = 'studio' …` step (section 7) hasn't been run for that email. |
| `provision-studio.js` says "Could not set role" | Run the migrations first, then run the script again. |
| Sign-up says "check your email" | Email confirmation is on. Confirm by email, or turn it off for testing (section 3). |
| Dates look one day off | The studio's "today" is India time (Asia/Kolkata) on purpose, both in the browser and in SQL. |

---

## 13. What has and hasn't been verified

**Verified (actually run):**
- All SQL migrations and `seed.sql` on **PostgreSQL 16**, with the Supabase auth stub: 75/75 rule checks and both concurrency tests pass (`tests/run-db-tests.sh`).
- `scripts/build-seed-sql.js` generated `supabase/seed.sql` from `seed/seed.json`.
- The frontend in headless **Chromium** (Playwright), against an in-memory stand-in for the Supabase client: every page, loading/empty/error states, login, buy → sold → cancel, booking validation and the live price, pottery create/edit, admin confirm and edit, image fallback, and no horizontal scrolling at 390 px phone width.

**Not verified (no live Supabase project was available while building):**
- Running against a real hosted Supabase project end to end: real Auth emails and PostgREST turning `PTxxx` errors into HTTP status codes. That mapping is documented PostgREST behaviour, but please run the curl checks in section 9 once.
- `scripts/provision-studio.js` and `scripts/generate-config.js` against real keys.
