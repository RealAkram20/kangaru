import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PayoutAccountKind } from '../api/endpoints';
import type { ProfileStackParams } from '../navigation/types';
import {
  useDeletePayoutAccount,
  usePayoutAccount,
  useSavePayoutAccount,
} from '../wallet/payoutQueries';
import { Button, Card, Field, Notice, Screen, ScreenHeader } from '../ui/components';
import { BanknoteIcon, SmartphoneIcon } from '../ui/icons';
import { SkeletonText } from '../ui/Skeleton';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'BankDetails'>;

/**
 * Where the office should send this driver's money (ADR-0042).
 *
 * ## What this screen is not
 *
 * **It does not pay anybody.** ADR-0029 §6's boundary is unchanged: the
 * platform records that money moved rather than making it move. Settling up is
 * still a request the office answers (ADR-0032), and this screen says so in as
 * many words — a form that looked like it triggered a payment would be the
 * worst kind of lie this app could tell, because the subject is somebody's pay.
 *
 * The owner ruled that this is a real page rather than a link to the Wallet,
 * and that ruling is why the row on the Profile screen goes here.
 *
 * ## The masked number, and the cost of it
 *
 * The server never returns the whole account number to a handset — only a mask
 * and the last four characters (ADR-0042 §4). A driver who mistypes cannot spot
 * it from four characters, which is a real cost and is why **the form starts
 * blank rather than prefilled**: an editable field showing `•••• 4567` invites
 * somebody to correct four characters into a nonsense account. Replacing means
 * typing the whole number again, deliberately.
 */
export function BankDetailsScreen({ navigation }: Props) {
  const { data: account, isLoading } = usePayoutAccount();
  const save = useSavePayoutAccount();
  const remove = useDeletePayoutAccount();

  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<PayoutAccountKind>('bank');
  const [institution, setInstitution] = useState('');
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const isBank = kind === 'bank';

  const beginEdit = () => {
    setProblem(null);
    // Deliberately blank, including the kind, which resets to `bank` only when
    // there is nothing on file. Carrying the existing kind over means somebody
    // replacing a mobile-money number is not silently switched to a bank form.
    setKind(account?.kind ?? 'bank');
    setInstitution('');
    setHolder('');
    setNumber('');
    setEditing(true);
  };

  const submit = async () => {
    const trimmed = {
      institution: institution.trim(),
      account_holder: holder.trim(),
      account_number: number.trim(),
    };

    if (
      trimmed.institution === '' ||
      trimmed.account_holder === '' ||
      trimmed.account_number === ''
    ) {
      setProblem('Fill in all three. A destination with a gap in it cannot be paid into.');

      return;
    }

    // Mirrors the server's `min:4` so a driver on a weak connection finds out
    // now rather than after a round trip. Nothing stricter — a shape rule here
    // would refuse a real account and leave its owner unable to be paid.
    if (trimmed.account_number.length < 4) {
      setProblem('That does not look like a full number.');

      return;
    }

    try {
      await save.mutateAsync({ kind, ...trimmed });
      setEditing(false);
      setProblem(null);
    } catch {
      setProblem(
        'That did not reach the office. Payout details need a connection — unlike your trip work, they are not queued.',
      );
    }
  };

  const confirmRemove = () => {
    Alert.alert(
      'Remove these details?',
      'The office will not know where to send your money until you add them again.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await remove.mutateAsync();
              } catch {
                setProblem('That did not reach the office. Try again when you have a connection.');
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="Bank Details"
        subtitle={null}
        onBack={() => (editing ? setEditing(false) : navigation.goBack())}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {problem !== null && <Notice message={problem} tone="danger" />}

          {/*
            Said once, plainly, at the top. ADR-0029 §6 and ADR-0032: this
            records a destination, and a human at the office still decides when
            anybody is paid. A screen about money that leaves that ambiguous is
            a screen that makes a promise the platform has not made.
          */}
          <Notice
            tone="info"
            message="The office pays you into this account. Adding it here does not request a payment — ask for one from your Wallet."
          />

          {editing ? (
            <Card>
              <Text style={styles.legend}>Where should the money go?</Text>

              <View style={styles.kinds}>
                <KindChoice
                  label="Bank account"
                  icon={
                    <BanknoteIcon size={20} color={isBank ? colors.onPrimary : colors.textBody} />
                  }
                  selected={isBank}
                  onPress={() => setKind('bank')}
                />
                <KindChoice
                  label="Mobile money"
                  icon={
                    <SmartphoneIcon
                      size={20}
                      color={!isBank ? colors.onPrimary : colors.textBody}
                    />
                  }
                  selected={!isBank}
                  onPress={() => setKind('mobile_money')}
                />
              </View>

              {/*
                The labels change with the kind, because the two are different
                questions: nobody calls Stanbic a provider, and asking a driver
                for an "account number" while they are looking at their own
                handset is how a wrong answer gets typed confidently.
              */}
              <Field
                label={isBank ? 'Bank' : 'Provider'}
                placeholder={isBank ? 'Stanbic' : 'MTN MoMo'}
                value={institution}
                onChangeText={setInstitution}
                autoCapitalize="words"
              />

              <Field
                label="Name on the account"
                placeholder="As it is written at the bank"
                value={holder}
                onChangeText={setHolder}
                autoCapitalize="words"
              />

              <Field
                label={isBank ? 'Account number' : 'Mobile money number'}
                value={number}
                onChangeText={setNumber}
                keyboardType={isBank ? 'number-pad' : 'phone-pad'}
                autoCapitalize="none"
              />

              <View style={styles.actions}>
                <Button
                  label="Cancel"
                  tone="neutral"
                  onPress={() => setEditing(false)}
                  disabled={save.isPending}
                />
                <Button label="Save" onPress={() => void submit()} busy={save.isPending} />
              </View>
            </Card>
          ) : account === null || account === undefined ? (
            <Card>
              {/*
                **An empty state and a loading state are different answers, and
                this card used to give the first while meaning the second.** The
                title flipped to "Loading…" inside a card otherwise shaped like
                "the office has nothing for you" — so a driver waiting on their
                payout details read, for as long as the request took, a screen
                that appeared to say there were none.

                Now the placeholder carries it: three fields' worth of prose
                while the account is arriving, and the empty state only once the
                answer is genuinely "none". The empty state below still says
                what to do rather than "no data" — a driver reading it has
                probably just been told by the office that they need it.
              */}
              {isLoading ? (
                <SkeletonText lines={3} />
              ) : (
                <>
                  <Text style={styles.emptyTitle}>The office has no details for you</Text>
                  <Text style={styles.emptyBody}>
                    Add a bank account or a mobile money number so the office knows where to send
                    what you are owed.
                  </Text>
                  <Button label="Add payout details" onPress={beginEdit} />
                </>
              )}
            </Card>
          ) : (
            <Card>
              <Row label={account.kind_label} value={account.institution} />
              <Row label="Name on the account" value={account.account_holder_masked} />
              <Row label={account.number_label} value={account.account_number_masked} />

              {/*
                Says why the number is short, rather than leaving a driver to
                wonder whether the office has the whole thing. The mask is a
                deliberate protection and reads as a bug when unexplained.
              */}
              <Text style={styles.maskNote}>
                Only the last four digits are shown here. The office has the full number.
              </Text>

              <View style={styles.actions}>
                <Button
                  label="Remove"
                  tone="danger"
                  onPress={confirmRemove}
                  busy={remove.isPending}
                />
                <Button label="Replace" onPress={beginEdit} />
              </View>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * One of the two destination kinds.
 *
 * A pair of buttons rather than a picker: two options is below the threshold
 * where a picker earns the tap it costs, and both are visible at once so a
 * driver can see there *is* a mobile-money option — a closed picker hides that
 * this platform pays either way.
 */
function KindChoice({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.kindWrap}>
      <Button
        label={label}
        icon={icon}
        tone={selected ? 'primary' : 'neutral'}
        size="sm"
        onPress={onPress}
      />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  legend: {
    ...typography.label,
    color: colors.textBody,
    marginBottom: spacing.sm,
  },
  kinds: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  kindWrap: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 52,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
  rowValue: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 2,
    textAlign: 'right',
  },
  maskNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
  },
});
