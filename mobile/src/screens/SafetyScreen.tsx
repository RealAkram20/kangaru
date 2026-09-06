import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchLegalDocuments, fetchOfficeContact } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { useDutyToggle } from '../duty/useDutyToggle';
import type { ProfileStackParams } from '../navigation/types';
import { emphasisSegments } from '../support/prose';
import type { HelpTopicKey } from '../support/topics';
import { helpTopics } from '../support/topics';
import {
  Card,
  IconChip,
  MenuRow,
  Notice,
  Screen,
  ScreenHeader,
  usePressScale,
} from '../ui/components';
import {
  CarIcon,
  CreditCardIcon,
  CircleQuestionMarkIcon,
  FileTextIcon,
  MessageCircleMoreIcon,
  MessageCircleWarningIcon,
  ShieldAlertIcon,
  ShieldIcon,
} from '../ui/icons';
import { SkeletonText } from '../ui/Skeleton';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Safety'>;

/**
 * Getting help when something goes wrong (ADR-0040).
 *
 * ## The SOS button, and why it exists now when it was refused before
 *
 * The first cut of this screen refused an SOS button, and the reasoning is
 * worth keeping verbatim because it is still correct about the button it was
 * refusing:
 *
 * > An SOS on this platform would have nowhere to go. There is no monitored
 * > channel, no on-call rota, and no acknowledgement path — pressing it would
 * > write a log line, show a reassuring confirmation, and leave somebody in
 * > trouble believing help was coming. **A button that summons nobody is the
 * > most dangerous control this app could ship.**
 *
 * Every word of that stands. **This button is not that button.** It does not
 * report to the platform, it does not write a log line, and it shows no
 * confirmation. It opens the handset's dialler on the emergency number the
 * office publishes — the same act the previous version performed from a smaller
 * control with a quieter label. What changed is the size and the prominence,
 * not the promise.
 *
 * Three things keep it honest, and none of them is optional:
 *
 * 1. **It says what it does, on the face of it** — *"Tap to call emergency
 *    services"*, and the number it will dial is printed underneath. A driver
 *    can see they are about to make a phone call, so "SOS" cannot be misread
 *    as a silent alert to somebody watching.
 * 2. **It does not exist when there is no number.** `emergency_number` is a
 *    public setting and is **empty by default**; an unconfigured deployment
 *    renders a notice telling the driver to save their own local number
 *    *before* they need it. A dead SOS is exactly the control that was
 *    refused, and the test for this case is the most important one in
 *    `SafetyScreen.test.tsx`.
 * 3. **No number is hardcoded.** 999 is Uganda's. This product is built to run
 *    elsewhere and `docs/screen-rules.md` §1 covers a value the platform
 *    cannot produce; a plausible default here means a driver in another country
 *    dialling a number that does not answer.
 *
 * The prominence is the point. This is read one-handed, possibly in the dark,
 * by somebody frightened, and it is the one control in the app that should be
 * findable without reading.
 *
 * ## The position sentence is still the most important thing here
 *
 * On duty, this app streams position to the office (ADR-0024 §2), so a
 * dispatcher can already find them. **Off duty it streams nothing** — the
 * privacy notice promises exactly that, and it is a promise worth keeping. A
 * driver in trouble off duty must know that nobody can see where they are, or
 * they will wait for help that is not coming. That sentence is why this screen
 * reads live duty state rather than being static text, and it sits directly
 * under the emergency card because it changes what the driver says when the
 * call connects.
 *
 * **The mockup does not draw it.** It is kept anyway, per
 * `docs/screen-rules.md`: the rules outrank the mockup, and this is the only
 * screen in the app that tells a driver what the platform can see.
 *
 * ## Help Topics route to a form now, and that reversed with ADR-0044
 *
 * This block used to read *"route to a person, not to a form"*, and it was
 * right when it was written: there was no issue-reporting endpoint on this
 * platform, so a topic opened the support screen with the office's real number
 * rather than a text box that posted nowhere. `support/topics.ts` still holds
 * that reasoning in full, and ADR-0044 is the answer to it — the loop was
 * built rather than apologised for.
 *
 * What each row does now: opens `ReportIssue` with the topic named, and the
 * topic decides what the form asks for. **The labels did not change** (ADR-0044
 * §1) — they are the owner's own and the defect was never the words. What
 * changed is that the distinguishing sentence is a visible `subtitle` instead
 * of an `announcement` only, which is the whole of the *"repeated and fake"*
 * reading: five identically shaped chevron rows, distinguishable by a screen
 * reader and not by the eye.
 *
 * **`Your reports` is the return path, and it is not decoration.** `MyReports`
 * is otherwise reachable only from the report form's own success replace, so
 * without this row a driver who has already sent a report has nowhere to read
 * the answer — the half of the loop `master-plan.md` §2 exists to catch.
 */
export function SafetyScreen({ navigation }: Props) {
  const { api } = useAuth();
  const { onDuty } = useDutyToggle();

  /*
    `isSuccess` is read, not just `data`. See the notice below: "the office has
    not published a number" and "this app could not reach the office" are
    different sentences, and only one of them is ever true.
  */
  const { data: office, isSuccess: officeLoaded } = useQuery({
    queryKey: ['office-contact'],
    queryFn: () => fetchOfficeContact(api),
    networkMode: 'offlineFirst',
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const { data: legal, isLoading } = useQuery({
    queryKey: ['legal-documents'],
    queryFn: () => fetchLegalDocuments(api),
    networkMode: 'offlineFirst',
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });

  const emergency = office?.emergency ?? null;
  const guidance = (legal?.safety ?? '').trim();

  return (
    <Screen>
      <ScreenHeader title="Help & Safety" subtitle={null} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {emergency === null ? (
          /*
            No number, and the screen must not guess one. Inventing a default
            would be `docs/screen-rules.md` §1 at its most expensive: a driver
            dialling a number that does not answer in their country.

            This branch is also why the SOS button is defensible — there is
            never a red button on this screen that does nothing.

            **Two sentences, because there are two states.** The screen only
            knows the office published nothing once the request has actually
            succeeded. Before that — a cold start upcountry with no signal and
            nothing cached, which is a routine way to open this screen — saying
            so would be the app asserting a fact it does not have, on the one
            screen where being believed matters most. The offline wording claims
            nothing about the office and gives the driver the same instruction,
            which is the part that helps either way.
          */
          <Notice
            tone="warning"
            message={
              officeLoaded
                ? 'No emergency number published. Save your local one now.'
                : 'Emergency number not loaded. Dial your local one directly.'
            }
          />
        ) : (
          <EmergencyCard
            number={emergency}
            onPress={() => void Linking.openURL(`tel:${emergency.replace(/\s+/g, '')}`)}
          />
        )}

        {/*
          The sentence that changes what a driver does next, and the reason
          this screen reads live duty state. See the module docblock.
        */}
        <Card style={onDuty ? styles.positionOn : styles.positionOff}>
          <View style={styles.positionHead}>
            <ShieldIcon
              size={22}
              color={onDuty ? colors.primaryText : colors.warning}
              strokeWidth={2}
            />
            <Text
              style={[
                styles.positionTitle,
                { color: onDuty ? colors.primaryText : colors.warning },
              ]}
            >
              {onDuty ? 'The office can see where you are' : 'Nobody can see where you are'}
            </Text>
          </View>

          {/*
            **Only off duty, and only the instruction.** On duty the title
            already says the office can see them and the sentence under it added
            nothing a frightened person would read. Off duty the title states
            the fact and this states the consequence — say where you are — which
            is the part that changes what they do on the call. See the module
            docblock: this pair is why the screen reads live duty state.
          */}
          {!onDuty && (
            <Text style={styles.positionBody}>Say where you are when you call.</Text>
          )}
        </Card>

        <Text style={styles.sectionTitle}>Report something to the office</Text>

        <Card style={styles.topics}>
          {helpTopics.map((topic, index) => (
            <View key={topic.key}>
              {index > 0 && <View style={styles.separator} />}
              <MenuRow
                icon={<IconChip>{topicGlyph(topic.key)}</IconChip>}
                label={topic.label}
                subtitle={topic.summary}
                announcement={`${topic.label}. ${topic.summary}`}
                onPress={() => navigation.navigate('ReportIssue', { topic: topic.key })}
              />
            </View>
          ))}

          {/*
            **In this card rather than one of its own, and last.** The five rows
            above write a report; this one reads the answers back, which is the
            same subject and the reason the section is titled for the office
            rather than for the form. A second Card would spend a whole card's
            chrome on one destination, on a screen that already carries five
            sections before the fold.

            No `subtitle`: `MenuRow`'s own docblock asks for one only where the
            label cannot say which row this is, and "Your reports" answers that
            by itself. A subtitle on every row is a second column of prose on a
            screen read at a glance from a cradle.
          */}
          <View style={styles.separator} />
          <MenuRow
            icon={
              <IconChip>
                <FileTextIcon size={22} color={colors.textBody} strokeWidth={1.9} />
              </IconChip>
            }
            label="Your reports"
            onPress={() => navigation.navigate('MyReports')}
          />
        </Card>

        <ContactSupportCard onPress={() => navigation.navigate('Support')} />

        {/*
          The shape of the guidance, not a spinner. A driver opening this has
          been told to read something; a placeholder the size of the paragraphs
          says it is coming, where a spinner in the middle of a page reads as
          the office having nothing to say.
        */}
        {isLoading && <SkeletonText lines={5} style={styles.loading} />}

        {guidance !== '' && (
          <>
            <Text style={styles.sectionTitle}>Staying safe</Text>
            <Card>
              {/*
                The office's own words, rendered as written. Paragraphs are
                split rather than run together so a driver can find the one
                they need — this is read in a hurry, by definition.
              */}
              {guidance.split(/\n{2,}/).map((paragraph, index) => (
                <Text key={index} style={styles.paragraph}>
                  {/*
                    Split rather than printed, because the office emphasises a
                    sentence in this document and a raw double asterisk on the
                    screen reads as a broken app. `support/prose.ts` says why
                    that is one marker and not a Markdown renderer.
                  */}
                  {emphasisSegments(paragraph.trim()).map((segment, part) => (
                    <Text key={part} style={segment.strong ? styles.strong : undefined}>
                      {segment.text}
                    </Text>
                  ))}
                </Text>
              ))}
            </Card>
          </>
        )}

        {/*
          **Shortened, not removed, and this is the one line on the driver app
          I would argue against cutting entirely.** The rest of this pass
          deletes prose; this sentence is the promise the SOS button does *not*
          make. Without it a red button on a safety screen reads as an alert to
          somebody watching, which is the control the module docblock refused.
          Nine words instead of twenty-three.
        */}
        <Text style={styles.note}>The app does not monitor emergencies — call for help.</Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * The glyph for a topic row.
 *
 * A `switch` rather than an icon on the topic record, so `support/topics.ts`
 * stays a plain `.ts` module that a test can read without a renderer. It is
 * exhaustive over `HelpTopicKey`, so adding a topic without a glyph fails
 * `tsc` rather than rendering a blank chip.
 */
function topicGlyph(key: HelpTopicKey) {
  const props = { size: 22, color: colors.textBody, strokeWidth: 1.9 } as const;

  switch (key) {
    case 'report':
      return <ShieldAlertIcon {...props} />;
    case 'passenger':
      return <MessageCircleWarningIcon {...props} />;
    case 'vehicle':
      return <CarIcon {...props} />;
    case 'payment':
      return <CreditCardIcon {...props} />;
    case 'lost_item':
      return <CircleQuestionMarkIcon {...props} />;
  }
}

/**
 * The emergency dial, sized to be hit without looking.
 *
 * The **whole card** is the target, not the disc. The disc is what the eye
 * finds; making it the only tappable part would take a ~100pt target down to
 * 64 for no gain, and the label beside it is the part a driver reads. See the
 * module docblock for why this is drawn as an SOS at all.
 */
function EmergencyCard({ number, onPress }: { number: string; onPress: () => void }) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        /*
          One sentence, and it names the act before the number.
          `docs/screen-rules.md` §6: a screen reader should hear what this does,
          not "Emergency, S O S".
        */
        accessibilityLabel={`Emergency. Call emergency services on ${number}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.emergency}
      >
        <View style={styles.emergencyText}>
          <Text style={styles.emergencyTitle}>Emergency</Text>
          <Text style={styles.emergencyBody}>Tap to call emergency services</Text>
          {/*
            The number is on the face of the card, and the mockup does not draw
            it. It is here because the office configures it and this product is
            built to run outside Uganda: a driver about to press a red button
            should be able to see which number their phone is about to dial.
          */}
          <Text style={styles.emergencyNumber}>{number}</Text>
        </View>

        {/*
          Not an icon and not an emoji — three letters. DESIGN.md §7 makes
          Lucide the only icon vocabulary, and Lucide has no SOS glyph; the
          honest options were a phone icon or the word, and the word is what is
          recognised at a glance by somebody who is not reading.

          `importantForAccessibility="no"` because the Pressable above already
          announces the whole card, and without it a screen reader reads "S O S"
          as a second, meaningless control.
        */}
        <View style={styles.sos} importantForAccessibility="no">
          {/*
            `maxFontSizeMultiplier`, not `allowFontScaling={false}`. Refusing to
            scale at all is the easy way to protect a fixed 64pt disc and it
            takes the choice away from exactly the driver who set a larger font
            on purpose. 1.3 is what the disc can hold; the sentence beside it
            scales without a ceiling, and that sentence is what carries the
            meaning.
          */}
          <Text style={styles.sosLabel} maxFontSizeMultiplier={1.3}>
            SOS
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The way to a person at the office, for anything the topics above do not
 * cover.
 *
 * A card rather than a sixth row, exactly as the mockup draws it, and the
 * distinction is real: the rows above are *kinds of problem*, this is *the
 * person you talk to*. Warm rather than green so it does not compete with the
 * emergency card, and so the two coloured surfaces on the screen are not both
 * urgent.
 */
function ContactSupportCard({ onPress }: { onPress: () => void }) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Contact support. We are here to help"
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.contact}
      >
        <View style={styles.contactText}>
          <Text style={styles.contactTitle}>Contact Support</Text>
          <Text style={styles.contactBody}>We’re here to help</Text>
        </View>

        {/*
          Green on neutral, where the mockup draws a warm glyph on peach.

          There is no warm mid-tone in the palette and DESIGN.md §8 forbids
          inventing one here — but the deciding argument is not the missing
          token. `warningTint` was tried on the device, and it is the fill the
          *position card* uses when a driver is off duty, meaning "nobody can
          see where you are". Two yellow cards a thumb apart, one a warning and
          one an invitation, is `docs/screen-rules.md` §6 exactly: colour
          carrying two meanings at once. The neutral surface is the only tint in
          this palette that claims no status.
        */}
        <IconChip size={56} background={colors.primaryTint}>
          <MessageCircleMoreIcon size={26} color={colors.primaryText} strokeWidth={1.9} />
        </IconChip>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  loading: {
    marginTop: spacing.md,
  },
  emergency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // Well above the app's 52pt floor. See the component docblock.
    minHeight: 104,
    paddingHorizontal: spacing.md + 4,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
  },
  emergencyText: {
    flex: 1,
    gap: 2,
  },
  emergencyTitle: {
    ...typography.heading,
    color: colors.danger,
  },
  emergencyBody: {
    ...typography.caption,
    color: colors.danger,
  },
  emergencyNumber: {
    ...typography.captionStrong,
    color: colors.danger,
  },
  sos: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    /*
      The mockup's pale halo. `dangerTint` was the first choice and was wrong on
      the device: it is the card's own fill, so the ring vanished into the card
      and the disc merely looked smaller than drawn. White separates the disc
      from the tint, which is what the mockup actually shows.
    */
    borderWidth: 5,
    borderColor: colors.surface,
  },
  sosLabel: {
    ...typography.button,
    color: colors.onPrimary,
  },
  topics: {
    // The rows carry their own vertical padding and the separators must reach
    // the card's inner edges, so the card contributes only the horizontal
    // gutter.
    paddingVertical: spacing.xs,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 92,
    paddingHorizontal: spacing.md + 4,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.border,
  },
  contactText: {
    flex: 1,
    gap: 2,
  },
  contactTitle: {
    ...typography.heading,
    color: colors.text,
  },
  contactBody: {
    ...typography.caption,
    color: colors.textBody,
  },
  positionOn: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primaryTint,
    gap: spacing.sm,
  },
  positionOff: {
    backgroundColor: colors.warningTint,
    borderColor: colors.warningTint,
    gap: spacing.sm,
  },
  positionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  positionTitle: {
    ...typography.bodyStrong,
    flex: 1,
  },
  positionBody: {
    ...typography.body,
    color: colors.textBody,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
    marginTop: spacing.sm,
  },
  paragraph: {
    ...typography.body,
    color: colors.textBody,
    marginBottom: spacing.sm + 4,
  },
  strong: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
