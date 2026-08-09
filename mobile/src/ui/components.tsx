import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from './theme';

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
 * quick (110ms) so the control feels alive under the thumb; up is slower
 * (160ms) so the release settles rather than pops.
 *
 * `useNativeDriver` throughout — the animation runs on the UI thread, so it
 * stays smooth while the JS thread is busy doing the thing the press asked
 * for, which on this screen is a network call.
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
        // A strong ease-out. The built-in curves are too weak to read as
        // intentional at this distance.
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );

  return {
    scale,
    onPressIn: useCallback(() => to(0.97, 110), [to]),
    onPressOut: useCallback(() => to(1, 160), [to]),
  };
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const background =
    tone === 'danger' ? colors.danger : tone === 'neutral' ? colors.surfaceRaised : colors.primary;

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
        style={[styles.button, { backgroundColor: background, opacity: disabled ? 0.45 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.buttonLabel}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

export { usePressScale };

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
        placeholderTextColor={colors.textMuted}
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

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'live' | 'done' }) {
  const background =
    tone === 'live' ? colors.primary : tone === 'done' ? colors.success : colors.surfaceRaised;

  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={styles.pillLabel}>{label}</Text>
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
  const background =
    tone === 'danger' ? colors.danger : tone === 'info' ? colors.surfaceRaised : colors.warning;

  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: background }]}>
      <Text style={styles.noticeText}>{message}</Text>
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
    minHeight: MIN_TOUCH_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonLabel: {
    ...typography.label,
    fontSize: 17,
    color: colors.primaryText,
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
    color: colors.text,
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
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  pillLabel: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primaryText,
  },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  noticeText: {
    ...typography.body,
    color: colors.primaryText,
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
