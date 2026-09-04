# ADR-0053: Driver documents are encrypted at rest

**Status:** Accepted — 21 August 2026

**Amends:** nothing. It **implements** a requirement AGENTS.md has carried
since Phase 1 and that nothing had ever satisfied.

**Depends on:** ADR-0033 (driver documents, §5 in particular), ADR-0048
(documents on an application).

## Context

AGENTS.md, under Security → Technical requirements, has said this since the
first commit:

> Encryption at rest: MySQL tablespace encryption, R2 default encryption;
> **driver documents (IDs, licenses) additionally app-level encrypted.**

Nothing implemented it. `DriverDocumentStore::store()` called
`UploadedFile::storeAs()` and the plaintext landed on `FILESYSTEM_DISK`,
which is `local` in every environment file in this repository. A photograph of
somebody's national ID sat on the operator's filesystem exactly as the camera
produced it.

**The gap was found by writing a sentence.** The KYC mockup (ADR-0048) draws a
reassurance panel reading *"All your information is encrypted and will only be
used for verification purposes"*, and `docs/screen-rules.md` §1 forbids a
screen stating what the platform cannot produce. The panel was about to be
either shipped as a falsehood or quietly dropped.

It was put to the owner as a choice between three: say something true instead,
build the encryption, or ship the mockup's wording as drawn. **The owner chose
to build it.** That is the right call and it is worth saying why the cheap
option was genuinely tempting: ADR-0033 §5 already keeps these files off
public URLs and behind an authenticated, policy-checked controller, so the
honest sentence would have been a good sentence. What it would not have
covered is the threat this ADR is actually about — **a copy of the disk**: a
backup tape, a misconfigured sync, a decommissioned volume, a support engineer
with shell access. None of those go through the controller.

## Decision

**Document bytes are encrypted with the application key before they are
written, and decrypted on the one path that serves them.**

### 1. Laravel's encrypter, whole-file

`Crypt::encryptString()` — AES-256-CBC with an HMAC, keyed by `APP_KEY`.
Nothing bespoke, no second key management story, no new dependency.

Whole-file rather than a streaming cipher, because
`StoreDriverDocumentRequest` caps an upload at 8 MB and the peak cost is that
plus its ciphertext. A streaming cipher is the right answer for a video store
and the wrong complexity for a photograph of a licence.

**`Storage::put`, not `UploadedFile::storeAs`.** The framework helper *moves*
the temporary file, which is exactly what must not happen here: the plaintext
would arrive on the disk under its final name and only then be replaced,
leaving a window in which the document is readable — and, if the process died
inside it, a plaintext file that nothing records as plaintext. Reading the
bytes and writing the ciphertext is one operation with no such window.

Ciphertext is roughly 1.4× the plaintext, since Laravel's payload is
base64-encoded JSON. An 8 MB upload occupies about 11 MB. `size_bytes` on the
row keeps recording the **document's** size, which is the number a human
cares about; the disk cost is an operational fact, recorded here.

### 2. `driver_documents.encrypted`, a stored boolean

Files written before this migration exist and cannot be read with a decryptor.
Two alternatives were rejected:

- **Rewriting every file in the migration.** A data migration that reads,
  encrypts and rewrites every document is irreversible in practice, has to be
  right the first time on production, and fails halfway leaving the set
  half-readable with nothing recording which half.
- **Sniffing the payload on read.** Laravel's ciphertext is base64 JSON, so a
  `json_decode` would *usually* tell the two apart. "Usually" means a PDF that
  happened to decode is served as gibberish. **Guessing at the meaning of
  bytes is not a security posture.**

A stored boolean answers exactly, per row, forever. Old rows keep `false` and
stream as they always did; everything written from now on is `true`.

**The flag describes the file; it does not control anything.** No code path
consults it to decide whether to *encrypt* — the store always encrypts. It is
read only to decide how to interpret what is already on disk.

### 3. One read path, because there were two writers of the old one

`DriverDocumentStore::download()` is the only thing on this platform that
knows a stored document may be ciphertext, and that is deliberate. **Two
controllers stream these rows** — the driver's own (`/me/documents/{id}/file`)
and the office's review screen — and AGENTS.md makes the second occurrence the
moment something becomes shared. A decryption branch present in one and absent
from the other would serve a national ID as gibberish to exactly one audience,
which is the kind of bug nobody reports because the other screen works.

`Storage::response()` is gone from both. It streams straight off the disk and
infers the content type from the bytes, and both halves are now wrong: the
bytes are ciphertext and they sniff as plain text. The response is built from
the stored `mime_type` — recorded from the upload before encryption — with
`original_name` as the filename and `Cache-Control: private, no-store`,
because nothing between the office and the server should keep a copy.

A row flagged `encrypted` whose bytes this key cannot open **throws** rather
than falling back to the raw bytes or answering 404. In practice it means
`APP_KEY` was rotated without re-encryption, and it should read as the
key-management failure it is rather than as a missing file.

### 4. What this does not do

**It is not end-to-end encryption and does not pretend to be.** The
application holds the key, so anyone who can run the application can read a
document — which is the point, because the office has to look at them. The
threat model is a copy of the storage without a copy of the running system.

**`APP_KEY` is now load-bearing for stored data, not just for sessions.**
Rotating it without re-encrypting these files makes them unreadable. That is a
new operational obligation and it belongs in the deploy runbook.

**There is no backfill.** A deployment carrying documents written before this
change holds a shrinking set of plaintext files until each is replaced. That
is the honest state of §2's decision, and pretending otherwise would need the
data migration rejected there.

**Odometer photographs and driver portraits are not covered.** They go through
`OdometerPhotoStore` and `DriverPhotoController`, they are not identity
documents, and AGENTS.md names only driver documents. Extending it is a small
change and a separate decision.

## Consequences

**The KYC screen's security panel is now true**, which is the reason this
exists. It says the documents are encrypted and that only the office can open
them, and both halves hold.

**`docs/data-inventory.md` gains a truer row.** ADR-0048 already added a face
to that inventory; this changes how it is held.

**Reading a document costs more.** The whole file is loaded and decrypted per
request instead of being streamed from disk. For an 8 MB ceiling, read by a
person in an office a handful of times per driver, that is not a figure worth
optimising — but it is a real change from a `sendfile`-shaped path to an
application-memory one, and it is why the ceiling matters more than it did.

**A restore is no longer a file copy.** Restoring documents from a backup now
requires the `APP_KEY` that was current when they were written. The runbook
has to say so.

## Alternatives considered

**Saying something true on the screen instead** — "your documents are private;
only the office can open them". Accurate, free, and the option I recommended.
Rejected by the owner in favour of building the thing, and their reasoning
holds: the sentence would have been true about the *controller* and silent
about the disk.

**Disk-level or database-level encryption only.** AGENTS.md already asks for
MySQL tablespace encryption and R2 default encryption and calls app-level
encryption *additional*. Volume encryption protects a stolen disk and protects
nothing at all from a copy taken off a running system, which is the more
likely of the two.

**A per-document key with an envelope scheme.** The right answer for a store
that must revoke access to individual files. Nothing here revokes access to an
individual document, and it would add a key table, a rotation story and a
recovery story to protect against a threat — one document compromised without
the application key — that does not arise.

**Encrypting the whole `local` disk through a Flysystem adapter.** Attractive,
and it would have caught odometer photographs too. Rejected because it makes
every reader of every file implicitly a decryptor, including code that has no
business reading document bytes, and because the per-row `encrypted` flag in
§2 would have had nowhere to live.
