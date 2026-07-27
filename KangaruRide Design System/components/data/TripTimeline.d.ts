export interface TripEvent {
  /** Lifecycle event name, e.g. "Trip started". */
  label: string;
  /** Timestamp, rendered in JetBrains Mono. */
  time?: string;
  /** Muted supporting line — who, where, odometer value. */
  detail?: string;
  /** Slot for a thumbnail, Badge or Identifier under the event. */
  meta?: React.ReactNode;
  /** Lucide icon inside the node; defaults to a check. */
  icon?: string;
  /** done (green) · active (brand green) · warning · error · pending (hollow). */
  tone?: "done" | "active" | "warning" | "error" | "pending";
  /** Shorthand: false renders the pending state. */
  done?: boolean;
}

export interface TripTimelineProps {
  events?: TripEvent[];
  style?: React.CSSProperties;
}

export declare function TripTimeline(props: TripTimelineProps): JSX.Element;
