import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSocialSignIn } from '../auth/useSocialSignIn';
import { HeroCarousel } from '../onboarding/HeroCarousel';
import { Button, Screen, SocialButton, TextLink } from '../ui/components';
import { FacebookMark, GoogleMark, MailIcon } from '../ui/icons';
import { colors, spacing, typography } from '../ui/theme';
import { LegalSheet, type LegalDocument } from './LegalSheet';

/**
 * The front door: three ways in and nothing to fill.
 *
 * Deliberately not a ScrollView. Everything a person can do here fits one
 * screen on the smallest handset in the fleet, and a front door that scrolls
 * hides its own options — the sign-up form was doing exactly that to the
 * social buttons before this screen existed.
 *
 * The "By continuing…" line is a courtesy, not the consent record. The email
 * application still collects its explicit tick, because a footnote nobody
 * tapped is not evidence of agreement under the DPPA 2019 — but the social
 * paths need the notice stated up front, and stating it twice costs nothing.
 */
export function WelcomeScreen({
  onSignUp,
  onSignIn,
  onApply,
}: {
  onSignUp: () => void;
  onSignIn: () => void;
  /** A social identity with no account: apply, prefilled (ADR-0028 §3). */
  onApply: (prefill: { name: string; email: string }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const social = useSocialSignIn({ onApply, onNotice: setNotice });

  return (
    <Screen>
      {/* Dark icons on white — undoes the sign-in header's light style when
          the driver comes back this way. */}
      <StatusBar style="dark" />
      <View
        style={[
          styles.body,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <Image
          source={require('../../assets/brand/wordmark.png')}
          style={styles.logo}
          contentFit="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="KangaruRide — for safety and reliability"
          transition={0}
        />

        <HeroCarousel compact />

        {/* Deliberately two lines on every device — a break that only appears
            on narrow phones would make the screen feel accidental on them. */}
        <Text style={styles.headline}>
          Welcome to{'\n'}
          <Text style={styles.headlineBrand}>KangaruRide</Text>
        </Text>
        {/* "Partner", not "delivery partner" — the third slide exists to say
            the platform moves people too, and the copy must not take it back. */}
        <Text style={styles.subtitle}>Join as a partner and earn on your own schedule.</Text>

        {/* Pushes the actions to the bottom, where thumbs are. */}
        <View style={styles.flex} />

        {notice !== null && (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        )}

        {/* The social buttons render only when the owner has switched them on
            in the console (ADR-0028 §4) — absent, not greyed. Email is the
            one door that is always there. */}
        <View style={styles.actions}>
          <Button
            label="Sign up with email"
            size="sm"
            icon={<MailIcon color={colors.onPrimary} size={18} strokeWidth={2} />}
            onPress={onSignUp}
          />
          {social.googleAvailable && (
            <SocialButton
              label="Continue with Google"
              mark={<GoogleMark size={18} />}
              busy={social.busyProvider === 'google'}
              onPress={social.startGoogle}
            />
          )}
          {social.facebookAvailable && (
            <SocialButton
              label="Continue with Facebook"
              mark={<FacebookMark size={18} />}
              busy={social.busyProvider === 'facebook'}
              onPress={social.startFacebook}
            />
          )}
        </View>

        <View style={styles.dividerSlot}>
          <View style={styles.dividerRule} />
          <Text style={styles.dividerLabel}>OR</Text>
          <View style={styles.dividerRule} />
        </View>

        <Button label="Log in" tone="neutral" size="sm" onPress={onSignIn} />

        <Text style={styles.footnote}>
          By continuing, you agree to our{' '}
          <TextLink label="Terms and Conditions" onPress={() => setLegalDoc('terms')} /> and{' '}
          <TextLink label="Privacy Policy" onPress={() => setLegalDoc('privacy')} />.
        </Text>
      </View>

      <LegalSheet document={legalDoc} onClose={() => setLegalDoc(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg + 2,
  },
  logo: {
    width: 210,
    height: 58,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  headline: {
    ...typography.display,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  headlineBrand: {
    color: colors.primary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  notice: {
    ...typography.caption,
    color: colors.warning,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  actions: {
    gap: spacing.sm + 4,
  },
  dividerSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  dividerRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    ...typography.captionStrong,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});