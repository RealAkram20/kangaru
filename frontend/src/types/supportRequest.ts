/**
 * A driver's written report, and the office's answer (ADR-0044).
 *
 * The mirror of `Modules\Support\Resources\SupportRequestResource`, which is
 * an allow-list — every field here is one the API names, and nothing is
 * inferred from a model.
 */
export interface SupportRequest {
  id: number
  driver_id: number
  /** Present on the office queue; absent on the driver's own list. */
  driver_name?: string | null
  topic: SupportRequestTopic
  topic_label: string
  status: SupportRequestStatus
  status_label: string
  /** The journey it is about, or null. */
  trip_id: number | null
  /** The driver's own account, verbatim. */
  body: string
  /**
   * The office's reply, or null while it is still owed.
   *
   * **Null cannot mean "refused quietly".** ADR-0044 §2 removed the status
   * that would have allowed a report to leave the queue unanswered, so null
   * here is precisely "somebody still owes this driver a reply".
   */
  answer: string | null
  answered_by?: string | null
  answered_at: string | null
  created_at: string
}

/** The five Help Topics rows in the driver app, which are also this enum. */
export type SupportRequestTopic = 'report' | 'passenger' | 'vehicle' | 'payment' | 'lost_item'

export type SupportRequestStatus = 'open' | 'answered'
