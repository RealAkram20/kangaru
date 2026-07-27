export type TripState =
  | "booking_created" | "approved" | "assigned" | "rejected" | "accepted"
  | "driver_en_route" | "driver_arrived" | "no_show" | "passenger_onboard"
  | "trip_started" | "waiting" | "trip_completed" | "invoice_generated"
  | "disputed" | "closed" | "cancelled" | "flagged" | "paid" | "overdue" | "draft";

export interface StatusBadgeProps {
  /** Lifecycle state key. Accepts "Trip Started", "trip-started" or "trip_started". */
  state: TripState | string;
  /** Overrides the canonical label; the tone and icon still come from the state. */
  label?: string;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}

export declare function StatusBadge(props: StatusBadgeProps): JSX.Element;
export declare const TRIP_STATES: Record<string, { label: string; tone: string; icon: string }>;
