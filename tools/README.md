# tools/

Development-only utilities. Nothing here ships, nothing here is imported by
the backend, the web app or the driver app, and nothing here writes to the
database — every one of them goes through the public API like any client.

## `simulate-dispatch.mjs` — walk-in dispatch, end to end

Proves the chain ADR-0012 → ADR-0024 closes: somebody orders on the website,
the platform ranks the drivers actually on duty, offers the job to the
nearest, and their accept becomes a Trip.

The hard part of demonstrating it is the driver half. A presence row is not
enough — `WalkInRecommender` treats a presence older than
`dispatch.presence_ttl_seconds` (180s) as an **absent** driver, deliberately,
so a seeded row goes stale three minutes later and every order after that
finds nobody. The driver side has to keep beating, which is what this does.

### Four processes, not three

Automatic dispatch needs the scheduler, and it is easy to miss because
nothing fails loudly without it:

```
mysqld                                    # XAMPP, no Windows service
php artisan serve --host=0.0.0.0 --port=8000
php artisan queue:work --tries=3 --sleep=1
php artisan schedule:work                 # ← dispatch:advance-offers, every 10s
```

Without `schedule:work` the immediate paths still work — `dispatch()` runs
inside the request that receives the order, and a driver's decline advances
the search in their own request — but **nothing revisits an order that
reached nobody**, and no timed-out offer moves to the next driver. An order
placed thirty seconds before a driver signs on then sits at "Finding you a
captain" until the retry window closes. That is `retryUnoffered()`'s job and
`dispatch:advance-offers` is what calls it.

### The demonstration

One terminal holds the phone:

```
node tools/simulate-dispatch.mjs driver --vehicle=2 --drive --pace=2
```

It signs in as `driver.free@kangaruride.test` (from `DriverAppSeeder`), goes
on duty, heartbeats on the cadence the *server* asks for, polls
`GET /me/offers` every five seconds like the app does, accepts what arrives,
and — with `--drive` — walks the journey to `trip_completed` so the driver
returns to the pool for the next order. Ctrl-C signs off.

Then order from the web app at <http://localhost:5173/order> and watch both
screens. The customer's rail moves `searching → offered → assigned` and on
through the trip; the phone prints the offer, its distance, its countdown and
the trip it became.

`--vehicle` is worth understanding rather than copying. A driver on duty with
no vehicle is ranked and then dropped as unofferable, so the simulation beats
happily and receives nothing with every part of it apparently working. The
script says so out loud when the server hands back a null vehicle;
`DriverPresenceController::vehicleFor` explains why it can happen.

### Without a browser

```
node tools/simulate-dispatch.mjs order --service=ride       # or delivery
node tools/simulate-dispatch.mjs status --reference=KR-XXXXXX
```

`order` posts the same unauthenticated `POST /public/order-requests` the web
app's form posts, so the throttle, the honeypot and the intake switch are all
still in the way. `status` reads the desk's queue as the dispatcher, because
ADR-0012 §3 gives the public intake no GET on purpose.

### What it refuses to do

Development only: it exits rather than run against a non-local API unless
`--i-know` is passed. It never touches the database — a simulator that could
write rows can produce a green run out of a broken platform — and it holds no
credentials beyond the seeder's committed demo password, which
`DriverAppSeeder::refuseOutsideDevelopment()` is what makes safe.
