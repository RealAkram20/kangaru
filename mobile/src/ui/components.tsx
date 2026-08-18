import type { ReactNode } from 'react';
import { forwardRef, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon } from './icons';
import { colors, FIELD_HEIGHT, MIN_TOUCH_HEIGHT, motion, radius, spacing, typography } from './theme';

/**
 * The shared pieces. AGENTS.md: "Never duplicate UI. If a component appears
 * more than once, convert it into a reusable component."
 */

/**
 * The press feedback every tappable thing in this app uses.
 *
 * A scale to 0.97, not a fade. Both say "heard you", but a fade says it by
 * making the control *less* present at the moment of contact, and a scale
 * says it by responding physically — which is what a finger on glass expects.
 * The difference is not one a driver would ever name, and it is the kind of
 * detail that adds up.
 *
 * Animated rather than `Pressable`'s `pressed` flag, because that flag flips
 * instantly in both directions and a snap back reads as a glitch. Down is
 * quick so the control feels alive under the thumb; up is slower so the
 * release settles rather than pops.
 *
 * `useNativeDriver` throughout — the animation runs on the UI thread, so it
 * stays smooth while the JS thread is busy doing the thing the press asked
 * for, which on these screens is a network call.
 */
function usePressScale() {
  // Lazy `useState`, not `useRef(...).current`. Both give one stable value for
  // the component's life, but reading `.current` during render is a rule the
  // React Compiler enforces — and it is right to: a ref read in render is
  // invisible to the compiler's memoisation, so it silently opts the whole
  // component out.
  const [scale] = useState(() => new Animated.Value(1));

  const to = useCallback(
    (value: number, duration: number) => {
      Animated.timing(scale, {
        toValue: value,
        duration,
        easing: motion.easeOut,
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );

  return {
    scale,
    onPressIn: useCallback(() => to(0.97, motion.pressIn), [to]),
    onPressOut: useCallback(() => to(1, motion.pressOut), [to]),
  };
}

export { usePressScale };

export function Button({
  label,
  onPress,
  tone = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'neutral' | 'danger';
  /**
   * `md` matches the form fields; `sm` is for choice screens. Never below
   * 48pt — the 44pt platform floor is for taps that can be retried, and even
   * a chooser deserves margin over the minimum.
   */
  size?: 'md' | 'sm';
  disabled?: boolean;
  busy?: boolean;
  /** A leading glyph. Hidden while busy, because the spinner replaces the row. */
  icon?: ReactNode;
}) {
  const background =
    tone === 'danger' ? colors.danger : tone === 'neutral' ? colors.surfaceSunken : colors.primaryCta;

  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || busy, busy }}
        accessibilityLabel={label}
        disabled={disabled || busy}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[
          styles.button,
          { backgroundColor: background, opacity: disabled ? 0.45 : 1 },
          tone === 'neutral' && styles.buttonNeutral,
          size === 'sm' && styles.buttonSm,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={tone === 'neutral' ? colors.textBody : colors.onPrimary} />
        ) : (
          <View style={styles.buttonRow}>
            {icon}
            <Text
              style={[
                styles.buttonLabel,
                tone === 'neutral' && styles.buttonLabelNeutral,
                size === 'sm' && styles.buttonLabelSm,
              ]}
            >
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle | undefined }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({
  label,
  hint,
  error,
  revealable = false,
  ...inputProps
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string | undefined;
  /**
   * Adds a show/hide control to a password field. Only meaningful with
   * `secureTextEntry`; ignored otherwise.
   *
   * **Named to match the web app's `Input`, which took this decision first.**
   * One vocabulary across both apps means a developer who has met one meets
   * the other, and DESIGN.md asks for exactly that of shared controls.
   *
   * Why it is worth having at all: a driver types this one-handed, in sun, on
   * a phone in a cradle, and a mistyped password on the sign-in path costs a
   * minute because the login endpoint is throttled to five attempts. Being
   * able to see what you typed is the difference between one attempt and
   * three.
   */
  revealable?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  // Only when the field is actually a password. `revealable` on a plain text
  // input would render a control that toggles nothing.
  const canReveal = revealable && inputProps.secureTextEntry === true;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}

      <View style={canReveal ? styles.fieldRow : undefined}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.placeholder}
          style={[
            styles.input,
            error !== undefined && styles.inputError,
            canReveal && styles.inputWithTrailing,
          ]}
          {...inputProps}
          // After the spread, so revealing wins over the caller's own value
          // rather than depending on prop order at every call site.
          secureTextEntry={canReveal ? !revealed : inputProps.secureTextEntry}
        />

        {canReveal && (
          <View style={styles.fieldTrailing}>
            <RevealToggle shown={revealed} onToggle={() => setRevealed((on) => !on)} />
          </View>
        )}
      </View>

      {error !== undefined && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

/**
 * The form control the sign-up and sign-in screens are built from: a leading
 * glyph, and the label carried by the placeholder rather than sitting above.
 *
 * That is a real trade — a placeholder-as-label vanishes the moment somebody
 * types, and on a long form it leaves them re-deriving which box is which from
 * their own half-entered text. It is affordable *here* and only here: five
 * fields, every one of them a thing a person can identify by looking at what
 * they typed, and each with a distinct icon that does not vanish. On anything
 * asking for a value a driver cannot self-identify — an odometer reading, a
 * reference — use `Field`, which keeps its label.
 *
 * `accessibilityLabel` is always set from the same string, so the control is
 * labelled for a screen reader whether or not it currently shows text.
 */
export const IconField = forwardRef<
  TextInput,
  TextInputProps & {
    icon: (props: { color: string }) => ReactNode;
    error?: string | undefined;
    focusAccent?: boolean;
    trailing?: ReactNode;
  }
>(function IconField({ icon, error, focusAccent = true, trailing, ...inputProps }, ref) {
  const [focused, setFocused] = useState(false);

  // Focus is instant, not animated. It is the most frequently triggered state
  // change on the screen and the user has just tapped the thing — a 150ms fade
  // in response to direct contact reads as lag, not as polish.
  const borderColor = error !== undefined
    ? colors.danger
    : focused && focusAccent
      ? colors.primary
      : colors.border;

  const iconColor = error !== undefined
    ? colors.danger
    : focused && focusAccent
      ? colors.primary
      : colors.placeholder;

  return (
    <View style={styles.iconFieldBlock}>
      <View style={[styles.iconField, { borderColor }]}>
        <View style={styles.iconFieldGlyph}>{icon({ color: iconColor })}</View>

        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          style={styles.iconFieldInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...inputProps}
        />

        {trailing}
      </View>

      {error !== undefined && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
});

/**
 * The reveal control inside a password field.
 *
 * It is a 44pt target inside a 58pt row, which is why it is padded rather than
 * sized: the glyph wants to sit visually close to the right edge and the thumb
 * wants a target much larger than the glyph.
 */
export function RevealToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shown ? 'Hide password' : 'Show password'}
      accessibilityState={{ selected: shown }}
      onPress={onToggle}
      hitSlop={8}
      style={styles.reveal}
    >
      {shown ? (
        <EyeOffIcon color={colors.textMuted} size={20} />
      ) : (
        <EyeIcon color={colors.textMuted} size={20} />
      )}
    </Pressable>
  );
}

/**
 * A checkbox that fills rather than blinks.
 *
 * Two stacked layers crossfading, with the tick springing up from 0.6 — never
 * from zero, because nothing in the world appears out of nothing, and a tick
 * that pops into existence at full size reads as a rendering glitch. Both
 * layers move on opacity and transform only, so the whole thing runs on the UI
 * thread and stays smooth while the form validates underneath.
 */
export function Checkbox({
  checked,
  onToggle,
  children,
  error = false,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
  error?: boolean;
}) {
  const [fill] = useState(() => new Animated.Value(checked ? 1 : 0));

  const animate = useCallback(
    (to: number) => {
      Animated.spring(fill, {
        toValue: to,
        // Apple's parameterisation: a duration and a small amount of bounce is
        // far easier to reason about than stiffness and damping, and 0.25 is
        // enough to feel physical without the tick wobbling.
        useNativeDriver: true,
        damping: 14,
        stiffness: 220,
        mass: 0.6,
      }).start();
    },
    [fill],
  );

  const toggle = () => {
    animate(checked ? 0 : 1);
    onToggle();
  };

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={toggle}
      hitSlop={6}
      style={styles.checkboxRow}
    >
      <View style={styles.checkbox}>
        <Animated.View
          style={[
            styles.checkboxIdle,
            error && styles.checkboxError,
            { opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
          ]}
        />
        <Animated.View
          style={[
            styles.checkboxFilled,
            {
              opacity: fill,
              transform: [{ scale: fill.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
            },
          ]}
        >
          <CheckIcon size={15} color={colors.onPrimary} />
        </Animated.View>
      </View>

      <View style={styles.checkboxLabel}>{children}</View>
    </Pressable>
  );
}

/**
 * The way back, on screens that sit outside a navigator.
 *
 * The auth flow is plain state rather than a stack (see RootNavigator), so
 * nothing draws a header with a back arrow in it — this is that arrow.
 * Absolute, so screens do not have to redesign their layout around it.
 */
export function BackButton({ onPress, topInset }: { onPress: () => void; topInset: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      hitSlop={8}
      style={[styles.back, { top: topInset + spacing.sm }]}
    >
      <ChevronLeftIcon color={colors.textBody} size={26} />
    </Pressable>
  );
}

/**
 * The header on a screen that draws its own — back arrow, title, and a status
 * line when it says something the title does not.
 *
 * ## Why this is shared, and why it is not `BackButton`
 *
 * Three screens grew the same header independently — `PickupScreen`,
 * `WaitingForPassengerScreen` and `TripInProgressScreen`, all registered with
 * `headerShown: false` because each has its own. AGENTS.md: *"If a component
 * appears more than once, convert it into a reusable component."*
 *
 * `BackButton` above is the auth flow's arrow and is deliberately absolute and
 * title-less: those screens are illustrations with a form on them and have no
 * header row to sit in. This is a row, and it reserves its own height.
 *
 * ## The bug it exists to fix
 *
 * **The status bar.** `Screen` applies no top inset, and the navigator applies
 * none either when `headerShown` is false — so all three screens drew their
 * title *underneath* the clock and the battery icon. It is invisible in a
 * simulator with a short status bar and unmissable on a real handset, which is
 * where it was found: the title overlapped the carrier name and the time.
 *
 * The inset is read here rather than passed in, so no screen can forget it.
 */
export function ScreenHeader({
  title,
  subtitle = null,
  onBack,
  action,
}: {
  title: string;
  /**
   * Rendered only when non-null. Callers pass null rather than the title
   * again: a subtitle that repeats its own heading is a line a driver learns
   * to skip, which costs the cases where it carries something — "Waiting" on
   * a held trip, for one.
   */
  subtitle?: string | null;
  /**
   * What the arrow does. Optional so a header can be drawn without one.
   *
   * **Not necessarily `goBack()`.** A tab root has nothing on its own stack to
   * pop, and `goBack()` there is a *silent no-op* — a control that looks live,
   * is tapped, and does nothing. That is not a reason to drop the arrow (the
   * mockups draw one on the tab roots, and a driver arriving from a Home card
   * expects it); it is a reason for those screens to pass an explicit
   * destination instead. `WalletScreen` and `EarningsScreen` both navigate to
   * the Home tab.
   *
   * When it is omitted the title stays flush left rather than keeping the
   * arrow's gutter, so a header without one does not read as a pushed screen
   * missing its control.
   */
  onBack?: (() => void) | undefined;
  /**
   * One control at the trailing edge — the trip record's *Help* pill.
   *
   * A slot rather than a `helpLabel`/`onHelp` pair, because the header should
   * not learn what any particular screen's action *is*. It stays optional and
   * every existing caller renders exactly as before.
   *
   * **One.** A row with two trailing controls is a toolbar, and a toolbar on a
   * screen a driver reads one-handed in a cradle is a row of mis-taps.
   */
  action?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.headerRow, { paddingTop: insets.top + spacing.sm }]}>
      {onBack !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={10}
          style={styles.headerBack}
        >
          <ChevronLeftIcon color={colors.text} size={26} strokeWidth={2.2} />
        </Pressable>
      )}

      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== null && (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      {action}
    </View>
  );
}

/**
 * A row in a settings-style list: glyph, label, a value, and a chevron.
 *
 * Shared because it appears six times on the profile screen alone, which is
 * AGENTS.md's rule twice over. It is deliberately *not* `DetailRow` from
 * `ui/facts.tsx`: that one states a fact and is not tappable, and folding the
 * two together would give every fact on every screen a chevron that goes
 * nowhere.
 *
 * **The value carries a tone, and never a tone alone.** `docs/screen-rules.md`
 * §6: colour must not be the only thing carrying meaning, so a caller passing
 * `tone="danger"` is also passing the word that says why. Nothing here draws a
 * coloured dot with no label beside it.
 */
export function MenuRow({
  icon,
  label,
  subtitle = null,
  value = null,
  tone = 'muted',
  onPress,
  announcement,
  showsChevron = true,
  longValue = false,
}: {
  icon: ReactNode;
  label: string;
  /**
   * A second line under the label, saying what the row is for.
   *
   * **Added for ADR-0044**, and the reason is worth keeping: Help & Safety
   * drew five rows — *Report an issue*, *Passenger issue*, *Vehicle issue*… —
   * whose distinguishing sentence was passed as `announcement` and therefore
   * existed **only for a screen reader**. A sighted driver saw five identical
   * chevron rows, and the owner read them as *"repeated and fake"*. They were
   * not repeated; they were undifferentiated, which looks the same.
   *
   * Use it where the label alone cannot say which of several similar rows
   * this is. A row whose name already answers that ("Documents", "Log out")
   * takes none — a subtitle on every row is a second column of prose on a
   * screen read at a glance from a cradle.
   */
  subtitle?: string | null;
  /** The right-hand word — a state, a count, or null for a plain row. */
  value?: string | null;
  /**
   * That the value is a long identifier rather than a short state, so the
   * **value** yields to the label instead of the other way round.
   *
   * The default is right for what this row was built for: "1 needs attention"
   * clipped to "1 needs atten…" keeps the half that matters, so the label goes
   * first. An email address inverts it. On a 393dp screen "Email the office"
   * beside `operations@kangaruride.com` clipped the *label* to **"Email
   * th…"** — a control whose own name is unreadable — while the address lost
   * its domain as well. Both halves were damaged to protect a value that could
   * afford to lose its tail.
   *
   * Opt in only for values that are identifiers: an address, a plate, a
   * reference. A status word must keep the default, or it will be the
   * label that survives and the state that vanishes.
   */
  longValue?: boolean;
  tone?: 'good' | 'warning' | 'danger' | 'muted';
  onPress: () => void;
  /**
   * One composed sentence for a screen reader, instead of the label and the
   * value being read as two disconnected fragments.
   */
  announcement?: string;
  /**
   * Off for a row whose action happens in place — signing out opens a dialog
   * rather than a screen, and a chevron would promise somewhere to go.
   */
  showsChevron?: boolean;
}) {
  const press = usePressScale();

  const valueColor =
    tone === 'good'
      ? colors.primaryText
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warning
          : colors.textMuted;

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={announcement ?? (value === null ? label : `${label}. ${value}`)}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.menuRow}
      >
        <View style={styles.menuIcon}>{icon}</View>

        {/*
          Two shapes, and the subtitle-less one is deliberately identical to
          what this row always rendered — a bare `Text` carrying the flex
          rules, not a `View` wrapper that happens to have one child. Twenty
          rows across the app depend on that layout, and "it looks the same"
          is not the same as "it is the same".
        */}
        {subtitle === null ? (
          <Text
            style={[styles.menuLabel, longValue ? styles.menuLabelKept : null]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ) : (
          <View style={styles.menuStack}>
            <Text style={styles.menuStackLabel} numberOfLines={1}>
              {label}
            </Text>
            {/*
              Two lines, not one. These say what a topic is *for* — "A
              passenger who was abusive, refused to pay, or did not travel" —
              and clipping that to one line takes back most of what the
              subtitle was added to give.
            */}
            <Text style={styles.menuSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        )}

        {value !== null && (
          <Text
            style={[
              styles.menuValue,
              longValue ? styles.menuValueYields : null,
              { color: valueColor },
            ]}
            numberOfLines={1}
          >
            {value}
          </Text>
        )}

        {showsChevron && <ChevronRightIcon color={colors.textMuted} size={20} strokeWidth={2.2} />}
      </Pressable>
    </Animated.View>
  );
}

/** A word inside a sentence that is tappable. Green, per DESIGN.md §3. */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text accessibilityRole="link" onPress={onPress} style={styles.link}>
      {label}
    </Text>
  );
}

export function SocialButton({
  label,
  mark,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  mark: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const press = usePressScale();

  return (
    <Animated.View style={[styles.socialWrap, { transform: [{ scale: press.scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue with ${label}`}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.social, { opacity: disabled ? 0.45 : 1 }]}
      >
        {busy ? <ActivityIndicator color={colors.textMuted} /> : mark}
        {!busy && <Text style={styles.socialLabel}>{label}</Text>}
      </Pressable>
    </Animated.View>
  );
}

/** A hairline with a word in it. */
export function Divider({ label }: { label: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerRule} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.dividerRule} />
    </View>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'live' | 'done';
}) {
  const palette =
    tone === 'live'
      ? { bg: colors.infoTint, fg: colors.info }
      : tone === 'done'
        ? { bg: colors.successTint, fg: colors.success }
        : { bg: colors.surfaceSunken, fg: colors.textMuted };

  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillLabel, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Notice({
  message,
  tone = 'warning',
}: {
  message: string;
  tone?: 'warning' | 'danger' | 'info';
}) {
  const palette =
    tone === 'danger'
      ? { bg: colors.dangerTint, fg: colors.danger }
      : tone === 'info'
        ? { bg: colors.infoTint, fg: colors.info }
        : { bg: colors.warningTint, fg: colors.warning };

  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.fg }]}
    >
      <Text style={[styles.noticeText, { color: palette.fg }]}>{message}</Text>
    </View>
  );
}

/**
 * A glyph in a soft circular well.
 *
 * The mockup's Help Topics rows draw every icon this way, and it recurs five
 * times on that one screen — AGENTS.md's "if it appears twice it is shared"
 * with four to spare. It is a wrapper rather than a `framed` flag on `MenuRow`
 * because the same treatment is wanted on things that are not rows: the
 * Contact Support card ends in one.
 *
 * **The well is `surfaceSunken` by default, and that is not decoration.** A
 * bare 22pt glyph against white at arm's length in sunlight is a smudge; a
 * filled disc gives the eye an edge to catch, which is the same reason
 * DESIGN.md prefers contrast over subtlety in this app. Pass a tint when the
 * chip belongs to a toned card, so it does not read as a hole punched in it.
 */
export function IconChip({
  children,
  size = 44,
  background = colors.surfaceSunken,
}: {
  children: ReactNode;
  size?: number;
  background?: string;
}) {
  return (
    <View
      style={[
        styles.iconChip,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
      ]}
    >
      {children}
    </View>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    // Above the 44pt platform floor, like everything tappable in this app.
    minHeight: MIN_TOUCH_HEIGHT,
    paddingVertical: spacing.sm,
  },
  menuIcon: {
    // `minWidth`, not `width`, so a row may pass a framed glyph (`IconChip`)
    // without it being clipped to 24. Every glyph that was here before is 20-24
    // wide and renders at exactly the same position it always did.
    minWidth: 24,
    alignItems: 'center',
  },
  iconChip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: {
    ...typography.bodyStrong,
    color: colors.text,
    // The label yields first: "Documents" truncating to "Docum…" is
    // recoverable, "1 needs atten…" is the half that matters.
    flexShrink: 2,
    flexGrow: 1,
  },
  /** The label + subtitle column. Takes the flex the bare label would have. */
  menuStack: {
    flexShrink: 2,
    flexGrow: 1,
  },
  menuStackLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  menuSubtitle: {
    ...typography.caption,
    // `textMuted`, never `placeholder`: DESIGN.md §1 demotes #979DA9 on light
    // surfaces by name — 2.72:1 on white, which fails AA for text.
    color: colors.textMuted,
    marginTop: 2,
  },
  menuValue: {
    ...typography.captionStrong,
    fontSize: 15,
    // Shrinkable, at half the label's rate. `flexShrink: 0` read as "the
    // value is protected" and was really "the value overflows the row": a
    // localised label and a localised value together exceed a 360dp screen,
    // and something has to give. This gives, reluctantly.
    flexShrink: 1,
  },
  /** `longValue`: the label stops yielding, so its own name stays readable. */
  menuLabelKept: {
    flexShrink: 0,
  },
  /** `longValue`: the identifier gives up its tail instead. */
  menuValueYields: {
    flexShrink: 4,
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    ...typography.heading,
    color: colors.primaryText,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  button: {
    minHeight: FIELD_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonNeutral: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonSm: {
    minHeight: 48,
  },
  back: {
    position: 'absolute',
    left: spacing.sm,
    zIndex: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabelSm: {
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  buttonLabel: {
    ...typography.button,
    color: colors.onPrimary,
  },
  buttonLabelNeutral: {
    color: colors.textBody,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.textBody,
    marginBottom: spacing.xs,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: MIN_TOUCH_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textBody,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  inputError: {
    borderColor: colors.danger,
  },
  // The toggle overlays the field's right edge rather than sitting beside it,
  // so a revealable field is exactly as wide as a plain one — otherwise the
  // three rows on the change-password screen would not line up with each
  // other, and the two that hold a new password would be narrower than the one
  // that holds the current one.
  fieldRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  inputWithTrailing: {
    // Clears the toggle so a long password does not run underneath it.
    paddingRight: spacing.xl + spacing.md,
  },
  fieldTrailing: {
    position: 'absolute',
    right: 0,
    // Full height so the 44pt target inside `RevealToggle` is centred on the
    // row however tall the field grows.
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  iconFieldBlock: {
    marginBottom: spacing.sm + 4,
  },
  iconField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: FIELD_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  iconFieldGlyph: {
    width: 24,
    alignItems: 'center',
  },
  iconFieldInput: {
    flex: 1,
    height: '100%',
    color: colors.textBody,
    paddingHorizontal: spacing.sm + 2,
    ...typography.body,
  },
  reveal: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs + 2,
    marginLeft: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    // Nudged down so the box sits on the first line's optical centre rather
    // than its box top, which on a two-line label looks a pixel high.
    marginTop: 2,
  },
  checkboxIdle: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: radius.sm - 3,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  checkboxError: {
    borderColor: colors.danger,
  },
  checkboxFilled: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: radius.sm - 3,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    marginLeft: spacing.sm + 2,
  },
  link: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  socialWrap: {
    // Stretches to the column it sits in. Was `flex: 1` when the sign-up
    // screen paired two of these in a row; the welcome screen stacks them
    // full-width instead, which is also what their reference designs do.
    alignSelf: 'stretch',
  },
  social: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    // 48, not the 52 the work screens hold to: these live on choice screens,
    // where a mis-tap opens the wrong door rather than posting a transition.
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  socialLabel: {
    ...typography.label,
    fontSize: 16,
    color: colors.textBody,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  pillLabel: {
    ...typography.captionStrong,
  },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  noticeText: {
    ...typography.body,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});