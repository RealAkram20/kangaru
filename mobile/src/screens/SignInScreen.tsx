import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { useAuthMethods } from '../auth/authMethods';
import { Notice, RevealToggle, TextLink, usePressScale } from '../ui/components';
import { CheckIcon, ChevronLeftIcon } from '../ui/icons';
import { colors, fonts, radius, spacing, typography } from '../ui/theme';

/**
 * One step, one screen: a brand header saying hello, and a white sheet with
 * the two fields on it.
 *
 * There is still no self-service password reset — ADR-0016's reasoning has
 * not moved — but the screen now *answers* "Forgot password?" instead of
 * pre-emptively lecturing about it: the link is where every driver's thumb
 * expects it, and tapping it explains who actually issues a new password.
 * A fact nobody asked for is noise; the same fact behind the question is an
 * answer.
 *
 * No MFA step either — required of Super Admin and Finance only (PROJECT.md).
 * A driver who voluntarily enrolled one (ADR-0010) is told plainly, because
 * the app genuinely cannot complete that exchange.
 */
export function SignInScreen({
  onSignUp,
  onBack,
  onForgot,
}: {
  onSignUp: () => void;
  onBack: () => void;
  onForgot: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { password_reset_enabled: resetAvailable } = useAuthMethods();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resetHint, setResetHint] = useState(false);

  const passwordInput = useRef<TextInput>(null);

  /** The tick beside a well-formed address — feedback, not validation. */
  const emailLooksRight = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    setBusy(true);
    setProblem(null);

    const outcome = await signIn(email.trim(), password);

    setBusy(false);

    if (outcome.kind === 'signed_in') {
      return;
    }

    if (outcome.kind === 'mfa_required') {
      setProblem(
        'This account uses a second factor, which the Driver App cannot complete. Please contact the office.',
      );

      return;
    }

    // Branching on `code`, never on the message — the message is then shown
    // because the server writes it for the person reading it, but nothing
    // here decides anything from its text.
    setProblem(
      outcome.code === 'INVALID_CREDENTIALS'
        ? 'That email and password did not match. Check them and try again.'
        : outcome.message,
    );
  };

  return (
    <View style={styles.screen}>
      {/* White icons while the navy-on-green header is up; the other auth
          screens set it back to dark. */}
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.primary, colors.primaryPressed]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeftIcon color={colors.onPrimary} size={26} />
        </Pressable>

        <Text style={styles.hello}>
          Hello{'\n'}Sign in!
        </Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/* The sheet. Rounded shoulders riding up over the header, exactly as
            the reference draws it — the overlap is what makes it read as a
            card laid on the brand surface rather than two stacked blocks. */}
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {problem !== null && <Notice message={problem} tone="danger" />}

          <UnderlineField
            label="Email"
            placeholder="you@example.com"
            accessibilityLabel="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordInput.current?.focus()}
            trailing={
              emailLooksRight ? <CheckIcon size={18} color={colors.success} /> : undefined
            }
          />

          <UnderlineField
            ref={passwordInput}
            label="Password"
            placeholder="Your password"
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            trailing={
              <RevealToggle shown={showPassword} onToggle={() => setShowPassword((on) => !on)} />
            }
          />

          {/* Where the owner has enabled the emailed-code flow (ADR-0028),
              the link goes there; where they have not, it answers honestly
              in place. Same thumb position either way. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => (resetAvailable ? onForgot() : setResetHint((on) => !on))}
            style={styles.forgotRow}
            hitSlop={6}
          >
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>

          {resetHint && !resetAvailable && (
            <Text style={styles.resetHint}>
              There is no reset link — your fleet office issues a new password and you change it
              after signing in.
            </Text>
          )}

          <GradientPill
            label="SIGN IN"
            busy={busy}
            disabled={email.trim() === '' || password === ''}
            onPress={() => void submit()}
          />

          {/* Pushes the sign-up hand-off to the sheet's bottom corner. */}
          <View style={styles.flex} />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account? </Text>
            <TextLink label="Sign up" onPress={onSignUp} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Label over value over hairline — the reference's field, in our tokens.
 *
 * Local to this screen on purpose: the boxed `IconField` remains the app's
 * standard control, and a second field style earns a place in the shared kit
 * only when a second screen wants it (AGENTS.md's duplication rule, applied
 * in the other direction).
 */
const UnderlineField = forwardRef<
  TextInput,
  TextInputProps & { label: string; trailing?: ReactNode }
>(function UnderlineField({ label, trailing, ...inputProps }, ref) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={[styles.fieldRow, focused && styles.fieldRowFocused]}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          style={styles.fieldInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...inputProps}
        />
        {trailing}
      </View>
    </View>
  );
});

/** The reference's gradient pill, with the kit's press feedback. */
function GradientPill({
  label,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      >
        <LinearGradient
          // `primaryCta`, not `primary`, and this is a contrast fix rather
          // than a taste one. White on `primary` (#01903D) measures 4.15:1 —
          // and the label below is 16px semibold, which is *not* WCAG "large
          // text" (that starts at 18.66px bold), so it needs 4.5:1 and did
          // not have it. `theme.ts` names this exact trap: "a control that is
          // only legible in semibold is a control with a trap in it."
          // `primaryCta` (#016B2E) measures 6.7:1 and the gradient still
          // reads as a gradient.
          colors={[colors.primaryCta, colors.primaryPressed]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.pill, { opacity: disabled ? 0.45 : 1 }]}
        >
          <Text style={styles.pillLabel}>{busy ? 'SIGNING IN…' : label}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const SHEET_RADIUS = 28;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: colors.primaryPressed,
  },
  header: {
    paddingHorizontal: spacing.lg,
    // Room for the sheet's shoulders to ride up over the bottom of it.
    paddingBottom: spacing.xl + SHEET_RADIUS,
  },
  back: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  hello: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 44,
    color: colors.onPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  sheet: {
    flex: 1,
    marginTop: -SHEET_RADIUS,
    backgroundColor: colors.surface,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
  },
  sheetContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg + 2,
    paddingTop: spacing.xl + spacing.sm,
  },
  field: {
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    ...typography.captionStrong,
    color: colors.primaryText,
    marginBottom: 2,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
    // 48, and it was ~38 before this line — under the 44pt platform floor.
    //
    // The password row got away with it by accident: `RevealToggle` is a 44pt
    // target and propped the row open. The *email* row's trailing slot holds
    // an 18px tick or nothing, so it stayed short, and the field a driver
    // taps first was the one too small to tap.
    //
    // 48 rather than the theme's 52, matching `SocialButton`'s documented
    // exception for the same reason: 52 is for controls that post a state
    // transition, and a mis-tap here focuses the wrong box, which costs a
    // tap rather than a fare.
    minHeight: 48,
  },
  fieldRowFocused: {
    borderBottomColor: colors.primary,
  },
  fieldInput: {
    flex: 1,
    ...typography.body,
    color: colors.textBody,
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: spacing.xl,
  },
  forgot: {
    ...typography.captionStrong,
    color: colors.textBody,
  },
  resetHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
  },
  pill: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    letterSpacing: 1.5,
    color: colors.onPrimary,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});