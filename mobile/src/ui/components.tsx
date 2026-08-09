import type { ReactNode } from 'react';
import {
  ActivityIndicator,
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <Text style={styles.buttonLabel}>{label}</Text>
      )}
    </Pressable>
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
