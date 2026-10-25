#!/usr/bin/env bash
# tests/run-db-tests.sh — run the SQL tests against a LOCAL PostgreSQL 15+.
# Creates a throwaway database, applies the stub + migrations + seed,
# then runs the business-rule tests and the concurrency test.
#
#   PGHOST=localhost PGUSER=postgres bash tests/run-db-tests.sh
#
# Never point this at your real Supabase database.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="art_studio_test"
PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"

run() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

run -f tests/supabase_stub.sql
for file in supabase/migrations/*.sql; do run -f "$file"; done
run -f supabase/seed.sql
run -f supabase/seed.sql   # second run proves the seed is idempotent
PGOPTIONS="" psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f tests/database_tests.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'

# ---------------------------------------------------------------------
# Concurrency: two customers press "Buy" on p-003 at the same moment.
# Session 1 buys and keeps its transaction open for 2 seconds; session 2
# must wait for the row lock and then get 409, never a second order.
# ---------------------------------------------------------------------
login_sql() {
  echo "select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = '$1'), false);
        select set_config('request.jwt.claim.role', 'authenticated', false);
        set role authenticated;"
}

( echo "$(login_sql alice@example.com) begin; select public.purchase_painting('p-003'); select pg_sleep(2); commit;" \
    | run -At >/dev/null ) &
sleep 0.5
second=$( (echo "$(login_sql bob@example.com) select public.purchase_painting('p-003');" | run -At) 2>&1 || true)
wait

active=$(psql -At -d "$DB" -c "select count(*) from public.orders where painting_id = 'p-003' and status = 'placed'")
if [[ "$second" == *"already been sold"* && "$active" == "1" ]]; then
  echo "PASS: concurrent purchases -> exactly 1 order, second buyer got 409"
else
  echo "FAIL: concurrent purchase test (second='$second', active orders=$active)"; exit 1
fi

# Same idea for two bookings on the same date.
date_sql="public.studio_today() + 40"
( echo "$(login_sql alice@example.com) begin; select public.create_wall_booking($date_sql, 50, 'Concurrent test road'); select pg_sleep(2); commit;" \
    | run -At >/dev/null ) &
sleep 0.5
second=$( (echo "$(login_sql bob@example.com) select public.create_wall_booking($date_sql, 50, 'Another test road');" | run -At) 2>&1 || true)
wait
active=$(psql -At -d "$DB" -c "select count(*) from public.wall_bookings where booking_date = $date_sql and status in ('requested','confirmed')")
if [[ "$second" == *"already booked"* && "$active" == "1" ]]; then
  echo "PASS: concurrent bookings for one date -> exactly 1 booking, second got 409"
else
  echo "FAIL: concurrent booking test (second='$second', active bookings=$active)"; exit 1
fi

echo "DONE"
