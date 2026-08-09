/**
 * Design tokens.
 *
 * Sized for the actual conditions: a driver glancing at a phone in a parked
 * vehicle, often in direct Kampala sun, sometimes in the dark, frequently
 * one-handed and occasionally in gloves. That drives three decisions that
 * would look heavy-handed on a desktop console —
 *
 * - **Type starts at 15pt**, not 13. Small type is unreadable through glare.
 * - **Every tappable thing is at least 52pt tall.** Above the 44pt platform
 *   minimum, because a mis-tap here posts a state transition.
 * - **High contrast over subtlety.** AGENTS.md asks for colour contrast under
 *   Accessibility; outdoors it stops being an accessibility nicety.
 */
export const colors = {
  background: '#0F172A',
  surface: '#1E293B',
  surfaceRaised: '#334155',
  border: '#475569',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  danger: '#DC2626',
  warning: '#D97706',
  success: '#16A34A',
  offline: '#B45309',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
};

export const typography = {
  title: { fontSize: 26, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 14, fontWeight: '400' as const },
  /**
   * The odometer. Displayed at this size because it is the number the whole
   * contract turns on, and because a driver has to be able to check it against
   * a dashboard they are looking at from an arm's length away.
   */
  odometer: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 1 },
};

/** Above the 44pt platform minimum: a mis-tap here posts a state transition. */
export const MIN_TOUCH_HEIGHT = 52;
