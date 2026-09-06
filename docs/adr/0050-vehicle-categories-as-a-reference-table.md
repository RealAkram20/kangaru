# ADR-0050: Vehicle categories as a reference table, and what "synced to the rate cards" can honestly mean

**Status:** Accepted — 21 August 2026

**Closes the deferral** recorded in `Modules/Vehicles/README.md`: *"Vehicle
categories are validated strings, not a reference table. Adding a category
means editing `Vehicle::CATEGORIES` and shipping."* The `create_vehicles_table`
migration says the same thing in a comment on the column itself.

**Depends on:** ADR-0001 (tenancy), ADR-0004 (permissions), ADR-0005 (the
fleet belongs to the platform), ADR-0011 (contract or it does not exist),
ADR-0021 (zone pricing), ADR-0026 (the platform's public tariff).

**Does not amend** AGENTS.md's money rules or ADR-0021. It is written to be
compatible with the sentence those rest on: *rate cards are versioned and
immutable once used*. Most of what follows is a consequence of that sentence
rather than a new decision.

## Context

The owner asked for three things: create, edit and delete vehicles; create,
edit and delete **categories**; and "all these are synced to the rate cards".

### The first is a missing surface, not a missing feature

`VehicleController` has had `store`, `update` and `destroy` since Phase 1 —
policy, form requests, service, soft deletes, audit trail. **No screen has
ever called any of them.** `VehiclesPage` was a 90-line read-only table. This
is the same finding ADR-0048 made about drivers, in the same file layout, one
page along, and it is closed the same way: build the form.

### The second is not

`Vehicle::CATEGORIES` is a PHP `const` — nine strings — and it is mirrored by
hand in **four** other places:

| where | shape | drifted? |
|---|---|---|
| `Vehicle::CATEGORIES` | PHP const, 9 | source |
| `frontend/src/lib/billing.ts` | `VEHICLE_CATEGORIES`, 9 | in step |
| `docs/api/openapi.yaml` | `enum: [...]`, 9 | in step |
| `DriverFormDialog.tsx` | local `CATEGORIES`, **7** | **yes** |
| `mobile/src/duty/offerPresentation.ts` | display labels, 9 keys of 2 vocabularies | display only |

The fourth row is the argument for this ADR in one line. The driver form —
written two days ago, for a platform whose own justification for it is *"most
drivers here own the boda they ride"* — **does not offer `boda`**. A rider
arriving on their own machine cannot have it recorded as what it is. Nobody
did anything careless; a hand-mirrored list drifts, and this one drifted
within 48 hours of its most recent copy being made.

Vehicle's own docblock already records the *previous* time this happened, at
more cost: `boda` and `tricycle` were missing from the const while the live
walk-in tariff already priced both, so a new version of the public tariff
could not be saved through the API at all.

### The third — "synced to the rate cards" — cannot mean what it sounds like

`rate_card_rates.vehicle_category` is a **string on a record that is immutable
by construction**: `PricedRate` throws on update, `RateCardService` has no
price update path, and `invoice_lines.vehicle_category` is a copy of the same
string on a financial document that has already been sent to a client.

Two things follow, and they are not preferences:

1. **A category key can never be renamed.** Renaming `suv` would leave every
   historical invoice line and every immutable rate card rate holding a string
   that names nothing — silently, with no error anywhere, and visible only as
   an invoice that no longer reproduces. `PRODUCT.md`'s whole positioning is
   that every invoice is reproducible from stored data.
2. **A category in use can never be deleted.** Same reason, plus: the version
   holding its price cannot be corrected, because versions are immutable.

And a third, which is what the owner's word "synced" actually runs into:

3. **Nothing can add a price to an existing rate card.** So creating a
   category cannot make it priceable on any tariff that already exists. The
   only mechanism the platform has is a *new version*, and a new version is a
   change to what clients are charged.

## Decision

### 1. `vehicle_categories`, keyed by an immutable slug

| column | why |
|---|---|
| `key` | the string already stored on `vehicles.category`, `rate_card_rates.vehicle_category` and `invoice_lines.vehicle_category`. **Set at creation and never editable.** |
| `name` | what the office calls it. Editable, and it is what every screen renders. |
| `description` | optional, for the office's own disambiguation ("14-seater, not the 25") |
| `active` | whether new vehicles and new rate card versions may choose it |
| `position` | display order; the const was already ordered smallest-first because that is how a chooser reads |

**Not `BelongsToTenant`**, matching `Vehicle` and for ADR-0005's reason: one
fleet, one vocabulary. A client does not get their own idea of what a minibus
is.

**No soft deletes.** A category is either active or retired (`active`), and a
row that may be hard-deleted is one that nothing anywhere references — there
is nothing for a tombstone to protect. A third state that no query reads would
be a state that drifts.

The nine existing keys are inserted **by the migration itself**, not a seeder.
A deploy step called "remember to seed the categories" is a deploy step
somebody forgets, and the failure mode is a fleet where no vehicle can be
created.

### 2. The key is immutable; the name is not

`UpdateVehicleCategoryRequest` does not accept `key`. Not "validates it
carefully" — **does not accept it**, so there is no path through which a typo
in a controller could reach the column.

This is the decision that makes the rest safe, and it costs the office
nothing they will feel: nobody outside this repository ever sees `suv`. Every
screen renders `name`, and `name` is editable. Getting the *label* wrong is
the mistake people actually make, and it stays free to fix forever.

### 3. Deleting means retiring, unless nothing has ever used it

`DELETE /api/v1/vehicle-categories/{category}` refuses with **409
`VEHICLE_CATEGORY_IN_USE`** when any vehicle carries the key, any rate card
rate prices it, or any invoice line records it — and the message names the
counts, so the office reads *what* is holding it rather than that something
is.

Otherwise the row is deleted outright. A category typed by mistake five
minutes ago is not evidence of anything, and forcing a permanent retired row
for it would fill the list with the office's typos.

**Retiring is `PATCH {active: false}`** and is never refused. It means "no new
vehicle and no new rate card version may choose this", which is exactly what
an office means by "we do not run tricycles any more". Vehicles already
recorded as tricycles keep working, keep dispatching, and keep invoicing off
the versions that already price them. **Retiring changes no price and voids
no record** — it is the only "delete" that is compatible with §2's reasoning,
which is why the 409 above offers it as the next step rather than merely
refusing.

### 4. Validation reads the table, in one place

The four sites that validated against `Vehicle::CATEGORIES` —
`StoreVehicleRequest`, `UpdateVehicleRequest`, `ValidatesInlineVehicle`,
`StoreRateCardVersionRequest` — all now use one rule object,
`Modules\Vehicles\Rules\ActiveVehicleCategory`. One rule, so four call sites
cannot come to disagree about what a valid category is, which is the failure
this whole ADR is about.

The rule takes an **`alsoAllow` key**, and `UpdateVehicleRequest` passes the
vehicle's current category. Without it, retiring `tricycle` would make every
tricycle in the fleet uneditable — a clerk could not correct the *colour* of a
vehicle whose category the office retired last month. The category is not
what they are changing, and refusing the edit would be the platform enforcing
a rule against a record that predates it.

`Vehicle::CATEGORIES` is **kept**, demoted in its docblock to what it now is:
the list the migration seeds from, and the fallback the web app renders if the
categories request fails. Deleting it would strand `RideVehicleClass`, whose
class-to-category mapping is a documented product decision pointing at those
names.

### 5. "Synced to the rate cards" is: offer it, and say when it is not priced

Per §3 of the Context, a new category cannot be added to an existing tariff.
The owner was shown three options and chose the first:

- **Create it, and say plainly that it is not priced yet.** The category list
  shows, per row, which rate cards' newest versions price it, and links
  straight to the new-version dialog prefilled from the latest version with
  the new category added and blank. Finance types the figures.
- Refuse to create a category until it is priced everywhere — rejected: it
  forces a pricing decision onto a fleet manager who buys three tricycles.
- Auto-mint a version pricing it at zero — rejected: a zero base fare and zero
  per-km is a free trip, minted onto a real immutable tariff nobody approved.

So: **a category screen may show that a category is unpriced. It may never
show a price it invented, and it may never create one.** The unpriced state is
rendered as a warning naming the cards, not as `UGX 0`, per
`docs/screen-rules.md` §1 — a zero reads as a free ride.

The rate card version dialog reads live categories, which is the other
direction of the same sync and the one that was actually broken: a category
added by the office was previously unpriceable until somebody shipped a
frontend build.

### 6. `vehicles.manage`, not a new permission

Managing the vocabulary follows the register it describes — Super Admin,
Operations Manager, Fleet Owner. **No new money power is granted**: creating a
category never sets a price, and every path that sets one still needs
`ratecards.manage`. Reading the list needs `vehicles.view`, which every system
role holds, because the rate card dialog must be able to render the choices to
Finance.

### 7. What this does not do

- **It does not make `RideVehicleClass` editable.** The public order form's
  five customer-facing classes still map to categories in code. That mapping
  is a product decision recorded in that enum's docblock and making it data is
  a separate piece of work with its own conflicts (a class whose category is
  retired has no fallback).
- **It does not touch `openapi.yaml`'s `vehicle_class` enum**, for the same
  reason.
- **Nothing gates on a category's `active` flag at dispatch time.** A retired
  category's vehicles are still offered trips. Consistent with ADR-0033 §6 and
  ADR-0048 §6: this records a fact, it does not change an offer.
- **No backfill of `name` onto historical invoice lines.** They store the key,
  and re-rendering them through today's names would be a document that changes
  after it was sent.

## Consequences

**The office can grow its own vocabulary**, which is the point: a fleet that
buys 14-seaters can record them as 14-seaters the same afternoon, and price
them on the next tariff version, without a deploy.

**Four hand-mirrored lists become one table plus one fallback.** The drifted
seven-item list in `DriverFormDialog` is deleted rather than corrected —
correcting it would have re-armed the same failure.

**A new query on the vehicle screen.** The category list computes pricing
coverage over the newest version of each rate card the actor may see. It costs
three queries, all indexed, on a screen loaded a few times a day by a handful
of staff. It uses `forActor()` throughout, because `RateCardRate` extends
`PricedRate` and is tenant-scoped through it — the trap `RateCardController`
already documents at length, where scoping the parent and loading the child
plainly yields a tariff that appears to price nothing.

**A category cannot be un-retired into a version.** Re-activating a retired
category makes it choosable again, but the tariff versions written while it
was retired do not price it, so it will be unpriced until a new version is
written. The screen says so; the platform does not paper over it.

**The 409 is a real state, not a validation error.** The request is
well-formed and the world refuses it, which is the same reading
`CLIENT_PLACE_IN_USE` and `ROLE_IN_USE` already have in `ErrorCode`.

## Alternatives considered

**Leave the const and add categories by deploy.** Honest about the constraint
and it is what has been done until now, but the owner's ask is precisely to
stop doing it, and the drifted driver form shows the maintenance cost is not
theoretical.

**A DB enum column on `vehicles`.** Would refuse an unknown category at the
storage layer — but `ALTER TABLE` on every category the office adds is the
deploy this ADR removes, and MySQL enums reorder badly under
`migrate:fresh`.

**Store `vehicle_category_id` as a foreign key on rate card rates and invoice
lines.** Correct-looking, and wrong here. An invoice line must reproduce
without joining a mutable table: a foreign key means the document renders
through whatever the category row says *today*, so renaming a category would
retroactively edit a sent invoice. The string is a snapshot, and that is
deliberate. The same reasoning is already in AGENTS.md — *"every invoice line
stores its inputs"*.

**Make the key editable with a cascading rewrite** of vehicles, rate card
rates and invoice lines. This is the option that sounds most helpful and is
most dangerous: it is a mass update of issued financial documents, and it
cannot be undone. Refused outright.
