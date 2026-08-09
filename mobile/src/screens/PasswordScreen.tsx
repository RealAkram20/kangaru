import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { changePassword } from '../api/endpoints';
import { isApiError } from '../api/errors';
import { useAuth } from '../auth/AuthProvider';
import { MINIMUM_PASSWORD_LENGTH, passwordProblem, passwordProblemMessage } from '../auth/passwordRules';
import { useSync } from '../offline/SyncProvider';
import { Button, Card, Field, Notice, Screen } from '../ui/components';
import { colors, spacing, typography } from '../ui/theme';
import type { AccountStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<AccountStackParams, 'ChangePassword'>;

/**
 * Changing the password an administrator issued.
 *
 * There is no self-service reset (ADR-0016), so accounts arrive with a
 * password somebody else chose and typed into a console. This screen is the
 * only way it stops being theirs.
 *
 * Two things make it unlike every other write in this app:
 *
 * 1. **It is not queued.** Everything else goes through the offline outbox;
 *    this needs a connection and says so. A credential change applied hours
 *    later, from a queue, would sign the driver out mid-shift for a reason
 *    they no longer remember.
 * 2. **Success ends the session.** `PATCH /auth/password` revokes every token
 *    including the caller's, so the moment it returns 200 the app is holding a
 *    dead credential. It signs out locally rather than making one more request
 *    it knows will 401.
 */
export function PasswordScreen({ navigation }: Props) {
  const { api, signOutLocally } = useAuth();
  const { pending } = useSync();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const localProblem = passwordProblem({ current, next, confirmation });

  const submit = async () => {
    if (localProblem !== null) {
      setProblem(passwordProblemMessage(localProblem));

      return;
    }

    setBusy(true);
    setProblem(null);

    try {
      const message = await changePassword(api, { currentPassword: current, newPassword: next });

      // Sign out only once the driver has read what happened. The tabs unmount
      // the instant `user` becomes null, so showing this after would flash it
      // away behind the sign-in screen.
      Alert.alert('Password changed', message, [
        { text: 'Sign in again', onPress: () => void signOutLocally() },
      ]);
    } catch (error) {
      setBusy(false);

      if (!isApiError(error)) {
        setProblem('No connection. Changing your password needs one — try again in coverage.');

        return;
      }

      // Branching on `code`. A wrong current password is a 422 carrying
      // INVALID_CREDENTIALS rather than VALIDATION_FAILED, which is worth
      // naming: a generic "check the form" would send the driver hunting
      // through three fields for a mistake that is only ever in the first.
      setProblem(
        error.code === 'INVALID_CREDENTIALS'
          ? 'That is not your current password.'
          : error.message,
      );
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>
            At least {MINIMUM_PASSWORD_LENGTH} characters. This signs you out on every device,
            including this one.
          </Text>

          {pending > 0 && (
            <Notice
              tone="info"
              message={`${pending} ${pending === 1 ? 'update is' : 'updates are'} still waiting to send. They stay on this phone and go out when you sign back in.`}
            />
          )}

          {problem !== null && <Notice message={problem} tone="danger" />}

          <Card>
            <Field
              label="Current password"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              autoCapitalize="none"
              textContentType="password"
            />

            <Field
              label="New password"
              value={next}
              onChangeText={setNext}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />

            <Field
              label="New password again"
              value={confirmation}
              onChangeText={setConfirmation}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
              onSubmitEditing={() => void submit()}
            />
          </Card>

          <Button
            label="Change password"
            busy={busy}
            disabled={localProblem !== null}
            onPress={() => void submit()}
          />

          <Button label="Cancel" tone="neutral" onPress={() => navigation.goBack()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
  },
});
