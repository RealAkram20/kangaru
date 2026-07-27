import React from "react";
import { Badge } from "./Badge.jsx";

/* The trip lifecycle from PROJECT.md, plus finance states. Keys are lowercase,
   space or underscore insensitive, so "Trip Started" and "trip_started" both work. */
export const TRIP_STATES = {
  booking_created: { label: "Booking created", tone: "neutral", icon: "file-plus" },
  approved: { label: "Approved", tone: "info", icon: "check" },
  assigned: { label: "Assigned", tone: "info", icon: "user-check" },
  rejected: { label: "Rejected", tone: "error", icon: "user-x" },
  accepted: { label: "Accepted", tone: "info", icon: "check-check" },
  driver_en_route: { label: "En route", tone: "info", icon: "navigation" },
  driver_arrived: { label: "Arrived", tone: "info", icon: "map-pin" },
  no_show: { label: "No show", tone: "error", icon: "user-round-x" },
  passenger_onboard: { label: "Onboard", tone: "brand", icon: "users" },
  trip_started: { label: "In progress", tone: "brand", icon: "play" },
  waiting: { label: "Waiting", tone: "warning", icon: "pause" },
  trip_completed: { label: "Completed", tone: "success", icon: "circle-check" },
  invoice_generated: { label: "Invoiced", tone: "info", icon: "receipt" },
  disputed: { label: "Disputed", tone: "warning", icon: "triangle-alert" },
  closed: { label: "Closed", tone: "neutral", icon: "lock" },
  cancelled: { label: "Cancelled", tone: "error", icon: "circle-x" },
  flagged: { label: "Variance flagged", tone: "warning", icon: "triangle-alert" },
  paid: { label: "Paid", tone: "success", icon: "circle-check" },
  overdue: { label: "Overdue", tone: "error", icon: "clock-alert" },
  draft: { label: "Draft", tone: "neutral", icon: "pencil" },
};

export function StatusBadge({ state, label, size = "md", style, ...rest }) {
  const key = String(state || "").toLowerCase().replace(/[\s-]+/g, "_");
  const def = TRIP_STATES[key] || { label: label || state, tone: "neutral", icon: "circle" };
  return (
    <Badge tone={def.tone} icon={def.icon} size={size} style={style} {...rest}>
      {label || def.label}
    </Badge>
  );
}
