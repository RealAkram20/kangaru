# Runbook — KangaruRide in production

For the person holding the phone at 2am. Written by W1-d.

`deploy/README.md` is how the stack is built and stood up; this is what to do
when it is running and something is wrong. Where the two disagree, the deploy
README is authoritative about *shape* and this file about *response*.

---

## 0 · Read this first — what has been rehearsed and what has not

AGENTS.md requires the rollback procedure to be *written down and rehearsed
before first client onboarding*. Precisely:

| Claim | Status |
|---|---|
| The rollback procedure in §5 | **Rehearsed, end to end, timed** — in CI, on a Docker host, using this repository's own `docker-compose.yml`: schema down **12–14 s**, whole rollback **40–43 s**. See §5.4 for what that covers and what it does not. |
| A backup restored | **Performed** — `deploy-stack` does one on every CI run, timed. |
| The same, **on the owner's Coolify server** | **NOT DONE.** No Coolify project existed when this was written. |

**That gap is the one thing in this file you should not let stand.** A CI
runner is not the production host: it has no Coolify proxy, no TLS, no real
data volume, a database of 55 empty tables, and a network nobody else is
using. The procedure is proved; the environment is not. §5.5 is the
half-hour that closes it, and it should happen **before** clients are on the
system, not the first time something breaks.

**Unanswered, and it blocks go-live:** *who is called at 2am* (§8). Nobody
can invent that answer, and this runbook does not pretend to.

---

## 1 · What is running

Seven containers, one compose file. The three that carry the product's
promises, and what breaks silently if each stops:

| Service | If it stops | How you find out (without this runbook) |
|---|---|---|
| `app` | the API is down | immediately, loudly — clients call |
| `queue` | **GPS never lands, notifications never send** (ADR-0003) | you don't. Trips complete with no trace. |
| `scheduler` | **an offer nobody answers never advances to the next driver** — dispatch stalls | you don't. It looks like a quiet night. |
| `mysql`, `redis` | app fails to boot / live map blank | fast / slowly |
| `web`, `backup` | site down / no new backups | fast / never |

**The two middle rows are why this file exists.** Both fail without an error
anywhere. `queue` has already been found stopped once (worklog, 15 Aug).

### First question of any incident

```sh
docker compose exec app printenv APP_BUILD    # which build is actually serving
docker compose ps                             # 7 services; all should be healthy
```

`APP_BUILD` is the commit the running image was built from. If it is not the
commit you think you deployed, stop and work out why before changing anything
else — half the incidents that look like bugs are a deploy that did not land.

---

## 2 · Deploy

Full first-time setup is `deploy/README.md` §2. A routine deploy:

1. **If the release carries a migration, take a backup first.** It takes
   seconds and it is the difference between a bad night and a lost database.
   ```sh
   docker compose exec backup /opt/kangaruride/backup.sh --once
   ```
2. Coolify → the resource → **Redeploy** (or push to the deployed branch if
   auto-deploy is on). It rebuilds both images and restarts the stack; the
   `app` container runs `migrate --force` and `storage:link` on start, and
   `queue`/`scheduler` wait until `app` is healthy.
3. Watch the deploy log for `[release] migrate --force` … `[release] done`.
4. **Verify, do not assume** — §3.

**Never** run `db:seed` against production. `DriverAppSeeder` creates a Super
Admin whose TOTP secret is committed to this repository.

---

## 3 · Verify a deploy

```sh
docker compose ps                                        # 7 running/healthy
docker compose exec app printenv APP_BUILD               # the commit you deployed
curl -fsS https://api.<domain>/up                        # 200
docker compose exec app php artisan schedule:list        # exactly 10 entries
docker compose exec scheduler pgrep -fa schedule:work    # exactly 1
docker compose exec queue pgrep -fa queue:work           # exactly 1
docker compose exec app php artisan about                # cache redis, queue database
```

Then one real transaction: order a trip from the web app and watch it become
a dispatch offer. Nothing above proves dispatch works; only that does.

**Also prove one upload at its documented size** — a driver document (8 MB
ceiling) or an odometer photo (10 MB). This is not optional politeness: every
upload on this platform was silently capped at 2 MB by PHP's stock
`upload_max_filesize` until 18 Aug, and the failure mode is a validation error
that reads like the file was never sent. The container now ships
`upload_max_filesize=12M`, `post_max_size=16M`; confirm with:

```sh
docker compose exec app php -r 'echo ini_get("upload_max_filesize"), " ", ini_get("post_max_size"), PHP_EOL;'
```

---

## 3a · Mail, before the first real email goes out

Sixty emails are built and every one of them is inert until the four things
below are true. Three of them fail **silently**: no exception, no error page,
just nothing arriving.

### The two that will break tonight if they are wrong

**`FRONTEND_URL` must be the live domain, not localhost.**

Every link in every email is built from it — the invitation token, the invoice,
the preferences footer, all five call sites in `Modules/Notifications`. Get it
wrong and the invitation email, which is the one thing standing between a new
fleet owner and their account, sends them to `http://localhost:5173/invite/…`.

It fails in the worst possible way: the email arrives, looks perfect, and the
link is dead for everybody except somebody sitting at the server.

```sh
docker compose exec app printenv FRONTEND_URL     # the real domain, https, no trailing slash
```

**The queue worker must be running.**

Every notification is `ShouldQueue`. No worker means no email at all — and the
request that raised it still returns 200, because that is the whole point of
queueing. Nothing in the application will tell you.

```sh
docker compose exec queue pgrep -fa queue:work    # exactly 1
docker compose exec app php artisan queue:monitor database:default --max=50
```

### The two mail settings

Settings → Email, in the console. Not `.env`: `SettingsService::smtpMailer()`
builds the mailer from the database at send time, so `MAIL_*` in the
environment does nothing for notifications (ADR-0014).

| | |
|---|---|
| Host | `smtp.titan.email` |
| Port | `587`, encryption `tls` (STARTTLS) |
| Username / From | `help@kangaruride.com` |
| Enabled | on |
| Password | the Titan mailbox password |

Port 465 is implicit TLS and hung for 60 seconds when measured; 587 answered in
under a second with a real ESMTP banner. Use 587.

Then **Send test email**, and check it actually left rather than trusting the
green banner:

```sh
docker compose exec app php artisan tinker --execute="
  \$d = Modules\Notifications\Models\MailDelivery::latest('id')->first();
  echo \$d->status, ' ', \$d->recipient, ' ', \$d->error ?? '', PHP_EOL;"
```

`sent` and no error. A `failed` row carries the transport's own words, which is
usually enough to tell a wrong password from a rejected From address.

**Turn on password reset last**, once the test send is green: Settings →
Sign-in methods. It refuses with `AUTH_METHOD_DISABLED` while mail is
unconfigured, so enabling it first only produces a door that answers 409.

### DNS — SPF and DKIM are done, DMARC is not

Checked 24 August 2026 on `kangaruride.com`:

| | |
|---|---|
| SPF | `v=spf1 include:spf.titan.email ~all` — **published** |
| DKIM | `titan1._domainkey` — **published** |
| DMARC | **missing** |

Add this when there is time. It is not needed for mail to send tonight, and it
is needed before volume:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Value | `v=DMARC1; p=none; rua=mailto:help@kangaruride.com; fo=1` |

`p=none` is monitor-only. It changes nothing about delivery and starts the
reports, so you can see who is sending as the domain before deciding anything.
**Do not start at `p=quarantine`**: without a few weeks of reports first, that
is how an organisation bins its own invoices.

Gmail and Yahoo have required DMARC from bulk senders since February 2024 and
increasingly penalise its absence for everybody else. Without it the invoice
emails are measurably likelier to land in spam.

### The cap that fails silently, mid-run

Titan mailboxes have a daily send limit. The platform can exceed it in one
morning without trying: `drivers:remind-expiring-documents` at 06:30 mails
every driver whose licence is 30 or 7 days out, and `fleets:alert-without-accounts`
and `invitations:remind` follow at 07:15 and 09:00.

When the cap is hit the provider simply starts refusing, part-way through, and
every email after that is lost. `mail_deliveries` is where that becomes
visible:

```sh
# Sent today, and anything that failed
docker compose exec app php artisan tinker --execute="
  \$q = Modules\Notifications\Models\MailDelivery::whereDate('created_at', today());
  echo 'sent today: ', (clone \$q)->where('status','sent')->count(), PHP_EOL;
  echo 'failed:     ', (clone \$q)->where('status','failed')->count(), PHP_EOL;"
```

Three consecutive failures also report to Sentry on their own. That alarm is
deliberately **not** an email: the transport that would carry it is the thing
that has failed.

---

## 4 · When something is wrong

### 4.1 The queue worker has died

Symptoms: GPS points stop landing; notifications stop; report exports never
arrive. **The API stays healthy throughout**, so nothing pages you unless the
oldest-job alert is wired (§7).

```sh
docker compose ps queue                                  # is it even up?
docker compose exec queue pgrep -fa queue:work           # expect exactly 1
docker compose logs --tail=100 queue
docker compose exec app php artisan queue:monitor database:default --max=100
docker compose exec app php artisan tinker --execute='echo DB::table("jobs")->count()." queued, ".DB::table("failed_jobs")->count()." failed";'
```

- **Not running:** `docker compose up -d queue`. It is `restart:
  unless-stopped`, so if it is down it either crashed repeatedly or was
  stopped by hand — read the log before restarting it a second time.
- **Running but not consuming** (queue depth climbing): it is almost always
  holding stale code or a dead DB connection. `docker compose restart queue`.
  The worker also self-recycles hourly (`--max-time=3600`).
- **Jobs in `failed_jobs`:** read one before retrying it —
  ```sh
  docker compose exec app php artisan queue:failed
  docker compose exec app php artisan queue:retry all
  ```
  A GPS batch that failed for a deadlock is worth retrying; one that failed
  because of a schema mismatch means a half-finished deploy, not a queue
  problem.

### 4.2 Dispatch has stalled — offers are not advancing

`AdvanceDispatchOffers` runs **every ten seconds**. If it is not running, an
offer sits with one driver until it expires and nothing moves it on.

```sh
docker compose exec scheduler pgrep -fa schedule:work     # expect exactly 1
docker compose logs --tail=50 scheduler                   # should be busy
docker compose exec app php artisan schedule:list         # 7 entries, advance-offers "10s"
```

If the process is gone: `docker compose up -d scheduler`. If it is running but
the schedule shows fewer than seven entries, the container is on stale code —
redeploy rather than restart, and check `APP_BUILD`.

**One-off, to unstick the current offer while you diagnose:**
`docker compose exec app php artisan dispatch:advance-offers`.

### 4.3 The live map is blank

ADR-0003 reads live positions from Redis, never MySQL. Blank map with a
healthy API almost always means the positions are going to the wrong store:

```sh
docker compose exec app php artisan tinker --execute='echo config("tracking.live_positions_driver"), " ", config("dispatch.presence_driver");'
```

Both must print `redis`. **They default to `database`**, and a stack with a
perfectly healthy dedicated Redis will pass every other check while writing
positions to MySQL. If they are wrong, the fix is environment, not code: set
`TRACKING_LIVE_POSITIONS_DRIVER=redis` and `DISPATCH_PRESENCE_DRIVER=redis`
in Coolify and redeploy.

Otherwise check Redis itself: `docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping`.

### 4.4 Uploads fail with "the file failed to upload"

The file never reached Laravel. §3's `ini_get` check first; then nginx's body
limit (`NGINX_CLIENT_MAX_BODY_SIZE`, 16M) — a request over that is refused by
nginx with 413 before PHP sees it.

### 4.5 The database is gone, or corrupted

§6. Restore, and accept the outage — do not improvise repairs on a live
database holding a bank client's trip records.

---

## 5 · Rollback

### 5.1 Decide which rollback you need

| Situation | Do |
|---|---|
| Bad code, **no migration** in the release | §5.2 — code only. Fast, safe. |
| Bad code **with a migration**, old code cannot run on the new schema | §5.3 — schema down, then code back. **Order matters.** |
| Data is wrong or lost | §6 — restore. A rollback does not bring data back. |

### 5.2 Code only

Coolify → the resource → **Deployments** → the previous successful deployment
→ **Redeploy**. Then verify:

```sh
docker compose exec app printenv APP_BUILD     # the older commit
curl -fsS https://api.<domain>/up
```

The release step runs `migrate --force` again; with no new migrations that is
a no-op.

### 5.3 Code with a migration — and why the order is not negotiable

**Roll the schema back while the NEW code is still deployed, then put the old
code back.** Not the other way round.

The `down()` method lives in the migration file, which ships **inside the new
image**. Swap the image back first and that class is gone — you are left with
a new schema, old code that cannot read it, and no way down that does not
involve hand-written SQL against a live database at 2am.

```sh
# 1. still on the new build. Confirm what would come out:
bash deploy/rollback.sh --status

# 2. schema down. Takes a backup first, stops the workers, times itself:
bash deploy/rollback.sh --schema 1 --yes

# 3. now the code: Coolify -> Deployments -> previous -> Redeploy
#    (on a plain Docker host: SOURCE_COMMIT=<old> docker compose up -d)

# 4. prove it landed:
bash deploy/rollback.sh --verify <old commit>
```

**If you get the order wrong, nothing tells you.** This was rehearsed
deliberately (runs
[32126492421](https://github.com/RealAkram20/kangaru/actions/runs/32126492421)
and
[32127105596](https://github.com/RealAkram20/kangaru/actions/runs/32127105596)):
with the image already back, `migrate:rollback` cannot find the migration
file, **rolls back nothing, prints "Rolling back migrations." and exits 0.**
The script reported *"schema rollback done in 12s"*, `--verify` passed,
`APP_BUILD` was the old build and `/up` answered 200. Every signal said the
rollback had worked, and the new schema was still there. `rollback.sh` now
counts applied migrations either side and refuses to claim a rollback it did
not perform — but the ordering above is what stops you needing that guard.

`--schema` refuses without `--yes`, and it stops `queue` and `scheduler`
before touching the schema — a job written against the new schema, picked up
mid-rollback, fails against the old one and lands in `failed_jobs` looking
like the rollback broke something.

**A `down()` is reversible by definition and destructive in practice.** A
dropped column takes its data with it and no `up()` puts it back. That is why
step 2 backs up first, and why AGENTS.md allows a destructive migration to
skip a real `down()` only when the deploy runbook carries a verified backup
step — this is that step.

### 5.4 What the rehearsal measured

The `rollback-rehearsal` CI job performs the whole of §5.3 on every run:
deploy v1 → add a migration → deploy v2 → schema down while v2 runs → v1 back
→ assert the table is gone, `APP_BUILD` is v1, both workers are up, `/up`
answers, and a pre-rollback backup exists.

> **Measured, 18 Aug 2026, over two green runs
> ([32125874574](https://github.com/RealAkram20/kangaru/actions/runs/32125874574),
> [32128219509](https://github.com/RealAkram20/kangaru/actions/runs/32128219509)):
> schema rollback `ROLLBACK_SECONDS` **12–14 s**; complete rollback including
> the image going back `TOTAL_ROLLBACK_SECONDS` **40–43 s**.** The second run
> also reports `migrations applied: 73 -> 72`, which is the proof the schema
> actually moved rather than the script merely saying so.

**Read the breakdown, not the total** — the run's own timestamps:

```
10:18:10  taking a pre-rollback backup
10:18:10  stopping queue and scheduler
10:18:20  migrate:rollback --step=1     <- ten seconds after the stop began
10:18:21  restarting queue and scheduler
10:18:22  schema rollback done in 12s
```

**The migration itself took about a second. Stopping the workers took ten.**
That is the shape to expect: the schema step is dominated by the queue worker
finishing what it holds, not by the SQL. Useful, because it means a rollback
does not get dramatically slower as the schema grows — but it does get slower
if the worker is mid-way through a long job, and `stop_grace_period` allows it
100 s before it is killed. If you are watching a rollback appear to hang at
"stopping queue", that is what it is doing, and letting it finish is correct.

**What the number is worth, stated honestly:** it is the procedure's
mechanics on a 55-table database with no rows, on a runner with a warm local
image cache and no proxy in front. On the production host the code step
includes Coolify rebuilding an image and its proxy switching over — that is
minutes, not seconds — and the schema step grows with whatever the `down()`
has to rewrite. **Budget minutes and measure it for real in §5.5.** What the
rehearsal does prove is that the steps are in the right order, that the
script's guards work, that the table really goes away, and that both workers
come back.

**What that number is worth, stated honestly:** it is the procedure's
mechanics on a 55-table database with no rows, on a runner with a warm local
image cache and no proxy in front. On the production host the schema step
scales with data, and the code step includes Coolify rebuilding an image and
its proxy switching over. **Budget minutes, not seconds, and measure it for
real in §5.5.** What the rehearsal does prove is that the steps are in the
right order, that the script's guards work, and that the workers come back.

### 5.5 The live rehearsal — still owed

Half an hour, before clients are on the system:

1. Deploy any trivial commit to production. Note `APP_BUILD`.
2. Roll it back via §5.2. **Time it with a clock**, not an estimate.
3. Write the number here, replacing this list.
4. While you are there, restore last night's backup into a scratch database
   and time that too (§6) — the CI restore is of an empty schema.

Until step 3 is done, this runbook's §5.4 number is a CI figure and everyone
reading it should treat it as one.

---

## 6 · Backup and restore

Nightly at 23:15 UTC (02:15 Kampala) plus one on every start of the `backup`
container; 14 days kept on the `backups` volume; a dump is discarded unless
it carries mysqldump's `Dump completed on` trailer.

```sh
docker compose exec backup /opt/kangaruride/restore.sh --list
docker compose exec backup /opt/kangaruride/backup.sh --once
docker compose exec backup /opt/kangaruride/restore.sh <file> --yes
```

`restore.sh` **drops and recreates the database**. The API answers 500 for the
duration. It refuses without `--yes` and prints `RESTORE_SECONDS`.

**Two things the backup does not cover, and both matter:**

1. **`app-storage`** — driver identity documents (ADR-0033, encrypted at
   rest), odometer photos, branding uploads, report exports. The nightly dump
   is MySQL only. A host-level volume backup is still owed.
2. **Off-server copies.** The `backups` volume lives on the same disk as the
   database it protects. One bad disk takes both.

**And `APP_KEY` is not in any backup.** Driver documents and every
`mfa_secret` are encrypted with it. Restore a database without the original
key and the rows come back permanently unreadable, with no error. Keep it
where the server is not.

---

## 7 · Alerts

AGENTS.md Observability, minimum set, **paged — not emailed into a void**:

| Alert | Threshold | Why this one |
|---|---|---|
| 5xx rate | > 2% for 5 min | the only one clients report themselves |
| Oldest queued job | > 5 min | **the queue-worker death alarm.** Without it §4.1 is invisible. |
| GPS ingestion lag | > 60 s | trip distance, and therefore the fare, is being lost |
| Failed invoice generation | any | billing correctness — the platform's core claim |
| Disk | > 80% | MySQL, backups and container logs share it |
| Certificate expiry | < 14 days | Coolify renews; this catches the renewal that didn't |
| Mail transport failing | 3 in a row | **wired, unlike the rest of this table.** `SettingsMailChannel` reports to Sentry after three consecutive failures. Deliberately not an email: the transport that would carry it is the thing that failed. |
| Fleet with no account | any | **wired.** `fleets:alert-without-accounts`, daily. ADR-0059 §5 says this cannot happen; if it has, that fleet is unsupportable because there is nobody for support to act as. |

Minimum dashboard: API p95 latency, 5xx rate, queue depth and oldest job age,
GPS ingestion lag, failed jobs, dispatch decision time, DB connections.

**Status: the two mail rows are wired; none of the rest are.** Container logs are JSON on stderr and
Coolify captures them, which is where a collector would read from, but no
alerting exists. **A dispatch stall or a dead queue worker is currently found
by a human noticing.** Standing this up is not in any Track A package and it
should be week-one work.

Interim, and worth ten minutes: a cron on the host that greps the two
counters and emails on threshold — **but not for the mail alarm**, which
cannot be delivered by the thing it is watching:

```sh
docker compose exec -T app php artisan tinker --execute='
  $oldest = DB::table("jobs")->min("available_at");
  echo $oldest ? (time() - $oldest)." s oldest job" : "queue empty";'
```

---

## 8 · Who is called at 2am

| Role | Who | Contact |
|---|---|---|
| First responder | — | — |
| Escalation | — | — |
| Database / restore authority | — | — |
| Client communication | — | — |

**This table is empty because nobody has told me who to put in it, and
inventing a name would be worse than the blank.** The owner fills it before
go-live. It is on the go/no-go list for a reason: at 2am the question is never
*what do I do* — this file answers that — it is *am I allowed to do it, and
who do I wake*.

Alongside it, decide and write down:

- Who may authorise a **restore** (it destroys everything since the dump).
- Who tells the anchor client, and how fast, when their dispatch was down.
- Where `APP_KEY` and the database passwords live, and who can reach them
  when the one person who set them up is unreachable.
