import { StyleSheet, Text, View } from 'react-native';

import { CheckIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';
import { type PasswordStrength, passwordStrength, STRENGTH_SEGMENTS } from './passwordStrength';

/**
 * Drawn from the scorer's own ceiling rather than a literal four, so the bar
 * can never have more boxes than the scoring can fill — or fewer, which would
 * silently discard the top of the scale.
 */
const SEGMENTS = Array.from({ length: STRENGTH_SEGMENTS }, (_, index) => index);

/**
 * Four segments, a word, and one piece of advice.
 *
 * Mirrors the web app's `PasswordMeter` so a driver who has met the customer
 * sign-up form meets the same thing here.
 *
 * **The word is not decoration.** `docs/screen-rules.md` §6 forbids meaning
 * carried by colour alone, and a bar that goes from red to green with no label
 * is exactly that — unreadable to a colour-blind driver and to anyone glancing
 * at a phone in direct sun, which is the condition this app is built for.
 *
 * Renders nothing at all for an empty field: a meter reading "Too short"
 * against a box nobody has typed in yet is a scolding, not a guide.
 */
export function PasswordMeter({ password }: { password: string }) {
  const strength = passwordStrength(password);

  if (password === '') {
    return null;
  }

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no">
          {SEGMENTS.map((segment) => (
            <View
              key={segment}
              style={[
                styles.segment,
                segment < strength.score && { backgroundColor: fillFor(strength) },
              ]}
            />
          ))}
        </View>

        {/*
          The bar is hidden from the screen reader and this carries it, so it
          says the count as well as the word — "2 of 4" is the thing the sighted
          driver can see and the blind one otherwise could not.
        */}
        <Text
          style={[styles.label, { color: fillFor(strength) }]}
          numberOfLines={1}
          accessibilityLabel={`Password strength: ${strength.label}, ${strength.score} of ${STRENGTH_SEGMENTS}.`}
        >
          {strength.label}
        </Text>
      </View>

      {/*
        The scale, in the open. A bar with a hidden standard grades a driver
        against a rule nobody told them — which is how a password holding a
        capital, a number and a symbol at the stated minimum came to read
        "Fair" and be asked for four more characters, with no way to learn what
        the last two segments wanted.
      */}
      <View style={styles.checklist}>
        {strength.requirements.map((requirement) => (
          <Requirement key={requirement.key} label={requirement.label} met={requirement.met} />
        ))}
      </View>

      {/*
        `polite`, never assertive: this changes on every keystroke, and an
        assertive region would interrupt the typing it is describing.
      */}
      {strength.hint !== null && (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {strength.hint}
        </Text>
      )}
    </View>
  );
}

/**
 * One rule, and whether it is met.
 *
 * **The word carries it, never the tick alone.** `docs/screen-rules.md` §6
 * again: a row of green and grey glyphs is meaning in colour, and the
 * announcement says "Met" or "Not yet" in as many words so a screen reader
 * hears the state rather than the decoration.
 */
function Requirement({ label, met }: { label: string; met: boolean }) {
  return (
    <View style={styles.requirement} accessible accessibilityLabel={`${met ? 'Met' : 'Not yet'}: ${label}`}>
      {met ? (
        <View style={styles.tick}>
          <CheckIcon size={10} />
        </View>
      ) : (
        <View style={styles.dot} />
      )}

      <Text style={[styles.requirementLabel, met && styles.requirementMet]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Tokens only — DESIGN.md §8 fails a raw hex at a call site.
 *
 * `warning` carries both the weak and fair steps rather than introducing a
 * second amber: the palette has one, and a meter is not a reason to invent a
 * colour that then has to be maintained in a dark theme nobody has built yet.
 */
function fillFor(strength: PasswordStrength): string {
  if (strength.level === 'strong') return colors.success;
  if (strength.level === 'good') return colors.primary;
  if (strength.level === 'fair') return colors.warning;

  return colors.danger;
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  label: {
    ...typography.caption,
    // Fixed width so the segments do not resize as the word changes length —
    // a track that jumps between "Weak" and "Strong" reads as a glitch.
    width: 56,
    textAlign: 'right',
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  checklist: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Two per row on a 360dp handset, four on nothing this app runs on. The
    // wrap is the layout rather than a fixed grid, so a longer label in
    // translation reflows instead of truncating a rule.
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.xs,
  },
  requirement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
  },
  tick: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    // A ring, not a filled circle: an unmet rule is an outline waiting to be
    // completed, and a solid grey dot reads as a bullet point instead.
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  requirementLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  requirementMet: {
    color: colors.textBody,
  },
});
