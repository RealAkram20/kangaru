# Mail DNS — the records, ready to paste

Everything the domain needs so email from KangaruRide arrives instead of
landing in spam. **Copy the Value column straight into Cloudflare.**

You should not need to ask anybody about this file. §4 covers changing email
provider, which is the case where these records move.

| | |
|---|---|
| Domain | `kangaruride.com` |
| DNS host | **Cloudflare** (`quincy.ns.cloudflare.com`, `rose.ns.cloudflare.com`) |
| Email provider | **Titan** |
| Sending mailbox | `help@kangaruride.com` |
| Last verified | 24 August 2026, against 1.1.1.1, 8.8.8.8 and Cloudflare's own nameserver |

Cloudflare is where all of these live. Not Titan, and not the registrar.
**dash.cloudflare.com → kangaruride.com → DNS → Records → Add record.**

Two things that catch people out in the Cloudflare form:

- The **Name** field takes the short label only. Type `_dmarc`, not
  `_dmarc.kangaruride.com` — Cloudflare appends the domain and you end up with
  `_dmarc.kangaruride.com.kangaruride.com` if you type the whole thing.
- **There is no proxy toggle** on TXT or MX records. If you see an orange
  cloud, you are on the wrong record type.

---

## 1 · What is already there, and correct

Do not re-add these. They are listed so you can check them against Cloudflare
and so §4 tells you which ones move if the provider changes.

### MX — where mail to @kangaruride.com is delivered

| Type | Name | Value | Priority |
|---|---|---|---|
| `MX` | `@` | `mx1.titan.email` | `10` |
| `MX` | `@` | `mx2.titan.email` | `20` |

### SPF — who is allowed to send as the domain

| Type | Name | Value | TTL |
|---|---|---|---|
| `TXT` | `@` | `v=spf1 include:spf.titan.email ~all` | Auto |

**There must be exactly one SPF record.** Two is worse than none: receivers
treat a domain with two `v=spf1` records as a permanent error and stop
trusting either. If you ever add a second sender, put it *inside* this one as
another `include:` rather than creating a new record.

### DKIM — the signature that proves the mail is really yours

| Type | Name | Value | TTL |
|---|---|---|---|
| `TXT` | `titan1._domainkey` | see below | Auto |

```
v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCIQFZTjAsjkteFiS8aO5PazXhYiNjQ/89ZAkuvyJONvT3LFkP0t7EhOO8ktzJVepsBpO8rKrnilLICvtl47vGOaMq1nIC4vOYcFNxuyZLXUF6ZPTfOmo2z26EBJSngCvdJmwbpmJuDq31wwiuybx3PGgi5UaFX6USE1dS/+Kjb4QIDAQAB
```

This is the one record with an actual key in it, and Titan generated it. It is
a **public** key — it is meant to be readable by anybody, which is why it sits
in DNS. Recorded here so a rebuild does not mean going back to Titan for it.

---

## 2 · The one that is missing

DMARC. Confirmed absent on 24 August 2026 from three separate resolvers.

**DMARC has no key and no credential.** Unlike DKIM there is nothing to fetch
from Titan; the value below is the whole record and you write it yourself.

| Type | Name | Value | TTL |
|---|---|---|---|
| `TXT` | `_dmarc` | see below | Auto |

```
v=DMARC1; p=none; rua=mailto:help@kangaruride.com; fo=1
```

What each part does:

| | |
|---|---|
| `p=none` | **Monitor only. Changes nothing about delivery.** It just starts the reports. |
| `rua=mailto:help@kangaruride.com` | Where the daily reports arrive. That mailbox already exists, which is why it is used. |
| `fo=1` | Report when SPF *or* DKIM fails, rather than only when both do. |

### Why bother, given `p=none` changes nothing

Gmail and Yahoo have required DMARC from bulk senders since February 2024 and
increasingly penalise its absence for everybody else. A domain with SPF and
DKIM but no DMARC is treated as less trustworthy than one with all three, so
invoices are measurably likelier to land in spam.

It is also the only way to find out if somebody is sending mail as your domain.

### Do not start at `p=quarantine`

The temptation is to skip `p=none` and go straight to enforcement. Resist it.
Until you have read a few weeks of reports you do not know what legitimately
sends as your domain — an accounting package, a booking tool, a mailing list
somebody set up years ago. Enforcing first is how an organisation bins its own
invoices and takes a fortnight to notice.

Move to `p=quarantine` when the reports show only Titan. Then `p=reject` after
that, if you want it.

### Cloudflare's DMARC Management wizard

There is one, under **Email**. It works, but it points `rua` at Cloudflare's
own address rather than yours, so the reports go somewhere you do not read.
The manual record above sends them to `help@`. Use the manual one.

---

## 3 · Checking it worked

DNS takes a few minutes to propagate. From any terminal:

```sh
nslookup -type=TXT _dmarc.kangaruride.com 1.1.1.1
```

You want to see the `v=DMARC1` string back. All four at once:

```sh
nslookup -type=MX  kangaruride.com                       1.1.1.1
nslookup -type=TXT kangaruride.com                       1.1.1.1   # SPF
nslookup -type=TXT titan1._domainkey.kangaruride.com     1.1.1.1   # DKIM
nslookup -type=TXT _dmarc.kangaruride.com                1.1.1.1   # DMARC
```

Or paste the domain into any DMARC checker. There are several free ones and
they all read the same public records these commands do.

---

## 4 · If the email provider changes

This is the section that means you never have to ask.

**Three of the four records are provider-specific and all three move together.**
Getting one right and leaving another pointing at Titan is the most common way
a migration half-works: mail arrives but is unsigned, or is signed but fails
SPF, and either way it starts going to spam.

| Record | Moves? | What to do |
|---|---|---|
| `MX` | **Yes** | Replace both with the new provider's. Delete the Titan ones — leaving them means mail keeps trying Titan first. |
| `SPF` | **Yes** | Replace `include:spf.titan.email` with the new provider's include. **Keep it as one record**, do not add a second. |
| `DKIM` | **Yes** | Delete `titan1._domainkey` and add whatever selector the new provider gives you. The name changes too, not just the value. |
| `DMARC` | **No** | Leave it alone. It describes your policy, not your provider. |

Then, in this application:

1. **Settings → Email** in the console. Change host, port, username, password
   and From address to the new provider's. Not `.env`: the mailer is built from
   these settings at send time (ADR-0014), so `MAIL_*` in the environment does
   nothing for notifications.
2. Press **Send test email** and confirm it arrives.
3. Check the delivery actually left rather than trusting the green banner:

```sh
php artisan tinker --execute="
  \$d = Modules\Notifications\Models\MailDelivery::latest('id')->first();
  echo \$d->status, ' ', \$d->recipient, ' ', \$d->error ?? '', PHP_EOL;"
```

4. Watch DMARC reports for a week. If the new provider is misconfigured, the
   reports say so before your clients do.

### The trap when the From address changes

Most providers refuse to send as an address on a domain they have not verified,
and the refusal arrives as a transport error nobody reads. If the From address
moves off `@kangaruride.com`, the SPF and DKIM above stop covering it and both
have to be redone for the new domain.

---

## 5 · Current mail settings in the application

For reference. Changed in **Settings → Email**, never in `.env`.

| | |
|---|---|
| Host | `smtp.titan.email` |
| Port | `587`, encryption `TLS (standard)` — STARTTLS |
| Username | `help@kangaruride.com` |
| From | `help@kangaruride.com`, name `KangaruRide` |

Port 465 is implicit TLS. It was measured on 24 August 2026 and hung for 60
seconds; 587 answered in under a second with a real ESMTP banner. Use 587.
