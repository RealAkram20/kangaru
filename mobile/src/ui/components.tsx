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

import { CheckIcon, ChevronLeftIcon, EyeIcon, EyeOffIcon } from './icons';
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
  ...inputProps
}: TextInputProps & { label: string; hint?: string; error?: string | undefined }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        style={[styles.input, error !== undefined && styles.inputError]}
        {...inputProps}
      />
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