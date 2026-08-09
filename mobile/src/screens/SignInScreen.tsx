import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { Button, Field, Notice, Screen } from '../ui/components';
import { colors, spacing, typography } from '../ui/theme';

/**
 * One step, one screen.
 *
 * No sign-up link and no "forgot password", and their absence is the design
 * rather than an omission: ADR-0016 issues driver accounts through an
 * administrator, and there is no self-service reset endpoint by deliberate
 * decision. A dead link to a flow that does not exist is worse than no link,
 * so the screen says who to ask instead.
 *
 * No MFA step either — it is required of Super Admin and Finance only
 * (PROJECT.md). A driver who has voluntarily enrolled one (ADR-0010) is told
 * plainly, because the app genuinely cannot complete that exchange.
 */
export function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
    // because the server writes it for the person reading it, but nothing here
    // decides anything from its text.
    setProblem(
      outcome.code === 'INVALID_CREDENTIALS'
        ? 'That email and password did not match. Check them and try again.'
        : outcome.message,
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>KangaruRide</Text>
            <Text style={styles.subtitle}>Driver</Text>
          </View>

          {problem !== null && <Notice message={problem} tone="danger" />}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
            onSubmitEditing={() => void submit()}
          />

          <Button
            label="Sign in"
            busy={busy}
            disabled={email.trim() === '' || password === ''}
            onPress={() => void submit()}
          />

          <Text style={styles.footnote}>
            Accounts are issued by your fleet office. If you have forgotten your password, they will
            issue a new one — there is no reset link.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl * 2,
    flexGrow: 1,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.heading,
    color: colors.primary,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.lg,
    lineHeight: 20,
  },
});
