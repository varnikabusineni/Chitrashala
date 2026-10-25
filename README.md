# Chitrashala

Chitrashala is a small website for an art studio that sells Indian folk art. Customers can buy original paintings, book a painter to do a mural on their wall, and order custom pottery. The studio owner gets a dashboard to manage paintings, bookings and pottery orders.

I built it with plain HTML, CSS and JavaScript on the frontend, and Supabase (PostgreSQL + Supabase Auth) as the backend. There's no separate server — the important rules (prices, dates, who can do what) are checked inside the database using Row Level Security and SQL functions.

## What it does

**Customers can:**
- sign up and log in
- browse the gallery and buy a painting (each painting can only be sold once)
- cancel their own order, which puts the painting back on sale
- book a wall mural 7–90 days ahead, for walls of 10–500 sq ft, at ₹150 per sq ft
- cancel a booking up to 3 days before the date
- request custom pottery (1–12 pieces, needed at least 14 days from now), and edit or cancel it while it's still pending

**The studio admin can:**
- add paintings and edit ones that haven't sold
- confirm or decline wall bookings
- accept or decline pottery requests
- see all orders

## Project files

- `index.html`, `style.css`, `app.js` – the website
- `config.js` – the Supabase project URL and public (anon) key
- `images/` – the 12 painting images from the seed data
- `supabase/migrations/` – the database tables, roles, functions and security rules
- `supabase/seed.sql` – the paintings, pottery items and glazes from `seed/seed.json`
- `supabase/setup_all.sql` – all of the above in one file, for easy setup
- `serve.py` – a small script to run the site locally
- `scripts/` – helper scripts (generating config, creating the admin account)
- `tests/` – SQL tests for the database rules
- `DESIGN.md` – design decisions and answers to the design questions

## Setting it up

You'll need a free Supabase account and Python installed.

1. **Create a Supabase project** at supabase.com.
2. **Create the admin user.** In Supabase go to Authentication → Users → Add user, use `studio@artstudio.in` with the password from the seed file, and tick "Auto Confirm User".
3. **Set up the database.** Open the SQL Editor, paste the whole of `supabase/setup_all.sql` and click Run. The last line should show `12 | 5 | 6 | 1` (12 paintings, 5 pottery items, 6 glazes, 1 admin). This also gives the studio account its admin role.
4. **(Optional)** Turn off "Confirm email" under Authentication → Sign In / Providers so new customers can log in straight away.
5. **Connect the site.** Put your Project URL and anon key into `config.js` (see `config.example.js` and `.env.example`). Only the public anon key goes here — never the service_role key.

## Running it

From the project folder:

```
py serve.py        (Windows)
python3 serve.py   (Mac/Linux)
```

Then open http://localhost:5501.

## Trying it out

1. Sign up as a customer and buy a painting — it changes to Sold.
2. Book a mural date and place a pottery order.
3. Log out and log in as `studio@artstudio.in` to confirm the booking and accept the pottery order.

The database returns 401 if you're not logged in, 403 if you try an admin action as a customer, and 404 if you try to touch someone else's order.

## Security notes

- New sign-ups are always customers; the admin role can only be given from the Supabase dashboard.
- All changes go through database functions that check the user's role and ownership.
- Prices are always taken from the database, never from the browser.
- Each painting can have only one active order and each date only one active booking, enforced with unique indexes, so double-selling isn't possible even with simultaneous clicks.

## Tests

`tests/run-db-tests.sh` runs the migrations against a local PostgreSQL and checks the business rules, including two simultaneous purchase/booking attempts. See the file for how to run it.
