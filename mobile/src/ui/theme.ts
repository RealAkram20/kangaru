import { Easing } from 'react-native';

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
 *
 * The palette is DESIGN.md's, which the first cut of this app did not use — it
 * shipped a slate-and-blue scheme that matched nothing else the platform owns.
 * Moving to white surfaces also happens to serve the sunlight case better than
 * the dark scheme did: phone screens fight glare with luminance, and a white
 * background emits it across the whole panel where a dark one emits almost
 * none. The dark theme was solving for the night driver at the cost of the
 * daylight one, who is the common case.
 */
export const colors = {
  /** Surfaces. The screen is white; sunken is for insets and disabled fills. */
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSunken: '#F7F8FA',

  /**
   * Brand green, three ways.
   *
   * `primary` is the identity colour — the logo, large accents, the active tab.
   * `primaryCta` fills buttons instead, and is deliberately a step darker:
   * white on `primary` measures ~4.1:1, which DESIGN.md §3 permits only for
   * large or bold text, and a control that is only legible in semibold is a
   * control with a trap in it. `#016B2E` clears 4.5:1 for normal text, so the
   * button stays correct whatever weight its label ends up in.
   */
  primary: '#01903D',
  primaryCta: '#016B2E',
  primaryPressed: '#015E35',
  /** Green *text* on a light surface — never `primary`, which fails at body size. */
  primaryText: '#015E35',
  primaryTint: '#E6F4EC',

  navy: '#001028',
  navySoft: '#0A1F3D',

  /** Headings take navy; body takes the softer near-navy. Pure black is never used. */
  text: '#001028',
  textBody: '#1A2233',
  textMuted: '#5B6472',
  placeholder: '#979DA9',

  border: '#D6DAE1',
  borderStrong: '#B9C0CB',

  danger: '#B42318',
  dangerTint: '#FEE4E2',
  warning: '#B54708',
  warningTint: '#FEF0C7',
  success: '#015E35',
  successTint: '#E6F4EC',
  info: '#175CD3',
  infoTint: '#EFF4FF',
  offline: '#B54708',

  /**
   * A rating star, and the only warm colour in the palette.
   *
   * DESIGN.md has no gold, and `warning` (#B54708) is a brown that reads as a
   * fault rather than a score. Declared here as a token so it is stated once
   * instead of appearing as a hex literal at whatever call site needs it.
   */
  star: '#F5A623',

  onPrimary: '#FFFFFF',
  onNavy: '#FBFBFB',

  /**
   * Secondary text and hairlines on a navy surface.
   *
   * Both are DESIGN.md §1 palette entries this app simply had no dark chrome
   * to need until the offer screen grew a navy header — `gray-muted` and
   * `gray-dark` respectively. They are *not* interchangeable with their light
   * counterparts and the split matters: `#979DA9` measures ~2.7:1 on white and
   * fails AA there, which is why `textMuted` exists, and ~7:1 on navy, where
   * it is the right colour. Reaching for `textMuted` on navy instead would
   * quietly halve the contrast.
   */
  onNavyMuted: '#979DA9',
  borderOnNavy: '#293348',

  /**
   * A hairline on a filled green surface — the wallet balance card.
   *
   * White at low alpha rather than a solid tint, because it has to sit on
   * `primaryCta` and read as a divider rather than as a second colour. It is
   * a token rather than an `rgba()` at the call site for the reason DESIGN.md
   * §8 gives: raw colour values in component code fail review, and the next
   * green surface should reach for this instead of inventing its own alpha.
   *
   * `borderOnNavy` is the counterpart for the dark chrome and is *not*
   * interchangeable — it is opaque, and on green it would read as a smudge.
   */
  borderOnPrimary: 'rgba(255, 255, 255, 0.28)',

  /**
   * The dim behind a modal sheet.
   *
   * Navy rather than black, so the screen behind reads as *dimmed* rather
   * than as switched off — the sheet sits over content the driver still needs
   * (the balance a settlement request concerns), and a black scrim makes the
   * page look gone rather than waiting.
   *
   * A token for DESIGN.md §8's reason: raw colour values in component code
   * fail review, and the next sheet should reach for this rather than pick
   * its own alpha.
   */
  scrim: 'rgba(0, 16, 40, 0.45)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
};

/**
 * The two families DESIGN.md §6 specifies. Sora is display-only — it is never
 * to carry body text or table content, where its wide geometric forms cost
 * both horizontal space and scanning speed.
 *
 * Weight is carried by the font *family name*, never by `fontWeight`. Naming
 * both is the standard React Native custom-font bug: Android has no family to
 * synthesise from, so it silently falls back to a system face and the screen
 * renders in something that is not Sora at all.
 */
export const fonts = {
  display: 'Sora_700Bold',
  displaySemi: 'Sora_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
};

export const typography = {
  /**
   * Sized by a specific sentence: "Welcome to KangaruRide" has to sit on one
   * line inside the auth screens' gutters on the narrowest phone in the fleet.
   * Sora is a wide geometric face and 30pt wrapped it onto two lines on a
   * 393dp handset, which turns the app's first impression into a ragged stack.
   * Raise this and check that headline before believing it still fits.
   */
  display: { fontFamily: fonts.display, fontSize: 26, lineHeight: 34 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32 },
  heading: { fontFamily: fonts.displaySemi, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  captionStrong: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20 },
  button: { fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 22 },
  /**
   * The odometer. Displayed at this size because it is the number the whole
   * contract turns on, and because a driver has to be able to check it against
   * a dashboard they are looking at from an arm's length away.
   */
  odometer: { fontFamily: fonts.display, fontSize: 34, lineHeight: 42, letterSpacing: 1 },
};

/**
 * Motion, in one place so the app moves with one accent rather than seven.
 *
 * The curve is a strong ease-out: the built-in easings are too weak to read as
 * deliberate at arm's length. Press-down is quicker than release, because a
 * control should meet the thumb immediately and settle rather than snap back.
 */
export const motion = {
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
  easeInOut: Easing.bezier(0.77, 0, 0.175, 1),
  pressIn: 110,
  pressOut: 160,
  enter: 220,
  exit: 160,
};

/** Above the 44pt platform minimum: a mis-tap here posts a state transition. */
export const MIN_TOUCH_HEIGHT = 52;

/** The mockup's inputs and CTA are visibly taller than the tap minimum. */
export const FIELD_HEIGHT = 58;