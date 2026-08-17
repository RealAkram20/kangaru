import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { submitDriverApplication } from '../api/endpoints';
import { isApiError } from '../api/errors';
import { PasswordMeter } from '../auth/PasswordMeter';
import { useAuth } from '../auth/AuthProvider';
import {
  registrationProblem,
  registrationProblemMessage,
  type RegistrationField,
  type RegistrationProblem,
} from '../auth/registrationRules';
import { LegalSheet, type LegalDocument } from './LegalSheet';
import {
  BackButton,
  Button,
  Checkbox,
  IconField,
  Notice,
  RevealToggle,
  Screen,
  TextLink,
} from '../ui/components';
import { LockIcon, MailIcon, PhoneIcon, UserIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';

/**
 * The email application form (ADR-0027 §5).
 *
 * Reached from the WelcomeScreen's "Sign up with email" — the hero carousel
 * and the social buttons live there now, so this screen is only the form:
 * whoever lands here has already chosen how they want in, and everything
 * between them and the Submit button is friction.
 */
export function SignUpScreen({
  onSignIn,
  onBack,
  prefill = null,
}: {
  onSignIn: () => void;
  onBack: () => void;
  /**
   * From a social sign-in that found no account (ADR-0028 §3): the name and
   * email the provider verified. Prefilled, not locked — the server treats
   * every field as unverified anyway, and a person whose Google name is a
   * nickname must be able to write the name on their licence.
   */
  prefill?: { name: string; email: string } | null;
}) {
  // There is no navigator header above this screen to absorb the notch, so the
  // inset is taken here rather than inherited.
  const insets = useSafeAreaInsets();
  const { api } = useAuth();
  const [name, setName] = useState(prefill?.name ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  /** Which consent notice is open over the form, if any. */
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null);

  const [problem, setProblem] = useState<{
    field: RegistrationField;
    problem: RegistrationProblem;
  } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Post-submission is a state, not a toast.
   *
   * A 202 here means "the office will call you" — there is no account yet and
   * nothing to sign in to, so the form's job is over and leaving it editable
   * would invite a second, duplicate application from anybody unsure whether
   * the first one took.
   */
  const [submitted, setSubmitted] = useState(false);

  /**
   * Held so a refused submit can put the cursor where the trouble is.
   *
   * Saying "that number is too short" while leaving the driver to find which
   * of five identical rounded boxes it referred to is half an error message.
   *
   * Five separate refs rather than one map of them, because a map has to be
   * built during render and indexing it there counts as reading a ref mid-render
   * — which the React Compiler rejects, and rightly: a ref read in render is
   * invisible to its memoisation and silently opts the component out.
   */
  const nameInput = useRef<TextInput>(null);
  const phoneInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmationInput = useRef<TextInput>(null);

  /** Runs from the submit handler, never from render. */
  const focusField = (field: RegistrationField) => {
    switch (field) {
      case 'name':
        return nameInput.current?.focus();
      case 'phone':
        return phoneInput.current?.focus();
      case 'email':
        return emailInput.current?.focus();
      case 'password':
        return passwordInput.current?.focus();
      case 'confirmation':
        return confirmationInput.current?.focus();
      case 'terms':
        // Not a text input; its message renders in place instead.
        return undefined;
    }
  };

  /** The message for `field`, or undefined — the shape `IconField` wants. */
  const errorFor = (field: RegistrationField): string | undefined =>
    problem?.field === field ? registrationProblemMessage(problem.problem) : undefined;

  const submit = async () => {
    setRefusal(null);

    const found = registrationProblem({
      name,
      phone,
      email,
      password,
      confirmation,
      acceptedTerms,
    });

    setProblem(found);

    if (found !== null) {
      focusField(found.field);

      return;
    }

    setBusy(true);

    try {
      await submitDriverApplication(api, {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        password,
        confirmation,
        termsAccepted: acceptedTerms,
      });

      setSubmitted(true);
    } catch (error) {
      if (isApiError(error)) {
        // A 422 carries field messages; the first one is shown where the
        // banner goes. Branching is on `code`, never on message text — the
        // message is then shown because the server writes it for the person
        // reading it.
        setRefusal(
          error.code === 'VALIDATION_FAILED'
            ? (Object.values(error.errors)[0]?.[0] ?? error.message)
            : error.message,
        );
      } else {
        setRefusal('No connection. Nothing was sent, and nothing you typed is lost.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <BackButton onPress={onBack} topInset={insets.top} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          // The form is taller than any phone this ships to, so the keyboard
          // arriving must not trap the field it was opened for underneath it.
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.gutter}>
            <Image
              source={require('../../assets/brand/wordmark.png')}
              style={styles.logo}
              contentFit="contain"
              accessible
              accessibilityRole="image"
              accessibilityLabel="KangaruRide — for safety and reliability"
              transition={0}
            />
          </View>

          <Text style={styles.headline}>
            Join <Text style={styles.headlineBrand}>KangaruRide</Text>
          </Text>
          <Text style={styles.subtitle}>The office reviews every application.</Text>

          {submitted ? (
            // The form's job is over. Everything the driver needs to know fits
            // in three sentences, and the one action left is going back.
            <View style={styles.gutter}>
              <View
                accessibilityRole="summary"
                accessibilityLiveRegion="polite"
                style={styles.received}
              >
                <Text style={styles.receivedTitle}>Application received</Text>
                <Text style={styles.receivedBody}>
                  The office will review it and call you on {phone.trim()}. Bring your driving
                  licence when they do — approval needs it. You will sign in here with the email and
                  password you just chose.
                </Text>
              </View>

              <Button label="Back to sign in" tone="neutral" onPress={onSignIn} />
            </View>
          ) : (
            <View style={styles.gutter}>
              {refusal !== null && <Notice message={refusal} tone="info" />}

              <IconField
                ref={nameInput}
                icon={({ color }) => <UserIcon color={color} />}
                placeholder="Full name"
                accessibilityLabel="Full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                onSubmitEditing={() => phoneInput.current?.focus()}
                error={errorFor('name')}
              />

              <IconField
                ref={phoneInput}
                icon={({ color }) => <PhoneIcon color={color} />}
                placeholder="Phone number"
                accessibilityLabel="Phone number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="next"
                onSubmitEditing={() => emailInput.current?.focus()}
                error={errorFor('phone')}
              />

              <IconField
                ref={emailInput}
                icon={({ color }) => <MailIcon color={color} />}
                placeholder="Email address"
                accessibilityLabel="Email address"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordInput.current?.focus()}
                error={errorFor('email')}
              />

              <IconField
                ref={passwordInput}
                icon={({ color }) => <LockIcon color={color} />}
                placeholder="Password"
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => confirmationInput.current?.focus()}
                error={errorFor('password')}
                trailing={
                  <RevealToggle
                    shown={showPassword}
                    onToggle={() => setShowPassword((on) => !on)}
                  />
                }
              />

              {/*
              This is the first password a driver ever chooses on this
              platform, and the only one nobody handed them — so it is the one
              place a meter changes what gets typed rather than just grading it.
              Renders nothing until they start.
            */}
              <PasswordMeter password={password} />

              <IconField
                ref={confirmationInput}
                icon={({ color }) => <LockIcon color={color} />}
                placeholder="Confirm password"
                accessibilityLabel="Confirm password"
                value={confirmation}
                onChangeText={setConfirmation}
                secureTextEntry={!showConfirmation}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={submit}
                error={errorFor('confirmation')}
                trailing={
                  <RevealToggle
                    shown={showConfirmation}
                    onToggle={() => setShowConfirmation((on) => !on)}
                  />
                }
              />

              <View style={styles.consent}>
                <Checkbox
                  checked={acceptedTerms}
                  onToggle={() => setAcceptedTerms((on) => !on)}
                  error={problem?.field === 'terms'}
                >
                  <Text style={styles.consentText}>
                    I agree to the{' '}
                    <TextLink label="Terms and Conditions" onPress={() => setLegalDoc('terms')} />{' '}
                    and <TextLink label="Privacy Policy" onPress={() => setLegalDoc('privacy')} />
                  </Text>
                </Checkbox>

                {problem?.field === 'terms' && (
                  <Text accessibilityRole="alert" style={styles.consentError}>
                    {registrationProblemMessage(problem.problem)}
                  </Text>
                )}
              </View>

              {/*
              Enabled whatever the form contains, and validated on press.
              A greyed-out button that will not say what is missing leaves the
              driver to guess between five fields and a tick box; this one
              answers, and puts the cursor on the answer.
            */}
              <Button label="Sign Up" onPress={() => void submit()} busy={busy} />

              <View style={styles.footer}>
                <Text style={styles.footerText}>Already have an account? </Text>
                <TextLink label="Log in" onPress={onSignIn} />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <LegalSheet document={legalDoc} onClose={() => setLegalDoc(null)} />
    </Screen>
  );
}

const GUTTER = spacing.lg + 2;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    // Vertical padding is applied at the call site, where the safe-area insets
    // are known.
    flexGrow: 1,
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  logo: {
    // The lockup is 840×230 after trimming; this holds that ratio so the
    // kangaroo never squashes.
    width: 232,
    height: 64,
    alignSelf: 'center',
  },
  headline: {
    ...typography.display,
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: GUTTER,
    marginTop: spacing.lg,
  },
  headlineBrand: {
    // Green, and green at display size specifically — `brand-green` fails AA
    // for body text and passes comfortably here (DESIGN.md §1).
    color: colors.primary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  received: {
    backgroundColor: colors.successTint,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  receivedTitle: {
    ...typography.heading,
    color: colors.success,
    marginBottom: spacing.sm,
  },
  receivedBody: {
    ...typography.body,
    color: colors.textBody,
  },
  consent: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  consentText: {
    ...typography.caption,
    color: colors.textBody,
  },
  consentError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs + 2,
    marginLeft: 32,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  footerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
