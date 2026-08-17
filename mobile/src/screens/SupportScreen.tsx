import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchOfficeContact } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import type { ProfileStackParams } from '../navigation/types';
import { useDriverProfile } from '../profile/queries';
import { findHelpTopic, supportMailto } from '../support/topics';
import { appVersion } from '../ui/version';
import { Card, MenuRow, Notice, Screen, ScreenHeader } from '../ui/components';
import { MailIcon, PhoneIcon } from '../ui/icons';
import { colors, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Support'>;

/**
 * Reaching a person at the office.
 *
 * ## Why this is a contact card and not a help desk
 *
 * There is **no messaging anywhere on this platform**, deliberately —
 * `trips/contact.ts` documents the seam and the reason. Building a ticket
 * queue here would mean a driver typing a problem into a box that nobody is
 * watching, which is worse than the phone call they would otherwise have made.
 *
 * So this screen does one honest thing: it puts the office's real number and
 * address one tap away, and it puts the facts the office will ask for on the
 * screen so the driver has them while they are talking.
 *
 * ## Nothing here is invented
 *
 * The number and the address come from `settings.branding`, which an
 * administrator sets. **`contact_phone` defaults to empty**, so a deployment
 * that has not published one gets a sentence saying so rather than a
 * plausible-looking placeholder — a support screen that sends somebody with a
 * real problem to a dead line is the most expensive possible lie on it.
 *
 * ## The optional topic
 *
 * `Safety`'s five Help Topics rows land here, each naming one
 * (`support/topics.ts`). A topic changes three things and nothing else: the
 * subtitle names the subject, the lead says what that conversation is for, and
 * *Have these ready* gains the two or three specifics the office asks for on
 * that kind of call. **Without a topic this screen renders exactly what it
 * always did** — the drawer still reaches it with no params.
 *
 * The topic never becomes a payload. It prefills a mail subject and it prompts
 * the driver; it is not submitted anywhere, because there is nowhere to submit
 * it to.
 */
export function SupportScreen({ navigation, route }: Props) {
  const { api } = useAuth();
  const { data: profile } = useDriverProfile();
  /*
    An unrecognised key reads as no topic rather than throwing — a deep link
    from an older build naming a topic that has since been renamed should land
    on the plain support screen, not crash the app.
  */
  const topic = findHelpTopic(route.params?.topic);

  const { data: office, isError } = useQuery({
    // The same key `useAuthMethods` uses would be wrong — different shape —
    // but the same endpoint, so this is one extra cached read.
    queryKey: ['office-contact'],
    queryFn: () => fetchOfficeContact(api),
    networkMode: 'offlineFirst',
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const phone = office?.phone ?? null;
  const email = office?.email ?? null;

  return (
    <Screen>
      <ScreenHeader
        title="Support"
        subtitle={topic?.label ?? null}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {isError && (
          <Notice
            tone="warning"
            message="Could not load the office's contact details. Pull down once you have a signal."
          />
        )}

        <Text style={styles.lead}>
          {topic?.summary ??
            'Talk to the office. They can see your trips, your documents and your wallet, and they are the people who can change any of them.'}
        </Text>

        <Card>
          {phone === null && email === null ? (
            /*
              Both absent is a real state on an unconfigured deployment, and it
              gets a sentence rather than an empty card. Inventing a number
              here would be `docs/screen-rules.md` §1 applied to a phone
              number — a value the platform cannot produce, presented as one it
              can.
            */
            <Text style={styles.empty}>
              The office has not published a phone number or an email address yet. Ask your
              dispatcher how to reach them.
            </Text>
          ) : (
            <>
              {phone !== null && (
                <MenuRow
                  icon={<PhoneIcon color={colors.primary} size={22} strokeWidth={2} />}
                  label="Call the office"
                  value={phone}
                  announcement={`Call the office on ${phone}`}
                  onPress={() => void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`)}
                />
              )}

              {phone !== null && email !== null && <View style={styles.separator} />}

              {email !== null && (
                <MenuRow
                  icon={<MailIcon color={colors.primary} size={22} strokeWidth={2} />}
                  label="Email the office"
                  value={email}
                  // An address, not a status: it may lose its tail, the label
                  // may not. See `MenuRow`'s `longValue`.
                  longValue
                  announcement={`Email the office at ${email}`}
                  onPress={() => void Linking.openURL(supportMailto(email, topic))}
                />
              )}
            </>
          )}
        </Card>

        {/*
          The office asks for these on every call, and a driver reading them
          off a screen is faster and more accurate than one reciting from
          memory in traffic. None of it is new data — it is what `me/profile`
          already serves, put where it is useful.
        */}
        <Text style={styles.sectionTitle}>Have these ready</Text>

        <Card>
          {/*
            The topic's prompts come first and share this one card, rather than
            getting a second "Have these ready" heading above it. They are
            questions, not facts, so they are drawn as a list and not as
            `Detail` rows — a label with no value beside it would read as a
            fact the app failed to load.
          */}
          {topic !== null && (
            <View style={styles.prompts}>
              {topic.prepare.map((prompt) => (
                <View key={prompt} style={styles.prompt}>
                  <Text style={styles.promptBullet}>{'•'}</Text>
                  <Text style={styles.promptText}>{prompt}</Text>
                </View>
              ))}
            </View>
          )}

          {topic !== null && <View style={styles.separator} />}

          <Detail label="Your name" value={profile?.name ?? '—'} />
          <View style={styles.separator} />
          <Detail label="Phone the office has" value={profile?.phone ?? '—'} />
          <View style={styles.separator} />
          <Detail
            label="Vehicle"
            value={profile?.vehicle?.registration_number ?? 'No vehicle of your own'}
          />
          <View style={styles.separator} />
          <Detail label="App version" value={appVersion()} />
        </Card>

        <Text style={styles.note}>
          Nothing you send here is stored by the app. This screen opens your phone&apos;s dialler or
          mail app — the conversation is between you and the office.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/** A label and a value, not tappable — deliberately not `MenuRow`. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  lead: {
    ...typography.body,
    color: colors.textBody,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
  },
  prompts: {
    gap: spacing.sm,
    paddingBottom: spacing.sm + 2,
  },
  prompt: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  promptBullet: {
    ...typography.body,
    color: colors.textMuted,
  },
  promptText: {
    ...typography.body,
    color: colors.textBody,
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  detailLabel: {
    ...typography.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
  detailValue: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
