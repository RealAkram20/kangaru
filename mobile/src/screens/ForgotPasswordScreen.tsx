import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { forgotPassword, resetPassword } from '../api/endpoints';
import { isApiError } from '../api/errors';
import { useAuth } from '../auth/AuthProvider';
import { MINIMUM_PASSWORD_LENGTH } from '../auth/passwordRules';
import { Button, IconField, Notice, RevealToggle } from '../ui/components';
import { ChevronLeftIcon, LockIcon, MailIcon } from '../ui/icons';
import { colors, fonts, spacing, typography } from '../ui/theme';

/**
 * The emailed reset code, driver's side (ADR-0028 §2).
 *
 * Two steps on one screen: ask for the code, then spend it. The screen never
 * claims the email exists — the server's 202 deliberately does not say, and
 * copy that said "code sent!" would be lying half the time and teaching
 * enumeration the rest.
 *
 * A successful reset ends at the sign-in screen rather than in the app: the
 * server revoked every session, and the one honest next step is signing in
 * with the password just chosen.
 */
export function ForgotPasswordScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { api } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const codeInput = useRef<TextInput>(null);

  const requestCode = async () => {
    if (email.trim() === '') {
      setProblem('Enter the email you sign in with.');

      return;
    }

    setBusy(true);
    setProblem(null);

    try {
      await forgotPassword(api, email.trim());
      setStep('code');
    } catch (error) {
      setProblem(
        isApiError(error)
          ? error.message
          : 'No connection. Nothing was sent.',
      );
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (code.trim().length !== 6) {
      setProblem('Enter the six-digit code from the email.');

      return;
    }

    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      setProblem(`Your new password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`);

      return;
    }

    if (password !== confirmation) {
      setProblem('The two passwords do not match.');

      return;
    }

    setBusy(true);
    setProblem(null);

    try {
      await resetPassword(api, {
        email: email.trim(),
        code: code.trim(),
        password,
        confirmation,
      });
      setDone(true);
    } catch (error) {
      setProblem(
        isApiError(error)
          ? error.message
          : 'No connection — the reset was not applied.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
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
          onPress={onDone}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeftIcon color={colors.onPrimary} size={26} />
        </Pressable>

        <Text style={styles.hello}>Forgot{'\n'}password?</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={[
            styles.sheetContent,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {done ? (
            <>
              <View accessibilityLiveRegion="polite" style={styles.doneCard}>
                <Text style={styles.doneTitle}>Password changed</Text>
                {/* Kept: a driver whose other sessions were closed needs to
                    know why the app signed them out. */}
                <Text style={styles.doneBody}>All sessions were signed out.</Text>
              </View>

              <Button label="Back to sign in" onPress={onDone} />
            </>
          ) : (
            <>
              {problem !== null && <Notice message={problem} tone="danger" />}

              {step === 'email' ? (
                <>
                  <Text style={styles.lead}>Enter the email you sign in with.</Text>

                  <IconField
                    icon={({ color }) => <MailIcon color={color} />}
                    placeholder="Email address"
                    accessibilityLabel="Email address"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    returnKeyType="done"
                    onSubmitEditing={() => void requestCode()}
                  />

                  <Button label="Send code" busy={busy} onPress={() => void requestCode()} />
                </>
              ) : (
                <>
                  <Text style={styles.lead}>
                    Check {email.trim()} for a six-digit code. It expires in 15 minutes.
                  </Text>

                  <IconField
                    ref={codeInput}
                    icon={({ color }) => <LockIcon color={color} />}
                    placeholder="6-digit code"
                    accessibilityLabel="Reset code"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="next"
                  />

                  <IconField
                    icon={({ color }) => <LockIcon color={color} />}
                    placeholder="New password"
                    accessibilityLabel="New password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    trailing={
                      <RevealToggle
                        shown={showPassword}
                        onToggle={() => setShowPassword((on) => !on)}
                      />
                    }
                  />

                  <IconField
                    icon={({ color }) => <LockIcon color={color} />}
                    placeholder="Confirm new password"
                    accessibilityLabel="Confirm new password"
                    value={confirmation}
                    onChangeText={setConfirmation}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={() => void submitReset()}
                  />

                  <Button label="Change password" busy={busy} onPress={() => void submitReset()} />

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void requestCode()}
                    style={styles.resend}
                    hitSlop={6}
                  >
                    <Text style={styles.resendText}>Send a new code</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
  lead: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  resend: {
    alignSelf: 'center',
    marginTop: spacing.lg,
  },
  resendText: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  doneCard: {
    backgroundColor: colors.successTint,
    borderRadius: 18,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  doneTitle: {
    ...typography.heading,
    color: colors.success,
    marginBottom: spacing.sm,
  },
  doneBody: {
    ...typography.body,
    color: colors.textBody,
  },
});