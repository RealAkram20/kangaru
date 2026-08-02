/**
 * The corporate account a record belongs to.
 *
 * Its own file rather than living in `booking.ts` or `trip.ts`, because
 * both need it and importing it from either into the other makes those two
 * modules circular. Type-only imports are erased, so it would have worked —
 * and been a trap for the first person to add a runtime value to one of
 * them.
 *
 * A *tenant* is the account; `Company` is the profile attached to it. They
 * are deliberately different things (ADR-0005: a corporate client is a
 * client, not an operator), which is why this is not `CompanySummary`.
 */
export interface ClientSummary {
  id: number
  name: string
}
